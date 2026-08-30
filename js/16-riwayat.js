/* ===================== RIWAYAT ===================== */
function renderHistory(){
  const q = (document.getElementById('searchInput').value||'').toLowerCase();
  const el = document.getElementById('historyList');
  const list = visibleTransactions().slice().reverse().filter(t=>
    t.nama.toLowerCase().includes(q) || t.kode.toLowerCase().includes(q)
  );

  const today = todayISO();
  const todayList = visibleTransactions().filter(t=>t.tanggal===today);
  const todayLunas = todayList.filter(t=>t.status==='lunas');
  const todayBelum = todayList.filter(t=>t.status==='belum');
  document.getElementById('stTodayLunas').textContent = `${todayLunas.length} · ${rupiah(todayLunas.reduce((s,t)=>s+t.total,0))}`;
  document.getElementById('stTodayBelum').textContent = `${todayBelum.length} · ${rupiah(todayBelum.reduce((s,t)=>s+(t.total-(t.dp||0)),0))}`;

  if(list.length===0){
    el.innerHTML = `<div class="empty">
      <svg class="bubble-icon" viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="21" stroke="#146C8E" stroke-width="2" opacity="0.4"/><circle cx="24" cy="24" r="12" stroke="#5FC9BE" stroke-width="2"/></svg>
      <h3>${t('Belum ada transaksi')}</h3>
      <p>${t('Transaksi yang kamu simpan akan muncul di sini.')}</p>
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
  const { error } = await sb.from('transactions').update({ status:'lunas', dp:trx.total }).eq('id', id);
  if(error){ showToast(t('Gagal memperbarui status')); return; }
  trx.status = 'lunas';
  trx.dp = trx.total;
  showToast(t('Transaksi ditandai lunas'));
  renderHistory();
}

