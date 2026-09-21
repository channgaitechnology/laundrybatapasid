/* ===================== REKAP TRANSAKSI PELANGGAN =====================
   Kalkulator penjumlah transaksi REGULER (tabel transactions) satu
   pelanggan lintas tanggal berbeda, dengan rincian per transaksi -- mirip
   konsep Tempo (list bertanggal + total berjalan), tapi untuk pelanggan
   biasa yang sering laundry namun tidak didaftarkan sebagai Paket/Tempo.
   Dicocokkan berdasarkan NAMA saja (persis, case-insensitive), bukan nama+HP.
   User bisa mencentang/menghilangkan centang transaksi mana saja yang mau
   ikut dijumlahkan & dikirim -- defaultnya semua yang ditemukan tercentang.
   Kalau nama belum punya transaksi sama sekali (atau kurang lengkap), bisa
   langsung tambah transaksi baru dari sini -- lewat form Transaksi Baru asli
   (submitTransaction()), jadi datanya benar-benar masuk sebagai transaksi
   normal ke database & Laporan, bukan cuma tersimpan lokal di rekap ini. */
var rekapPelangganNama = '';
var rekapPelangganList = [];
var rekapSelectedIds = new Set();
var rekapNamaSuggestions = [];
var rekapReturnPending = false;

function openRekapPelanggan(){
  rekapPelangganNama = '';
  rekapPelangganList = [];
  rekapSelectedIds = new Set();
  rekapReturnPending = false;
  document.getElementById('rekapNamaInput').value = '';
  document.getElementById('rekapNamaSuggestBox').classList.remove('show');
  document.getElementById('rekapSearchStep').style.display = 'block';
  document.getElementById('rekapResultStep').style.display = 'none';
  document.getElementById('rekapPelangganModal').classList.add('show');
  setTimeout(()=>document.getElementById('rekapNamaInput').focus(), 100);
}
function closeRekapPelanggan(){
  document.getElementById('rekapPelangganModal').classList.remove('show');
}
function backToRekapSearch(){
  document.getElementById('rekapSearchStep').style.display = 'block';
  document.getElementById('rekapResultStep').style.display = 'none';
}
/* Saran nama diambil dari nama-nama unik yang SUDAH PERNAH bertransaksi
   (bukan dari kontak tersimpan) -- lebih relevan karena tujuan fitur ini
   memang mencari pelanggan yang riwayat transaksinya mau dijumlahkan. */
function showRekapNamaSuggest(){
  const val = document.getElementById('rekapNamaInput').value.trim().toLowerCase();
  const box = document.getElementById('rekapNamaSuggestBox');
  if(!val){ box.classList.remove('show'); box.innerHTML=''; rekapNamaSuggestions=[]; return; }
  rekapNamaSuggestions = [...new Set(visibleTransactions().map(t=>t.nama))]
    .filter(n=>n.toLowerCase().includes(val)).slice(0,8);
  if(rekapNamaSuggestions.length===0){ box.classList.remove('show'); box.innerHTML=''; return; }
  box.innerHTML = rekapNamaSuggestions.map((n,i)=>`
    <div class="suggest-item" onmousedown="event.preventDefault();selectRekapNamaSuggest(${i})">${escapeHTML(n)}</div>`).join('');
  box.classList.add('show');
}
function hideRekapNamaSuggestDelayed(){
  setTimeout(()=>{ const b=document.getElementById('rekapNamaSuggestBox'); if(b) b.classList.remove('show'); }, 150);
}
function selectRekapNamaSuggest(i){
  const nama = rekapNamaSuggestions[i];
  if(nama===undefined) return;
  document.getElementById('rekapNamaInput').value = nama;
  document.getElementById('rekapNamaSuggestBox').classList.remove('show');
  searchRekapPelanggan();
}
/* Nama yang belum punya transaksi sama sekali TETAP ditampilkan sebagai hasil
   (list kosong + tombol Tambah Transaksi Baru), bukan cuma toast lalu berhenti
   -- supaya nama yang datanya belum ada di database bisa langsung diisi dari sini. */
function searchRekapPelanggan(){
  const nama = document.getElementById('rekapNamaInput').value.trim();
  if(!nama){ showToast(t('Isi nama pelanggan dulu')); return; }
  const list = sortByTanggalAsc(visibleTransactions().filter(x=>x.nama.trim().toLowerCase()===nama.toLowerCase()));
  rekapPelangganNama = nama;
  rekapPelangganList = list;
  rekapSelectedIds = new Set(list.map(x=>x.id)); // default: semua tercentang
  renderRekapPelangganResult();
}
function rekapSelectedList(){
  return rekapPelangganList.filter(x=>rekapSelectedIds.has(x.id));
}
function rekapPelangganTotals(){
  const selected = rekapSelectedList();
  const totalKeseluruhan = selected.reduce((s,x)=>s+x.total,0);
  const sudahDibayar = selected.reduce((s,x)=>s+trxCashReceived(x),0);
  const belumDibayar = Math.max(totalKeseluruhan - sudahDibayar, 0);
  return { totalKeseluruhan, sudahDibayar, belumDibayar };
}
/* No. WA diambil dari SELURUH transaksi yang ditemukan (bukan cuma yang
   tercentang -- nomornya tetap sama siapa pun pelanggannya, tidak tergantung
   pilihan centang), yang kolom hp-nya terisi, paling baru duluan. Tidak
   bergantung pada data kontak terpisah, supaya tetap jalan meski kontaknya
   tidak pernah diimpor. Kosong kalau memang belum pernah diisi di transaksi
   manapun (dipakai untuk "nomor WA jika ada" di keterangan atas nota). */
function rekapPelangganPhone(){
  const hpMatch = rekapPelangganList.slice().reverse().find(x=>x.hp);
  return hpMatch ? hpMatch.hp : '';
}
/* Periode = rentang tanggal transaksi yang TERCENTANG (yang benar-benar ikut
   nota), dari yang paling lama sampai paling baru. list sudah terurut
   ascending (lihat searchRekapPelanggan()/sortByTanggalAsc()). */
function rekapPelangganPeriode(selected){
  if(selected.length===0) return '';
  const awal = selected[0].tanggal, akhir = selected[selected.length-1].tanggal;
  return awal===akhir ? fmtDate(awal) : `${fmtDate(awal)} - ${fmtDate(akhir)}`;
}
function toggleRekapTrxSelect(id, checked){
  if(checked) rekapSelectedIds.add(id); else rekapSelectedIds.delete(id);
  renderRekapPelangganResult();
}
function selectAllRekapTrx(){
  rekapSelectedIds = new Set(rekapPelangganList.map(x=>x.id));
  renderRekapPelangganResult();
}
function deselectAllRekapTrx(){
  rekapSelectedIds = new Set();
  renderRekapPelangganResult();
}
function renderRekapPelangganResult(){
  document.getElementById('rekapSearchStep').style.display = 'none';
  document.getElementById('rekapResultStep').style.display = 'block';
  document.getElementById('rekapResultNama').textContent = rekapPelangganNama;
  const selected = rekapSelectedList();
  const { totalKeseluruhan, sudahDibayar, belumDibayar } = rekapPelangganTotals();
  document.getElementById('rekapStTrx').textContent = selected.length;
  document.getElementById('rekapStTotal').textContent = rupiah(totalKeseluruhan);
  document.getElementById('rekapStLunas').textContent = rupiah(sudahDibayar);
  document.getElementById('rekapStBelum').textContent = rupiah(belumDibayar);

  const selectControls = document.getElementById('rekapSelectControls');
  if(rekapPelangganList.length===0){
    document.getElementById('rekapSelectHint').textContent = '';
    selectControls.style.display = 'none';
    document.getElementById('rekapList').innerHTML = `<div class="empty">
      <svg class="bubble-icon" viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="21" stroke="#146C8E" stroke-width="2" opacity="0.4"/></svg>
      <h3>${t('Belum ada transaksi untuk nama ini')}</h3>
      <p>${t('Tekan "Tambah Transaksi Baru" untuk mulai mencatat.')}</p>
    </div>`;
    return;
  }
  selectControls.style.display = 'flex';
  document.getElementById('rekapSelectHint').textContent =
    `${selected.length} ${t('dari')} ${rekapPelangganList.length} ${t('transaksi yang ditemukan dipilih')}`;
  document.getElementById('rekapList').innerHTML = rekapPelangganList.map(trx=>{
    const checked = rekapSelectedIds.has(trx.id);
    return `
    <div class="trx-card" style="${checked ? '' : 'opacity:0.5;'}">
      <div class="trx-top">
        <label style="display:flex;align-items:center;gap:10px;cursor:pointer;">
          <input type="checkbox" ${checked ? 'checked' : ''} onchange="toggleRekapTrxSelect('${trx.id}', this.checked)" style="width:19px;height:19px;flex:none;">
          <div>
            <div class="trx-name">${fmtDate(trx.tanggal)}</div>
            <div class="kode">${trx.kode} · ${trx.items.length} ${currentLang==='en' ? (trx.items.length===1?'service':'services') : t('layanan')}</div>
          </div>
        </label>
        <span class="badge ${trx.status==='lunas'?'badge-lunas':'badge-belum'}">${trx.status==='lunas'?t('Lunas'):t('Belum Lunas')}</span>
      </div>
      <div class="trx-total">${rupiah(trx.total)}</div>
      <div class="trx-actions">
        <button class="btn btn-outline btn-sm" onclick="openReceipt('${trx.id}')">${t('Nota')}</button>
      </div>
    </div>`;
  }).join('');
}

/* Buka form Transaksi Baru asli (pre-diisi nama+HP pelanggan ini) supaya data
   yang baru dicatat benar-benar tersimpan sebagai transaksi normal lewat
   submitTransaction() -- termasuk nomor nota, penandaan outlet, dsb, persis
   sama seperti input manual biasa. rekapReturnPending menandai bahwa begitu
   transaksi ini berhasil disimpan, kita harus balik lagi ke Rekap dan
   menyegarkan pencariannya (lihat submitTransaction() di 12-transaksi.js). */
function startRekapAddTransaction(){
  document.getElementById('inNama').value = rekapPelangganNama;
  document.getElementById('inHP').value = rekapPelangganPhone();
  rekapReturnPending = true;
  closeRekapPelanggan();
  switchTab('baru');
  showToast(t('Nama sudah diisi otomatis -- lengkapi layanan lalu simpan seperti biasa'));
}
/* Dipanggil dari submitTransaction() setelah transaksi baru berhasil
   disimpan, kalau tadi datang dari startRekapAddTransaction(). */
function reopenRekapPelangganAfterAdd(){
  document.getElementById('rekapNamaInput').value = rekapPelangganNama;
  document.getElementById('rekapPelangganModal').classList.add('show');
  searchRekapPelanggan();
}

/* ===== Nota rekap (teks WA / lines PDF-JPG-Bluetooth), gaya sama dengan nota lain -- HANYA transaksi yang tercentang ===== */
function rekapPelangganTextWA(){
  const selected = rekapSelectedList();
  const { totalKeseluruhan, sudahDibayar, belumDibayar } = rekapPelangganTotals();
  const phone = rekapPelangganPhone();
  const lines = [];
  const hdr = notaHeaderInfo(currentOutletId);
  lines.push(`*${hdr.nama}*`);
  if(hdr.subtitle) lines.push(hdr.subtitle);
  if(hdr.alamat) lines.push(hdr.alamat);
  if(hdr.telp) lines.push(hdr.telp);
  lines.push('-------------------------------');
  lines.push(`*${t('REKAP TRANSAKSI PELANGGAN')}*`);
  lines.push(`${t('Pelanggan')}    : ${rekapPelangganNama}`);
  if(selected.length>0) lines.push(`${t('Periode')}      : ${rekapPelangganPeriode(selected)}`);
  if(phone) lines.push(`${t('No. WhatsApp')} : ${phone}`);
  lines.push('-------------------------------');
  selected.forEach((trx,i)=>{
    lines.push(`${i+1}. ${fmtDate(trx.tanggal)} — ${trx.kode}`);
    trx.items.forEach(it=>{
      lines.push(`   ${it.nama} : ${it.qty} ${it.satuan} x ${rupiah(it.harga)} = ${rupiah(it.subtotal)}`);
    });
    lines.push(`   ${t('Total')}: ${rupiah(trx.total)} (${trx.status==='lunas'?t('Lunas'):t('Belum Lunas')})`);
  });
  lines.push('-------------------------------');
  lines.push(`${t('Jumlah Transaksi')}   : ${selected.length}`);
  lines.push(`*${t('Total Keseluruhan')} : ${rupiah(totalKeseluruhan)}*`);
  lines.push(`${t('Sudah Dibayar')}      : ${rupiah(sudahDibayar)}`);
  if(belumDibayar>0) lines.push(`${t('Belum Dibayar')}      : ${rupiah(belumDibayar)}`);
  lines.push('-------------------------------');
  lines.push(settings.note || t('Terima kasih'));
  lines.push(...notaFooterLinesWA());
  return lines.join('\n');
}
function buildRekapPelangganPDFLines(){
  const selected = rekapSelectedList();
  const { totalKeseluruhan, sudahDibayar, belumDibayar } = rekapPelangganTotals();
  const phone = rekapPelangganPhone();
  const L = [];
  const div = '--------------------------------';
  const hdr = notaHeaderInfo(currentOutletId);
  L.push({t: hdr.nama, c:true, b:true, s:12});
  if(hdr.subtitle) L.push({t: hdr.subtitle, c:true, s:8});
  if(hdr.alamat) L.push({t: hdr.alamat, c:true, s:8});
  if(hdr.telp) L.push({t: hdr.telp, c:true, s:8});
  L.push({t: div, s:9});
  L.push({t: t('REKAP TRANSAKSI PELANGGAN'), c:true, b:true, s:10});
  L.push({t: `${t('Pelanggan')}    : ${rekapPelangganNama}`, s:9, indent:13});
  if(selected.length>0) L.push({t: `${t('Periode')}      : ${rekapPelangganPeriode(selected)}`, s:9, indent:13});
  if(phone) L.push({t: `${t('No. WhatsApp')} : ${phone}`, s:9, indent:13});
  L.push({t: div, s:9});
  selected.forEach((trx,i)=>{
    L.push({t: `${i+1}. ${fmtDate(trx.tanggal)} — ${trx.kode}`, b:true, s:9});
    trx.items.forEach(it=>{
      L.push({t: `${it.nama} : ${it.qty} ${it.satuan} x ${rupiah(it.harga)} = ${rupiah(it.subtotal)}`, s:8, indent:4});
    });
    L.push({t: `${t('Total')}: ${rupiah(trx.total)} (${trx.status==='lunas'?t('Lunas'):t('Belum Lunas')})`, s:8, indent:4});
  });
  L.push({t: div, s:9});
  L.push({t: `${t('Jumlah Transaksi')}   : ${selected.length}`, s:9});
  L.push({t: `${t('Total Keseluruhan')} : ${rupiah(totalKeseluruhan)}`, b:true, s:11});
  L.push({t: `${t('Sudah Dibayar')}      : ${rupiah(sudahDibayar)}`, s:9});
  if(belumDibayar>0) L.push({t: `${t('Belum Dibayar')}      : ${rupiah(belumDibayar)}`, s:9});
  L.push({t: div, s:9});
  L.push({t: settings.note || t('Terima kasih'), c:true, s:8});
  L.push(...notaFooterLinesPDF());
  return L;
}
function openRekapPelangganShare(){
  if(rekapSelectedIds.size===0){ showToast(t('Centang minimal satu transaksi dulu')); return; }
  document.getElementById('rekapShareModal').classList.add('show');
}
function closeRekapPelangganShare(){
  document.getElementById('rekapShareModal').classList.remove('show');
}
function sendRekapPelangganWA(target){
  const phone = rekapPelangganPhone();
  if(!phone){ showToast(t('No. WhatsApp pelanggan belum diisi di transaksi manapun')); return; }
  openWA(normalizePhone(phone), rekapPelangganTextWA(), target);
  closeRekapPelangganShare();
}
async function printRekapPelangganBluetooth(){
  await printLinesViaBluetooth(buildRekapPelangganPDFLines());
}
function printRekapPelangganViaBrowser(){
  printLinesViaBrowser(buildRekapPelangganPDFLines());
}
async function downloadRekapPelangganImage(){
  await shareOrDownloadNotaImage(buildRekapPelangganPDFLines(), `Rekap-${rekapPelangganNama.replace(/\s+/g,'-')}`, 80, `${t('Rekap transaksi')} - ${rekapPelangganNama}`);
  closeRekapPelangganShare();
}
