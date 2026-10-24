# Instruksi Khusus

- **Selalu jawab hanya dalam Bahasa Indonesia.** Jangan mencampur Bahasa
  Inggris ke dalam teks yang ditujukan ke user (termasuk update status,
  ringkasan, dan pesan singkat saat bekerja) — user kesulitan membedakan
  mana teks kerja dan mana jawaban untuk mereka kalau bahasanya campur.
  Istilah teknis/nama variabel/kode boleh tetap Bahasa Inggris kalau memang
  bagian dari kode, tapi kalimat penjelasannya harus Bahasa Indonesia.

# Arsitektur

Aplikasi ini awalnya satu file `index.html` raksasa, sudah dipecah jadi
modul-modul di `js/00-globals.js` ... `js/23-unduhan.js` (classic
`<script src="...">` berurutan, BUKAN ES module — sengaja, karena ~150+
atribut inline `onclick="fn(...)"` di HTML butuh fungsi ada di global
scope; classic script yang dimuat berurutan berbagi satu global scope).
Urutan tag `<script>` di `index.html` itu penting: modul yang isinya
deklarasi state global harus dimuat sebelum modul yang memakainya.

Sejak fitur pembayaran otomatis (Midtrans) dan notifikasi email (Resend +
Supabase Database Webhook), aplikasi ini TIDAK LAGI murni statis: ada
`netlify/functions/*.js` (Netlify Functions, Node/CommonJS,
`exports.handler = async (event) => {...}`) yang jalan server-side —
lihat bagian "Integrasi Pembayaran Otomatis (Midtrans)" dan "Notifikasi
Email untuk Permintaan Baru" di docs/pembayaran-midtrans.md dan docs/notifikasi.md untuk env var yang dibutuhkan.
File-file itu TIDAK dimuat ke `index.html` sama sekali (browser cuma
`fetch()` ke `/.netlify/functions/<nama>`, dan untuk
`notify-new-payment-request.js` malah tidak pernah dipanggil dari browser
sama sekali — pemanggilnya Supabase Database Webhook), jadi tidak ikut
kena aturan classic-script/global-scope di atas, dan tidak bisa diuji
lewat suite Playwright (lihat `tests/test-midtrans-functions.mjs` dan
`tests/test-notify-function.mjs`, test Node murni terpisah).

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
- **Cetak Bluetooth** (`js/10-nota-cetak.js`, printer thermal 58/80mm):
  guard `btConnectPromise`/`btPrintInFlight` sengaja ada supaya tap ganda
  tombol "Sambungkan Printer"/"Cetak Bluetooth" tidak memunculkan 2
  dialog sekaligus atau menulis 2 nota bersamaan ke printer yang sama —
  jangan dihapus. `connectBluetoothPrinter()` sengaja coba
  `device.gatt.connect()` ke device YANG SAMA dulu sebelum jatuh ke
  `requestDevice()` (dialog pilih printer) — supaya printer yang sempat
  auto-sleep tidak perlu dipilih ulang tiap kali cetak.

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
  `PW_CHROMIUM_PATH=<path ke binary chromium, kalau Playwright default tidak
  ketemu> node test.mjs`. Kalau `playwright`/`playwright-core` belum
  ter-install sebagai dependency proyek (`tests/node_modules`), jalankan
  `npm install -D playwright && npx playwright install chromium` di folder
  `tests/` dulu — JANGAN commit `tests/node_modules` ke git.
- Sebelum lapor task selesai: `node --check` di semua file JS yang
  diubah, suite 0 FAIL, dan minimal satu verifikasi lewat klik/panggilan
  nyata di browser headless (bukan cuma baca kode) untuk perubahan yang
  user-facing.

# Konvensi Keamanan — Cek Risiko DoS di Fitur Baru

Setiap kali menambah/mengubah fitur yang menyentuh salah satu dari ini —
endpoint baru (Netlify Function atau RPC Supabase), form/kolom input
baru, upload file, atau query database baru — **wajib cek 4 poin ini
dan laporkan ke user kalau ada celah, lalu perbaiki (bukan cuma
dilaporkan)**:

1. **Butuh login?** Kalau endpoint/RPC itu bisa dipanggil tanpa
   autentikasi (anon), apakah itu disengaja (seperti form publik
   `payment_requests`) — dan kalau iya, apakah efeknya "mahal" (kirim
   email/push, generate file besar, query berat)? Kalau mahal DAN tanpa
   rate-limit, itu celah.
2. **Query dibatasi?** Pastikan selalu pakai `LIMIT`/`.range()`/paginasi
   (lihat `fetchAllRows()`, `ensureAllTransactionsLoaded()`) — jangan
   sampai ada query baru yang menarik semua baris tanpa batas.
3. **Validasi ukuran input?** Form teks (panjang), upload file (ukuran
   byte — lihat contoh `handleLogoFileChange()`/`insertNoteImage()`,
   `js/06-outlet.js`/`js/20-catatan.js`, cek SEBELUM `FileReader`/`Image`
   memproses, bukan sesudah), maupun jumlah item (misal batch insert)
   semuanya harus punya batas atas yang jelas.
4. **Efek kalau dipanggil ribuan kali oleh 1 sumber?** Kuota pihak
   ketiga (Resend/Serper/Midtrans) jebol? Database kebanjiran? Biaya
   platform melonjak (DDoS jadi "Denial of Wallet")? Kalau jawabannya
   "ya" dan belum ada rate-limit sama sekali, itu celah.

Preseden rate-limit yang sudah ada: trigger `payment_requests_rate_limit_trigger`
(lihat docs/keamanan-dan-rls.md bagian rate-limit) — pola yang sama (trigger database,
global bukan per-user, pengecualian `service_role`) bisa dicontoh untuk
tabel baru yang insert-nya terbuka untuk anon dan punya efek mahal.

# Konvensi Git & Deploy

- Deploy ke production terjadi OTOMATIS via Netlify begitu sebuah Pull
  Request di-merge ke branch `main` — jangan pernah push langsung ke
  `main`. Selalu kerja di branch terpisah (nama bebas, deskriptif sesuai
  tugasnya), buka Pull Request, baru merge setelah tes lulus.
- Kalau mau lanjut kerja baru di branch yang PR terakhirnya sudah
  merged, **restart branch itu dari `origin/main`** (jangan numpuk di
  atas histori yang sudah merged):
  `git fetch origin main && git checkout -B <nama-branch> origin/main`
  (stash dulu kalau ada perubahan belum commit).
- Repo ini sudah pernah dikerjakan beberapa agent AI berurutan (riwayat
  lengkap di docs/ dan CHANGELOG.md) — commit message & PR description sebelumnya
  SELALU dalam Bahasa Indonesia, pola yang sama diharapkan dilanjutkan.

# Pembayaran Otomatis (Midtrans)

- Model harga: 4 paket (1/3/6/12 bulan), harga per paket lewat env var
  `SUBSCRIPTION_PRICE_1M/3M/6M/12M` di Netlify (BUKAN di-hardcode di
  kode) — lihat `netlify/functions/_midtrans-plans.js`. Paket 12 bulan
  dijadikan pilihan default di UI (`<select id="paywallPlan">`) supaya
  paling banyak dipilih — SENGAJA, jangan diubah tanpa diminta.
- **JANGAN PERNAH** commit `MIDTRANS_SERVER_KEY` atau
  `SUPABASE_SERVICE_ROLE_KEY` ke git dalam bentuk apa pun (kode, README
  contoh, commit message) — keduanya cuma boleh ada sebagai environment
  variable di dashboard Netlify. Yang aman ada di kode browser cuma
  Client Key (kalau nanti dipakai) — Server Key & Service Role Key HARUS
  cuma pernah dibaca oleh `netlify/functions/*.js` (server-side).
- Baru mencakup **perpanjangan** langganan toko yang sudah punya akun
  (owner_id sudah ada). **Pendaftaran toko baru otomatis** sengaja belum
  dikerjakan — butuh desain terpisah soal cara mengirim kode pendaftaran
  ke orang yang belum login sama sekali (lihat docs/pembayaran-midtrans.md bagian 4).

# Riwayat & konteks lengkap

File ini cuma ringkasan aturan "jangan dilanggar ulang". Untuk konteks
lengkap tiap fitur/bug/keputusan desain (kenapa sesuatu dibuat begitu,
bukan cuma apa aturannya), baca `docs/*.md` dan `CHANGELOG.md` (indeks di `README.md`) — isinya log kronologis
sangat detail dari setiap perbaikan/fitur yang pernah dikerjakan di repo
ini, termasuk alasan kenapa pendekatan lain ditolak.
