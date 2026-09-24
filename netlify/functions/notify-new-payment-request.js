/* Netlify Function: dipicu oleh Database Webhook Supabase setiap kali ada
 * baris BARU masuk ke payment_requests (pendaftaran akun baru ATAU
 * perpanjangan manual) -- kirim email ke admin supaya tidak perlu buka
 * Admin Platform berulang-ulang cuma untuk cek ada permintaan baru atau
 * belum. Ini murni notifikasi, TIDAK mengubah data apa pun -- approve/
 * tolak tetap manual lewat Admin Platform seperti biasa (lihat
 * approvePaymentRequest()/approveRenewalRequest() di js/05-admin.js).
 *
 * WAJIB verifikasi header rahasia sebelum memproses -- endpoint ini publik
 * (URL-nya didaftarkan di dashboard Supabase sebagai target webhook), jadi
 * siapa saja di internet bisa POST ke sini berpura-pura jadi Supabase.
 * Supabase Database Webhooks bisa disetel mengirim HTTP header custom --
 * cocokkan nilainya dengan PAYMENT_WEBHOOK_SECRET di sini, tolak kalau
 * tidak cocok.
 *
 * Env var yang dibutuhkan (lihat README bagian "Notifikasi Email"):
 * - PAYMENT_WEBHOOK_SECRET : nilai rahasia bebas (buat sendiri, string
 *   acak), HARUS sama persis dengan header yang disetel di konfigurasi
 *   webhook Supabase.
 * - RESEND_API_KEY         : API key dari resend.com (gratis, TIDAK perlu
 *   verifikasi domain -- asal kirim ke alamat email akun Resend sendiri).
 * - ADMIN_NOTIFY_EMAIL     : alamat email admin yang mau terima notifikasi
 *   -- harus alamat yang SAMA dipakai daftar akun Resend (syarat gratisan
 *   Resend: tanpa domain terverifikasi, cuma boleh kirim ke email akun
 *   sendiri).
 */
const PAYMENT_WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const ADMIN_NOTIFY_EMAIL = process.env.ADMIN_NOTIFY_EMAIL;

function escapeHtml(s) {
  return String(s || '-').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }
  if (!PAYMENT_WEBHOOK_SECRET || !RESEND_API_KEY || !ADMIN_NOTIFY_EMAIL) {
    return { statusCode: 500, body: 'Konfigurasi server belum lengkap' };
  }

  const headers = event.headers || {};
  const gotSecret = headers['x-webhook-secret'] || headers['X-Webhook-Secret'];
  if (gotSecret !== PAYMENT_WEBHOOK_SECRET) {
    // Sengaja balas 401 (bukan diam-diam 200) -- beda dari webhook Midtrans,
    // di sini tidak ada risiko "retry storm" karena Supabase Database
    // Webhooks tidak mengulang notifikasi gagal sekencang Midtrans.
    return { statusCode: 401, body: 'Tidak diizinkan' };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: 'Body tidak valid' };
  }

  const row = payload.record;
  if (!row) {
    return { statusCode: 400, body: 'Payload tidak berisi record' };
  }

  const isRenewal = row.type === 'perpanjangan';
  const subject = isRenewal
    ? `🔔 Permintaan Perpanjangan Baru — ${row.nama || '-'}`
    : `🔔 Pendaftaran Baru — ${row.nama || '-'}`;
  const html = `
    <p>Ada permintaan <b>${isRenewal ? 'perpanjangan langganan' : 'pendaftaran akun baru'}</b> yang menunggu persetujuan:</p>
    <ul>
      <li><b>Nama:</b> ${escapeHtml(row.nama)}</li>
      <li><b>WhatsApp:</b> ${escapeHtml(row.wa)}</li>
      <li><b>Catatan:</b> ${escapeHtml(row.catatan)}</li>
    </ul>
    <p>Buka menu <b>Pengaturan → Admin Platform</b> di aplikasi untuk menyetujui atau menolak.</p>
  `;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: 'Laundry Assistant <onboarding@resend.dev>',
      to: [ADMIN_NOTIFY_EMAIL],
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    return { statusCode: 502, body: `Gagal mengirim email: ${errBody}` };
  }

  return { statusCode: 200, body: 'ok' };
};
