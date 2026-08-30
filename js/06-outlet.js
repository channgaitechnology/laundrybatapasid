/* ===================== MULTI-OUTLET (opt-in) ===================== */
/* Tabel outlets opsional — kalau belum dimigrasi atau toko belum pernah
   bikin outlet, diamkan saja: app tetap jalan sebagai single-outlet persis
   seperti sebelumnya (switcher & filter outlet baru muncul di UI begitu
   outlets.length > 0). */
async function loadOutletsFromDB(){
  const { data, error } = await sb.from('outlets').select('*').eq('user_id', shopOwnerId).order('created_at', { ascending:true });
  if(error){ outlets = []; currentOutletId = null; return; }
  outlets = (data||[]).map(r => ({ id:r.id, nama:r.nama, alamat:r.alamat||'', telp:r.telp||'' }));
  if(outlets.length>0){
    let saved = null;
    try{ saved = localStorage.getItem('nk_lastOutletId'); }catch(e){}
    currentOutletId = (saved && outlets.some(o=>String(o.id)===saved)) ? saved : String(outlets[0].id);
    if(currentRole==='kasir' && kasirOutletId && outlets.some(o=>String(o.id)===kasirOutletId)){
      currentOutletId = kasirOutletId;
      try{ localStorage.setItem('nk_lastOutletId', currentOutletId); }catch(e){}
    }
  } else {
    currentOutletId = null;
  }
}
/* Konteks outlet yang "sedang dikerjakan" — dipakai saat mencatat transaksi/
   paket/pengeluaran baru, dan memfilter tampilan Riwayat/Paket/Pengeluaran/
   Daftar Tugas. Beda dari reportOutletFilter (khusus tab Laporan) yang
   defaultnya "Semua Outlet" karena laporan memang untuk lihat gambaran
   besar lintas cabang. */
function switchOutlet(id){
  if(currentRole==='kasir' && kasirOutletId && String(id)!==kasirOutletId){
    showToast(t('Outlet Anda dikunci oleh pemilik toko'));
    closeOutletPicker();
    return;
  }
  currentOutletId = id ? String(id) : null;
  try{ localStorage.setItem('nk_lastOutletId', currentOutletId||''); }catch(e){}
  renderOutletSwitcherLabel();
  closeOutletPicker();
  switchTab(currentTabName);
}
function visibleTransactions(){
  return (outlets.length===0 || !currentOutletId) ? transactions : transactions.filter(t=>String(t.outletId)===currentOutletId);
}
function visibleSubscriptions(){
  return (outlets.length===0 || !currentOutletId) ? subscriptions : subscriptions.filter(s=>String(s.outletId)===currentOutletId);
}
function visibleExpenses(){
  return (outlets.length===0 || !currentOutletId) ? expenses : expenses.filter(e=>String(e.outletId)===currentOutletId);
}
function visibleReportTransactions(){
  return reportOutletFilter ? transactions.filter(t=>String(t.outletId)===reportOutletFilter) : transactions;
}
function visibleReportExpenses(){
  return reportOutletFilter ? expenses.filter(e=>String(e.outletId)===reportOutletFilter) : expenses;
}
async function addOutlet(){
  const nama = document.getElementById('outletNama').value.trim();
  const alamat = document.getElementById('outletAlamat').value.trim();
  const telp = document.getElementById('outletTelp').value.trim();
  if(!nama){ showToast(t('Nama outlet wajib diisi')); return; }
  const { data, error } = await sb.from('outlets').insert({ user_id: shopOwnerId, nama, alamat, telp }).select().single();
  if(error){ showToast(t('Gagal menambah outlet — pastikan tabel outlets sudah dimigrasi (lihat README)')); return; }
  outlets.push({ id:data.id, nama:data.nama, alamat:data.alamat||'', telp:data.telp||'' });
  if(!currentOutletId){ currentOutletId = String(data.id); try{ localStorage.setItem('nk_lastOutletId', currentOutletId); }catch(e){} }
  document.getElementById('outletNama').value = '';
  document.getElementById('outletAlamat').value = '';
  document.getElementById('outletTelp').value = '';
  showToast(t('Outlet ditambahkan'));
  renderOutletManagerList();
  renderOutletSwitcherLabel();
  populateReportOutletFilter();
}
async function deleteOutlet(id){
  if(!confirm(t('Hapus outlet ini? Data transaksi/paket/pengeluaran yang sudah tercatat di outlet ini TIDAK ikut terhapus, cuma dilepas kaitannya (jadi tanpa outlet).'))) return;
  const { error } = await sb.from('outlets').delete().eq('id', id);
  if(error){ showToast(t('Gagal menghapus outlet')); return; }
  outlets = outlets.filter(o=>String(o.id)!==String(id));
  if(currentOutletId===String(id)){
    currentOutletId = outlets.length>0 ? String(outlets[0].id) : null;
    try{ localStorage.setItem('nk_lastOutletId', currentOutletId||''); }catch(e){}
  }
  showToast(t('Outlet dihapus'));
  renderOutletManagerList();
  renderOutletSwitcherLabel();
  populateReportOutletFilter();
  switchTab(currentTabName);
}
function renderOutletManagerList(){
  const el = document.getElementById('outletManagerList');
  if(!el) return;
  if(outlets.length===0){ el.innerHTML = `<div style="font-size:12px;color:var(--ink-soft);padding:6px 0;">${t('Belum ada outlet — toko ini masih mode 1 lokasi.')}</div>`; return; }
  el.innerHTML = outlets.map(o=>`
    <div class="item-line" style="align-items:center;">
      <span>${escapeHTML(o.nama)}${o.alamat?` <span style="color:var(--ink-soft);">— ${escapeHTML(o.alamat)}</span>`:''}</span>
      <button type="button" style="background:none;border:none;color:var(--danger);font-size:15px;cursor:pointer;" onclick="deleteOutlet('${o.id}')">✕</button>
    </div>
  `).join('');
}
function renderOutletSwitcherLabel(){
  const wrap = document.getElementById('outletSwitcherWrap');
  if(!wrap) return;
  if(outlets.length===0){ wrap.style.display = 'none'; return; }
  wrap.style.display = 'flex';
  const cur = outlets.find(o=>String(o.id)===currentOutletId);
  const locked = currentRole==='kasir' && !!kasirOutletId;
  document.getElementById('outletSwitcherLabel').textContent = (cur ? cur.nama : t('Pilih Outlet')) + (locked ? ' 🔒' : '');
}
function openOutletPicker(){
  if(currentRole==='kasir' && kasirOutletId){ showToast(t('Outlet Anda dikunci oleh pemilik toko')); return; }
  const el = document.getElementById('outletPickerList');
  el.innerHTML = outlets.map(o=>`
    <button type="button" class="btn ${String(o.id)===currentOutletId?'btn-primary':'btn-outline'}" style="margin-bottom:8px;" onclick="switchOutlet('${o.id}')">${escapeHTML(o.nama)}</button>
  `).join('');
  document.getElementById('outletPickerModal').classList.add('show');
}
function closeOutletPicker(){ document.getElementById('outletPickerModal').classList.remove('show'); }
function populateReportOutletFilter(){
  const sel = document.getElementById('reportOutletFilterSelect');
  if(!sel) return;
  const prev = sel.value;
  sel.innerHTML = `<option value="">${t('Semua Outlet')}</option>` + outlets.map(o=>`<option value="${o.id}">${escapeHTML(o.nama)}</option>`).join('');
  sel.value = outlets.some(o=>String(o.id)===prev) ? prev : '';
  reportOutletFilter = sel.value;
  const wrap = document.getElementById('reportOutletFilterWrap');
  if(wrap) wrap.style.display = outlets.length>0 ? 'block' : 'none';
}
function onReportOutletFilterChange(){
  reportOutletFilter = document.getElementById('reportOutletFilterSelect').value;
  renderReport(); renderLabaRugi(); renderPeringkatPelanggan();
  if(perReportCache) renderPerPelangganReport();
}
/* Dipakai semua fungsi nota (WA/PDF/JPG) supaya otomatis pakai alamat & telepon
   outlet yang terkait transaksi/paket-nya, bukan selalu identitas toko global.
   Kalau outlet tidak diisi alamat/telepon sendiri (atau transaksinya tanpa
   outlet), otomatis balik ke Pengaturan → Nama/Alamat/Telepon Toko. */
function notaHeaderInfo(outletId){
  const o = outletId ? outlets.find(x=>String(x.id)===String(outletId)) : null;
  return {
    nama: settings.shopName || 'Laundry Batapas.id',
    subtitle: o ? o.nama : '',
    alamat: (o && o.alamat) ? o.alamat : (settings.address||''),
    telp: (o && o.telp) ? o.telp : (settings.phone||'')
  };
}
/* Baris kredit pengembang di footer nota — dipakai bareng oleh semua
   fungsi pembangun nota WA-text/PDF-lines supaya isinya seragam & cuma
   perlu diedit di satu tempat (appBranding, lihat loadAppBranding()). */
function notaFooterLinesWA(){
  return [
    `*${t('dikembangkan oleh')} ${appBranding.nama}*`,
    `_${appBranding.tagline}_`,
    `🟢 WhatsApp: ${appBranding.wa}`,
    `📧 ${appBranding.email}`,
  ];
}
function notaFooterLinesPDF(){
  return [
    { t:`${t('dikembangkan oleh')} ${appBranding.nama}`, c:true, b:true, s:7 },
    { t:appBranding.tagline, c:true, s:6, it:true },
    { t:appBranding.wa, c:true, s:6, icon:'wa' },
    { t:appBranding.email, c:true, s:6, icon:'email' },
  ];
}
async function persistSettings(){
  const { error } = await sb.from('settings').upsert({
    user_id: shopOwnerId, shop_name: settings.shopName, address: settings.address,
    phone: settings.phone, note: settings.note
  });
  if(error){ showToast(t('Gagal menyimpan pengaturan')); }
}
/* Upsert lengkap termasuk logo — dipakai terpisah dari persistSettings() supaya
   simpan Nama/Alamat/Telepon/Catatan tetap jalan normal walau kolom logo_url
   di tabel settings belum ditambahkan (baru dipakai kalau logo diubah). */
async function persistSettingsWithLogo(){
  const { error } = await sb.from('settings').upsert({
    user_id: shopOwnerId, shop_name: settings.shopName, address: settings.address,
    phone: settings.phone, note: settings.note, logo_url: settings.logoUrl
  });
  return error;
}
/* Toggle notifikasi WA otomatis langsung tersimpan begitu diklik (seperti
   logo toko), tidak perlu tombol "Simpan Pengaturan" terpisah. Kolom
   auto_notify_selesai juga baru (lihat README) — kalau upsert gagal karena
   kolomnya belum ada, checkbox dikembalikan ke posisi semula. */
async function toggleAutoNotifySelesai(checked){
  const prev = settings.autoNotifySelesai;
  settings.autoNotifySelesai = checked;
  const { error } = await sb.from('settings').upsert({
    user_id: shopOwnerId, shop_name: settings.shopName, address: settings.address,
    phone: settings.phone, note: settings.note, auto_notify_selesai: checked
  });
  if(error){
    settings.autoNotifySelesai = prev;
    const chk = document.getElementById('setAutoNotifySelesai');
    if(chk) chk.checked = prev;
    showToast(t('Gagal menyimpan — kolom auto_notify_selesai mungkin belum ada di tabel settings (lihat README)'));
    return;
  }
  showToast(checked ? t('Notifikasi WA otomatis diaktifkan') : t('Notifikasi WA otomatis dimatikan'));
  renderWorkBoard();
}
async function saveShopLogo(dataUri){
  settings.logoUrl = dataUri;
  const error = await persistSettingsWithLogo();
  if(error){ showToast(t('Gagal menyimpan logo — kolom logo_url mungkin belum ada di tabel settings')); return; }
  applySettingsToUI();
  showToast(t('Logo toko disimpan'));
}
async function resetShopLogo(){
  if(!confirm(t('Kembalikan logo toko ke logo default aplikasi?'))) return;
  settings.logoUrl = null;
  const error = await persistSettingsWithLogo();
  if(error){ showToast(t('Gagal reset logo — kolom logo_url mungkin belum ada di tabel settings')); return; }
  const preview = document.getElementById('logoPreviewImg');
  if(preview) preview.src = shopLogoSrc();
  applySettingsToUI();
  showToast(t('Logo dikembalikan ke default'));
}
function handleLogoFileChange(event){
  const file = event.target.files && event.target.files[0];
  if(!file) return;
  if(!file.type.startsWith('image/')){ showToast(t('Pilih berkas gambar (JPG/PNG)')); event.target.value=''; return; }
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = async () => {
      const SIZE = 240;
      const canvas = document.createElement('canvas');
      canvas.width = SIZE; canvas.height = SIZE;
      const ctx = canvas.getContext('2d');
      const side = Math.min(img.width, img.height);
      const sx = (img.width - side) / 2, sy = (img.height - side) / 2;
      ctx.drawImage(img, sx, sy, side, side, 0, 0, SIZE, SIZE);
      const dataUri = canvas.toDataURL('image/jpeg', 0.85);
      const preview = document.getElementById('logoPreviewImg');
      if(preview) preview.src = dataUri;
      await saveShopLogo(dataUri);
    };
    img.onerror = () => showToast(t('Gagal membaca gambar'));
    img.src = reader.result;
  };
  reader.onerror = () => showToast(t('Gagal membaca berkas'));
  reader.readAsDataURL(file);
  event.target.value = '';
}

