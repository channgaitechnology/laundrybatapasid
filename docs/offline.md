# Mode Offline

[← Kembali ke README](../README.md)

App bisa **dibuka tanpa internet** dan menampilkan data terakhir. Dikerjakan
bertahap:

- **Tahap 1 (sudah jalan): buka & baca offline.** Dijelaskan di bawah.
- **Tahap 2 (belum): transaksi offline + sinkron otomatis.** Antrean transaksi
  baru, ubah status kerja, dan tandai lunas; jatah blok nomor nota per
  perangkat; sinkron saat internet kembali. Sampai tahap ini selesai, banner
  offline menyebut perubahan belum bisa disimpan.

Keputusan desain (disepakati dengan pemilik): cakupan offline hanya **inti
kasir**; edit dan hapus transaksi lama **tetap butuh internet** (menghindari
bentrok data antar kasir/perangkat); nomor nota offline memakai **jatah blok
nomor per perangkat** (nomor di nota langsung resmi, tidak berubah saat sinkron).

## Cara kerja (Tahap 1)

### 1. Service worker (`sw.js`)

| Yang disimpan | Strategi |
|---|---|
| `index.html`, semua `js/*.js`, `manifest.json`, ikon (satu origin) | **Network-first**: coba jaringan dulu supaya rilis baru langsung terpakai; kalau jaringan gagal atau tidak menjawab dalam 6 detik, pakai salinan lokal. Request yang kalah cepat tetap dilanjutkan di latar belakang supaya cache terisi versi terbaru. |
| supabase-js, jsPDF, html2canvas (CDN, versi dipin) | **Cache-first** di cache terpisah `laundry-batapas-cdn-v1`. |
| Google Fonts | Stale-while-revalidate. |
| Navigasi tanpa salinan persis (mis. `/?adminNotif=1`) | Jatuh ke `index.html` tersimpan. |

Yang **sengaja tidak disentuh**: Supabase API/Auth, Netlify Functions
(`/.netlify/`), dan semua request non-GET.

Semua berkas di-precache saat service worker diinstal. Satu berkas gagal
diunduh tidak menggagalkan yang lain (`allSettled`, bukan `addAll`).

**Aturan pemeliharaan** (dijaga oleh `tests/test-sw.mjs`):

- Menambah/menghapus berkas di `js/` → sesuaikan `APP_SHELL` di `sw.js`.
- Mengganti versi pustaka CDN di `index.html` → sesuaikan `CDN_ASSETS` di
  `sw.js` dan naikkan `CDN_CACHE`.
- Setiap perubahan pada `sw.js` atau berkas yang di-precache → naikkan
  `CACHE_NAME`.

### 2. Snapshot data (`js/24-offline.js`)

Setelah data berhasil dimuat online (`initUserData()`), seluruh state toko
disimpan ke **IndexedDB** (`nk-offline`, store `kv`, kunci `snapshot`):
transaksi (window 6 bulan), pengaturan, katalog, pelanggan paket, pengeluaran,
catatan, outlet, langganan, dan identitas/peran. Disimpan lagi tiap 60 detik,
saat tab disembunyikan/ditutup, dan saat koneksi putus.

Pengaman supaya snapshot tidak rusak:

- Tidak disimpan sebelum `initUserData()` selesai (`offlineDataReady`) —
  mencegah data setengah jadi menimpa data lengkap.
- Tidak disimpan saat app berjalan dari snapshot (`offlineMode`).
- Daftar transaksi kosong (misalnya gagal dimuat) tidak menimpa snapshot lama
  yang berisi transaksi.
- Snapshot hanya dipakai untuk **user yang sama** dengan sesi login yang
  terbaca; data toko akun lain di perangkat yang sama tidak pernah muncul.

### 3. Membuka app tanpa internet

- Listener sesi (`index.html`) dan `resolveRoleAndInit()`
  (`js/02-init-data.js`) memeriksa koneksi lebih dulu. Offline → pulihkan state
  dari snapshot, **tidak ada query ke server**.
- Sebelumnya, offline membuat semua query gagal dan terbaca seperti "belum
  punya toko" sehingga user lama disodori layar **pilih peran**. Sekarang error
  jaringan pada pemeriksaan peran (`offlineIsNetworkError()`) tidak lagi
  dianggap akun baru. Akun benar-benar baru (online, tanpa error) tetap
  mendapat layar pilih peran seperti biasa.
- Sinyal ada tapi macet (`navigator.onLine` true, server tak terjangkau): layar
  login menampilkan tombol **"📴 Lanjut offline (data terakhir)"** — muncul hanya
  kalau ada snapshot dan probe ke Supabase gagal.
- Banner **"📴 Mode offline"** tampil selama offline.

### 4. Kembali online

Event `online` → `offlineHandleBackOnline()` memeriksa sesi:

- Sesi sah → keluar dari mode offline dan memuat ulang data asli dari server
  (`resolveRoleAndInit()`), snapshot diperbarui.
- Sesi sudah tidak sah (kedaluwarsa/dicabut) → layar login tampil. Snapshot
  dibiarkan; login berikutnya menggantinya dengan data segar.

### 5. Keluar akun (logout)

- **Butuh internet.** Offline, `signOut()` ke server gagal dan sesi tetap
  tersimpan, sedangkan data toko tidak boleh dihapus sebelum benar-benar keluar.
- Setelah keluar akun **berhasil**, snapshot dihapus supaya data toko tidak
  tertinggal di perangkat yang dipakai orang lain. Kalau `signOut()` gagal,
  snapshot dibiarkan.

## Batasan Tahap 1

- Offline hanya **membaca**. Mencoba menyimpan perubahan saat offline gagal
  dengan pesan galat seperti biasa sampai Tahap 2 selesai.
- Pertama kali memakai app (atau setelah keluar akun) tetap butuh internet:
  snapshot baru ada setelah data pernah dimuat online di perangkat itu.
- Transaksi yang lebih lama dari window 6 bulan hanya tersedia offline kalau
  riwayat lengkap pernah dimuat online di sesi itu (`ensureAllTransactionsLoaded()`).
- Fitur yang memang butuh server (pembayaran Midtrans, notifikasi push,
  pencarian komunitas, kirim WhatsApp, unduh font baru) tidak jalan offline.

## Tes

- `node tests/test-sw.mjs` — logika service worker (Node murni, tanpa browser).
- `tests/test-offline.mjs` — Playwright: logika snapshot/boot/logout/koneksi,
  plus uji ujung-ke-ujung di browser sungguhan (server dimatikan + jaringan
  diputus, halaman tetap terbuka dari cache, lalu data asli dimuat ulang saat
  internet kembali).

Lihat [`tests/README.md`](../tests/README.md) untuk cara menjalankan.
