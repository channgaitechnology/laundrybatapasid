# Email Auth Supabase

Konfirmasi daftar dan lupa password.

[← Kembali ke README](../README.md)

<!-- isi-dipindah-dari-README -->

## Email Auth Supabase (konfirmasi daftar & lupa password)

Dua masalah nyata yang pernah terjadi di produksi, dan cara setelnya:

### 1. Site URL / Redirect URLs (link di email mengarah ke `localhost:3000`)

Supabase Dashboard → **Authentication → URL Configuration**:
- **Site URL**: `https://laundryassist.netlify.app` (BUKAN `http://localhost:3000`
  yang jadi default bawaan Supabase).
- **Redirect URLs**: tambahkan `https://laundryassist.netlify.app/**`.

Tanpa ini, link konfirmasi/reset password yang dikirim ke email user akan
mencoba redirect ke `localhost:3000` dan gagal dibuka (`ERR_CONNECTION_REFUSED`)
di perangkat user — meski proses konfirmasinya sendiri sebenarnya SUDAH
berhasil di server Supabase sebelum redirect itu dicoba (Supabase memproses
& menandai email terkonfirmasi SAAT link diklik, baru PALING AKHIR mencoba
redirect ke Site URL). Jadi dampaknya murni UX membingungkan, bukan bug
keamanan.

### 2. Jatah kirim email bawaan Supabase cuma 2/jam SE-PROJECT

Selama belum pasang Custom SMTP, Supabase membatasi **2 email per jam untuk
SELURUH project** (bukan per user) untuk email konfirmasi/lupa password/dll
— gampang kena "email rate limit exceeded" kalau lebih dari 2 user butuh
email dalam jam yang sama. Ini SELALU harus diperbaiki sebelum serius
dipakai banyak toko (komersil).

**Solusi yang dipakai sekarang (cukup untuk skala saat ini, gratis, tanpa
perlu domain sendiri)**: Custom SMTP lewat akun Gmail pribadi, limit naik
jadi 500 email/24 jam. Setelannya di Supabase Dashboard →
**Authentication → Emails → SMTP Settings**:

| Field | Nilai |
|---|---|
| Sender email address | alamat Gmail yang dipakai (harus SAMA PERSIS dengan Username di bawah, tidak bisa alias) |
| Sender name | `Dokter Laundry` (atau nama lain) |
| Host | `smtp.gmail.com` |
| Port number | `587` |
| Username | alamat Gmail yang sama dengan Sender email |
| Password | **App Password** 16 karakter (BUKAN password Gmail biasa) — dibuat di https://myaccount.google.com/apppasswords, setelah Verifikasi 2 Langkah diaktifkan di https://myaccount.google.com/security |

Supabase akan menampilkan peringatan kuning ("designed for sending personal
rather than transactional email messages") saat Host diisi `smtp.gmail.com`
— ini cuma peringatan soal potensi deliverability (bisa lebih sering masuk
folder Spam dibanding provider transaksional khusus), BUKAN error yang
menghalangi Save. Sudah diuji nyata (7 Oktober 2026): email masuk Kotak
Masuk Gmail, bukan Spam.

**Kalau skala makin besar / mulai banyak komplain email masuk Spam**: upgrade
ke Resend (sudah dipakai juga untuk notifikasi admin, lihat bagian
"Notifikasi Email untuk Permintaan Baru" di [notifikasi.md](notifikasi.md)) sebagai Custom SMTP, limit
naik ke 30+/jam dengan deliverability jauh lebih baik — TAPI mensyaratkan
**domain terverifikasi sendiri** (SPF/DKIM via DNS, lihat dashboard Resend →
Domains). `laundryassist.netlify.app` TIDAK BISA diverifikasi untuk ini
karena itu subdomain milik Netlify, bukan domain yang DNS-nya dikuasai
sendiri — perlu beli domain sendiri dulu (bisa langsung lewat menu "Domain
management" di dashboard Netlify, atau registrar manapun).

### 3. Template isi email masih default (Bahasa Inggris)

Isi email konfirmasi/reset password masih pakai template bawaan Supabase
dalam Bahasa Inggris, belum disesuaikan ke Bahasa Indonesia seperti app-nya.
Bisa diedit di **Authentication → Emails → Templates** kapan saja — belum
dikerjakan karena belum diminta.
