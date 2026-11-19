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
attachSuggestKeyNav('expNama','expNamaSuggestBox');
function updateExpenseSubtotalPreview(){
  const qty = parseFloat(document.getElementById('expQty').value) || 0;
  const harga = parseFloat(document.getElementById('expHarga').value) || 0;
  document.getElementById('expJumlahPreview').textContent = rupiah(qty*harga);
}
/* Kategori bawaan yang "dihapus" user disembunyikan lewat daftar ini
   (disimpan per toko di perangkat ini) -- kategori bawaan itu hardcode di
   DEFAULT_EXPENSE_CATEGORIES, jadi tidak ada baris database yang bisa
   dihapus. Kategori buatan sendiri tidak butuh ini: ia otomatis hilang dari
   daftar begitu tidak ada lagi pengeluaran yang memakainya. */
function expHiddenCatsKey(){ return 'nk_hiddenExpCats_' + (shopOwnerId||''); }
function getHiddenExpenseCategories(){
  try{ const a = JSON.parse(localStorage.getItem(expHiddenCatsKey())||'[]'); return Array.isArray(a) ? a : []; }catch(e){ return []; }
}
function setHiddenExpenseCategories(arr){
  try{ localStorage.setItem(expHiddenCatsKey(), JSON.stringify(arr)); }catch(e){}
}
function distinctExpenseCategories(){
  const hidden = getHiddenExpenseCategories();
  const set = new Set(DEFAULT_EXPENSE_CATEGORIES.filter(k=>!hidden.includes(k)));
  expenses.forEach(e=>{ if(e.kategori) set.add(e.kategori); });
  return Array.from(set);
}
/* REGRESI KEAMANAN (audit 13 Okt 2026): dulu nama kategori mentah disuntik
   langsung ke atribut onmousedown (cuma tanda kutip TUNGGAL yang di-escape
   manual, tanda kutip GANDA tidak) -- kategori pengeluaran adalah free-text
   bebas diketik kasir, jadi nilai seperti `" onmouseover="alert(1)` bisa
   memutus atribut HTML dan menyuntik event handler baru, disimpan permanen
   (stored XSS) lalu tereksekusi begitu user LAIN di toko yang sama (termasuk
   owner) membuka saran kategori ini. Sekarang pakai pola index ke array
   `expKategoriSuggestOptions` (sama seperti selectRekapNamaSuggest()/
   js/22-rekap-pelanggan.js) -- onclick cuma berisi angka, nama kategori
   sendiri tidak pernah masuk ke markup HTML sama sekali selain lewat
   escapeHTML() di teks yang ditampilkan. */
let expKategoriSuggestOptions = [];
function showExpKategoriSuggest(){
  const val = document.getElementById('expKategori').value.trim().toLowerCase();
  const box = document.getElementById('expKategoriSuggestBox');
  const options = distinctExpenseCategories().filter(k=>!val || k.toLowerCase().includes(val));
  expKategoriSuggestOptions = options;
  if(options.length===0){ box.classList.remove('show'); box.innerHTML=''; return; }
  // Tiap saran punya tombol ✏️ (ganti nama) dan 🗑️ (hapus + pindahkan). Tombol
  // memanggil expKategoriSuggestAction(jenis, indeks) -- nama kategori tidak
  // pernah masuk atribut HTML, hanya indeks.
  box.innerHTML = options.map((k,i)=>`<div class="suggest-item" style="display:flex;align-items:center;justify-content:space-between;gap:8px;" onmousedown="event.preventDefault();selectExpKategoriSuggest(${i})"><span style="flex:1;min-width:0;">${escapeHTML(k)}</span><span style="display:flex;gap:4px;flex-shrink:0;"><button type="button" aria-label="${t('Edit')}" style="background:none;border:none;font-size:16px;padding:4px 8px;cursor:pointer;" onmousedown="event.preventDefault();event.stopPropagation();expKategoriSuggestAction('rename',${i})">✏️</button><button type="button" aria-label="${t('Hapus')}" style="background:none;border:none;font-size:16px;padding:4px 8px;cursor:pointer;" onmousedown="event.preventDefault();event.stopPropagation();expKategoriSuggestAction('delete',${i})">🗑️</button></span></div>`).join('');
  box.classList.add('show');
}
/* Dari daftar saran: langsung buka Kelola Kategori dengan panel ganti nama /
   hapus (pilihan pindah ke kategori lain) untuk kategori yang dipilih. */
function expKategoriSuggestAction(kind, i){
  const name = expKategoriSuggestOptions[i];
  if(name===undefined) return;
  const box = document.getElementById('expKategoriSuggestBox');
  if(box) box.classList.remove('show');
  openExpenseCategories();
  const idx = expCatMgrNames.indexOf(name);
  if(idx>=0) expenseCategoryAction(kind, idx);
}
function hideExpKategoriSuggestDelayed(){
  setTimeout(()=>{ const box=document.getElementById('expKategoriSuggestBox'); if(box) box.classList.remove('show'); }, 150);
}
function selectExpKategoriSuggest(i){
  const k = expKategoriSuggestOptions[i];
  if(k===undefined) return;
  document.getElementById('expKategori').value = k;
  document.getElementById('expKategoriSuggestBox').classList.remove('show');
}
attachSuggestKeyNav('expKategori','expKategoriSuggestBox');

/* Saran nama toko/tempat bayar dari pengeluaran sebelumnya (pola index ke
   array, sama alasannya dengan kategori di atas -- nama toko free-text, tidak
   boleh masuk atribut HTML mentah). */
let expTokoSuggestOptions = [];
function distinctExpenseStores(){
  const seen = new Map();
  expenses.forEach(e=>{
    const k = (e.toko||'').trim();
    if(k && !seen.has(k.toLowerCase())) seen.set(k.toLowerCase(), k);
  });
  return Array.from(seen.values()).sort((a,b)=>a.localeCompare(b,'id'));
}
function showExpTokoSuggest(){
  const val = document.getElementById('expToko').value.trim().toLowerCase();
  const box = document.getElementById('expTokoSuggestBox');
  const options = distinctExpenseStores().filter(k=>!val || k.toLowerCase().includes(val)).slice(0,30);
  expTokoSuggestOptions = options;
  if(options.length===0){ box.classList.remove('show'); box.innerHTML=''; return; }
  box.innerHTML = options.map((k,i)=>`<div class="suggest-item" onmousedown="event.preventDefault();selectExpTokoSuggest(${i})">${escapeHTML(k)}</div>`).join('');
  box.classList.add('show');
}
function hideExpTokoSuggestDelayed(){
  setTimeout(()=>{ const box=document.getElementById('expTokoSuggestBox'); if(box) box.classList.remove('show'); }, 150);
}
function selectExpTokoSuggest(i){
  const k = expTokoSuggestOptions[i];
  if(k===undefined) return;
  document.getElementById('expToko').value = k;
  document.getElementById('expTokoSuggestBox').classList.remove('show');
}
attachSuggestKeyNav('expToko','expTokoSuggestBox');

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

/* ---- Catat, edit & hapus pengeluaran (nota per item, mirip Transaksi Baru) ---- */
function clearExpenseForm(){
  document.getElementById('expNama').value = '';
  document.getElementById('expQty').value = '1';
  document.getElementById('expHarga').value = '';
  document.getElementById('expCatatan').value = '';
  updateExpenseSubtotalPreview();
}
function setExpenseEditUI(on){
  document.getElementById('expFormTitle').textContent = on ? t('Edit Pengeluaran') : t('Catat Pengeluaran');
  document.getElementById('expSubmitBtn').textContent = on ? t('Simpan Perubahan') : t('+ Simpan Pengeluaran');
  document.getElementById('expCancelBtn').style.display = on ? 'block' : 'none';
  document.getElementById('expEditBanner').style.display = on ? 'block' : 'none';
}
function cancelExpenseEdit(){
  editingExpenseId = null;
  clearExpenseForm();
  document.getElementById('expToko').value = '';
  setExpenseEditUI(false);
}
function editExpense(id){
  const exp = expenses.find(e=>String(e.id)===String(id));
  if(!exp) return;
  if(String(exp.id).startsWith('off_exp_')){
    showToast(t('Pengeluaran ini belum tersinkron. Tunggu sampai online lalu edit.'));
    return;
  }
  editingExpenseId = exp.id;
  document.getElementById('expTanggal').value = exp.tanggal;
  document.getElementById('expNama').value = exp.nama || '';
  document.getElementById('expQty').value = exp.qty!=null ? exp.qty : 1;
  const sat = document.getElementById('expSatuan');
  if(exp.satuan && !Array.from(sat.options).some(o=>o.value===exp.satuan || o.text===exp.satuan)){
    sat.add(new Option(exp.satuan, exp.satuan));
  }
  if(exp.satuan) sat.value = exp.satuan;
  document.getElementById('expHarga').value = exp.harga!=null ? exp.harga : '';
  document.getElementById('expKategori').value = exp.kategori || '';
  document.getElementById('expToko').value = exp.toko || '';
  document.getElementById('expCatatan').value = exp.catatan || '';
  updateExpenseSubtotalPreview();
  setExpenseEditUI(true);
  showExpenseTab('catat');
  window.scrollTo(0,0);
  document.getElementById('expNama').focus();
}
async function submitExpense(){
  const tanggal = document.getElementById('expTanggal').value || todayISO();
  const nama = document.getElementById('expNama').value.trim();
  const qty = parseFloat(document.getElementById('expQty').value) || 0;
  const satuan = document.getElementById('expSatuan').value;
  const harga = parseFloat(document.getElementById('expHarga').value) || 0;
  const kategori = document.getElementById('expKategori').value.trim().slice(0,60) || t('Lain-lain');
  const toko = document.getElementById('expToko').value.trim().slice(0,80);
  const catatan = document.getElementById('expCatatan').value.trim();
  const jumlah = qty*harga;
  if(!nama){ showToast(t('Isi nama barang/jasa yang dibeli')); return; }
  if(jumlah<=0){ showToast(t('Isi qty dan harga dengan benar')); return; }

  /* ---- Mode EDIT ---- */
  if(editingExpenseId){
    if(offlineMode || navigator.onLine === false){
      showToast(t('Edit pengeluaran butuh internet. Sambungkan internet dulu.'));
      return;
    }
    const exp = expenses.find(e=>String(e.id)===String(editingExpenseId));
    if(!exp){ cancelExpenseEdit(); return; }
    const updatePayload = { tanggal, nama, qty, satuan, harga, jumlah, kategori, catatan };
    // Kolom `toko` baru -- hanya dikirim kalau ada isinya atau sebelumnya ada
    // isinya (untuk mengosongkan), supaya edit tetap jalan walau migrasi
    // kolom belum dijalankan.
    if(toko || exp.toko) updatePayload.toko = toko || null;
    const { data, error } = await sb.from('expenses').update(updatePayload).eq('id', exp.id).select().single();
    if(error){
      showToast(t('Gagal menyimpan perubahan pengeluaran'));
      return;
    }
    const before = { ...exp };
    const updated = mapExpenseRow(data);
    Object.assign(exp, updated);
    const fields = [
      ['tanggal', t('Tanggal'), v=>fmtDate(v)], ['nama', t('Nama Barang/Jasa'), v=>v||'-'],
      ['qty', t('Qty'), v=>String(v??'-')], ['satuan', t('Satuan'), v=>v||'-'],
      ['harga', t('Harga / Satuan'), v=>rupiah(v||0)], ['kategori', t('Kategori'), v=>v||'-'],
      ['toko', t('Nama Toko / Tempat Bayar'), v=>v||'-'], ['catatan', t('Catatan'), v=>v||'-']
    ];
    const changes = fields.filter(([k])=>String(before[k]??'')!==String(exp[k]??''))
      .map(([k,label,fmt])=>({ field:k, label, from:fmt(before[k]), to:fmt(exp[k]) }));
    if(changes.length) await logEditHistory('expense', exp.id, changes);
    cancelExpenseEdit();
    showToast(t('Pengeluaran diperbarui'));
    renderExpenseList();
    showExpenseTab('riwayat'); // kembali ke daftar, tempat edit dimulai
    return;
  }

  /* ---- Mode TAMBAH ---- */
  const insertPayload = {
    user_id: shopOwnerId, tanggal, nama, qty, satuan, harga, jumlah, kategori, catatan,
    ...(toko ? { toko } : {}),
    ...(currentOutletId ? { outlet_id: currentOutletId } : {})
  };
  const localRow = (id)=>({ id, tanggal, nama, qty: Number(qty)||0, satuan, harga: Number(harga)||0, jumlah: Number(jumlah)||0, kategori, catatan, toko, outletId: currentOutletId ? String(currentOutletId) : null });

  if(offlineMode || navigator.onLine === false){
    expenses.push(localRow('off_exp_' + Date.now() + '_' + Math.random().toString(36).slice(2,8)));
    await offlineEnqueue('ADD_EXPENSE', insertPayload);
    await offlineSaveSnapshot();
    clearExpenseForm();
    showToast(t('Pengeluaran dicatat (offline)'));
    renderExpenseList();
    return;
  }

  const { data, error } = await sb.from('expenses').insert(insertPayload).select().single();
  if(error){
    if(offlineIsNetworkError(error)){
      expenses.push(localRow('off_exp_' + Date.now() + '_' + Math.random().toString(36).slice(2,8)));
      await offlineEnqueue('ADD_EXPENSE', insertPayload);
      await offlineSaveSnapshot();
      clearExpenseForm();
      showToast(t('Sinyal putus. Pengeluaran dicatat (offline)'));
      renderExpenseList();
      return;
    }
    showToast(toko
      ? t('Gagal menyimpan pengeluaran — pastikan kolom toko sudah dimigrasi (lihat docs/migrasi-database.md)')
      : t('Gagal menyimpan pengeluaran — pastikan tabel expenses sudah dimigrasi (lihat README)'));
    return;
  }
  expenses.push(mapExpenseRow(data));
  clearExpenseForm();
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
  if(String(editingExpenseId)===String(id)) cancelExpenseEdit();
  renderExpenseList();
  // Tercatat di edit_log (entity_type 'expense') -- lihat komentar di
  // js/13-riwayat-edit.js kenapa ini perlu walau pengeluaran tidak punya
  // fitur EDIT: tanpa ini, penghapusan pengeluaran (mis. buat mengecilkan
  // biaya di Laporan/Laba Rugi) tidak meninggalkan jejak apa pun.
  await logEditHistory('expense', id, [{ field:'_deleted', label:t('Dihapus'), from:`${exp.nama} (${rupiah(exp.jumlah)})`, to:t('dihapus') }]);
  showToast(t('Pengeluaran dihapus'), {
    label: t('Urungkan'),
    onClick: async ()=>{
      const { data, error: err2 } = await sb.from('expenses').insert({
        user_id: shopOwnerId, tanggal: exp.tanggal, nama: exp.nama, qty: exp.qty, satuan: exp.satuan,
        harga: exp.harga, jumlah: exp.jumlah, kategori: exp.kategori, catatan: exp.catatan,
        ...(exp.toko ? { toko: exp.toko } : {}),
        ...(exp.outletId ? { outlet_id: exp.outletId } : {})
      }).select().single();
      if(err2){ showToast(t('Gagal mengembalikan pengeluaran')); return; }
      expenses.push(mapExpenseRow(data));
      renderExpenseList();
      // Undo juga dicatat -- kalau tidak, "Urungkan" jadi cara diam-diam
      // menghapus jejak penghapusan di atas (baris baru dapat id baru, tidak
      // tersambung lagi ke entri _deleted di atas, tapi minimal ada jejaknya).
      await logEditHistory('expense', data.id, [{ field:'_restored', label:t('Dikembalikan'), from:t('terhapus'), to:`${data.nama} (${rupiah(Number(data.jumlah)||0)})` }]);
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
    renderExpenseCategoryRecap([]);
    renderExpenseStoreRecap([]);
    renderExpenseCategoryMonthly();
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
      <div class="trx-card" data-exp-id="${escapeHTML(String(e.id))}">
        <div class="trx-top">
          <div>
            <div class="trx-name">${escapeHTML(e.nama||e.kategori)}</div>
            <div class="kode">${fmtDate(e.tanggal)} · ${escapeHTML(e.kategori)}</div>
          </div>
          <span class="trx-total" style="color:var(--warn);">-${rupiah(e.jumlah)}</span>
        </div>
        ${e.qty ? `<div class="trx-meta">${e.qty} ${escapeHTML(e.satuan||'')} x ${rupiah(e.harga||0)}</div>` : ''}
        ${e.toko ? `<div class="trx-meta">🏪 ${escapeHTML(e.toko)}</div>` : ''}
        ${e.catatan ? `<div class="trx-meta">${escapeHTML(e.catatan)}</div>` : ''}
        <div class="trx-actions">
          <button class="btn btn-ghost btn-sm" onclick="editExpense('${e.id}')">${t('✏️ Edit')}</button>
          <button class="btn btn-danger-ghost btn-sm" onclick="deleteExpense('${e.id}')">${t('🗑️ Hapus')}</button>
        </div>
      </div>
    `).join('');
  }
  expenseReportCache = { range, list: listAsc, total };
  renderExpenseCategoryRecap(listAsc);
  renderExpenseStoreRecap(listAsc);
  renderExpenseCategoryMonthly();
}
function downloadExpensePDF(){
  if(!isSubscriptionActive()){ showPaywallModal(); return; }
  if(!expenseReportCache){ showToast(t('Tampilkan laporan dulu sebelum unduh PDF')); return; }
  const { range, list, total } = expenseReportCache;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit:'mm', format:'a4' });
  const colX = { tgl:14, nama:40, kategori:112, qty:150, total:196 };

  doc.setFont('helvetica','bold'); doc.setFontSize(14);
  doc.text(settings.shopName || t('Toko Laundry Saya'), 14, 16);
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
    const sub = [e.toko ? `${t('Toko')}: ${e.toko}` : '', e.catatan || ''].filter(Boolean).join(' · ');
    if(sub){
      y += 4.5;
      doc.setFontSize(7.5); doc.setTextColor(120);
      doc.text(sub.length>80 ? sub.slice(0,80)+'…' : sub, colX.nama, y);
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
  y += 12;
  y = pdfExpenseCategorySection(doc, y, list, total, range);

  const filenamePengeluaran = `Pengeluaran-${range.label.replace(/\s+/g,'-')}.pdf`;
  saveToDownloadsGallery(doc.output('blob'), filenamePengeluaran);
  doc.save(filenamePengeluaran);
}



/* ===================== HALAMAN (SUB-TAB) PENGELUARAN =====================
   Tab Pengeluaran dibagi jadi beberapa halaman dengan rel tab sempit di kiri
   supaya tidak panjang ke bawah: Catat, Riwayat, Kategori, Bulanan, Toko.
   Kartu pemilih Periode dipakai bersama oleh Riwayat/Kategori/Toko (id-nya
   cuma satu), jadi cuma tampil di halaman-halaman itu. */
const EXP_TABS_WITH_PERIOD = ['riwayat','kategori','toko'];
let expActiveTab = 'catat';
function showExpenseTab(name){
  if(!['catat','riwayat','kategori','bulanan','toko'].includes(name)) name = 'catat';
  expActiveTab = name;
  document.querySelectorAll('#view-pengeluaran .exp-panel').forEach(p=>p.classList.toggle('active', p.dataset.sub===name));
  document.querySelectorAll('#view-pengeluaran .exp-rail-btn').forEach(b=>{
    const on = b.dataset.sub===name;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  const per = document.getElementById('expPeriodCard');
  if(per) per.style.display = EXP_TABS_WITH_PERIOD.includes(name) ? '' : 'none';
}
/* Rekap per toko/tempat bayar untuk periode yang dipilih. */
function renderExpenseStoreRecap(list){
  const el = document.getElementById('expTokoRekap');
  if(!el) return;
  const m = {};
  list.forEach(e=>{
    const k = (e.toko||'').trim() || '';
    if(!m[k]) m[k] = { toko:k, total:0, count:0 };
    m[k].total += e.jumlah; m[k].count += 1;
  });
  const rows = Object.values(m).sort((a,b)=>b.total-a.total);
  const total = rows.reduce((s,r)=>s+r.total,0);
  if(rows.length===0){
    el.innerHTML = `<div style="font-size:12.5px;color:var(--ink-soft);text-align:center;padding:8px 0;">${t('Belum ada pengeluaran periode ini')}</div>`;
    return;
  }
  el.innerHTML = rows.map(r=>`
    <div class="item-line"><span>${r.toko ? '🏪 '+escapeHTML(r.toko) : '<i>'+t('(tanpa nama toko)')+'</i>'} <span style="color:var(--ink-soft);font-size:11.5px;">(${r.count}x · ${total>0 ? Math.round(r.total/total*100) : 0}%)</span></span><span>${rupiah(r.total)}</span></div>
  `).join('') + `<div class="total-line"><span>${t('Total')}</span><span>${rupiah(total)}</span></div>`;
}

/* ===================== REKAP PER KATEGORI ===================== */
const EXP_BULAN_ID = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
/* Total & jumlah catatan per kategori dari satu daftar pengeluaran, diurut
   dari yang terbesar. Dipakai tab Pengeluaran, PDF Rincian Pengeluaran, dan
   PDF Laba Rugi (js/18-laporan.js) supaya angkanya selalu sama. */
function expenseCategoryTotals(list){
  const m = {};
  list.forEach(e=>{
    const k = e.kategori || t('Lain-lain');
    if(!m[k]) m[k] = { kat:k, total:0, count:0 };
    m[k].total += e.jumlah; m[k].count += 1;
  });
  return Object.values(m).sort((a,b)=>b.total-a.total);
}
/* { kategori: [Jan..Des] } untuk satu tahun. */
function expenseMonthlyByCategory(list, year){
  const m = {};
  list.forEach(e=>{
    if(!e.tanggal || e.tanggal.slice(0,4)!==String(year)) return;
    const k = e.kategori || t('Lain-lain');
    if(!m[k]) m[k] = new Array(12).fill(0);
    m[k][Number(e.tanggal.slice(5,7))-1] += e.jumlah;
  });
  return m;
}
/* Tiap baris kategori adalah dropdown (<details>): ketuk untuk melihat rincian
   setiap pengeluaran di kategori itu (terbaru di atas). Nama kategori tidak
   pernah masuk atribut HTML -- toggle memakai indeks ke expKatRecapNames.
   Kategori yang sedang terbuka diingat (expKatRecapOpen) supaya tidak menutup
   sendiri saat daftar dirender ulang. */
const EXP_KAT_DETAIL_MAX = 200; // batas baris rincian per kategori
let expKatRecapNames = [];
let expRecapItemIds = []; // id pengeluaran per baris rincian (indeks dipakai di onclick, bukan id mentah)
/* Ketuk satu baris rincian di Rekap per Kategori -> gulir ke kartu
   pengeluaran yang sama di daftar di bawah (yang punya tombol Edit/Hapus)
   dan sorot sebentar. Kartu dicari lewat dataset, bukan selector, supaya id
   apa pun aman. */
function gotoExpenseCard(k){
  const id = expRecapItemIds[k];
  if(id===undefined) return;
  showExpenseTab('riwayat'); // kartu catatan ada di halaman Riwayat
  const card = Array.from(document.querySelectorAll('#expenseList .trx-card')).find(c=>c.dataset.expId===String(id));
  if(!card){ showToast(t('Catatan tidak ditemukan di daftar')); return; }
  card.scrollIntoView({ behavior:'smooth', block:'center' });
  card.classList.remove('exp-flash');
  void card.offsetWidth; // restart animasi kalau diketuk berulang
  card.classList.add('exp-flash');
  setTimeout(()=>card.classList.remove('exp-flash'), 2600);
}
const expKatRecapOpen = new Set();
function expKatToggle(i, isOpen){
  const name = expKatRecapNames[i];
  if(name===undefined) return;
  if(isOpen) expKatRecapOpen.add(name); else expKatRecapOpen.delete(name);
}
function renderExpenseCategoryRecap(list){
  const el = document.getElementById('expKatRekap');
  if(!el) return;
  const rows = expenseCategoryTotals(list);
  const total = rows.reduce((s,r)=>s+r.total,0);
  expKatRecapNames = rows.map(r=>r.kat);
  expRecapItemIds = [];
  if(rows.length===0){
    el.innerHTML = `<div style="font-size:12.5px;color:var(--ink-soft);text-align:center;padding:8px 0;">${t('Belum ada pengeluaran periode ini')}</div>`;
    return;
  }
  el.innerHTML = rows.map((r,i)=>{
    const items = list.filter(e=>(e.kategori || t('Lain-lain'))===r.kat)
      .sort((a,b)=> (b.tanggal||'').localeCompare(a.tanggal||'') || String(b.id).localeCompare(String(a.id)));
    const shown = items.slice(0, EXP_KAT_DETAIL_MAX);
    const detail = shown.map(e=>{ const k = expRecapItemIds.push(e.id)-1; return `
      <div role="button" tabindex="0" onclick="gotoExpenseCard(${k})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();gotoExpenseCard(${k});}" style="display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-top:1px dashed var(--line);font-size:12.5px;cursor:pointer;">
        <div style="min-width:0;">
          <div><b>${escapeHTML(e.nama||'-')}</b> <span style="color:var(--ink-soft);">· ${escapeHTML(fmtDate(e.tanggal))}</span></div>
          ${e.qty ? `<div style="color:var(--ink-soft);">${escapeHTML(String(e.qty))} ${escapeHTML(e.satuan||'')} x ${rupiah(e.harga||0)}</div>` : ''}
          ${e.toko ? `<div style="color:var(--ink-soft);">🏪 ${escapeHTML(e.toko)}</div>` : ''}
          ${e.catatan ? `<div style="color:var(--ink-soft);">${escapeHTML(e.catatan)}</div>` : ''}
        </div>
        <div style="font-weight:600;white-space:nowrap;">${rupiah(e.jumlah)} <span aria-hidden="true" style="color:var(--ink-soft);font-weight:400;">›</span></div>
      </div>`; }).join('');
    const more = items.length>shown.length ? `<div style="font-size:12px;color:var(--ink-soft);padding:6px 0;">… ${t('dan')} ${items.length-shown.length} ${t('pengeluaran lainnya (unduh PDF untuk daftar lengkap)')}</div>` : '';
    return `<details class="exp-kat-detail" ${expKatRecapOpen.has(r.kat)?'open':''} ontoggle="expKatToggle(${i}, this.open)" style="border-bottom:1px solid var(--line);">
      <summary style="display:flex;justify-content:space-between;gap:10px;align-items:center;padding:9px 0;cursor:pointer;font-size:13.5px;list-style:none;">
        <span><span aria-hidden="true">▸</span> ${escapeHTML(r.kat)} <span style="color:var(--ink-soft);font-size:11.5px;">(${r.count}x · ${total>0 ? Math.round(r.total/total*100) : 0}%)</span></span>
        <span style="font-weight:600;white-space:nowrap;">${rupiah(r.total)}</span>
      </summary>
      <div style="padding:0 0 8px 14px;">${detail}${more}</div>
    </details>`;
  }).join('') + `<div class="total-line"><span>${t('Total')}</span><span>${rupiah(total)}</span></div>`;
}
function expKatBulanChanged(){
  const sel = document.getElementById('expKatBulanSel');
  sel.dataset.selText = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : '';
  renderExpenseCategoryMonthly();
}
function renderExpenseCategoryMonthly(){
  const sel = document.getElementById('expKatBulanSel');
  const yearEl = document.getElementById('expKatBulanYear');
  const out = document.getElementById('expKatBulanList');
  if(!sel || !yearEl || !out) return;
  const cats = distinctExpenseCategories().sort((a,b)=>a.localeCompare(b,'id'));
  // value option = indeks (bukan nama) supaya nama kategori bebas-ketik tidak
  // pernah masuk atribut HTML; pilihan sebelumnya dipulihkan lewat teks.
  sel.innerHTML = cats.map((k,i)=>`<option value="${i}">${escapeHTML(k)}</option>`).join('');
  const keep = sel.dataset.selText ? cats.indexOf(sel.dataset.selText) : -1;
  sel.value = String(keep>=0 ? keep : 0);
  sel.dataset.selText = cats[Number(sel.value)] || '';
  if(!yearEl.value) yearEl.value = (getExpPeriodeRange() ? getExpPeriodeRange().dari.slice(0,4) : todayISO().slice(0,4));
  const kat = cats[Number(sel.value)];
  if(kat===undefined){ out.innerHTML=''; return; }
  const year = yearEl.value;
  const monthly = (expenseMonthlyByCategory(visibleExpenses(), year)[kat]) || new Array(12).fill(0);
  const sum = monthly.reduce((a,b)=>a+b,0);
  out.innerHTML = monthly.map((v,i)=>`
    <div class="item-line"><span>${EXP_BULAN_ID[i]} ${escapeHTML(String(year))}</span><span style="${v===0?'color:var(--ink-soft);':''}">${rupiah(v)}</span></div>
  `).join('') + `<div class="total-line"><span>${t('Total')} ${escapeHTML(kat)} ${escapeHTML(String(year))}</span><span>${rupiah(sum)}</span></div>`;
}
/* Bagian "Rekap per Kategori" (+ rincian per bulan untuk periode Tahunan)
   di PDF. Mengembalikan posisi y berikutnya. Dipakai PDF Rincian
   Pengeluaran di sini dan PDF Laba Rugi di js/18-laporan.js. */
function pdfExpenseCategorySection(doc, y, list, total, range, onlyMonthly){
  const rows = expenseCategoryTotals(list);
  const ensure = (need)=>{ if(y+need > 285){ doc.addPage(); y = 20; } };
  if(!onlyMonthly){
    ensure(20);
    doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.setTextColor(0);
    doc.text(t('Rekap per Kategori'), 14, y); y += 7;
    doc.setLineWidth(0.3); doc.line(14, y-3, 196, y-3);
    doc.setFont('helvetica','normal'); doc.setFontSize(9.5);
    if(rows.length===0){ doc.text(t('Tidak ada pengeluaran pada periode ini.'), 14, y); return y+8; }
    rows.forEach(r=>{
      ensure(7);
      const nm = r.kat.length>40 ? r.kat.slice(0,40)+'…' : r.kat;
      doc.text(`${nm} (${r.count}x)`, 14, y);
      doc.text(`${total>0 ? Math.round(r.total/total*100) : 0}%`, 150, y, { align:'right' });
      doc.text(rupiah(r.total), 196, y, { align:'right' });
      y += 6.2;
    });
    y += 2;
  }
  // Periode tahunan: tambahkan rincian tiap kategori per bulan.
  const isYear = range && range.dari.endsWith('-01-01') && range.sampai.endsWith('-12-31') && range.dari.slice(0,4)===range.sampai.slice(0,4);
  if(isYear){
    const year = range.dari.slice(0,4);
    const monthly = expenseMonthlyByCategory(list, year);
    ensure(16);
    y += 4;
    doc.setFont('helvetica','bold'); doc.setFontSize(11);
    doc.text(`${t('Rincian per Bulan per Kategori')} ${year}`, 14, y); y += 7;
    rows.forEach(r=>{
      const arr = monthly[r.kat]; if(!arr) return;
      ensure(14);
      doc.setFont('helvetica','bold'); doc.setFontSize(9.5);
      const nm = r.kat.length>40 ? r.kat.slice(0,40)+'…' : r.kat;
      doc.text(nm, 14, y);
      doc.text(rupiah(r.total), 196, y, { align:'right' });
      y += 5.5;
      doc.setFont('helvetica','normal'); doc.setFontSize(8.5); doc.setTextColor(70);
      arr.forEach((v,i)=>{
        if(v===0) return;
        ensure(5);
        doc.text(EXP_BULAN_ID[i], 20, y);
        doc.text(rupiah(v), 196, y, { align:'right' });
        y += 4.8;
      });
      doc.setTextColor(0);
      y += 2.5;
    });
  }
  return y;
}

/* ===================== KELOLA KATEGORI (EDIT / HAPUS + PINDAH) ===================== */
let expCatMgrNames = [];
function openExpenseCategories(){
  expenseCategoryAction(null);
  renderExpenseCategoryManager();
  document.getElementById('expenseCategoryModal').classList.add('show');
}
function closeExpenseCategories(){
  document.getElementById('expenseCategoryModal').classList.remove('show');
  renderExpenseList();
}
function renderExpenseCategoryManager(){
  const el = document.getElementById('expCatMgrList');
  const totals = expenseCategoryTotals(expenses); // semua outlet: kategori milik toko, bukan outlet
  const byName = {}; totals.forEach(r=>{ byName[r.kat]=r; });
  expCatMgrNames = distinctExpenseCategories().sort((a,b)=>a.localeCompare(b,'id'));
  if(expCatMgrNames.length===0){
    el.innerHTML = `<div style="font-size:12.5px;color:var(--ink-soft);text-align:center;padding:14px 0;">${t('Belum ada kategori.')}</div>`;
    return;
  }
  el.innerHTML = expCatMgrNames.map((k,i)=>{
    const r = byName[k];
    return `<div class="item-line" style="align-items:center;">
      <span>${escapeHTML(k)} <span style="color:var(--ink-soft);font-size:11.5px;">(${r ? r.count : 0} ${t('catatan')})</span></span>
      <span style="display:flex;align-items:center;gap:10px;">
        <button onclick="expenseCategoryAction('rename',${i})" style="background:none;border:none;color:var(--suds);font-size:13px;cursor:pointer;">${t('Edit')}</button>
        <button onclick="expenseCategoryAction('delete',${i})" style="background:none;border:none;color:var(--danger);font-size:13px;cursor:pointer;">${t('Hapus')}</button>
      </span>
    </div>`;
  }).join('');
}
/* Panel kecil di bawah daftar: form ganti nama, atau pilihan tujuan pindah
   saat hapus. Nama kategori selalu diambil dari expCatMgrNames[index] --
   tidak pernah disuntik ke atribut HTML. */
function expenseCategoryAction(kind, i){
  const box = document.getElementById('expCatMgrAction');
  if(!kind){ box.style.display='none'; box.innerHTML=''; return; }
  const name = expCatMgrNames[i];
  if(name===undefined) return;
  const count = expenses.filter(e=>e.kategori===name).length;
  const total = expenses.filter(e=>e.kategori===name).reduce((s,e)=>s+e.jumlah,0);
  box.style.display = 'block';
  if(kind==='rename'){
    box.innerHTML = `<div class="card" style="margin:0;background:var(--bg-soft,#F4F8FB);">
      <label for="expCatRenameInput">${t('Nama baru untuk kategori')} <b>${escapeHTML(name)}</b></label>
      <input id="expCatRenameInput" maxlength="60" value="${escapeHTML(name)}" autocomplete="off">
      <p style="font-size:12px;color:var(--ink-soft);margin:6px 0 0;">${count>0 ? `${count} ${t('pengeluaran di kategori ini ikut berganti nama.')} ` : ''}${t('Kalau nama baru sama dengan kategori lain, keduanya digabung.')}</p>
      <div class="btn-row" style="margin-top:10px;">
        <button class="btn btn-primary btn-sm" onclick="confirmRenameExpenseCategory(${i})">${t('Simpan Nama')}</button>
        <button class="btn btn-ghost btn-sm" onclick="expenseCategoryAction(null)">${t('Batal')}</button>
      </div></div>`;
    const inp = document.getElementById('expCatRenameInput');
    inp.addEventListener('keydown', ev=>{ if(ev.key==='Enter'){ ev.preventDefault(); confirmRenameExpenseCategory(i); } });
    inp.focus(); inp.select();
  } else if(kind==='delete'){
    const targets = expCatMgrNames.filter(k=>k!==name);
    if(!targets.includes(t('Lain-lain')) && name!==t('Lain-lain')) targets.push(t('Lain-lain'));
    if(count>0){
      box.innerHTML = `<div class="card" style="margin:0;background:var(--bg-soft,#F4F8FB);">
        <p style="margin:0 0 8px;font-size:13px;">${t('Kategori')} <b>${escapeHTML(name)}</b> ${t('punya')} <b>${count}</b> ${t('pengeluaran')} (${rupiah(total)}). ${t('Pindahkan ke kategori mana?')}</p>
        <select id="expCatMoveTarget">${targets.map((k,j)=>`<option value="${j}">${escapeHTML(k)}</option>`).join('')}</select>
        <div class="btn-row" style="margin-top:10px;">
          <button class="btn btn-danger-ghost btn-sm" onclick="confirmDeleteExpenseCategory(${i})">${t('Pindahkan & Hapus Kategori')}</button>
          <button class="btn btn-ghost btn-sm" onclick="expenseCategoryAction(null)">${t('Batal')}</button>
        </div></div>`;
      box.dataset.targets = JSON.stringify(targets);
    } else {
      box.innerHTML = `<div class="card" style="margin:0;background:var(--bg-soft,#F4F8FB);">
        <p style="margin:0 0 8px;font-size:13px;">${t('Hapus kategori')} <b>${escapeHTML(name)}</b>? ${t('Tidak ada pengeluaran di dalamnya.')}</p>
        <div class="btn-row">
          <button class="btn btn-danger-ghost btn-sm" onclick="confirmDeleteExpenseCategory(${i})">${t('Hapus Kategori')}</button>
          <button class="btn btn-ghost btn-sm" onclick="expenseCategoryAction(null)">${t('Batal')}</button>
        </div></div>`;
      box.dataset.targets = JSON.stringify(targets);
    }
  }
}
function expenseCategoryNeedsOnline(){
  if(offlineMode || navigator.onLine === false){
    showToast(t('Mengubah kategori butuh internet. Sambungkan internet dulu.'));
    return true;
  }
  return false;
}
/* Pindahkan SEMUA pengeluaran toko dari kategori `from` ke `to` (satu query,
   dibatasi user_id pemilik toko + kategori lama; RLS tetap berlaku). */
async function moveExpensesToCategory(from, to){
  const { error } = await sb.from('expenses').update({ kategori: to }).eq('user_id', shopOwnerId).eq('kategori', from);
  if(error) return false;
  expenses.forEach(e=>{ if(e.kategori===from) e.kategori = to; });
  return true;
}
async function confirmRenameExpenseCategory(i){
  const old = expCatMgrNames[i];
  const nu = (document.getElementById('expCatRenameInput').value||'').trim().slice(0,60);
  if(!nu){ showToast(t('Nama kategori tidak boleh kosong')); return; }
  if(nu===old){ expenseCategoryAction(null); return; }
  if(expenseCategoryNeedsOnline()) return;
  const exists = expCatMgrNames.some(k=>k.toLowerCase()===nu.toLowerCase() && k!==old);
  if(exists && !confirm(`${t('Kategori')} "${nu}" ${t('sudah ada. Gabungkan semua pengeluaran ke kategori itu?')}`)) return;
  const target = exists ? expCatMgrNames.find(k=>k.toLowerCase()===nu.toLowerCase() && k!==old) : nu;
  if(!(await moveExpensesToCategory(old, target))){ showToast(t('Gagal mengubah nama kategori')); return; }
  if(DEFAULT_EXPENSE_CATEGORIES.includes(old)){
    const h = getHiddenExpenseCategories(); if(!h.includes(old)) h.push(old); setHiddenExpenseCategories(h);
  }
  // Kalau nama baru kebetulan sama dengan bawaan yang sempat disembunyikan, tampilkan lagi.
  setHiddenExpenseCategories(getHiddenExpenseCategories().filter(k=>k!==target));
  showToast(t('Nama kategori diperbarui'));
  expenseCategoryAction(null);
  renderExpenseCategoryManager();
}
async function confirmDeleteExpenseCategory(i){
  const name = expCatMgrNames[i];
  const box = document.getElementById('expCatMgrAction');
  const count = expenses.filter(e=>e.kategori===name).length;
  if(expenseCategoryNeedsOnline()) return;
  if(count>0){
    const targets = JSON.parse(box.dataset.targets||'[]');
    const sel = document.getElementById('expCatMoveTarget');
    const target = targets[Number(sel ? sel.value : 0)];
    if(target===undefined || target===name){ showToast(t('Pilih kategori tujuan')); return; }
    if(!(await moveExpensesToCategory(name, target))){ showToast(t('Gagal memindahkan pengeluaran')); return; }
  }
  if(DEFAULT_EXPENSE_CATEGORIES.includes(name)){
    const h = getHiddenExpenseCategories(); if(!h.includes(name)) h.push(name); setHiddenExpenseCategories(h);
  }
  showToast(count>0 ? `${t('Kategori dihapus.')} ${count} ${t('pengeluaran dipindahkan.')}` : t('Kategori dihapus'));
  expenseCategoryAction(null);
  renderExpenseCategoryManager();
}

/* ===================== NAVIGASI KEYBOARD FORM PENGELUARAN =====================
   Sama seperti form Transaksi Baru (attachFormGridNav di js/00-globals.js):
   Enter = kolom berikutnya (di kolom terakhir = simpan lalu fokus balik ke
   Nama Barang), Home/End = kiri/kanan, PageUp/PageDown = atas/bawah,
   ArrowUp/Down = pilih saran. Dipasang SETELAH attachSuggestKeyNav() di atas
   supaya Enter saat memilih saran tidak ikut pindah kolom. */
attachFormGridNav([
  ['expTanggal'],
  ['expNama'],
  ['expQty','expSatuan'],
  ['expHarga'],
  ['expKategori'],
  ['expToko'],
  ['expCatatan'],
], function(){
  Promise.resolve(submitExpense()).then(()=>{ const n = document.getElementById('expNama'); if(n) n.focus(); });
});

// Halaman awal tab Pengeluaran.
showExpenseTab('catat');
