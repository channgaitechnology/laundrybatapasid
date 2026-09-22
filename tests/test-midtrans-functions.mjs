/* Test murni Node (BUKAN Playwright/browser) untuk netlify/functions/midtrans-*.js
 * -- file-file itu jalan di runtime Node server-side, bukan dimuat ke
 * index.html, jadi tidak bisa ikut diuji lewat test.mjs (yang menjalankan
 * index.html+js/*.js di browser). Tidak butuh kredensial Midtrans/Supabase
 * sungguhan -- fetch global di-mock, dan yang diuji murni logikanya:
 * verifikasi signature, pemetaan harga paket, dan alur create-transaction/
 * webhook mengembalikan/menyimpan data yang benar.
 *
 * PENTING: midtrans-create-transaction.js dan midtrans-webhook.js membaca
 * process.env di level atas file (top-level const) -- sama seperti runtime
 * Netlify Functions sungguhan (env var tetap sepanjang hidup satu instance
 * function, tidak berubah per-request). Jadi SEMUA env var di sini harus
 * di-set SEKALI di paling atas, SEBELUM kedua file itu pernah di-import
 * sama sekali -- meng-import ulang dengan process.env yang diubah belakangan
 * TIDAK memaksa nilai konstannya ikut ter-refresh (require() Node
 * meng-cache modul berdasarkan path file, terlepas dari query string apa
 * pun yang dipakai lewat import() dinamis).
 *
 * Jalankan: node tests/test-midtrans-functions.mjs
 */
import crypto from 'crypto';
import assert from 'assert';

process.env.MIDTRANS_SERVER_KEY = 'SB-Mid-server-TEST';
process.env.MIDTRANS_IS_PRODUCTION = 'false';
process.env.SUBSCRIPTION_PRICE_1M = '50000';
process.env.SUBSCRIPTION_PRICE_3M = '135000';
delete process.env.SUBSCRIPTION_PRICE_6M;
delete process.env.SUBSCRIPTION_PRICE_12M;
process.env.SUPABASE_URL = 'https://fake-project.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-role-key';

const { getPlanPrice } = await import('../netlify/functions/_midtrans-plans.js');
const { handler: createTransactionHandler } = await import('../netlify/functions/midtrans-create-transaction.js');
const { handler: webhookHandler, verifySignature } = await import('../netlify/functions/midtrans-webhook.js');

const errors = [];
async function step(name, fn){
  try { await fn(); console.log(`OK: ${name}`); }
  catch(e){ errors.push(`FAIL: ${name} -> ${e.message}`); console.log(`FAIL: ${name} -> ${e.message}`); }
}

await step('getPlanPrice() membaca harga dari env var, dan menolak paket yang harganya belum diatur', () => {
  const plan1 = getPlanPrice('1bulan');
  assert.ok(plan1, 'plan 1bulan seharusnya ditemukan');
  assert.strictEqual(plan1.price, 50000);
  assert.strictEqual(plan1.days, 30);

  const plan3 = getPlanPrice('3bulan');
  assert.strictEqual(plan3.price, 135000);
  assert.strictEqual(plan3.days, 90);

  assert.strictEqual(getPlanPrice('6bulan'), null, 'paket tanpa env var harga harus ditolak (null) -- SUBSCRIPTION_PRICE_6M sengaja dikosongkan di atas');
  assert.strictEqual(getPlanPrice('paket-ngasal'), null, 'key paket yang tidak dikenal harus ditolak (null)');
});

await step('verifySignature() menerima signature yang benar dan menolak yang salah/dipalsukan', () => {
  const serverKey = process.env.MIDTRANS_SERVER_KEY;
  const body = { order_id: 'LGN-PERPANJANGAN-123', status_code: '200', gross_amount: '50000.00' };
  const validSignature = crypto.createHash('sha512')
    .update(body.order_id + body.status_code + body.gross_amount + serverKey)
    .digest('hex');

  assert.strictEqual(verifySignature({ ...body, signature_key: validSignature }, serverKey), true, 'signature yang benar harus lolos');
  assert.strictEqual(verifySignature({ ...body, signature_key: 'signature-palsu-oleh-penyerang' }, serverKey), false, 'signature yang salah/dipalsukan harus ditolak');
  assert.strictEqual(verifySignature({ ...body, gross_amount: '999999.00', signature_key: validSignature }, serverKey), false, 'signature untuk nominal LAIN tidak boleh valid untuk nominal yang beda (mencegah pemalsuan nominal)');
  assert.strictEqual(verifySignature(null, serverKey), false, 'body kosong harus ditolak, bukan error');
  assert.strictEqual(verifySignature({ ...body, signature_key: validSignature }, ''), false, 'server key kosong harus ditolak, bukan lolos diam-diam');
});

await step('midtrans-create-transaction: menolak plan yang tidak dikenal, dan mengirim gross_amount+plan_days yang benar ke Midtrans+Supabase untuk plan yang valid', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), opts });
    if (String(url).includes('/rest/v1/payment_requests')) {
      return { ok: true, json: async () => ([{ id: 1 }]) };
    }
    if (String(url).includes('sandbox.midtrans.com')) {
      return { ok: true, json: async () => ({ redirect_url: 'https://app.sandbox.midtrans.com/snap/v3/fake-token' }) };
    }
    throw new Error('unexpected fetch to ' + url);
  };
  try {
    const badRes = await createTransactionHandler({ httpMethod: 'POST', body: JSON.stringify({ nama: 'Toko A', owner_id: 'owner-1', plan: 'paket-ngasal' }) });
    assert.strictEqual(badRes.statusCode, 400, 'plan tidak dikenal harus ditolak 400');

    const badRes2 = await createTransactionHandler({ httpMethod: 'POST', body: JSON.stringify({ nama: 'Toko A', owner_id: 'owner-1', plan: '6bulan' }) });
    assert.strictEqual(badRes2.statusCode, 400, 'plan yang belum diatur env var harganya (6bulan) juga harus ditolak 400');

    calls.length = 0;
    const okRes = await createTransactionHandler({ httpMethod: 'POST', body: JSON.stringify({ nama: 'Toko A', wa: '0812', owner_id: 'owner-1', plan: '1bulan' }) });
    assert.strictEqual(okRes.statusCode, 200, 'plan valid dengan harga terisi harus sukses: ' + okRes.body);
    const okBody = JSON.parse(okRes.body);
    assert.ok(okBody.redirect_url, 'harus mengembalikan redirect_url dari Midtrans');

    const insertCall = calls.find(c => c.url.includes('/rest/v1/payment_requests'));
    assert.ok(insertCall, 'harus insert ke payment_requests');
    const insertedBody = JSON.parse(insertCall.opts.body);
    assert.strictEqual(insertedBody.gross_amount, 50000, 'gross_amount yang disimpan harus sesuai harga paket 1 bulan');
    assert.strictEqual(insertedBody.plan_days, 30, 'plan_days yang disimpan harus 30 buat paket 1 bulan');

    const snapCall = calls.find(c => c.url.includes('sandbox.midtrans.com'));
    assert.ok(snapCall, 'harus memanggil Midtrans Snap API (sandbox, karena MIDTRANS_IS_PRODUCTION=false)');
    const snapBody = JSON.parse(snapCall.opts.body);
    assert.strictEqual(snapBody.transaction_details.gross_amount, 50000, 'gross_amount yang dikirim ke Midtrans harus sama dengan yang disimpan');
    assert.strictEqual(snapBody.transaction_details.order_id, okBody.order_id, 'order_id yang dikirim ke Midtrans harus sama dengan yang disimpan di payment_requests');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await step('midtrans-webhook: mengabaikan signature tidak valid, dan memperpanjang paid_until sesuai plan_days begitu status settlement diterima', async () => {
  const patches = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('payment_requests') && (!opts || !opts.method || opts.method === 'GET')) {
      return { ok: true, json: async () => ([{ id: 42, owner_id: 'owner-99', plan_days: 90 }]) };
    }
    if (u.includes('app_subscriptions') && (!opts || !opts.method || opts.method === 'GET')) {
      return { ok: true, json: async () => ([]) }; // belum ada baris app_subscriptions sebelumnya
    }
    if (u.includes('app_subscriptions') && opts && opts.method === 'POST') {
      patches.push({ table: 'app_subscriptions_insert', body: JSON.parse(opts.body) });
      return { ok: true, json: async () => ([{}]) };
    }
    if (u.includes('payment_requests') && opts && opts.method === 'PATCH') {
      patches.push({ table: 'payment_requests_patch', body: JSON.parse(opts.body) });
      return { ok: true, json: async () => ([{}]) };
    }
    throw new Error('unexpected fetch to ' + u + ' method=' + (opts && opts.method));
  };
  try {
    const serverKey = process.env.MIDTRANS_SERVER_KEY;
    const orderId = 'LGN-PERPANJANGAN-999';
    const statusCode = '200';
    const grossAmount = '135000.00';
    const validSig = crypto.createHash('sha512').update(orderId + statusCode + grossAmount + serverKey).digest('hex');

    // Signature dipalsukan -- tidak boleh memicu perpanjangan apa pun.
    patches.length = 0;
    const spoofedRes = await webhookHandler({ httpMethod: 'POST', body: JSON.stringify({ order_id: orderId, status_code: statusCode, gross_amount: grossAmount, signature_key: 'bukan-dari-midtrans', transaction_status: 'settlement' }) });
    assert.strictEqual(spoofedRes.statusCode, 200, spoofedRes.body); // tetap balas 200 (lihat komentar di kode), tapi TIDAK memproses apa pun
    assert.strictEqual(patches.length, 0, 'signature palsu tidak boleh memicu perubahan apa pun ke database');

    // Signature valid + status settlement -- harus memperpanjang 90 hari (plan_days dari payment_requests).
    patches.length = 0;
    const okRes = await webhookHandler({ httpMethod: 'POST', body: JSON.stringify({ order_id: orderId, status_code: statusCode, gross_amount: grossAmount, signature_key: validSig, transaction_status: 'settlement' }) });
    assert.strictEqual(okRes.statusCode, 200, okRes.body);
    const subInsert = patches.find(p => p.table === 'app_subscriptions_insert');
    assert.ok(subInsert, 'harus membuat baris app_subscriptions baru karena belum ada sebelumnya');
    assert.strictEqual(subInsert.body.status, 'aktif');
    assert.strictEqual(subInsert.body.owner_id, 'owner-99');
    const daysGranted = Math.round((new Date(subInsert.body.paid_until) - new Date()) / (24*60*60*1000));
    assert.ok(daysGranted >= 89 && daysGranted <= 90, 'paid_until harus sekitar 90 hari dari sekarang (plan_days=90), got ' + daysGranted);

    const reqPatch = patches.find(p => p.table === 'payment_requests_patch');
    assert.ok(reqPatch, 'payment_requests harus ditandai disetujui');
    assert.strictEqual(reqPatch.body.status, 'disetujui');

    // Status "pending"/belum bayar -- tidak boleh memproses apa pun.
    patches.length = 0;
    await webhookHandler({ httpMethod: 'POST', body: JSON.stringify({ order_id: orderId, status_code: statusCode, gross_amount: grossAmount, signature_key: validSig, transaction_status: 'pending' }) });
    assert.strictEqual(patches.length, 0, 'status "pending" (belum benar-benar bayar) tidak boleh memicu perpanjangan apa pun');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

console.log('\n--- summary ---');
console.log(errors.length ? errors.join('\n') : 'Semua test lulus.');
process.exit(errors.length ? 1 : 0);
