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
      <h3>Belum ada transaksi</h3>
      <p>Transaksi yang kamu simpan akan muncul di sini.</p>
    </div>`;
    return;
  }
  el.innerHTML = list.map(t=>`
    <div class="trx-card">
      <div class="trx-top">
        <div>
          <div class="trx-name">${escapeHTML(t.nama)}</div>
          <div class="kode">${t.kode}</div>
        </div>
        <span class="badge ${t.status==='lunas'?'badge-lunas':'badge-belum'}">${t.status==='lunas'?'Lunas':'Belum Lunas'}</span>
      </div>
      <div class="trx-meta">${fmtDate(t.tanggal)} · ${t.items.length} layanan</div>
      <div class="trx-total">${rupiah(t.total)}</div>
      <div class="trx-actions">
        <button class="btn btn-outline btn-sm" onclick="openReceipt('${t.id}')">Nota</button>
        <button class="btn btn-wa btn-sm" onclick="openReceiptShareOptions('${t.id}')">Kirim</button>
        ${t.status==='belum' ? `<button class="btn btn-accent btn-sm" onclick="toggleLunas('${t.id}')">Lunasi</button>` : ''}
      </div>
      <div class="trx-actions owner-only">
        <button class="btn btn-ghost btn-sm" onclick="editTransaction('${t.id}')">✏️ Edit</button>
        <button class="btn btn-ghost btn-sm" onclick="openEditHistory('transaction','${t.id}','🕘 Riwayat Edit Transaksi')">🕘 Riwayat</button>
        <button class="btn btn-danger-ghost btn-sm" onclick="deleteTransaction('${t.id}')">🗑️ Hapus</button>
      </div>
    </div>
  `).join('');
}
async function toggleLunas(id){
  const t = transactions.find(x=>x.id===id);
  if(!t) return;
  const { error } = await sb.from('transactions').update({ status:'lunas', dp:t.total }).eq('id', id);
  if(error){ showToast('Gagal memperbarui status'); return; }
  t.status = 'lunas';
  t.dp = t.total;
  showToast('Transaksi ditandai lunas');
  renderHistory();
}

