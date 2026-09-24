/* Test murni Node (BUKAN Playwright/browser) untuk
 * netlify/functions/notify-new-payment-request.js -- lihat komentar di
 * tests/test-midtrans-functions.mjs soal kenapa ini file Node terpisah,
 * dan kenapa SEMUA env var harus di-set SEKALI di paling atas sebelum
 * file function-nya pernah di-import sama sekali.
 *
 * Jalankan: node tests/test-notify-function.mjs
 */
import assert from 'assert';

process.env.PAYMENT_WEBHOOK_SECRET = 'rahasia-test-123';
process.env.RESEND_API_KEY = 're_test_fake_key';
process.env.ADMIN_NOTIFY_EMAIL = 'admin@example.com';

const { handler } = await import('../netlify/functions/notify-new-payment-request.js');

const errors = [];
async function step(name, fn) {
  try { await fn(); console.log(`OK: ${name}`); }
  catch (e) { errors.push(`FAIL: ${name} -> ${e.message}`); console.log(`FAIL: ${name} -> ${e.message}`); }
}

await step('menolak method selain POST', async () => {
  const res = await handler({ httpMethod: 'GET', headers: {} });
  assert.strictEqual(res.statusCode, 405);
});

await step('menolak request tanpa header X-Webhook-Secret yang cocok (mencegah endpoint publik dipanggil sembarangan)', async () => {
  const res = await handler({
    httpMethod: 'POST',
    headers: { 'x-webhook-secret': 'bukan-secret-yang-benar' },
    body: JSON.stringify({ type: 'INSERT', table: 'payment_requests', record: { nama: 'Budi', wa: '0812', catatan: '' } }),
  });
  assert.strictEqual(res.statusCode, 401, res.body);
});

await step('menolak body tanpa field record', async () => {
  const res = await handler({
    httpMethod: 'POST',
    headers: { 'x-webhook-secret': 'rahasia-test-123' },
    body: JSON.stringify({ type: 'INSERT', table: 'payment_requests' }),
  });
  assert.strictEqual(res.statusCode, 400, res.body);
});

await step('secret benar + record pendaftaran baru (tanpa field type) -> kirim email lewat Resend dengan subjek "Pendaftaran Baru"', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), opts });
    return { ok: true, json: async () => ({ id: 'email-fake-id' }) };
  };
  try {
    const res = await handler({
      httpMethod: 'POST',
      headers: { 'x-webhook-secret': 'rahasia-test-123' },
      body: JSON.stringify({ type: 'INSERT', table: 'payment_requests', record: { nama: 'Budi Laundry', wa: '081234567890', catatan: 'Paket 6 Bulan (Rp240.000)' } }),
    });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(calls.length, 1, 'harus memanggil Resend API tepat sekali');
    assert.strictEqual(calls[0].url, 'https://api.resend.com/emails');
    assert.strictEqual(calls[0].opts.headers.Authorization, 'Bearer re_test_fake_key');
    const sentBody = JSON.parse(calls[0].opts.body);
    assert.strictEqual(sentBody.to[0], 'admin@example.com');
    assert.ok(sentBody.subject.includes('Pendaftaran Baru'), 'subjek harus menyebut "Pendaftaran Baru" untuk record tanpa type: ' + sentBody.subject);
    assert.ok(sentBody.subject.includes('Budi Laundry'), 'subjek harus menyebut nama pendaftar');
    assert.ok(sentBody.html.includes('081234567890'), 'isi email harus menyebut nomor WA pendaftar');
    assert.ok(sentBody.html.includes('Paket 6 Bulan'), 'isi email harus menyebut catatan (paket & harga)');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await step('secret benar + record type:"perpanjangan" -> subjek email harus "Permintaan Perpanjangan Baru", bukan "Pendaftaran Baru"', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { calls.push({ url: String(url), opts }); return { ok: true, json: async () => ({ id: 'x' }) }; };
  try {
    const res = await handler({
      httpMethod: 'POST',
      headers: { 'x-webhook-secret': 'rahasia-test-123' },
      body: JSON.stringify({ type: 'INSERT', table: 'payment_requests', record: { nama: 'Toko Lama', wa: '0813', catatan: 'Perpanjangan langganan aplikasi', type: 'perpanjangan' } }),
    });
    assert.strictEqual(res.statusCode, 200, res.body);
    const sentBody = JSON.parse(calls[0].opts.body);
    assert.ok(sentBody.subject.includes('Permintaan Perpanjangan Baru'), 'subjek harus menyebut "Permintaan Perpanjangan Baru": ' + sentBody.subject);
    assert.ok(!sentBody.subject.includes('Pendaftaran Baru'), 'subjek TIDAK boleh menyebut "Pendaftaran Baru" untuk perpanjangan: ' + sentBody.subject);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await step('nama/wa/catatan yang mengandung karakter HTML di-escape (cegah HTML injection di email)', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { calls.push({ url: String(url), opts }); return { ok: true, json: async () => ({ id: 'x' }) }; };
  try {
    await handler({
      httpMethod: 'POST',
      headers: { 'x-webhook-secret': 'rahasia-test-123' },
      body: JSON.stringify({ type: 'INSERT', table: 'payment_requests', record: { nama: '<img src=x onerror=alert(1)>', wa: '0812', catatan: '' } }),
    });
    const sentBody = JSON.parse(calls[0].opts.body);
    assert.ok(!sentBody.html.includes('<img src=x'), 'tag HTML mentah dari input tidak boleh lolos ke body email: ' + sentBody.html);
    assert.ok(sentBody.html.includes('&lt;img'), 'karakter < harus di-escape jadi &lt;');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await step('kalau Resend API gagal (bukan status ok), function membalas 502 (bukan diam-diam 200)', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 422, text: async () => 'domain belum diverifikasi' });
  try {
    const res = await handler({
      httpMethod: 'POST',
      headers: { 'x-webhook-secret': 'rahasia-test-123' },
      body: JSON.stringify({ type: 'INSERT', table: 'payment_requests', record: { nama: 'Budi', wa: '0812', catatan: '' } }),
    });
    assert.strictEqual(res.statusCode, 502, res.body);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

console.log('\n--- summary ---');
console.log(errors.length ? errors.join('\n') : 'Semua test lulus.');
process.exit(errors.length ? 1 : 0);
