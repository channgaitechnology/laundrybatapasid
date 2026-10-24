# Suite regression Playwright

`test.mjs` menjalankan seluruh aplikasi (`index.html` + `js/*.js`) di
Chromium headless, dengan Supabase/CDN yang di-stub sepenuhnya (tidak ada
koneksi database/jaringan sungguhan) — jadi aman dijalankan kapan saja tanpa
menyentuh data asli.

## Cara jalan

Dari root repo:

```bash
# 1. Install dependency test (sekali saja)
cd tests
npm install
npx playwright install chromium

# 2. Jalankan static server untuk index.html (dari root repo, di terminal lain)
cd ..
python3 -m http.server 8931

# 3. Jalankan test (dari folder tests/)
cd tests
node test.mjs
```

Keluar dengan exit code 0 kalau semua lulus, dan mencetak daftar
`FAIL: ...` kalau ada yang gagal.

## Test lain: `test-midtrans-functions.mjs`

Terpisah dari suite Playwright di atas — ini test Node murni (bukan
browser) untuk `netlify/functions/midtrans-*.js` (serverless function
integrasi pembayaran Midtrans), karena file-file itu jalan di server
(Node), tidak dimuat ke `index.html`. Tidak butuh kredensial Midtrans/
Supabase sungguhan (fetch di-mock). Jalankan dari root repo:

```bash
node tests/test-midtrans-functions.mjs
```

## Test lain: `test-push-notify-function.mjs`

Juga test Node murni, untuk `netlify/functions/_web-push-send.js` +
`notify-new-payment-request.js` (jalur push-nya) + `notify-new-account.js`
(lihat [docs/notifikasi.md](../docs/notifikasi.md), bagian "Notifikasi Push (Web Push)"). Butuh `web-push`
benar-benar ter-install (symlink sementara `node_modules` di ROOT repo ->
scratchpad, **WAJIB dihapus lagi sebelum commit**, sama seperti
`tests/node_modules/{playwright,playwright-core}`). File ini pakai
`createRequire()` + manual `require.cache` busting (BUKAN dynamic
`import()` dengan query string) untuk test ulang file yang sama dengan
kombinasi env var berbeda — lihat komentar panjang di awal file kalau mau
tambah test serupa. Jalankan dari root repo:

```bash
node tests/test-push-notify-function.mjs
```

## Test mode offline: `test-sw.mjs` dan `test-offline.mjs`

Untuk fitur app bisa dibuka offline (lihat [`docs/offline.md`](../docs/offline.md)).

- `test-sw.mjs` — Node murni, **tanpa browser dan tanpa `npm install`**.
  Menjalankan `sw.js` di dalam `vm` dengan `caches`/`fetch` palsu: precache,
  network-first + batas waktu, fallback navigasi, CDN cache-first, dan
  memastikan `APP_SHELL`/`CDN_ASSETS` cocok dengan `index.html` dan isi folder
  `js/`.
- `test-offline.mjs` — Playwright. Bagian A menguji logika snapshot/boot/logout
  di halaman; bagian B uji ujung-ke-ujung di browser sungguhan (service worker
  terpasang, server dimatikan + jaringan diputus, halaman tetap terbuka dari
  cache, lalu data asli dimuat ulang saat internet kembali). Menjalankan server
  statis sendiri di port 8932, jadi **tidak butuh** `python3 -m http.server`.

```bash
node tests/test-sw.mjs
cd tests && PW_CHROMIUM_PATH=... node test-offline.mjs
```

## Catatan

- Test ini sepenuhnya sinkron dengan data mock/fixture bertanggal tetap
  (dunia fixture-nya sekitar Agustus 2026) — kalau menambah test baru,
  selalu isi tanggal transaksi/subscription secara eksplisit (jangan
  andalkan `todayISO()`/jam sistem asli), supaya test tidak jadi basi
  begitu waktu nyata berjalan (pernah terjadi: 2 test gagal karena hanya
  ini).
- Variabel env `PW_CHROMIUM_PATH` hanya perlu di-set kalau Chromium
  Playwright tidak ada di lokasi default (mis. di sandbox yang sudah
  menyediakan Chromium sendiri di path lain). Biarkan kosong di komputer
  biasa.
