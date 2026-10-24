/* ===================== RIWAYAT ===================== */
function resetHistoryFilter(){
  document.getElementById('historyStatusFilter').value = '';
  document.getElementById('historyDariFilter').value = '';
  document.getElementById('historySampaiFilter').value = '';
  renderHistory();
}
async function renderHistory(){
  const q = (document.getElementById('searchInput').value||'').toLowerCase();
  const statusFilter = document.getElementById('historyStatusFilter').value;
  const dariFilter = document.getElementById('historyDariFilter').value;
  const sampaiFilter = document.getElementById('historySampaiFilter').value;
  /* Default (tanpa filter "Dari") cukup window default loadTransactionsFromDB()
     (js/05-admin.js) -- cuma kalau user eksplisit minta tanggal SEBELUM window
     itu, backfill seluruh riwayat dulu (no-op kalau sudah pernah di sesi ini). */
  if(!transactionsFullyLoaded && transactionsWindowStart && dariFilter && dariFilter < transactionsWindowStart){
    await ensureAllTransactionsLoaded();
  }
  const anyFilterActive = !!(statusFilter || dariFilter || sampaiFilter);
  document.getElementById('historyResetFilterBtn').style.display = anyFilterActive ? 'block' : 'none';
  const el = document.getElementById('historyList');
  /* Urutkan berdasarkan TANGGAL TRANSAKSI (terbaru dulu), bukan urutan input --
     regresi bug nyata dilaporkan user: transaksi tanggal 26 Sep muncul di antara
     dua transaksi tanggal 22 Sep karena sebelumnya cuma .reverse() urutan array
     (urutan input/insert), bukan diurutkan berdasarkan field tanggal-nya sendiri.
     .reverse() dulu (jadi input-terbaru-duluan), BARU sort stabil descending
     berdasarkan tanggal saja -- supaya transaksi bertanggal SAMA tetap urut
     input-terbaru-duluan di antara sesamanya (JS Array.sort() terjamin stabil). */
  const list = visibleTransactions().slice().reverse()
    .sort((a,b)=> a.tanggal<b.tanggal ? 1 : (a.tanggal>b.tanggal ? -1 : 0))
    .filter(t=>
      (t.nama.toLowerCase().includes(q) || t.kode.toLowerCase().includes(q))
      && (!statusFilter || t.status===statusFilter)
      && (!dariFilter || t.tanggal>=dariFilter)
      && (!sampaiFilter || t.tanggal<=sampaiFilter)
    );

  const today = todayISO();
  const todayList = visibleTransactions().filter(t=>t.tanggal===today);
  const todayLunas = todayList.filter(t=>t.status==='lunas');
  const todayBelum = todayList.filter(t=>t.status==='belum');
  /* Nominal "Lunas" pakai kas yang benar-benar diterima hari ini (termasuk
     DP dari transaksi yang masih "Belum Lunas"), bukan cuma total transaksi
     yang statusnya sudah lunas -- konsisten dengan Laporan (lihat
     trxCashReceived()). Jumlah nota di depan tetap hitungan transaksi yang
     SUDAH lunas hari ini, bukan berubah makna. */
  document.getElementById('stTodayLunas').textContent = `${todayLunas.length} · ${rupiah(todayList.reduce((s,t)=>s+trxCashReceived(t),0))}`;
  document.getElementById('stTodayBelum').textContent = `${todayBelum.length} · ${rupiah(todayBelum.reduce((s,t)=>s+(t.total-trxCashReceived(t)),0))}`;

  if(list.length===0){
    const filterActive = anyFilterActive || q;
    el.innerHTML = `<div class="empty">
      <svg class="bubble-icon" viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="21" stroke="#146C8E" stroke-width="2" opacity="0.4"/><circle cx="24" cy="24" r="12" stroke="#5FC9BE" stroke-width="2"/></svg>
      <h3>${filterActive ? t('Tidak ada transaksi yang cocok') : t('Belum ada transaksi')}</h3>
      <p>${filterActive ? t('Coba ubah kata kunci pencarian atau filter di atas.') : t('Transaksi yang kamu simpan akan muncul di sini.')}</p>
    </div>`;
    return;
  }
  el.innerHTML = list.map(trx=>`
    <div class="trx-card">
      <div class="trx-top">
        <div>
          <div class="trx-name">${escapeHTML(trx.nama)}</div>
          <div class="kode">${trx.kode}</div>
        </div>
        <span class="badge ${trx.status==='lunas'?'badge-lunas':'badge-belum'}">${trx.status==='lunas'?t('Lunas'):t('Belum Lunas')}</span>
      </div>
      <div class="trx-meta">${fmtDate(trx.tanggal)} · ${trx.items.length} ${currentLang==='en' ? (trx.items.length===1?'service':'services') : t('layanan')}</div>
      <div class="trx-total">${rupiah(trx.total)}</div>
      <div class="trx-actions">
        <button class="btn btn-outline btn-sm" onclick="openReceipt('${trx.id}')">${t('Nota')}</button>
        <button class="btn btn-wa btn-sm" onclick="openReceiptShareOptions('${trx.id}')">${t('Kirim')}</button>
        ${trx.status==='belum' ? `<button class="btn btn-accent btn-sm" onclick="toggleLunas('${trx.id}')">${t('Lunasi')}</button>` : ''}
      </div>
      <div class="trx-actions owner-only">
        <button class="btn btn-ghost btn-sm" onclick="editTransaction('${trx.id}')">${t('✏️ Edit')}</button>
        <button class="btn btn-ghost btn-sm" onclick="openEditHistory('transaction','${trx.id}','${escapeHTML(t('🕘 Riwayat Edit Transaksi'))}')">${t('🕘 Riwayat')}</button>
        <button class="btn btn-danger-ghost btn-sm" onclick="deleteTransaction('${trx.id}')">${t('🗑️ Hapus')}</button>
      </div>
    </div>
  `).join('');
}
async function toggleLunas(id){
  const trx = transactions.find(x=>x.id===id);
  if(!trx) return;
  /* dp SENGAJA tidak diikutkan disamakan dengan total di sini -- itu cuma
     uang muka sungguhan, biarkan apa adanya (biasanya 0 kalau tidak pernah
     ada DP). trxCashReceived() yang menghitung kas Rp penuh untuk transaksi
     Lunas, bukan field dp yang dipaksa. */
  // lunas_at diisi HARI INI -- ini persis momen nota ditandai lunas (lihat
  // README, Laporan "Kas Masuk Bulan Ini").
  const lunasAt = todayISO();
  const { error } = await sb.from('transactions').update({ status:'lunas', lunas_at: lunasAt }).eq('id', id);
  if(error){ showToast(t('Gagal memperbarui status')); return; }
  trx.status = 'lunas';
  trx.lunasAt = lunasAt;
  showToast(t('Transaksi ditandai lunas'));
  renderHistory();
}

/* Ekspor semua nota pada rentang tanggal yang dipilih. Filter pencarian/status
   sengaja tidak dipakai; backup selalu berisi seluruh nota toko pada periode. */
async function downloadHistoryBackup(){
  const dari = document.getElementById('historyDariFilter').value;
  const sampai = document.getElementById('historySampaiFilter').value;
  if(dari && sampai && dari > sampai){
    showToast(t('Pilih tanggal mulai yang tidak melewati tanggal akhir.'));
    return;
  }
  if((typeof offlineMode !== 'undefined' && offlineMode) || navigator.onLine === false){
    showToast(t('Backup semua nota perlu koneksi internet agar seluruh riwayat dapat dimuat.'));
    return;
  }
  if(!transactionsFullyLoaded) await ensureAllTransactionsLoaded();
  if(!transactionsFullyLoaded){
    showToast(t('Riwayat nota belum berhasil dimuat. Coba lagi saat koneksi stabil.'));
    return;
  }
  const notes = transactions
    .filter(trx => (!dari || trx.tanggal >= dari) && (!sampai || trx.tanggal <= sampai))
    .slice()
    .sort((a,b) => a.tanggal < b.tanggal ? -1 : (a.tanggal > b.tanggal ? 1 : 0))
    .map(trx => ({
      id: trx.id, kode: trx.kode, tanggal: trx.tanggal, estimasi: trx.estimasi || null,
      nama: trx.nama, hp: trx.hp || '', items: trx.items || [],
      diskon: Number(trx.diskon) || 0, total: Number(trx.total) || 0, dp: Number(trx.dp) || 0,
      status: trx.status, lunasAt: trx.lunasAt || null, catatan: trx.catatan || '',
      workStatus: trx.workStatus || 'belum', outletId: trx.outletId || null
    }));
  if(notes.length === 0){
    showToast(t('Tidak ada nota dalam rentang tanggal ini.'));
    return;
  }
  const backup = {
    format: 'dokter-laundry-nota-backup',
    version: 1,
    dibuatPada: new Date().toISOString(),
    toko: settings.shopName || '',
    periode: { dari: dari || null, sampai: sampai || null },
    jumlahNota: notes.length,
    nota: notes
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `backup-nota-${dari || 'semua'}-${sampai || 'semua'}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast(t('Backup nota selesai') + ': ' + notes.length);
}
