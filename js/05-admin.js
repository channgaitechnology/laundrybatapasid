/* ===================== ADMIN PLATFORM (kode pendaftaran & pembayaran) ===================== */
function genRegCode(){
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for(let i=0;i<6;i++) code += chars[Math.floor(Math.random()*chars.length)];
  return code;
}
async function createManualCode(){
  const note = prompt(t('Catatan kode ini (opsional, misal nama pembeli):')) || '';
  const code = genRegCode();
  const { error } = await sb.from('registration_codes').insert({ code, status:'aktif', note });
  if(error){ showToast(t('Gagal membuat kode')); return; }
  await loadAdminData();
  alert(`${t('Kode pendaftaran baru:')}\n\n${code}\n\n${t('Bagikan ke calon pengguna lewat WhatsApp.')}`);
}
var regCodeCache = [];
var paymentReqCache = [];
/* Satu baris global (id=1), bukan per-toko — dipanggil untuk SEMUA user
   (bukan cuma admin) di initUserData(), karena footer nota tiap toko
   butuh nilai ini. Diam-diam gagal & tetap pakai default appBranding
   kalau tabel app_branding belum dimigrasi (lihat README). */
async function loadAppBranding(){
  try{
    const { data, error } = await sb.from('app_branding').select('*').eq('id', 1).maybeSingle();
    if(data){
      appBranding = {
        nama: data.dev_nama || appBranding.nama,
        tagline: data.dev_tagline || appBranding.tagline,
        wa: data.dev_wa || appBranding.wa,
        email: data.dev_email || appBranding.email
      };
    }
  }catch(e){ /* diamkan — lihat komentar di atas */ }
}
function fillAppBrandingForm(){
  const nama = document.getElementById('brandNama');
  if(!nama) return;
  nama.value = appBranding.nama;
  document.getElementById('brandTagline').value = appBranding.tagline;
  document.getElementById('brandWA').value = appBranding.wa;
  document.getElementById('brandEmail').value = appBranding.email;
}
async function saveAppBranding(){
  const nama = document.getElementById('brandNama').value.trim();
  const tagline = document.getElementById('brandTagline').value.trim();
  const wa = document.getElementById('brandWA').value.trim();
  const email = document.getElementById('brandEmail').value.trim();
  if(!nama){ showToast(t('Nama pengembang wajib diisi')); return; }
  const { error } = await sb.from('app_branding').upsert({ id:1, dev_nama:nama, dev_tagline:tagline, dev_wa:wa, dev_email:email });
  if(error){ showToast(t('Gagal menyimpan — pastikan tabel app_branding sudah dimigrasi (lihat README)')); return; }
  appBranding = { nama, tagline, wa, email };
  showToast(t('Footer nota diperbarui untuk semua toko'));
}
async function loadAdminData(){
  const { data: codes } = await sb.from('registration_codes').select('*').order('created_at', { ascending:false });
  regCodeCache = codes || [];
  renderRegCodeList();
  const { data: reqs } = await sb.from('payment_requests').select('*').eq('status','menunggu').order('created_at', { ascending:false });
  paymentReqCache = reqs || [];
  renderPaymentReqList();
  await loadAdminSubscriptionsOverview();
}
/* LIFETIME_DAYS_THRESHOLD/isLifetimePaidUntil() ada di js/09-utils.js --
   dipakai bersama dengan js/03-langganan.js (badge/Pengaturan toko sendiri)
   supaya definisi "seumur hidup" konsisten di semua tempat. */
/* Status langganan 1 toko dari baris app_subscriptions mentah -- dipakai
   ringkasan admin (semua toko) DAN bisa dipakai ulang kalau nanti perlu di
   tempat lain. Logic aktif/trial-berakhir-nya SENGAJA disamakan persis
   dengan isSubscriptionActive()/subscriptionDaysLeft() (js/03-langganan.js)
   supaya status yang admin lihat di sini tidak pernah beda arti dengan
   status yang dipakai untuk mengunci fitur toko itu sendiri. */
function computeSubStatusFor(sub){
  if(!sub) return { statusLabel: t('Belum Ada Data'), active:false, endDate:null, isLifetime:false };
  if(sub.status==='aktif'){
    const active = !sub.paid_until || new Date(sub.paid_until) >= new Date();
    return { statusLabel: active ? t('Aktif') : t('Tidak Aktif'), active, endDate: sub.paid_until||null, isLifetime: isLifetimePaidUntil(sub.paid_until) };
  }
  if(sub.status==='trial'){
    const active = new Date(sub.trial_ends_at) >= new Date();
    return { statusLabel: active ? t('Trial') : t('Trial Berakhir'), active, endDate: sub.trial_ends_at||null, isLifetime:false };
  }
  return { statusLabel: t('Tidak Aktif'), active:false, endDate:null, isLifetime:false };
}
var adminSubsOverviewCache = [];
/* Ringkasan SEMUA toko (bukan cuma toko sendiri) -- khusus ADMIN_EMAIL.
   PENTING: query di sini SENGAJA tanpa filter owner_id/user_id, beda dari
   pemakaian app_subscriptions/settings di tempat lain yang selalu di-scope
   ke satu toko -- supaya admin bisa lihat status SEMUA toko sekaligus.
   Ini cuma bisa berhasil kalau RLS tabel app_subscriptions & settings di
   Supabase mengizinkan SELECT lintas-user, sama seperti model kepercayaan
   permisif yang SUDAH dipakai registration_codes/payment_requests/app_branding
   di app ini (lihat README, bagian "Footer Nota" soal RLS permisif +
   gerbang di sisi tampilan lewat ADMIN_EMAIL). Kalau daftar ini kelihatan
   kosong padahal ada banyak toko terdaftar, itu tandanya RLS tabel ini
   masih membatasi ketat per-user -- perlu policy SELECT tambahan di
   Supabase (bukan bug di kode ini), lihat README. */
async function loadAdminSubscriptionsOverview(){
  const el = document.getElementById('adminSubsOverview');
  if(!el) return;
  const [{ data: subs, error: e1 }, { data: sets, error: e2 }] = await Promise.all([
    sb.from('app_subscriptions').select('*'),
    sb.from('settings').select('user_id, shop_name'),
  ]);
  if(e1 || e2){
    adminSubsOverviewCache = [];
    el.innerHTML = `<div style="font-size:12px;color:var(--ink-soft);">${t('Gagal memuat ringkasan langganan (cek kebijakan RLS Supabase untuk app_subscriptions/settings).')}</div>`;
    renderAdminSubsStats();
    return;
  }
  const nameByOwner = {};
  (sets||[]).forEach(s=>{ if(s.shop_name) nameByOwner[s.user_id] = s.shop_name; });
  adminSubsOverviewCache = (subs||[]).map(sub=>{
    const status = computeSubStatusFor(sub);
    const nama = nameByOwner[sub.owner_id] || `${t('Toko tanpa nama')} (${String(sub.owner_id).slice(0,8)})`;
    return { ownerId: sub.owner_id, nama, ...status };
  }).sort((a,b)=> a.nama.localeCompare(b.nama));
  renderAdminSubscriptionsOverview();
}
function renderAdminSubsStats(){
  const total = adminSubsOverviewCache.length;
  const aktifCount = adminSubsOverviewCache.filter(s=>s.active).length;
  document.getElementById('adminSubsStatAktif').textContent = aktifCount;
  document.getElementById('adminSubsStatTidakAktif').textContent = total - aktifCount;
  document.getElementById('adminSubsStatTotal').textContent = total;
}
function renderAdminSubscriptionsOverview(){
  const el = document.getElementById('adminSubsOverview');
  if(!el) return;
  renderAdminSubsStats();
  if(adminSubsOverviewCache.length===0){
    el.innerHTML = `<div style="font-size:12px;color:var(--ink-soft);text-align:center;padding:8px 0;">${t('Belum ada toko terdaftar.')}</div>`;
    return;
  }
  el.innerHTML = adminSubsOverviewCache.map(s=>`
    <div class="item-line" style="align-items:center;">
      <span style="font-size:12.5px;">${escapeHTML(s.nama)}</span>
      <span class="badge ${s.active ? 'badge-lunas' : 'badge-belum'}" style="font-size:11px;">${s.statusLabel}${s.isLifetime ? ' · '+t('Seumur Hidup') : (s.endDate ? ' · '+fmtDate(String(s.endDate).slice(0,10)) : '')}</span>
    </div>`).join('');
}
function renderRegCodeList(){
  const el = document.getElementById('regCodeList');
  if(!el) return;
  if(regCodeCache.length===0){
    el.innerHTML = `<div style="font-size:12.5px;color:var(--ink-soft);text-align:center;padding:8px 0;">${t('Belum ada kode dibuat.')}</div>`;
    return;
  }
  el.innerHTML = regCodeCache.map(c=>`
    <div class="item-line" style="align-items:center;">
      <span><b>${c.code}</b> ${c.note ? '— '+escapeHTML(c.note) : ''} <span style="color:var(--ink-soft);">· ${c.status==='aktif'?t('Belum dipakai'):t('Sudah dipakai')}</span></span>
      ${c.status==='aktif' ? `<button onclick="deleteRegCode('${c.id}')" style="background:none;border:none;color:var(--danger);font-size:15px;cursor:pointer;">✕</button>` : ''}
    </div>`).join('');
}
async function deleteRegCode(id){
  if(!confirm(t('Batalkan kode ini?'))) return;
  const { error } = await sb.from('registration_codes').delete().eq('id', id);
  if(error){ showToast(t('Gagal membatalkan kode')); return; }
  await loadAdminData();
}
/* Berapa hari yang harus diberikan saat approveRenewalRequest() -- REGRESI
   BUG NYATA: dulu approveRenewalRequest() selalu memaksa 30 hari APA PUN
   paket yang diajukan user (mis. user minta Paket 12 Bulan tapi cuma
   diaktifkan 30 hari), karena requestRenewal() (js/03-langganan.js) belum
   menyimpan plan_days sama sekali -- cuma nama paketnya ditulis sebagai teks
   bebas di `catatan`. Sekarang requestRenewal() SUDAH menyimpan plan_days,
   tapi baris LAMA yang sudah lebih dulu masuk (diajukan sebelum perbaikan
   ini) tidak punya plan_days sama sekali -- makanya di sini plan_days
   diprioritaskan, baru kalau kosong coba tebak dari teks catatan (yang
   selalu menyebut label paket asli, mis. "Paket 12 Bulan"), baru fallback
   30 hari kalau benar-benar tidak ketemu (sama seperti fallback di
   netlify/functions/midtrans-webhook.js untuk baris lama sebelum kolom ini
   ada). */
function inferPlanDaysFromCatatan(catatan){
  if(!catatan) return null;
  const match = Object.values(SUBSCRIPTION_PLANS).find(p=>catatan.includes(p.label));
  return match ? match.hari : null;
}
function renewalPlanDaysFor(req){
  return Number(req.plan_days) || inferPlanDaysFromCatatan(req.catatan) || 30;
}
/* Sama seperti isLifetimePaidUntil() di atas, tapi dari sisi jumlah HARI
   (belum ada base tanggal saat tombol ini dirender) -- dipakai supaya
   admin lihat "Aktifkan Seumur Hidup", bukan "Aktifkan 36500 Hari". */
function renewalDurationLabelFor(req){
  const days = renewalPlanDaysFor(req);
  return days >= LIFETIME_DAYS_THRESHOLD ? t('Seumur Hidup') : `${days} ${t('Hari')}`;
}
function renderPaymentReqList(){
  const el = document.getElementById('paymentReqList');
  if(!el) return;
  if(paymentReqCache.length===0){
    el.innerHTML = `<div style="font-size:12.5px;color:var(--ink-soft);text-align:center;padding:8px 0;">${t('Tidak ada permintaan menunggu.')}</div>`;
    return;
  }
  el.innerHTML = paymentReqCache.map(r=>{
    const isRenewal = r.type === 'perpanjangan';
    return `
    <div class="item-line" style="align-items:flex-start;flex-direction:column;gap:6px;padding:8px 0;">
      <div style="font-size:12.5px;">${isRenewal ? '<span style="color:#c8860a;">🔄 '+t('Perpanjangan')+'</span> — ' : ''}<b>${escapeHTML(r.nama)}</b> — ${escapeHTML(r.wa)}${r.catatan ? '<br><span style=\"color:var(--ink-soft);\">'+escapeHTML(r.catatan)+'</span>' : ''}</div>
      <div style="display:flex;gap:8px;width:100%;">
        ${isRenewal
          ? `<button class="btn btn-accent btn-sm" style="width:auto;padding:6px 12px;" onclick="approveRenewalRequest('${r.id}')">✅ ${t('Aktifkan')} ${renewalDurationLabelFor(r)}</button>`
          : `<button class="btn btn-accent btn-sm" style="width:auto;padding:6px 12px;" onclick="approvePaymentRequest('${r.id}')">✅ ${t('Setujui & Buat Kode')}</button>`}
        <button class="btn btn-ghost btn-sm" style="width:auto;padding:6px 12px;" onclick="rejectPaymentRequest('${r.id}')">${t('Tolak')}</button>
      </div>
    </div>`;
  }).join('');
}
async function approvePaymentRequest(id){
  const req = paymentReqCache.find(r=>r.id===id);
  if(!req) return;
  const code = genRegCode();
  const { error: e1 } = await sb.from('registration_codes').insert({ code, status:'aktif', note: req.nama });
  if(e1){ showToast(t('Gagal membuat kode')); return; }
  const { error: e2 } = await sb.from('payment_requests').update({ status:'disetujui', kode_diberikan: code }).eq('id', id);
  if(e2){ showToast(t('Kode dibuat tapi gagal update status permintaan')); }
  await loadAdminData();
  const waNum = req.wa.replace(/[^0-9]/g,'').replace(/^0/,'62');
  const text = encodeURIComponent(`${t('Halo')} ${req.nama}, ${t('pembayaranmu sudah diverifikasi')} ✅\n\n${t('Kode pendaftaran kamu:')} *${code}*\n\n${t('Masukkan kode ini saat mendaftar akun baru di aplikasi. Terima kasih!')}`);
  window.open(`https://wa.me/${waNum}?text=${text}`, '_blank');
}
async function approveRenewalRequest(id){
  const req = paymentReqCache.find(r=>r.id===id);
  if(!req || !req.owner_id) return;
  const { data: existing } = await sb.from('app_subscriptions').select('*').eq('owner_id', req.owner_id).maybeSingle();
  const now = new Date();
  const base = (existing && existing.paid_until && new Date(existing.paid_until) > now) ? new Date(existing.paid_until) : now;
  const planDays = renewalPlanDaysFor(req);
  const newPaidUntil = new Date(base.getTime() + planDays*24*60*60*1000).toISOString();
  let upErr;
  if(existing){
    ({ error: upErr } = await sb.from('app_subscriptions').update({ status:'aktif', paid_until: newPaidUntil }).eq('owner_id', req.owner_id));
  } else {
    ({ error: upErr } = await sb.from('app_subscriptions').insert({ owner_id: req.owner_id, status:'aktif', trial_ends_at: now.toISOString(), paid_until: newPaidUntil }));
  }
  if(upErr){ showToast(t('Gagal mengaktifkan langganan')); return; }
  const { error: e2 } = await sb.from('payment_requests').update({ status:'disetujui' }).eq('id', id);
  if(e2){ showToast(t('Langganan aktif tapi gagal update status permintaan')); }
  await loadAdminData();
  const waNum = req.wa.replace(/[^0-9]/g,'').replace(/^0/,'62');
  const masaAktifTxt = planDays >= LIFETIME_DAYS_THRESHOLD
    ? t('Langganan kamu aktif SEUMUR HIDUP, tidak pernah kedaluwarsa.')
    : `${t('Langganan kamu aktif sampai')} ${newPaidUntil.slice(0,10)}.`;
  const text = encodeURIComponent(`${t('Halo')} ${req.nama}, ${t('perpanjangan langganan Dokter Laundry sudah diverifikasi')} ✅\n\n${masaAktifTxt} ${t('Terima kasih!')}`);
  window.open(`https://wa.me/${waNum}?text=${text}`, '_blank');
}
async function rejectPaymentRequest(id){
  if(!confirm(t('Tolak permintaan ini?'))) return;
  const { error } = await sb.from('payment_requests').update({ status:'ditolak' }).eq('id', id);
  if(error){ showToast(t('Gagal menolak')); return; }
  await loadAdminData();
}

async function initUserData(){
  try{
    // Sebelas query ini masing-masing independen (tabel & array globalnya
    // sendiri-sendiri, tidak ada yang butuh hasil query lain) -- dijalankan
    // paralel via Promise.all supaya loading awal tidak menunggu 11 round-trip
    // berurutan (bisa beberapa detik di jaringan HP), cukup selama query
    // paling lambat di antaranya.
    await Promise.all([
      loadAppBranding(),
      loadSettingsFromDB(),
      loadOutletsFromDB(),
      loadTransactionsFromDB(),
      loadCatalogFromDB(),
      loadSubscriptionsFromDB(),
      loadAllWorkUsage(),
      loadContactsFromDB(),
      loadExpensesFromDB(),
      loadExpenseCatalogFromDB(),
      loadNotesFromDB(),
    ]);
    applySettingsToUI();
    renderOutletSwitcherLabel();
    populateReportOutletFilter();
    renderAll();
  }catch(e){
    console.error('Gagal memuat data awal:', e);
  }finally{
    // Dibaca di SINI (bukan di awal fungsi) supaya kalau user sempat ketuk
    // tab lain sambil data masih dimuat, switchTab() dari ketukan itu sudah
    // menulis localStorage.nk_lastTab duluan -- jadi tab yang direstore di
    // akhir sini ikut tab pilihan user, bukan snapshot lama yang bikin
    // tampilan "lompat balik" sendiri ke tab sebelumnya.
    let lastTab = 'baru';
    try{
      const saved = localStorage.getItem('nk_lastTab');
      if(saved && ['baru','riwayat','paket','laporan','pengeluaran','papan'].includes(saved)) lastTab = saved;
    }catch(e){}
    switchTab(lastTab);
  }
}
async function loadSettingsFromDB(){
  const { data, error } = await sb.from('settings').select('*').eq('user_id', shopOwnerId).maybeSingle();
  if(data){
    settings = { shopName:data.shop_name||'Toko Laundry Saya', address:data.address||'', phone:data.phone||'', note:data.note||'', logoUrl:data.logo_url||null, autoNotifySelesai:!!data.auto_notify_selesai };
  }
}
async function loadTransactionsFromDB(){
  const { data, error } = await sb.from('transactions').select('*').eq('user_id', shopOwnerId).order('created_at', { ascending:true });
  if(error){ showToast(t('Gagal memuat data transaksi')); return; }
  transactions = (data||[]).map(row => ({
    id: row.id, kode: row.kode, nama: row.nama, hp: row.hp,
    tanggal: row.tanggal, estimasi: row.estimasi, items: row.items||[],
    diskon: Number(row.diskon)||0, total: Number(row.total)||0, dp: Number(row.dp)||0,
    status: row.status, catatan: row.catatan||'', workStatus: row.work_status || 'belum',
    outletId: row.outlet_id!=null ? String(row.outlet_id) : null
  }));
}
/* Tabel expenses baru (belum tentu ada di database lama) — kalau query gagal
   (tabel belum dibuat), diamkan saja dan anggap belum ada pengeluaran tercatat,
   supaya fitur lain tetap jalan normal (lihat README untuk SQL migrasinya). */
async function loadExpensesFromDB(){
  const { data, error } = await sb.from('expenses').select('*').eq('user_id', shopOwnerId).order('tanggal', { ascending:true });
  if(error){ expenses = []; return; }
  expenses = (data||[]).map(row => ({
    id: row.id, tanggal: row.tanggal, nama: row.nama || row.kategori || '-',
    qty: row.qty!=null ? Number(row.qty) : null, satuan: row.satuan || '',
    harga: row.harga!=null ? Number(row.harga) : null,
    jumlah: Number(row.jumlah)||0, kategori: row.kategori || t('Lain-lain'), catatan: row.catatan||'',
    outletId: row.outlet_id!=null ? String(row.outlet_id) : null
  }));
}
/* Tabel expense_catalog (opsional, untuk saran otomatis/autocomplete saat catat
   pengeluaran) — sama seperti loadExpensesFromDB(), diamkan kalau tabelnya
   belum ada supaya fitur lain tetap jalan normal. */
async function loadExpenseCatalogFromDB(){
  const { data, error } = await sb.from('expense_catalog').select('*').eq('user_id', shopOwnerId).order('nama', { ascending:true });
  if(error){ expenseCatalog = []; return; }
  expenseCatalog = (data||[]).map(r => ({ id:r.id, nama:r.nama, satuan:r.satuan||'pcs', harga:Number(r.harga)||0 }));
}
