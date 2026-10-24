# Notifikasi Admin (Email, Lonceng, Web Push)

Email untuk permintaan baru (Resend + Database Webhook), lonceng notifikasi admin platform, dan Web Push.

[← Kembali ke README](../README.md)

<!-- isi-dipindah-dari-README -->

## Notifikasi Email untuk Permintaan Baru (pendaftaran/perpanjangan manual)

Setiap kali ada baris baru masuk ke tabel `payment_requests` (pendaftar
mengisi `paymentInfoModal`, atau pemilik toko klik "Sudah Transfer
Manual"), admin bisa dapat **email otomatis** — tidak perlu buka Admin
Platform berulang-ulang cuma untuk cek ada permintaan baru atau belum.
Ini murni notifikasi; approve/tolak tetap manual seperti biasa.

Caranya: **Supabase Database Webhook** (fitur bawaan, tanpa kode
tambahan di sisi Supabase) memanggil
`netlify/functions/notify-new-payment-request.js` setiap kali ada
**INSERT** baru ke `payment_requests`, function itu yang kirim email
lewat [Resend](https://resend.com) (gratis, 100 email/hari & 3.000/bulan,
**tidak perlu verifikasi domain** — asal kirim ke alamat email akun
Resend sendiri).

### 1. Daftar Resend & ambil API key

1. Daftar di [resend.com](https://resend.com) pakai email yang sama
   dengan `ADMIN_EMAIL` di kode (`mukhlispertama@gmail.com`) — email ini
   otomatis "terverifikasi" sebagai penerima tanpa perlu setup domain.
2. Buka **API Keys** → buat key baru → salin nilainya (cuma ditampilkan
   sekali).

### 2. Environment variables di Netlify

Tambahkan di **Site settings → Environment variables** (bukan di
kode/git):

| Nama | Contoh nilai | Keterangan |
|---|---|---|
| `RESEND_API_KEY` | `re_xxxxxxxxxxxx` | API key dari langkah 1. |
| `ADMIN_NOTIFY_EMAIL` | `mukhlispertama@gmail.com` | Harus sama dengan email akun Resend (syarat gratisan tanpa domain terverifikasi). |
| `PAYMENT_WEBHOOK_SECRET` | string acak bebas, mis. hasil `openssl rand -hex 16` | Dicocokkan dengan header webhook Supabase di langkah 3 — mencegah orang lain memanggil endpoint ini sembarangan. |

### 3. Buat Database Webhook di dashboard Supabase

Dashboard Supabase proyek ini → **Database → Webhooks** → **Create a new
webhook**:

- **Name**: bebas, mis. `notify-admin-new-request`
- **Table**: `payment_requests`
- **Events**: centang **Insert** saja (jangan Update/Delete)
- **Type**: HTTP Request
- **Method**: `POST`
- **URL**: `https://laundryassist.netlify.app/.netlify/functions/notify-new-payment-request`
- **HTTP Headers**: tambah header
  `X-Webhook-Secret: <nilai yang sama dengan PAYMENT_WEBHOOK_SECRET>`

Simpan. Coba tes dengan isi form pendaftaran (`paymentInfoModal`) atau
klik "Sudah Transfer Manual" di app — email harus masuk ke
`ADMIN_NOTIFY_EMAIL` dalam beberapa detik.


## Lonceng Notifikasi Admin Platform — permintaan pembayaran & akun toko baru

Dikerjakan 12 Oktober 2026. Khusus `ADMIN_EMAILS` (bukan owner/kasir toko
biasa) — sebelumnya satu-satunya cara admin tahu ada `payment_requests`
baru atau toko baru daftar adalah lewat email Resend (cuma untuk
`payment_requests`, lihat bagian "Notifikasi Email untuk Permintaan
Baru" di atas — trial signup organik TIDAK memicu email sama sekali)
atau buka modal Pengaturan → Admin Platform secara manual. Sekarang ada
ikon 🔔 di pojok kanan atas app (`#btnAdminNotif`, sebelah ikon ⚙️
Pengaturan), cuma kelihatan untuk `ADMIN_EMAILS`, dengan badge merah
berisi jumlah total yang butuh perhatian.

App ini tidak punya infrastruktur realtime sama sekali (tidak ada
`supabase.channel`/`postgres_changes` di mana pun) — dipilih **polling**
sederhana tiap 60 detik (`ADMIN_NOTIF_POLL_MS`, `js/05-admin.js`) selagi
admin login, konsisten dengan pola app ini yang lain. Dua sumber beda
cara "dianggap sudah dilihat"-nya:

- **Permintaan pembayaran pending** (`payment_requests` status
  `'menunggu'`) — badge-nya count baris pending apa adanya, otomatis
  berkurang begitu admin benar-benar approve/tolak (`loadAdminData()`
  dipanggil ulang) — TIDAK butuh state "sudah dilihat" terpisah.
- **Akun toko baru** (baris baru di `app_subscriptions`, apa pun status
  akhirnya — trial atau langsung aktif) — TIDAK pernah "selesai
  diproses" kayak payment request, jadi butuh baseline count sendiri,
  disimpan di `localStorage.nk_adminLastSeenAccountCount` (per
  perangkat/browser, bukan per-admin — cukup untuk tim 1-2 admin seperti
  sekarang). Baseline ini diperbarui begitu admin klik lonceng
  (`openAdminNotifPanel()`, langsung lompat ke panel Admin Platform).

Toast singkat ("🔔 Ada permintaan pembayaran baru" / "🔔 Ada akun toko
baru terdaftar") muncul HANYA untuk pertambahan yang terdeteksi SELAGI
admin aktif memakai app (bukan di setiap login/reload) — supaya tidak
spam toast yang sama berulang kali untuk hal yang sudah ada sejak lama.

**Perlu dijalankan sekali di Supabase SQL Editor** supaya admin KEDUA
(`dokterlaundromat@gmail.com`) ikut bisa melihat badge/data ini —
ditemukan saat mengerjakan fitur ini: policy SELECT `payment_requests`
& `app_subscriptions` yang ada ternyata hardcode SATU email admin saja
(`(auth.jwt()->>'email') = 'mukhlispertama@gmail.com'`, sama seperti
pola bug yang sudah diperbaiki di bagian "Ringkasan Admin Platform tidak
tampilkan nama toko lain" di [keamanan-dan-rls.md](keamanan-dan-rls.md)), padahal kode JS-nya sudah mendukung
`ADMIN_EMAILS` (array, 2 email) lewat `isAdminEmail()`. Policy di bawah
ini SENGAJA policy BARU dengan nama berbeda (bukan ganti yang lama) —
policy RLS untuk command yang sama di Postgres digabung dengan OR, jadi
aman ditambahkan tanpa perlu tahu/menyentuh nama policy lama sama sekali:

```sql
create policy "admin_select_all_payment_requests_v2" on payment_requests
  for select
  using ((auth.jwt()->>'email') in ('mukhlispertama@gmail.com','dokterlaundromat@gmail.com'));

create policy "admin_update_all_payment_requests_v2" on payment_requests
  for update
  using ((auth.jwt()->>'email') in ('mukhlispertama@gmail.com','dokterlaundromat@gmail.com'));

create policy "admin_select_all_app_subscriptions_v2" on app_subscriptions
  for select
  using ((auth.jwt()->>'email') in ('mukhlispertama@gmail.com','dokterlaundromat@gmail.com'));
```

Tanpa migrasi ini, lonceng notifikasi (dan ringkasan/approve/tolak di
Admin Platform yang SUDAH ada sebelumnya) tetap jalan seperti biasa
untuk `mukhlispertama@gmail.com`, tapi diam-diam selalu menunjukkan 0
untuk `dokterlaundromat@gmail.com` (bukan error, query-nya cuma balik
array kosong karena RLS).

## Notifikasi Push (Web Push) — muncul + berbunyi walau app tertutup

Dikerjakan 12 Oktober 2026, lanjutan dari lonceng notifikasi di atas.
Badge lonceng di atas CUMA kelihatan selagi tab app ini terbuka (hasil
polling, bukan push sungguhan) — fitur ini menambahkan **Web Push API**
supaya admin benar-benar dapat notifikasi gaya WhatsApp: muncul di
notification tray OS + berbunyi, **walau aplikasinya sedang tertutup**
atau HP terkunci.

**Alur singkatnya**: admin menekan tombol "🔔 Nyalakan Notifikasi Push" di
Pengaturan → Admin Platform (`enableAdminPushNotif()`, `js/05-admin.js`)
→ browser minta izin notifikasi → browser bikin *subscription* (endpoint
unik + 2 kunci enkripsi `p256dh`/`auth`) lewat `PushManager` → disimpan
ke tabel `admin_push_subscriptions` → kapan pun ada `payment_requests`
baru ATAU toko baru daftar, Supabase Database Webhook memicu Netlify
Function yang mengirim notifikasi **terenkripsi** ke endpoint itu lewat
`web-push` (npm package) — app ini sendiri **sama sekali tidak perlu
jalan/terbuka** saat itu terjadi, sw.js (`self.addEventListener('push',
...)`) yang menampilkan notifikasinya begitu browser/OS membangunkannya.

**1. Migrasi database** — tabel baru buat simpan subscription tiap admin/perangkat:

```sql
create table if not exists admin_push_subscriptions (
  id bigint generated always as identity primary key,
  admin_email text not null,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

alter table admin_push_subscriptions enable row level security;

create policy "admin_insert_own_push_subscription" on admin_push_subscriptions
  for insert
  with check ((auth.jwt()->>'email') in ('mukhlispertama@gmail.com','dokterlaundromat@gmail.com'));

create policy "admin_update_own_push_subscription" on admin_push_subscriptions
  for update
  using ((auth.jwt()->>'email') in ('mukhlispertama@gmail.com','dokterlaundromat@gmail.com'));

create policy "admin_delete_own_push_subscription" on admin_push_subscriptions
  for delete
  using ((auth.jwt()->>'email') in ('mukhlispertama@gmail.com','dokterlaundromat@gmail.com'));

create policy "admin_select_own_push_subscription" on admin_push_subscriptions
  for select
  using ((auth.jwt()->>'email') in ('mukhlispertama@gmail.com','dokterlaundromat@gmail.com'));
```

Policy SELECT di atas WAJIB ada meski client tidak pernah secara eksplisit
SELECT baris ini sendiri (ketahuan dari error nyata: `42501 new row violates
row-level security policy`) — `enableAdminPushNotif()` (`js/05-admin.js`)
pakai `.upsert(..., {onConflict:'endpoint'})`, yang di Postgres diterjemahkan
jadi `INSERT ... ON CONFLICT DO UPDATE`. Sejak perbaikan CVE-2017-15099,
jalur UPDATE dari `ON CONFLICT DO UPDATE` **wajib** mengecek baris lama
MAUPUN baris baru lewat policy SELECT, bukan cuma policy INSERT/UPDATE —
tanpa policy SELECT ini, RLS menolak upsert-nya sama sekali walau
INSERT/UPDATE policy-nya sendiri sudah benar.

**2. Pasangan kunci VAPID** — identitas kriptografis aplikasi ini sebagai
"pengirim push" (wajib menurut spesifikasi Web Push, 1 pasang kunci
untuk SELURUH aplikasi, bukan per-admin). Public key-nya SUDAH ditaruh
langsung di kode (`ADMIN_PUSH_VAPID_PUBLIC_KEY`, `js/05-admin.js`) —
aman, memang didesain publik. **Private key-nya dikirim terpisah lewat
chat** (bukan di README ini) — **JANGAN PERNAH** commit ke git dalam
bentuk apa pun, cuma boleh ada sebagai environment variable di dashboard
Netlify (persis aturan `MIDTRANS_SERVER_KEY`/`SUPABASE_SERVICE_ROLE_KEY`
di atas). Kalau private key itu hilang/perlu diganti, generate pasangan
baru (`npx web-push generate-vapid-keys`) — tapi WAJIB ganti juga
`ADMIN_PUSH_VAPID_PUBLIC_KEY` di kode, DAN setiap admin yang sudah
menekan "Nyalakan Notifikasi Push" harus menekan tombol itu ULANG di
semua perangkatnya (subscription lama jadi tidak valid begitu kunci
publiknya beda).

**3. Environment variables TAMBAHAN di Netlify** (gunakan nilai yang
SAMA dengan env var Midtrans yang sudah ada untuk `SUPABASE_URL`/
`SUPABASE_SERVICE_ROLE_KEY` kalau sudah pernah diisi):

| Env var | Keterangan |
|---|---|
| `VAPID_PUBLIC_KEY` | Sama persis dengan `ADMIN_PUSH_VAPID_PUBLIC_KEY` di `js/05-admin.js`. |
| `VAPID_PRIVATE_KEY` | **Rahasia** — dikirim lewat chat, jangan commit. |
| `SUPABASE_URL` | URL project Supabase (`https://xxxx.supabase.co`). |
| `SUPABASE_SERVICE_ROLE_KEY` | Sama dengan yang dipakai `midtrans-webhook.js` — **rahasia**, jangan commit. |

`ADMIN_NOTIFY_EMAIL`/`PAYMENT_WEBHOOK_SECRET` dipakai ulang dari
konfigurasi Resend yang sudah ada (lihat bagian "Notifikasi Email"), tidak
perlu env var rahasia baru lagi khusus push.

**4. Daftarkan Database Webhook KEDUA di dashboard Supabase** (Database →
Webhooks) — webhook PERTAMA untuk `payment_requests` INSERT ke
`notify-new-payment-request.js` HARUSNYA SUDAH ada dari fitur email
sebelumnya (fungsi itu sekarang JUGA mengirim push, tidak perlu webhook
terpisah). Tambahkan SATU LAGI, khusus toko baru:

- **Table**: `app_subscriptions`
- **Events**: Insert saja
- **Type**: HTTP Request, method POST
- **URL**: `https://<situs-kamu>.netlify.app/.netlify/functions/notify-new-account`
- **HTTP Headers**: `X-Webhook-Secret: <nilai PAYMENT_WEBHOOK_SECRET yang sama>`

**5. Dependency `web-push`** (`package.json` di **ROOT repo**, BUKAN di
`netlify/functions/`) — percobaan pertama menaruh `package.json` di
dalam `netlify/functions/` TERBUKTI GAGAL di produksi (`Cannot find
module 'web-push'` di log function, ketahuan lewat `net._http_response`
status 502 saat tes trigger `app_subscriptions` sungguhan) — menurut
dokumentasi resmi Netlify, `npm install` otomatis CUMA jalan untuk
`package.json` di *base directory* situs (root repo), bahkan untuk
situs statis tanpa `[build.command]` sekalipun; package.json di
subfolder manapun (termasuk `netlify/functions/`) diam-diam diabaikan.
Taruh di root (sudah dilakukan) dan Netlify otomatis `npm install`-kan
sebelum bundling functions, TIDAK perlu `[build.command]` tambahan.
App browser (`index.html`/`js/*.js`) TIDAK membaca `package.json` ini
sama sekali — situs tetap statis murni, file ini cuma dipakai Netlify
sebelum packaging functions. Fungsi email
(`notify-new-payment-request.js`) tetap jalan normal TANPA `web-push`
terinstall sama sekali (require()-nya lazy, cuma dipanggil kalau
`VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` sudah diisi, lihat komentar di
file itu) — yang gagal cuma jalur push-nya, bukan email yang sudah
terbukti jalan sebelumnya.

**Keterbatasan yang perlu diketahui**: perlu dinyalakan TERPISAH di
SETIAP perangkat/browser yang admin pakai (subscription-nya per-browser,
bukan per-akun) — kalau admin ganti HP/install ulang/clear data
browser, perlu tekan "Nyalakan" lagi. iOS Safari baru mendukung Web
Push sejak iOS 16.4 DAN cuma untuk PWA yang sudah di-"Add to Home
Screen" (tidak bisa dari tab Safari biasa) — browser lain (Chrome/Edge/
Firefox, desktop maupun Android) mendukung penuh dari tab biasa.

**Debug kalau push "sukses" (200/ok) tapi tidak muncul di device**: baik
`notify-new-payment-request.js` maupun `notify-new-account.js` SENGAJA
best-effort — error dari `webpush.sendNotification()` per-subscription
(selain 404/410 yang auto-dibersihkan) DIAMKAN dari sisi response HTTP,
supaya push yang gagal tidak ikut menggagalkan email/response yang sudah
berhasil. Jadi status 200 di `net._http_response` TIDAK membuktikan push
benar-benar terkirim ke device — cuma membuktikan request ke function-nya
tidak error. Errornya TETAP dicatat (bukan benar-benar hilang) lewat
`console.error()`/`console.log()` di `_web-push-send.js` dan kedua
function pemanggilnya — cek di dashboard Netlify: **Functions** (atau
**Logs → Function logs**) → pilih nama function-nya → lihat log invocation
terbaru. Penyebab push gagal diterima walau server bilang sukses biasanya
di sisi device/browser, BUKAN kode: subscription basi (coba
nonaktifkan→aktifkan lagi tombol push di device itu), izin notifikasi
Chrome di-disable di level OS Android (Settings → Apps → Chrome →
Notifications), atau battery saver/Do Not Disturb yang memblokir
notifikasi background. Ditemukan nyata di Poco X6 Pro (HyperOS/MIUI) —
battery saver untuk KEDUA app "Dokter Laundry" (WebAPK hasil "Add to
Home Screen") DAN "Chrome" (browser induknya, entri TERPISAH di menu
battery/autostart HyperOS) harus di-set "No restrictions"/"Tanpa
batasan"; HP dengan skin custom serupa (Oppo/Vivo/Realme dkk) biasanya
punya menu battery/autostart serupa yang perlu dicek untuk keduanya juga.

**Root cause KEDUA yang ditemukan di kasus nyata yang sama**: battery
saver di atas sempat SUDAH benar, TAPI notifikasi masih baru muncul
TEPAT SETELAH app dibuka manual (bukan spontan di background) --
ternyata `webpush.sendNotification()` di `_web-push-send.js` TIDAK
pernah menentukan `urgency` sama sekali, jadi defaultnya `'normal'`.
Dikonfirmasi lewat dokumentasi resmi Firebase Cloud Messaging
(firebase.google.com/docs/cloud-messaging/android-message-priority):
*"Normal priority messages are delivered immediately when the device is
not sleeping. When the device is in Doze mode, delivery may be delayed
... until the device exits doze"* -- sedangkan *"FCM attempts to deliver
high priority messages immediately even if the device is in Doze
mode."* Ini PERSIS menjelaskan gejalanya: device Android yang sedang
Doze (layar mati/idle, walau battery saver app-nya sudah "No
restrictions") tetap menahan pesan push NORMAL sampai device aktif lagi
-- bukan bug kode/RLS/dkk. Fix: kirim `{ urgency: 'high' }` sebagai
parameter ketiga `sendNotification()`.

**Klik notifikasi langsung membuka panel Admin Platform**: `url` yang
dikirim kedua function (`/?adminNotif=1`, BUKAN cuma `/`) ditangkap 2
tempat berbeda di `js/05-admin.js` tergantung tab app-nya sudah terbuka
atau belum saat notifikasi diklik — `notificationclick` di `sw.js` CUMA
`focus()` tab yang sudah ada (SENGAJA tidak `navigate()`/reload, supaya
sesi & data yang sudah dimuat di memori tidak hilang), lalu
`postMessage({type:'nk-push-click', url})` ke tab itu; listener
`navigator.serviceWorker.addEventListener('message', ...)` di
`js/05-admin.js` yang baru benar-benar memanggil `openAdminNotifPanel()`.
Kalau tab BELUM terbuka sama sekali, `sw.js` buka tab baru lewat
`clients.openWindow(url)` biasa, dan `initUserData()` yang membaca query
`?adminNotif=1` itu begitu login & data awal selesai dimuat (lalu
`history.replaceState()` membersihkan query-nya dari url, supaya refresh
manual berikutnya tidak ikut membuka panel ini lagi).
