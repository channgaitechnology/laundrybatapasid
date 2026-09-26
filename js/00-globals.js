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
const ADMIN_EMAIL = 'mukhlispertama@gmail.com';
/* Harga TAMPILAN saja (dropdown paket & pesan WA konfirmasi transfer
   manual) -- BUKAN sumber kebenaran harga. Harga sesungguhnya yang
   dipakai saat bayar otomatis lewat Midtrans diatur lewat env var
   SUBSCRIPTION_PRICE_1M/3M/6M/12M di Netlify (lihat README). Kalau
   env var itu diubah, sesuaikan juga angka di sini supaya tampilan
   & pesan WA tidak menyebut harga yang salah. Satu-satunya tempat
   harga tampilan disimpan, dipakai dropdown paketPaywall & paketDaftar
   plus pesan WA requestRenewal()/submitPaymentRequest() -- supaya tidak
   ada 2 tempat yang bisa kebablasan tidak sinkron. */
const SUBSCRIPTION_PLANS = {
  '1bulan': { label: '1 Bulan', harga: 50000, hemat: 0 },
  '3bulan': { label: '3 Bulan', harga: 135000, hemat: 10 },
  '6bulan': { label: '6 Bulan', harga: 240000, hemat: 20 },
  '12bulan': { label: '12 Bulan', harga: 420000, hemat: 30 },
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
var appBranding = { nama:'Tinggiran Tech Studio', tagline:'Bikin Apps & Website Kilat', wa:'081293228520', email:'tinggirantech@gmail.com' };
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

