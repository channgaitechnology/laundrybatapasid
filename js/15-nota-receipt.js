/* ===================== NOTA / RECEIPT ===================== */
function buildReceiptHTML(trx){
  const itemsHTML = trx.items.map(it=>`
    <div class="r-item">
      <div class="r-item-name"><span>${escapeHTML(it.nama)}</span><span>${rupiah(it.subtotal)}</span></div>
      <div class="r-item-detail">${it.qty} ${escapeHTML(it.satuan)} x ${rupiah(it.harga)}</div>
    </div>`).join('');
  const sisa = trx.total - (trx.dp||0);
  const hdr = notaHeaderInfo(trx.outletId);
  return `
    <div class="r-shop">
      <img src="${shopLogoSrc()}" alt="Logo" style="width:56px;height:56px;border-radius:50%;object-fit:cover;display:block;margin:0 auto 8px;box-shadow:0 1px 4px rgba(0,0,0,0.15);">
      <b>${escapeHTML(hdr.nama)}</b>
      ${hdr.subtitle ? `<div>${escapeHTML(hdr.subtitle)}</div>` : ''}
      <div>${escapeHTML(hdr.alamat)}</div>
      <div>${escapeHTML(hdr.telp)}</div>
    </div>
    <div class="r-divider"></div>
    <div class="r-row"><span>No. Nota</span><span>${trx.kode}</span></div>
    <div class="r-row"><span>Tanggal</span><span>${fmtDate(trx.tanggal)}</span></div>
    <div class="r-row"><span>Pelanggan</span><span>${escapeHTML(trx.nama)}</span></div>
    ${trx.estimasi ? `<div class="r-row"><span>Estimasi Selesai</span><span>${fmtDate(trx.estimasi)}</span></div>` : ''}
    <div class="r-divider"></div>
    ${itemsHTML}
    <div class="r-divider"></div>
    ${trx.diskon>0 ? `<div class="r-row"><span>Diskon</span><span>-${rupiah(trx.diskon)}</span></div>` : ''}
    <div class="r-total"><span>TOTAL</span><span>${rupiah(trx.total)}</span></div>
    ${trx.status==='belum' ? `<div class="r-row" style="margin-top:6px;"><span>Uang Muka</span><span>${rupiah(trx.dp||0)}</span></div>
    <div class="r-row"><span>Sisa Bayar</span><span>${rupiah(sisa)}</span></div>` : ''}
    ${trx.status==='lunas' && (trx.dp||0)>trx.total ? `<div class="r-row" style="margin-top:6px;color:var(--success);"><span>Kelebihan Bayar</span><span>${rupiah((trx.dp||0)-trx.total)}</span></div>` : ''}
    <div class="r-status"><span class="badge ${trx.status==='lunas'?'badge-lunas':'badge-belum'}">${trx.status==='lunas'?'LUNAS':'BELUM LUNAS'}</span></div>
    ${trx.catatan ? `<div class="r-divider"></div><div class="r-row" style="display:block;"><i>Catatan: ${escapeHTML(trx.catatan)}</i></div>` : ''}
    <div class="r-footer">${escapeHTML(settings.note||'')}</div>
    <div style="display:flex;flex-direction:column;align-items:center;gap:6px;margin-top:10px;padding-top:10px;border-top:1.5px dashed #B8AD97;font-size:11px;color:#6b5f4d;">
      <div style="font-weight:800;color:var(--ink);">dikembangkan oleh ${escapeHTML(appBranding.nama)}</div>
      <div style="font-style:italic;">${escapeHTML(appBranding.tagline)}</div>
      <a href="https://wa.me/${normalizePhone(appBranding.wa)}" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:6px;text-decoration:none;color:inherit;">
        <span style="width:18px;height:18px;flex:none;display:inline-flex;">${iconBadgeSVG('wa')}</span>
        <span>${escapeHTML(appBranding.wa)}</span>
      </a>
      <a href="mailto:${escapeHTML(appBranding.email)}" style="display:flex;align-items:center;gap:6px;text-decoration:none;color:inherit;">
        <span style="width:18px;height:18px;flex:none;display:inline-flex;">${iconBadgeSVG('email')}</span>
        <span>${escapeHTML(appBranding.email)}</span>
      </a>
    </div>
  `;
}
function escapeHTML(s){
  return (s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function openReceipt(id){
  currentReceiptId = id;
  const trx = transactions.find(t=>t.id===id);
  if(!trx) return;
  document.getElementById('receiptBox').innerHTML = buildReceiptHTML(trx);
  switchTab('nota');
}
function printCurrentReceipt(){
  const trx = transactions.find(t=>t.id===currentReceiptId);
  if(!trx) return;
  document.getElementById('printArea').innerHTML = `<div style="max-width:340px;margin:0 auto;font-family:'Space Mono',monospace;padding:20px;">${buildReceiptHTML(trx)}</div>`;
  window.print();
}

/* ===================== PDF: NOTA ===================== */
function buildReceiptPDFLines(trx){
  const L = [];
  const div = '--------------------------------';
  const hdr = notaHeaderInfo(trx.outletId);
  L.push({t: hdr.nama, c:true, b:true, s:12});
  if(hdr.subtitle) L.push({t: hdr.subtitle, c:true, s:8});
  if(hdr.alamat) L.push({t: hdr.alamat, c:true, s:8});
  if(hdr.telp) L.push({t: hdr.telp, c:true, s:8});
  L.push({t: div, s:9});
  L.push({t:`No. Nota   : ${trx.kode}`, s:9, indent:13});
  L.push({t:`Tanggal    : ${fmtDate(trx.tanggal)}`, s:9, indent:13});
  L.push({t:`Pelanggan  : ${trx.nama}`, s:9, indent:13});
  if(trx.estimasi) L.push({t:`Estimasi   : ${fmtDate(trx.estimasi)}`, s:9, indent:13});
  L.push({t: div, s:9});
  trx.items.forEach(it=>{
    L.push({t: it.nama, s:9});
    L.push({t:`  ${it.qty} ${it.satuan} x ${rupiah(it.harga)} = ${rupiah(it.subtotal)}`, s:8});
  });
  L.push({t: div, s:9});
  if(trx.diskon>0) L.push({t:`Diskon     : -${rupiah(trx.diskon)}`, s:9});
  L.push({t:`TOTAL      : ${rupiah(trx.total)}`, b:true, s:11});
  if(trx.status==='belum'){
    L.push({t:`Uang Muka  : ${rupiah(trx.dp||0)}`, s:9});
    L.push({t:`Sisa Bayar : ${rupiah(trx.total-(trx.dp||0))}`, s:9});
  }
  if(trx.status==='lunas' && (trx.dp||0)>trx.total){
    L.push({t:`Kelebihan Bayar : ${rupiah((trx.dp||0)-trx.total)}`, s:9});
  }
  L.push({t:`Status     : ${trx.status==='lunas'?'LUNAS':'BELUM LUNAS'}`, b:true, s:9});
  L.push({t: div, s:9});
  L.push({t: settings.note || 'Terima kasih', c:true, s:8});
  L.push(...notaFooterLinesPDF());
  return L;
}
async function downloadReceiptImage(){
  const trx = transactions.find(t=>t.id===notaShareTrxId);
  if(!trx){ showToast('Nota tidak ditemukan'); return; }
  await shareOrDownloadNotaImage(buildReceiptPDFLines(trx), `Nota-${trx.kode}`, 80, `Nota ${trx.kode}`);
  closeReceiptShareOptions();
}

/* ===================== PDF: LAPORAN ===================== */
function downloadReportPDF(){
  if(!isSubscriptionActive()){ showPaywallModal(); return; }
  const monthInput = document.getElementById('reportMonth');
  const ym = monthInput.value || todayISO().slice(0,7);
  const list = sortByTanggalAsc(transactions.filter(t=>t.tanggal && t.tanggal.slice(0,7)===ym));
  const totalOmzet = list.reduce((s,t)=>s+t.total,0);
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit:'mm', format:'a4' });
  const colX = { kode:14, tgl:44, nama:72, status:138, total:196 };

  doc.setFont('helvetica','bold'); doc.setFontSize(14);
  doc.text(settings.shopName || 'Laundry Batapas.id', 14, 16);
  doc.setFont('helvetica','normal'); doc.setFontSize(10);
  if(settings.address) doc.text(settings.address, 14, 22);
  doc.setFontSize(11);
  doc.text(`Laporan Transaksi — ${ym}`, 14, 30);

  let y = 40;
  doc.setFont('helvetica','bold'); doc.setFontSize(9.5);
  doc.text('No. Nota', colX.kode, y);
  doc.text('Tanggal', colX.tgl, y);
  doc.text('Pelanggan', colX.nama, y);
  doc.text('Status', colX.status, y);
  doc.text('Total', colX.total, y, { align:'right' });
  y += 2.5;
  doc.setLineWidth(0.4);
  doc.line(14, y, 196, y);
  y += 6;

  doc.setFont('helvetica','normal');
  if(list.length===0){
    doc.text('Belum ada transaksi pada bulan ini.', 14, y);
    y += 6;
  }
  list.forEach(t=>{
    if(y > 280){ doc.addPage(); y = 20; }
    doc.text(t.kode || '-', colX.kode, y);
    doc.text(fmtDate(t.tanggal), colX.tgl, y);
    const namaTrunc = t.nama.length>26 ? t.nama.slice(0,26)+'…' : t.nama;
    doc.text(namaTrunc, colX.nama, y);
    doc.text(t.status==='lunas' ? 'Lunas' : 'Belum Lunas', colX.status, y);
    doc.text(rupiah(t.total), colX.total, y, { align:'right' });
    y += 6.5;
  });

  y += 3;
  doc.setLineWidth(0.6);
  doc.line(14, y, 196, y);
  y += 7;
  doc.setFont('helvetica','bold'); doc.setFontSize(11);
  doc.text('Total Omzet', colX.status, y);
  doc.text(rupiah(totalOmzet), colX.total, y, { align:'right' });

  doc.save(`Laporan-${ym}.pdf`);
}

function receiptTextForWA(trx){
  let lines = [];
  const hdr = notaHeaderInfo(trx.outletId);
  lines.push(`*${hdr.nama}*`);
  if(hdr.subtitle) lines.push(hdr.subtitle);
  if(hdr.alamat) lines.push(hdr.alamat);
  if(hdr.telp) lines.push(hdr.telp);
  lines.push('-------------------------------');
  lines.push(`No. Nota   : ${trx.kode}`);
  lines.push(`Tanggal    : ${fmtDate(trx.tanggal)}`);
  lines.push(`Pelanggan  : ${trx.nama}`);
  if(trx.estimasi) lines.push(`Estimasi   : ${fmtDate(trx.estimasi)}`);
  lines.push('-------------------------------');
  trx.items.forEach(it=>{
    lines.push(`${it.nama}`);
    lines.push(`  ${it.qty} ${it.satuan} x ${rupiah(it.harga)} = ${rupiah(it.subtotal)}`);
  });
  lines.push('-------------------------------');
  if(trx.diskon>0) lines.push(`Diskon     : -${rupiah(trx.diskon)}`);
  lines.push(`*TOTAL      : ${rupiah(trx.total)}*`);
  if(trx.status==='belum'){
    lines.push(`Uang Muka  : ${rupiah(trx.dp||0)}`);
    lines.push(`Sisa Bayar : ${rupiah(trx.total-(trx.dp||0))}`);
  }
  if(trx.status==='lunas' && (trx.dp||0)>trx.total){
    lines.push(`Kelebihan Bayar : ${rupiah((trx.dp||0)-trx.total)} (dititip untuk laundry berikutnya, bukan kembalian)`);
  }
  lines.push(`Status     : ${trx.status==='lunas' ? 'LUNAS' : 'BELUM LUNAS'}`);
  lines.push('-------------------------------');
  lines.push(settings.note || 'Terima kasih');
  lines.push(...notaFooterLinesWA());
  return lines.join('\n');
}
var notaShareTrxId = null;
function openReceiptShareOptions(trxId){
  notaShareTrxId = trxId || currentReceiptId;
  const modal = document.getElementById('receiptShareModal');
  if(modal) modal.classList.add('show');
}
function closeReceiptShareOptions(){
  const modal = document.getElementById('receiptShareModal');
  if(modal) modal.classList.remove('show');
}
function sendReceiptWA(target){
  const trx = transactions.find(t=>t.id===notaShareTrxId);
  if(!trx) return;
  if(!trx.hp){ showToast('No. WhatsApp pelanggan belum diisi'); closeReceiptShareOptions(); return; }
  openWA(normalizePhone(trx.hp), receiptTextForWA(trx), target);
  closeReceiptShareOptions();
}

