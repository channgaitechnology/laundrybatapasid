/* Daftar paket langganan + berapa hari yang didapat + nama env var harganya.
 * Dipakai bersama oleh midtrans-create-transaction.js dan midtrans-webhook.js
 * (webhook baca `plan_days` yang disimpan di baris payment_requests, bukan
 * dari sini langsung -- ini cuma sumber kebenaran harga & durasi saat
 * transaksi dibuat).
 *
 * Harga diatur lewat env var di Netlify (Site settings -> Environment
 * variables), BUKAN di-hardcode di sini, supaya bisa diubah tanpa perlu
 * ubah kode:
 *   SUBSCRIPTION_PRICE_1M   (mis. "50000")
 *   SUBSCRIPTION_PRICE_3M   (mis. "135000")
 *   SUBSCRIPTION_PRICE_6M   (mis. "240000")
 *   SUBSCRIPTION_PRICE_12M  (mis. "420000")
 */
const PLANS = {
  '1bulan': { days: 30, envVar: 'SUBSCRIPTION_PRICE_1M', label: '1 Bulan' },
  '3bulan': { days: 90, envVar: 'SUBSCRIPTION_PRICE_3M', label: '3 Bulan' },
  '6bulan': { days: 180, envVar: 'SUBSCRIPTION_PRICE_6M', label: '6 Bulan' },
  '12bulan': { days: 365, envVar: 'SUBSCRIPTION_PRICE_12M', label: '12 Bulan' },
};

function getPlanPrice(planKey) {
  const plan = PLANS[planKey];
  if (!plan) return null;
  const price = Number(process.env[plan.envVar] || 0);
  if (!price) return null;
  return { key: planKey, days: plan.days, label: plan.label, price };
}

module.exports = { PLANS, getPlanPrice };
