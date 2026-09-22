# Instruksi Khusus

- **Selalu jawab hanya dalam Bahasa Indonesia.** Jangan mencampur Bahasa
  Inggris ke dalam teks yang ditujukan ke user (termasuk update status,
  ringkasan, dan pesan singkat saat bekerja) — user kesulitan membedakan
  mana teks kerja dan mana jawaban untuk mereka kalau bahasanya campur.
  Istilah teknis/nama variabel/kode boleh tetap Bahasa Inggris kalau memang
  bagian dari kode, tapi kalimat penjelasannya harus Bahasa Indonesia.

# Arsitektur

Aplikasi ini awalnya satu file `index.html` raksasa, sudah dipecah jadi
modul-modul di `js/00-globals.js` ... `js/22-rekap-pelanggan.js` (classic
`<script src="...">` berurutan, BUKAN ES module — sengaja, karena ~150+
atribut inline `onclick="fn(...)"` di HTML butuh fungsi ada di global
scope; classic script yang dimuat berurutan berbagi satu global scope).
Urutan tag `<script>` di `index.html` itu penting: modul yang isinya
deklarasi state global harus dimuat sebelum modul yang memakainya.

# Konvensi Bisnis/Domain Penting (jangan dilanggar ulang)

- **Akuntansi berbasis kas.** `trxCashReceived(t) = t.dp||0` (`js/09-utils.js`)
  selalu berarti kas yang BENAR-BENAR sudah diterima, apapun `status`-nya
  (`'lunas'`/`'belum'`). Semua ringkasan uang masuk (Laporan, Rekap) harus
  pakai ini, bukan `t.total`.
- **Formula "Belum Dibayar" yang benar**: filter dulu transaksi ke
  `status==='belum'`, BARU jumlahkan `Math.max(total-dp,0)` PER
  TRANSAKSI. **Jangan pernah** pakai pengurangan agregat seperti
  `totalKeseluruhan - sudahDibayar` — pola itu pernah jadi bug produksi
  nyata (PR #19): kelebihan bayar/DP penuh di satu transaksi diam-diam
  "menutupi" tagihan transaksi lain yang benar-benar belum lunas dalam
  perhitungan yang sama. Contoh implementasi benar: `renderReport()` di
  `js/18-laporan.js` dan `rekapPelangganTotals()` di
  `js/22-rekap-pelanggan.js`.
- **Auto-promote status ke Lunas**: `submitTransaction()`
  (`js/12-transaksi.js`) otomatis mengubah `status` dari `'belum'` ke
  `'lunas'` kalau `dp>=total` (berlaku untuk transaksi baru maupun edit).
  Ini disengaja (PR #20) supaya status pembayaran manual tidak pernah
  "lupa" disinkronkan dengan DP yang sudah menutupi total — jangan
  dianggap bug dan di-revert.
- **`isMobileDevice()`** (`js/09-utils.js`, regex UA Android/iPhone/iPad/
  iPod) dipakai untuk gate `navigator.share()` sebelum dipanggil di
  `shareOrDownloadNotaImage()` (`js/10-nota-cetak.js`) dan unduh gambar
  Daftar Tugas (`js/17-papan-laundry.js`). `navigator.canShare()`
  melaporkan `true` di desktop juga, tapi `navigator.share()` di desktop
  cuma membuka dialog Share bawaan OS tanpa opsi simpan biasa — jadi
  desktop HARUS tetap fallback ke `<a download>`, jangan hilangkan gate
  ini.
- **`sw.js`**: fetch pakai `{cache:'reload'}` (bypass HTTP cache) supaya
  update kode selalu sampai ke perangkat pengguna walau PWA sempat
  di-switch ke app lain (bukan ditutup total). **Naikkan `CACHE_NAME`**
  setiap kali ada perubahan penting di `sw.js` sendiri atau file yang
  di-precache, supaya cache lama dibersihkan.

# Konvensi Testing (`tests/test.mjs`)

- Test yang mengubah global bersama (`transactions`, `draftItems`,
  `editingTransactionId`, dll) HARUS snapshot & restore di `try/finally`
  (mis. `transactions = transactions.slice()` sebelum diubah, dikembalikan
  di `finally`) — kalau lupa, test lain di belakangnya ikut gagal
  berantai.
- Mock `fakeTransactionsQuery()`: `.update()` TIDAK echo balik row seperti
  `.insert()`. Kalau test menyentuh jalur EDIT `submitTransaction()`,
  override `sb.from` khusus (save/restore `originalFrom`) di scope test
  itu saja.
- `navigator.userAgent` di-override per-test lewat
  `Object.defineProperty(navigator,'userAgent',{value:...,configurable:true})`,
  lalu `delete navigator.userAgent` di `finally`.
- Cara jalankan suite: dari root project, `python3 -m http.server 8931`,
  lalu di folder `tests/`:
  `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-*/chrome-linux/chrome node test.mjs`.
  `tests/node_modules/{playwright,playwright-core}` cuma symlink sementara
  ke scratchpad — **wajib dihapus lagi sebelum commit**, jangan sampai
  masuk git.
- Sebelum lapor task selesai: `node --check` di semua file JS yang
  diubah, suite 0 FAIL, dan minimal satu verifikasi lewat klik/panggilan
  nyata di browser headless (bukan cuma baca kode) untuk perubahan yang
  user-facing.

# Konvensi Git & Deploy

- Branch kerja: `claude/flexible-payment-laundry-package-46lz4u`. Deploy
  ke production terjadi otomatis via Netlify begitu PR di-merge ke
  `main`.
- Kalau PR terakhir di branch kerja itu sudah merged sebelum lanjut kerja
  baru, **restart branch dari `origin/main`** (jangan numpuk di atas
  histori yang sudah merged):
  `git fetch origin main && git checkout -B claude/flexible-payment-laundry-package-46lz4u origin/main`
  (stash dulu kalau ada perubahan belum commit).
