/* Tes Node murni untuk sw.js (service worker) -- TANPA browser.
 *
 * sw.js dijalankan di dalam `vm` dengan `self`, `caches`, `fetch`, `Request`
 * palsu, lalu event install/activate/fetch dipicu langsung. Tujuannya
 * memastikan strategi offline (lihat komentar di sw.js) benar:
 *   - app shell + pustaka CDN di-precache saat install (satu gagal tidak
 *     menggagalkan yang lain)
 *   - network-first untuk satu origin, jatuh ke cache saat jaringan gagal
 *     ATAU macet melewati batas waktu
 *   - navigasi tanpa salinan persis jatuh ke index.html
 *   - Supabase API, Netlify Functions, dan request non-GET TIDAK disentuh
 *   - daftar APP_SHELL/CDN_ASSETS cocok dengan index.html dan isi folder js/
 *
 * Jalankan: node tests/test-sw.mjs   (tidak butuh Playwright/npm install)
 */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const swSrc = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const ORIGIN = 'https://app.test';

let passes = 0, failures = 0;
async function step(name, fn) {
  try { await fn(); passes++; console.log('OK: ' + name); }
  catch (e) { failures++; console.log('FAIL: ' + name + ' -> ' + e.message); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

function makeCaches() {
  const stores = new Map();
  const norm = (req) => (typeof req === 'string' ? new URL(req, ORIGIN + '/').href : req.url);
  function makeCache() {
    const m = new Map();
    return {
      m,
      async put(req, res) { m.set(norm(req), res); },
      async match(req, opts) {
        const u = norm(req);
        if (m.has(u)) return m.get(u);
        if (opts && opts.ignoreSearch) {
          const base = u.split('?')[0];
          for (const [k, v] of m) if (k.split('?')[0] === base) return v;
        }
        return undefined;
      },
    };
  }
  return {
    stores,
    async open(n) { if (!stores.has(n)) stores.set(n, makeCache()); return stores.get(n); },
    async keys() { return [...stores.keys()]; },
    async delete(n) { return stores.delete(n); },
  };
}
class FakeRequest {
  constructor(u, o) { this.url = new URL(u, ORIGIN + '/').href; this.opts = o; this.method = 'GET'; }
}
function okRes(body, url) { const r = new Response(body, { status: 200 }); return r; }
const opaqueRes = () => ({ ok: false, type: 'opaque', status: 0, clone() { return this; } });

/* fetchImpl(req, opts) -> Promise<Response>. Timer disingkat (maks 30 ms) supaya
   tes batas waktu jaringan tidak perlu menunggu 6 detik sungguhan. */
function makeSW(fetchImpl) {
  const listeners = {};
  const caches = makeCaches();
  const calls = [];
  const self = {
    addEventListener(type, fn) { listeners[type] = fn; },
    skipWaiting() { self.skipped = true; },
    clients: { claim() { self.claimed = true; }, matchAll: async () => [] },
    location: { origin: ORIGIN },
    registration: { showNotification() {} },
  };
  const ctx = vm.createContext({
    self, caches, Request: FakeRequest, URL, Promise, console,
    fetch: (req, opts) => { calls.push({ url: typeof req === 'string' ? req : req.url, opts }); return fetchImpl(req, opts); },
    setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 30)),
    clearTimeout,
  });
  vm.runInContext(swSrc, ctx);
  const get = (name) => vm.runInContext(name, ctx);
  return { listeners, caches, calls, self, get };
}
async function fireInstall(sw) {
  let p;
  sw.listeners.install({ waitUntil(x) { p = x; } });
  await p;
}
function fireFetch(sw, { url, method = 'GET', mode = 'cors' }) {
  const ev = { request: { url, method, mode }, responded: undefined, waits: [],
    respondWith(p) { ev.responded = p; }, waitUntil(p) { ev.waits.push(p); } };
  sw.listeners.fetch(ev);
  return ev;
}
const online = (map = {}) => async (req) => {
  const u = typeof req === 'string' ? req : req.url;
  if (u in map) return map[u]();
  return okRes('net:' + u);
};
const offline = async () => { throw new TypeError('Failed to fetch'); };
const text = (r) => r.text();

await step('install: skipWaiting + app shell (satu origin) dan pustaka CDN tersimpan', async () => {
  const sw = makeSW(async (req) => (String(req.url || req).startsWith('https://cdn.jsdelivr.net') ? opaqueRes() : okRes('x')));
  await fireInstall(sw);
  assert(sw.self.skipped === true, 'skipWaiting() harus dipanggil');
  const shell = sw.get('APP_SHELL');
  const cdn = sw.get('CDN_ASSETS');
  const main = await sw.caches.open(sw.get('CACHE_NAME'));
  const cdnCache = await sw.caches.open(sw.get('CDN_CACHE'));
  for (const p of shell) assert(await main.match(p), 'belum ter-precache: ' + p);
  for (const u of cdn) assert(await cdnCache.match(u), 'CDN belum ter-precache (opaque harus tetap disimpan): ' + u);
});

await step('install: satu berkas gagal diunduh TIDAK menggagalkan sisanya (allSettled, bukan addAll)', async () => {
  const sw = makeSW(async (req) => {
    if (req.url.endsWith('/icons/icon-512.png')) throw new TypeError('Failed to fetch');
    if (req.url.endsWith('/js/10-nota-cetak.js')) return new Response('nf', { status: 404 });
    return okRes('x');
  });
  await fireInstall(sw);
  const main = await sw.caches.open(sw.get('CACHE_NAME'));
  assert(!(await main.match('icons/icon-512.png')), 'berkas yang gagal tidak boleh tersimpan');
  assert(!(await main.match('js/10-nota-cetak.js')), 'respons 404 tidak boleh ikut ter-cache');
  assert(await main.match('index.html'), 'index.html tetap harus tersimpan');
  assert(await main.match('js/24-offline.js'), 'berkas lain tetap harus tersimpan');
});

await step('install: precache memaksa tembus HTTP cache (cache:"reload")', async () => {
  const sw = makeSW(online());
  await fireInstall(sw);
  const shellCalls = sw.calls.filter((c) => c.url.startsWith(ORIGIN));
  assert(shellCalls.length === sw.get('APP_SHELL').length, 'semua berkas shell harus diunduh');
  assert(shellCalls.every((c) => c.opts === undefined), 'fetch(Request) membawa opsi di Request, bukan argumen kedua');
});

await step('activate: buang cache lama, simpan CACHE_NAME dan CDN_CACHE, lalu clients.claim()', async () => {
  const sw = makeSW(online());
  for (const n of ['laundry-batapas-v10', 'laundry-batapas-v9', sw.get('CACHE_NAME'), sw.get('CDN_CACHE')]) await sw.caches.open(n);
  let p;
  sw.listeners.activate({ waitUntil(x) { p = x; } });
  await p;
  const left = [...sw.caches.stores.keys()].sort();
  assert(JSON.stringify(left) === JSON.stringify([sw.get('CACHE_NAME'), sw.get('CDN_CACHE')].sort()), 'sisa cache salah: ' + left);
  assert(sw.self.claimed === true, 'clients.claim() harus dipanggil');
});

await step('satu origin, online: jaringan yang menang, balasan disalin ke cache, fetch memakai cache:"reload"', async () => {
  const sw = makeSW(online());
  const ev = fireFetch(sw, { url: ORIGIN + '/js/12-transaksi.js' });
  const res = await ev.responded;
  assert((await text(res)) === 'net:' + ORIGIN + '/js/12-transaksi.js', 'harus balasan jaringan');
  assert(sw.calls[0].opts && sw.calls[0].opts.cache === 'reload', 'harus fetch cache:"reload"');
  await new Promise((r) => setTimeout(r, 10));
  const main = await sw.caches.open(sw.get('CACHE_NAME'));
  assert(await main.match(ORIGIN + '/js/12-transaksi.js'), 'balasan sukses harus ikut disimpan');
});

await step('satu origin, online tapi respons 404/500: tidak disimpan ke cache', async () => {
  const sw = makeSW(async () => new Response('nf', { status: 404 }));
  const ev = fireFetch(sw, { url: ORIGIN + '/js/tidak-ada.js' });
  const res = await ev.responded;
  assert(res.status === 404, 'respons error tetap diteruskan apa adanya');
  await new Promise((r) => setTimeout(r, 10));
  const main = await sw.caches.open(sw.get('CACHE_NAME'));
  assert(!(await main.match(ORIGIN + '/js/tidak-ada.js')), 'respons error tidak boleh di-cache');
});

await step('satu origin, offline: jatuh ke salinan cache', async () => {
  const sw = makeSW(offline);
  const main = await sw.caches.open(sw.get('CACHE_NAME'));
  await main.put(ORIGIN + '/js/12-transaksi.js', okRes('dari-cache'));
  const res = await fireFetch(sw, { url: ORIGIN + '/js/12-transaksi.js' }).responded;
  assert((await text(res)) === 'dari-cache', 'harus balasan cache');
});

await step('satu origin, jaringan MACET melewati batas waktu: pakai cache, bukan menggantung', async () => {
  const sw = makeSW(() => new Promise(() => {})); // tidak pernah selesai
  const main = await sw.caches.open(sw.get('CACHE_NAME'));
  await main.put(ORIGIN + '/index.html', okRes('index-cache'));
  const t0 = Date.now();
  const res = await fireFetch(sw, { url: ORIGIN + '/index.html', mode: 'navigate' }).responded;
  assert((await text(res)) === 'index-cache', 'harus balasan cache');
  assert(Date.now() - t0 < 1000, 'tidak boleh menunggu lama (timer tes disingkat)');
});

await step('satu origin, jaringan lambat tapi akhirnya sukses: cache diperbarui di latar belakang untuk buka berikutnya', async () => {
  let release;
  const sw = makeSW(() => new Promise((r) => { release = () => r(okRes('versi-baru')); }));
  const main = await sw.caches.open(sw.get('CACHE_NAME'));
  await main.put(ORIGIN + '/js/09-utils.js', okRes('versi-lama'));
  const res = await fireFetch(sw, { url: ORIGIN + '/js/09-utils.js' }).responded;
  assert((await text(res)) === 'versi-lama', 'saat macet harus pakai salinan lama');
  release();
  await new Promise((r) => setTimeout(r, 20));
  const after = await main.match(ORIGIN + '/js/09-utils.js');
  assert((await text(after)) === 'versi-baru', 'cache harus terisi versi baru setelah jaringan akhirnya menjawab');
});

await step('navigasi ke alamat yang tidak punya salinan persis (mis. ?adminNotif=1) jatuh ke index.html', async () => {
  const sw = makeSW(offline);
  const main = await sw.caches.open(sw.get('CACHE_NAME'));
  await main.put('./', okRes('index-root'));
  const res = await fireFetch(sw, { url: ORIGIN + '/?adminNotif=1', mode: 'navigate' }).responded;
  assert((await text(res)) === 'index-root', 'harus jatuh ke halaman utama tersimpan');
});

await step('navigasi: query beda tapi path sama memakai salinan (ignoreSearch)', async () => {
  const sw = makeSW(offline);
  const main = await sw.caches.open(sw.get('CACHE_NAME'));
  await main.put(ORIGIN + '/index.html', okRes('index-html'));
  const res = await fireFetch(sw, { url: ORIGIN + '/index.html?utm=1', mode: 'navigate' }).responded;
  assert((await text(res)) === 'index-html', 'harus cocok lewat ignoreSearch');
});

await step('BUKAN navigasi (mis. js) tanpa salinan dan offline: gagal apa adanya, JANGAN diganti index.html', async () => {
  const sw = makeSW(offline);
  const main = await sw.caches.open(sw.get('CACHE_NAME'));
  await main.put('./', okRes('index-root'));
  let rejected = false;
  try { await fireFetch(sw, { url: ORIGIN + '/js/tidak-ada.js', mode: 'no-cors' }).responded; } catch (e) { rejected = true; }
  assert(rejected, 'skrip yang tidak ada harus gagal, bukan dibalas HTML');
});

await step('Supabase API/Auth, Netlify Functions, dan request non-GET TIDAK disentuh service worker', async () => {
  const sw = makeSW(online());
  assert(fireFetch(sw, { url: 'https://ffpgapgvlzhetrkzmhqh.supabase.co/rest/v1/transactions' }).responded === undefined, 'Supabase harus dilewati');
  assert(fireFetch(sw, { url: ORIGIN + '/.netlify/functions/midtrans-webhook' }).responded === undefined, 'Netlify Functions harus dilewati');
  assert(fireFetch(sw, { url: ORIGIN + '/index.html', method: 'POST' }).responded === undefined, 'POST harus dilewati');
  assert(fireFetch(sw, { url: 'https://api.midtrans.com/x' }).responded === undefined, 'origin asing lain harus dilewati');
});

await step('CDN: cache-first (kena cache -> tanpa jaringan sama sekali)', async () => {
  const sw = makeSW(online());
  const cdn = await sw.caches.open(sw.get('CDN_CACHE'));
  const url = sw.get('CDN_ASSETS')[0];
  await cdn.put(url, okRes('lib-cache'));
  const res = await fireFetch(sw, { url, mode: 'no-cors' }).responded;
  assert((await text(res)) === 'lib-cache', 'harus dari cache');
  assert(sw.calls.length === 0, 'pustaka dipin: tidak boleh ke jaringan lagi');
});

await step('CDN: tidak ada di cache -> ambil dari jaringan lalu simpan; offline berikutnya tetap jalan', async () => {
  const sw = makeSW(online());
  const url = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';
  const first = await fireFetch(sw, { url, mode: 'no-cors' }).responded;
  assert((await text(first)) === 'net:' + url, 'pertama kali dari jaringan');
  await new Promise((r) => setTimeout(r, 10));
  const cdn = await sw.caches.open(sw.get('CDN_CACHE'));
  assert(await cdn.match(url), 'harus tersimpan');
});

await step('CDN: respons opaque (script lintas-origin tanpa crossorigin) ikut disimpan', async () => {
  const sw = makeSW(async () => opaqueRes());
  const url = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
  await fireFetch(sw, { url, mode: 'no-cors' }).responded;
  await new Promise((r) => setTimeout(r, 10));
  const cdn = await sw.caches.open(sw.get('CDN_CACHE'));
  assert(await cdn.match(url), 'opaque harus disimpan');
});

await step('Google Fonts CSS: stale-while-revalidate (balas cache dulu, perbarui di latar belakang)', async () => {
  const sw = makeSW(online());
  const cdn = await sw.caches.open(sw.get('CDN_CACHE'));
  const url = 'https://fonts.googleapis.com/css2?family=Sora';
  await cdn.put(url, okRes('css-lama'));
  const ev = fireFetch(sw, { url, mode: 'no-cors' });
  const res = await ev.responded;
  assert((await text(res)) === 'css-lama', 'harus balas cache dulu');
  assert(ev.waits.length === 1, 'harus memperbarui lewat waitUntil');
  await Promise.all(ev.waits);
  assert(sw.calls.length === 1, 'harus ada 1 fetch pembaruan');
});

await step('CDN: tidak ada cache DAN offline -> gagal apa adanya (tidak ada kebohongan)', async () => {
  const sw = makeSW(offline);
  let rejected = false;
  try { await fireFetch(sw, { url: 'https://cdn.jsdelivr.net/npm/x@1/x.js', mode: 'no-cors' }).responded; } catch (e) { rejected = true; }
  assert(rejected, 'harus gagal');
});

await step('push & notificationclick tetap terdaftar (tidak rusak oleh perubahan offline)', async () => {
  const sw = makeSW(online());
  assert(typeof sw.listeners.push === 'function', 'handler push hilang');
  assert(typeof sw.listeners.notificationclick === 'function', 'handler notificationclick hilang');
});

await step('KONSISTENSI: setiap <script src="js/..."> di index.html ada di APP_SHELL dan sebaliknya', async () => {
  const sw = makeSW(online());
  const shell = sw.get('APP_SHELL').filter((p) => p.startsWith('js/')).sort();
  // [A-Za-z0-9._-] (bukan [^"]+) supaya contoh `<script src="js/*.js">` di dalam komentar HTML tidak ikut terhitung.
  const inHtml = [...indexHtml.matchAll(/<script src="(js\/[A-Za-z0-9._-]+\.js)"/g)].map((m) => m[1]).sort();
  assert(JSON.stringify(shell) === JSON.stringify(inHtml), 'APP_SHELL js/ tidak sama dengan index.html.\n  shell: ' + shell.join(',') + '\n  html : ' + inHtml.join(','));
});

await step('KONSISTENSI: semua berkas di APP_SHELL benar-benar ada di repo, dan semua js/*.js terdaftar', async () => {
  const sw = makeSW(online());
  for (const p of sw.get('APP_SHELL')) {
    if (p === './') continue;
    assert(fs.existsSync(path.join(root, p)), 'APP_SHELL menyebut berkas yang tidak ada: ' + p);
  }
  const onDisk = fs.readdirSync(path.join(root, 'js')).filter((f) => f.endsWith('.js')).map((f) => 'js/' + f).sort();
  const shell = sw.get('APP_SHELL').filter((p) => p.startsWith('js/')).sort();
  assert(JSON.stringify(onDisk) === JSON.stringify(shell), 'ada js/*.js yang belum didaftarkan di APP_SHELL');
});

await step('KONSISTENSI: CDN_ASSETS persis sama dengan <script src="https://cdn.jsdelivr.net/..."> di index.html (termasuk versi)', async () => {
  const sw = makeSW(online());
  const cdn = [...sw.get('CDN_ASSETS')].sort();
  const inHtml = [...indexHtml.matchAll(/<script src="(https:\/\/cdn\.jsdelivr\.net\/[^"]+)"/g)].map((m) => m[1]).sort();
  assert(JSON.stringify(cdn) === JSON.stringify(inHtml), 'CDN_ASSETS tidak sama dengan index.html.\n  sw  : ' + cdn.join(',') + '\n  html: ' + inHtml.join(','));
});

await step('CACHE_NAME sudah dinaikkan dari v10 (aturan CLAUDE.md saat sw.js/berkas precache berubah)', async () => {
  const sw = makeSW(online());
  assert(sw.get('CACHE_NAME') !== 'laundry-batapas-v10', 'CACHE_NAME harus dinaikkan');
});

console.log(`\n${passes} lulus, ${failures} gagal`);
process.exit(failures ? 1 : 0);
