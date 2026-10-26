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
  const lunasAt = todayISO();
  trx.status = 'lunas';
  trx.lunasAt = lunasAt;

  if(offlineMode || navigator.onLine === false){
    await offlineEnqueue('MARK_LUNAS', { id, lunas_at: lunasAt });
    await offlineSaveSnapshot();
    showToast(t('Transaksi ditandai lunas (offline)'));
    renderHistory();
    return;
  }

  const { error } = await sb.from('transactions').update({ status:'lunas', lunas_at: lunasAt }).eq('id', id);
  if(error){
    if(offlineIsNetworkError(error)){
      await offlineEnqueue('MARK_LUNAS', { id, lunas_at: lunasAt });
      await offlineSaveSnapshot();
      showToast(t('Transaksi ditandai lunas (offline)'));
      renderHistory();
      return;
    }
    showToast(t('Gagal memperbarui status'));
    return;
  }
  showToast(t('Transaksi ditandai lunas'));
  renderHistory();
}

/* Unduh nota reguler dan nota Paket Bulanan/Tempo pada rentang tanggal. */
async function downloadHistoryBackup(){
  const btn = document.getElementById('historyBackupBtn');
  if(btn && btn.disabled) return;
  const dari = document.getElementById('historyDariFilter').value;
  const sampai = document.getElementById('historySampaiFilter').value;
  const jenis = document.getElementById('historyBackupType').value || 'all';
  if(dari && sampai && dari > sampai){
    showToast(t('Pilih tanggal mulai yang tidak melewati tanggal akhir.'));
    return;
  }
  if((typeof offlineMode !== 'undefined' && offlineMode) || navigator.onLine === false){
    showToast(t('Backup semua nota perlu koneksi internet agar seluruh riwayat dapat dimuat.'));
    return;
  }
  const originalLabel = btn ? btn.textContent : '';
  if(btn){ btn.disabled = true; btn.textContent = t('Menyiapkan backup...'); }
  try{
    if(!transactionsFullyLoaded) await ensureAllTransactionsLoaded();
    if(!transactionsFullyLoaded){
      showToast(t('Riwayat nota belum berhasil dimuat. Coba lagi saat koneksi stabil.'));
      return;
    }

    const withinDateRange = tanggal => (!dari || tanggal >= dari) && (!sampai || tanggal <= sampai);
    const transactionKind = trx => {
      const linkedSubs = subscriptions.find(s => String(s.transactionId || '') === String(trx.id));
      if(linkedSubs) return isTempo(linkedSubs) ? 'tempo' : 'paket';
      const note = String(trx.catatan || '').toLowerCase();
      if(note.startsWith('pembayaran tempo (bayar nanti)') || note.startsWith('pay later payment')) return 'tempo';
      if(note.startsWith('pembayaran paket bulanan periode') || note.startsWith('monthly package payment')) return 'paket';
      return 'reguler';
    };
    const notes = [];
    const priorUsageList = currentUsageList;
    try{
      if(jenis === 'all' || jenis === 'reguler' || jenis === 'paket' || jenis === 'tempo'){
        transactions.filter(trx => withinDateRange(trx.tanggal) && (jenis === 'all' || transactionKind(trx) === jenis))
          .forEach(trx => notes.push({
            tanggal: trx.tanggal,
            jenis: transactionKind(trx),
            nome: 'nota-' + transactionKind(trx) + '-' + String(trx.kode || trx.id),
            lines: buildReceiptPDFLines(trx)
          }));
      }

      const subscriptionsById = new Map(subscriptions.map(s => [String(s.id), s]));
      const usageGroups = new Map();
      allWorkUsage.filter(u => withinDateRange(u.tanggal)).forEach(u => {
        const sub = subscriptionsById.get(String(u.subscriptionId));
        if(!sub) return;
        const kind = isTempo(sub) ? 'tempo' : 'paket';
        if(jenis !== 'all' && jenis !== kind) return;
        const groupKey = String(u.subscriptionId) + ':' + (u.batchId ? 'batch:' + u.batchId : 'usage:' + u.id);
        if(!usageGroups.has(groupKey)) usageGroups.set(groupKey, { sub, kind, items:[] });
        usageGroups.get(groupKey).items.push(u);
      });

      for(const group of usageGroups.values()){
        const { sub, kind, items } = group;
        currentUsageList = allWorkUsage.filter(u => String(u.subscriptionId) === String(sub.id));
        items.sort((a,b) => a.tanggal < b.tanggal ? -1 : (a.tanggal > b.tanggal ? 1 : 0));
        const lines = items[0].batchId
          ? (isTempo(sub) ? buildTempoBatchUsageNotaPDFLines(items, sub) : buildUsageBatchNotaPDFLines(items, sub))
          : buildUsageNotaPDFLines(items[0], sub);
        const safeName = String(sub.nama || 'pelanggan').replace(/[^a-zA-Z0-9._-]+/g, '-');
        notes.push({
          tanggal: items[0].tanggal,
          jenis: kind,
          nome: 'nota-' + kind + '-' + items[0].tanggal + '-' + safeName + '-' + String(items[0].batchId || items[0].id).slice(-8),
          lines
        });
      }
    }finally{
      currentUsageList = priorUsageList;
    }

    notes.sort((a,b) => a.tanggal < b.tanggal ? -1 : (a.tanggal > b.tanggal ? 1 : 0));
    if(notes.length === 0){
      showToast(t('Tidak ada nota dalam rentang tanggal ini.'));
      return;
    }
    let berhasil = 0, gagal = 0, tersimpanDiArsip = 0;
    const backupRunId = Date.now();
    const jpgFiles = [];
    for(let i=0;i<notes.length;i++){
      const note = notes[i];
      try{
        const blob = await buildNotaJPEGBlob(note.lines, 80);
        if(!blob){ gagal++; continue; }
        const safeBase = note.nome.replace(/[^a-zA-Z0-9._-]+/g, '-');
        const nomor = String(i + 1).padStart(4, '0');
        const filename = safeBase + '-' + note.tanggal + '-backup-' + backupRunId + '-' + nomor + '.jpg';
        if(typeof saveToDownloadsGallery === 'function'){
          const ownerId = (typeof shopOwnerId !== 'undefined' && shopOwnerId) ? String(shopOwnerId) : '';
          if(await saveToDownloadsGallery(blob, filename, { category:'backup_nota', ownerId })) tersimpanDiArsip++;
        }
        jpgFiles.push({ blob, filename });
        berhasil++;
      }catch(e){
        gagal++;
      }
    }
    pendingHistoryBackupJPGs = jpgFiles;
    renderHistoryBackupResult(jpgFiles, { failed:gagal });
    if(berhasil === 0){
      showToast(t('Gagal membuat semua gambar nota. Coba lagi.'));
    }else if(gagal > 0){
      showToast(t('Sebagian nota gagal dibuat. JPG berhasil disiapkan') + ': ' + berhasil + '/' + notes.length);
    }else{
      showToast(t('Backup selesai') + ': ' + berhasil + ' JPG ' + t('siap diunduh') + ' · ' + t('tersimpan di arsip aplikasi') + ': ' + tersimpanDiArsip);
    }
  }finally{
    if(btn){ btn.disabled = false; btn.textContent = originalLabel; }
  }
}

var pendingHistoryBackupJPGs = [];
function renderHistoryBackupResult(files, options){
  const el = document.getElementById('historyBackupResult');
  if(!el) return;
  const failed = Number(options && options.failed) || 0;
  if(!files || files.length === 0){ el.innerHTML = ''; return; }
  const supportsFolderPicker = window.isSecureContext && typeof window.showDirectoryPicker === 'function';
  const fileOptions = files.map((file,index) => `<option value="${index}">${escapeHTML(file.filename)}</option>`).join('');
  el.innerHTML = `<div class="card" style="margin-top:10px;" aria-live="polite">
    <h3 style="margin:0 0 6px;">${files.length} ${t('nota siap disimpan sebagai JPG')}</h3>
    <p style="font-size:12.5px;color:var(--ink-soft);line-height:1.5;margin:0 0 10px;">${t('Pilih folder untuk menyimpan semua JPG sekaligus. Jika tidak tersedia, unduh setiap nota satu per satu dari daftar ini.')}</p>
    ${failed ? `<p style="font-size:12px;color:var(--danger);">${failed} ${t('nota gagal dibuat; coba ulangi dengan rentang tanggal lebih kecil.')}</p>` : ''}
    ${supportsFolderPicker ? `<button class="btn btn-primary" type="button" id="historyBackupSaveFolderBtn" onclick="saveHistoryBackupToFolder()">📁 ${t('Pilih Folder dan Simpan Semua JPG')}</button>` : `<p style="font-size:12px;color:var(--ink-soft);">${t('Peramban ini tidak mendukung penyimpanan ke folder; gunakan unduh satu per satu.')}</p>`}
    <label for="historyBackupFileSelect">${t('Pilih nota untuk diunduh')}</label>
    <select id="historyBackupFileSelect">${fileOptions}</select>
    <button class="btn btn-outline" type="button" id="historyBackupSingleDownloadBtn" onclick="downloadSelectedHistoryBackupJPG()">⬇️ ${t('Unduh JPG Terpilih')}</button>
    <p id="historyBackupFolderStatus" role="status" style="font-size:12px;color:var(--ink-soft);margin:8px 0 0;"></p>
  </div>`;
}
function downloadSelectedHistoryBackupJPG(){
  const select = document.getElementById('historyBackupFileSelect');
  const file = select && pendingHistoryBackupJPGs[Number(select.value)];
  if(!file){ showToast(t('File backup tidak ditemukan.')); return; }
  const url = URL.createObjectURL(file.blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  showToast(t('Unduhan untuk nota diproses.'));
}
async function writeHistoryBackupFilesToFolder(directory, files){
  let saved = 0, failed = 0;
  for(const file of files){
    let writable = null;
    try{
      const handle = await directory.getFileHandle(file.filename, { create:true });
      writable = await handle.createWritable();
      await writable.write(file.blob);
      await writable.close();
      saved++;
    }catch(e){
      failed++;
      if(writable && typeof writable.abort === 'function'){
        try{ await writable.abort(); }catch(_){}
      }
    }
  }
  return { saved, failed };
}
async function saveHistoryBackupToFolder(){
  const files = pendingHistoryBackupJPGs.slice();
  if(files.length === 0){ showToast(t('Tidak ada JPG backup untuk disimpan.')); return; }
  if(!window.isSecureContext || typeof window.showDirectoryPicker !== 'function'){
    showToast(t('Peramban ini tidak mendukung penyimpanan ke folder; unduh satu per satu.'));
    return;
  }
  let pickerPromise;
  try{
    // Panggil pemilih folder sebelum await lain agar tetap berada dalam gestur pengguna.
    pickerPromise = window.showDirectoryPicker({ mode:'readwrite' });
  }catch(e){
    showToast(t('Folder tidak dapat dibuka. Unduh JPG satu per satu sebagai gantinya.'));
    return;
  }
  const btn = document.getElementById('historyBackupSaveFolderBtn');
  if(btn){ btn.disabled = true; btn.textContent = t('Menyimpan semua JPG...'); }
  try{
    const directory = await pickerPromise;
    const result = await writeHistoryBackupFilesToFolder(directory, files);
    const status = document.getElementById('historyBackupFolderStatus');
    if(status) status.textContent = result.failed
      ? result.saved + '/' + files.length + ' ' + t('JPG tersimpan; sebagian gagal.')
      : result.saved + ' ' + t('JPG tersimpan di folder yang dipilih.');
    showToast(result.failed
      ? result.saved + '/' + files.length + ' ' + t('JPG berhasil disimpan; sebagian gagal.')
      : result.saved + ' ' + t('JPG berhasil disimpan di folder.'));
  }catch(e){
    if(e && e.name === 'AbortError'){
      showToast(t('Pemilihan folder dibatalkan. JPG tetap tersedia di arsip app.'));
    }else{
      showToast(t('Folder tidak dapat ditulis. Unduh JPG satu per satu sebagai gantinya.'));
    }
  }finally{
    if(btn){ btn.disabled = false; btn.textContent = '📁 ' + t('Pilih Folder dan Simpan Semua JPG'); }
  }
}
