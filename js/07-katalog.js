/* ===================== KATALOG LAYANAN ===================== */
async function loadCatalogFromDB(){
  const { data, error } = await sb.from('services').select('*').eq('user_id', shopOwnerId).order('nama', { ascending:true });
  if(error){ return; }
  serviceCatalog = (data||[]).map(r => ({
    id:r.id, nama:r.nama, satuan:r.satuan||'kg', harga:Number(r.harga)||0,
    type:r.type||'reguler', kuotaKg: r.kuota_kg!=null ? Number(r.kuota_kg) : null,
    hargaLebihKg: r.harga_lebih_kg!=null ? Number(r.harga_lebih_kg) : 0
  }));
  populateLayananDatalist();
}
function populateLayananDatalist(){
  // kept for backward-compat call sites; suggestion box is rendered on-demand by showLayananSuggest()
}
function showLayananSuggest(){
  const val = document.getElementById('itNama').value.trim().toLowerCase();
  const box = document.getElementById('layananSuggestBox');
  const options = serviceCatalog.filter(s=>s.type!=='paket' && (!val || s.nama.toLowerCase().includes(val)));
  if(options.length===0){ box.classList.remove('show'); box.innerHTML=''; return; }
  box.innerHTML = options.map(s=>`
    <div class="suggest-item" onmousedown="event.preventDefault();selectLayananSuggest('${s.id}')">
      ${escapeHTML(s.nama)}<small>${s.satuan} · ${rupiah(s.harga)}</small>
    </div>`).join('');
  box.classList.add('show');
}
function hideLayananSuggestDelayed(){
  setTimeout(()=>{ document.getElementById('layananSuggestBox').classList.remove('show'); }, 150);
}
function selectLayananSuggest(id){
  const match = serviceCatalog.find(s=>String(s.id)===String(id));
  if(!match) return;
  document.getElementById('itNama').value = match.nama;
  document.getElementById('itHarga').value = match.harga;
  document.getElementById('itSatuan').value = match.satuan;
  document.getElementById('layananSuggestBox').classList.remove('show');
}
function fillFromCatalog(){
  const val = document.getElementById('itNama').value.trim().toLowerCase();
  const match = serviceCatalog.find(s => s.type!=='paket' && s.nama.toLowerCase() === val);
  if(match){
    document.getElementById('itHarga').value = match.harga;
    document.getElementById('itSatuan').value = match.satuan;
  }
}
function toggleCatalogFields(){
  const isPaket = document.getElementById('catType').value === 'paket';
  document.getElementById('catRegulerFields').style.display = isPaket ? 'none' : 'grid';
  document.getElementById('catPaketFields').style.display = isPaket ? 'grid' : 'none';
  document.getElementById('catPaketFields2').style.display = isPaket ? 'block' : 'none';
}
function openCatalog(){
  resetCatalogForm();
  renderCatalogList();
  document.getElementById('catalogModal').classList.add('show');
}
function closeCatalog(){ document.getElementById('catalogModal').classList.remove('show'); }
function resetCatalogForm(){
  editingCatalogId = null;
  document.getElementById('catType').value = 'reguler';
  document.getElementById('catNama').value = '';
  document.getElementById('catSatuan').value = 'kg';
  document.getElementById('catHarga').value = '';
  document.getElementById('catHargaPaket').value = '';
  document.getElementById('catKuotaKg').value = '';
  document.getElementById('catHargaLebih').value = '';
  document.getElementById('catSubmitBtn').textContent = '+ Tambah ke Katalog';
  document.getElementById('catCancelBtn').style.display = 'none';
  toggleCatalogFields();
}
function editCatalogItem(id){
  const item = serviceCatalog.find(s=>s.id===id);
  if(!item) return;
  editingCatalogId = id;
  document.getElementById('catType').value = item.type;
  document.getElementById('catNama').value = item.nama;
  if(item.type==='paket'){
    document.getElementById('catHargaPaket').value = item.harga;
    document.getElementById('catKuotaKg').value = item.kuotaKg||'';
    document.getElementById('catHargaLebih').value = item.hargaLebihKg||'';
  } else {
    document.getElementById('catSatuan').value = item.satuan;
    document.getElementById('catHarga').value = item.harga;
  }
  toggleCatalogFields();
  document.getElementById('catSubmitBtn').textContent = 'Simpan Perubahan';
  document.getElementById('catCancelBtn').style.display = 'inline-flex';
}
async function addOrUpdateCatalogItem(){
  const type = document.getElementById('catType').value;
  const nama = document.getElementById('catNama').value.trim();
  if(!nama){ showToast('Nama layanan wajib diisi'); return; }

  let payload = { nama, type };
  if(type==='paket'){
    const hargaPaket = parseFloat(document.getElementById('catHargaPaket').value) || 0;
    const kuota = parseFloat(document.getElementById('catKuotaKg').value) || 0;
    if(kuota<=0){ showToast('Isi kuota (kg) untuk paket ini'); return; }
    payload.satuan = 'bulan';
    payload.harga = hargaPaket;
    payload.kuota_kg = kuota;
    const hargaLebih = parseFloat(document.getElementById('catHargaLebih').value);
    payload.harga_lebih_kg = isNaN(hargaLebih) ? null : hargaLebih;
  } else {
    const satuan = document.getElementById('catSatuan').value;
    const harga = parseFloat(document.getElementById('catHarga').value) || 0;
    payload.satuan = satuan;
    payload.harga = harga;
    payload.kuota_kg = null;
  }

  if(editingCatalogId){
    const { error } = await sb.from('services').update(payload).eq('id', editingCatalogId);
    if(error){ showToast('Gagal menyimpan perubahan'); return; }
    showToast('Katalog diperbarui');
  } else {
    const { error } = await sb.from('services').insert({ user_id: shopOwnerId, ...payload });
    if(error){ showToast('Gagal menambah katalog'); return; }
    showToast('Layanan ditambahkan ke katalog');
  }
  await loadCatalogFromDB();
  resetCatalogForm();
  renderCatalogList();
}
async function deleteCatalogItem(id){
  const { error } = await sb.from('services').delete().eq('id', id);
  if(error){ showToast('Gagal menghapus'); return; }
  await loadCatalogFromDB();
  renderCatalogList();
  showToast('Layanan dihapus dari katalog');
}
function renderCatalogList(){
  const el = document.getElementById('catalogList');
  if(serviceCatalog.length===0){
    el.innerHTML = `<div style="font-size:12.5px;color:var(--ink-soft);text-align:center;padding:14px 0;">Katalog masih kosong. Tambahkan layanan di atas.</div>`;
    return;
  }
  el.innerHTML = serviceCatalog.map(s=>`
    <div class="item-line" style="align-items:center;">
      <span>${escapeHTML(s.nama)}
        ${s.type==='paket'
          ? `<span class="badge" style="background:#EDE7FB;color:#6B4FBB;margin-left:4px;">Paket · ${s.kuotaKg||0}kg/bln</span>`
          : `<span style="color:var(--ink-soft);">(${s.satuan})</span>`}
      </span>
      <span style="display:flex;align-items:center;gap:10px;">
        ${rupiah(s.harga)}
        <button onclick="editCatalogItem('${s.id}')" style="background:none;border:none;color:var(--suds);font-size:13px;cursor:pointer;">Edit</button>
        <button onclick="deleteCatalogItem('${s.id}')" style="background:none;border:none;color:var(--danger);font-size:15px;cursor:pointer;">✕</button>
      </span>
    </div>`).join('');
}

