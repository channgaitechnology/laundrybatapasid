/* Service worker untuk Laundry Batapas.id.
 *
 * Riwayat singkat: file ini awalnya TIDAK ADA sama sekali (index.html
 * memanggil navigator.serviceWorker.register('sw.js') tapi selalu gagal
 * 404, ditelan diam-diam oleh .catch(()=>{})). Instalasi PWA ("Add to Home
 * Screen") yang berjalan tanpa service worker aktif cenderung diperlakukan
 * browser sebagai app "kurang layak" secara kualitas PWA, termasuk soal
 * prioritas penyimpanan (localStorage tempat sesi login Supabase disimpan)
 * -- jadi kemungkinan salah satu penyebab app minta login ulang terus
 * meski baru ditutup sebentar.
 *
 * MODE OFFLINE (Tahap 1): app harus bisa DIBUKA tanpa internet. Tiga hal
 * yang dibutuhkan, dan ketiganya ditangani di sini:
 *
 * 1. APP SHELL (index.html + semua js/*.js + manifest + ikon, satu origin)
 *    di-precache saat service worker diinstal, lalu diperbarui tiap
 *    request sukses. Strateginya TETAP network-first -- SELALU coba
 *    jaringan dulu supaya rilis kode terbaru langsung kepakai (tidak ada
 *    versi lama nyangkut) -- cache cuma jadi cadangan kalau jaringan gagal
 *    ATAU tidak menjawab dalam NETWORK_TIMEOUT_MS (sinyal "ada tapi macet",
 *    umum di HP; tanpa batas waktu ini app menggantung berdetik-detik
 *    menunggu jaringan yang tidak akan menjawab padahal salinan lokalnya
 *    ada). Request yang kalah cepat tetap dilanjutkan di latar belakang
 *    supaya cache terisi versi terbaru untuk pembukaan berikutnya.
 *
 * 2. PUSTAKA CDN (supabase-js, jsPDF, html2canvas -- semuanya dipin ke
 *    versi tertentu) dan Google Fonts: tanpa ini halaman tidak punya
 *    `supabase` sama sekali saat offline (const sb = supabase.createClient
 *    di js/00-globals.js langsung error). Versi dipin => aman cache-first.
 *    Font dipakai stale-while-revalidate.
 *
 * 3. NAVIGASI (membuka app dari ikon layar / alamat) jatuh ke index.html
 *    tersimpan kalau jaringan tidak ada.
 *
 * Yang SENGAJA tidak disentuh: request ke Supabase API/Auth (supabase.co)
 * dan Netlify Functions (/.netlify/) -- auth & panggilan data selalu
 * langsung ke jaringan, tidak pernah lewat cache ini.
 *
 * Kalau menambah/menghapus berkas di js/ atau mengganti versi pustaka CDN
 * di index.html, SESUAIKAN APP_SHELL / CDN_ASSETS di bawah dan NAIKKAN
 * CACHE_NAME.
 */
const CACHE_NAME = 'laundry-batapas-v11';
/* Cache CDN terpisah: isinya pustaka dengan versi dipin, tidak perlu ikut
   dibuang tiap CACHE_NAME dinaikkan (hemat unduhan ulang ~600 KB). Naikkan
   suffix-nya HANYA kalau URL pustaka di index.html berubah. */
const CDN_CACHE = 'laundry-batapas-cdn-v1';
const KEEP_CACHES = [CACHE_NAME, CDN_CACHE];
const NETWORK_TIMEOUT_MS = 6000;

const APP_SHELL = [
  './',
  'index.html',
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/logo-auth.png',
  'js/00-globals.js',
  'js/01-auth.js',
  'js/02-init-data.js',
  'js/03-langganan.js',
  'js/04-tutorial.js',
  'js/05-admin.js',
  'js/06-outlet.js',
  'js/07-katalog.js',
  'js/08-paket.js',
  'js/09-utils.js',
  'js/10-nota-cetak.js',
  'js/11-kontak.js',
  'js/12-transaksi.js',
  'js/13-riwayat-edit.js',
  'js/14-pengeluaran.js',
  'js/15-nota-receipt.js',
  'js/16-riwayat.js',
  'js/17-papan-laundry.js',
  'js/18-laporan.js',
  'js/19-settings.js',
  'js/20-catatan.js',
  'js/21-i18n.js',
  'js/22-rekap-pelanggan.js',
  'js/23-unduhan.js',
  'js/24-offline.js',
];

/* HARUS persis sama dengan <script src="https://cdn.jsdelivr.net/..."> di
   index.html (termasuk versinya), karena cache dicocokkan lewat URL. */
const CDN_ASSETS = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.4',
  'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
  'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js',
];
const CDN_HOSTS = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];
/* CSS font bisa berubah di sisi Google (file font-nya tidak) -- cuma ini
   yang perlu diperbarui di latar belakang; pustaka JS dipin, cukup cache-first. */
const REVALIDATE_HOSTS = ['fonts.googleapis.com'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil((async () => {
    /* allSettled, BUKAN addAll: addAll gagal TOTAL kalau satu berkas gagal
       diunduh (mis. satu ikon 404), padahal sisanya tetap berguna. */
    const cache = await caches.open(CACHE_NAME);
    await Promise.allSettled(APP_SHELL.map(async (path) => {
      const res = await fetch(new Request(path, { cache: 'reload' }));
      if (res.ok) await cache.put(path, res);
    }));
    const cdn = await caches.open(CDN_CACHE);
    await Promise.allSettled(CDN_ASSETS.map(async (url) => {
      if (await cdn.match(url)) return;
      /* no-cors karena <script src> lintas-origin tanpa atribut crossorigin
         memang meminta dengan mode itu; hasilnya "opaque" (status 0) dan
         tidak lolos cache.add() -- makanya put() manual. */
      const res = await fetch(url, { mode: 'no-cors' });
      if (res.ok || res.type === 'opaque') await cdn.put(url, res);
    }));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !KEEP_CACHES.includes(k)).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

/* Cari salinan lokal untuk request yang gagal ke jaringan. Navigasi yang
   tidak punya salinan persis (mis. /?adminNotif=1 atau alamat lain di
   origin ini) jatuh ke index.html, karena app ini satu halaman. */
async function matchOffline(cache, req) {
  const exact = await cache.match(req);
  if (exact) return exact;
  const loose = await cache.match(req, { ignoreSearch: true });
  if (loose) return loose;
  if (req.mode === 'navigate') {
    return (await cache.match('./')) || (await cache.match('index.html')) || null;
  }
  return null;
}

async function handleSameOrigin(req) {
  const cache = await caches.open(CACHE_NAME);
  /* cache:'reload' memaksa fetch ini benar-benar tembus ke jaringan (skip
     HTTP cache milik browser/WebView sendiri), bukan cuma mengandalkan
     header cache-control dari server -- beberapa WebView Android (dipakai
     PWA yang di-"Add to Home Screen") pernah kedapatan tetap menyajikan
     respons HTTP cache lokal meski server sudah kirim must-revalidate,
     kalau tab/app-nya tidak pernah benar-benar ditutup+dibuka ulang. */
  const networkPromise = fetch(req, { cache: 'reload' }).then((res) => {
    // Cuma simpan respons SUKSES ke cache -- respons error (404/500 dkk)
    // yang ikut ter-cache bisa jadi fallback offline keliru sampai fetch
    // sukses berikutnya menimpanya.
    if (res.ok) cache.put(req, res.clone()).catch(() => {});
    return res;
  });
  networkPromise.catch(() => {}); // cegah "unhandled rejection" kalau kalah balapan

  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('network-timeout')), NETWORK_TIMEOUT_MS);
  });
  try {
    const res = await Promise.race([networkPromise, timeout]);
    clearTimeout(timer);
    return res;
  } catch (e) {
    clearTimeout(timer);
    const cached = await matchOffline(cache, req);
    if (cached) return cached;
    // Tidak ada salinan lokal sama sekali: tunggu jaringan apa adanya
    // (perilaku lama) -- kalau memang gagal, browser yang menampilkan errornya.
    return networkPromise;
  }
}

async function handleCdn(event, req, url) {
  const cache = await caches.open(CDN_CACHE);
  const hit = await cache.match(req);
  const refresh = () => fetch(req).then((res) => {
    if (res.ok || res.type === 'opaque') cache.put(req, res.clone()).catch(() => {});
    return res;
  });
  if (hit) {
    if (REVALIDATE_HOSTS.includes(url.hostname)) {
      event.waitUntil(refresh().catch(() => {}));
    }
    return hit;
  }
  return refresh();
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith('/.netlify/')) return;
    event.respondWith(handleSameOrigin(req));
    return;
  }
  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(handleCdn(event, req, url));
  }
  // origin lain (Supabase API/Auth dll) sengaja tidak disentuh.
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
   belum ada sama sekali. Tab yang SUDAH terbuka SENGAJA tidak di-reload
   (existing.navigate() akan reset seluruh state SPA di memori) -- kirim
   postMessage() supaya js/05-admin.js (listener 'message') yang membuka
   panel Admin Platform (openAdminNotifPanel()) sendiri, sama seperti klik
   ikon lonceng dalam app. Tab BARU (belum ada sama sekali) baru pakai `url`
   (berisi query `?adminNotif=1`) -- ditangkap initUserData() setelah login
   selesai. */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
      const existing = clientsArr.find((c) => c.url.includes(self.location.origin));
      if (existing) {
        existing.postMessage({ type: 'nk-push-click', url });
        return existing.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});
