/* ===================== PEMULIHAN TEMA & TAB TERAKHIR (instan, sebelum apapun lain) ===================== */
var currentTheme = (function(){
  try {
    return localStorage.getItem('nk_theme') || 'system';
  } catch(e) { return 'system'; }
})();

function applyTheme(theme) {
  var isDark = false;
  if(theme === 'dark') {
    isDark = true;
  } else if(theme === 'system') {
    isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  if(isDark) {
    document.body.classList.add('dark-mode');
  } else {
    document.body.classList.remove('dark-mode');
  }
}

(function(){
  try{
    applyTheme(currentTheme);
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

// Listen for system theme changes if set to system
if(window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function(){
    if(currentTheme === 'system') {
      applyTheme('system');
    }
  });
}

/* ===================== NAVIGASI KEYBOARD DROPDOWN SARAN =====================
   Satu fungsi generik dipasang ke SETIAP dropdown saran/autocomplete
   (.suggest-dropdown) di app ini -- nama pelanggan, layanan katalog,
   layanan tambahan Tempo/Paket, nama & kategori pengeluaran, nama Rekap
   Pelanggan -- supaya tidak perlu menulis ulang logic navigasi di tiap
   showXxxSuggest()/selectXxxSuggest() yang beda-beda per fitur.
   ArrowUp/ArrowDown menyorot item (class 'hover' -- CSS-nya SUDAH ADA di
   index.html tapi sebelumnya tidak pernah dipasang oleh JS mana pun, cuma
   tertulis utk :active mouse), Enter memicu PILIHAN YANG SUDAH ADA di item
   itu lewat onmousedown bawaannya sendiri (bukan menduplikasi logic pilih --
   tiap showXxxSuggest() sudah memasang onmousedown yang memanggil
   selectXxxSuggest(...) dengan argumen yang sudah benar), Escape menutup
   dropdown-nya.

   Dipasang SEKALI secara SINKRON di top-level modul masing-masing (bukan di
   dalam showXxxSuggest(), supaya tidak menumpuk listener ganda setiap kali
   fungsi itu dipanggil ulang tiap user mengetik) -- lihat pemanggilannya di
   js/07-katalog.js, js/08-paket.js, js/11-kontak.js, js/14-pengeluaran.js,
   js/22-rekap-pelanggan.js. SENGAJA dipasang di modul PALING AWAL (00) yang
   dimuat SEBELUM semua pemanggil itu, supaya listener Enter di sini
   terdaftar LEBIH DULU daripada focusOnEnter()/TRX_FORM_GRID
   (js/12-transaksi.js, dimuat belakangan) untuk kolom #inNama/#itNama yang
   dipakai bersama -- urutan ini WAJIB supaya stopImmediatePropagation() di
   bawah benar-benar bisa mencegah Enter "nyasar" pindah kolom saat user
   justru sedang memilih saran, bukan pindah fokus. */
function attachSuggestKeyNav(inputId, boxId){
  const input = document.getElementById(inputId);
  const box = document.getElementById(boxId);
  if(!input || !box || input.dataset.suggestNavBound) return;
  input.dataset.suggestNavBound = '1';
  input.addEventListener('keydown', function(e){
    if(!box.classList.contains('show')) return;
    const items = Array.from(box.querySelectorAll('.suggest-item'));
    if(items.length===0) return;
    const curIdx = items.findIndex(el=>el.classList.contains('hover'));
    if(e.key==='ArrowDown' || e.key==='ArrowUp'){
      e.preventDefault();
      e.stopImmediatePropagation();
      const nextIdx = e.key==='ArrowDown'
        ? (curIdx+1) % items.length
        : (curIdx<=0 ? items.length-1 : curIdx-1);
      items.forEach(el=>el.classList.remove('hover'));
      items[nextIdx].classList.add('hover');
      items[nextIdx].scrollIntoView({ block:'nearest' });
    } else if(e.key==='Enter'){
      // Belum ada saran yang disorot (user belum tekan Arrow) -- biarkan
      // Enter berfungsi seperti biasa (pindah kolom/tambah item, dst.),
      // JANGAN diam-diam memilih saran pertama tanpa sepengetahuan user.
      if(curIdx<0) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if(typeof items[curIdx].onmousedown==='function') items[curIdx].onmousedown({ preventDefault(){} });
    } else if(e.key==='Escape'){
      box.classList.remove('show');
    }
  });
}

/* ===================== SUPABASE SETUP ===================== */
const SUPABASE_URL = 'https://ffpgapgvlzhetrkzmhqh.supabase.co';
const SUPABASE_KEY = 'sb_publishable_TEP3jcXZqkhcBqRpaLSyPQ_1szM0vLB';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
/* Listener KHUSUS event PASSWORD_RECOVERY, didaftarkan di sini -- skrip
   PALING AWAL -- bukan digabung ke listener sesi-login utama di <script>
   paling akhir index.html (lihat komentar panjang di sana soal kenapa
   listener itu SENGAJA ditunda sampai akhir, supaya resolveRoleAndInit()
   dkk pasti sudah terdefinisi). supabase-js mendeteksi & memproses token
   recovery dari location.hash SESAAT setelah createClient() dipanggil di
   atas (lalu hash-nya langsung dibersihkan dari URL lewat
   history.replaceState) -- jauh lebih cepat daripada 23 <script src>
   lain yang masih harus dimuat berurutan satu per satu. Kalau listener
   PASSWORD_RECOVERY ikut ditunda ke akhir seperti listener sesi-login
   lainnya, event ini sudah lewat & hash sudah hilang dari URL sebelum ada
   yang sempat dengar -- akibatnya link reset password cuma diam-diam
   login-kan user (karena token recovery tetap sah membentuk sesi), TANPA
   PERNAH menampilkan form ganti password (bug nyata dilaporkan user: klik
   link reset password di HP yang sudah ada sesi lama, malah langsung
   masuk ke app bukan diminta ganti password). Listener ini sengaja HANYA
   menyentuh DOM modal (tidak memanggil fungsi apa pun dari modul lain),
   supaya aman didaftarkan paling awal tanpa risiko ReferenceError. */
sb.auth.onAuthStateChange((event) => {
  if(event === 'PASSWORD_RECOVERY'){
    document.getElementById('newPasswordModal').classList.add('show');
  }
});
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
/* Pemuatan hemat kuota (dibahas di sesi chat 12 Okt 2026, demi kuota egress
   Supabase gratis): loadTransactionsFromDB() cuma muat TRANSACTIONS_LOAD_MONTHS
   bulan terakhir secara default, bukan seluruh riwayat sejak toko berdiri --
   toko yang riwayatnya sudah panjang dulu mengunduh ulang SEMUA baris itu
   setiap kali app dibuka, padahal 99% pemakaian normal (Riwayat/Laporan bulan
   ini) cuma butuh beberapa bulan terakhir. Fitur yang BENAR-BENAR butuh
   seluruh riwayat (Peringkat Pelanggan "Semua Waktu", Rekap Pelanggan cari
   lintas tanggal, Laporan Per Pelanggan/Laba Rugi mode tahunan, ekspor JPG
   Papan Laundry custom range, atau Laporan/Riwayat saat user pilih
   bulan/tanggal di luar window) memanggil ensureAllTransactionsLoaded()
   (js/05-admin.js) dulu -- itu nge-backfill baris yang lebih lama SEKALI per
   sesi (idempoten, no-op lagi setelah pertama kali), bukan menggantikan
   window default pada pemakaian normal. */
var transactionsFullyLoaded = false;
var transactionsWindowStart = null; // tanggal (YYYY-MM-DD) paling lama yang DIJAMIN lengkap di `transactions`; null kalau transactionsFullyLoaded true (semua sudah termuat)
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
// Dipakai editUsageGroup()/submitExtraServiceBatch() (js/08-paket.js) -- mode
// edit transaksi per nota Tempo (beda dari editingTransactionId yang khusus
// tabel `transactions`, bukan `subscription_usage`).
var editingUsageIds = null;
var editingUsageBatchId = null;
var editingTransactionId = null;
var editingSubscriptionId = null;
var savedContacts = [];
var appSubscription = null;

