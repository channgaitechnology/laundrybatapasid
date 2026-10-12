/* Service worker minimal untuk Laundry Batapas.id.
 *
 * File ini sebelumnya TIDAK ADA sama sekali (index.html memanggil
 * navigator.serviceWorker.register('sw.js') tapi selalu gagal 404,
 * ditelan diam-diam oleh .catch(()=>{})). Instalasi PWA ("Add to Home
 * Screen" -> ikon standalone di layar) yang berjalan tanpa service worker
 * aktif cenderung diperlakukan browser sebagai app "kurang layak" secara
 * kualitas PWA, termasuk soal prioritas penyimpanan (localStorage tempat
 * sesi login Supabase disimpan) -- jadi kemungkinan salah satu penyebab
 * app minta login ulang terus meski baru ditutup sebentar.
 *
 * Strategi: network-first untuk semua request GET satu origin (HTML/JS/CSS/
 * ikon) -- SELALU coba jaringan dulu supaya rilis kode terbaru langsung
 * kepakai (tidak ada versi lama nyangkut di cache), cache cuma dipakai
 * sebagai cadangan kalau benar-benar offline. Request ke origin lain
 * (Supabase API, CDN library) SENGAJA tidak disentuh sama sekali -- biar
 * auth/login & panggilan API selalu langsung ke jaringan, tidak pernah
 * lewat cache ini.
 */
const CACHE_NAME = 'laundry-batapas-v9';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    /* cache:'reload' memaksa fetch ini benar-benar tembus ke jaringan (skip
       HTTP cache milik browser/WebView sendiri), bukan cuma mengandalkan
       header cache-control dari server -- beberapa WebView Android (dipakai
       PWA yang di-"Add to Home Screen") pernah kedapatan tetap menyajikan
       respons HTTP cache lokal meski server sudah kirim must-revalidate,
       kalau tab/app-nya tidak pernah benar-benar ditutup+dibuka ulang. */
    fetch(req, { cache: 'reload' })
      .then((res) => {
        // Cuma simpan respons SUKSES ke cache -- respons error (404/500 dkk)
        // yang ikut ter-cache bisa jadi fallback offline keliru sampai fetch
        // sukses berikutnya menimpanya.
        if (res.ok) {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});

/* Khusus Admin Platform (ADMIN_EMAILS) -- lihat enableAdminPushNotif()/
   js/05-admin.js & netlify/functions/_web-push-send.js. Payload JSON dikirim
   server (bentuknya { title, body, url }) -- tampilkan sebagai notifikasi OS
   (muncul + berbunyi walau tab app sedang tertutup), beda dari badge lonceng
   dalam app yang cuma kelihatan selagi tab terbuka. */
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {}
  const title = data.title || 'Dokter Laundry';
  const options = {
    body: data.body || '',
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

/* Klik notifikasi -> fokus ke tab app yang sudah terbuka kalau ada (jangan
   buka tab baru lagi di atas tab yang sudah ada), baru buka tab baru kalau
   belum ada sama sekali. */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
      const existing = clientsArr.find((c) => c.url.includes(self.location.origin));
      if (existing) return existing.focus();
      return self.clients.openWindow(url);
    })
  );
});
