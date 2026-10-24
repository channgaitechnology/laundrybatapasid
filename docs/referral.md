# Program Referral dan Data Pembuat Transaksi

Program referral (bonus 15 hari), race condition kodenya, dan kolom pembuat transaksi.

[← Kembali ke README](../README.md)

<!-- isi-dipindah-dari-README -->

## Program Referral (bagikan & dapat bonus 15 hari)

Tombol **"🎁 Bagikan dan Dapat Bonus"** — sengaja ditaruh sebagai bar
penuh-lebar persis di bawah appbar (bukan dikubur di dalam Pengaturan),
supaya langsung kelihatan di semua tab, cuma hilang untuk akun kasir.
Setiap pemilik toko punya **kode referral pribadi** (dibuat otomatis
sekali saat pertama dipakai, format `REF-XXXXXX`, juga ditampilkan di
Pengaturan → Langganan) yang bisa dibagikan lewat Web Share API (atau
fallback ke link share WhatsApp `wa.me/?text=...` tanpa nomor tujuan —
WhatsApp sendiri yang menampilkan pemilih kontak — kalau browsernya
tidak dukung Web Share).

**Syarat bonus cair — PENTING, beda dari versi awal fitur ini:**
Bonus 15 hari **BUKAN** langsung aktif begitu orang baru mendaftar
pakai kode itu. Akun baru tetap mulai dari **trial 30 hari seperti
biasa** (kode referral tidak melewati trial, beda dari kode admin).
Baru **setelah akun baru itu benar-benar membayar** (lewat Bayar
Otomatis Midtrans ATAU disetujui admin manual di Admin Platform) —
**kedua belah pihak** sama-sama dapat +15 hari: pemilik kode (referrer)
DAN akun baru itu sendiri. Ini jaminan satu kali per akun baru — kalau
akun yang sama bayar lagi nanti (perpanjangan berikutnya), bonus TIDAK
dobel. Kodenya sendiri tetap bisa dipakai berkali-kali ke banyak orang
berbeda (beda dari kode admin yang sekali pakai) — jadi kalau mau dapat
bonus lagi, bagikan ke orang lain lagi.

Numpang di tabel `registration_codes` yang sudah ada untuk kode-nya,
plus 2 kolom baru di `app_subscriptions` untuk mencatat siapa
mereferensikan siapa & status klaimnya, plus 1 function Postgres yang
dipanggil persis di titik "pembayaran benar-benar terjadi"
(`approveRenewalRequest()` di `js/05-admin.js` untuk persetujuan
manual, dan `netlify/functions/midtrans-webhook.js` untuk Bayar
Otomatis) — bukan saat daftar. Jalankan sekali di Supabase SQL Editor:

```sql
alter table registration_codes add column if not exists referrer_owner_id uuid references auth.users(id);
alter table app_subscriptions add column if not exists referred_by_owner_id uuid references auth.users(id);
alter table app_subscriptions add column if not exists referral_bonus_claimed boolean not null default false;

create or replace function apply_referral_bonus_if_pending(p_owner_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_referrer_id uuid;
  v_claimed boolean;
  v_status text;
begin
  select referred_by_owner_id, referral_bonus_claimed, status
    into v_referrer_id, v_claimed, v_status
  from app_subscriptions
  where owner_id = p_owner_id
  for update;

  -- Bukan akun hasil referral, atau bonusnya sudah pernah diklaim
  -- sebelumnya (mis. perpanjangan kedua kalinya) -- diamkan, no-op.
  if v_referrer_id is null or v_claimed then
    return;
  end if;

  -- Perbaikan keamanan (7 Okt 2026, ditemukan lewat audit): function ini
  -- TIDAK percaya begitu saja ke pemanggil bahwa "pembayaran sudah
  -- terjadi" -- diverifikasi sendiri lewat status='aktif' (cuma bisa
  -- begini kalau approveRenewalRequest()/midtrans-webhook.js SUDAH
  -- berhasil mengaktifkan baris ini LEBIH DULU, lihat urutan panggilan di
  -- kode kedua file itu). Tanpa pengecekan ini, siapa pun yang login bisa
  -- panggil RPC ini lewat console browser untuk owner_id mana pun yang
  -- masih 'trial' dan dapat bonus 15 hari gratis tanpa pernah bayar
  -- (berkali-kali lewat akun dummy pakai kode referral sendiri).
  if v_status is distinct from 'aktif' then
    return;
  end if;

  -- Cegah self-referral supaya tidak dobel +30 hari dari 1 pemanggilan.
  if v_referrer_id = p_owner_id then
    return;
  end if;

  -- Akun baru (yang baru saja bayar) dapat +15 hari, DITANDAI sudah
  -- diklaim supaya tidak pernah dobel di perpanjangan-perpanjangan berikutnya.
  update app_subscriptions
    set paid_until = greatest(coalesce(paid_until, now()), now()) + interval '15 days',
        referral_bonus_claimed = true
    where owner_id = p_owner_id;

  -- Pemilik kode (referrer) juga dapat +15 hari -- dari tanggal
  -- berlaku langganannya SENDIRI (greatest(...,now()) supaya tidak
  -- "ketelan" kalau langganan referrer kebetulan sedang kedaluwarsa).
  update app_subscriptions
    set paid_until = greatest(coalesce(paid_until, now()), now()) + interval '15 days'
    where owner_id = v_referrer_id;
end;
$$;

grant execute on function apply_referral_bonus_if_pending(uuid) to authenticated;
```

Kenapa lewat function `security definer` (bukan `update` langsung dari
browser): kreditnya mengubah baris `app_subscriptions` milik **orang
lain** (si pemilik kode referral, bukan akun yang baru saja bayar) —
menaruh logika ini di satu function server-side, dipanggil dari SATU
titik yang sama persis dari 2 jalur pembayaran (manual & Midtrans), jauh
lebih aman & konsisten daripada bergantung pada RLS `app_subscriptions`
yang permisif lintas-user atau menduplikasi logikanya di banyak tempat.

Sebelum migrasi ini dijalankan: tombol "Bagikan dan Dapat Bonus" akan
gagal membuat kode (toast error "Gagal membuat kode referral") karena
kolom `referrer_owner_id` belum ada, dan persetujuan pembayaran
(manual/Midtrans) akan tetap jalan seperti biasa — RPC bonus-nya
dipanggil di dalam `try/catch`, jadi kalau function-nya belum ada,
gagalnya diam-diam saja, tidak menggagalkan proses aktivasi langganan
itu sendiri.

### Race condition kode referral — unique index

Ditemukan lewat audit (9 Oktober 2026): `getOrCreateReferralCode()`
(`js/03-langganan.js`) melakukan SELECT cek kode sudah ada, baru INSERT
kalau belum — dua langkah terpisah, TIDAK atomik. Klik ganda tombol
"Bagikan dan Dapat Bonus" atau 2 tab terbuka bersamaan bisa membuat
**dua** baris kode referral untuk 1 toko, karena tidak ada constraint
yang mencegahnya. Jalankan sekali (partial index — kode ADMIN yang
`referrer_owner_id`-nya `null` TIDAK ikut dibatasi, boleh banyak):

```sql
create unique index if not exists registration_codes_referrer_owner_unique
  on registration_codes(referrer_owner_id) where referrer_owner_id is not null;
```

`getOrCreateReferralCode()` sudah diupdate: kalau `insert()` ditolak index
ini (race), fungsi ini SELECT ulang dan mengembalikan kode yang sudah
dibuat panggilan lain, bukan `null`.

### Transaksi tidak menyimpan siapa pembuatnya — kolom `created_by`/`created_by_nama`

Ditemukan lewat audit (9 Oktober 2026): `edit_log` cuma mencatat nama
editor untuk jalur EDIT transaksi (`submitTransaction()` mode edit) —
baris transaksi ASLI (insert pertama, belum pernah diedit) tidak pernah
menyimpan siapa yang membuatnya sama sekali. Toko dengan lebih dari 1
kasir tidak bisa tahu siapa input nota tertentu kalau belum pernah
diedit. Jalankan sekali:

```sql
alter table transactions add column if not exists created_by uuid references auth.users(id);
alter table transactions add column if not exists created_by_nama text;
```

Aman dijalankan kapan saja — kolom nullable, transaksi lama tetap tampil
seperti biasa (cuma `created_by`-nya kosong). `submitTransaction()`
(`js/12-transaksi.js`) sekarang mengisi keduanya saat insert transaksi
baru, dari user yang sedang login (`currentUser.id`) + nama editor yang
sama persis dengan yang dipakai `logEditHistory()`.
