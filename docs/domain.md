# Domain Kustom: dokterlaundry.my.id

Alamat utama aplikasi: `https://dokterlaundry.my.id`. Alamat lama
`laundryassist.netlify.app` TETAP aktif (otomatis dialihkan Netlify ke domain
utama), jadi webhook dan PWA lama tidak putus.

## Yang diubah di kode
- `js/03-langganan.js`: link ajakan referral kini ke `dokterlaundry.my.id`.
- Fungsi lain memakai `window.location.origin` / path relatif, jadi tidak perlu diubah.

## Yang diubah di dashboard (manual, urutannya penting)
1. **Netlify** > Domain management > Add a domain: `dokterlaundry.my.id`, jadikan
   *primary domain*, lalu atur DNS (A/ALIAS apex + CNAME `www`, atau pakai Netlify DNS
   dan arahkan nameserver di registrar). Tunggu sertifikat HTTPS aktif.
2. **Supabase** > Authentication > URL Configuration: Site URL
   `https://dokterlaundry.my.id`; Redirect URLs tambahkan `https://dokterlaundry.my.id/**`
   (jangan hapus alamat lama dulu).
3. **Midtrans** > Payment Notification URL:
   `https://dokterlaundry.my.id/.netlify/functions/midtrans-webhook`.
4. **Supabase Database Webhook** `notify-new-payment-request`: URL baru di
   `https://dokterlaundry.my.id/.netlify/functions/notify-new-payment-request`
   (header `X-Webhook-Secret` tetap).
5. **Resend** (opsional): verifikasi `dokterlaundry.my.id` (SPF/DKIM) supaya email bisa
   dikirim ke siapa saja.
6. **Aplikasi Play Store (APK/TWA)**: kalau dibuat lewat PWABuilder, buat ulang dengan
   host baru; berkas `assetlinks.json` harus di domain baru.

Catatan: pengguna yang sudah memasang PWA dari alamat lama harus memasang ulang kalau
mau memakai alamat baru (data akun tetap di Supabase, jadi tidak hilang).
