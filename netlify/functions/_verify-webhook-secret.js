/* Helper BERSAMA (bukan endpoint sendiri -- awalan `_` sama seperti
 * _midtrans-plans.js/_web-push-send.js) dipakai oleh notify-new-payment-request.js
 * & notify-new-account.js untuk cek header X-Webhook-Secret.
 *
 * REGRESI KEAMANAN (audit 13 Okt 2026): dulu kedua file itu bandingkan
 * header vs PAYMENT_WEBHOOK_SECRET pakai `!==` (perbandingan string biasa)
 * -- beda waktu eksekusinya bisa sedikit bocorkan di karakter mana
 * ketidakcocokan terjadi (timing attack), walau butuh BANYAK sekali
 * percobaan lewat internet publik untuk benar-benar dieksploitasi. Sekarang
 * konsisten dengan pola yang sudah benar di midtrans-webhook.js:
 * crypto.timingSafeEqual() + cek panjang dulu (timingSafeEqual sendiri
 * WAJIB panjang buffer sama, jadi harus dicek manual dulu -- membandingkan
 * dua secret dengan panjang beda itu sendiri bukan info berharga buat
 * penyerang, cuma supaya tidak langsung throw).
 */
const crypto = require('crypto');

function verifyWebhookSecret(providedSecret, expectedSecret) {
  if (!expectedSecret) return false;
  const expectedBuf = Buffer.from(String(expectedSecret), 'utf8');
  const providedBuf = Buffer.from(String(providedSecret || ''), 'utf8');
  if (expectedBuf.length !== providedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

module.exports = { verifyWebhookSecret };
