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
          ? `<button class="btn btn-accent btn-sm" style="width:auto;padding:6px 12px;" onclick="approveRenewalRequest('${r.id}')">✅ ${t('Aktifkan 30 Hari')}</button>`
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
  const newPaidUntil = new Date(base.getTime() + 30*24*60*60*1000).toISOString();
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
  const text = encodeURIComponent(`${t('Halo')} ${req.nama}, ${t('perpanjangan langganan Laundry Batapas.id sudah diverifikasi')} ✅\n\n${t('Langganan kamu aktif sampai')} ${newPaidUntil.slice(0,10)}. ${t('Terima kasih!')}`);
  window.open(`https://wa.me/${waNum}?text=${text}`, '_blank');
}
async function rejectPaymentRequest(id){
  if(!confirm(t('Tolak permintaan ini?'))) return;
  const { error } = await sb.from('payment_requests').update({ status:'ditolak' }).eq('id', id);
  if(error){ showToast(t('Gagal menolak')); return; }
  await loadAdminData();
}

async function initUserData(){
  let lastTab = 'baru';
  try{
    const saved = localStorage.getItem('nk_lastTab');
    if(saved && ['baru','riwayat','paket','laporan','pengeluaran','papan'].includes(saved)) lastTab = saved;
  }catch(e){}
  try{
    await loadAppBranding();
    await loadSettingsFromDB();
    await loadOutletsFromDB();
    await loadTransactionsFromDB();
    await loadCatalogFromDB();
    await loadSubscriptionsFromDB();
    await loadAllWorkUsage();
    await loadContactsFromDB();
    await loadExpensesFromDB();
    await loadExpenseCatalogFromDB();
    await loadNotesFromDB();
    applySettingsToUI();
    renderOutletSwitcherLabel();
    populateReportOutletFilter();
    renderAll();
  }catch(e){
    console.error('Gagal memuat data awal:', e);
  }finally{
    switchTab(lastTab);
  }
}
async function loadSettingsFromDB(){
  const { data, error } = await sb.from('settings').select('*').eq('user_id', shopOwnerId).maybeSingle();
  if(data){
    settings = { shopName:data.shop_name||'Laundry Batapas.id', address:data.address||'', phone:data.phone||'', note:data.note||'', logoUrl:data.logo_url||null, autoNotifySelesai:!!data.auto_notify_selesai };
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
