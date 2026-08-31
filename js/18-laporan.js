/* ===================== LAPORAN BULANAN ===================== */
function renderReport(){
  populatePerNamaSelect();
  const monthInput = document.getElementById('reportMonth');
  if(!monthInput.value) monthInput.value = todayISO().slice(0,7);
  const ym = monthInput.value; // "2026-07"
  const list = visibleReportTransactions().filter(t=>t.tanggal && t.tanggal.slice(0,7)===ym);

  const totalTrx = list.length;
  const totalOmzet = list.reduce((s,t)=>s+t.total,0);
  const totalLunas = list.filter(t=>t.status==='lunas').reduce((s,t)=>s+t.total,0);
  /* Tagihan Paket Bulanan/Tempo yang masih berjalan (belum pernah ditandai
     lunas) tidak tersimpan sebagai baris `transactions` sama sekali, jadi
     tidak pernah kehitung tanpa ini -- nilainya SAAT INI JUGA (bukan
     dipotong sesuai bulan yang sedang dipilih), sama seperti "Sisa Bayar"
     yang tampil di halaman detail pelanggan itu sendiri. */
  const totalBelumLangganan = visibleReportSubscriptions().reduce((sum,s)=>sum+subscriptionOutstanding(s), 0);
  const totalBelum = list.filter(t=>t.status==='belum').reduce((s,t)=>s+(t.total-(t.dp||0)),0) + totalBelumLangganan;

  document.getElementById('stTrx').textContent = totalTrx;
  document.getElementById('stOmzet').textContent = rupiah(totalOmzet);
  document.getElementById('stLunas').textContent = rupiah(totalLunas);
  document.getElementById('stBelum').textContent = rupiah(totalBelum);

  // chart per hari
  const [yy,mm] = ym.split('-').map(Number);
  const daysInMonth = new Date(yy, mm, 0).getDate();
  const perDay = new Array(daysInMonth+1).fill(0);
  list.forEach(t=>{
    const d = parseInt(t.tanggal.slice(8,10),10);
    perDay[d] += t.total;
  });
  const maxVal = Math.max(...perDay, 1);
  const bars = document.getElementById('chartBars');
  const labels = document.getElementById('chartLabels');
  let barsHTML='', labelsHTML='';
  for(let d=1; d<=daysInMonth; d++){
    const h = Math.round((perDay[d]/maxVal)*84)+2;
    barsHTML += `<div class="bar" style="height:${h}px" title="${d}: ${rupiah(perDay[d])}"></div>`;
    labelsHTML += (d%5===0||d===1) ? `<span>${d}</span>` : `<span></span>`;
  }
  bars.innerHTML = barsHTML;
  labels.innerHTML = labelsHTML;

  renderOmzetTrend(ym);

  const reportList = document.getElementById('reportList');
  if(list.length===0){
    reportList.innerHTML = `<div class="empty">
      <svg class="bubble-icon" viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="21" stroke="#146C8E" stroke-width="2" opacity="0.4"/></svg>
      <h3>${t('Belum ada transaksi bulan ini')}</h3>
      <p>${t('Pilih bulan lain atau mulai catat transaksi baru.')}</p>
    </div>`;
  } else {
    reportList.innerHTML = sortByTanggalAsc(list).map(trx=>`
      <div class="item-line" style="align-items:center;">
        <span>${fmtDate(trx.tanggal)} — ${escapeHTML(trx.nama)} <span class="badge ${trx.status==='lunas'?'badge-lunas':'badge-belum'}" style="margin-left:6px;">${trx.status==='lunas'?t('Lunas'):t('Belum')}</span></span>
        <span>${rupiah(trx.total)}</span>
      </div>
    `).join('');
  }
}
const TREND_MONTH_NAMES = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
/* Tren omset 6 bulan terakhir (berakhir di bulan yang lagi dipilih di Laporan) —
   pakai definisi omset & sumber data yang sama persis dengan chart Omzet Harian
   di atas (visibleReportTransactions(), jumlah total per transaksi) supaya
   angkanya selalu konsisten. */
function renderOmzetTrend(ym){
  const [endYY, endMM] = ym.split('-').map(Number);
  const months = [];
  for(let i=5; i>=0; i--){
    let y = endYY, m = endMM - i;
    while(m < 1){ m += 12; y -= 1; }
    months.push(y + '-' + String(m).padStart(2,'0'));
  }
  const all = visibleReportTransactions();
  const perMonth = months.map(m => all.filter(t => t.tanggal && t.tanggal.slice(0,7) === m).reduce((s,t) => s + t.total, 0));
  const maxVal = Math.max(...perMonth, 1);
  const bars = document.getElementById('trendChartBars');
  const labels = document.getElementById('trendChartLabels');
  if(!bars || !labels) return;
  let barsHTML = '', labelsHTML = '';
  months.forEach((m, i) => {
    const h = Math.round((perMonth[i]/maxVal)*84)+2;
    const [yy, mm] = m.split('-').map(Number);
    const label = t(TREND_MONTH_NAMES[mm-1]) + "'" + String(yy).slice(2);
    barsHTML += `<div class="bar" style="height:${h}px" title="${label}: ${rupiah(perMonth[i])}"></div>`;
    labelsHTML += `<span>${label}</span>`;
  });
  bars.innerHTML = barsHTML;
  labels.innerHTML = labelsHTML;
}
function printReport(){
  const monthInput = document.getElementById('reportMonth');
  const ym = monthInput.value;
  const list = sortByTanggalAsc(transactions.filter(t=>t.tanggal && t.tanggal.slice(0,7)===ym));
  const totalOmzet = list.reduce((s,t)=>s+t.total,0);
  const rows = list.map(trx=>`
    <tr>
      <td>${trx.kode}</td><td>${fmtDate(trx.tanggal)}</td><td>${escapeHTML(trx.nama)}</td>
      <td>${trx.status==='lunas'?t('Lunas'):t('Belum Lunas')}</td><td style="text-align:right;">${rupiah(trx.total)}</td>
    </tr>`).join('');
  document.getElementById('printArea').innerHTML = `
    <div style="font-family:'Inter',sans-serif;padding:24px;max-width:700px;margin:0 auto;">
      <h2 style="font-family:'Sora',sans-serif;margin-bottom:2px;">${escapeHTML(settings.shopName||'Laundry Batapas.id')}</h2>
      <p style="color:#555;margin-top:0;">${t('Laporan Transaksi')} — ${ym}</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead><tr style="border-bottom:2px solid #333;text-align:left;">
          <th style="padding:6px 4px;">${t('No. Nota')}</th><th style="padding:6px 4px;">${t('Tanggal')}</th>
          <th style="padding:6px 4px;">${t('Pelanggan')}</th><th style="padding:6px 4px;">${t('Status')}</th>
          <th style="padding:6px 4px;text-align:right;">${t('Total')}</th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr style="border-top:2px solid #333;font-weight:700;">
          <td colspan="4" style="padding:8px 4px;">${t('Total Omzet')}</td>
          <td style="padding:8px 4px;text-align:right;">${rupiah(totalOmzet)}</td>
        </tr></tfoot>
      </table>
    </div>`;
  window.print();
}
document.getElementById('reportMonth').addEventListener('change', renderReport);

/* ===================== LAPORAN PER PELANGGAN ===================== */
function populatePerNamaSelect(){
  const sel = document.getElementById('perNama');
  if(!sel) return;
  const prev = sel.value;
  const namaSet = new Set();
  visibleReportTransactions().forEach(t=>{ if(t.nama) namaSet.add(t.nama); });
  visibleReportSubscriptions().forEach(s=>{ if(s.nama) namaSet.add(s.nama); });
  const namaList = Array.from(namaSet).sort((a,b)=>a.localeCompare(b));
  if(namaList.length===0){
    sel.innerHTML = `<option value="">${t('Belum ada data pelanggan')}</option>`;
    return;
  }
  sel.innerHTML = namaList.map(n=>`<option value="${escapeHTML(n)}">${escapeHTML(n)}</option>`).join('');
  if(prev && namaList.includes(prev)) sel.value = prev;
}
function togglePerPeriodeFields(){
  const type = document.getElementById('perPeriodeType').value;
  document.getElementById('perCustomFields').style.display = type==='custom' ? 'grid' : 'none';
  document.getElementById('perBulanField').style.display = type==='bulanan' ? 'block' : 'none';
  document.getElementById('perTahunField').style.display = type==='tahunan' ? 'block' : 'none';
}
function getPerPeriodeRange(){
  const type = document.getElementById('perPeriodeType').value;
  if(type==='custom'){
    const dari = document.getElementById('perDari').value;
    const sampai = document.getElementById('perSampai').value;
    if(!dari || !sampai) return null;
    return { dari, sampai, label: `${fmtDate(dari)} – ${fmtDate(sampai)}` };
  }
  if(type==='bulanan'){
    const ym = document.getElementById('perBulan').value;
    if(!ym) return null;
    const [yy,mm] = ym.split('-').map(Number);
    const lastDay = new Date(yy, mm, 0).getDate();
    return { dari: `${ym}-01`, sampai: `${ym}-${String(lastDay).padStart(2,'0')}`, label: `${t('Bulan')} ${ym}` };
  }
  if(type==='tahunan'){
    const yy = document.getElementById('perTahun').value;
    if(!yy) return null;
    return { dari: `${yy}-01-01`, sampai: `${yy}-12-31`, label: `${t('Tahun')} ${yy}` };
  }
  return null;
}
var perReportCache = null;
/* Baris HTML rincian tagihan Paket Bulanan/Tempo yang masih berjalan (belum
   pernah ditandai lunas) milik satu pelanggan -- dipakai di bagian "Belum
   Lunas" Laporan Per Pelanggan. Nilainya SAAT INI JUGA (lihat catatan di
   subscriptionOutstanding()), bukan dipotong sesuai rentang tanggal laporan. */
function subsOutstandingBlockHTML(s, bd){
  const rows = [];
  bd.groups.forEach(g=>{
    if(g.items.length===1){
      const u = g.items[0];
      rows.push(`<div class="item-line" style="align-items:center;">
        <span>${fmtDate(u.tanggal)} — ${escapeHTML(u.layananNama)} (${u.qty} ${u.satuan})</span>
        <span>${rupiah(u.subtotal)}</span>
      </div>`);
    } else {
      const bullets = g.items.map(u=>`<div style="font-size:12px;color:var(--ink-soft);padding:2px 0 2px 20px;">• ${escapeHTML(u.layananNama)} (${u.qty} ${u.satuan}) — ${rupiah(u.subtotal)}</div>`).join('');
      rows.push(`<div class="item-line" style="align-items:center;">
        <span>${fmtDate(g.tanggal)} — ${t('Transaksi')} (${g.items.length} ${currentLang==='en'?'services':t('layanan')})</span>
        <span>${rupiah(g.total)}</span>
      </div>${bullets}`);
    }
  });
  if(bd.excessCost>0){
    rows.push(`<div class="item-line" style="align-items:center;">
      <span>${t('Kelebihan Kuota')} — ${fmtKg(bd.excessKg)} kg</span>
      <span>${rupiah(bd.excessCost)}</span>
    </div>`);
  }
  if(bd.dp>0){
    rows.push(`<div class="item-line" style="align-items:center;color:var(--ink-soft);">
      <span>${t('Sudah Dibayar')} (DP)</span>
      <span>-${rupiah(bd.dp)}</span>
    </div>`);
  }
  rows.push(`<div class="item-line" style="align-items:center;font-weight:800;border-top:1px solid var(--line);padding-top:6px;margin-top:2px;">
    <span>${t('Sisa Tagihan Saat Ini')} — ${escapeHTML(s.paketNama)}</span>
    <span>${rupiah(bd.outstanding)}</span>
  </div>`);
  return rows.join('');
}
function renderPerPelangganReport(){
  const nama = document.getElementById('perNama').value;
  if(!nama){ showToast(t('Pilih pelanggan dulu')); return; }
  const range = getPerPeriodeRange();
  if(!range){ showToast(t('Lengkapi periode laporan dulu')); return; }

  const list = visibleReportTransactions().filter(t=>t.nama===nama && t.tanggal>=range.dari && t.tanggal<=range.sampai);
  const lunasList = list.filter(t=>t.status==='lunas');
  const belumTrxList = list.filter(t=>t.status==='belum');

  /* Pelanggan Paket Bulanan/Tempo yang tagihannya masih berjalan (belum
     pernah ditandai lunas) tidak punya baris di `transactions` sama sekali
     -- lihat subscriptionOutstandingBreakdown(). */
  const subsForNama = visibleReportSubscriptions().filter(s=>s.nama===nama);
  const subsBreakdowns = subsForNama.map(s=>({ s, bd: subscriptionOutstandingBreakdown(s) })).filter(x=>x.bd.outstanding>0);
  const subsTrxCount = subsBreakdowns.reduce((sum,x)=>sum+x.bd.groups.length+(x.bd.excessCost>0?1:0), 0);
  const subsOutstandingTotal = subsBreakdowns.reduce((sum,x)=>sum+x.bd.outstanding, 0);

  const totalTrx = list.length + subsTrxCount;
  const totalOmzet = list.reduce((s,t)=>s+t.total,0);
  const totalLunas = lunasList.reduce((s,t)=>s+t.total,0);
  const totalBelum = belumTrxList.reduce((s,t)=>s+(t.total-(t.dp||0)),0) + subsOutstandingTotal;

  document.getElementById('perStTrx').textContent = totalTrx;
  document.getElementById('perStOmzet').textContent = rupiah(totalOmzet);
  document.getElementById('perStLunas').textContent = rupiah(totalLunas);
  document.getElementById('perStBelum').textContent = rupiah(totalBelum);

  const resultList = document.getElementById('perResultList');
  if(list.length===0 && subsBreakdowns.length===0){
    resultList.innerHTML = `<div class="empty">
      <svg class="bubble-icon" viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="21" stroke="#146C8E" stroke-width="2" opacity="0.4"/></svg>
      <h3>${t('Tidak ada transaksi')}</h3>
      <p>${t('Tidak ada transaksi untuk pelanggan ini di periode tersebut.')}</p>
    </div>`;
  } else {
    const lunasHTML = lunasList.length===0
      ? `<div style="font-size:12.5px;color:var(--ink-soft);padding:6px 0;">${t('Tidak ada transaksi lunas di periode ini.')}</div>`
      : lunasList.slice().reverse().map(trx=>`
        <div class="item-line" style="align-items:center;">
          <span>${fmtDate(trx.tanggal)} — ${trx.kode}</span>
          <span>${rupiah(trx.total)}</span>
        </div>
      `).join('');

    const belumTrxHTML = belumTrxList.slice().reverse().map(trx=>`
      <div class="item-line" style="align-items:center;">
        <span>${fmtDate(trx.tanggal)} — ${trx.kode}</span>
        <span>${rupiah(trx.total)}</span>
      </div>
    `).join('');
    const subsHTML = subsBreakdowns.map(x=>subsOutstandingBlockHTML(x.s, x.bd)).join('');
    const belumHTML = (belumTrxHTML || subsHTML) ? (belumTrxHTML + subsHTML)
      : `<div style="font-size:12.5px;color:var(--ink-soft);padding:6px 0;">${t('Tidak ada tagihan belum lunas di periode ini.')}</div>`;

    resultList.innerHTML = `
      <div class="section-title">${t('Lunas')}</div>
      ${lunasHTML}
      <div class="section-title" style="margin-top:14px;">${t('Belum Lunas')}</div>
      ${subsBreakdowns.length>0 ? `<div style="font-size:11px;color:var(--ink-soft);margin:-4px 0 8px;">${t('Termasuk tagihan Paket Bulanan/Tempo yang masih berjalan — nilai saat ini, tidak tergantung rentang tanggal di atas.')}</div>` : ''}
      ${belumHTML}
    `;
  }
  document.getElementById('perResultBox').style.display = 'block';
  perReportCache = { nama, range, lunasList, belumTrxList, subsBreakdowns, totalTrx, totalOmzet, totalLunas, totalBelum };
}
function downloadPerPelangganPDF(){
  if(!isSubscriptionActive()){ showPaywallModal(); return; }
  if(!perReportCache){ showToast(t('Tampilkan laporan dulu sebelum unduh PDF')); return; }
  const { nama, range, lunasList, belumTrxList, subsBreakdowns, totalOmzet, totalBelum } = perReportCache;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit:'mm', format:'a4' });
  const colX = { kode:14, tgl:50, status:130, total:196 };

  doc.setFont('helvetica','bold'); doc.setFontSize(14);
  doc.text(settings.shopName || 'Laundry Batapas.id', 14, 16);
  doc.setFont('helvetica','normal'); doc.setFontSize(10);
  if(settings.address) doc.text(settings.address, 14, 22);
  doc.setFontSize(11);
  doc.text(`${t('Laporan Per Pelanggan')} — ${nama}`, 14, 30);
  doc.setFontSize(9.5);
  doc.text(`${t('Periode:')} ${range.label}`, 14, 36);

  let y = 46;
  const ensureRoom = ()=>{ if(y > 280){ doc.addPage(); y = 20; } };
  const colHeader = ()=>{
    ensureRoom();
    doc.setFont('helvetica','bold'); doc.setFontSize(9.5);
    doc.text(t('No. Nota'), colX.kode, y);
    doc.text(t('Tanggal'), colX.tgl, y);
    doc.text(t('Status'), colX.status, y);
    doc.text(t('Total'), colX.total, y, { align:'right' });
    y += 2.5;
    doc.setLineWidth(0.4);
    doc.line(14, y, 196, y);
    y += 6;
    doc.setFont('helvetica','normal');
  };
  const row = (kode, tanggal, statusLabel, total, bold)=>{
    ensureRoom();
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.text(kode || '-', colX.kode, y);
    if(tanggal) doc.text(fmtDate(tanggal), colX.tgl, y);
    if(statusLabel) doc.text(statusLabel, colX.status, y);
    doc.text(rupiah(total), colX.total, y, { align:'right' });
    y += 6.5;
  };
  const sectionTitle = (text)=>{
    ensureRoom();
    doc.setFont('helvetica','bold'); doc.setFontSize(10.5);
    doc.text(text, 14, y);
    y += 6;
  };

  sectionTitle(t('Lunas'));
  colHeader();
  if(lunasList.length===0){
    doc.text(t('Tidak ada transaksi lunas di periode ini.'), 14, y);
    y += 8;
  } else {
    lunasList.forEach(trx=> row(trx.kode, trx.tanggal, t('Lunas'), trx.total));
    y += 4;
  }

  sectionTitle(t('Belum Lunas'));
  colHeader();
  let anyBelum = false;
  belumTrxList.forEach(trx=>{ anyBelum = true; row(trx.kode, trx.tanggal, t('Belum Lunas'), trx.total); });
  subsBreakdowns.forEach(({ s, bd })=>{
    bd.groups.forEach(g=>{
      anyBelum = true;
      const label = g.items.length===1
        ? `${g.items[0].layananNama} (${g.items[0].qty} ${g.items[0].satuan})`
        : `${t('Transaksi')} (${g.items.length} ${currentLang==='en'?'services':t('layanan')})`;
      row(label, g.tanggal, t('Belum Lunas'), g.total);
    });
    if(bd.excessCost>0){ anyBelum = true; row(t('Kelebihan Kuota'), s.tanggalMulai, t('Belum Lunas'), bd.excessCost); }
    if(bd.dp>0){ anyBelum = true; row(`${t('Sudah Dibayar')} (DP)`, s.tanggalMulai, '-', -bd.dp); }
    row(`${t('Sisa Tagihan Saat Ini')} — ${s.paketNama}`, null, null, bd.outstanding, true);
  });
  if(!anyBelum){
    doc.text(t('Tidak ada tagihan belum lunas di periode ini.'), 14, y);
    y += 6;
  }

  ensureRoom();
  y += 3;
  doc.setLineWidth(0.6);
  doc.line(14, y, 196, y);
  y += 7;
  doc.setFont('helvetica','bold'); doc.setFontSize(11);
  doc.text(t('Total Belanja'), colX.status, y);
  doc.text(rupiah(totalOmzet), colX.total, y, { align:'right' });
  y += 7;
  doc.text(t('Belum Lunas'), colX.status, y);
  doc.text(rupiah(totalBelum), colX.total, y, { align:'right' });

  doc.save(`Laporan-${nama.replace(/[^a-zA-Z0-9]/g,'_')}-${range.dari}_${range.sampai}.pdf`);
}

/* ===================== LABA RUGI (per bulan / per tahun) ===================== */
function toggleLrPeriodeFields(){
  const type = document.getElementById('lrPeriodeType').value;
  document.getElementById('lrBulanField').style.display = type==='bulanan' ? 'block' : 'none';
  document.getElementById('lrTahunField').style.display = type==='tahunan' ? 'block' : 'none';
}
function getLrPeriodeRange(){
  const type = document.getElementById('lrPeriodeType').value;
  if(type==='bulanan'){
    const ym = document.getElementById('lrBulan').value;
    if(!ym) return null;
    const [yy,mm] = ym.split('-').map(Number);
    const lastDay = new Date(yy, mm, 0).getDate();
    return { dari: `${ym}-01`, sampai: `${ym}-${String(lastDay).padStart(2,'0')}`, label: `${t('Bulan')} ${ym}` };
  }
  if(type==='tahunan'){
    const yy = document.getElementById('lrTahun').value;
    if(!yy) return null;
    return { dari: `${yy}-01-01`, sampai: `${yy}-12-31`, label: `${t('Tahun')} ${yy}` };
  }
  return null;
}
function renderLabaRugi(){
  if(!document.getElementById('lrBulan').value) document.getElementById('lrBulan').value = todayISO().slice(0,7);
  const range = getLrPeriodeRange();
  const breakdownEl = document.getElementById('lrBreakdown');
  if(!range){
    document.getElementById('lrPemasukan').textContent = rupiah(0);
    document.getElementById('lrPengeluaran').textContent = rupiah(0);
    document.getElementById('lrLabaRugi').textContent = rupiah(0);
    breakdownEl.innerHTML = '';
    labaRugiCache = null;
    return;
  }
  const trxList = visibleReportTransactions().filter(t=>t.tanggal>=range.dari && t.tanggal<=range.sampai);
  const expList = visibleReportExpenses().filter(e=>e.tanggal>=range.dari && e.tanggal<=range.sampai);
  const totalOmzet = trxList.reduce((s,t)=>s+t.total,0);
  const totalPengeluaran = expList.reduce((s,e)=>s+e.jumlah,0);
  const pendapatanBersih = totalOmzet - totalPengeluaran;

  document.getElementById('lrPemasukan').textContent = rupiah(totalOmzet);
  document.getElementById('lrPengeluaran').textContent = rupiah(totalPengeluaran);
  const lrEl = document.getElementById('lrLabaRugi');
  lrEl.textContent = (pendapatanBersih<0 ? t('Rugi')+' ' : t('Untung')+' ') + rupiah(Math.abs(pendapatanBersih));
  lrEl.style.color = pendapatanBersih<0 ? 'var(--warn)' : 'var(--success)';

  const byKategori = {};
  expList.forEach(e=>{ byKategori[e.kategori] = (byKategori[e.kategori]||0) + e.jumlah; });
  const kategoriRows = Object.entries(byKategori).sort((a,b)=>b[1]-a[1]);
  if(kategoriRows.length===0){
    breakdownEl.innerHTML = `<div style="font-size:12.5px;color:var(--ink-soft);text-align:center;padding:8px 0;">${t('Tidak ada pengeluaran di periode ini')}</div>`;
  } else {
    breakdownEl.innerHTML = kategoriRows.map(([kat,tot])=>`
      <div class="item-line"><span>${escapeHTML(kat)}</span><span>${rupiah(tot)}</span></div>
    `).join('');
  }
  labaRugiCache = { range, totalOmzet, totalPengeluaran, pendapatanBersih, kategoriRows };
}
function downloadLabaRugiPDF(){
  if(!isSubscriptionActive()){ showPaywallModal(); return; }
  if(!labaRugiCache){ showToast(t('Tampilkan laporan dulu sebelum unduh PDF')); return; }
  const { range, totalOmzet, totalPengeluaran, pendapatanBersih, kategoriRows } = labaRugiCache;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit:'mm', format:'a4' });

  doc.setFont('helvetica','bold'); doc.setFontSize(14);
  doc.text(settings.shopName || 'Laundry Batapas.id', 14, 16);
  doc.setFont('helvetica','normal'); doc.setFontSize(10);
  if(settings.address) doc.text(settings.address, 14, 22);
  doc.setFontSize(11);
  doc.text(t('Laporan Laba Rugi'), 14, 30);
  doc.setFontSize(9.5);
  doc.text(`${t('Periode:')} ${range.label}`, 14, 36);

  let y = 48;
  doc.setFont('helvetica','normal'); doc.setFontSize(11);
  doc.text(t('Total Pemasukan (Omzet)'), 14, y);
  doc.text(rupiah(totalOmzet), 196, y, { align:'right' }); y += 8;
  doc.text(t('Total Pengeluaran'), 14, y);
  doc.text(rupiah(totalPengeluaran), 196, y, { align:'right' }); y += 4;
  doc.setLineWidth(0.4); doc.line(14, y, 196, y); y += 8;
  doc.setFont('helvetica','bold'); doc.setFontSize(12);
  doc.text(t('Pendapatan Bersih'), 14, y);
  doc.text((pendapatanBersih<0?'-':'')+rupiah(Math.abs(pendapatanBersih)), 196, y, { align:'right' });
  y += 14;

  doc.setFontSize(11);
  doc.text(t('Rincian Pengeluaran per Kategori'), 14, y); y += 8;
  doc.setFont('helvetica','normal'); doc.setFontSize(9.5);
  if(kategoriRows.length===0){
    doc.text(t('Tidak ada pengeluaran di periode ini.'), 14, y); y += 6;
  }
  kategoriRows.forEach(([kat,tot])=>{
    if(y > 280){ doc.addPage(); y = 20; }
    doc.text(kat, 14, y);
    doc.text(rupiah(tot), 196, y, { align:'right' });
    y += 6.5;
  });

  doc.save(`Laba-Rugi-${range.label.replace(/\s+/g,'-')}.pdf`);
}

/* ===================== PERINGKAT PEMASUKAN PELANGGAN ===================== */
function toggleRankPeriodeFields(){
  const type = document.getElementById('rankPeriodeType').value;
  document.getElementById('rankBulanField').style.display = type==='bulanan' ? 'block' : 'none';
  document.getElementById('rankTahunField').style.display = type==='tahunan' ? 'block' : 'none';
}
function getRankPeriodeRange(){
  const type = document.getElementById('rankPeriodeType').value;
  if(type==='semua') return { dari:'0000-01-01', sampai:'9999-12-31', label:t('Semua Waktu') };
  if(type==='bulanan'){
    const ym = document.getElementById('rankBulan').value;
    if(!ym) return null;
    const [yy,mm] = ym.split('-').map(Number);
    const lastDay = new Date(yy, mm, 0).getDate();
    return { dari: `${ym}-01`, sampai: `${ym}-${String(lastDay).padStart(2,'0')}`, label: `${t('Bulan')} ${ym}` };
  }
  if(type==='tahunan'){
    const yy = document.getElementById('rankTahun').value;
    if(!yy) return null;
    return { dari: `${yy}-01-01`, sampai: `${yy}-12-31`, label: `${t('Tahun')} ${yy}` };
  }
  return null;
}
function renderPeringkatPelanggan(){
  if(!document.getElementById('rankBulan').value) document.getElementById('rankBulan').value = todayISO().slice(0,7);
  const range = getRankPeriodeRange();
  const el = document.getElementById('rankList');
  if(!range){ el.innerHTML = ''; peringkatPelangganCache = null; return; }
  const list = visibleReportTransactions().filter(t=>t.tanggal>=range.dari && t.tanggal<=range.sampai);
  const byNama = {};
  list.forEach(t=>{
    if(!byNama[t.nama]) byNama[t.nama] = { nama:t.nama, total:0, count:0 };
    byNama[t.nama].total += t.total;
    byNama[t.nama].count += 1;
  });
  const ranked = Object.values(byNama).sort((a,b)=>b.total-a.total);
  if(ranked.length===0){
    el.innerHTML = `<div class="empty">
      <svg class="bubble-icon" viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="21" stroke="#146C8E" stroke-width="2" opacity="0.4"/></svg>
      <h3>${t('Tidak ada transaksi')}</h3>
      <p>${t('Tidak ada transaksi pada periode ini.')}</p>
    </div>`;
  } else {
    el.innerHTML = ranked.map((r,i)=>`
      <div class="item-line" style="align-items:center;">
        <span>${i+1}. ${escapeHTML(r.nama)} <span style="color:var(--ink-soft);">(${r.count} ${currentLang==='en' ? (r.count===1?'transaction':'transactions') : t('transaksi')})</span></span>
        <span>${rupiah(r.total)}</span>
      </div>
    `).join('');
  }
  peringkatPelangganCache = { range, ranked };
}
function downloadPeringkatPelangganPDF(){
  if(!isSubscriptionActive()){ showPaywallModal(); return; }
  if(!peringkatPelangganCache){ showToast(t('Tampilkan laporan dulu sebelum unduh PDF')); return; }
  const { range, ranked } = peringkatPelangganCache;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit:'mm', format:'a4' });
  const colX = { no:14, nama:26, count:140, total:196 };

  doc.setFont('helvetica','bold'); doc.setFontSize(14);
  doc.text(settings.shopName || 'Laundry Batapas.id', 14, 16);
  doc.setFont('helvetica','normal'); doc.setFontSize(10);
  if(settings.address) doc.text(settings.address, 14, 22);
  doc.setFontSize(11);
  doc.text(t('Peringkat Pemasukan Pelanggan'), 14, 30);
  doc.setFontSize(9.5);
  doc.text(`${t('Periode:')} ${range.label}`, 14, 36);

  let y = 46;
  doc.setFont('helvetica','bold'); doc.setFontSize(9.5);
  doc.text(t('No'), colX.no, y);
  doc.text(t('Pelanggan'), colX.nama, y);
  doc.text(t('Jml Transaksi'), colX.count, y);
  doc.text(t('Total Bayar'), colX.total, y, { align:'right' });
  y += 2.5;
  doc.setLineWidth(0.4);
  doc.line(14, y, 196, y);
  y += 6;

  doc.setFont('helvetica','normal'); doc.setFontSize(9);
  if(ranked.length===0){
    doc.text(t('Tidak ada transaksi pada periode ini.'), 14, y);
    y += 6;
  }
  ranked.forEach((r,i)=>{
    if(y > 280){ doc.addPage(); y = 20; }
    doc.text(String(i+1), colX.no, y);
    const namaTrunc = r.nama.length>40 ? r.nama.slice(0,40)+'…' : r.nama;
    doc.text(namaTrunc, colX.nama, y);
    doc.text(String(r.count), colX.count, y);
    doc.text(rupiah(r.total), colX.total, y, { align:'right' });
    y += 6.5;
  });

  doc.save(`Peringkat-Pelanggan-${range.label.replace(/\s+/g,'-')}.pdf`);
}

