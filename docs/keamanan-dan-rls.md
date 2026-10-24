# Keamanan dan RLS

Kebijakan Row Level Security, temuan audit keamanan beserta perbaikannya (SQL yang perlu dijalankan ada di sini), dan audit DoS.

[← Kembali ke README](../README.md)

<!-- isi-dipindah-dari-README -->

## RLS `registration_codes` & `payment_requests`

Ditemukan lewat audit (7 Oktober 2026): kedua tabel ini di Supabase ternyata
sudah dibatasi admin-only (`using ((auth.jwt()->>'email') = 'mukhlispertama@gmail.com')`
untuk SELECT/UPDATE `payment_requests` dan SELECT/UPDATE/INSERT/DELETE
`registration_codes`) — **TIDAK ada policy INSERT untuk `payment_requests`
sama sekali**, dan **TIDAK ada policy INSERT/SELECT untuk `registration_codes`
selain milik admin**. Akibatnya 3 fitur ini diam-diam GAGAL total di
produksi (dites langsung lewat REST API, bukan tebakan):

1. **"Daftar baru" & "Ajukan Perpanjangan"** (insert manual ke
   `payment_requests` dari browser, `js/02-init-data.js`/`js/03-langganan.js`)
   — ditolak RLS (jalur "Bayar Otomatis" Midtrans AMAN, lewat Service Role
   Key yang melewati RLS).
2. **Generate kode referral milik sendiri** (`getOrCreateReferralCode()`,
   `js/03-langganan.js`) — INSERT dan SELECT balik baris sendiri ditolak RLS.
3. **Lookup `referrer_owner_id` saat signup pakai kode referral**
   (`js/01-auth.js`) — SELECT langsung ke tabel ditolak RLS untuk user yang
   belum login (anon), jadi atribusi referral diam-diam selalu gagal.

Jalankan sekali di Supabase SQL Editor:

```sql
-- payment_requests: insert boleh dari siapa saja (anon maupun login) --
-- cuma bikin baris "menunggu", SELECT tetap admin-only seperti sekarang.
create policy "Siapa saja boleh mengajukan permintaan pembayaran baru" on payment_requests
  for insert
  with check (true);

-- registration_codes: owner boleh INSERT+SELECT kode referral MILIKNYA
-- SENDIRI saja (tidak bisa lihat/buat kode orang lain atau kode admin).
create policy "Pemilik toko bisa baca kode referral miliknya sendiri" on registration_codes
  for select
  using (referrer_owner_id = auth.uid());

create policy "Pemilik toko bisa buat kode referral miliknya sendiri" on registration_codes
  for insert
  with check (referrer_owner_id = auth.uid());

-- Lookup referrer_owner_id saat signup (anon) TIDAK lewat SELECT langsung
-- (supaya anon tidak bisa enumerasi semua kode termasuk kode admin yang
-- belum terpakai) -- lewat function sempit ini saja, cuma balikin
-- referrer_owner_id utk SATU kode yang cocok & masih aktif.
create or replace function get_registration_code_referrer(p_code text)
returns uuid
language sql
security definer
set search_path = public
as $$
  select referrer_owner_id from registration_codes where code = p_code and status = 'aktif';
$$;

grant execute on function get_registration_code_referrer(text) to anon, authenticated;
```

`js/01-auth.js` sudah diupdate memanggil `get_registration_code_referrer`
(RPC) ini, bukan `select()` langsung ke `registration_codes`, lagi.

### KRITIS: `app_subscriptions` bisa di-self-grant status aktif tanpa bayar — RPC `claim_registration_code_and_activate` + perketat RLS

Ditemukan lewat audit (9 Oktober 2026), dikonfirmasi langsung lewat
`pg_policies` live (10 Oktober 2026): policy INSERT `app_subscriptions`
yang ada (`owner_insert_own_subscription`, `with_check: auth.uid() =
owner_id`) **TIDAK membatasi nilai `status` sama sekali**. Kode LAMA
`ensureAppSubscription()` (`js/03-langganan.js`) membaca flag
`localStorage.nk_paidSignup` untuk memutuskan insert `status:'aktif'`
langsung dari browser — flag itu bisa dipalsukan bebas lewat DevTools
(`localStorage.setItem('nk_paidSignup','1')`) **TANPA pernah lewat RPC
klaim kode sama sekali**, lalu reload: insert `status:'aktif'` palsu itu
akan **LOLOS** RLS, dapat akses penuh tanpa pernah bayar. (Kabar baik
dari verifikasi live: TIDAK ADA policy UPDATE untuk owner sendiri di
tabel ini — cuma admin — jadi celahnya murni di INSERT/akun baru, tidak
bisa dipakai mengubah baris yang sudah ada.)

Perbaikan dua lapis:

**1. RPC `security definer` yang menggabungkan klaim kode + aktivasi jadi SATU langkah atomik di server** (menggantikan `claim_registration_code` dari migrasi sebelumnya — kalau sempat menjalankannya, boleh di-drop, lihat di bawah):

```sql
create or replace function claim_registration_code_and_activate(p_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows int;
  v_now timestamptz := now();
  v_paid_until timestamptz := now() + interval '30 days';
  v_exists boolean;
begin
  update registration_codes
    set status = 'terpakai', used_by = auth.uid()
  where code = p_code and status = 'aktif' and referrer_owner_id is null;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return false;
  end if;

  select exists(select 1 from app_subscriptions where owner_id = auth.uid()) into v_exists;
  if v_exists then
    update app_subscriptions set status = 'aktif', paid_until = v_paid_until where owner_id = auth.uid();
  else
    insert into app_subscriptions (owner_id, status, trial_ends_at, paid_until)
      values (auth.uid(), 'aktif', v_now, v_paid_until);
  end if;

  return true;
end;
$$;

grant execute on function claim_registration_code_and_activate(text) to authenticated;

-- Fungsi lama (migrasi sebelumnya) tidak lagi dipanggil dari kode manapun,
-- aman di-drop:
drop function if exists claim_registration_code(text);
```

**2. Perketat policy INSERT `app_subscriptions` itu sendiri — defense-in-depth, supaya walau ADA kode/flag yang somehow masih mencoba insert `status:'aktif'` langsung dari browser, RLS sendiri yang menolak:**

```sql
drop policy if exists "owner_insert_own_subscription" on app_subscriptions;
create policy "owner_insert_own_subscription" on app_subscriptions
  for insert
  with check (auth.uid() = owner_id and status = 'trial');
```

`js/01-auth.js`/`js/02-init-data.js` sudah diupdate memanggil RPC
gabungan ini langsung (bukan `claim_registration_code` + flag lagi), dan
flag `nk_paidSignup` **sudah dihapus total** dari codebase —
`ensureAppSubscription()` sekarang SELALU insert `status:'trial'` untuk
baris baru, tidak pernah lagi `'aktif'` dari kode browser.
`check_registration_code` (RPC lookup anon sebelum signup, grant-nya
sudah didokumentasikan di migrasi sebelumnya) tidak berubah, tetap
dipakai seperti biasa.

Kode admin baru yang dibuat `createManualCode()`/`approvePaymentRequest()`
(`js/05-admin.js`) tetap 10 karakter (`genAdminRegCode()`, bukan 6 —
tahan brute-force lewat `check_registration_code`); kode referral tetap
6 karakter (`genRegCode()`, `REF-XXXXXX` via `getOrCreateReferralCode()`
di `js/03-langganan.js`) karena risikonya jauh lebih rendah (tidak
melewati trial, cuma menandai siapa mereferensikan siapa).

### KRITIS: `team_members` membocorkan SEMUA kode undangan pending lintas-toko — perketat RLS

Ditemukan lewat verifikasi `pg_policies` live (10 Oktober 2026) — lebih
parah dari yang diduga audit 9 Oktober: policy SELECT
`"anyone read pending invite"` (`qual: (status = 'pending') OR (auth.uid()
= member_id)`) membiarkan **SIAPA SAJA yang login** (bukan cuma kasir
yang diundang) men-SELECT **SEMUA baris `team_members` berstatus
`pending` milik SEMUA toko** — termasuk `invite_code`, `owner_id`,
`nama` — lewat REST API langsung, tanpa perlu tahu kode undangan sama
sekali (modelnya seharusnya "kode rahasia dibagikan manual", bukan
daftar terbuka). Policy UPDATE `"employee claim invite"` (`with_check:
member_id = auth.uid() AND status = 'aktif'`) juga TIDAK membatasi kolom
`owner_id` — klien jahat bisa `update({owner_id: <toko lain>, member_id:
auth.uid(), status:'aktif'}).eq('id', <id baris pending siapa saja>)`
lewat curl langsung dan jadi kasir toko yang tidak pernah mengundangnya.

RPC `claim_invite_code` (migrasi sebelumnya, `security definer`) sudah
menutup jalur ini dari KODE APLIKASI (`js/02-init-data.js` sekarang
cuma panggil RPC, tidak pernah SELECT/UPDATE tabel ini langsung lagi) —
tapi RLS tabel ini sendiri, yang bisa diakses langsung lewat REST API di
luar aplikasi, belum ikut diperbaiki. Kedua policy ini TIDAK dibutuhkan
lagi fitur apa pun di aplikasi (klaim undangan sekarang 100% lewat RPC
security definer yang menembus RLS) — aman di-drop total, dan SELECT
milik baris sendiri diganti versi yang jauh lebih sempit (cuma
`member_id` sendiri, tanpa cabang `status='pending'` yang terbuka untuk
semua orang):

```sql
drop policy if exists "anyone read pending invite" on team_members;
create policy "member_select_own_row" on team_members
  for select
  using (auth.uid() = member_id);

drop policy if exists "employee claim invite" on team_members;
```

Policy `"owner manage team"` (ALL, `auth.uid() = owner_id`) TIDAK
disentuh — itu yang dipakai pemilik toko membuat/mengelola undangan
timnya sendiri, sudah benar.

### Admin mana yang approve/tolak — kolom `processed_by_email`

Ditemukan lewat audit (9 Oktober 2026): `approvePaymentRequest()`/
`approveRenewalRequest()`/`rejectPaymentRequest()` (`js/05-admin.js`) tidak
pernah mencatat admin MANA yang bertindak — dengan `ADMIN_EMAILS` bisa
lebih dari satu akun admin, tidak bisa dilacak kalau ada perselisihan
approve/tolak. Jalankan sekali:

```sql
alter table payment_requests add column if not exists processed_by_email text;
```

Ketiga fungsi di atas sekarang mengisi kolom ini dari email admin yang
sedang login (`currentUser.email`).


## Ringkasan Admin Platform tidak tampilkan nama toko lain — kolom `settings` kurang izin RLS

Ditemukan lewat verifikasi `pg_policies` live (10 Oktober 2026): berbeda
dari `app_subscriptions`/`registration_codes`/`payment_requests` yang
SUDAH punya policy SELECT admin-wide, tabel `settings` **TIDAK
punya** policy admin-wide sama sekali — cuma `auth.uid() = user_id` atau
kasir milik toko itu. Ini BUKAN kebocoran (arah sebaliknya: admin
kurang izin, bukan kelebihan), tapi bikin
`loadAdminSubscriptionsOverview()` (`js/05-admin.js`) gagal mencocokkan
`shop_name` toko lain — ringkasan Admin Platform cuma menampilkan "Toko
tanpa nama (uuid...)" untuk semua toko selain milik admin sendiri (sudah
diantisipasi di komentar kode-nya sendiri). Jalankan sekali kalau ingin
fitur ini benar-benar menampilkan nama toko:

```sql
create policy "admin_select_all_settings" on settings
  for select
  using ((auth.jwt() ->> 'email') = 'mukhlispertama@gmail.com');
```

## Duplikat policy INSERT `payment_requests`

Ditemukan lewat verifikasi `pg_policies` live (10 Oktober 2026): ada 2
policy INSERT yang identik fungsinya (`with_check: true`) —
`"Siapa saja boleh mengajukan permintaan pembayaran baru"` (dari migrasi
yang didokumentasikan di README ini) dan `"anyone submit payment
request"` (sudah ada duluan di database, tidak pernah tercatat di
README). Tidak berbahaya (keduanya mengizinkan hal yang sama persis),
cuma berantakan. Jalankan sekali untuk membersihkan salah satunya:

```sql
drop policy if exists "anyone submit payment request" on payment_requests;
```


## KRITIS: `registration_codes` bisa dibatalkan/dicuri SIAPA SAJA lewat REST langsung — policy UPDATE lama dihapus

Audit keamanan menyeluruh (13 Oktober 2026, diminta user secara eksplisit:
"bertindak sebagai hacker... cari semua celah"). Dikonfirmasi lewat
`pg_policies` live: policy UPDATE `"claim code on signup"`
(`qual: status = 'aktif'`, `with_check: status = 'terpakai' AND used_by =
auth.uid()`) **TIDAK membatasi row yang boleh ditarget SAMA SEKALI
selain `status='aktif'`** — bukan kode MILIK user yang login, bukan ID
spesifik yang dia tahu. Siapa saja yang SUDAH login (termasuk akun trial
gratis baru) bisa langsung:

```
PATCH .../rest/v1/registration_codes?status=eq.aktif
Body: {"status":"terpakai","used_by":"<uid miliknya sendiri>"}
```

— satu request ini mencocokkan & membakar **SEMUA** kode aktif sekaligus
(kode admin yang sudah dibuat utk pelanggan yang baru saja bayar, DAN
semua kode referral toko lain yang belum terpakai), menandainya
"terpakai" oleh dirinya sendiri. Dampaknya murni sabotase/DoS platform
(pelanggan yang sudah bayar tidak bisa lagi redeem kodenya karena sudah
"terpakai" duluan) — BUKAN cara mengaktifkan langganan diri sendiri
tanpa bayar (`app_subscriptions` tetap cuma terima `status='trial'` dari
browser, lihat bagian KRITIS `app_subscriptions` di atas, jadi tidak ada
privilege escalation lewat jalur ini).

Dikonfirmasi lewat `grep` seluruh kode: **tidak ada satu pun** pemanggil
di `js/*.js` yang memakai `.update()` langsung ke tabel ini — alur klaim
kode sudah 100% lewat RPC `claim_registration_code_and_activate`
(`security definer`, menembus RLS dari dalam, lihat bagian atas) sejak
perbaikan sebelumnya. Policy ini persis seperti `"anyone read pending
invite"`/`"employee claim invite"` di `team_members` yang sudah
dibongkar duluan — peninggalan desain lama sebelum RPC ada, sekarang
cuma jadi pintu belakang berbahaya. Aman dihapus total:

```sql
drop policy if exists "claim code on signup" on registration_codes;
```

## MEDIUM-TINGGI: `app_branding` (footer nota + saklar Midtrans SELURUH platform) bisa diubah SIAPA SAJA yang login

Ditemukan di audit yang sama. Tabel `app_branding` cuma 1 baris (`id=1`)
dipakai BERSAMA oleh SEMUA toko (footer "dikembangkan oleh..." di setiap
nota, DAN saklar `midtrans_enabled` yang menentukan apakah tombol "Bayar
Otomatis" muncul untuk SELURUH platform). Tombolnya ("Simpan Footer
Nota", toggle Midtrans) memang cuma ditampilkan di panel Admin Platform
yang disembunyikan dari non-admin di UI (`#adminPlatformSection`,
`isAdminEmail()`) — TAPI policy RLS-nya (`"Semua user login bisa ubah
footer nota"`, `ALL`, `qual: auth.role() = 'authenticated'`) mengizinkan
**SEMUA user yang login** (termasuk akun trial baru, TANPA perlu jadi
admin) menulis ke tabel ini langsung lewat REST/console browser — gatenya
cuma di UI (client-side), tidak ada pagar di RLS-nya sama sekali. Siapa
saja bisa:
- Mengganti nomor WA/email di footer nota SEMUA toko (jadi nomor
  attacker sendiri — berisiko disalahgunakan untuk phishing, pelanggan
  mengira itu kontak resmi pengembang app).
- Mematikan `midtrans_enabled` untuk SELURUH platform (semua toko
  kehilangan opsi Bayar Otomatis tanpa pernah tahu kenapa).

Perbaikan: ganti policy `ALL` lama (yang mencakup INSERT/UPDATE/DELETE)
jadi admin-only, SELAIN policy SELECT terpisah (`"Semua user login bisa
baca footer nota"`) yang TETAP dibiarkan terbuka untuk semua user login
— itu memang perlu, supaya setiap nota semua toko bisa menampilkan
footer ini saat dicetak:

```sql
drop policy if exists "Semua user login bisa ubah footer nota" on app_branding;

create policy "admin_only_write_app_branding" on app_branding
  for all
  using ((auth.jwt()->>'email') in ('mukhlispertama@gmail.com','dokterlaundromat@gmail.com'))
  with check ((auth.jwt()->>'email') in ('mukhlispertama@gmail.com','dokterlaundromat@gmail.com'));
```

## MEDIUM: stored XSS lewat kategori pengeluaran (attribute breakout di `onmousedown`) — `js/14-pengeluaran.js`

Ditemukan di audit yang sama. `showExpKategoriSuggest()` dulu menyuntik
nama kategori pengeluaran (free-text, diketik bebas oleh kasir/owner)
langsung ke dalam atribut `onmousedown="...selectExpKategoriSuggest('...')"`
— cuma tanda kutip TUNGGAL yang di-escape manual
(`k.replace(/'/g,"\\'")`), tanda kutip GANDA tidak sama sekali. Nama
kategori seperti `" onmouseover="alert(1)//` memutus atribut HTML itu
dan menyuntik event handler BARU — tersimpan permanen di `expenses.kategori`
(stored XSS), tereksekusi begitu user LAIN di toko yang sama (termasuk
owner) membuka daftar saran kategori dan mouse-nya lewat di atas baris
itu. Berbeda dari celah stored-XSS yang sudah diperbaiki di PR #9 (nama
layanan/satuan, yang sudah lewat `escapeHTML()` dengan benar) — ini bug
TERPISAH, bukan di teks yang ditampilkan (yang sudah benar di-escape),
tapi di atribut HTML-nya sendiri yang dibangun manual tanpa escaping
yang benar sama sekali.

Diperbaiki: ganti pola suntik-string-ke-atribut jadi pola index-ke-array
(sama seperti `selectRekapNamaSuggest()`/`js/22-rekap-pelanggan.js`) —
nama kategori sekarang TIDAK PERNAH masuk ke markup HTML selain lewat
`escapeHTML()` di teks yang ditampilkan; `onmousedown`-nya cuma berisi
angka index, tidak ada string apa pun dari user yang disuntikkan ke
atribut.

## MEDIUM: `payment_requests` bisa di-spam tanpa batas SIAPA SAJA tanpa login — rate limit lewat trigger

Ditemukan di audit lanjutan (13 Oktober 2026, atas permintaan user
sendiri untuk melanjutkan cek fitur lain). Policy INSERT
`payment_requests` (`with_check: true`) memang SENGAJA terbuka untuk
siapa saja termasuk anon (form "Pendaftaran Baru" diisi SEBELUM user
punya akun) — tapi TIDAK ADA pembatasan jumlah sama sekali. Siapa saja
bisa POST langsung ke REST API (bukan lewat app) berkali-kali tanpa
henti, dan SETIAP baris baru memicu **email** (Resend, kuota gratis
terbatas) DAN **Web Push ke HP admin** (lihat bagian Notifikasi Push di
[notifikasi.md](notifikasi.md)) — bisa dipakai membanjiri notifikasi admin/menghabiskan kuota
email asli sampai tidak terkirim.

Diputuskan (atas pilihan user): tambah rate limit sederhana lewat
**trigger database**, BUKAN ubah tampilan form (tidak ada CAPTCHA/gesekan
tambahan buat calon pelanggan) dan BUKAN ubah arsitektur (tetap INSERT
langsung dari browser seperti sekarang, tidak perlu proxy Netlify
Function baru). Batasnya global (SEMUA baris baru di tabel ini,
digabung, bukan per-nomor WA — nomor WA bisa diganti-ganti bebas oleh
penyerang jadi tidak berguna sebagai kunci pembatas) — 20 baris per 10
menit, cukup longgar untuk lonjakan pendaftaran asli, tapi membatasi
serangan flood otomatis jadi maksimal ~120/jam (dari sebelumnya tanpa
batas sama sekali). **Sengaja mengecualikan Service Role Key**
(`auth.role() = 'service_role'`) — `netlify/functions/midtrans-create-transaction.js`/
`midtrans-webhook.js` juga insert ke tabel ini dari server, request itu
TERPERCAYA (dari kode kita sendiri, bukan browser sembarang), jangan
ikut kena limit ini walau kebetulan ramai pembayaran asli bersamaan.

```sql
create or replace function payment_requests_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recent_count int;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  select count(*) into v_recent_count
  from payment_requests
  where created_at > now() - interval '10 minutes';

  if v_recent_count >= 20 then
    raise exception 'Terlalu banyak permintaan, coba lagi beberapa menit lagi';
  end if;

  return new;
end;
$$;

drop trigger if exists payment_requests_rate_limit_trigger on payment_requests;
create trigger payment_requests_rate_limit_trigger
  before insert on payment_requests
  for each row
  execute function payment_requests_rate_limit();
```

Tidak perlu perubahan kode browser sama sekali — `submitPaymentRequest()`/
`requestRenewal()` (`js/02-init-data.js`/`js/03-langganan.js`) sudah
menangani `error` dari `.insert()` secara umum (toast "Gagal mengirim,
coba lagi"), jadi begitu limit kena, pesannya otomatis muncul lewat
jalur yang sudah ada, tidak crash. Angka `20`/`10 minutes` bisa diubah
kapan saja lewat `create or replace function` ulang kalau ternyata
terlalu longgar/ketat di penggunaan nyata.

## BUG NYATA: trigger duplikat `payment_requests` — email + push notifikasi terkirim 2x per pendaftaran

Ditemukan 15 Oktober 2026 secara tidak sengaja saat verifikasi trigger
rate-limit di atas (`select * from pg_trigger where tgrelid =
'payment_requests'::regclass`). Tabel `payment_requests` ternyata punya
**2 trigger terpisah** yang isinya 100% duplikat fungsional —
`notify_admin_new_payment_request_trigger` (fungsi
`notify_admin_new_payment_request()`) DAN `trg_notify_new_payment_request`
(fungsi `notify_new_payment_request()`) — keduanya memanggil
`net.http_post()` ke URL Netlify Function **yang sama persis**
(`.../notify-new-payment-request`) dengan header `X-Webhook-Secret`
yang sama, setiap kali ada baris baru di-insert. Akibatnya: **setiap
pendaftaran/perpanjangan baru memicu email DAN Web Push notification 2
KALI**, bukan 1 — ini juga retroaktif menjelaskan pola "selalu muncul 2
baris" di `net._http_response` yang terlihat berulang kali selama sesi
debug Web Push sebelumnya (sebelumnya dikira murni karena ada 2
perangkat/subscription admin terdaftar — ternyata SEBAGIAN juga karena
2 trigger terpisah memanggil function-nya masing-masing).

Akar masalah: kedua trigger ini dibuat manual lewat Supabase SQL
Editor saat mengerjakan workaround Database Webhook (wizard bawaan
Supabase sempat error `schema "supabase_functions" does not exist`,
lihat bagian Notifikasi Push di [notifikasi.md](notifikasi.md)) — SQL trigger `pg_net`-nya tidak
pernah tersimpan/terdokumentasi di README ini (dijalankan langsung di
dashboard), jadi saat trigger-nya dibuat ulang dengan nama baru (versi
`trg_notify_new_payment_request`, lebih lengkap — ada
`timeout_milliseconds`), yang versi lama tidak ikut dihapus.

Diperbaiki (user menjalankan langsung di SQL Editor, dikonfirmasi lewat
`pg_trigger` ulang — tersisa cuma `trg_notify_new_payment_request` +
`payment_requests_rate_limit_trigger`):

```sql
drop trigger if exists notify_admin_new_payment_request_trigger on payment_requests;
drop function if exists notify_admin_new_payment_request();
```

`app_subscriptions` (notifikasi "akun toko baru") ikut dicek lewat
query yang sama — cuma ada 1 trigger (`trg_notify_new_account`), TIDAK
kena masalah duplikat yang sama.

- [x] Buat ulang `manifest.json` + ikon PWA yang hilang — selesai, lihat bagian "Diketahui rusak" di [CHANGELOG.md](../CHANGELOG.md)
- [x] Sambungkan repo ini ke Netlify — selesai 19 Agustus 2026, situs `laundrybatapasid.netlify.app` sekarang berlabel "Deploys from GitHub". Commit ini dipakai sebagai tes: kalau perubahan kecil di berkas ini muncul di situs live setelah push, berarti auto-deploy benar-benar aktif.
- [x] Tinjauan menyeluruh arsitektur/keamanan/UX — selesai (lewat 3 agent paralel, laporan dipublikasikan sebagai artifact), 1 temuan KRITIS (stored XSS lewat nama layanan/satuan di nota) langsung diperbaiki (lihat PR #9)
- [ ] Multi-Outlet: pembatasan kasir ke outlet tertentu baru di level tampilan (client-side) — RLS `transactions`/`subscriptions`/`expenses` belum ikut memeriksa `team_members.outlet_id`, jadi bukan pagar keamanan yang ketat kalau kasir akses API Supabase langsung
- [x] Laporan bulan yang "sudah ditutup" bisa berubah nilainya kapan pun ada pelunasan susulan (ditemukan lewat audit 9 Oktober 2026) — selesai 12 Oktober 2026, lihat bagian "Laporan bulan 'ditutup' berubah karena pelunasan susulan" di [laporan-dan-performa.md](laporan-dan-performa.md) (Opsi A: kolom `lunas_at` + metrik baru "Kas Masuk Bulan Ini")
- [x] Diskon/total transaksi 100% dipercaya dari input browser (`js/12-transaksi.js`), tidak dihitung ulang di server — ditinjau lewat audit 9 Oktober 2026, SENGAJA tidak diperbaiki: risikonya cuma ke toko sendiri (kasir nakal merugikan tokonya sendiri, bukan platform), dan merekalkulasi di server butuh memindahkan seluruh logika harga/katalog ke server — perubahan arsitektur besar yang tidak proporsional untuk risiko serendah ini.


## Audit DoS/DoS-aplikasi atas permintaan user (16 Oktober 2026) — satu celah ditemukan & diperbaiki

User minta dijelaskan konsep DoS lebih dalam, lalu minta dicek apakah
app ini punya salah satu "ciri web yang gampang kena serangan DoS"
(endpoint mahal tanpa autentikasi, tidak ada rate-limit, tidak ada
timeout, satu server tanpa CDN, validasi ukuran input kosong,
regex/parsing yang bisa di-ReDoS, caching nol). Hasil audit per poin:

- **Endpoint mahal tanpa autentikasi** — CLEAN. `midtrans-create-transaction.js`/
  `search-communities.js` sudah mewajibkan token Supabase Auth valid +
  cek kepemilikan (lihat audit sebelumnya); `midtrans-webhook.js`/
  `notify-new-payment-request.js` memverifikasi signature/
  `X-Webhook-Secret`. Satu-satunya insert anon-terbuka dengan efek mahal
  (email+push), `payment_requests`, sudah ada rate-limit trigger (lihat
  bagian rate-limit di atas).
- **RPC anon tanpa rate-limit** (`get_registration_code_referrer`) —
  ADA tapi risikonya rendah: cuma 1 `select` murah per panggilan (tidak
  memicu email/push/proses berat), dan kode admin yang paling sensitif
  (`genAdminRegCode()`, 10 karakter / 33^10 kombinasi) sudah disengaja
  dibuat tahan brute-force lewat panjang kode, bukan lewat rate-limit
  (lihat `js/05-admin.js`). Tidak diperbaiki — proporsional dengan
  risikonya, sama seperti keputusan soal diskon/total yang dipercaya
  dari browser.
- **Query tanpa limit/pagination** — CLEAN, sudah ditangani di audit
  performa sebelumnya (`fetchAllRows()` + `.range()` berulang,
  `ensureAllTransactionsLoaded()`, paginasi `loadAllWorkUsage()`).
- **Satu server tanpa CDN** — N/A, app ini di Netlify (sudah edge/CDN
  bawaan) + Supabase (infrastruktur terkelola) — bukan tanggung jawab
  kode app.
- **Regex rawan ReDoS** — CLEAN, diperiksa SEMUA pemakaian
  `.test()`/`.match()`/`new RegExp` di `js/*.js` dan `marketing.html`:
  semuanya pola flat/dibatasi panjang (`{2,30}`, `{6,12}`, dst.), tidak
  ada kuantifier bersarang yang bisa backtracking eksponensial.
- **Validasi ukuran input — DITEMUKAN & DIPERBAIKI**: `handleLogoFileChange()`
  (`js/06-outlet.js`, upload logo toko) dan `insertNoteImage()`
  (`js/20-catatan.js`, sisip gambar di Catatan) membaca file apa pun
  ukurannya LANGSUNG ke `FileReader` + decode penuh lewat `new Image()`
  SEBELUM sempat di-resize kecil — walau hasil akhirnya selalu kecil
  (240x240 / maks lebar 480px, disimpan sebagai data URI), proses
  baca+decode berkas aslinya sendiri tidak dibatasi. Risikonya murni
  client-side/self-inflicted (bisa bikin tab browser SI PENGUNGGAH
  sendiri hang kalau pilih file puluhan-ratusan MB, mis. foto
  panorama/RAW) — bukan vektor DoS ke server atau pengguna lain, tapi
  tetap celah UX/robustness nyata. Diperbaiki: tolak file >15MB dengan
  toast yang jelas SEBELUM `FileReader` dipanggil sama sekali, di kedua
  fungsi.
- **Caching nol** — tidak relevan untuk app transaksional seperti ini
  (data harus selalu fresh untuk kasir), bukan celah.

Ditambahkan juga konvensi baru di `CLAUDE.md` ("Konvensi Keamanan — Cek
Risiko DoS di Fitur Baru"): tiap kali menambah/mengubah fitur yang
menyentuh endpoint/RPC baru, form input baru, upload file, atau query
baru, wajib cek 4 poin (autentikasi+efek mahal, limit query, validasi
ukuran input, efek kalau dipanggil ribuan kali) dan perbaiki langsung
kalau ketemu celah — bukan cuma dilaporkan.

Verifikasi: `node --check` pada file yang diubah, suite Playwright
penuh (206 langkah, 0 FAIL), termasuk test baru untuk guard ukuran file
(`handleLogoFileChange()`/`insertNoteImage()` menolak file >15MB
sebelum `FileReader` dipanggil).
