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
const CACHE_NAME = 'laundry-batapas-v1';

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
    fetch(req)
      .then((res) => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
        return res;
      })
      .catch(() => caches.match(req))
  );
});
