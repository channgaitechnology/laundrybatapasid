/* Helper BERSAMA (bukan endpoint sendiri -- awalan `_` sama seperti
 * _midtrans-plans.js, Netlify tidak mendaftarkan file berawalan `_` sebagai
 * function/endpoint publik) dipakai oleh notify-new-payment-request.js &
 * notify-new-account.js untuk kirim Web Push ke semua perangkat admin yang
 * sudah mengaktifkan notifikasi (lihat enableAdminPushNotif(), js/05-admin.js).
 *
 * Diekspos sebagai factory createPushSender(webpush, config) -- BUKAN
 * langsung require('web-push') + panggil di sini -- supaya test Node murni
 * (tests/test-push-notify-function.mjs) bisa suntik implementasi `webpush`
 * palsu tanpa perlu koneksi jaringan sungguhan ke layanan push Google/
 * Mozilla/dkk sama sekali.
 *
 * Query/hapus baris admin_push_subscriptions lewat REST Supabase + Service
 * Role Key (sama persis pola supabaseRest() di midtrans-webhook.js) --
 * BUKAN lewat RLS user biasa, karena fungsi ini jalan server-side tanpa
 * sesi login siapa pun.
 */
function createPushSender(webpush, config) {
  const { supabaseUrl, serviceRoleKey, vapidPublicKey, vapidPrivateKey, contactEmail } = config;

  async function supabaseRest(path, options) {
    const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        Prefer: 'return=representation',
        ...(options && options.headers),
      },
    });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  }

  /* payload: { title, body, url } -- dikirim terenkripsi oleh web-push,
     ditangkap balik oleh self.addEventListener('push', ...) di sw.js. */
  async function sendPushToAdmins(payload) {
    webpush.setVapidDetails(`mailto:${contactEmail}`, vapidPublicKey, vapidPrivateKey);
    const { ok, data: subs } = await supabaseRest('admin_push_subscriptions?select=endpoint,p256dh,auth', { method: 'GET' });
    if (!ok || !Array.isArray(subs) || subs.length === 0) return { sent: 0, removed: 0 };

    let sent = 0, removed = 0;
    await Promise.all(subs.map(async (row) => {
      try {
        await webpush.sendNotification(
          { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
          JSON.stringify(payload)
        );
        sent++;
      } catch (e) {
        // 404/410 = endpoint sudah tidak valid lagi (user uninstall/clear
        // data/dkk di sisi browser) -- bersihkan baris basi ini, SELAIN itu
        // (mis. error jaringan sesaat) diamkan saja, biarkan tetap tersimpan
        // untuk dicoba lagi di notifikasi berikutnya.
        console.error(
          '[push] sendNotification gagal, endpoint:', row.endpoint,
          'statusCode:', e && e.statusCode, 'body:', e && e.body, 'message:', e && e.message
        );
        if (e && (e.statusCode === 404 || e.statusCode === 410)) {
          await supabaseRest(`admin_push_subscriptions?endpoint=eq.${encodeURIComponent(row.endpoint)}`, { method: 'DELETE' });
          removed++;
        }
      }
    }));
    return { sent, removed };
  }

  return { sendPushToAdmins };
}

module.exports = { createPushSender };
