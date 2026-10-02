/* ===================== PEMULIHAN TAB TERAKHIR (instan, sebelum apapun lain) ===================== */
(function(){
  try{
    const saved = localStorage.getItem('nk_lastTab');
    if(saved && saved !== 'baru' && ['riwayat','paket','laporan'].includes(saved)){
      const map = { riwayat:'view-riwayat', laporan:'view-laporan', paket:'view-paket' };
      document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
      document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
      const viewEl = document.getElementById(map[saved]);
      if(viewEl) viewEl.classList.add('active');
      const tabBtn = document.querySelector('.tab[data-tab="'+saved+'"]');
      if(tabBtn) tabBtn.classList.add('active');
    }
  }catch(e){}
})();

/* ===================== SUPABASE SETUP ===================== */
const SUPABASE_URL = 'https://ffpgapgvlzhetrkzmhqh.supabase.co';
const SUPABASE_KEY = 'sb_publishable_TEP3jcXZqkhcBqRpaLSyPQ_1szM0vLB';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
/* ADMIN_EMAILS: daftar (bisa lebih dari 1) email yang dianggap pemilik
   platform -- bisa lihat Admin Platform, ringkasan semua toko, kode
   pendaftaran, dan alat Marketing (marketing.html). ADMIN_EMAIL (string,
   entri pertama) dipertahankan untuk kompatibilitas kalau ada kode lama
   yang masih merujuknya langsung -- tapi semua pengecekan "apakah user
   ini admin" HARUS lewat isAdminEmail(), bukan bandingkan ke ADMIN_EMAIL
   secara langsung, supaya konsisten kalau daftarnya bertambah lagi nanti.
   Daftar yang sama (persis, salin-tempel) juga harus diperbarui di
   marketing.html dan netlify/functions/search-communities.js -- keduanya
   file terpisah yang tidak bisa import dari sini (lihat arsitektur di
   CLAUDE.md) -- dan RLS policy tabel marketing_communities/marketing_leads
   di Supabase (lihat README). */
const ADMIN_EMAILS = ['mukhlispertama@gmail.com', 'dokterlaundromat@gmail.com'];
const ADMIN_EMAIL = ADMIN_EMAILS[0];
function isAdminEmail(email){
  return ADMIN_EMAILS.includes(String(email||'').toLowerCase());
}
/* Harga TAMPILAN saja (dropdown paket & pesan WA konfirmasi transfer
   manual) -- BUKAN sumber kebenaran harga. Harga sesungguhnya yang
   dipakai saat bayar otomatis lewat Midtrans diatur lewat env var
   SUBSCRIPTION_PRICE_1M/3M/6M/12M di Netlify (lihat README). Kalau
   env var itu diubah, sesuaikan juga angka di sini supaya tampilan
   & pesan WA tidak menyebut harga yang salah. Satu-satunya tempat
   harga tampilan disimpan, dipakai dropdown paketPaywall & paketDaftar
   plus pesan WA requestRenewal()/submitPaymentRequest() -- supaya tidak
   ada 2 tempat yang bisa kebablasan tidak sinkron. */
/* `hari` HARUS sama dengan pemetaan `days` di netlify/functions/_midtrans-plans.js
   (30/90/180/365/36500) -- dipakai requestRenewal() (js/03-langganan.js) supaya
   permintaan perpanjangan MANUAL (transfer, bukan Midtrans) ikut menyimpan
   plan_days yang benar, bukan cuma teks bebas di catatan (regresi bug nyata:
   approveRenewalRequest() dulu selalu memaksa 30 hari apa pun paket yang
   diajukan user, mis. user minta 12 Bulan tapi cuma diaktifkan 30 hari).
   Paket 'seumurhidup' SENGAJA pakai `hari: 36500` (~100 tahun), BUKAN nilai
   spesial/null -- supaya tetap lewat jalur perhitungan tanggal yang sama
   persis dengan paket lain (approveRenewalRequest()/midtrans-webhook.js
   cuma menambahkan `hari` ke tanggal, tidak ada cabang kode terpisah untuk
   "tidak pernah kedaluwarsa"). js/05-admin.js punya helper terpisah supaya
   paket ini tetap TAMPIL sebagai "Seumur Hidup" di UI, bukan "36500 Hari". */
const SUBSCRIPTION_PLANS = {
  '1bulan': { label: '1 Bulan', harga: 50000, hemat: 0, hari: 30 },
  '3bulan': { label: '3 Bulan', harga: 135000, hemat: 10, hari: 90 },
  '6bulan': { label: '6 Bulan', harga: 240000, hemat: 20, hari: 180 },
  '12bulan': { label: '12 Bulan', harga: 420000, hemat: 30, hari: 365 },
  'seumurhidup': { label: 'Seumur Hidup', harga: 1500000, hemat: 0, hari: 36500 },
};

/* ===================== STATE ===================== */
/* Logo default GENERIK (bukan foto toko siapa pun) -- ikon gelembung sabun
   yang sama dengan ikon PWA (icons/icon-192.png), dipakai untuk SEMUA toko
   yang belum upload logo sendiri lewat Pengaturan -> Profil Toko. Jangan
   diganti balik jadi foto toko tertentu -- app ini multi-tenant (dipakai
   banyak usaha laundry berbeda), foto toko satu pihak tidak boleh jadi
   default tampilan toko pihak lain. */
var SHOP_LOGO_B64 = 'icons/icon-192.png';
var settings = { shopName:'Toko Laundry Saya', address:'', phone:'', note:'Terima kasih telah menggunakan jasa laundry kami', logoUrl:null, autoNotifySelesai:false };
/* Kredit pengembang di footer SEMUA nota (bukan per-toko) — cuma diedit
   lewat Pengaturan → Admin Platform (khusus ADMIN_EMAIL), supaya kalau app
   ini dipakai/dijual ulang oleh pihak lain, footernya bisa diganti tanpa
   mengubah kode. Default persis sama seperti nilai hardcode sebelumnya. */
/* midtransEnabled: default false (fail-safe) -- tombol "Bayar Otomatis"
   cuma muncul setelah admin menyalakannya manual di Admin Platform,
   SETELAH akun Midtrans benar-benar terverifikasi (lihat README, bagian
   Midtrans). Transaksi produksi akan ditolak Midtrans dengan error 402
   kalau akun belum aktif, jadi tombolnya sengaja disembunyikan dulu
   daripada pengguna coba bayar lewat jalur yang pasti gagal. */
var appBranding = { nama:'Tinggiran Tech Studio', tagline:'Bikin Apps & Website Kilat', wa:'081293228520', email:'tinggirantech@gmail.com', midtransEnabled:false };
function shopLogoSrc(){ return settings.logoUrl || SHOP_LOGO_B64; }
var transactions = [];
var draftItems = [];
var currentReceiptId = null;
var currentUser = null;
var currentRole = 'owner';
var shopOwnerId = null;
var employeeName = '';
/* Kalau kasir ini dibatasi pemilik ke satu outlet tertentu (lewat outlet_id
   di team_members), diisi id outlet-nya di sini. null = kasir bebas akses
   & pindah ke semua outlet (perilaku lama, tetap default). */
var kasirOutletId = null;
var authMode = 'masuk';
var serviceCatalog = [];
var editingCatalogId = null;
var subscriptions = [];
var expenses = [];
var expenseCatalog = [];
/* Multi-outlet: fitur opt-in — kalau outlets kosong (toko belum pernah
   bikin outlet), app jalan persis seperti sebelumnya (single-outlet,
   tidak ada switcher/filter yang muncul). currentOutletId menentukan
   outlet mana yang sedang "aktif dikerjakan" (dipakai saat mencatat
   transaksi/paket/pengeluaran baru & memfilter Riwayat/Paket/Pengeluaran/
   Daftar Tugas) — beda dari filter khusus Laporan (lihat reportOutletFilter)
   yang defaultnya "Semua Outlet" karena laporan memang untuk lihat
   gambaran besar semua cabang. */
var outlets = [];
var currentOutletId = null;
var reportOutletFilter = '';
var editingExpenseCatalogId = null;
var expenseReportCache = null;
var labaRugiCache = null;
var peringkatPelangganCache = null;
var currentSubscriptionId = null;
var currentUsageList = [];
var draftExtraItems = [];
var currentBatchUsageIds = null;
var editingTransactionId = null;
var editingSubscriptionId = null;
var savedContacts = [];
var appSubscription = null;

