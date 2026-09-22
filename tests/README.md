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
