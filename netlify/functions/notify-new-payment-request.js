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
 *
 * Env var TAMBAHAN (opsional -- lihat README bagian "Lonceng Notifikasi
 * Admin Platform", Web Push): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
 * SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. Kalau salah satu belum diisi,
 * fungsi ini TETAP jalan seperti biasa (cuma email, tanpa push) -- push
 * SENGAJA best-effort, gagal/belum disetel TIDAK BOLEH menggagalkan email
 * yang sudah berhasil terkirim.
 */
const { verifyWebhookSecret } = require('./_verify-webhook-secret');

const PAYMENT_WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const ADMIN_NOTIFY_EMAIL = process.env.ADMIN_NOTIFY_EMAIL;
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function escapeHtml(s) {
  return String(s || '-').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function sendPushBestEffort(title, body) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    // require() DI SINI (bukan di atas file) SENGAJA -- supaya kalau
    // 'web-push' entah kenapa gagal ter-install/ter-bundle (lihat
    // netlify/functions/package.json), yang rusak cuma jalur push ini
    // (ditangkap try/catch ini), BUKAN seluruh fungsi notifikasi email yang
    // sudah berjalan baik sebelum fitur push ini ada.
    const webpush = require('web-push');
    const { createPushSender } = require('./_web-push-send');
    const pushSender = createPushSender(webpush, {
      supabaseUrl: SUPABASE_URL, serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
      vapidPublicKey: VAPID_PUBLIC_KEY, vapidPrivateKey: VAPID_PRIVATE_KEY, contactEmail: ADMIN_NOTIFY_EMAIL,
    });
    // url `/?adminNotif=1` (BUKAN cuma '/') -- ditangkap js/05-admin.js
    // (initUserData() utk tab baru, listener 'message' dari sw.js utk tab
    // yang sudah terbuka) supaya klik notifikasi langsung membuka panel
    // Admin Platform (openAdminNotifPanel()), bukan cuma buka app ke layar
    // biasa lalu admin harus cari-cari menunya sendiri.
    const result = await pushSender.sendPushToAdmins({ title, body, url: '/?adminNotif=1' });
    console.log('[push] notify-new-payment-request:', JSON.stringify(result));
  } catch (e) {
    // TETAP diamkan dari sisi pemanggil (lihat komentar env var tambahan di
    // atas) -- tapi dicatat ke Netlify Function Logs supaya gagalnya push
    // tidak lagi jadi misteri (sebelumnya catch ini kosong total).
    console.error('[push] notify-new-payment-request gagal:', e && (e.stack || e.message || e));
  }
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
  if (!verifyWebhookSecret(gotSecret, PAYMENT_WEBHOOK_SECRET)) {
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
      from: 'Dokter Laundry <onboarding@resend.dev>',
      to: [ADMIN_NOTIFY_EMAIL],
      subject,
      html,
    }),
  });

  await sendPushBestEffort(subject, `${row.nama || '-'} — ${row.wa || '-'}`);

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    return { statusCode: 502, body: `Gagal mengirim email: ${errBody}` };
  }

  return { statusCode: 200, body: 'ok' };
};
