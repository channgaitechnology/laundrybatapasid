/* Netlify Function: menerima notifikasi (webhook) dari Midtrans begitu status
 * pembayaran berubah, lalu -- HANYA kalau tanda tangannya valid dan status
 * transaksinya benar-benar sukses -- memperpanjang app_subscriptions 30 hari
 * dan menandai payment_requests jadi "disetujui". Ini pengganti klik manual
 * admin di Admin Platform -> "Setujui" (lihat approveRenewalRequest() di
 * js/05-admin.js), khusus untuk pembayaran yang lewat Midtrans.
 *
 * WAJIB verifikasi signature_key sebelum mempercayai body request ini --
 * endpoint ini publik (URL-nya didaftarkan di dashboard Midtrans), jadi
 * siapa saja di internet bisa mengirim POST ke sini berpura-pura jadi
 * Midtrans. signature_key = SHA512(order_id + status_code + gross_amount +
 * ServerKey) yang HANYA bisa dihitung benar oleh pihak yang tahu ServerKey
 * kita (lihat dokumentasi resmi Midtrans soal notifikasi transaksi).
 *
 * Env var yang dibutuhkan -- sama seperti midtrans-create-transaction.js,
 * lihat komentar di file itu.
 */
const crypto = require('crypto');

const MIDTRANS_SERVER_KEY = process.env.MIDTRANS_SERVER_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function verifySignature(body, serverKey) {
  if (!body || !serverKey) return false;
  const expected = crypto
    .createHash('sha512')
    .update(String(body.order_id) + String(body.status_code) + String(body.gross_amount) + serverKey)
    .digest('hex');
  // Bandingkan pakai timingSafeEqual (bukan ===) -- jaga-jaga terhadap timing
  // attack (durasi perbandingan string biasa bisa sedikit bocorkan di
  // karakter mana perbedaannya terjadi). timingSafeEqual WAJIB panjang buffer
  // sama, jadi cek panjang dulu (aman -- SHA512 hex selalu tepat 128 karakter,
  // bukan info yang bisa dimanfaatkan penyerang).
  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(String(body.signature_key || ''), 'utf8');
  if (expectedBuf.length !== providedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

async function supabaseRest(path, options) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: 'return=representation',
      ...(options && options.headers),
    },
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }
  if (!MIDTRANS_SERVER_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return { statusCode: 500, body: 'Konfigurasi server belum lengkap' };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: 'Body tidak valid' };
  }

  if (!verifySignature(body, MIDTRANS_SERVER_KEY)) {
    // Sengaja balas 200 (bukan 401/403) -- kalau balas error, Midtrans akan
    // terus mencoba ulang notifikasi yang sama, padahal ini kemungkinan besar
    // percobaan spoofing, bukan gangguan jaringan sungguhan.
    return { statusCode: 200, body: 'signature tidak valid, diabaikan' };
  }

  const isSuccess = (body.transaction_status === 'capture' || body.transaction_status === 'settlement')
    && (body.fraud_status === undefined || body.fraud_status === 'accept');
  if (!isSuccess) {
    return { statusCode: 200, body: `status "${body.transaction_status}" belum sukses, diabaikan` };
  }

  const now = new Date();
  // KLAIM atomik -- satu statement UPDATE bersyarat status='menunggu' ini
  // SEKALIGUS jadi "cari baris" dan "kunci baris supaya tidak diproses 2x",
  // menggantikan pola lama (GET cek status, baru PATCH di akhir) yang
  // rawan race condition: Midtrans bisa mengirim notifikasi yang sama lebih
  // dari sekali (retry), dan approveRenewalRequest() di js/05-admin.js bisa
  // saja diklik admin di waktu yang berdekatan untuk payment_request yang
  // sama -- Postgres menjamin cuma SATU pemanggil yang berhasil mengubah
  // baris dengan status='menunggu' itu; pemanggil lain (telat sepersekian
  // detik) akan melihat baris sudah bukan 'menunggu' lagi dan dapat array
  // kosong, lalu berhenti SEBELUM sempat menyentuh app_subscriptions sama
  // sekali -- mencegah paid_until diperpanjang dobel dari 1 pembayaran.
  const claimed = await supabaseRest(
    `payment_requests?order_id=eq.${encodeURIComponent(body.order_id)}&status=eq.menunggu`,
    { method: 'PATCH', body: JSON.stringify({ status: 'disetujui', paid_at: now.toISOString() }) }
  );
  const req = claimed.ok && Array.isArray(claimed.data) ? claimed.data[0] : null;
  if (!req) {
    // Sudah diproses sebelumnya (notifikasi Midtrans bisa terkirim lebih dari
    // sekali untuk transaksi yang sama, atau admin sudah klik approve manual
    // duluan), atau order_id memang tidak dikenal.
    return { statusCode: 200, body: 'payment_request tidak ditemukan/sudah diproses, diabaikan' };
  }

  const subRes = await supabaseRest(`app_subscriptions?owner_id=eq.${encodeURIComponent(req.owner_id)}&select=*`, { method: 'GET' });
  const existing = subRes.ok && Array.isArray(subRes.data) ? subRes.data[0] : null;
  const base = (existing && existing.paid_until && new Date(existing.paid_until) > now) ? new Date(existing.paid_until) : now;
  const planDays = Number(req.plan_days) || 30; // fallback 30 hari kalau baris lama sebelum kolom ini ada
  const newPaidUntil = new Date(base.getTime() + planDays * 24 * 60 * 60 * 1000).toISOString();

  if (existing) {
    await supabaseRest(`app_subscriptions?owner_id=eq.${encodeURIComponent(req.owner_id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'aktif', paid_until: newPaidUntil }),
    });
  } else {
    await supabaseRest('app_subscriptions', {
      method: 'POST',
      body: JSON.stringify({ owner_id: req.owner_id, status: 'aktif', trial_ends_at: now.toISOString(), paid_until: newPaidUntil }),
    });
  }

  // Sama seperti approveRenewalRequest() (js/05-admin.js) -- ini titik
  // "pembayaran benar-benar terjadi" buat akun yang mungkin daftar pakai
  // kode referral orang lain (lihat README, Program Referral). RPC ini
  // no-op kalau baris app_subscriptions akun ini tidak punya
  // referred_by_owner_id yang belum diklaim.
  await supabaseRest('rpc/apply_referral_bonus_if_pending', {
    method: 'POST',
    body: JSON.stringify({ p_owner_id: req.owner_id }),
  });

  return { statusCode: 200, body: 'ok' };
};

exports.verifySignature = verifySignature;
