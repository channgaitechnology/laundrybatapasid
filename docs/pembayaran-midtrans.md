# Pembayaran Otomatis (Midtrans)

Perpanjangan langganan lewat Midtrans: migrasi, environment variables, webhook, dan cara menyalakan tombol "Bayar Otomatis".

[← Kembali ke README](../README.md)

<!-- isi-dipindah-dari-README -->

## Integrasi Pembayaran Otomatis (Midtrans) — perpanjangan langganan

Tombol "💳 Bayar Otomatis (QRIS / VA / E-wallet)" di modal perpanjangan
langganan (paywallModal) memanggil `payViaMidtrans()`
(`js/03-langganan.js`), yang meminta link pembayaran Snap dari
**Netlify Function** `netlify/functions/midtrans-create-transaction.js`,
lalu Midtrans mengirim notifikasi hasil pembayaran ke
`netlify/functions/midtrans-webhook.js`, yang memperpanjang
`app_subscriptions.paid_until` secara otomatis (pengganti klik manual
admin di Admin Platform).

Kenapa lewat Netlify Function (bukan langsung dari browser ke API
Midtrans): Server Key Midtrans itu rahasia dan wajib dipakai untuk
autentikasi ke Midtrans serta memverifikasi tanda tangan notifikasi —
kalau ditaruh di kode browser, siapa saja bisa mencurinya dari DevTools.

### 1. Migrasi database — kolom baru di `payment_requests`

Jalankan sekali di Supabase SQL Editor:

```sql
alter table payment_requests add column if not exists order_id text unique;
alter table payment_requests add column if not exists gross_amount numeric;
alter table payment_requests add column if not exists plan_days integer;
alter table payment_requests add column if not exists paid_at timestamptz;
```

Aman dijalankan kapan saja — sebelum migrasi ini dijalankan, tombol Bayar
Otomatis akan gagal dengan toast error, tapi jalur manual (transfer +
konfirmasi WA ke admin, tombol "Setujui" di Admin Platform) tetap berfungsi
seperti biasa.

### 2. Environment variables di Netlify

Site settings → Environment variables (bukan di file/kode manapun, supaya
tidak ikut ter-commit ke git):

| Nama | Contoh nilai | Keterangan |
|---|---|---|
| `MIDTRANS_SERVER_KEY` | `SB-Mid-server-xxxxx` | Server Key dari dashboard Midtrans. Pakai yang **Sandbox** dulu untuk uji coba. |
| `MIDTRANS_IS_PRODUCTION` | `false` | `"true"` cuma kalau `MIDTRANS_SERVER_KEY` di atas sudah Server Key **Production**. |
| `SUBSCRIPTION_PRICE_1M` | `50000` | Harga paket 1 Bulan (30 hari), angka saja tanpa "Rp"/titik. |
| `SUBSCRIPTION_PRICE_3M` | `135000` | Harga paket 3 Bulan (90 hari). |
| `SUBSCRIPTION_PRICE_6M` | `240000` | Harga paket 6 Bulan (180 hari). |
| `SUBSCRIPTION_PRICE_12M` | `420000` | Harga paket 12 Bulan (365 hari). |
| `SUBSCRIPTION_PRICE_LIFETIME` | `1500000` | Harga paket Seumur Hidup. Internal disimpan sebagai 36500 hari (~100 tahun) dari tanggal aktivasi/perpanjangan terakhir -- BUKAN kolom/flag terpisah, jadi lewat jalur perhitungan tanggal yang sama dengan paket lain (lihat komentar `SUBSCRIPTION_PLANS` di `js/00-globals.js`). |
| `SUPABASE_URL` | `https://xxxx.supabase.co` | Sama dengan URL yang dipakai `index.html`. |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...` | Dari Supabase Project Settings → API → `service_role` key. **BUKAN** `anon` key — key ini bisa baca/tulis apa saja tanpa RLS, cuma boleh dipakai di server (Netlify Function), TIDAK PERNAH di kode browser. |

Paket mana saja yang mau diaktifkan cukup dengan mengisi env var
harganya — kosongkan/hapus env var paket yang belum ingin ditawarkan
(function akan menolak permintaan untuk paket yang harganya belum diatur).

### 3. Daftarkan URL webhook di dashboard Midtrans

Dashboard Midtrans → Settings → Configuration → **Payment Notification
URL**, isi dengan:

```
https://laundryassist.netlify.app/.netlify/functions/midtrans-webhook
```

(ganti domain kalau beda dari yang dipakai sekarang). Ini yang dipanggil
Midtrans setiap kali status transaksi berubah — bukan URL yang dibuka
pengguna.

### 4. Belum termasuk (butuh desain terpisah)

Ini baru mengotomatiskan **perpanjangan** langganan toko yang sudah punya
akun (`owner_id` sudah ada, pemilik sedang login). **Pendaftaran toko
baru** (isi form di `paymentInfoModal` sebelum punya akun) masih manual —
otomatisasi untuk itu butuh cara pengiriman kode pendaftaran ke orang yang
belum login sama sekali (lewat email? halaman sukses setelah bayar?),
belum diputuskan.

### 5. Nyalakan tombol "Bayar Otomatis" (cuma SETELAH akun Midtrans aktif)

Midtrans **menolak transaksi production** (error 402, "merchant doesn't
have access") selama akun belum selesai diverifikasi/diaktifkan oleh tim
Midtrans — mengisi env var di atas saja tidak cukup. Supaya pengguna
tidak mencoba tombol yang pasti gagal, tombol "💳 Bayar Otomatis" di
layar perpanjangan langganan **disembunyikan secara default** dan cuma
muncul setelah dinyalakan manual.

Pakai tabel `app_branding` yang sama dengan Footer Nota (lihat migrasinya
di bagian "Footer Nota" di [cetak-dan-nota.md](cetak-dan-nota.md) — jalankan itu dulu kalau belum pernah).
Tambahan kolomnya, jalankan sekali di Supabase SQL Editor (aman dijalankan
berkali-kali):

```sql
alter table app_branding add column if not exists midtrans_enabled boolean not null default false;
```

Setelah akun Midtrans Anda benar-benar aktif (dapat konfirmasi dari
Midtrans, atau sudah berhasil tes transaksi kecil), nyalakan di app:
**Pengaturan → Admin Platform → "Pembayaran Otomatis (Midtrans)"** →
centang "Aktifkan tombol Bayar Otomatis". Bisa dimatikan lagi kapan saja
dengan cara yang sama (mis. kalau akun Midtrans kena suspend) — jalur
transfer manual tidak pernah terpengaruh oleh toggle ini.
