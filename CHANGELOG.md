# Catatan Perubahan (Riwayat Perbaikan & Audit)

Log kronologis perbaikan, regresi, dan audit — dipindah dari README supaya panduan pemakaian tidak tenggelam. Isi tiap entri tidak diubah.

[← Kembali ke README](README.md)

<!-- isi-dipindah-dari-README -->

## Diketahui rusak — SELESAI DIPERBAIKI (19 Agustus 2026)

`index.html` me-link dua berkas yang **ternyata tidak ikut ter-deploy** ke
Netlify (keduanya balik 404 saat dicek): `manifest.json` dan
`icons/icon-192.png`. Berkas fisiknya juga tidak ada di repo ini (tidak
pernah tersimpan, tidak cuma lupa di-commit).

Diperbaiki: `manifest.json` ditulis ulang (nama app, warna tema `#0D4F68`
cocok dengan meta tag yang sudah ada di `index.html`, ikon 192px & 512px).
Ikon dibuat dari kode (`icons/icon-192.png`, `icons/icon-512.png`) — motif
drum mesin cuci + gelembung, warna cocok dengan palet CSS app (`--suds`,
`--bubble`, `--sun`). **Ini ikon placeholder yang layak pakai, bukan logo
final** — ganti kapan saja Anda punya logo resmi, tinggal timpa kedua
berkas PNG itu (nama & ukurannya tetap sama).


## Audit lanjutan: 2 race condition ditemukan & diperbaiki (21 Oktober 2026)

_Konteks: audit fitur Cetak Bluetooth, lihat [docs/cetak-dan-nota.md](docs/cetak-dan-nota.md)._

Diminta user untuk cek ulang fitur ini secara khusus mencari bug/celah
keamanan, sekaligus menerapkan 4 poin "Konvensi Keamanan — Cek Risiko
DoS" di atas walau fitur ini 100% client-side (tidak menyentuh
server/Supabase sama sekali, jadi sebagian poin itu N/A secara
infrastruktur, tapi analoginya di sisi lokal tetap relevan dicek):

1. **Butuh login/efek mahal?** N/A — tidak ada request ke server sama
   sekali di jalur ini. Tapi efek LOKAL dari dipanggil berulang cepat
   (lihat poin 4) ternyata memang ada celah nyata.
2. **Query dibatasi?** N/A — tidak ada query database di jalur ini.
3. **Validasi ukuran input?** Nota yang SANGAT panjang (nota Tempo
   rekap banyak kunjungan, sama seperti kasus cap resolusi JPG HD
   sebelumnya) tidak dibatasi di `escposBytesFromLines()` — cuma makin
   lama dikirim (chunk 180 byte @ 25ms), BUKAN hang selamanya atau
   gagal. Diputuskan TIDAK diberi cap buatan (beda dari kasus JPG HD
   yang punya ambang keras dari WhatsApp) — kertas thermal memang
   gulungan, secara fisik wajar kalau nota panjang makan waktu cetak
   lebih lama, bukan bug.
4. **Efek dipanggil berkali-kali cepat (tap ganda)?** DUA race condition
   NYATA ditemukan di sini:
   - `connectBluetoothPrinter()` kalau terpanggil 2x sebelum yang
     pertama selesai (tap ganda tombol "Sambungkan Printer") akan
     memanggil `requestDevice()` dua kali — Chrome menolak permintaan
     kedua selama dialog pilih printer pertama masih terbuka
     (`InvalidStateError`), jadi salah satu panggilan gagal dengan
     toast error yang membingungkan padahal user cuma tap dobel tanpa
     sadar. **Diperbaiki**: `btConnectPromise` — panggilan susulan
     SELAGI satu percobaan sambung masih berjalan cuma ikut menunggu
     promise yang sama, tidak mulai `requestDevice()` baru.
   - `printLinesViaBluetooth()` kalau terpanggil 2x sebelum yang
     pertama selesai mengirim (tap ganda "Cetak Bluetooth" sebelum nota
     pertama tuntas terkirim) akan menulis BYTE DARI 2 NOTA BERBEDA ke
     characteristic BLE yang SAMA secara bersamaan, tanpa urutan
     terjamin — berisiko nota yang keluar di kertas jadi bercampur/
     acak antara 2 nota berbeda. **Diperbaiki**: `btPrintInFlight` —
     panggilan kedua yang masih tumpang-tindih dengan yang pertama
     langsung ditolak (toast "Masih mengirim nota sebelumnya..."),
     bukan ikut menulis.

Yang SUDAH diperiksa dan terkonfirmasi AMAN (tidak perlu diperbaiki):

- **XSS lewat nama printer** — `device.name` (data dari perangkat BLE
  eksternal, bisa dipalsukan siapa saja yang broadcast BLE di
  jangkauan) dirender lewat `showToast()`/`renderBtPrinterStatus()`,
  KEDUANYA pakai `textContent`, bukan `innerHTML` — aman dari injeksi
  HTML apa pun isi nama device-nya.
- **App tidak pernah membaca balik data DARI printer** — jalur ini
  cuma MENULIS (`writeValue`/`writeValueWithoutResponse`) ke
  characteristic, tidak pernah `readValue()` apa pun — jadi perangkat
  BLE nakal yang menyamar jadi printer tidak punya cara menyuntikkan
  data balik ke app ini sama sekali, paling parah cuma gagal/menolak
  tulisan.
- **Regex `sanitizeForThermal()`** — semua pola flat/dibatasi, tidak
  ada kuantifier bersarang yang rawan ReDoS (konsisten dengan audit
  regex app ini sebelumnya).

Verifikasi: suite Playwright penuh (210 langkah, 0 FAIL), termasuk test
baru dengan mock lengkap yang memanggil `connectBluetoothPrinter()` dan
`printLinesViaBluetooth()` masing-masing 2x bersamaan (tanpa menunggu
yang pertama) untuk membuktikan kedua guard di atas benar-benar
mencegah race condition-nya, bukan cuma kebetulan tidak ketahuan.


## Perbaikan UX Tab Transaksi, Edit Nota Tempo, Label Cetak, & Resolusi HD Nota (16 Oktober 2026)

Empat permintaan perbaikan terpisah dari user dalam satu sesi:

**1. Tab Transaksi langsung siap diketik.** `switchTab('baru')`
(`js/12-transaksi.js`) sekarang selalu `window.scrollTo(0,0)` + fokus ke
`#inNama` begitu tab Transaksi dibuka (termasuk saat app pertama kali
dimuat — `initUserData()` sudah selalu memanggil `switchTab(lastTab)` di
akhir, jadi satu titik ini cukup untuk kedua kasus). Form transaksi juga
dipasangi navigasi Enter: `focusOnEnter(idSekarang, idBerikutnya)`
mendaftarkan `keydown` per kolom supaya Enter pindah fokus ke kolom
berikutnya tanpa ketuk manual — urutannya meniru urutan visual form
(`inNama`→`inHP`→`inTanggal`→`inEstimasi`→`itNama`→`itQty`→`itSatuan`→
`itHarga`). Kolom `itHarga` dikhususkan: Enter di sana langsung memanggil
`addItem()` (sama seperti klik "+ Tambah Layanan") lalu fokus balik ke
`itNama`, supaya kasir bisa input banyak layanan berturut-turut tanpa
sentuh layar sama sekali.

**2. Edit transaksi per nota di Paket Tempo.** Sebelumnya satu kunjungan
Tempo (1 nota = sekelompok baris `subscription_usage` dengan `batch_id`
sama, lihat `groupExtrasIntoTransactions()`) cuma bisa dihapus per-baris,
tidak bisa diedit sama sekali. Ditambahkan `editUsageGroup(ids)`
(`js/08-paket.js`), dipanggil dari tombol ✏️ baru di
`renderUsageList()`: memuat ulang isi nota itu ke `draftExtraItems`/form
"Tambah Layanan Lain" yang sama (persis seperti `editTransaction()`
memuat nota reguler ke form Transaksi Baru), lalu `submitExtraServiceBatch()`
mendeteksi mode edit lewat global baru `editingUsageIds`/
`editingUsageBatchId` (`js/00-globals.js`) dan **mengganti isi nota itu**
(bukan menambah baris baru terpisah): insert baris baru dulu dengan
`batch_id` yang SAMA dengan nota lama (supaya tetap dikenali "transaksi
yang sama" di Daftar Tugas/riwayat), baru setelah semuanya berhasil
baris lama dihapus satu-per-satu lewat `.eq('id', id)` (bukan `.in()` —
disengaja, lihat di bawah). Urutan insert-dulu-baru-hapus ini supaya
kalau insert gagal di tengah jalan, data lama belum sempat tersentuh
sama sekali (rollback cukup menghapus baris baru yang baru sempat masuk).
Tombol "💾 Simpan & Buat Nota" berganti teks jadi "Update Transaksi" +
tombol "Batal Edit" muncul selama mode edit, sama seperti pola
`editTransaction()`/`cancelEditTransaction()` di form Transaksi Baru.

Catatan teknis: mock test `fakeUsageQuery()` (`tests/test.mjs`) TIDAK
pernah mengimplementasikan filter `.in()` (cuma `.eq()`) — bukan bug di
app ini, tapi karena itu kode produksi sengaja ditulis memakai
`Promise.all(ids.map(id => ...delete().eq('id', id)))` daripada
`.delete().in('id', ids)` untuk hapus banyak baris sekaligus, konsisten
dengan pola `.eq('id', id)` tunggal yang sudah dipakai `deleteUsage()` di
seluruh file ini.

**3. Label "Nota" di tombol cetak Tempo.** Tombol 🧾 di samping tiap
baris "Rekap Riwayat Transaksi (Belum Ditagih)" (`renderUsageList()`,
`js/08-paket.js`) cuma ikon tanpa teks — `title` tooltip-nya ("Kirim
nota") tidak pernah kelihatan di HP (tooltip butuh hover, bukan tap).
Ditambahkan teks "Nota" (lewat `t('Nota')`, sudah ada terjemahan
Inggris-nya "Receipt") di sebelah ikon di ketiga tempat tombol itu
dipakai (timbangan kg, nota 1-layanan, nota gabungan multi-layanan).

**4. Investigasi "kualitas HD tidak tersedia" untuk nota panjang di
WhatsApp.** User melaporkan sebagian nota (terutama nota Tempo yang
isinya panjang — banyak kunjungan belum ditagih digabung jadi satu nota)
gagal ditawari opsi "Kualitas HD" oleh WhatsApp sendiri saat dibagikan
lewat tombol "Unduh / Bagikan Nota (JPG)" (`shareOrDownloadNotaImage()`
→ `navigator.share()`, bukan tombol "Unduh JPG Kualitas HD via Dokumen
WA" yang memang sengaja tidak pernah lewat `navigator.share()` sama
sekali — lihat komentar panjang di atas `shareNotaImageAsDocument()`).

Bukan soal kompresi di app ini — riset publik mengonfirmasi WhatsApp
sendiri membatasi opsi HD-nya ke resolusi sekitar 4096px di sisi
terpanjang foto; kalau dilampaui, WA bukan mengompres lebih keras tapi
MENOLAK menawarkan opsi HD sama sekali. `buildNotaCanvas()`
(`js/10-nota-cetak.js`) sebelumnya selalu memakai `SCALE=8` px/mm tetap
tanpa peduli panjang kontennya — nota Tempo yang isinya banyak kunjungan
jadi sangat tinggi secara piksel dan gampang melampaui ambang itu,
padahal nota pendek (nota reguler/perpaket biasa) hampir tidak pernah
kena.

Diperbaiki dengan menurunkan `SCALE` efektif (bukan mengubah layout/isi
nota) kalau sisi terpanjang hasil pada `SCALE` dasar (8 px/mm)
diperkirakan melampaui 4000px (margin aman di bawah ~4096px WA):
`layoutNotaCanvas(lines, pageWidthMm, scale)` dipisah dari
`buildNotaCanvas()` supaya bisa dipanggil dua kali — sekali untuk
"mengintip" ukuran pada `SCALE` dasar, sekali lagi dengan `SCALE` yang
sudah diturunkan proporsional (lebar & tinggi sama-sama kena, jadi tidak
mengubah proporsi/layout) kalau perlu. Nota pendek tidak terdampak sama
sekali (tidak pernah mendekati ambang itu); nota panjang sekarang selalu
di bawah ambang HD WhatsApp, meski resolusinya sedikit lebih rendah
dibanding sebelumnya untuk kasus itu saja.

Verifikasi: `tests/test.mjs` — `buildNotaCanvas()` dites dengan nota
pendek (harus TIDAK pernah kena cap) dan nota 400 baris (harus kena cap,
sisi terpanjang ≤4000px, tapi tetap lebih tinggi dari nota pendek —
proporsinya tidak boleh rusak).

## REGRESI: nota PENDEK ternyata yang kehilangan opsi "Kualitas HD" WhatsApp, bukan nota panjang (21 Oktober 2026)

Ditemukan user lewat foto perbandingan nyata: nota tercetak dari app ini
("Cuci Lipat Hemat", 1 layanan, total Rp26.400) terlihat **pecah dan
tidak terbaca**, sementara nota dari app lain di sebelahnya (dicetak di
printer yang sama) terlihat jelas. User melaporkan pola persis
KEBALIKAN dari dugaan perbaikan 17 Oktober 2026 di atas: **nota pendek
TIDAK ditawari opsi "Kualitas HD" saat dikirim di WA, tapi nota PANJANG
justru ADA pilihan HD-nya.**

Akar masalah: `BASE_SCALE=8` px/mm bikin nota pendek (sedikit baris)
menghasilkan kanvas cuma sekitar 640x800px (~0,5 megapiksel, lebar
80mm). Riset publik soal fitur HD WhatsApp (lihat perbaikan 17 Oktober)
menyebut opsi HD cuma ditawarkan untuk foto yang "cukup besar"
resolusi/ukurannya (diperlakukan seperti foto kamera asli, bukan
screenshot/gambar kecil) — nota sekecil itu kemungkinan dianggap
"terlalu kecil untuk ditawari pilihan", langsung lewat jalur kompresi
STANDAR WhatsApp yang pasti merusak teks monospace tipis jadi
pecah/buram. Nota PANJANG (banyak baris) otomatis jadi tinggi secara
piksel, total megapiksel-nya jauh lebih besar — itu kemungkinan
sebabnya nota panjang malah DITAWARI opsi HD, persis kebalikan dari
nota pendek.

Diperbaiki: naikkan `BASE_SCALE` dari 8 jadi **16** px/mm
(`buildNotaCanvas()`, `js/10-nota-cetak.js`). Ini bukan cuma menebak
ambang WhatsApp — menaikkan resolusi sumber itu sendiri secara umum
membuat teks lebih tajam (lebih banyak piksel per karakter) apa pun
kompresi yang menimpanya nanti, SEKALIGUS membuat nota pendek sekarang
~2 megapiksel (lebar 80mm → ~1280px, nota 15-18 baris → tinggi
~1650px), di atas ambang "kualitas standar" (~1,68 megapiksel) yang
ditemukan riset sebelumnya. Cap `MAX_LONG_EDGE_PX=4000` dari perbaikan
17 Oktober TETAP dipertahankan apa adanya (logic-nya proporsional
terhadap `BASE_SCALE` berapa pun, otomatis menyesuaikan) — nota yang
benar-benar panjang tetap tidak akan melampaui ambang ATAS WhatsApp.

Verifikasi: suite Playwright penuh (211 langkah, 0 FAIL). Test baru
khusus membangun nota pendek REALISTIS (18 baris, isinya meniru persis
struktur nota transaksi biasa seperti contoh user) dan memastikan
hasilnya ≥1,2 megapiksel — ambang yang jauh di atas perilaku lama
(~0,5 megapiksel) tapi masih di bawah target ~2 megapiksel, supaya test
ini akan GAGAL lagi kalau `BASE_SCALE` pernah diturunkan balik tanpa
sadar di masa depan.

## Sederhanakan menu "Kirim Nota" dari 7 tombol teknis jadi 3 tombol berbasis tujuan (21 Oktober 2026)

User menyampaikan keluhan langsung: menu kirim nota (modal
`receiptShareModal`/`usageNotaModal`/`rekapShareModal`/
`subsInvoiceShareModal`) yang berkembang dari perbaikan kualitas HD
beberapa hari terakhir jadi **7 tombol** per modal — "Kirim via
WhatsApp", "Kirim via WhatsApp Business", "Unduh/Bagikan Nota (JPG)",
"Unduh JPG Kualitas HD (kirim manual via Dokumen WA)", "Unduh/Bagikan
Nota (PDF, kualitas HD)", "Cetak Bluetooth", "Cetak (AirPrint/Printer
Lain)" — dengan istilah teknis (JPG/HD/PDF/Dokumen/AirPrint) yang
"sangat rumit dan membingungkan bagi user... menyulitkan kalau harus
dijelaskan", dan user sendiri menilai ini **buruk buat app**-nya
(pemilik laundry awam, bukan developer).

**Disederhanakan ke 3 tombol per modal, berdasarkan TUJUAN user bukan
format file:**

1. **"📤 Kirim via WhatsApp"** — langsung pakai fungsi JPG yang sudah
   ada (`downloadReceiptImage()` dkk., lewat `shareOrDownloadNotaImage()`)
   yang di HP akan membuka share sheet OS (user tinggal pilih WhatsApp/
   WhatsApp Business sendiri dari situ — TIDAK perlu lagi 2 tombol WA
   terpisah) — **menggantikan total** pendekatan lama kirim pesan TEKS
   polos lewat `wa.me` (`sendReceiptWA()`/`receiptTextForWA()` dkk.),
   atas permintaan eksplisit user ("kirim WA bentuk jpg saja, bukan
   teks") supaya pelanggan selalu menerima nota sebagai gambar rapi.
2. **"🖨️ Cetak"** — membuka submenu generik baru `printOptionsModal`
   (`openPrintOptions({bluetooth,browser,pdf})`/`closePrintOptions()`/
   `runPrintOption(kind)` di `js/10-nota-cetak.js`, dipakai bareng oleh
   ke-4 jenis nota) berisi 3 pilihan: **Cetak Bluetooth**, **Cetak
   (AirPrint/Printer Lain)**, dan **Simpan untuk Dicetak Nanti** (di
   baliknya PDF — ganti nama dari tombol "PDF" lama, lihat alasan
   teknis kenapa PDF di bagian selanjutnya).
3. **"💾 Simpan sebagai Gambar"** — fungsi JPG yang SAMA PERSIS dengan
   tombol "Kirim via WhatsApp" (sengaja dipakai ulang, bukan logic
   baru) — tombol "Unduh JPG Kualitas HD (manual via Dokumen)" yang
   lama dicopot dari UI (kompleksitasnya — user harus paham beda
   "Bagikan" vs "Dokumen" di WhatsApp sendiri — justru sumber
   kebingungan yang dikeluhkan).

Supaya "Simpan untuk Dicetak Nanti" konsisten tersedia di SEMUA jenis
nota (sebelumnya cuma ada tombol PDF di modal Transaksi & Timbangan,
TIDAK ADA di Rekap Pelanggan & Tagihan Paket Bulanan), ditambahkan 2
fungsi baru yang pola-nya sama persis dengan yang sudah ada:
`downloadRekapPelangganPDF()` (`js/22-rekap-pelanggan.js`) dan
`downloadSubsInvoicePDF()` (`js/08-paket.js`), sama-sama memanggil
`shareOrDownloadNotaPDF()` dengan `lines` builder yang sudah ada
(`buildRekapPelangganPDFLines()`/`buildSubsInvoicePDFLines()`).

**Kenapa "Simpan untuk Dicetak Nanti" pakai PDF, bukan JPG** — ini
temuan TERPISAH dari soal kualitas HD WhatsApp: user melaporkan nota
JPG (termasuk versi "HD" baru) tetap **kekecilan & pecah saat
benar-benar dicetak fisik** lewat app lain (disimpan dulu, baru dibuka
dari Galeri/Files untuk print), padahal di layar HP terlihat normal.
Diselidiki lewat file JPG asli yang dikirim user: `640×1282px` — persis
rumus `BASE_SCALE=8` LAMA (bukan `16` yang baru di-merge), padahal kode
produksi (`laundryassist.netlify.app/js/10-nota-cetak.js`) sudah benar
`BASE_SCALE=16` — jadi sempat diduga soal cache browser/PWA basi
(terbukti BUKAN setelah user clear cache & tes ulang). Akar masalah
sebenarnya: JPG (apa pun resolusinya) **tidak membawa info ukuran
fisik kertas (DPI/mm)** — app print manapun yang membuka file itu
HARUS MENEBAK sendiri seberapa besar mencetaknya, dan tebakan itu
sering salah (ketambah: komentar lama di kode sudah mencatat WhatsApp
SELALU mengompres ulang foto yang dikirim sebagai gambar, berapa pun
resolusi sumbernya — lihat `buildNotaPDFBlob()`). PDF yang sudah ada di
app ini (`buildNotaPDFBlob()`, `js/10-nota-cetak.js`) TIDAK kena
masalah ini sama sekali: ukuran halamannya dibuat PERSIS sesuai lebar
kertas struk (`jsPDF({unit:'mm', format:[pageWidthMm,heightMm]})`) dan
teksnya vektor (font Courier asli, bukan rasterisasi piksel) — dijamin
pas ukuran & tajam di kertas, app print apa pun yang membukanya.

Verifikasi: `node --check` lulus di semua file yang diubah, suite
Playwright penuh (213 langkah, 0 FAIL — termasuk 2 test baru: submenu
`printOptionsModal` merutekan `bluetooth`/`browser`/`pdf` ke fungsi
yang BENAR tanpa salah pilih, dan ke-4 modal nota punya tombol "Cetak"
dengan `onclick` yang tepat memanggil fungsi-fungsi nota jenisnya
masing-masing), plus verifikasi visual nyata di browser headless
(klik tombol "Cetak" sungguhan, screenshot sebelum/sesudah) memastikan
submenunya benar-benar muncul rapi di atas modal "Kirim Nota".

Catatan: fungsi-fungsi lama (`sendReceiptWA()`/`sendUsageNotaWA()`/
`sendSubsInvoiceWA()`/`sendRekapPelangganWA()`/teks WA terkait,
`downloadReceiptImageHD()`/`downloadUsageNotaImageHD()`/
`shareNotaImageAsDocument()`) SENGAJA belum dihapus dari kode — sudah
tidak ada tombol UI yang memanggilnya lagi, tapi test Playwright-nya
yang sudah ada (menguji perilaku fungsinya langsung, bukan lewat klik
tombol) sengaja dipertahankan dulu sebagai dokumentasi perilaku,
sampai ada keputusan eksplisit untuk benar-benar membuang fungsi &
test-nya sekalian.

## REGRESI: tombol "Kirim via WhatsApp" di desktop cuma download, tidak ada aksi WA sama sekali (21 Oktober 2026)

Langsung ketahuan user begitu penyederhanaan menu di atas naik ke
production: di **browser desktop**, klik tombol "📤 Kirim via
WhatsApp" "malah jadi download nota" — tidak ada aksi WhatsApp apa
pun. Sebabnya: tombol itu dulu memakai fungsi yang SAMA PERSIS dengan
"💾 Simpan sebagai Gambar" (`downloadReceiptImage()` dkk.), dan
`shareOrDownloadNotaImage()` di baliknya cuma mencoba
`navigator.share()` kalau `isMobileDevice()` — di desktop dia SELALU
jatuh ke unduh biasa tanpa WA apa pun. Sebelumnya tidak ketahuan
karena tombol ini belum pernah benar-benar jadi tombol "Kirim via
WhatsApp" yang asli (versi lama pakai `wa.me` berisi TEKS, bukan
gambar) — begitu diganti ke fungsi share-gambar generik, baru
ketahuan fungsi itu tidak pernah didesain untuk kasus desktop+WA sama
sekali.

Diperbaiki: `shareOrDownloadNotaImage()` (`js/10-nota-cetak.js`) dapat
parameter baru `waPhone` (opsional). Kalau diisi DAN bukan mobile,
SETELAH file berhasil diunduh, dia juga `openWA(waPhone, '')` —
membuka tab WhatsApp Web ke nomor pelanggan yang benar (tanpa teks
prefill, karena WA Web tidak bisa dipaksa lampir gambar lewat URL),
supaya user tinggal lampirkan file yang baru saja diunduh — mirip
pengalaman "pilih WhatsApp dari share sheet" di HP, bukan silent
download. Ditambahkan 4 fungsi baru (`sendReceiptImageWA()` di
`js/15-nota-receipt.js`, `sendUsageNotaImageWA()` di
`js/10-nota-cetak.js`, `sendRekapPelangganImageWA()` di
`js/22-rekap-pelanggan.js`, `sendSubsInvoiceImageWA()` di
`js/08-paket.js`) yang memanggil `shareOrDownloadNotaImage()` dengan
nomor pelanggan terisi — dipakai KHUSUS tombol "Kirim via WhatsApp".
Tombol "Simpan sebagai Gambar" SENGAJA tetap memanggil fungsi lama
(`downloadReceiptImage()` dkk., TANPA `waPhone`) — itu bukan tombol
"kirim", jadi tidak boleh ikut membuka WA.

Verifikasi: `node --check` lulus, suite Playwright penuh (215 langkah,
0 FAIL — 2 test baru: `shareOrDownloadNotaImage(waPhone)` membuka
`wa.me` ke nomor yang benar di desktop tapi TIDAK di mobile/pada
"Simpan sebagai Gambar", dan ke-4 tombol "Kirim via WhatsApp"/"Simpan
sebagai Gambar" memanggil fungsi yang benar — tidak tertukar).

## REGRESI KEDUA: toast "Kirim via WhatsApp" tidak menyebut WhatsApp sama sekali kalau nomor pelanggan kosong (21 Oktober 2026)

Setelah perbaikan desktop di atas naik, user masih melaporkan "masih
cuma download di browser laptop belum bisa langsung kirim ke wa" —
lewat screenshot: toast yang muncul persis `"Gambar nota diunduh ke
folder Download."`, sama sekali tidak menyinggung WhatsApp. Akar
masalah KEDUA ini beda dari yang pertama: `trx.hp` (No. WhatsApp
pelanggan di transaksi itu) ternyata **kosong** — `shareOrDownloadNotaImage()`
cuma membuka tab WA kalau `waPhone` TERISI (`if(!isMobileDevice() &&
waPhone)`), jadi begitu nomornya kosong, dia diam-diam jatuh ke toast
generik yang sama persis dengan tombol "Simpan sebagai Gambar" — user
otomatis mengira tombol "Kirim via WhatsApp"-nya masih belum jalan
sama sekali, padahal sebenarnya cuma nomor pelanggannya yang belum
diisi di transaksi itu.

Diperbaiki: `waPhone` sekarang dibedakan 2 kondisi "kosong" yang
beda artinya — `''` (string kosong, tombol "Kirim via WhatsApp"
DIPAKAI tapi nomor pelanggan belum diisi) vs `undefined` (BUKAN
tombol WA sama sekali, mis. "Simpan sebagai Gambar" — tidak pernah
mengirim argumen ke-5 ini). Caller tombol WA (`sendReceiptImageWA()`
dkk.) sekarang SELALU mengirim `trx.hp || ''` (bukan `trx.hp` mentah)
supaya `undefined`-nya field itu sendiri tidak ketukar jadi
"undefined" — gunanya (`waPhone!==undefined`) buat mendeteksi "ini
memang tombol kirim WA" lepas dari isi nomornya. Kalau `waPhone===''`:
gambar TETAP diunduh (TIDAK diblokir, beda dari `sendReceiptWA()` teks
LAMA yang dulu menolak total kalau nomor kosong), tapi toast-nya
sekarang eksplisit menyebut WhatsApp & menjelaskan kenapa tidak ada
tab yang terbuka — user langsung tahu solusinya (isi dulu No.
WhatsApp pelanggan di transaksinya) alih-alih mengira fitur ini rusak.

Verifikasi: suite Playwright penuh (216 langkah, 0 FAIL — 1 test baru
khusus kasus nomor kosong: tetap unduh, TIDAK buka tab WA apa pun,
TAPI toast-nya harus menyebut "WhatsApp").

## REGRESI KETIGA: chat WhatsApp Web kebuka ke nomor yang benar tapi filenya tidak ikut terlampir (21 Oktober 2026)

Lanjutan lagi dari 2 perbaikan di atas: untuk nota yang nomor WA
pelanggannya SUDAH terisi, user melaporkan "langsung buka wa dan
langsung buka chat ke nomor di nota tapi file nota nya tidak ikut
terlampir cuma chat kosong". **Ini separuh memang batasan platform
yang TIDAK BISA diperbaiki dari kode** — WhatsApp Web tidak punya
mekanisme apa pun (lewat URL atau API publik) untuk menerima lampiran
file dari situs lain; satu-satunya cara melampirkan tetap manual lewat
ikon 📎 di dalam WA Web sendiri. Itu sudah dicatat di komentar kode
sejak perbaikan pertama ("WA Web tidak bisa dipaksa lampir gambar
lewat URL").

Tapi ada bug NYATA yang bikin instruksi "lampirkan manual" itu tidak
pernah terbaca user: dulu dipakai `showToast()` di TAB ASAL, sedangkan
`openWA()` sesudahnya memanggil `window.open()` yang LANGSUNG
memindahkan fokus browser ke TAB BARU (WhatsApp Web) — toast di tab
asal jadi hilang/tidak kelihatan sama sekali sebelum sempat dibaca.
User cuma melihat WhatsApp Web kebuka dengan chat kosong, tanpa tahu
sama sekali bahwa file-nya sudah ada di folder Download menunggu
dilampirkan manual.

Diperbaiki: `shareOrDownloadNotaImage()` sekarang menampilkan
`alert()` (modal, WAJIB di-klik OK) berisi instruksi 2 langkah
("1. Klik ikon lampiran 📎 di kotak chat, 2. Pilih gambar nota dari
folder Download") **SEBELUM** `openWA()` dipanggil — jadi user pasti
membaca instruksinya dulu selagi masih di tab asal, baru fokus pindah
ke tab WhatsApp Web yang baru terbuka. Pola ini sama dengan
`shareNotaImageAsDocument()` yang sudah lebih dulu memakai `alert()`
untuk instruksi berlapis yang harus dibaca sampai selesai.

Verifikasi: suite Playwright penuh (216 langkah, 0 FAIL — test
"Kirim via WhatsApp" yang sudah ada diperluas memastikan `alert()`
berisi kata "WhatsApp" tampil TEPAT SEBELUM `openWA()`/`window.open()`
dipanggil, bukan setelahnya, dan `showToast()` generik lama tidak lagi
dipakai untuk kasus ini).

## REGRESI KE-4: di HP tombol "Kirim via WhatsApp" masih menyerahkan pilihan ke share sheet OS generik (21 Oktober 2026)

Satu lagi lanjutan di hari yang sama: user melaporkan "untuk di hp
beda lagi. saat klik kirim lewat wa, yang muncul banyak pilihan, ada
wa, download, share dan lain-lain, ini masih tidak konsisten." Akar
masalahnya: ketiga perbaikan sebelumnya (desktop buka WA, toast sebut
WA saat nomor kosong, `alert()` sebelum buka tab) semuanya ditambahkan
sebagai parameter `waPhone` opsional di `shareOrDownloadNotaImage()` --
tapi fungsi itu PUNYA percabangan `isMobileDevice()` dari awal (dipakai
bareng "Simpan sebagai Gambar"): di mobile, dia MASIH mencoba
`navigator.share()` DULU (membuka share sheet OS generik: WA, Download,
Share, app lain) SEBELUM logic `waPhone` sempat jalan sama sekali --
jadi semua perbaikan WA tadi cuma pernah benar-benar jalan di desktop,
tidak pernah tersentuh sama sekali di HP.

User minta tegas: **"harusnya hanya kirim lewat wa. saat klik kirim
lewat wa, langsung buka wa, jika di nota ada nomornya langsung masuk
ke chat, jika tidak ada nomor cukup buka sampai halaman depan wa."**
Ini permintaan perilaku yang KONSISTEN di semua platform -- bukan beda
kelakuan di HP vs desktop lagi.

Diperbaiki dengan DESAIN ULANG, bukan tambal lagi: dibuat fungsi baru
`shareNotaViaWhatsApp(lines, filenameBase, pageWidthMm, waPhone)`
(`js/10-nota-cetak.js`) yang TERPISAH TOTAL dari
`shareOrDownloadNotaImage()` (bukan cuma versi dengan parameter
tambahan lagi) -- `shareNotaViaWhatsApp()` TIDAK PERNAH memanggil
`navigator.share()` di platform apa pun: SELALU unduh file -> `alert()`
panduan lampir manual (sebut WhatsApp) -> `openWA()` langsung (ke chat
kontak kalau `waPhone` terisi, ke halaman depan WA `wa.me/?text=` kalau
kosong). `shareOrDownloadNotaImage()` DIKEMBALIKAN ke versi aslinya
(tanpa parameter WA apa pun) -- sekarang CUMA dipakai "Simpan sebagai
Gambar", yang MEMANG masih benar pakai `navigator.share()` di mobile
(itu tombol "simpan/bagikan ke mana saja", bukan "kirim WA"). Ke-4
fungsi `send*ImageWA()` (satu per jenis nota) diubah memanggil
`shareNotaViaWhatsApp()`, bukan `shareOrDownloadNotaImage()` lagi.

SENGAJA tidak pakai jalur `intent://` Android di `openWA()` (parameter
`target`) untuk memaksa buka app WhatsApp spesifik -- link `wa.me`
biasa (`window.open()`) sudah otomatis ditangani OS (Android/iOS)
lewat universal link ke app WhatsApp yang terpasang, tanpa trik
tambahan, dan ini juga yang membuat kodenya tidak perlu percabangan
`isAndroid`/`isMobileDevice()` lagi khusus untuk tombol ini.

Verifikasi: suite Playwright penuh (215 langkah, 0 FAIL -- 3 test
"Kirim via WhatsApp" terpisah sebelumnya digabung jadi 1 test
komprehensif yang menguji SATU set assertion yang SAMA PERSIS di
mobile DAN desktop: `navigator.share()` tidak pernah dipanggil,
`alert()` tampil sebelum `openWA()`, nomor terisi vs kosong, dan
"Simpan sebagai Gambar" tidak terpengaruh sama sekali).

## Perbesar huruf nota + kecilkan margin kiri-kanan (21 Oktober 2026)

User minta tulisan nota diperbesar, dan secara eksplisit sudah
mengidentifikasi sendiri akar masalahnya: "ternyata bukan soal tidak
bisa menentukan ukuran cetak tapi karena memang dalam satu baris ada
terlalu banyak kata. seandainya dengan jumlah kata yang sama tapi
ukuran hurufnya diperbesar pasti tidak muat. dan juga margin di kanan
kiri terlalu besar. buatkan mepet ke sisi supaya full tidak banyak
area kosong." — jadi bukan soal ukuran fisik cetak (itu sudah beres
lewat PDF di perbaikan-perbaikan sebelumnya), tapi soal tata letak:
margin kiri-kanan memakan jatah lebar yang seharusnya bisa dipakai
teks, dan menaikkan ukuran huruf begitu saja tanpa mengecilkan margin
cuma akan membuat baris makin gampang tidak muat.

Ditambahkan 2 konstanta baru di `js/10-nota-cetak.js`:
`NOTA_FONT_SCALE = 1.15` (menaikkan SEMUA ukuran huruf 15% — dipakai
di `ptToPx()` dalam `layoutNotaCanvas()` untuk JPG, dan di
`doc.setFontSize()` dalam `buildNotaPDFBlob()` untuk PDF) dan
`NOTA_MARGIN_X_MM = 2` (mengecilkan margin kiri-kanan dari 4mm/sisi
jadi 2mm/sisi di KEDUA format — dipakai sebagai `marginX` di canvas &
`marginMm` di PDF). Keduanya dinaikkan/dikecilkan BERSAMAAN supaya
saling mengimbangi, bukan cuma salah satu — lebar ekstra dari margin
yang lebih kecil itulah yang menampung huruf yang lebih besar. Baris
yang tetap tidak muat sekalipun sudah begitu akan dibungkus ke baris
baru seperti biasa (`wrapCanvasLines()`, sudah ada sejak awal) — nota
jadi sedikit lebih tinggi, itu konsekuensi yang memang diterima user,
bukan bug.

SENGAJA tidak menyentuh `escposBytesFromLines()` (Bluetooth — cuma 3
pilihan ukuran huruf diskrit bawaan printer thermal, bukan kontrol
mm/px seperti JPG/PDF) atau `linesToPrintHTML()`/`printLinesViaBrowser()`
(AirPrint — di luar laporan user kali ini, beda jalur cetak).

Verifikasi: suite Playwright penuh (217 langkah, 0 FAIL — test baru
memastikan `NOTA_FONT_SCALE>1`, `NOTA_MARGIN_X_MM<4` (margin lama),
margin canvas sungguhan <4mm lewat `layoutNotaCanvas()`, dan
`doc.setFontSize()` PDF menerima `line.s*NOTA_FONT_SCALE` bukan
`line.s` mentah), plus verifikasi visual nyata (render nota contoh ke
PNG di browser headless, dibandingkan manual) — teks terlihat jelas
lebih besar dan margin kiri-kanan jauh lebih mepet ke tepi.

## Pecah baris "TIMBANGAN SEKARANG" yang kepanjangan — ketahuan dari foto struk Bluetooth asli (21 Oktober 2026)

Setelah perbaikan margin/font di atas naik, user kirim **foto nyata
struk tercetak dari printer thermal Bluetooth** — tidak ada perubahan
sama sekali, dan beliau menjelaskan ulang lebih spesifik: "tadi saya
bilang dalam 1 baris tulisan terlalu banyak kata sehingga tulisan
tidak bisa besar karena menampung terlalu banyak kata."

**Kenapa perbaikan sebelumnya tidak kelihatan di foto ini**:
`NOTA_FONT_SCALE`/`NOTA_MARGIN_X_MM` cuma menyentuh `layoutNotaCanvas()`
(JPG) dan `buildNotaPDFBlob()` (PDF) — **bukan**
`escposBytesFromLines()` (jalur Bluetooth, dipakai foto ini). Jalur
Bluetooth itu TIDAK PERNAH melakukan word-wrap sama sekali (beda dari
JPG/PDF yang sudah dibungkus `wrapCanvasLines()` berdasar lebar
piksel) — dia cuma mengirim teks mentah ke printer, lalu printer-nya
sendiri yang auto-wrap kalau kepanjangan, TANPA tahu soal
indentasi/kata — itu sebabnya baris "TIMBANGAN SEKARANG" (`18 Okt 2026
— sprei 180x200 1 set : 1 pcs x Rp20.000 = Rp20.000`, SATU baris
raksasa gabungan tanggal+layanan+qty+harga+subtotal) tercetak padat
dan berantakan persis di foto.

**Diperbaiki di SUMBER datanya**, bukan menambah logic wrap baru
khusus Bluetooth: baris raksasa itu dipecah jadi 2 baris pendek
(`tanggal — layanan` / `qty x harga = subtotal`) di
`buildTempoUsageNotaPDFLines()` & `buildTempoBatchUsageNotaPDFLines()`
(`js/10-nota-cetak.js`), dan kasus serupa di `extraGroupLinesPDF()`
(`js/08-paket.js`, cabang 1-layanan — sebelumnya cuma cabang
multi-layanan yang sudah dipecah jadi baris bullet). Karena SEMUA
format nota (JPG/PDF/Bluetooth/Browser-print) konsumsi array `lines`
yang SAMA PERSIS, perbaikan di sumber ini otomatis ikut benar di
SEMUA format sekaligus — bukan cuma Bluetooth. Baris pertama
(`tanggal — layanan`) tetap bold ukuran `s:10` (jadi cetak dua-kali-
tinggi di printer Bluetooth, `GS ! 0x01`), baris kedua (`qty x harga =
subtotal`) bold `s:9`.

Verifikasi: suite Playwright penuh (217 langkah, 0 FAIL — test baru
memastikan baris "TIMBANGAN SEKARANG" & `extraGroupLinesPDF()` kasus
1-layanan benar-benar terpecah 2 baris, bukan 1 baris gabungan lagi),
plus simulasi nyata `escposBytesFromLines()` di browser headless —
baris yang dulu satu gabungan raksasa sekarang jadi 2 baris pendek
dengan perintah ukuran huruf (`GS !`) yang benar per baris.

## Cetakan Bluetooth: tambah Double-Strike supaya baris bold tidak terlalu tipis (21 Oktober 2026)

Masih dari struk Bluetooth yang sama: user melaporkan "ketebalan font
kurang kelihatan terlalu tipis" untuk baris yang seharusnya tebal
(`b:true`). Akar masalah: `escposBytesFromLines()` cuma mengirim
**ESC E** (Emphasized Mode) untuk bold — di banyak printer thermal
clone murah, efek ESC E sendirian SANGAT HALUS, nyaris tidak
kelihatan beda dari teks normal (beda jauh dari "bold" di layar HP
atau JPG/PDF, yang benar-benar pakai font weight berbeda, bukan
sekadar "emphasis").

Diperbaiki: ditambahkan **ESC G** (Double-Strike Mode, perintah
ESC/POS standar Epson yang didukung luas printer clone) **BARENGAN**
ESC E setiap kali baris bold — printer mencetak tiap titik dua kali
(sedikit bergeser), hasilnya jauh lebih tebal & kontras tanpa perlu
mengubah ukuran huruf sama sekali. Keduanya dimatikan lagi
bersamaan di akhir dokumen (dan setiap kali baris berikutnya bukan
bold) — simetris dengan cara ESC E dimatikan sebelumnya.

Verifikasi: suite Playwright penuh (218 langkah, 0 FAIL — test baru
memastikan ESC G 1 (double-strike ON) selalu dikirim BARENGAN ESC E 1
sebelum baris bold, dan keduanya dimatikan lagi (ESC G 0 + ESC E 0)
sebelum baris yang tidak bold maupun di akhir dokumen).

## JPG/PDF: teks ditebalkan via stroke, bukan cuma keyword "bold" (22 Oktober 2026)

Masih soal ketebalan, kali ini di format JPG: user bandingkan foto nota
dan minta jelas: "Ketebalan font kurang kelihatan terlalu tipis. Buat
seperti font dinota bagian atas yang tebal. Dan yang sudah tebal
diatas tambah lagi ketebalannya supaya ada perbedaan antar yang bold
dan tidak." Dua permintaan sekaligus: (1) semua teks terasa kurang
tebal secara umum, dan (2) baris yang SUDAH `b:true` tidak cukup beda
dari baris biasa — kontrasnya kurang.

Akar masalah: `buildNotaCanvas()` cuma mengandalkan keyword CSS/canvas
`"bold"` (font-weight bawaan varian Bold dari 'Courier New') dan
`buildNotaPDFBlob()` cuma mengandalkan font Courier-Bold bawaan jsPDF
— keduanya TIDAK CUKUP tebal menurut user di resolusi/ukuran nota
ini, dan beda bold-vs-normal yang dihasilkan cuma seadanya font
family itu sendiri, tidak terkontrol dari kode.

Diperbaiki: `buildNotaCanvas()` sekarang menggambar SEMUA teks lewat
`strokeText()` (garis tepi tipis) DITAMBAH `fillText()` seperti biasa
— trik "faux bold" klasik di canvas, bukan cuma mengandalkan
font-weight. Baris `b:true` dapat `lineWidth` stroke **2x lebih
tebal** dari baris biasa, supaya kontrasnya jelas. `buildNotaPDFBlob()`
dibuat analog memakai fitur asli PDF: `renderingMode:'fillThenStroke'`
(operator PDF `Tr 2` — isi lalu garis tepi) pada SEMUA `doc.text()`,
dengan `doc.setLineWidth()` 2x lebih tebal untuk baris bold. Nilai
stroke width awal (0.045× ukuran huruf) sempat dicoba dulu dan
hasilnya JUSTRU merusak bentuk huruf (bergerigi/blobby di font besar)
— diturunkan jadi 0.015× setelah verifikasi visual nyata (render
contoh nota ke PNG, dibandingkan manual) supaya hasilnya tebal tapi
tetap rapi, bukan berantakan.

Verifikasi: suite Playwright penuh (219 langkah, 0 FAIL — test baru
me-monkeypatch `CanvasRenderingContext2D.prototype.strokeText`/
`fillText` untuk memastikan `lineWidth` baris bold TEPAT 2x baris
biasa di JPG, dan `setLineWidth()`/`renderingMode` yang sama di PDF),
plus verifikasi visual nyata (render ulang contoh nota ke PNG 2x —
sebelum & sesudah turunkan koefisien stroke — dibandingkan manual).
