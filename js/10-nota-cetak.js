/* ===================== NOTA TIMBANGAN (per catatan laundry masuk) ===================== */
var currentUsageNotaId = null;
function openUsageNotaOptions(usageId){
  currentUsageNotaId = usageId;
  currentBatchUsageIds = null;
  const s = subscriptions.find(x=>x.id===currentSubscriptionId);
  const tempo = s && isTempo(s);
  document.getElementById('usageNotaTitle').textContent = tempo ? t('Kirim Nota Transaksi') : t('Kirim Nota Timbangan');
  document.getElementById('usageNotaHint').textContent = tempo
    ? t('Nota berisi rincian laundry hari ini dan rekap seluruh riwayat transaksi yang belum ditagih.')
    : t('Nota berisi rincian timbangan hari ini dan seluruh riwayat timbangan paket ini.');
  const modal = document.getElementById('usageNotaModal');
  if(modal) modal.classList.add('show');
}
/* Sama seperti openUsageNotaOptions() tapi untuk beberapa subscription_usage
   (layanan tambahan Tempo) yang baru saja disimpan sekaligus lewat
   submitExtraServiceBatch() — semua ditampilkan sebagai satu nota gabungan. */
function openBatchUsageNotaOptions(usageIds){
  currentBatchUsageIds = usageIds;
  currentUsageNotaId = null;
  document.getElementById('usageNotaTitle').textContent = t('Kirim Nota Transaksi');
  document.getElementById('usageNotaHint').textContent = t('Nota berisi rincian laundry hari ini dan rekap seluruh riwayat transaksi yang belum ditagih.');
  const modal = document.getElementById('usageNotaModal');
  if(modal) modal.classList.add('show');
}
function closeUsageNotaOptions(){
  const modal = document.getElementById('usageNotaModal');
  if(modal) modal.classList.remove('show');
  currentBatchUsageIds = null;
}
function sortedPemakaian(){
  return currentUsageList.filter(u=>u.type==='pemakaian').slice().sort((a,b)=> a.tanggal < b.tanggal ? -1 : (a.tanggal > b.tanggal ? 1 : 0));
}
/* Hanya timbangan sampai tanggal nota yang dicetak — cetak nota lama tidak boleh ikut transaksi sesudahnya */
function pemakaianSampai(usage){
  return sortedPemakaian().filter(u => u.tanggal <= usage.tanggal);
}
/* Layanan tambahan (di luar kuota, mis. handuk) sampai tanggal nota yang dicetak */
function extrasSampai(usage){
  return currentUsageList.filter(u=>u.type==='layanan_tambahan' && u.tanggal <= usage.tanggal)
    .slice().sort((a,b)=> a.tanggal < b.tanggal ? -1 : (a.tanggal > b.tanggal ? 1 : 0));
}
/* Hitung kelebihan kuota & total layanan tambahan sampai tanggal nota, untuk total harga paket */
function hitungHargaSampai(usage, s, terpakaiUpTo){
  const excessKg = Math.max(terpakaiUpTo - s.kuotaKg, 0);
  const excessRate = s.hargaLebihKg>0 ? s.hargaLebihKg : (s.kuotaKg>0 ? s.hargaPaket/s.kuotaKg : 0);
  const excessCost = excessKg * excessRate;
  const extras = extrasSampai(usage);
  const extraTotal = extras.reduce((sum,u)=>sum+u.subtotal, 0);
  const totalHarga = (s.hargaPaket||0) + excessCost + extraTotal;
  return { excessKg, excessCost, extras, extraTotal, totalHarga };
}
function tempoUsageNotaTextWA(usage, s){
  const extras = extrasSampai(usage);
  const totalHarga = extras.reduce((sum,u)=>sum+u.subtotal,0);
  const sisaBayar = Math.max(totalHarga - (s.dp||0), 0);
  const lebihBayar = Math.max((s.dp||0) - totalHarga, 0);
  const lines = [];
  const hdr = notaHeaderInfo(s.outletId);
  lines.push(`*${hdr.nama}*`);
  if(hdr.subtitle) lines.push(hdr.subtitle);
  if(hdr.alamat) lines.push(hdr.alamat);
  if(hdr.telp) lines.push(hdr.telp);
  lines.push('-------------------------------');
  lines.push(`*${t('CATATAN TRANSAKSI - TEMPO')}*`);
  lines.push(`${t('Pelanggan')}  : ${s.nama}`);
  lines.push(`${t('Jenis')}      : ${t('Tempo (Bayar Nanti)')}`);
  lines.push('-------------------------------');
  lines.push(`*${t('Timbangan Sekarang')}*`);
  lines.push(`*${fmtDate(usage.tanggal)} — ${usage.layananNama} : ${fmtKg(usage.qty)} ${usage.satuan} x ${rupiah(usage.harga)} = ${rupiah(usage.subtotal)}*`);
  lines.push('-------------------------------');
  lines.push(`*${t('Rekap Riwayat Transaksi (Belum Ditagih)')}*`);
  lines.push(...extraGroupLinesWA(extras));
  lines.push('-------------------------------');
  lines.push(`*${t('Total Tagihan Berjalan')} : ${rupiah(totalHarga)}*`);
  lines.push(`${t('Sudah Dibayar')} : ${rupiah(s.dp||0)}`);
  lines.push(`${t('Sisa Bayar')}    : ${rupiah(sisaBayar)}`);
  if(lebihBayar>0) lines.push(`${t('Kelebihan Bayar')} : ${rupiah(lebihBayar)} (${t('saldo untuk laundry berikutnya, bukan kembalian')})`);
  lines.push('-------------------------------');
  lines.push(settings.note || t('Terima kasih'));
  lines.push(...notaFooterLinesWA());
  return lines.join('\n');
}
/* Versi batch dari tempoUsageNotaTextWA() — dipakai saat beberapa layanan
   ditambahkan sekaligus lewat submitExtraServiceBatch() sebelum disimpan jadi
   satu nota, jadi "Timbangan Sekarang" berisi beberapa baris, bukan cuma satu. */
function tempoBatchUsageNotaTextWA(newItems, s){
  const lastDate = newItems.reduce((max,u)=> u.tanggal>max?u.tanggal:max, newItems[0].tanggal);
  const extras = extrasSampai({ tanggal: lastDate });
  const totalHarga = extras.reduce((sum,u)=>sum+u.subtotal,0);
  const sisaBayar = Math.max(totalHarga - (s.dp||0), 0);
  const lebihBayar = Math.max((s.dp||0) - totalHarga, 0);
  const lines = [];
  const hdr = notaHeaderInfo(s.outletId);
  lines.push(`*${hdr.nama}*`);
  if(hdr.subtitle) lines.push(hdr.subtitle);
  if(hdr.alamat) lines.push(hdr.alamat);
  if(hdr.telp) lines.push(hdr.telp);
  lines.push('-------------------------------');
  lines.push(`*${t('CATATAN TRANSAKSI - TEMPO')}*`);
  lines.push(`${t('Pelanggan')}  : ${s.nama}`);
  lines.push(`${t('Jenis')}      : ${t('Tempo (Bayar Nanti)')}`);
  lines.push('-------------------------------');
  lines.push(`*${t('Timbangan Sekarang')}*`);
  newItems.forEach(u=>{
    lines.push(`*${fmtDate(u.tanggal)} — ${u.layananNama} : ${fmtKg(u.qty)} ${u.satuan} x ${rupiah(u.harga)} = ${rupiah(u.subtotal)}*`);
  });
  lines.push('-------------------------------');
  lines.push(`*${t('Rekap Riwayat Transaksi (Belum Ditagih)')}*`);
  lines.push(...extraGroupLinesWA(extras));
  lines.push('-------------------------------');
  lines.push(`*${t('Total Tagihan Berjalan')} : ${rupiah(totalHarga)}*`);
  lines.push(`${t('Sudah Dibayar')} : ${rupiah(s.dp||0)}`);
  lines.push(`${t('Sisa Bayar')}    : ${rupiah(sisaBayar)}`);
  if(lebihBayar>0) lines.push(`${t('Kelebihan Bayar')} : ${rupiah(lebihBayar)} (${t('saldo untuk laundry berikutnya, bukan kembalian')})`);
  lines.push('-------------------------------');
  lines.push(settings.note || t('Terima kasih'));
  lines.push(...notaFooterLinesWA());
  return lines.join('\n');
}
function usageNotaTextWA(usage, s){
  if(isTempo(s)) return tempoUsageNotaTextWA(usage, s);
  const upTo = pemakaianSampai(usage);
  const terpakaiUpTo = upTo.reduce((sum,u)=>sum+u.berat, 0);
  const sisaKg = Math.max(s.kuotaKg - terpakaiUpTo, 0);
  const excessKgQty = Math.max(terpakaiUpTo - s.kuotaKg, 0);
  const { excessCost, extras, extraTotal, totalHarga } = hitungHargaSampai(usage, s, terpakaiUpTo);
  const lines = [];
  const hdr = notaHeaderInfo(s.outletId);
  lines.push(`*${hdr.nama}*`);
  if(hdr.subtitle) lines.push(hdr.subtitle);
  if(hdr.alamat) lines.push(hdr.alamat);
  if(hdr.telp) lines.push(hdr.telp);
  lines.push('-------------------------------');
  lines.push(`*${t('CATATAN TRANSAKSI')}*`);
  lines.push(`${t('Pelanggan')}  : ${s.nama}`);
  lines.push(`${t('Paket')}      : ${s.paketNama}`);
  lines.push(`${t('Periode')}    : ${fmtDate(s.tanggalMulai)} - ${fmtDate(s.tanggalSelesai)}`);
  lines.push('-------------------------------');
  lines.push(`*${t('Timbangan Sekarang')}*`);
  lines.push(`${fmtDate(usage.tanggal)} — ${fmtKg(usage.berat)} kg${usage.catatan ? ' ('+usage.catatan+')' : ''}`);
  lines.push('-------------------------------');
  lines.push(`*${t('Riwayat Timbangan Paket Ini')}*`);
  upTo.forEach((u,i)=>{
    lines.push(`${padNo(i+1)}. ${fmtDate(u.tanggal)} — ${fmtKg(u.berat)} kg`);
  });
  if(extras.length>0){
    lines.push('-------------------------------');
    lines.push(`*${t('Layanan Tambahan (di luar paket)')}*`);
    extras.forEach((u,i)=>{
      lines.push(`${padNo(i+1)}. ${fmtDate(u.tanggal)} — ${u.layananNama} : ${fmtKg(u.qty)} ${u.satuan} x ${rupiah(u.harga)} = ${rupiah(u.subtotal)}`);
    });
  }
  lines.push('-------------------------------');
  lines.push(`*${t('Total Terpakai')} : ${fmtKg(terpakaiUpTo)} / ${fmtKg(s.kuotaKg)} kg*`);
  lines.push(excessKgQty>0 ? `${t('Lebih Kuota')} : ${fmtKg(excessKgQty)} kg` : `${t('Sisa Kuota')} : ${fmtKg(sisaKg)} kg`);
  lines.push('-------------------------------');
  lines.push(`${t('Harga Paket')}      : ${rupiah(s.hargaPaket||0)}`);
  if(excessCost>0) lines.push(`${t('Kelebihan Kuota')}  : ${rupiah(excessCost)}`);
  if(extraTotal>0) lines.push(`${t('Layanan Tambahan')} : ${rupiah(extraTotal)}`);
  lines.push(`*${t('Total Harga Paket')} : ${rupiah(totalHarga)}*`);
  lines.push('-------------------------------');
  lines.push(settings.note || t('Terima kasih'));
  lines.push(...notaFooterLinesWA());
  return lines.join('\n');
}
function sendUsageNotaWA(target){
  const s = subscriptions.find(x=>x.id===currentSubscriptionId);
  if(!s) return;
  if(!s.hp){ showToast(t('No. WhatsApp pelanggan belum diisi')); return; }
  let text;
  if(currentBatchUsageIds){
    const newItems = currentUsageList.filter(u=>currentBatchUsageIds.includes(u.id));
    if(newItems.length===0) return;
    text = tempoBatchUsageNotaTextWA(newItems, s);
  } else {
    const usage = currentUsageList.find(u=>u.id===currentUsageNotaId);
    if(!usage) return;
    text = usageNotaTextWA(usage, s);
  }
  openWA(normalizePhone(s.hp), text, target);
  closeUsageNotaOptions();
}
function buildTempoUsageNotaPDFLines(usage, s){
  const extras = extrasSampai(usage);
  const totalHarga = extras.reduce((sum,u)=>sum+u.subtotal,0);
  const sisaBayar = Math.max(totalHarga - (s.dp||0), 0);
  const lebihBayar = Math.max((s.dp||0) - totalHarga, 0);
  const L = [];
  const div = '--------------------------------';
  const hdr = notaHeaderInfo(s.outletId);
  L.push({t: hdr.nama, c:true, b:true, s:12});
  if(hdr.subtitle) L.push({t: hdr.subtitle, c:true, s:8});
  if(hdr.alamat) L.push({t: hdr.alamat, c:true, s:8});
  if(hdr.telp) L.push({t: hdr.telp, c:true, s:8});
  L.push({t: div, s:9});
  L.push({t:t('CATATAN TRANSAKSI - TEMPO'), c:true, b:true, s:10});
  L.push({t:`${t('Pelanggan')}  : ${s.nama}`, s:9, indent:13});
  L.push({t:`${t('Jenis')}      : ${t('Tempo (Bayar Nanti)')}`, s:9, indent:13});
  L.push({t: div, s:9});
  L.push({t:t('TIMBANGAN SEKARANG'), b:true, s:9});
  L.push({t:`${fmtDate(usage.tanggal)} — ${usage.layananNama} : ${fmtKg(usage.qty)} ${usage.satuan} x ${rupiah(usage.harga)} = ${rupiah(usage.subtotal)}`, b:true, s:11});
  L.push({t: div, s:9});
  L.push({t:t('REKAP RIWAYAT TRANSAKSI (BELUM DITAGIH)'), b:true, s:9});
  L.push(...extraGroupLinesPDF(extras));
  L.push({t: div, s:9});
  L.push({t:`${t('Total Tagihan Berjalan')} : ${rupiah(totalHarga)}`, b:true, s:9});
  L.push({t:`${t('Sudah Dibayar')}          : ${rupiah(s.dp||0)}`, s:9});
  L.push({t:`${t('Sisa Bayar')}             : ${rupiah(sisaBayar)}`, s:9});
  if(lebihBayar>0) L.push({t:`${t('Kelebihan Bayar')}        : ${rupiah(lebihBayar)} (${t('saldo laundry berikutnya')})`, s:8});
  L.push({t: div, s:9});
  L.push({t: settings.note || t('Terima kasih'), c:true, s:8});
  L.push(...notaFooterLinesPDF());
  return L;
}
/* Versi batch dari buildTempoUsageNotaPDFLines() — lihat tempoBatchUsageNotaTextWA(). */
function buildTempoBatchUsageNotaPDFLines(newItems, s){
  const lastDate = newItems.reduce((max,u)=> u.tanggal>max?u.tanggal:max, newItems[0].tanggal);
  const extras = extrasSampai({ tanggal: lastDate });
  const totalHarga = extras.reduce((sum,u)=>sum+u.subtotal,0);
  const sisaBayar = Math.max(totalHarga - (s.dp||0), 0);
  const lebihBayar = Math.max((s.dp||0) - totalHarga, 0);
  const L = [];
  const div = '--------------------------------';
  const hdr = notaHeaderInfo(s.outletId);
  L.push({t: hdr.nama, c:true, b:true, s:12});
  if(hdr.subtitle) L.push({t: hdr.subtitle, c:true, s:8});
  if(hdr.alamat) L.push({t: hdr.alamat, c:true, s:8});
  if(hdr.telp) L.push({t: hdr.telp, c:true, s:8});
  L.push({t: div, s:9});
  L.push({t:t('CATATAN TRANSAKSI - TEMPO'), c:true, b:true, s:10});
  L.push({t:`${t('Pelanggan')}  : ${s.nama}`, s:9, indent:13});
  L.push({t:`${t('Jenis')}      : ${t('Tempo (Bayar Nanti)')}`, s:9, indent:13});
  L.push({t: div, s:9});
  L.push({t:t('TIMBANGAN SEKARANG'), b:true, s:9});
  newItems.forEach(u=>{
    L.push({t:`${fmtDate(u.tanggal)} — ${u.layananNama} : ${fmtKg(u.qty)} ${u.satuan} x ${rupiah(u.harga)} = ${rupiah(u.subtotal)}`, b:true, s:11});
  });
  L.push({t: div, s:9});
  L.push({t:t('REKAP RIWAYAT TRANSAKSI (BELUM DITAGIH)'), b:true, s:9});
  L.push(...extraGroupLinesPDF(extras));
  L.push({t: div, s:9});
  L.push({t:`${t('Total Tagihan Berjalan')} : ${rupiah(totalHarga)}`, b:true, s:9});
  L.push({t:`${t('Sudah Dibayar')}          : ${rupiah(s.dp||0)}`, s:9});
  L.push({t:`${t('Sisa Bayar')}             : ${rupiah(sisaBayar)}`, s:9});
  if(lebihBayar>0) L.push({t:`${t('Kelebihan Bayar')}        : ${rupiah(lebihBayar)} (${t('saldo laundry berikutnya')})`, s:8});
  L.push({t: div, s:9});
  L.push({t: settings.note || t('Terima kasih'), c:true, s:8});
  L.push(...notaFooterLinesPDF());
  return L;
}
function buildUsageNotaPDFLines(usage, s){
  if(isTempo(s)) return buildTempoUsageNotaPDFLines(usage, s);
  const upTo = pemakaianSampai(usage);
  const terpakaiUpTo = upTo.reduce((sum,u)=>sum+u.berat, 0);
  const L = [];
  const div = '--------------------------------';
  const sisaKg = Math.max(s.kuotaKg - terpakaiUpTo, 0);
  const excessKgQty = Math.max(terpakaiUpTo - s.kuotaKg, 0);
  const { excessCost, extras, extraTotal, totalHarga } = hitungHargaSampai(usage, s, terpakaiUpTo);
  const hdr = notaHeaderInfo(s.outletId);
  L.push({t: hdr.nama, c:true, b:true, s:12});
  if(hdr.subtitle) L.push({t: hdr.subtitle, c:true, s:8});
  if(hdr.alamat) L.push({t: hdr.alamat, c:true, s:8});
  if(hdr.telp) L.push({t: hdr.telp, c:true, s:8});
  L.push({t: div, s:9});
  L.push({t:t('CATATAN TRANSAKSI'), c:true, b:true, s:10});
  L.push({t:`${t('Pelanggan')}  : ${s.nama}`, s:9, indent:13});
  L.push({t:`${t('Paket')}      : ${s.paketNama}`, s:9, indent:13});
  L.push({t:`${t('Periode')}    : ${fmtDate(s.tanggalMulai)} - ${fmtDate(s.tanggalSelesai)}`, s:9, indent:13});
  L.push({t: div, s:9});
  L.push({t:t('TIMBANGAN SEKARANG'), b:true, s:9});
  L.push({t:`${fmtDate(usage.tanggal)} — ${fmtKg(usage.berat)} kg${usage.catatan ? ' ('+usage.catatan+')' : ''}`, s:9});
  L.push({t: div, s:9});
  L.push({t:t('RIWAYAT TIMBANGAN PAKET INI'), b:true, s:9});
  upTo.forEach((u,i)=>{
    L.push({t:`${padNo(i+1)}. ${fmtDate(u.tanggal)} — ${fmtKg(u.berat)} kg`, s:8, indent:4});
  });
  if(extras.length>0){
    L.push({t: div, s:9});
    L.push({t:t('LAYANAN TAMBAHAN (di luar paket)'), b:true, s:9});
    extras.forEach((u,i)=>{
      L.push({t:`${padNo(i+1)}. ${fmtDate(u.tanggal)} — ${u.layananNama} : ${fmtKg(u.qty)} ${u.satuan} x ${rupiah(u.harga)} = ${rupiah(u.subtotal)}`, s:8, indent:4});
    });
  }
  L.push({t: div, s:9});
  L.push({t:`${t('Total Terpakai')} : ${fmtKg(terpakaiUpTo)} / ${fmtKg(s.kuotaKg)} kg`, b:true, s:9});
  L.push({t: excessKgQty>0 ? `${t('Lebih Kuota')}    : ${fmtKg(excessKgQty)} kg` : `${t('Sisa Kuota')}     : ${fmtKg(sisaKg)} kg`, s:9});
  L.push({t: div, s:9});
  L.push({t:`${t('Harga Paket')}      : ${rupiah(s.hargaPaket||0)}`, s:9, indent:19});
  if(excessCost>0) L.push({t:`${t('Kelebihan Kuota')}  : ${rupiah(excessCost)}`, s:9, indent:19});
  if(extraTotal>0) L.push({t:`${t('Layanan Tambahan')} : ${rupiah(extraTotal)}`, s:9, indent:19});
  L.push({t:`${t('Total Harga Paket')} : ${rupiah(totalHarga)}`, b:true, s:9, indent:20});
  L.push({t: div, s:9});
  L.push({t: settings.note || t('Terima kasih'), c:true, s:8});
  L.push(...notaFooterLinesPDF());
  return L;
}
/* ===================== RENDER NOTA JADI GAMBAR (JPG) =====================
   Semua nota (timbangan & transaksi biasa) dirender lewat Canvas lalu diekspor
   sebagai JPG, menggantikan versi PDF sebelumnya. Baris berlabel (indent:N)
   membuat baris lanjutannya sejajar di bawah teks nilainya, bukan mepet ke kiri. */
function loadImageEl(src){
  return new Promise((resolve, reject)=>{
    const img = new Image();
    img.onload = ()=> resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
/* Ikon lencana WhatsApp (bubble hijau + gagang telepon, dengan "ekor" biar
   kebaca sebagai bubble chat, bukan sekadar telepon) & Gmail (amplop putih +
   garis lipatan merah) — satu sumber path dipakai bareng untuk versi HTML
   (SVG, di nota tampilan app) & versi canvas (nota JPG/PDF), supaya
   bentuknya identik. Semua koordinat dalam ruang 24x24. */
const ICON_WA_SQUARE = { x:0.5, y:0.5, w:23, h:23, rx:5.4 };
const ICON_WA_RING = { cx:12, cy:12, rOuter:7.3, rInner:5.6 };
const ICON_WA_TAIL_PATH = 'M8.6 17.9 C7.7 19.4 5.9 20.7 4 21.4 C6.3 21.1 8.5 20.1 10 18.6 Z';
const ICON_WA_PHONE_PATH = 'M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z';
const ICON_WA_PHONE_XF = { tx:6.48, ty:6.48, scale:0.46 };
const ICON_EMAIL_BODY = { x:2, y:5, w:20, h:14 };
const ICON_EMAIL_FLAP_PATH = 'M3 6.5 L12 14.5 L21 6.5';
function iconBadgeSVG(kind){
  if(kind==='wa'){
    return `<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="${ICON_WA_SQUARE.x}" y="${ICON_WA_SQUARE.y}" width="${ICON_WA_SQUARE.w}" height="${ICON_WA_SQUARE.h}" rx="${ICON_WA_SQUARE.rx}" fill="#25D366"/>
      <path d="${ICON_WA_TAIL_PATH}" fill="#fff"/>
      <circle cx="${ICON_WA_RING.cx}" cy="${ICON_WA_RING.cy}" r="${ICON_WA_RING.rOuter}" fill="#fff"/>
      <circle cx="${ICON_WA_RING.cx}" cy="${ICON_WA_RING.cy}" r="${ICON_WA_RING.rInner}" fill="#25D366"/>
      <g transform="translate(${ICON_WA_PHONE_XF.tx} ${ICON_WA_PHONE_XF.ty}) scale(${ICON_WA_PHONE_XF.scale})">
        <path d="${ICON_WA_PHONE_PATH}" fill="#fff"/>
      </g>
    </svg>`;
  }
  return `<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
    <rect x="${ICON_EMAIL_BODY.x}" y="${ICON_EMAIL_BODY.y}" width="${ICON_EMAIL_BODY.w}" height="${ICON_EMAIL_BODY.h}" rx="2" fill="#F1F3F4" stroke="#BDC1C6" stroke-width="1.8"/>
    <path d="${ICON_EMAIL_FLAP_PATH}" fill="none" stroke="#EA4335" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}
function drawIconBadgeOnCanvas(ctx, kind, left, top, size){
  ctx.save();
  ctx.translate(left, top);
  ctx.scale(size/24, size/24);
  if(kind==='wa'){
    ctx.fillStyle = '#25D366';
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(ICON_WA_SQUARE.x, ICON_WA_SQUARE.y, ICON_WA_SQUARE.w, ICON_WA_SQUARE.h, ICON_WA_SQUARE.rx) : ctx.rect(ICON_WA_SQUARE.x, ICON_WA_SQUARE.y, ICON_WA_SQUARE.w, ICON_WA_SQUARE.h);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fill(new Path2D(ICON_WA_TAIL_PATH));
    ctx.beginPath(); ctx.arc(ICON_WA_RING.cx, ICON_WA_RING.cy, ICON_WA_RING.rOuter, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#25D366';
    ctx.beginPath(); ctx.arc(ICON_WA_RING.cx, ICON_WA_RING.cy, ICON_WA_RING.rInner, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.save();
    ctx.translate(ICON_WA_PHONE_XF.tx, ICON_WA_PHONE_XF.ty);
    ctx.scale(ICON_WA_PHONE_XF.scale, ICON_WA_PHONE_XF.scale);
    ctx.fill(new Path2D(ICON_WA_PHONE_PATH));
    ctx.restore();
  } else {
    ctx.fillStyle = '#F1F3F4';
    ctx.strokeStyle = '#BDC1C6'; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.rect(ICON_EMAIL_BODY.x, ICON_EMAIL_BODY.y, ICON_EMAIL_BODY.w, ICON_EMAIL_BODY.h);
    ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#EA4335'; ctx.lineWidth = 2.8; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.stroke(new Path2D(ICON_EMAIL_FLAP_PATH));
  }
  ctx.restore();
}
function wrapCanvasLines(ctx, lines, usableWidthPx, ptToPx){
  const wrapped = [];
  const wrapOne = (text, maxWidth)=>{
    const words = String(text).split(' ');
    const out = [];
    let cur = '';
    words.forEach(w=>{
      const test = cur ? cur+' '+w : w;
      if(ctx.measureText(test).width > maxWidth && cur){ out.push(cur); cur = w; }
      else cur = test;
    });
    out.push(cur);
    return out;
  };
  lines.forEach(line=>{
    const px = Math.round(ptToPx(line.s||9));
    ctx.font = `${line.it?'italic ':''}${line.b?'bold ':''}${px}px 'Courier New', monospace`;
    if(line.indent){
      const prefix = String(line.t).slice(0, line.indent);
      const rest = String(line.t).slice(line.indent);
      const prefixWidth = ctx.measureText(prefix).width;
      const pieces = wrapOne(rest, Math.max(usableWidthPx - prefixWidth, 20));
      pieces.forEach((p,i)=> wrapped.push({ t: i===0?prefix+p:p, b:line.b, it:line.it, s:line.s, c:line.c, icon: i===0?line.icon:undefined, indentPx: i===0?0:prefixWidth }));
    } else {
      const pieces = wrapOne(String(line.t), usableWidthPx);
      pieces.forEach((p,i)=> wrapped.push({ t:p, b:line.b, it:line.it, s:line.s, c:line.c, icon: i===0?line.icon:undefined, indentPx:0 }));
    }
  });
  return wrapped;
}
async function buildNotaCanvas(lines, pageWidthMm){
  const SCALE = 8; // px per mm — cukup tajam untuk dibagikan lewat WhatsApp
  const mmToPx = mm => mm*SCALE;
  const ptToPx = pt => pt*0.3528*SCALE;
  const widthPx = Math.round(mmToPx(pageWidthMm));
  const marginX = mmToPx(4), marginY = mmToPx(8), lh = mmToPx(4.6), logoSize = mmToPx(16);
  const usableWidthPx = widthPx - marginX*2;

  const measureCtx = document.createElement('canvas').getContext('2d');
  const wrapped = wrapCanvasLines(measureCtx, lines, usableWidthPx, ptToPx);

  const heightPx = Math.max(Math.round(wrapped.length*lh + marginY*2 + logoSize + mmToPx(4)), Math.round(mmToPx(40)));
  const canvas = document.createElement('canvas');
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000000';
  ctx.textBaseline = 'alphabetic';

  const centerX = widthPx/2;
  let y = marginY;
  try{
    const img = await loadImageEl(shopLogoSrc());
    ctx.save();
    ctx.beginPath();
    ctx.arc(centerX, y + logoSize/2, logoSize/2, 0, Math.PI*2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(img, centerX - logoSize/2, y, logoSize, logoSize);
    ctx.restore();
    y += logoSize + mmToPx(3);
  }catch(e){ /* lanjut tanpa logo kalau gagal dimuat */ }

  wrapped.forEach(line=>{
    const px = Math.round(ptToPx(line.s||9));
    ctx.font = `${line.it?'italic ':''}${line.b?'bold ':''}${px}px 'Courier New', monospace`;
    y += lh*0.72;
    if(line.icon){
      /* Lencana WA (bubble hijau + gagang telepon) / Gmail (amplop + flap merah)
         digambar langsung sebagai vektor lewat drawIconBadgeOnCanvas() — bukan
         emoji/glyph font — supaya bentuk & warnanya selalu konsisten dan benar-benar
         kebaca sebagai WhatsApp/Gmail di semua perangkat. */
      const textW = ctx.measureText(line.t).width;
      const d = px*1.5, gap = mmToPx(1.3);
      const totalW = d + gap + textW;
      const startX = line.c ? (centerX - totalW/2) : (marginX + (line.indentPx||0));
      drawIconBadgeOnCanvas(ctx, line.icon, startX, y - px*0.9, d);
      ctx.fillStyle = '#000000';
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      ctx.fillText(line.t, startX + d + gap, y);
    } else if(line.c){
      const w = ctx.measureText(line.t).width;
      ctx.fillText(line.t, centerX - w/2, y);
    } else {
      ctx.fillText(line.t, marginX + (line.indentPx||0), y);
    }
    y += lh*0.28;
  });

  return canvas;
}
async function shareOrDownloadNotaImage(lines, filenameBase, pageWidthMm, shareTitle){
  const canvas = await buildNotaCanvas(lines, pageWidthMm);
  const filename = `${filenameBase}.jpg`;
  const blob = await new Promise(resolve=> canvas.toBlob(resolve, 'image/jpeg', 0.92));
  if(!blob){ showToast(t('Gagal membuat gambar nota')); return; }
  try{
    const file = new File([blob], filename, { type:'image/jpeg' });
    if(navigator.canShare && navigator.canShare({ files:[file] })){
      await navigator.share({ files:[file], title: filename, text: shareTitle||'' });
      return;
    }
  }catch(e){ /* dibatalkan atau tidak didukung, lanjut unduh biasa */ }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(()=> URL.revokeObjectURL(url), 5000);
  showToast(t('Gambar nota diunduh. Buka WhatsApp/WhatsApp Business lalu lampirkan dari folder Download.'));
}
/* ===================== CETAK BLUETOOTH (PRINTER THERMAL) =====================
   Pakai Web Bluetooth API (Chrome Android/desktop — TIDAK didukung Safari/iOS)
   untuk mengirim nota langsung ke printer thermal 58mm/80mm lewat ESC/POS raw
   text, tanpa app tambahan. Sama seperti buildNotaCanvas(), sumbernya array
   `lines` yang sama dipakai versi PDF/JPG (t/c/b/s per baris) — supaya semua
   format nota (WA, PDF, JPG, Bluetooth) selalu konsisten kontennya. */
var btPrinterDevice = null;
var btPrinterServer = null;
var btPrinterChar = null;
/* UUID service yang umum dipakai printer thermal Bluetooth murah (BLE UART-like:
   ISSC/Microchip transparent UART, dan beberapa varian generic printer service).
   Web Bluetooth cuma boleh mengakses service yang disebut di sini — printer
   dengan UUID lain tidak akan ketemu karakteristik tulisnya. */
var BT_PRINTER_SERVICE_UUIDS = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2'
];
function isBluetoothPrintSupported(){
  return !!(navigator.bluetooth && navigator.bluetooth.requestDevice);
}
function renderBtPrinterStatus(){
  const el = document.getElementById('btPrinterStatus');
  if(!el) return;
  if(btPrinterDevice && btPrinterServer && btPrinterServer.connected){
    el.textContent = `${t('Tersambung:')} ${btPrinterDevice.name || t('(tanpa nama)')}`;
  } else if(!isBluetoothPrintSupported()){
    el.textContent = t('Browser ini belum mendukung Bluetooth Web — pakai Chrome di Android/laptop');
  } else {
    el.textContent = t('Belum tersambung');
  }
}
/* Printer thermal murah umumnya cuma bisa cetak ASCII/CP437, jadi emoji &
   simbol unicode di nota (—, •, ✓, 🟢, 📧, dst.) diganti/dibuang dulu supaya
   tidak keluar sebagai karakter acak di kertas. */
function sanitizeForThermal(s){
  if(!s) return '';
  return String(s)
    .replace(/[—–]/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/•/g, '-')
    .replace(/✓/g, 'v')
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}️]/gu, '')
    .replace(/[^\x00-\x7E]/g, '')
    .trim();
}
function concatBytes(chunks){
  let total = 0;
  chunks.forEach(c=>{ total += c.length; });
  const out = new Uint8Array(total);
  let offset = 0;
  chunks.forEach(c=>{ out.set(c, offset); offset += c.length; });
  return out;
}
/* Ubah array `lines` (format yang sama dipakai buildReceiptPDFLines() dkk.)
   jadi perintah mentah ESC/POS: ESC @ (init), ESC a (rata tengah/kiri),
   ESC E (tebal), GS ! (ukuran huruf), lalu teksnya + line feed per baris. */
function escposBytesFromLines(lines){
  const enc = new TextEncoder();
  const chunks = [ new Uint8Array([0x1B,0x40]) ]; // ESC @ — reset printer
  let curAlign = -1, curBold = -1, curSize = -1;
  lines.forEach(line=>{
    const align = line.c ? 1 : 0;
    const bold = line.b ? 1 : 0;
    const size = (line.s>=12) ? 0x11 : (line.s>=10 ? 0x01 : 0x00); // 0x11=lebar+tinggi 2x, 0x01=tinggi 2x, 0x00=normal
    if(align!==curAlign){ chunks.push(new Uint8Array([0x1B,0x61,align])); curAlign=align; }
    if(bold!==curBold){ chunks.push(new Uint8Array([0x1B,0x45,bold])); curBold=bold; }
    if(size!==curSize){ chunks.push(new Uint8Array([0x1D,0x21,size])); curSize=size; }
    chunks.push(enc.encode(sanitizeForThermal(line.t)));
    chunks.push(new Uint8Array([0x0A]));
  });
  chunks.push(new Uint8Array([0x1B,0x45,0x00])); // tebal off
  chunks.push(new Uint8Array([0x1D,0x21,0x00])); // ukuran normal
  chunks.push(new Uint8Array([0x1B,0x61,0x00])); // rata kiri
  chunks.push(new Uint8Array([0x0A,0x0A,0x0A])); // spasi buat sobek kertas
  return concatBytes(chunks);
}
async function connectBluetoothPrinter(){
  if(!isBluetoothPrintSupported()){
    showToast(t('Bluetooth Web tidak didukung di browser/perangkat ini — pakai Chrome di Android/laptop'));
    return false;
  }
  try{
    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: BT_PRINTER_SERVICE_UUIDS
    });
    const server = await device.gatt.connect();
    let writeChar = null;
    for(const uuid of BT_PRINTER_SERVICE_UUIDS){
      try{
        const service = await server.getPrimaryService(uuid);
        const chars = await service.getCharacteristics();
        writeChar = chars.find(c=>c.properties.write || c.properties.writeWithoutResponse) || null;
        if(writeChar) break;
      }catch(e){ /* printer ini tidak punya service ini, coba UUID berikutnya */ }
    }
    if(!writeChar){
      showToast(t('Printer tersambung tapi tidak ditemukan layanan cetak yang cocok — coba merek/model printer lain'));
      try{ device.gatt.disconnect(); }catch(e){}
      renderBtPrinterStatus();
      return false;
    }
    btPrinterDevice = device; btPrinterServer = server; btPrinterChar = writeChar;
    device.addEventListener('gattserverdisconnected', ()=>{
      btPrinterServer = null; btPrinterChar = null;
      renderBtPrinterStatus();
    });
    showToast(`${t('Printer')} "${device.name||''}" ${t('tersambung')}`);
    renderBtPrinterStatus();
    return true;
  }catch(e){
    renderBtPrinterStatus();
    if(e && e.name==='NotFoundError') return false; // dibatalkan user, tidak perlu toast error
    showToast(t('Gagal menyambungkan printer:') + ' ' + (e && e.message ? e.message : t('coba lagi')));
    return false;
  }
}
function disconnectBluetoothPrinter(){
  try{ if(btPrinterDevice && btPrinterDevice.gatt && btPrinterDevice.gatt.connected) btPrinterDevice.gatt.disconnect(); }catch(e){}
  btPrinterDevice = null; btPrinterServer = null; btPrinterChar = null;
  renderBtPrinterStatus();
}
async function printLinesViaBluetooth(lines){
  if(!btPrinterChar || !btPrinterServer || !btPrinterServer.connected){
    const ok = await connectBluetoothPrinter();
    if(!ok) return false;
  }
  try{
    const bytes = escposBytesFromLines(lines);
    const CHUNK = 180; // kirim per potongan kecil, sesuai batas paket BLE khas
    for(let i=0;i<bytes.length;i+=CHUNK){
      const chunk = bytes.slice(i, i+CHUNK);
      if(btPrinterChar.properties.writeWithoutResponse){
        await btPrinterChar.writeValueWithoutResponse(chunk);
      } else {
        await btPrinterChar.writeValue(chunk);
      }
      await new Promise(r=>setTimeout(r, 25));
    }
    showToast(t('Nota dikirim ke printer'));
    return true;
  }catch(e){
    showToast(t('Gagal mencetak — coba sambungkan ulang printernya'));
    btPrinterServer = null; btPrinterChar = null;
    renderBtPrinterStatus();
    return false;
  }
}
async function printReceiptBluetooth(){
  const trx = transactions.find(t=>t.id===notaShareTrxId);
  if(!trx){ showToast(t('Nota tidak ditemukan')); return; }
  await printLinesViaBluetooth(buildReceiptPDFLines(trx));
}
async function printSubsInvoiceBluetooth(){
  const s = subscriptions.find(x=>x.id===currentSubscriptionId);
  if(!s) return;
  await printLinesViaBluetooth(buildSubsInvoicePDFLines(s));
}
async function printUsageNotaBluetooth(){
  const s = subscriptions.find(x=>x.id===currentSubscriptionId);
  if(!s) return;
  let lines;
  if(currentBatchUsageIds){
    const newItems = currentUsageList.filter(u=>currentBatchUsageIds.includes(u.id));
    if(newItems.length===0) return;
    lines = buildTempoBatchUsageNotaPDFLines(newItems, s);
  } else {
    const usage = currentUsageList.find(u=>u.id===currentUsageNotaId);
    if(!usage) return;
    lines = buildUsageNotaPDFLines(usage, s);
  }
  await printLinesViaBluetooth(lines);
}
/* ===================== CETAK VIA BROWSER (AirPrint/printer lain) =====================
   Web Bluetooth TIDAK didukung Safari/iOS sama sekali, jadi ini jalur cetak
   cadangan yang jalan di semua browser: render nota sebagai HTML sederhana ke
   #printArea lalu panggil window.print() bawaan browser. Di iPhone, dialog
   cetak Safari otomatis menampilkan printer AirPrint yang ada di jaringan yang
   sama — cocok untuk printer thermal yang mendukung WiFi/AirPrint, bukan cuma
   Bluetooth. Pakai array `lines` yang sama dengan versi PDF/JPG/Bluetooth
   supaya isinya tetap konsisten di semua format. */
function linesToPrintHTML(lines){
  return lines.map(line=>{
    const align = line.c ? 'center' : 'left';
    const weight = line.b ? '800' : '400';
    const fontStyle = line.it ? 'italic' : 'normal';
    const size = (line.s>=12) ? '15px' : (line.s>=10 ? '13px' : '11.5px');
    return `<div style="text-align:${align};font-weight:${weight};font-style:${fontStyle};font-size:${size};white-space:pre-wrap;">${escapeHTML(line.t)}</div>`;
  }).join('');
}
function printLinesViaBrowser(lines){
  document.getElementById('printArea').innerHTML = `<div style="max-width:340px;margin:0 auto;font-family:'Space Mono',monospace;padding:20px;">${linesToPrintHTML(lines)}</div>`;
  window.print();
}
function printReceiptViaBrowser(){
  const trx = transactions.find(t=>t.id===notaShareTrxId);
  if(!trx){ showToast(t('Nota tidak ditemukan')); return; }
  printLinesViaBrowser(buildReceiptPDFLines(trx));
}
function printSubsInvoiceViaBrowser(){
  const s = subscriptions.find(x=>x.id===currentSubscriptionId);
  if(!s) return;
  printLinesViaBrowser(buildSubsInvoicePDFLines(s));
}
function printUsageNotaViaBrowser(){
  const s = subscriptions.find(x=>x.id===currentSubscriptionId);
  if(!s) return;
  let lines;
  if(currentBatchUsageIds){
    const newItems = currentUsageList.filter(u=>currentBatchUsageIds.includes(u.id));
    if(newItems.length===0) return;
    lines = buildTempoBatchUsageNotaPDFLines(newItems, s);
  } else {
    const usage = currentUsageList.find(u=>u.id===currentUsageNotaId);
    if(!usage) return;
    lines = buildUsageNotaPDFLines(usage, s);
  }
  printLinesViaBrowser(lines);
}
async function downloadUsageNotaImage(){
  const s = subscriptions.find(x=>x.id===currentSubscriptionId);
  if(!s) return;
  let lines, tanggalForName;
  if(currentBatchUsageIds){
    const newItems = currentUsageList.filter(u=>currentBatchUsageIds.includes(u.id));
    if(newItems.length===0) return;
    lines = buildTempoBatchUsageNotaPDFLines(newItems, s);
    tanggalForName = newItems[0].tanggal;
  } else {
    const usage = currentUsageList.find(u=>u.id===currentUsageNotaId);
    if(!usage) return;
    lines = buildUsageNotaPDFLines(usage, s);
    tanggalForName = usage.tanggal;
  }
  const tempo = isTempo(s);
  const filenameBase = `${tempo ? 'Nota-Transaksi' : 'Nota-Timbangan'}-${tanggalForName}-${(s.nama||t('pelanggan')).replace(/\s+/g,'-')}`;
  await shareOrDownloadNotaImage(lines, filenameBase, 80, `${tempo ? t('Nota transaksi laundry') : t('Nota timbangan laundry')} - ${s.nama}`);
  closeUsageNotaOptions();
}
function nextKode(){
  const n = transactions.length + 1;
  return 'LND-' + String(n).padStart(4,'0');
}

