# Nota, Cetak, dan Pengiriman

Cetak Bluetooth (printer thermal), notifikasi WhatsApp saat kerjaan selesai, dan footer nota.

[← Kembali ke README](../README.md)

<!-- isi-dipindah-dari-README -->

## Cetak Bluetooth (printer thermal)

Nota (transaksi biasa, invoice paket, nota timbangan) sekarang bisa dicetak
langsung ke printer thermal Bluetooth 58mm/80mm lewat tombol "🖨️ Cetak
Bluetooth" di setiap layar kirim nota, atau lewat Pengaturan → Printer
Bluetooth. Pakai [Web Bluetooth API](https://developer.mozilla.org/docs/Web/API/Web_Bluetooth_API)
(browser yang mengirim perintah ESC/POS mentah ke printer lewat BLE),
jadi tidak perlu app tambahan.

Batasan penting:

- **Cuma jalan di Chrome/Edge Android atau Chrome/Edge desktop.** Safari
  (termasuk semua browser di iPhone/iPad, karena semuanya pakai mesin
  WebKit) TIDAK mendukung Web Bluetooth sama sekali — tombolnya akan
  menampilkan pesan error, bukan crash.
- Printer harus tersambung lewat Bluetooth Low Energy (BLE) dengan salah
  satu service UUID umum yang sudah didaftarkan di `BT_PRINTER_SERVICE_UUIDS`
  (index.html) — kebanyakan printer thermal murah 58mm pakai UART service
  ISSC/Microchip (`49535343-fe7d-...`) atau varian generic printer service.
  Printer yang cuma mendukung Bluetooth Classic/SPP (bukan BLE) tidak akan
  terdeteksi Web Bluetooth API — kalau ada laporan printer tidak
  ditemukan, tambahkan UUID service printer tersebut ke daftar itu.
- Koneksi Bluetooth-nya per-tab browser — tidak otomatis tersambung lagi
  setelah REFRESH HALAMAN, harus pilih printer lagi lewat dialog Bluetooth
  bawaan browser (perlu gestur user, tidak bisa otomatis). TAPI selama tab-nya
  belum di-refresh, kalau printer sempat putus sendiri di tengah pemakaian
  (umum terjadi — printer thermal murah banyak yang auto-sleep kalau idle
  beberapa detik), `connectBluetoothPrinter()` otomatis coba sambung ULANG ke
  device yang SAMA dulu (`device.gatt.connect()`, tanpa dialog pilih printer
  lagi) sebelum jatuh ke `requestDevice()` — jadi cuma perlu pilih printer
  sekali per sesi tab, bukan tiap kali mau cetak lagi setelah idle.
- Emoji dan simbol unicode di nota (—, •, ✓, 🟢, 📧) otomatis dibuang/
  diganti ASCII sebelum dicetak (lewat `sanitizeForThermal()`) karena
  kebanyakan printer thermal murah cuma mendukung ASCII/CP437.

**Solusi untuk iPhone/iPad**: karena Web Bluetooth tidak ada sama sekali di
Safari/WebKit, tiap layar kirim nota juga punya tombol kedua "🖨️ Cetak
(AirPrint / Printer Lain)" yang jalan di SEMUA browser — cukup me-render
nota sebagai HTML sederhana lalu memanggil `window.print()` bawaan
browser (lewat `printLinesViaBrowser()`). Di iPhone, dialog cetak Safari
otomatis menampilkan printer AirPrint yang ada di jaringan WiFi yang sama.
Ini bukan pengganti 1:1 Bluetooth — pemilik toko yang mau pakai jalur ini
di iPhone perlu printer thermal yang mendukung WiFi/AirPrint (banyak
printer thermal murah sekarang dual Bluetooth+WiFi), bukan printer
Bluetooth-only. Alternatif tanpa printer AirPrint sama sekali: pakai
"Unduh / Bagikan Nota (JPG)" yang sudah ada, lalu cetak lewat Share Sheet
iOS → Print.


## Notifikasi WA saat kerjaan Selesai

Pengaturan → "Notifikasi WA Otomatis" punya satu toggle: "Kirim notifikasi
WA otomatis saat Selesai". Butuh kolom baru di tabel `settings` — jalankan
sekali di Supabase SQL Editor:

```sql
alter table settings add column if not exists auto_notify_selesai boolean;
```

Nullable & aman dijalankan kapan saja — kolomnya `null` untuk semua baris
lama, diperlakukan sebagai `false` (mati) di kode, jadi toko yang sudah
ada perilakunya tidak berubah sampai pemiliknya sendiri yang menyalakan
togglenya. **Defaultnya MATI** (bukan opt-out) — mengingat app ini
dipakai toko yang sudah berjalan, popup WA otomatis setiap kali status
kerjaan diubah jadi "Selesai" bisa mengagetkan kalau tiba-tiba aktif
tanpa diminta.

- **Kalau toggle AKTIF**: begitu status kerjaan di kartu Daftar Tugas
  diubah jadi "Selesai" (lewat `setWorkStatus()`), WhatsApp langsung
  terbuka (`openWA()`, jalur wa.me yang sama dipakai fitur kirim nota
  lain) dengan pesan "laundry Anda sudah selesai, siap diambil" yang
  sudah terisi otomatis — nama toko/outlet & alamatnya ikut memakai
  `notaHeaderInfo()` seperti nota lainnya.
- **Kalau toggle MATI**: setiap kartu Daftar Tugas yang berstatus
  "Selesai" menampilkan tombol manual "📣 Kirim Notifikasi" yang
  melakukan hal yang persis sama, tinggal diketuk kapan saja kasir mau.
- ⚠️ **Bukan pengiriman otomatis 100% tanpa sentuhan.** Ini web app biasa
  lewat wa.me (bukan WhatsApp Business API resmi yang berbayar & perlu
  verifikasi Meta) — jadi "otomatis" di sini artinya jendela WhatsApp
  dengan pesan siap kirim langsung terbuka begitu status diubah, tapi
  tombol "Kirim" terakhir di WhatsApp-nya tetap perlu satu ketukan
  manusia. Tidak ada cara mengirim WA benar-benar diam-diam dari browser
  tanpa infrastruktur WhatsApp Business API di server.
- Pelanggan tanpa nomor WA tercatat (baik di transaksi biasa maupun
  paket) otomatis dilewati dengan notifikasi toast, tidak memblokir
  perubahan status kerjanya.


## Footer Nota (Kredit Pengembang) — Bisa Diedit

Baris "dikembangkan oleh Tinggiran Tech Studio / Bikin Apps & Website
Kilat / WA & email" yang muncul di bawah SEMUA nota (WA text, PDF, JPG,
HTML) sekarang bisa diedit lewat Pengaturan → Admin Platform → "Footer
Nota" (khusus akun `ADMIN_EMAIL`) — penting kalau app ini dipakai atau
dijual ulang oleh pihak lain, supaya tidak perlu mengubah kode untuk
ganti kredit pengembangnya. Ini **satu nilai global untuk semua toko**
yang pakai instance app ini, bukan pengaturan per-toko (beda dari
Nama/Alamat/Telepon Toko yang memang per-toko).

Butuh tabel baru — jalankan sekali di Supabase SQL Editor:

```sql
create table if not exists app_branding (
  id bigint primary key,
  dev_nama text not null,
  dev_tagline text,
  dev_wa text,
  dev_email text
);

alter table app_branding enable row level security;

create policy "Semua user login bisa baca footer nota"
on app_branding for select
using (auth.role() = 'authenticated');

create policy "Semua user login bisa ubah footer nota"
on app_branding for all
using (auth.role() = 'authenticated')
with check (auth.role() = 'authenticated');
```

⚠️ RLS di atas sengaja permisif (siapa saja yang login bisa ubah lewat
API langsung) — proteksinya murni di level UI (form "Footer Nota" cuma
tampil untuk `ADMIN_EMAIL`). Risikonya rendah (satu baris teks footer,
bukan data keuangan), tapi kalau mau lebih ketat, tulis ulang policy
`for all` di atas supaya cuma mengizinkan `auth.uid()` milik akun admin
tertentu. (Catatan: `registration_codes`/`payment_requests` TIDAK pakai
model permisif seperti ini — keduanya dibatasi admin-only + beberapa
policy sempit per-pemilik, lihat bagian "RLS `registration_codes` &
`payment_requests`" di [keamanan-dan-rls.md](keamanan-dan-rls.md).)

Aman dijalankan kapan saja — kalau tabelnya belum ada, `loadAppBranding()`
diam-diam gagal dan tetap pakai nilai default (persis sama seperti
sebelumnya, "Tinggiran Tech Studio"), jadi tidak ada perubahan tampilan
sampai admin benar-benar mengisi & menyimpan form-nya.
