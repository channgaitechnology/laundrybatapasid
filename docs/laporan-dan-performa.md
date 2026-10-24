# Laporan dan Performa Data

Pelunasan susulan (`lunas_at`) dan window muat transaksi 6 bulan.

[← Kembali ke README](../README.md)

<!-- isi-dipindah-dari-README -->

## Laporan bulan "ditutup" berubah karena pelunasan susulan — kolom `lunas_at` + metrik "Kas Masuk Bulan Ini"

Ditemukan lewat audit 9 Oktober 2026, dikerjakan 12 Oktober 2026 (Opsi A,
lihat diskusi di sesi chat): nota 28 September status `'belum'`, baru
dibayar & ditandai lunas 3 Oktober — uangnya tetap kehitung "Sudah
Lunas" **September** di Laporan, karena satu-satunya tanggal yang ada
cuma `tanggal` (tanggal nota). Ini pola standar *cash-basis accounting*
yang sama dipakai software akuntansi (QuickBooks/Sage: "on cash basis,
the payment is not recorded until it is actually made") — butuh kolom
tanggal pelunasan TERPISAH dari tanggal nota.

```sql
alter table transactions add column if not exists lunas_at date;
```

Aman dijalankan kapan saja — kolom nullable, transaksi lama tetap
tampil seperti biasa (`lunas_at` kosong untuk baris yang belum pernah
disentuh kode baru). `submitTransaction()`/`toggleLunas()`/
`markSubsLunas()` sekarang mengisi `lunas_at` persis di momen status
berubah jadi `'lunas'` (bukan tanggal nota, kecuali nota itu memang
langsung dibuat lunas sejak awal).

**SENGAJA TIDAK mengganti** metrik "Sudah Lunas" yang sudah ada (tetap
pakai `tanggal`, tetap menjaga identitas "Sudah Lunas + Belum Lunas =
Total Omzet" yang didokumentasikan di `trxCashReceived()`,
`js/09-utils.js`) — itu sudut pandang *accrual* yang valid ("dari nota
bulan ini, berapa yang sudah tertagih SAMPAI SEKARANG", wajar berubah
seiring waktu). Sebagai gantinya, Laporan Bulanan (`js/18-laporan.js`)
dapat **kartu baru terpisah**, "Kas Masuk Bulan Ini" (`stKasMasuk` di
`index.html`) — dihitung dari `lunas_at`, bukan `tanggal`, jadi
benar-benar uang yang diterima selama bulan itu (termasuk pelunasan
nota bulan lalu) dan **tidak berubah lagi** setelah bulan itu lewat.

## Window muat default 6 bulan untuk `transactions` — hemat kuota *egress* Supabase

Dikerjakan 12 Oktober 2026. Sebelumnya `loadTransactionsFromDB()` (sudah
dipaginasi lewat `fetchAllRows()`/`.range()` berulang, lihat bagian
paginasi di atas) selalu memuat **SELURUH riwayat transaksi toko** ke
memori setiap kali app dibuka — makin lama toko beroperasi, makin besar
data yang didownload ulang tiap buka app (lihat `sw.js`: strategi
*network-first*, `fetch(req,{cache:'reload'})`, jadi app shell MAUPUN
data selalu didownload ulang, tidak pernah dari cache browser). Ini jadi
bottleneck kuota *database egress* Supabase (Free tier: 5GB/bulan) jauh
sebelum kuota lain (Netlify build minutes, dsb) kehabisan.

**Perbaikan**: `loadTransactionsFromDB()` (`js/05-admin.js`) sekarang
cuma memuat transaksi `TRANSACTIONS_LOAD_MONTHS` (6) bulan terakhir
(filter `.gte('tanggal', <cutoff>)`), dan menyetel 2 global baru
(`js/00-globals.js`):

- `transactionsFullyLoaded` (boolean) — `true` kalau `transactions`
  sudah berisi SELURUH riwayat (tidak ada lagi yang ketinggalan di
  database).
- `transactionsWindowStart` (tanggal `YYYY-MM-DD` atau `null`) — tanggal
  paling lama yang DIJAMIN lengkap di memori; `null` kalau
  `transactionsFullyLoaded` true.

Begitu user butuh data LEBIH LAMA dari window itu, `ensureAllTransactionsLoaded()`
(juga di `js/05-admin.js`) mem-backfill SISA riwayat lewat `.lt('tanggal',
transactionsWindowStart)`, gabung ke `transactions` di DEPAN (urutan
tanggal tetap benar), lalu set `transactionsFullyLoaded=true`. Dipanggil
`await`, dan no-op (tidak fetch ulang) kalau sudah pernah dalam sesi yang
sama. Dilindungi guard `_transactionsLoadingPromise` dari race condition
kalau terpanggil berkali-kali hampir bersamaan (mis. tiap keystroke di
kotak cari Rekap Pelanggan) — semua pemanggil berbagi SATU fetch yang
sama, tidak duplikat baris.

Fitur yang butuh **seluruh riwayat** (Rekap Pelanggan & Peringkat
Pelanggan secara eksplisit TETAP dijamin benar — ini pola nyata yang
pernah jadi bug produksi lewat PR #19, jadi SENGAJA tidak dikorbankan
demi hemat kuota) memicu `ensureAllTransactionsLoaded()` otomatis,
tanpa user perlu tahu ada "batasan" sama sekali:

- Laporan Per Pelanggan, Laba Rugi, Peringkat Pelanggan (`js/18-laporan.js`)
- Cari nama & lihat hasil Rekap Pelanggan (`js/22-rekap-pelanggan.js`)
- Unduh gambar JPG Daftar Tugas dengan rentang tanggal custom
  (`js/17-papan-laundry.js`) — tampilan papan kerja normal TETAP dibatasi
  cutoff-nya sendiri (`papanHapusDateThreshold()`), tidak terpengaruh

Laporan Bulanan (`renderReport()`) dan Riwayat (`renderHistory()`) lebih
pelit: cuma mem-backfill kalau bulan/filter tanggal yang dipilih user
memang mundur ke SEBELUM window 6 bulan itu (bandingkan lewat
`monthsBeforeYM()`, `js/09-utils.js`) — supaya pemakaian normal
sehari-hari (lihat laporan bulan ini, cari transaksi minggu lalu) tidak
memicu fetch tambahan sama sekali.
