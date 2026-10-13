/* Test murni Node (BUKAN Playwright/browser) untuk
 * netlify/functions/_web-push-send.js dan 2 function yang memakainya
 * (notify-new-payment-request.js, notify-new-account.js) -- lihat komentar
 * di tests/test-midtrans-functions.mjs soal kenapa ini file Node terpisah.
 *
 * BEDA dari test-notify-function.mjs/test-midtrans-functions.mjs: kedua
 * function di sini membaca VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY ke CONST
 * level module SEKALI saat file-nya pertama kali di-load -- jadi test yang
 * butuh kombinasi env var BEDA (mis. "VAPID belum diisi" vs "VAPID sudah
 * diisi") WAJIB `require()` via `createRequire` (BUKAN dynamic `import()`
 * dengan query string pembeda `?ctx=...` -- sudah dicoba, TIDAK bekerja:
 * Node meng-interop file CommonJS ini lewat `require.cache` yang di-key
 * oleh PATH SAJA, mengabaikan query string, jadi query-busting trick ala
 * ESM tidak berlaku di sini) dan manual hapus `require.cache` entry-nya
 * SEBELUM require ulang, supaya module-nya benar-benar dievaluasi lagi
 * dari awal dengan process.env versi terbaru -- lihat freshRequire() di
 * bawah (teknik yang sama persis dengan jest.resetModules()).
 *
 * Butuh 'web-push' benar-benar ter-install (symlink sementara
 * /home/user/laundrybatapasid/node_modules -> scratchpad, WAJIB dihapus
 * lagi sebelum commit, lihat README). Pasangan kunci VAPID di bawah CUMA
 * dipakai lokal untuk test (bukan kunci asli aplikasi) -- aman di-commit.
 *
 * Jalankan: node tests/test-push-notify-function.mjs
 */
import assert from 'assert';
import { createRequire } from 'module';

const requireFn = createRequire(import.meta.url);
function freshRequire(relPath) {
  const resolved = requireFn.resolve(relPath);
  delete requireFn.cache[resolved];
  return requireFn(resolved);
}

const TEST_VAPID_PUBLIC = 'BIc2UUCQ7_6VYn_5Z_yfWaTHtQmUCC1lBiwkUbYzOYoXfRzy5S4VEAxKuRX6DA0g6myBYlhUwB0JUsw0zij_SiQ';
const TEST_VAPID_PRIVATE = 'NrJaier4aUWfHoC4O8cM2n6jTwON-FdUKiMFeG5B78w';

const errors = [];
async function step(name, fn) {
  try { await fn(); console.log(`OK: ${name}`); }
  catch (e) { errors.push(`FAIL: ${name} -> ${e.message}`); console.log(`FAIL: ${name} -> ${e.message}`); }
}

/* require() biasa (dicache sekali, TIDAK di-fresh) -- _web-push-send.js
   sendiri tidak baca process.env sama sekali (semua parameter disuntik
   lewat createPushSender(webpush, config)), dan 'web-push' (npm package)
   harus TETAP SATU objek module yang sama persis dengan yang dipakai di
   dalam notify-new-payment-request.js/notify-new-account.js supaya
   monkey-patch .sendNotification di sini ikut terpakai di dalamnya. */
const webpush = requireFn('web-push');
const { createPushSender } = requireFn('../netlify/functions/_web-push-send.js');

await step('createPushSender(): mengirim push ke SEMUA subscription yang ada, pakai endpoint/p256dh/auth yang benar', async () => {
  const sent = [];
  let vapidArgs = null;
  const fakeWebpush = {
    setVapidDetails: (...args) => { vapidArgs = args; },
    sendNotification: async (sub, payload) => { sent.push({ sub, payload }); },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ([
    { endpoint: 'https://push.example/1', p256dh: 'p1', auth: 'a1' },
    { endpoint: 'https://push.example/2', p256dh: 'p2', auth: 'a2' },
  ]) });
  try {
    const sender = createPushSender(fakeWebpush, { supabaseUrl: 'http://fake', serviceRoleKey: 'x', vapidPublicKey: 'pub', vapidPrivateKey: 'priv', contactEmail: 'admin@example.com' });
    const res = await sender.sendPushToAdmins({ title: 'Judul', body: 'Isi', url: '/' });
    assert.deepStrictEqual(vapidArgs, ['mailto:admin@example.com', 'pub', 'priv']);
    assert.strictEqual(res.sent, 2, 'harus kirim ke kedua subscription');
    assert.strictEqual(sent.length, 2);
    assert.strictEqual(sent[0].sub.endpoint, 'https://push.example/1');
    assert.strictEqual(sent[0].sub.keys.p256dh, 'p1');
    assert.strictEqual(JSON.parse(sent[0].payload).title, 'Judul');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await step('createPushSender(): endpoint yang sudah tidak valid (404/410) otomatis dihapus dari admin_push_subscriptions, TIDAK dianggap error fatal', async () => {
  const deleteUrls = [];
  const fakeWebpush = {
    setVapidDetails: () => {},
    sendNotification: async () => { const e = new Error('Gone'); e.statusCode = 410; throw e; },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (opts && opts.method === 'DELETE') { deleteUrls.push(String(url)); return { ok: true, json: async () => null }; }
    return { ok: true, json: async () => ([{ endpoint: 'https://push.example/expired', p256dh: 'p', auth: 'a' }]) };
  };
  try {
    const sender = createPushSender(fakeWebpush, { supabaseUrl: 'http://fake', serviceRoleKey: 'x', vapidPublicKey: 'pub', vapidPrivateKey: 'priv', contactEmail: 'admin@example.com' });
    const res = await sender.sendPushToAdmins({ title: 't', body: 'b', url: '/' });
    assert.strictEqual(res.sent, 0);
    assert.strictEqual(res.removed, 1);
    assert.strictEqual(deleteUrls.length, 1);
    assert.ok(deleteUrls[0].includes('endpoint=eq.https'), 'harus hapus baris berdasarkan endpoint yang expired: ' + deleteUrls[0]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await step('createPushSender(): tidak ada subscription sama sekali -> no-op aman (bukan error)', async () => {
  const fakeWebpush = { setVapidDetails: () => {}, sendNotification: async () => { throw new Error('seharusnya tidak pernah dipanggil'); } };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ([]) });
  try {
    const sender = createPushSender(fakeWebpush, { supabaseUrl: 'http://fake', serviceRoleKey: 'x', vapidPublicKey: 'pub', vapidPrivateKey: 'priv', contactEmail: 'admin@example.com' });
    const res = await sender.sendPushToAdmins({ title: 't', body: 'b', url: '/' });
    assert.deepStrictEqual(res, { sent: 0, removed: 0 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

/* ===== notify-new-payment-request.js ===== */
process.env.PAYMENT_WEBHOOK_SECRET = 'rahasia-test-123';
process.env.RESEND_API_KEY = 're_test_fake_key';
process.env.ADMIN_NOTIFY_EMAIL = 'admin@example.com';
process.env.SUPABASE_URL = 'http://fake-supabase.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-role-key';

await step('notify-new-payment-request.js: TANPA VAPID_PUBLIC_KEY/PRIVATE_KEY di-set, perilaku tetap SAMA seperti sebelum fitur push ada (cuma email, tidak ada percobaan fetch lain)', async () => {
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  const { handler } = freshRequire('../netlify/functions/notify-new-payment-request.js');
  const originalFetch = globalThis.fetch;
  let emailCalls = 0;
  globalThis.fetch = async (url) => { emailCalls++; assert.ok(String(url).includes('resend.com')); return { ok: true, json: async () => ({ id: 'x' }) }; };
  try {
    const res = await handler({
      httpMethod: 'POST',
      headers: { 'x-webhook-secret': 'rahasia-test-123' },
      body: JSON.stringify({ type: 'INSERT', table: 'payment_requests', record: { nama: 'Budi', wa: '0812', catatan: '' } }),
    });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(emailCalls, 1, 'harus tetap cuma panggil Resend 1x, tidak ada percobaan fetch lain ke Supabase (push di-skip total)');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await step('notify-new-payment-request.js: dengan VAPID_PUBLIC_KEY/PRIVATE_KEY lengkap, Web Push JUGA dikirim ke semua admin_push_subscriptions (selain email seperti biasa)', async () => {
  process.env.VAPID_PUBLIC_KEY = TEST_VAPID_PUBLIC;
  process.env.VAPID_PRIVATE_KEY = TEST_VAPID_PRIVATE;
  const { handler } = freshRequire('../netlify/functions/notify-new-payment-request.js');
  const pushSent = [];
  const originalSend = webpush.sendNotification;
  webpush.sendNotification = async (sub, payload) => { pushSent.push({ sub, payload }); };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('resend.com')) return { ok: true, json: async () => ({ id: 'x' }) };
    if (u.includes('admin_push_subscriptions')) return { ok: true, json: async () => ([{ endpoint: 'https://push.example/admin1', p256dh: 'p', auth: 'a' }]) };
    throw new Error('fetch tak terduga ke ' + u);
  };
  try {
    const res = await handler({
      httpMethod: 'POST',
      headers: { 'x-webhook-secret': 'rahasia-test-123' },
      body: JSON.stringify({ type: 'INSERT', table: 'payment_requests', record: { nama: 'Siti Laundry', wa: '081299998888', catatan: 'Paket 3 Bulan' } }),
    });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(pushSent.length, 1, 'harus kirim push ke 1 subscription admin yang ada');
    const pushBody = JSON.parse(pushSent[0].payload);
    assert.ok(pushBody.title.includes('Pendaftaran Baru'), 'judul push harus sama konteksnya dengan subjek email: ' + pushBody.title);
    assert.ok(pushBody.body.includes('Siti Laundry'), 'isi push harus menyebut nama pendaftar: ' + pushBody.body);
    assert.strictEqual(pushBody.url, '/?adminNotif=1', 'REGRESI: url push harus bawa query adminNotif=1 supaya klik notifikasi langsung membuka panel Admin Platform (lihat sw.js notificationclick + initUserData()/js/05-admin.js)');
  } finally {
    globalThis.fetch = originalFetch;
    webpush.sendNotification = originalSend;
  }
});

await step('notify-new-payment-request.js: Web Push gagal terkirim TIDAK BOLEH menggagalkan response -- email yang sudah sukses tetap dianggap berhasil (push cuma best-effort)', async () => {
  process.env.VAPID_PUBLIC_KEY = TEST_VAPID_PUBLIC;
  process.env.VAPID_PRIVATE_KEY = TEST_VAPID_PRIVATE;
  const { handler } = freshRequire('../netlify/functions/notify-new-payment-request.js');
  const originalSend = webpush.sendNotification;
  webpush.sendNotification = async () => { throw new Error('layanan push sedang down'); };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('resend.com')) return { ok: true, json: async () => ({ id: 'x' }) };
    if (u.includes('admin_push_subscriptions')) return { ok: true, json: async () => ([{ endpoint: 'https://push.example/admin1', p256dh: 'p', auth: 'a' }]) };
    throw new Error('fetch tak terduga ke ' + u);
  };
  try {
    const res = await handler({
      httpMethod: 'POST',
      headers: { 'x-webhook-secret': 'rahasia-test-123' },
      body: JSON.stringify({ type: 'INSERT', table: 'payment_requests', record: { nama: 'Budi', wa: '0812', catatan: '' } }),
    });
    assert.strictEqual(res.statusCode, 200, 'REGRESI: kegagalan push tidak boleh ikut menggagalkan response, email-nya sendiri sukses: ' + res.body);
  } finally {
    globalThis.fetch = originalFetch;
    webpush.sendNotification = originalSend;
  }
});

/* ===== notify-new-account.js (fungsi baru, CUMA push -- lihat komentar di file-nya) ===== */
await step('notify-new-account.js: menolak method selain POST', async () => {
  const { handler } = freshRequire('../netlify/functions/notify-new-account.js');
  const res = await handler({ httpMethod: 'GET', headers: {} });
  assert.strictEqual(res.statusCode, 405);
});

await step('notify-new-account.js: VAPID_PUBLIC_KEY/PRIVATE_KEY belum di-set -> 500 (beda dari notify-new-payment-request.js yang best-effort, fungsi ini isinya CUMA push)', async () => {
  const savedPub = process.env.VAPID_PUBLIC_KEY, savedPriv = process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  try {
    const { handler } = freshRequire('../netlify/functions/notify-new-account.js');
    const res = await handler({ httpMethod: 'POST', headers: {} });
    assert.strictEqual(res.statusCode, 500, res.body);
  } finally {
    if (savedPub !== undefined) process.env.VAPID_PUBLIC_KEY = savedPub;
    if (savedPriv !== undefined) process.env.VAPID_PRIVATE_KEY = savedPriv;
  }
});

await step('notify-new-account.js: konfigurasi lengkap tapi X-Webhook-Secret salah -> 401', async () => {
  process.env.VAPID_PUBLIC_KEY = TEST_VAPID_PUBLIC;
  process.env.VAPID_PRIVATE_KEY = TEST_VAPID_PRIVATE;
  const { handler } = freshRequire('../netlify/functions/notify-new-account.js');
  const res = await handler({ httpMethod: 'POST', headers: { 'x-webhook-secret': 'salah' }, body: '{}' });
  assert.strictEqual(res.statusCode, 401, res.body);
});

await step('notify-new-account.js: secret benar + konfigurasi lengkap -> lookup nama toko dari tabel settings, lalu kirim push menyebut nama toko & status trial/aktif', async () => {
  process.env.VAPID_PUBLIC_KEY = TEST_VAPID_PUBLIC;
  process.env.VAPID_PRIVATE_KEY = TEST_VAPID_PRIVATE;
  const { handler } = freshRequire('../netlify/functions/notify-new-account.js');
  const pushSent = [];
  const originalSend = webpush.sendNotification;
  webpush.sendNotification = async (sub, payload) => { pushSent.push({ sub, payload }); };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/rest/v1/settings')) return { ok: true, json: async () => ([{ shop_name: 'Laundry Mawar' }]) };
    if (u.includes('admin_push_subscriptions')) return { ok: true, json: async () => ([{ endpoint: 'https://push.example/admin1', p256dh: 'p', auth: 'a' }]) };
    throw new Error('fetch tak terduga ke ' + u);
  };
  try {
    const res = await handler({
      httpMethod: 'POST',
      headers: { 'x-webhook-secret': 'rahasia-test-123' },
      body: JSON.stringify({ type: 'INSERT', table: 'app_subscriptions', record: { owner_id: 'owner-123', status: 'trial' } }),
    });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(pushSent.length, 1);
    const pushBody = JSON.parse(pushSent[0].payload);
    assert.ok(pushBody.title.includes('Akun Toko Baru'), pushBody.title);
    assert.ok(pushBody.body.includes('Laundry Mawar'), 'harus menyebut nama toko hasil lookup settings: ' + pushBody.body);
    assert.ok(pushBody.body.includes('trial'), 'harus menyebut status trial: ' + pushBody.body);
    assert.strictEqual(pushBody.url, '/?adminNotif=1', 'REGRESI: url push harus bawa query adminNotif=1 (lihat komentar di notify-new-payment-request.js)');
  } finally {
    globalThis.fetch = originalFetch;
    webpush.sendNotification = originalSend;
  }
});

await step('notify-new-account.js: lookup nama toko gagal (settings belum ada/error) -> tetap kirim push TANPA nama toko, bukan gagal total', async () => {
  process.env.VAPID_PUBLIC_KEY = TEST_VAPID_PUBLIC;
  process.env.VAPID_PRIVATE_KEY = TEST_VAPID_PRIVATE;
  const { handler } = freshRequire('../netlify/functions/notify-new-account.js');
  const pushSent = [];
  const originalSend = webpush.sendNotification;
  webpush.sendNotification = async (sub, payload) => { pushSent.push({ sub, payload }); };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/rest/v1/settings')) return { ok: true, json: async () => ([]) }; // belum ada baris settings
    if (u.includes('admin_push_subscriptions')) return { ok: true, json: async () => ([{ endpoint: 'https://push.example/admin1', p256dh: 'p', auth: 'a' }]) };
    throw new Error('fetch tak terduga ke ' + u);
  };
  try {
    const res = await handler({
      httpMethod: 'POST',
      headers: { 'x-webhook-secret': 'rahasia-test-123' },
      body: JSON.stringify({ type: 'INSERT', table: 'app_subscriptions', record: { owner_id: 'owner-baru-belum-isi-profil', status: 'trial' } }),
    });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(pushSent.length, 1);
    const pushBody = JSON.parse(pushSent[0].payload);
    assert.ok(pushBody.body.includes('Toko baru'), 'tanpa nama toko, harus tetap kirim notifikasi generik: ' + pushBody.body);
  } finally {
    globalThis.fetch = originalFetch;
    webpush.sendNotification = originalSend;
  }
});

console.log('\n--- summary ---');
console.log(errors.length ? errors.join('\n') : 'Semua test lulus.');
process.exit(errors.length ? 1 : 0);
