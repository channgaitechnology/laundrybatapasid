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

## Migrasi database manual yang perlu dijalankan

Fitur **ganti logo toko** (Pengaturan → Logo Toko) butuh satu kolom baru di
tabel `settings` yang belum ada di database — repo ini tidak punya sistem
migrasi, jadi jalankan sendiri sekali di Supabase SQL Editor:

```sql
alter table settings add column if not exists logo_url text;
```

Sebelum kolom ini ada, tombol "Pilih Logo Baru" / "Pakai Logo Default" akan
gagal dengan toast error (fitur lain di app tidak terpengaruh — Nama/Alamat/
Telepon/Catatan Kaki Nota tetap tersimpan seperti biasa lewat kolom yang
sudah ada).

## Belum dikerjakan / perlu diperiksa

- [x] Buat ulang `manifest.json` + ikon PWA yang hilang — selesai, lihat di atas
- [x] Sambungkan repo ini ke Netlify — selesai 19 Agustus 2026, situs `laundrybatapasid.netlify.app` sekarang berlabel "Deploys from GitHub". Commit ini dipakai sebagai tes: kalau perubahan kecil di berkas ini muncul di situs live setelah push, berarti auto-deploy benar-benar aktif.
- [ ] Tinjauan `/tim-studio` menyeluruh belum pernah dilakukan untuk proyek ini — kode sebesar ini dalam satu file belum pernah direview dari sisi arsitektur/keamanan/UX
