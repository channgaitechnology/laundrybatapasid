/* Netlify Function: dipicu oleh Database Webhook Supabase KEDUA (terpisah
 * dari notify-new-payment-request.js) setiap kali ada baris BARU masuk ke
 * app_subscriptions -- yaitu toko baru mendaftar, TRIAL ORGANIK (tanpa
 * kode admin) MAUPUN langsung aktif lewat kode admin (lihat
 * ensureAppSubscription()/js/03-langganan.js dan
 * claim_registration_code_and_activate()/js/02-init-data.js). Trial
 * organik SEBELUMNYA tidak memicu notifikasi apa pun sama sekali -- admin
 * cuma tahu ada toko baru kalau sempat buka Admin Platform manual.
 *
 * BEDA dari notify-new-payment-request.js: fungsi ini CUMA kirim Web Push
 * (tidak ada email) -- lihat enableAdminPushNotif()/js/05-admin.js untuk
 * cara admin mengaktifkan penerima push. Trial signup organik bisa lebih
 * sering terjadi & kurang mendesak dibanding payment_requests (yang
 * memang butuh admin approve/tolak), jadi tidak perlu dobel-dobel lewat
 * email pula.
 *
 * Header rahasia & cara daftar webhook SAMA seperti
 * notify-new-payment-request.js (lihat README) -- pakai env var
 * PAYMENT_WEBHOOK_SECRET yang SAMA (sengaja tidak buat rahasia baru lagi),
 * didaftarkan sebagai Database Webhook KEDUA di Supabase khusus tabel
 * app_subscriptions, event Insert saja.
 *
 * Env var yang dibutuhkan (lihat README bagian "Lonceng Notifikasi Admin
 * Platform"):
 * - PAYMENT_WEBHOOK_SECRET      : sama seperti notify-new-payment-request.js.
 * - VAPID_PUBLIC_KEY/PRIVATE_KEY: pasangan kunci Web Push aplikasi ini.
 * - SUPABASE_URL/SERVICE_ROLE_KEY: dipakai baca admin_push_subscriptions
 *   DAN lookup nama toko dari tabel settings (lewat Service Role Key,
 *   bukan RLS user biasa -- fungsi ini jalan server-side tanpa sesi login).
 * - ADMIN_NOTIFY_EMAIL          : dipakai sebagai kontak VAPID (mailto:),
 *   BUKAN buat kirim email -- fungsi ini tidak kirim email sama sekali.
 *
 * Beda dari notify-new-payment-request.js, fungsi INI isinya cuma push --
 * kalau konfigurasinya belum lengkap, balas 500 (bukan diam-diam sukses
 * tanpa notifikasi apa pun) supaya ketahuan dari log Netlify kalau ada
 * yang belum diisi.
 */
const PAYMENT_WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET;
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_NOTIFY_EMAIL = process.env.ADMIN_NOTIFY_EMAIL;

/* Nama toko ada di tabel settings (bukan app_subscriptions), jadi butuh
   lookup terpisah supaya notifikasinya tidak cuma bilang "ada toko baru"
   tanpa identitas apa-apa. Best-effort -- gagal lookup TIDAK menggagalkan
   notifikasi, cuma tampil tanpa nama. */
async function lookupShopName(ownerId) {
  if (!ownerId) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/settings?user_id=eq.${encodeURIComponent(ownerId)}&select=shop_name`, {
      headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
    });
    const data = await res.json().catch(() => null);
    return (Array.isArray(data) && data[0] && data[0].shop_name) || null;
  } catch (e) {
    return null;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }
  if (!PAYMENT_WEBHOOK_SECRET || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return { statusCode: 500, body: 'Konfigurasi server belum lengkap' };
  }

  const headers = event.headers || {};
  const gotSecret = headers['x-webhook-secret'] || headers['X-Webhook-Secret'];
  if (gotSecret !== PAYMENT_WEBHOOK_SECRET) {
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

  const shopName = await lookupShopName(row.owner_id);
  const statusLabel = row.status === 'aktif' ? 'aktif (lewat kode)' : 'trial';

  try {
    const webpush = require('web-push');
    const { createPushSender } = require('./_web-push-send');
    const pushSender = createPushSender(webpush, {
      supabaseUrl: SUPABASE_URL, serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
      vapidPublicKey: VAPID_PUBLIC_KEY, vapidPrivateKey: VAPID_PRIVATE_KEY, contactEmail: ADMIN_NOTIFY_EMAIL,
    });
    // url `/?adminNotif=1` -- lihat komentar sama di notify-new-payment-request.js,
    // membuka panel Admin Platform langsung saat notifikasi diklik.
    const result = await pushSender.sendPushToAdmins({
      title: '🔔 Akun Toko Baru Terdaftar',
      body: shopName ? `${shopName} — ${statusLabel}` : `Toko baru — ${statusLabel}`,
      url: '/?adminNotif=1',
    });
    console.log('[push] notify-new-account:', JSON.stringify(result));
  } catch (e) {
    return { statusCode: 502, body: `Gagal mengirim push: ${(e && e.message) || e}` };
  }

  return { statusCode: 200, body: 'ok' };
};
