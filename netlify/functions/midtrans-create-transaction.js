/* Netlify Function: bikin transaksi Midtrans Snap buat perpanjangan langganan
 * aplikasi (owner_id sudah ada -- pemilik toko sedang login). Dipanggil dari
 * payViaMidtrans() di js/03-langganan.js lewat fetch biasa (bukan
 * sb.functions.invoke(), itu khusus Supabase Edge Functions).
 *
 * Kenapa ini WAJIB lewat server (bukan langsung dari browser ke API
 * Midtrans): MIDTRANS_SERVER_KEY rahasia harus dipakai buat autentikasi ke
 * Midtrans -- kalau ditaruh di kode browser, siapa saja bisa buka DevTools
 * dan mencurinya buat bikin transaksi palsu atas nama toko kita.
 *
 * Env var yang wajib diisi di Netlify (Site settings -> Environment variables):
 *   MIDTRANS_SERVER_KEY     - Server Key dari dashboard Midtrans (Sandbox/Production)
 *   MIDTRANS_IS_PRODUCTION  - "true" kalau sudah pakai Server Key Production, selain itu Sandbox
 *   SUBSCRIPTION_PRICE_1M/3M/6M/12M - harga tiap paket, lihat _midtrans-plans.js
 *   SUPABASE_URL            - URL project Supabase (yang sama dipakai index.html)
 *   SUPABASE_SERVICE_ROLE_KEY - Service Role key Supabase (BUKAN anon key -- lihat
 *                                Project Settings -> API di dashboard Supabase),
 *                                dipakai supaya function ini bisa menulis ke
 *                                payment_requests walau tidak ada sesi login
 *                                pengguna di request ini.
 */
const { getPlanPrice } = require('./_midtrans-plans');

const MIDTRANS_SERVER_KEY = process.env.MIDTRANS_SERVER_KEY;
const MIDTRANS_IS_PRODUCTION = process.env.MIDTRANS_IS_PRODUCTION === 'true';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SNAP_URL = MIDTRANS_IS_PRODUCTION
  ? 'https://app.midtrans.com/snap/v1/transactions'
  : 'https://app.sandbox.midtrans.com/snap/v1/transactions';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }
  if (!MIDTRANS_SERVER_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Konfigurasi server belum lengkap (env var Midtrans/Supabase belum diisi)' }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Body request tidak valid' }) };
  }

  const nama = String(payload.nama || '').trim();
  const wa = String(payload.wa || '').trim();
  const ownerId = String(payload.owner_id || '').trim();
  const plan = getPlanPrice(String(payload.plan || ''));
  if (!nama || !ownerId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'nama dan owner_id wajib diisi' }) };
  }
  if (!plan) {
    return { statusCode: 400, body: JSON.stringify({ error: 'plan tidak dikenali atau harganya belum diatur di env var' }) };
  }

  const orderId = `LGN-PERPANJANGAN-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Simpan payment_requests dulu (status "menunggu") -- webhook nanti mencocokkan
  // pembayaran yang masuk ke baris ini lewat order_id, dan baca plan_days dari
  // sini buat tahu berapa hari yang harus ditambahkan.
  const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/payment_requests`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      nama, wa, status: 'menunggu', type: 'perpanjangan', owner_id: ownerId,
      catatan: `Perpanjangan otomatis via Midtrans (${plan.label})`,
      order_id: orderId, gross_amount: plan.price, plan_days: plan.days,
    }),
  });
  if (!insertRes.ok) {
    const detail = await insertRes.text();
    return { statusCode: 502, body: JSON.stringify({ error: 'Gagal menyimpan permintaan pembayaran', detail }) };
  }

  const snapRes = await fetch(SNAP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Basic ${Buffer.from(MIDTRANS_SERVER_KEY + ':').toString('base64')}`,
    },
    body: JSON.stringify({
      transaction_details: { order_id: orderId, gross_amount: plan.price },
      customer_details: { first_name: nama, phone: wa || undefined },
    }),
  });
  const snapData = await snapRes.json().catch(() => ({}));
  if (!snapRes.ok || !snapData.redirect_url) {
    return { statusCode: 502, body: JSON.stringify({ error: 'Gagal membuat transaksi Midtrans', detail: snapData }) };
  }

  return { statusCode: 200, body: JSON.stringify({ redirect_url: snapData.redirect_url, order_id: orderId }) };
};
