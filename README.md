# Laundry Batapas.id — Aplikasi Kasir Laundry

Aplikasi kasir/nota untuk usaha laundry — timbang cucian masuk, kelola transaksi,
cetak/kirim nota (gambar & PDF), laporan bulanan & per pelanggan, sistem
trial/langganan, panel admin untuk kode pendaftaran & pembayaran.

Nama produk untuk pelanggan: **Dokter Laundry** (The Myth Tech). Situs live:
`laundrybatapasid.netlify.app`. Deploy ke production otomatis lewat Netlify
begitu PR di-merge ke `main`.

## Asal kode ini

Aplikasi ini awalnya dibangun lewat percakapan biasa di claude.ai (bukan Claude
Code), lalu di-deploy ke Netlify tanpa kode sumbernya pernah tersimpan di git.
Berkas `index.html` di repo ini **dipulihkan langsung dari situs yang sudah
live** pada 19 Agustus 2026 — bukan disalin dari chat aslinya (link share
chat-nya tidak bisa dibaca otomatis).

## Struktur

- `index.html` — HTML & CSS. Logika JavaScript dipecah jadi modul
  `js/00-globals.js` … `js/23-unduhan.js`, dimuat berurutan lewat
  `<script src>` biasa (bukan ES module). **Urutan tag `<script>` penting.**
  Tanpa build step.
- `netlify/functions/*.js` — Netlify Functions (Node, server-side) untuk
  pembayaran Midtrans, notifikasi email/push, dan pencarian komunitas.
- `marketing.html` — alat internal admin platform.
- `sw.js`, `manifest.json`, `icons/` — PWA.
- `tests/` — suite regression Playwright dan tes Node untuk Functions
  (lihat [`tests/README.md`](tests/README.md)). Jalankan sebelum push kalau
  mengubah `index.html` atau `js/*.js`.

Dependensi front-end lewat CDN:

- [`@supabase/supabase-js`](https://supabase.com/) — auth & database
- [`jsPDF`](https://github.com/parallax/jsPDF) — cetak nota/laporan jadi PDF
- [`html2canvas`](https://html2canvas.hertzen.com/) — unduh tampilan Daftar Tugas jadi gambar JPG

Project Supabase: `ffpgapgvlzhetrkzmhqh.supabase.co`. Kunci publik
`sb_publishable_...` memang ada di kode — dirancang publik oleh Supabase;
keamanan data sesungguhnya ada di Row Level Security sisi database, bukan di
kerahasiaan kunci ini.

## Dokumentasi

Dokumentasi dipecah per topik supaya mudah dicari. Isinya dipindah apa adanya
dari README lama.

| Topik | Isi |
|---|---|
| [Migrasi Database](docs/migrasi-database.md) | Semua SQL yang harus dijalankan manual di Supabase (logo, pengeluaran, Daftar Tugas, multi-outlet, RPC undangan kasir). **Baca dulu sebelum memakai versi app terbaru.** |
| [Keamanan & RLS](docs/keamanan-dan-rls.md) | Kebijakan RLS, temuan audit keamanan + SQL perbaikannya, audit DoS |
| [Pembayaran Midtrans](docs/pembayaran-midtrans.md) | Perpanjangan langganan otomatis: env var, webhook, tombol "Bayar Otomatis" |
| [Notifikasi](docs/notifikasi.md) | Email admin (Resend), lonceng notifikasi, Web Push |
| [Email Auth Supabase](docs/setup-email-auth.md) | Redirect URL, jatah email, template email |
| [Nota & Cetak](docs/cetak-dan-nota.md) | Printer Bluetooth, notifikasi WA saat selesai, footer nota |
| [Fitur Aplikasi](docs/fitur-aplikasi.md) | Riwayat edit, Catatan, nomor nota, navigasi keyboard |
| [Laporan & Performa](docs/laporan-dan-performa.md) | `lunas_at` / Kas Masuk, window muat 6 bulan |
| [Referral](docs/referral.md) | Program referral dan kolom pembuat transaksi |
| [Admin Platform](docs/admin-platform.md) | `marketing.html`, riset komunitas, banyak akun admin |
| [Catatan Perubahan](CHANGELOG.md) | Riwayat perbaikan, regresi, dan audit bertanggal |

### Indeks bagian

Kode dan komentar sering menulis "lihat README bagian X". Bagian-bagian itu
sekarang ada di sini:

- **Migrasi database manual yang perlu dijalankan**, **Klaim kode undangan kasir — RPC `claim_invite_code`** → [docs/migrasi-database.md](docs/migrasi-database.md)
- **Cetak Bluetooth (printer thermal)**, **Notifikasi WA saat kerjaan Selesai**, **Footer Nota (Kredit Pengembang)** → [docs/cetak-dan-nota.md](docs/cetak-dan-nota.md)
- **Riwayat Edit**, **Catatan**, **Nomor Nota berbasis database**, **Navigasi PageUp/PageDown**, **Navigasi ArrowUp/ArrowDown + Enter** → [docs/fitur-aplikasi.md](docs/fitur-aplikasi.md)
- **Email Auth Supabase** → [docs/setup-email-auth.md](docs/setup-email-auth.md)
- **Integrasi Pembayaran Otomatis (Midtrans)** (termasuk "bagian 4: Belum termasuk") → [docs/pembayaran-midtrans.md](docs/pembayaran-midtrans.md)
- **Notifikasi Email untuk Permintaan Baru**, **Lonceng Notifikasi Admin Platform**, **Notifikasi Push (Web Push)** → [docs/notifikasi.md](docs/notifikasi.md)
- **RLS `registration_codes` & `payment_requests`**, semua temuan **KRITIS / MEDIUM**, rate limit `payment_requests`, **Audit DoS** → [docs/keamanan-dan-rls.md](docs/keamanan-dan-rls.md)
- **Program Referral**, **`created_by`/`created_by_nama`** → [docs/referral.md](docs/referral.md)
- **Alat Internal: Marketing Dokter Laundry**, **Riset Komunitas**, **Kontak Laundry**, **Lebih dari 1 akun Admin Platform** → [docs/admin-platform.md](docs/admin-platform.md)
- **Laporan bulan "ditutup"** (`lunas_at`), **Window muat default 6 bulan** → [docs/laporan-dan-performa.md](docs/laporan-dan-performa.md)
- **Diketahui rusak**, semua entri **REGRESI**, perbaikan UX dan nota bertanggal Oktober 2026 → [CHANGELOG.md](CHANGELOG.md)

## Menjalankan tes

Dari root project, jalankan server lokal, lalu suite di folder `tests/`:

```bash
python3 -m http.server 8931
cd tests
PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-*/chrome-linux/chrome node test.mjs
```

Detail lengkap, termasuk tes Netlify Functions, ada di
[`tests/README.md`](tests/README.md). Aturan kerja dan konvensi proyek ada di
[`CLAUDE.md`](CLAUDE.md).
