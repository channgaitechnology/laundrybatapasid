/* ===================== TAB SWITCH ===================== */
var currentTabName = 'baru';
function switchTab(name){
  currentTabName = name;
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  const map = { baru:'view-baru', riwayat:'view-riwayat', laporan:'view-laporan', nota:'view-nota', paket:'view-paket', pengeluaran:'view-pengeluaran', papan:'view-papan' };
  document.getElementById(map[name]).classList.add('active');
  const tabBtn = document.querySelector('.tab[data-tab="'+name+'"]');
  if(tabBtn) tabBtn.classList.add('active');
  if(name==='riwayat') renderHistory();
  if(name==='laporan'){ renderReport(); renderLabaRugi(); renderPeringkatPelanggan(); }
  if(name==='paket') renderSubscriptions();
  if(name==='pengeluaran') renderExpenseList();
  if(name==='papan') renderWorkBoard();
  if(['baru','riwayat','paket','laporan','pengeluaran','papan'].includes(name)){
    try{ localStorage.setItem('nk_lastTab', name); }catch(e){}
  }
}

/* ===================== ITEM FORM (transaksi baru) ===================== */
function addItem(){
  const nama = document.getElementById('itNama').value.trim();
  const qty = parseFloat(document.getElementById('itQty').value) || 0;
  const satuan = document.getElementById('itSatuan').value;
  const harga = parseFloat(document.getElementById('itHarga').value) || 0;
  if(!nama || qty<=0 || harga<=0){
    showToast('Lengkapi nama, qty, dan harga layanan');
    return;
  }
  draftItems.push({ nama, qty, satuan, harga, subtotal: qty*harga });
  document.getElementById('itNama').value='';
  document.getElementById('itQty').value='1';
  document.getElementById('itHarga').value='';
  renderDraftItems();
}
function removeItem(idx){
  draftItems.splice(idx,1);
  renderDraftItems();
}
function renderDraftItems(){
  const el = document.getElementById('itemsList');
  if(draftItems.length===0){
    el.innerHTML = '<div style="font-size:12.5px;color:var(--ink-soft);text-align:center;padding:8px 0;">Belum ada layanan ditambahkan</div>';
  } else {
    el.innerHTML = draftItems.map((it,i)=>`
      <div class="item-line">
        <span>${escapeHTML(it.nama)} — ${it.qty} ${escapeHTML(it.satuan)} × ${rupiah(it.harga)}</span>
        <span style="display:flex;align-items:center;gap:8px;">${rupiah(it.subtotal)}
          <button onclick="removeItem(${i})" style="background:none;border:none;color:var(--danger);font-size:15px;cursor:pointer;">✕</button>
        </span>
      </div>`).join('');
  }
  updateTotalPreview();
}
function updateTotalPreview(){
  const subtotal = draftItems.reduce((s,it)=>s+it.subtotal,0);
  const diskon = parseFloat(document.getElementById('inDiskon').value) || 0;
  const total = Math.max(subtotal - diskon, 0);
  document.getElementById('totalPreview').textContent = rupiah(total);
}
document.getElementById('inDiskon').addEventListener('input', updateTotalPreview);

/* ===================== SUBMIT TRANSAKSI (tambah / edit) ===================== */
async function submitTransaction(){
  if(!isSubscriptionActive()){ showPaywallModal(); return; }
  const nama = document.getElementById('inNama').value.trim();
  const hp = document.getElementById('inHP').value.trim();
  const tanggal = document.getElementById('inTanggal').value || todayISO();
  const estimasi = document.getElementById('inEstimasi').value || '';
  const diskon = parseFloat(document.getElementById('inDiskon').value) || 0;
  const dp = parseFloat(document.getElementById('inDP').value) || 0;
  const status = document.getElementById('inStatus').value;
  const catatan = document.getElementById('inCatatan').value.trim();

  if(!nama){ showToast('Nama pelanggan wajib diisi'); return; }
  if(draftItems.length===0){ showToast('Tambahkan minimal satu layanan'); return; }

  const subtotal = draftItems.reduce((s,it)=>s+it.subtotal,0);
  const total = Math.max(subtotal - diskon, 0);
  /* Status Lunas selalu berarti minimal lunas (dp >= total) — tapi kalau kasir sengaja
     isi DP lebih besar dari total (pelanggan bayar lebih & kelebihannya dititip),
     nilai itu tetap disimpan apa adanya, bukan ditimpa jadi persis sama dengan total. */
  const finalDp = status==='lunas' ? Math.max(dp, total) : dp;

  if(editingTransactionId){
    const before = transactions.find(t=>t.id===editingTransactionId);
    const beforeSnapshot = before ? {...before} : null;
    const { data, error } = await sb.from('transactions').update({
      nama, hp, tanggal, estimasi: estimasi || null,
      items: draftItems.slice(), diskon, total, dp: finalDp, status, catatan
    }).eq('id', editingTransactionId).select().single();
    if(error){ showToast('Gagal memperbarui transaksi'); return; }
    const idx = transactions.findIndex(t=>t.id===editingTransactionId);
    const trx = {
      id: data.id, kode: data.kode, nama: data.nama, hp: data.hp,
      tanggal: data.tanggal, estimasi: data.estimasi, items: data.items,
      diskon: Number(data.diskon), total: Number(data.total), dp: Number(data.dp),
      status: data.status, catatan: data.catatan,
      workStatus: data.work_status || (idx>-1 ? transactions[idx].workStatus : 'belum') || 'belum',
      outletId: data.outlet_id!=null ? String(data.outlet_id) : (idx>-1 ? transactions[idx].outletId : null)
    };
    if(idx>-1) transactions[idx] = trx;
    if(beforeSnapshot) await logEditHistory('transaction', trx.id, diffTransactionFields(beforeSnapshot, trx));
    resetTransactionForm();
    showToast('Transaksi diperbarui');
    openReceipt(trx.id);
    return;
  }

  const { data, error } = await sb.from('transactions').insert({
    user_id: shopOwnerId,
    kode: nextKode(),
    nama, hp, tanggal,
    estimasi: estimasi || null,
    items: draftItems.slice(),
    diskon, total, dp: finalDp,
    status, catatan,
    /* outlet_id sengaja CUMA dikirim kalau lagi aktif di konteks outlet
       tertentu (currentOutletId terisi) — supaya toko yang belum pernah
       bikin outlet sama sekali (fitur ini opt-in) tetap kirim payload
       persis seperti sebelumnya, tidak berisiko gagal gara-gara kolom
       outlet_id belum ada di database lama yang belum dimigrasi. */
    ...(currentOutletId ? { outlet_id: currentOutletId } : {})
  }).select().single();

  if(error){ showToast('Gagal menyimpan transaksi'); return; }

  const trx = {
    id: data.id, kode: data.kode, nama: data.nama, hp: data.hp,
    tanggal: data.tanggal, estimasi: data.estimasi, items: data.items,
    diskon: Number(data.diskon), total: Number(data.total), dp: Number(data.dp),
    status: data.status, catatan: data.catatan, workStatus: data.work_status || 'belum',
    outletId: data.outlet_id!=null ? String(data.outlet_id) : null
  };
  transactions.push(trx);
  resetTransactionForm();
  showToast('Transaksi tersimpan');
  openReceipt(trx.id);
  saveContactIfNew(nama, hp);
}
function resetTransactionForm(){
  document.getElementById('inNama').value='';
  document.getElementById('inHP').value='';
  document.getElementById('inTanggal').value=todayISO();
  document.getElementById('inEstimasi').value='';
  document.getElementById('inDiskon').value='0';
  document.getElementById('inDP').value='0';
  document.getElementById('inStatus').value='lunas';
  document.getElementById('inCatatan').value='';
  draftItems = [];
  renderDraftItems();
  editingTransactionId = null;
  document.getElementById('submitTrxBtn').textContent = 'Simpan & Buat Nota';
  document.getElementById('cancelEditTrxBtn').style.display = 'none';
}
function editTransaction(id){
  const t = transactions.find(x=>x.id===id);
  if(!t) return;
  editingTransactionId = id;
  document.getElementById('inNama').value = t.nama;
  document.getElementById('inHP').value = t.hp||'';
  document.getElementById('inTanggal').value = t.tanggal||'';
  document.getElementById('inEstimasi').value = t.estimasi||'';
  document.getElementById('inDiskon').value = t.diskon||0;
  document.getElementById('inDP').value = t.dp||0;
  document.getElementById('inStatus').value = t.status;
  document.getElementById('inCatatan').value = t.catatan||'';
  draftItems = (t.items||[]).map(it=>({...it}));
  renderDraftItems();
  document.getElementById('submitTrxBtn').textContent = 'Update Transaksi';
  document.getElementById('cancelEditTrxBtn').style.display = 'block';
  switchTab('baru');
  showToast('Mode edit — ubah data lalu tekan Update Transaksi');
}
function cancelEditTransaction(){
  resetTransactionForm();
  showToast('Edit dibatalkan');
}
