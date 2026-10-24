/* Tes Playwright untuk MODE OFFLINE (js/24-offline.js + sw.js) -- Tahap 1.
 *
 * Dua bagian:
 *  A. Uji logika di dalam halaman (snapshot IndexedDB, boot dari snapshot,
 *     jalur resolveRoleAndInit/handleLogout/listener sesi saat offline).
 *  B. Uji ujung-ke-ujung di browser sungguhan: service worker terpasang,
 *     server DIMATIKAN + jaringan browser diputus, halaman dimuat ulang dari
 *     cache dan jalan dari snapshot, lalu internet menyala lagi dan data asli
 *     dimuat ulang otomatis.
 *
 * Server statis dijalankan oleh tes ini sendiri (port 8932) supaya bisa
 * dimatikan untuk mensimulasikan offline -- TIDAK butuh `python3 -m http.server`.
 *
 * Jalankan dari folder tests/ (butuh symlink node_modules, lihat CLAUDE.md):
 *   PW_CHROMIUM_PATH=<chromium> node test-offline.mjs
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8932;
const BASE = `http://127.0.0.1:${PORT}`;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.css': 'text/css' };

function startServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, BASE).pathname);
      if (p === '/') p = '/index.html';
      const file = path.join(root, p);
      if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(PORT, '127.0.0.1', () => resolve(srv));
  });
}
const stopServer = (srv) => new Promise((resolve) => { srv.closeAllConnections?.(); srv.close(() => resolve()); });

const launchOpts = process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {};
const browser = await chromium.launch(launchOpts);

let passes = 0, failures = 0;
function ok(name) { passes++; console.log('OK: ' + name); }
function bad(name, msg) { failures++; console.log('FAIL: ' + name + ' -> ' + msg); }

/* Stub supabase-js yang bisa dikendalikan tes lewat window.__stub. */
const STUB = () => {
  const today = new Date(); const pad = (n) => String(n).padStart(2, '0');
  const iso = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const stub = window.__stub = {
    session: { user: { id: 'u1', email: 'kasir@test.com' } },
    failNetwork: false, signOutError: null, signOutCalls: 0, calls: [],
    tables: {
      settings: [{ user_id: 'u1', shop_name: 'Toko Tes', address: 'Jl. Uji', phone: '0812', note: 'Terima kasih' }],
      transactions: [{ id: 1, kode: 'LND-0001', nama: 'Budi', hp: '0811', tanggal: iso, estimasi: null,
        items: [{ nama: 'Cuci Setrika', qty: 2, satuan: 'kg', harga: 7000 }], diskon: 0, total: 14000, dp: 0,
        status: 'belum', lunas_at: null, catatan: '', work_status: 'belum', outlet_id: null }],
    },
  };
  function query(table) {
    const result = () => (stub.failNetwork
      ? { data: null, error: { message: 'TypeError: Failed to fetch' } }
      : { data: stub.tables[table] || [], error: null });
    const first = () => { const r = result(); return r.error ? r : { data: (r.data || [])[0] || null, error: null }; };
    return new Proxy({}, {
      get(_, prop) {
        if (prop === 'then') return (resolve, reject) => Promise.resolve(result()).then(resolve, reject);
        if (prop === 'single' || prop === 'maybeSingle') return () => Promise.resolve(first());
        return () => query(table);
      },
    });
  }
  Object.defineProperty(window, 'supabase', {
    value: {
      createClient: () => ({
        auth: {
          onAuthStateChange: (cb) => {
            (window.__authListeners = window.__authListeners || []).push(cb);
            Promise.resolve().then(() => cb(stub.session ? 'SIGNED_IN' : 'INITIAL_SESSION', stub.session));
            return { data: { subscription: { unsubscribe() {} } } };
          },
          signInWithPassword: async () => ({ data: null, error: { message: 'stubbed' } }),
          signUp: async () => ({ data: null, error: { message: 'stubbed' } }),
          signOut: async () => { stub.signOutCalls++; return { error: stub.signOutError }; },
          resetPasswordForEmail: async () => ({ error: null }),
          updateUser: async () => ({ error: null }),
          getSession: async () => ({ data: { session: stub.session }, error: null }),
        },
        from: (table) => { stub.calls.push(table); return query(table); },
        rpc: async () => ({ data: null, error: null }),
      }),
    },
    writable: false,
    configurable: true
  });
};
const CDN_RE = /^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.jsdelivr\.net)\//;

/* ============================== BAGIAN A ============================== */
{
  const srv = await startServer();
  const ctx = await browser.newContext({ serviceWorkers: 'block' }); // bagian A menguji logika, bukan SW
  const page = await ctx.newPage();
  await page.route(CDN_RE, (r) => r.fulfill({ status: 200, contentType: 'text/plain', body: '' }));
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.addInitScript(STUB);
  await page.goto(BASE + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.offlineDataReady === true, null, { timeout: 15000 });

  const out = await page.evaluate(async () => {
    const res = { steps: [], errors: [] };
    async function step(name, fn) { try { await fn(); res.steps.push(name); } catch (e) { res.errors.push(name + ' -> ' + e.message); } }
    const assert = (c, m) => { if (!c) throw new Error(m); };
    const stub = window.__stub;
    const authEl = () => document.getElementById('authScreen');
    const banner = () => document.getElementById('offlineBanner');
    const setOnline = (v) => Object.defineProperty(navigator, 'onLine', { get: () => v, configurable: true });
    const resetOnline = () => { delete navigator.onLine; };
    // Kembalikan keadaan "sehat" (online, data termuat, snapshot tersimpan) di antara langkah.
    async function healthy() {
      resetOnline(); stub.failNetwork = false; stub.signOutError = null; stub.signOutCalls = 0; stub.session = { user: { id: 'u1', email: 'kasir@test.com' } };
      offlineMode = false; offlineSnapshotPaused = false;
      currentUser = stub.session.user;
      document.getElementById('onboardingScreen').classList.remove('show');
      authEl().classList.add('hidden');
      await initUserData();
      await offlineSaveSnapshot();
      stub.calls = [];
    }

    await step('initUserData menandai data siap dan menyimpan snapshot lengkap', async () => {
      const s = await offlineLoadSnapshot();
      assert(s, 'snapshot harus ada');
      assert(s.userId === 'u1' && s.shopOwnerId === 'u1', 'identitas salah');
      assert(s.role === 'owner', 'role salah: ' + s.role);
      assert(s.transactions.length === 1 && s.transactions[0].kode === 'LND-0001', 'transaksi tidak ikut tersimpan');
      assert(s.settings.shopName === 'Toko Tes', 'pengaturan toko tidak ikut tersimpan');
      assert(offlineDataReady === true, 'offlineDataReady harus true');
    });

    await step('snapshot TIDAK disimpan selama data belum siap (cegah menimpa dengan data setengah jadi)', async () => {
      offlineDataReady = false;
      transactions.push({ id: 99, kode: 'LND-0099', nama: 'Setengah Jadi', items: [], total: 0, dp: 0, status: 'belum' });
      const saved = await offlineSaveSnapshot();
      const s = await offlineLoadSnapshot();
      transactions.pop(); offlineDataReady = true;
      assert(saved === false, 'harus menolak menyimpan');
      assert(s.transactions.length === 1, 'snapshot lama tidak boleh berubah');
    });

    await step('snapshot TIDAK disimpan saat berjalan dari snapshot (offlineMode)', async () => {
      offlineMode = true;
      const saved = await offlineSaveSnapshot();
      offlineMode = false;
      assert(saved === false, 'harus menolak menyimpan di offlineMode');
    });

    await step('pengaman: daftar transaksi kosong (gagal muat) tidak menimpa snapshot lama yang berisi', async () => {
      const keep = transactions; transactions = [];
      const saved = await offlineSaveSnapshot();
      transactions = keep;
      const s = await offlineLoadSnapshot();
      assert(saved === false, 'harus menolak');
      assert(s.transactions.length === 1, 'snapshot lama harus utuh');
    });

    await step('perubahan data tersimpan ke snapshot saat data siap', async () => {
      transactions.push({ id: 2, kode: 'LND-0002', nama: 'Sari', hp: '', tanggal: todayISO(), estimasi: null, items: [], diskon: 0, total: 5000, dp: 5000, status: 'lunas', lunasAt: todayISO(), catatan: '', workStatus: 'belum', outletId: null });
      const saved = await offlineSaveSnapshot();
      const s = await offlineLoadSnapshot();
      assert(saved === true, 'harus tersimpan');
      assert(s.transactions.length === 2, 'transaksi baru harus ikut: ' + s.transactions.length);
      transactions.pop(); await offlineSaveSnapshot();
    });

    await step('offlineBootFromSnapshot memulihkan SELURUH state dan UI (banner tampil, layar login/onboarding tertutup)', async () => {
      // hapus state memori seolah app baru dibuka tanpa data
      transactions = []; shopOwnerId = null; currentUser = null; currentRole = 'kasir'; settings = { shopName: 'X', address: '', phone: '', note: '', logoUrl: null, autoNotifySelesai: false };
      authEl().classList.remove('hidden');
      document.getElementById('onboardingScreen').classList.add('show');
      const okBoot = await offlineBootFromSnapshot();
      assert(okBoot === true, 'harus berhasil');
      assert(offlineMode === true, 'offlineMode harus true');
      assert(shopOwnerId === 'u1' && currentUser.id === 'u1' && currentUser.offlineRestored === true, 'identitas tidak pulih');
      assert(currentRole === 'owner', 'role tidak pulih: ' + currentRole);
      assert(transactions.length === 1 && transactions[0].nama === 'Budi', 'transaksi tidak pulih');
      assert(settings.shopName === 'Toko Tes', 'pengaturan tidak pulih');
      assert(authEl().classList.contains('hidden'), 'layar login harus tertutup');
      assert(!document.getElementById('onboardingScreen').classList.contains('show'), 'layar pilih peran harus tertutup');
      assert(banner().style.display === 'block' && /offline/i.test(banner().textContent), 'banner offline harus tampil');
    });

    await step('boot ditolak kalau snapshot milik user LAIN (data toko orang lain tidak boleh bocor)', async () => {
      await healthy();
      const okBoot = await offlineBootFromSnapshot('orang-lain');
      assert(okBoot === false, 'harus menolak');
      assert(offlineMode === false, 'offlineMode tidak boleh menyala');
    });

    await step('boot tanpa snapshot mengembalikan false (tidak mengubah state)', async () => {
      await offlineClearSnapshot();
      const okBoot = await offlineBootFromSnapshot();
      assert(okBoot === false, 'harus false');
      assert(offlineMode === false, 'offlineMode tidak boleh menyala');
      await healthy();
    });

    await step('offlineIsNetworkError: error jaringan ya, error aplikasi (izin/RLS) tidak, tanpa error tidak', async () => {
      assert(offlineIsNetworkError(null) === false, 'null');
      assert(offlineIsNetworkError(undefined) === false, 'undefined');
      assert(offlineIsNetworkError({ message: 'TypeError: Failed to fetch' }) === true, 'failed to fetch');
      assert(offlineIsNetworkError({ message: 'NetworkError when attempting to fetch resource.' }) === true, 'networkerror');
      assert(offlineIsNetworkError({ message: 'Load failed' }) === true, 'load failed (Safari)');
      assert(offlineIsNetworkError({ message: 'permission denied for table transactions' }) === false, 'RLS bukan jaringan');
      setOnline(false);
      assert(offlineIsNetworkError({ message: 'apa pun' }) === true, 'saat navigator.onLine=false semua error dianggap jaringan');
      resetOnline();
    });

    await step('resolveRoleAndInit saat navigator.onLine=false: pulihkan dari snapshot dan TIDAK menyentuh server', async () => {
      await healthy();
      setOnline(false);
      offlineMode = false;
      await resolveRoleAndInit();
      resetOnline();
      assert(offlineMode === true, 'harus masuk mode offline');
      assert(stub.calls.length === 0, 'tidak boleh ada query ke server: ' + stub.calls.join(','));
      assert(!document.getElementById('onboardingScreen').classList.contains('show'), 'JANGAN tampilkan layar pilih peran');
    });

    await step('resolveRoleAndInit online tapi server tak terjangkau: TIDAK dikira akun baru, jatuh ke snapshot', async () => {
      await healthy();
      stub.failNetwork = true;
      await resolveRoleAndInit();
      stub.failNetwork = false;
      assert(!document.getElementById('onboardingScreen').classList.contains('show'), 'layar pilih peran tidak boleh muncul');
      assert(offlineMode === true, 'harus jatuh ke snapshot');
      assert(transactions.length === 1, 'data snapshot harus tampil');
    });

    await step('resolveRoleAndInit server tak terjangkau DAN tanpa snapshot: toast jelas, bukan layar pilih peran', async () => {
      await healthy();
      await offlineClearSnapshot();
      stub.failNetwork = true;
      offlineMode = false;
      await resolveRoleAndInit();
      stub.failNetwork = false;
      assert(!document.getElementById('onboardingScreen').classList.contains('show'), 'layar pilih peran tidak boleh muncul');
      assert(offlineMode === false, 'tanpa snapshot tidak ada mode offline');
      assert(/Tidak bisa terhubung/.test(document.getElementById('toast').textContent), 'toast: ' + document.getElementById('toast').textContent);
    });

    await step('akun benar-benar baru (online, tanpa error) TETAP mendapat layar pilih peran seperti dulu', async () => {
      await healthy();
      const keep = { s: stub.tables.settings, t: stub.tables.transactions };
      stub.tables.settings = []; stub.tables.transactions = [];
      document.getElementById('onboardingScreen').classList.remove('show');
      await resolveRoleAndInit();
      stub.tables.settings = keep.s; stub.tables.transactions = keep.t;
      assert(document.getElementById('onboardingScreen').classList.contains('show'), 'akun baru harus tetap disambut layar pilih peran');
      assert(offlineMode === false, 'bukan mode offline');
    });

    await step('handleLogout saat offline DIBLOKIR: signOut tidak dipanggil, snapshot utuh', async () => {
      await healthy();
      offlineMode = true;
      await handleLogout();
      assert(stub.signOutCalls === 0, 'signOut tidak boleh dipanggil');
      assert(/Keluar akun butuh internet/.test(document.getElementById('toast').textContent), 'toast salah');
      offlineMode = false; setOnline(false);
      await handleLogout();
      resetOnline();
      assert(stub.signOutCalls === 0, 'navigator.onLine=false juga harus memblokir');
      assert(await offlineLoadSnapshot(), 'snapshot harus utuh');
    });

    await step('handleLogout online: signOut dipanggil lalu snapshot data toko DIHAPUS', async () => {
      await healthy();
      await handleLogout();
      assert(stub.signOutCalls === 1, 'signOut harus dipanggil sekali');
      assert((await offlineLoadSnapshot()) === null, 'snapshot harus terhapus setelah keluar akun');
      assert(offlineSnapshotPaused === false, 'jeda penyimpanan harus dilepas lagi');
    });

    await step('handleLogout gagal (signOut error): snapshot TIDAK dihapus', async () => {
      await healthy();
      stub.signOutError = { message: 'gagal' };
      await handleLogout();
      assert(stub.signOutCalls === 1, 'signOut dipanggil');
      assert(await offlineLoadSnapshot(), 'snapshot harus tetap ada karena belum benar-benar keluar');
    });

    await step('offlineHandleNoSession saat offline: buka dari snapshot, bukan paksa layar login', async () => {
      await healthy();
      authEl().classList.remove('hidden');
      setOnline(false);
      await offlineHandleNoSession();
      resetOnline();
      assert(offlineMode === true, 'harus masuk mode offline');
      assert(authEl().classList.contains('hidden'), 'layar login harus tertutup');
    });

    await step('offlineHandleNoSession saat offlineMode sudah aktif: layar login tetap tertutup', async () => {
      authEl().classList.remove('hidden');
      await offlineHandleNoSession();
      assert(authEl().classList.contains('hidden'), 'harus tertutup lagi');
    });

    await step('tombol "Lanjut offline": MUNCUL kalau ada snapshot tapi server tak terjangkau, HILANG kalau terjangkau', async () => {
      await healthy();
      const realFetch = window.fetch;
      try {
        window.fetch = () => Promise.reject(new TypeError('Failed to fetch'));
        await offlineRefreshAuthShortcut();
        assert(document.getElementById('offlineContinueBtn').style.display === 'block', 'harus tampil saat server tak terjangkau');
        window.fetch = () => Promise.resolve(new Response('{}', { status: 200 }));
        await offlineRefreshAuthShortcut();
        assert(document.getElementById('offlineContinueBtn').style.display === 'none', 'harus hilang saat server terjangkau');
      } finally { window.fetch = realFetch; }
    });

    await step('tombol "Lanjut offline" tersembunyi kalau belum ada snapshot sama sekali', async () => {
      await offlineClearSnapshot();
      const realFetch = window.fetch;
      try {
        window.fetch = () => Promise.reject(new TypeError('Failed to fetch'));
        document.getElementById('offlineContinueBtn').style.display = 'block';
        await offlineRefreshAuthShortcut();
        assert(document.getElementById('offlineContinueBtn').style.display === 'none', 'tanpa snapshot tidak ada gunanya');
      } finally { window.fetch = realFetch; }
      await healthy();
    });

    await step('offlineContinueFromAuth tanpa snapshot: toast panduan', async () => {
      await offlineClearSnapshot();
      await offlineContinueFromAuth();
      assert(/Belum ada data offline/.test(document.getElementById('toast').textContent), 'toast salah');
      await healthy();
    });

    await step('kembali online dengan sesi sah: keluar dari mode offline dan muat ulang data asli', async () => {
      await healthy();
      await offlineBootFromSnapshot();
      assert(offlineMode === true, 'prasyarat');
      let reinit = 0;
      const real = window.resolveRoleAndInit;
      window.resolveRoleAndInit = async () => { reinit++; };
      try { await offlineHandleBackOnline(); } finally { window.resolveRoleAndInit = real; }
      assert(reinit === 1, 'resolveRoleAndInit harus dipanggil tepat sekali: ' + reinit);
      assert(offlineMode === false, 'offlineMode harus mati');
      assert(banner().style.display === 'none', 'banner harus hilang');
      assert(currentUser.id === 'u1' && !currentUser.offlineRestored, 'currentUser harus dari sesi asli');
    });

    await step('kembali online tapi sesi sudah tidak sah: layar login tampil, snapshot dibiarkan', async () => {
      await healthy();
      await offlineBootFromSnapshot();
      stub.session = null;
      await offlineHandleBackOnline();
      assert(offlineMode === false, 'offlineMode harus mati');
      assert(!authEl().classList.contains('hidden'), 'layar login harus tampil');
      assert(await offlineLoadSnapshot(), 'snapshot tetap ada');
    });

    await step('banner mengikuti status koneksi (event offline/online)', async () => {
      await healthy();
      assert(banner().style.display === 'none', 'online: banner tersembunyi');
      setOnline(false); window.dispatchEvent(new Event('offline'));
      assert(banner().style.display === 'block', 'offline: banner tampil');
      resetOnline(); window.dispatchEvent(new Event('online'));
      await new Promise((r) => setTimeout(r, 20));
      assert(banner().style.display === 'none', 'online lagi: banner hilang');
    });

    await step('event "offline" menyimpan keadaan terakhir ke snapshot', async () => {
      await healthy();
      transactions.push({ id: 7, kode: 'LND-0007', nama: 'Dewi', hp: '', tanggal: todayISO(), estimasi: null, items: [], diskon: 0, total: 1000, dp: 0, status: 'belum', lunasAt: null, catatan: '', workStatus: 'belum', outletId: null });
      setOnline(false); window.dispatchEvent(new Event('offline'));
      await new Promise((r) => setTimeout(r, 150));
      resetOnline();
      const s = await offlineLoadSnapshot();
      transactions.pop();
      assert(s.transactions.some((x) => x.kode === 'LND-0007'), 'transaksi terbaru harus ikut tersimpan saat koneksi putus');
    });

    await step('antrean offline (queue) & generator nomor nota per perangkat', async () => {
      await healthy();
      const code1 = nextKodeOffline();
      assert(/^LND-D[A-Z0-9]{2}-0001$/.test(code1), 'format nomor nota offline salah: ' + code1);
      const code2 = nextKodeOffline();
      assert(code2.endsWith('-0002'), 'sekuens offline harus bertambah: ' + code2);

      const item = await offlineEnqueue('ADD_TRANSACTION', { kode: code1, total: 10000 });
      assert(item && item.id, 'harus ter-enqueue');
      const q = await offlineGetQueue();
      assert(q.length === 1 && q[0].payload.kode === code1, 'antrean harus berisi item');

      const synced = await offlineSyncQueue();
      assert(synced === 1, 'harus ter-sync 1 item: ' + synced);
      const q2 = await offlineGetQueue();
      assert(q2.length === 0, 'antrean harus kosong setelah sync');
    });

    await step('submitTransaction() saat offline membuat transaksi lokal & masuk antrean queue', async () => {
      await healthy();
      offlineMode = true;
      document.getElementById('inNama').value = 'Pelanggan Offline';
      draftItems = [{ nama: 'Cuci Kiloan', qty: 3, satuan: 'kg', harga: 6000, subtotal: 18000 }];
      await submitTransaction();
      offlineMode = false;

      const lastTrx = transactions[transactions.length - 1];
      assert(lastTrx && lastTrx.nama === 'Pelanggan Offline', 'transaksi offline harus masuk array memori');
      assert(/^LND-D/.test(lastTrx.kode), 'kode transaksi offline harus pakai format device tag: ' + lastTrx.kode);

      const q = await offlineGetQueue();
      assert(q.some(x => x.type === 'ADD_TRANSACTION' && x.payload.nama === 'Pelanggan Offline'), 'harus ada di antrean offline queue');
      await offlineRemoveFromQueue(q[q.length-1].id);
      transactions.pop();
    });

    await step('terjemahan Inggris tersedia untuk semua teks baru', async () => {
      const keys = ['📴 Lanjut offline (data terakhir)',
        'Tidak bisa terhubung ke server. Periksa internet lalu muat ulang halaman.',
        'Belum ada data offline di perangkat ini. Masuk saat ada internet dulu.',
        'Keluar akun butuh internet. Sambungkan internet dulu.'];
      for (const k of keys) assert(Object.prototype.hasOwnProperty.call(I18N_EN, k) && I18N_EN[k], 'belum diterjemahkan: ' + k);
    });

    return res;
  });
  for (const s of out.steps) ok(s);
  for (const e of out.errors) bad(e.split(' -> ')[0], e.split(' -> ').slice(1).join(' -> '));
  const unexpected = pageErrors.filter((e) => !/ERR_CONNECTION_RESET|404/.test(e));
  if (unexpected.length) bad('tidak ada error JavaScript tak terduga di halaman', unexpected.join(' | '));
  else ok('tidak ada error JavaScript tak terduga di halaman');
  await ctx.close();
  await stopServer(srv);
}

/* ============================== BAGIAN B ============================== */
{
  let srv = await startServer();
  const ctx = await browser.newContext(); // service worker DIIZINKAN
  const page = await ctx.newPage();
  await page.route(CDN_RE, (r) => r.fulfill({ status: 200, contentType: 'text/plain', body: '' }));
  await page.addInitScript(STUB);
  const name = 'E2E: ';
  try {
    await page.goto(BASE + '/index.html', { waitUntil: 'load' });
    await page.waitForFunction(() => window.offlineDataReady === true, null, { timeout: 15000 });
    await page.evaluate(() => navigator.serviceWorker.ready);
    // tunggu precache app shell selesai
    await page.waitForFunction(async () => {
      const keys = await caches.keys();
      if (!keys.some((k) => k.startsWith('laundry-batapas-v'))) return false;
      const c = await caches.open(keys.find((k) => k.startsWith('laundry-batapas-v')));
      return !!(await c.match('index.html')) && !!(await c.match('js/24-offline.js')) && !!(await c.match('js/12-transaksi.js'));
    }, null, { timeout: 15000 });
    const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
    if (!controlled) {
      await page.reload({ waitUntil: 'load' });
      await page.waitForFunction(() => window.offlineDataReady === true, null, { timeout: 15000 });
    }
    // snapshot sudah ada?
    const hasSnap = await page.evaluate(async () => !!(await offlineLoadSnapshot()));
    hasSnap ? ok(name + 'SW terpasang, app shell ter-precache, snapshot data tersimpan saat online') : bad(name + 'snapshot', 'tidak ada');

    // ---- putus: matikan server + putuskan jaringan browser ----
    await stopServer(srv);
    await ctx.setOffline(true);
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.offlineMode === true, null, { timeout: 15000 });
    const off = await page.evaluate(() => ({
      mode: offlineMode, tx: transactions.length, nama: transactions[0] && transactions[0].nama,
      shop: settings.shopName, owner: shopOwnerId,
      bannerShown: document.getElementById('offlineBanner').style.display === 'block',
      authHidden: document.getElementById('authScreen').classList.contains('hidden'),
      onboarding: document.getElementById('onboardingScreen').classList.contains('show'),
      sw: !!navigator.serviceWorker.controller,
    }));
    const offOk = off.mode && off.tx === 1 && off.nama === 'Budi' && off.shop === 'Toko Tes' && off.owner === 'u1' && off.bannerShown && off.authHidden && !off.onboarding && off.sw;
    offOk ? ok(name + 'server mati + jaringan putus: halaman TETAP terbuka dari cache dan menampilkan data terakhir (' + off.shop + ', ' + off.nama + ')')
          : bad(name + 'buka offline', JSON.stringify(off));

    // ---- kembali online ----
    srv = await startServer();
    await ctx.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForFunction(() => window.offlineMode === false, null, { timeout: 15000 });
    await page.waitForFunction(() => window.offlineDataReady === true, null, { timeout: 15000 });
    const on = await page.evaluate(() => ({
      mode: offlineMode, bannerHidden: document.getElementById('offlineBanner').style.display === 'none',
      realUser: currentUser && !currentUser.offlineRestored, tx: transactions.length,
    }));
    (!on.mode && on.bannerHidden && on.realUser && on.tx === 1)
      ? ok(name + 'internet kembali: keluar mode offline, banner hilang, data asli dimuat ulang otomatis')
      : bad(name + 'kembali online', JSON.stringify(on));
  } catch (e) {
    bad(name + 'alur ujung-ke-ujung', e.message);
  } finally {
    await ctx.close();
    await stopServer(srv).catch(() => {});
  }
}

await browser.close();
console.log(`\n${passes} lulus, ${failures} gagal`);
process.exit(failures ? 1 : 0);
