/* ===================== PENGELUARAN / PEMBUKUAN ===================== */
function showExpenseCatalogSuggest(){
  const val = document.getElementById('expNama').value.trim().toLowerCase();
  const box = document.getElementById('expNamaSuggestBox');
  const options = expenseCatalog.filter(s=>!val || s.nama.toLowerCase().includes(val));
  if(options.length===0){ box.classList.remove('show'); box.innerHTML=''; return; }
  box.innerHTML = options.map(s=>`
    <div class="suggest-item" onmousedown="event.preventDefault();selectExpenseCatalogSuggest('${s.id}')">
      ${escapeHTML(s.nama)}<small>${s.satuan} · ${rupiah(s.harga)}</small>
    </div>`).join('');
  box.classList.add('show');
}
function hideExpenseCatalogSuggestDelayed(){
  setTimeout(()=>{ const box=document.getElementById('expNamaSuggestBox'); if(box) box.classList.remove('show'); }, 150);
}
function selectExpenseCatalogSuggest(id){
  const match = expenseCatalog.find(s=>String(s.id)===String(id));
  if(!match) return;
  document.getElementById('expNama').value = match.nama;
  document.getElementById('expHarga').value = match.harga;
  document.getElementById('expSatuan').value = match.satuan;
  document.getElementById('expNamaSuggestBox').classList.remove('show');
  updateExpenseSubtotalPreview();
}
function updateExpenseSubtotalPreview(){
  const qty = parseFloat(document.getElementById('expQty').value) || 0;
  const harga = parseFloat(document.getElementById('expHarga').value) || 0;
  document.getElementById('expJumlahPreview').textContent = rupiah(qty*harga);
}
function distinctExpenseCategories(){
  const set = new Set(DEFAULT_EXPENSE_CATEGORIES);
  expenses.forEach(e=>{ if(e.kategori) set.add(e.kategori); });
  return Array.from(set);
}
function showExpKategoriSuggest(){
  const val = document.getElementById('expKategori').value.trim().toLowerCase();
  const box = document.getElementById('expKategoriSuggestBox');
  const options = distinctExpenseCategories().filter(k=>!val || k.toLowerCase().includes(val));
  if(options.length===0){ box.classList.remove('show'); box.innerHTML=''; return; }
  box.innerHTML = options.map(k=>`<div class="suggest-item" onmousedown="event.preventDefault();selectExpKategoriSuggest('${k.replace(/'/g,"\\'")}')">${escapeHTML(k)}</div>`).join('');
  box.classList.add('show');
}
function hideExpKategoriSuggestDelayed(){
  setTimeout(()=>{ const box=document.getElementById('expKategoriSuggestBox'); if(box) box.classList.remove('show'); }, 150);
}
function selectExpKategoriSuggest(k){
  document.getElementById('expKategori').value = k;
  document.getElementById('expKategoriSuggestBox').classList.remove('show');
}

/* ---- Katalog Barang/Jasa Pengeluaran (saran otomatis, mirip Katalog Layanan) ---- */
function openExpenseCatalog(){
  resetExpenseCatalogForm();
  renderExpenseCatalogList();
  document.getElementById('expenseCatalogModal').classList.add('show');
}
function closeExpenseCatalog(){ document.getElementById('expenseCatalogModal').classList.remove('show'); }
function resetExpenseCatalogForm(){
  editingExpenseCatalogId = null;
  document.getElementById('expCatNama').value = '';
  document.getElementById('expCatSatuan').value = 'pcs';
  document.getElementById('expCatHarga').value = '';
  document.getElementById('expCatSubmitBtn').textContent = t('+ Tambah ke Katalog');
  document.getElementById('expCatCancelBtn').style.display = 'none';
}
function editExpenseCatalogItem(id){
  const item = expenseCatalog.find(s=>s.id===id);
  if(!item) return;
  editingExpenseCatalogId = id;
  document.getElementById('expCatNama').value = item.nama;
  document.getElementById('expCatSatuan').value = item.satuan;
  document.getElementById('expCatHarga').value = item.harga;
  document.getElementById('expCatSubmitBtn').textContent = t('Simpan Perubahan');
  document.getElementById('expCatCancelBtn').style.display = 'inline-flex';
}
async function addOrUpdateExpenseCatalogItem(){
  const nama = document.getElementById('expCatNama').value.trim();
  if(!nama){ showToast(t('Nama barang/jasa wajib diisi')); return; }
  const satuan = document.getElementById('expCatSatuan').value;
  const harga = parseFloat(document.getElementById('expCatHarga').value) || 0;
  if(editingExpenseCatalogId){
    const { error } = await sb.from('expense_catalog').update({ nama, satuan, harga }).eq('id', editingExpenseCatalogId);
    if(error){ showToast(t('Gagal menyimpan perubahan — pastikan tabel expense_catalog sudah dibuat')); return; }
    showToast(t('Katalog diperbarui'));
  } else {
    const { error } = await sb.from('expense_catalog').insert({ user_id: shopOwnerId, nama, satuan, harga });
    if(error){ showToast(t('Gagal menambah katalog — pastikan tabel expense_catalog sudah dibuat')); return; }
    showToast(t('Ditambahkan ke katalog'));
  }
  await loadExpenseCatalogFromDB();
  resetExpenseCatalogForm();
  renderExpenseCatalogList();
}
async function deleteExpenseCatalogItem(id){
  const { error } = await sb.from('expense_catalog').delete().eq('id', id);
  if(error){ showToast(t('Gagal menghapus')); return; }
  await loadExpenseCatalogFromDB();
  renderExpenseCatalogList();
  showToast(t('Dihapus dari katalog'));
}
function renderExpenseCatalogList(){
  const el = document.getElementById('expenseCatalogList');
  if(expenseCatalog.length===0){
    el.innerHTML = `<div style="font-size:12.5px;color:var(--ink-soft);text-align:center;padding:14px 0;">${t('Katalog masih kosong. Tambahkan barang/jasa di atas.')}</div>`;
    return;
  }
  el.innerHTML = expenseCatalog.map(s=>`
    <div class="item-line" style="align-items:center;">
      <span>${escapeHTML(s.nama)} <span style="color:var(--ink-soft);">(${s.satuan})</span></span>
      <span style="display:flex;align-items:center;gap:10px;">
        ${rupiah(s.harga)}
        <button onclick="editExpenseCatalogItem('${s.id}')" style="background:none;border:none;color:var(--suds);font-size:13px;cursor:pointer;">${t('Edit')}</button>
        <button onclick="deleteExpenseCatalogItem('${s.id}')" style="background:none;border:none;color:var(--danger);font-size:15px;cursor:pointer;">✕</button>
      </span>
    </div>`).join('');
}

/* ---- Catat & hapus pengeluaran (nota per item, mirip Transaksi Baru) ---- */
async function submitExpense(){
  const tanggal = document.getElementById('expTanggal').value || todayISO();
  const nama = document.getElementById('expNama').value.trim();
  const qty = parseFloat(document.getElementById('expQty').value) || 0;
  const satuan = document.getElementById('expSatuan').value;
  const harga = parseFloat(document.getElementById('expHarga').value) || 0;
  const kategori = document.getElementById('expKategori').value.trim() || t('Lain-lain');
  const catatan = document.getElementById('expCatatan').value.trim();
  const jumlah = qty*harga;
  if(!nama){ showToast(t('Isi nama barang/jasa yang dibeli')); return; }
  if(jumlah<=0){ showToast(t('Isi qty dan harga dengan benar')); return; }
  const { data, error } = await sb.from('expenses').insert({
    user_id: shopOwnerId, tanggal, nama, qty, satuan, harga, jumlah, kategori, catatan,
    ...(currentOutletId ? { outlet_id: currentOutletId } : {})
  }).select().single();
  if(error){ showToast(t('Gagal menyimpan pengeluaran — pastikan tabel expenses sudah dimigrasi (lihat README)')); return; }
  expenses.push({ id:data.id, tanggal:data.tanggal, nama:data.nama, qty:Number(data.qty)||0, satuan:data.satuan||'', harga:Number(data.harga)||0, jumlah:Number(data.jumlah)||0, kategori:data.kategori, catatan:data.catatan||'', outletId: data.outlet_id!=null ? String(data.outlet_id) : null });
  document.getElementById('expNama').value = '';
  document.getElementById('expQty').value = '1';
  document.getElementById('expHarga').value = '';
  document.getElementById('expCatatan').value = '';
  updateExpenseSubtotalPreview();
  showToast(t('Pengeluaran dicatat'));
  renderExpenseList();
}
async function deleteExpense(id){
  const exp = expenses.find(e=>e.id===id);
  if(!exp) return;
  if(!confirm(t('Hapus catatan pengeluaran ini?'))) return;
  const { error } = await sb.from('expenses').delete().eq('id', id);
  if(error){ showToast(t('Gagal menghapus pengeluaran')); return; }
  expenses = expenses.filter(e=>e.id!==id);
  renderExpenseList();
  showToast(t('Pengeluaran dihapus'), {
    label: t('Urungkan'),
    onClick: async ()=>{
      const { data, error: err2 } = await sb.from('expenses').insert({
        user_id: shopOwnerId, tanggal: exp.tanggal, nama: exp.nama, qty: exp.qty, satuan: exp.satuan,
        harga: exp.harga, jumlah: exp.jumlah, kategori: exp.kategori, catatan: exp.catatan,
        ...(exp.outletId ? { outlet_id: exp.outletId } : {})
      }).select().single();
      if(err2){ showToast(t('Gagal mengembalikan pengeluaran')); return; }
      expenses.push({ id:data.id, tanggal:data.tanggal, nama:data.nama, qty:Number(data.qty)||0, satuan:data.satuan||'', harga:Number(data.harga)||0, jumlah:Number(data.jumlah)||0, kategori:data.kategori, catatan:data.catatan||'', outletId: data.outlet_id!=null ? String(data.outlet_id) : null });
      renderExpenseList();
      showToast(t('Pengeluaran dikembalikan'));
    }
  });
}

/* ---- Periode Harian/Bulanan/Tahunan + laporan rincian pengeluaran ---- */
function toggleExpPeriodeFields(){
  const type = document.getElementById('expPeriodeType').value;
  document.getElementById('expHariField').style.display = type==='harian' ? 'block' : 'none';
  document.getElementById('expBulanField').style.display = type==='bulanan' ? 'block' : 'none';
  document.getElementById('expTahunField').style.display = type==='tahunan' ? 'block' : 'none';
}
function getExpPeriodeRange(){
  const type = document.getElementById('expPeriodeType').value;
  if(type==='harian'){
    const tgl = document.getElementById('expHari').value;
    if(!tgl) return null;
    return { dari: tgl, sampai: tgl, label: fmtDate(tgl) };
  }
  if(type==='bulanan'){
    const ym = document.getElementById('expBulan').value;
    if(!ym) return null;
    const [yy,mm] = ym.split('-').map(Number);
    const lastDay = new Date(yy, mm, 0).getDate();
    return { dari: `${ym}-01`, sampai: `${ym}-${String(lastDay).padStart(2,'0')}`, label: `${t('Bulan')} ${ym}` };
  }
  if(type==='tahunan'){
    const yy = document.getElementById('expTahun').value;
    if(!yy) return null;
    return { dari: `${yy}-01-01`, sampai: `${yy}-12-31`, label: `${t('Tahun')} ${yy}` };
  }
  return null;
}
function renderExpenseList(){
  if(!document.getElementById('expBulan').value) document.getElementById('expBulan').value = todayISO().slice(0,7);
  if(!document.getElementById('expHari').value) document.getElementById('expHari').value = todayISO();
  const range = getExpPeriodeRange();
  const el = document.getElementById('expenseList');
  if(!range){
    document.getElementById('expStTotal').textContent = rupiah(0);
    document.getElementById('expStCount').textContent = '0';
    el.innerHTML = `<div class="empty"><h3>${t('Lengkapi periode dulu')}</h3></div>`;
    expenseReportCache = null;
    return;
  }
  const listAsc = sortByTanggalAsc(visibleExpenses().filter(e=>e.tanggal>=range.dari && e.tanggal<=range.sampai));
  const total = listAsc.reduce((s,e)=>s+e.jumlah,0);
  document.getElementById('expStTotal').textContent = rupiah(total);
  document.getElementById('expStCount').textContent = listAsc.length;

  if(listAsc.length===0){
    el.innerHTML = `<div class="empty">
      <svg class="bubble-icon" viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="21" stroke="#146C8E" stroke-width="2" opacity="0.4"/></svg>
      <h3>${t('Belum ada pengeluaran periode ini')}</h3>
      <p>${t('Catat pengeluaran seperti listrik, gaji, atau sabun di form atas.')}</p>
    </div>`;
  } else {
    el.innerHTML = listAsc.slice().reverse().map(e=>`
      <div class="trx-card">
        <div class="trx-top">
          <div>
            <div class="trx-name">${escapeHTML(e.nama||e.kategori)}</div>
            <div class="kode">${fmtDate(e.tanggal)} · ${escapeHTML(e.kategori)}</div>
          </div>
          <span class="trx-total" style="color:var(--warn);">-${rupiah(e.jumlah)}</span>
        </div>
        ${e.qty ? `<div class="trx-meta">${e.qty} ${escapeHTML(e.satuan||'')} x ${rupiah(e.harga||0)}</div>` : ''}
        ${e.catatan ? `<div class="trx-meta">${escapeHTML(e.catatan)}</div>` : ''}
        <div class="trx-actions">
          <button class="btn btn-danger-ghost btn-sm" onclick="deleteExpense('${e.id}')">${t('🗑️ Hapus')}</button>
        </div>
      </div>
    `).join('');
  }
  expenseReportCache = { range, list: listAsc, total };
}
function downloadExpensePDF(){
  if(!isSubscriptionActive()){ showPaywallModal(); return; }
  if(!expenseReportCache){ showToast(t('Tampilkan laporan dulu sebelum unduh PDF')); return; }
  const { range, list, total } = expenseReportCache;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit:'mm', format:'a4' });
  const colX = { tgl:14, nama:40, kategori:112, qty:150, total:196 };

  doc.setFont('helvetica','bold'); doc.setFontSize(14);
  doc.text(settings.shopName || 'Laundry Batapas.id', 14, 16);
  doc.setFont('helvetica','normal'); doc.setFontSize(10);
  if(settings.address) doc.text(settings.address, 14, 22);
  doc.setFontSize(11);
  doc.text(t('Laporan Rincian Pengeluaran'), 14, 30);
  doc.setFontSize(9.5);
  doc.text(`${t('Periode:')} ${range.label}`, 14, 36);

  let y = 46;
  doc.setFont('helvetica','bold'); doc.setFontSize(9);
  doc.text(t('Tanggal'), colX.tgl, y);
  doc.text(t('Nama Barang/Jasa'), colX.nama, y);
  doc.text(t('Kategori'), colX.kategori, y);
  doc.text(t('Qty'), colX.qty, y);
  doc.text(t('Jumlah'), colX.total, y, { align:'right' });
  y += 2.5;
  doc.setLineWidth(0.4);
  doc.line(14, y, 196, y);
  y += 6;

  doc.setFont('helvetica','normal'); doc.setFontSize(8.5);
  if(list.length===0){
    doc.text(t('Tidak ada pengeluaran pada periode ini.'), 14, y);
    y += 6;
  }
  list.forEach(e=>{
    if(y > 280){ doc.addPage(); y = 20; }
    doc.text(fmtDate(e.tanggal), colX.tgl, y);
    const nama = e.nama || '-';
    doc.text(nama.length>30 ? nama.slice(0,30)+'…' : nama, colX.nama, y);
    const kategori = e.kategori || '-';
    doc.text(kategori.length>16 ? kategori.slice(0,16)+'…' : kategori, colX.kategori, y);
    doc.text(e.qty ? `${e.qty} ${e.satuan||''}` : '-', colX.qty, y);
    doc.text(rupiah(e.jumlah), colX.total, y, { align:'right' });
    if(e.catatan){
      y += 4.5;
      doc.setFontSize(7.5); doc.setTextColor(120);
      doc.text(e.catatan.length>70 ? e.catatan.slice(0,70)+'…' : e.catatan, colX.nama, y);
      doc.setFontSize(8.5); doc.setTextColor(0);
    }
    y += 6.5;
  });

  y += 3;
  doc.setLineWidth(0.6);
  doc.line(14, y, 196, y);
  y += 7;
  doc.setFont('helvetica','bold'); doc.setFontSize(11);
  doc.text(t('Total Pengeluaran'), colX.kategori, y);
  doc.text(rupiah(total), colX.total, y, { align:'right' });

  doc.save(`Pengeluaran-${range.label.replace(/\s+/g,'-')}.pdf`);
}

