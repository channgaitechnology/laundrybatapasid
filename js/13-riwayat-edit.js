/* ===================== RIWAYAT EDIT (transaksi & pelanggan paket) =====================
   Satu tabel generik edit_log (entity_type + entity_id) dipakai bareng oleh
   semua entitas yang bisa diedit & butuh akuntabilitas siapa-ubah-apa-kapan,
   supaya tidak perlu bikin tabel+RLS terpisah tiap kali ada entitas baru.
   Pengeluaran TIDAK punya riwayat edit karena memang tidak ada fitur edit
   pengeluaran (cuma tambah/hapus). Katalog (layanan & pengeluaran) juga
   sengaja tidak dilacak — itu daftar harga/template, bukan catatan
   keuangan per pelanggan, jadi nilai akuntabilitasnya jauh lebih rendah
   dibanding transaksi & pelanggan paket. */
function diffTransactionFields(oldT, newT){
  const fields = [
    { key:'nama', label:t('Nama Pelanggan') },
    { key:'hp', label:t('No. HP') },
    { key:'tanggal', label:t('Tanggal') },
    { key:'estimasi', label:t('Estimasi Selesai') },
    { key:'diskon', label:t('Diskon') },
    { key:'dp', label:t('Uang Muka') },
    { key:'status', label:t('Status Bayar') },
    { key:'catatan', label:t('Catatan') },
  ];
  const changes = diffScalarFields(oldT, newT, fields);
  const itemLabel = items => (items||[]).map(it=>`${it.nama} (${it.qty}${it.satuan})`).join(', ') || '-';
  const oldItemsKey = JSON.stringify((oldT.items||[]).map(it=>({n:it.nama,q:it.qty,s:it.satuan,h:it.harga})));
  const newItemsKey = JSON.stringify((newT.items||[]).map(it=>({n:it.nama,q:it.qty,s:it.satuan,h:it.harga})));
  if(oldItemsKey!==newItemsKey) changes.push({ field:'items', label:t('Daftar Layanan'), from:itemLabel(oldT.items), to:itemLabel(newT.items) });
  if(Number(oldT.total)!==Number(newT.total)) changes.push({ field:'total', label:t('Total'), from:rupiah(oldT.total), to:rupiah(newT.total) });
  return changes;
}
/* Form Edit Pelanggan Paket cuma menyentuh identitas & harga paketnya
   (bukan status bayar/DP — itu diubah lewat alur bayar/pemakaian terpisah). */
function diffSubscriptionFields(oldS, newS){
  const fields = [
    { key:'nama', label:t('Nama Pelanggan') },
    { key:'hp', label:t('No. HP') },
    { key:'paketNama', label:t('Paket') },
    { key:'hargaPaket', label:t('Harga Paket'), fmt:rupiah },
    { key:'hargaLebihKg', label:t('Harga Lebih Kuota/kg'), fmt:rupiah },
    { key:'kuotaKg', label:t('Kuota (kg)') },
    { key:'tanggalMulai', label:t('Tanggal Mulai') },
    { key:'tanggalSelesai', label:t('Tanggal Selesai') },
  ];
  return diffScalarFields(oldS, newS, fields);
}
/* Helper bersama: bandingkan field skalar satu-satu, opsional pakai `fmt`
   untuk memformat nilai tampilan (mis. rupiah) tanpa mengubah perbandingannya. */
function diffScalarFields(oldObj, newObj, fields){
  const changes = [];
  fields.forEach(f=>{
    const ov = oldObj[f.key] ?? '';
    const nv = newObj[f.key] ?? '';
    if(String(ov)!==String(nv)){
      const fmt = f.fmt || (v=>String(v)||'-');
      changes.push({ field:f.key, label:f.label, from:fmt(ov), to:fmt(nv) });
    }
  });
  return changes;
}
/* Gagal menulis log TIDAK boleh membatalkan/menggagalkan edit entitasnya
   sendiri — tabel edit_log baru (lihat README) & opsional, jadi kalau
   belum dimigrasi, edit tetap jalan normal, cuma riwayatnya tidak tercatat. */
async function logEditHistory(entityType, entityId, changes){
  if(!changes || changes.length===0) return;
  const editorNama = currentRole==='owner' ? t('Pemilik') : (employeeName || t('Kasir'));
  try{
    await sb.from('edit_log').insert({
      owner_id: shopOwnerId, entity_type: entityType, entity_id: String(entityId),
      edited_by: currentUser ? currentUser.id : null, editor_nama: editorNama, changes
    });
  }catch(e){ /* diamkan — lihat komentar di atas */ }
}
function fmtDateTime(iso){
  if(!iso) return '-';
  const d = new Date(iso);
  if(isNaN(d.getTime())) return '-';
  return d.toLocaleString('id-ID', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
}
async function openEditHistory(entityType, entityId, title){
  const modal = document.getElementById('editHistoryModal');
  const list = document.getElementById('editHistoryList');
  const titleEl = document.getElementById('editHistoryModalTitle');
  if(titleEl) titleEl.textContent = title || t('🕘 Riwayat Edit');
  list.innerHTML = `<div style="text-align:center;padding:20px;color:var(--ink-soft);">${t('Memuat...')}</div>`;
  modal.classList.add('show');
  const { data, error } = await sb.from('edit_log').select('*').eq('entity_type', entityType).eq('entity_id', String(entityId)).order('edited_at', { ascending:false });
  if(error){
    list.innerHTML = `<div style="text-align:center;padding:20px;color:var(--ink-soft);">${t('Riwayat edit belum tersedia — tabel edit_log mungkin belum dimigrasi (lihat README).')}</div>`;
    return;
  }
  if(!data || data.length===0){
    list.innerHTML = `<div style="text-align:center;padding:20px;color:var(--ink-soft);">${t('Belum ada riwayat edit untuk data ini.')}</div>`;
    return;
  }
  list.innerHTML = data.map(row=>{
    const changes = row.changes || [];
    const changesHTML = changes.map(c=>`<div style="font-size:12px;padding:3px 0;"><b>${escapeHTML(c.label)}</b>: <span style="color:var(--danger);text-decoration:line-through;">${escapeHTML(c.from)}</span> → <span style="color:var(--success);">${escapeHTML(c.to)}</span></div>`).join('');
    return `<div style="border-bottom:1px solid var(--line);padding:10px 0;">
      <div style="font-size:12.5px;font-weight:700;">${escapeHTML(row.editor_nama||'—')} <span style="font-weight:400;color:var(--ink-soft);">· ${fmtDateTime(row.edited_at)}</span></div>
      ${changesHTML}
    </div>`;
  }).join('');
}
function closeEditHistory(){ document.getElementById('editHistoryModal').classList.remove('show'); }
async function deleteTransaction(id){
  const trx = transactions.find(t=>t.id===id);
  if(!trx) return;
  if(!confirm(t('Hapus transaksi ini?'))) return;
  const { error } = await sb.from('transactions').delete().eq('id', id);
  if(error){ showToast(t('Gagal menghapus transaksi')); return; }
  transactions = transactions.filter(t=>t.id!==id);
  renderHistory();
  showToast(t('Transaksi dihapus'), {
    label: t('Urungkan'),
    onClick: async ()=>{
      const { data, error: err2 } = await sb.from('transactions').insert({
        user_id: shopOwnerId, kode: trx.kode, nama: trx.nama, hp: trx.hp, tanggal: trx.tanggal,
        estimasi: trx.estimasi, items: trx.items, diskon: trx.diskon, total: trx.total, dp: trx.dp,
        status: trx.status, catatan: trx.catatan, work_status: trx.workStatus,
        ...(trx.outletId ? { outlet_id: trx.outletId } : {})
      }).select().single();
      if(err2){ showToast(t('Gagal mengembalikan transaksi')); return; }
      transactions.push({
        id:data.id, kode:data.kode, nama:data.nama, hp:data.hp, tanggal:data.tanggal, estimasi:data.estimasi,
        items:data.items, diskon:Number(data.diskon), total:Number(data.total), dp:Number(data.dp),
        status:data.status, catatan:data.catatan, workStatus: data.work_status || trx.workStatus || 'belum',
        outletId: data.outlet_id!=null ? String(data.outlet_id) : null
      });
      renderHistory();
      showToast(t('Transaksi dikembalikan'));
    }
  });
}

