# Laundry Batapas.id — Aplikasi Kasir Laundry

Aplikasi kasir/nota untuk usaha laundry — timbang cucian masuk, kelola transaksi,
cetak/kirim nota (gambar & PDF), laporan bulanan & per pelanggan, sistem
trial/langganan, panel admin untuk kode pendaftaran & pembayaran.

## Asal kode ini

Aplikasi ini awalnya dibangun lewat percakapan biasa di claude.ai (bukan Claude
Code), lalu di-deploy ke Netlify tanpa kode sumbernya pernah tersimpan di git.
Berkas `index.html` di repo ini **dipulihkan langsung dari situs yang sudah
live** (`laundrybatapasid.netlify.app`) pada 19 Agustus 2026 — bukan disalin
dari chat aslinya (link share chat-nya tidak bisa dibaca otomatis).

## Struktur

Satu berkas `index.html` (~3.300 baris) — HTML, CSS, dan JS semua digabung
dalam satu file, tanpa build step. Dependensi lewat CDN:

- [`@supabase/supabase-js`](https://supabase.com/) — auth & database
- [`jsPDF`](https://github.com/parallax/jsPDF) — cetak nota/laporan jadi PDF

Project Supabase yang dipakai: `ffpgapgvlzhetrkzmhqh.supabase.co` (kunci publik
`sb_publishable_...` sudah ada di kode — ini memang dirancang publik oleh
Supabase, keamanan data sesungguhnya ada di Row Level Security sisi database,
bukan di kerahasiaan kunci ini).

## Diketahui rusak (ditemukan saat pemulihan, belum diperbaiki)

`index.html` me-link dua berkas yang **ternyata tidak ikut ter-deploy** ke
Netlify (keduanya balik 404 saat dicek):

- `manifest.json`
- `icons/icon-192.png`

Akibatnya, fitur "install ke layar utama" (PWA) kemungkinan besar tidak
berfungsi di production sekarang. Berkas fisiknya juga tidak ada di repo ini
(tidak pernah tersimpan, tidak cuma lupa di-commit) — perlu dibuat ulang dari
awal, bukan sekadar dipindahkan.

## Belum dikerjakan / perlu diperiksa

- [ ] Buat ulang `manifest.json` + ikon PWA yang hilang (lihat di atas)
- [x] Sambungkan repo ini ke Netlify — selesai 19 Agustus 2026, situs `laundrybatapasid.netlify.app` sekarang berlabel "Deploys from GitHub". Commit ini dipakai sebagai tes: kalau perubahan kecil di berkas ini muncul di situs live setelah push, berarti auto-deploy benar-benar aktif.
- [ ] Tinjauan `/tim-studio` menyeluruh belum pernah dilakukan untuk proyek ini — kode sebesar ini dalam satu file belum pernah direview dari sisi arsitektur/keamanan/UX
