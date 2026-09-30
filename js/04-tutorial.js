/* ===================== TUTORIAL ===================== */
function openTutorial(){ document.getElementById('tutorialModal').classList.add('show'); }
function closeTutorial(){ document.getElementById('tutorialModal').classList.remove('show'); }
function toggleTut(btn){
  const body = btn.nextElementSibling;
  const wasOpen = body.classList.contains('open');
  document.querySelectorAll('.tut-body.open').forEach(b=>b.classList.remove('open'));
  if(!wasOpen) body.classList.add('open');
}
/* jsPDF (font helvetica bawaan) tidak punya glyph emoji -- kalau dibiarkan,
   simbol seperti "1️⃣"/"🔟" di judul tut-head tampil kotak kosong di PDF.
   Nomor urut bagian di PDF dibuat dari index loop-nya sendiri (bukan
   dibaca dari emoji), jadi 🔟 (yang tidak punya digit terpisah seperti
   1️⃣-9️⃣) tidak masalah. */
function stripEmojiForPDF(s){
  return String(s||'')
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}\u{20E3}]/gu, '')
    .replace(/\s+/g,' ')
    .trim();
}
/* Isi PDF diambil langsung dari DOM #tutorialModal .tut-item (bukan
   ditulis ulang di JS) supaya cuma ada SATU sumber teks tutorial -- kalau
   isinya diedit di index.html, PDF-nya otomatis ikut berubah, tidak perlu
   disunting dua tempat. Item yang sedang disembunyikan (mis. bagian
   owner-only untuk akun kasir, lihat aturan CSS "body.role-kasir
   .owner-only") ikut dilewati, supaya PDF-nya sama dengan apa yang
   pengguna itu benar-benar lihat di aplikasi. */
function downloadTutorialPDF(){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit:'mm', format:'a4' });
  const marginX = 14, maxX = 196, pageBottom = 280;
  let y = 18;
  const ensureRoom = (need)=>{ if(y + (need||0) > pageBottom){ doc.addPage(); y = 18; } };

  doc.setFont('helvetica','bold'); doc.setFontSize(15);
  doc.text(t('Tutorial Penggunaan') + ' — Dokter Laundry', marginX, y);
  y += 7;
  doc.setFont('helvetica','normal'); doc.setFontSize(9.5);
  doc.setTextColor(120);
  doc.text(`${t('Diunduh')} ${fmtDate(todayISO())}`, marginX, y);
  doc.setTextColor(0);
  y += 9;

  const items = document.querySelectorAll('#tutorialModal .tut-item');
  let sectionNo = 0;
  items.forEach(item=>{
    if(window.getComputedStyle(item).display === 'none') return;
    sectionNo++;
    const headEl = item.querySelector('.tut-head');
    const heading = `${sectionNo}. ${stripEmojiForPDF(headEl ? headEl.textContent : '')}`;
    const bodyItems = Array.from(item.querySelectorAll('.tut-body li')).map(li=>stripEmojiForPDF(li.textContent));

    ensureRoom(14);
    doc.setFont('helvetica','bold'); doc.setFontSize(12);
    doc.splitTextToSize(heading, maxX-marginX).forEach(line=>{ ensureRoom(6); doc.text(line, marginX, y); y += 6; });
    y += 1;

    doc.setFont('helvetica','normal'); doc.setFontSize(10);
    bodyItems.forEach((text, idx)=>{
      const lines = doc.splitTextToSize(`${idx+1}. ${text}`, maxX-marginX-4);
      lines.forEach(line=>{ ensureRoom(5); doc.text(line, marginX+4, y); y += 5; });
      y += 1.5;
    });
    y += 5;
  });

  const filename = `Tutorial-Dokter-Laundry.pdf`;
  saveToDownloadsGallery(doc.output('blob'), filename);
  doc.save(filename);
}

/* ===================== LATIHAN PRAKTIK LANGSUNG (tur spotlight) ===================== */
/* Catatan: teks di sini TIDAK dibungkus t() langsung di sini karena TOUR_STEPS
   dievaluasi saat file ini di-load, sebelum js/21-i18n.js (dimuat paling
   akhir) mendefinisikan t(). Pembungkusan t() dilakukan saat ditampilkan,
   di showTourStep() di bawah. */
const TOUR_STEPS = [
  { tab:'baru', el:'#inNama', text:'Ini kolom nama pelanggan. Coba ketik nama di sini — kalau sudah pernah input sebelumnya, akan muncul saran otomatis.' },
  { tab:'baru', el:'#itNama', text:'Di sini kamu pilih atau ketik layanan yang dipesan, misalnya "Cuci + Setrika".' },
  { tab:'baru', el:'button[onclick="addItem()"]', text:'Setelah nama layanan, qty, dan harga terisi, tekan tombol ini untuk menambahkannya ke daftar transaksi.' },
  { tab:'baru', el:'#submitTrxBtn', text:'Kalau semua sudah diisi, tekan tombol ini untuk menyimpan transaksi & langsung membuat nota.' },
  { tab:'riwayat', el:'#searchInput', text:'Di tab Riwayat, kamu bisa cari transaksi pelanggan tertentu di sini.', pre:()=>renderHistory() },
  { tab:'paket', el:'button[onclick="openNewSubscription()"]', text:'Ini untuk mendaftarkan pelanggan paket bulanan maupun pelanggan Tempo (bayar nanti, tanpa kuota).' },
  { tab:'papan', el:'#workBoardGrid', text:'Ini tab Daftar Tugas — otomatis menampilkan semua cucian yang perlu dikerjakan, dikelompokkan per hari menurut Estimasi Selesai. Ketuk Belum/Dikerjakan/Selesai di tiap kartu untuk update progresnya.', pre:()=>renderWorkBoard() },
  { tab:'papan', el:'button[onclick="downloadWorkBoardImage()"]', text:'Mau lihat atau bagikan rekap kerjaan (termasuk yang sudah lama)? Pilih rentang tanggalnya lalu tekan tombol ini untuk mengunduhnya sebagai gambar JPG.' },
];
var tourIndex = 0;
function startGuidedTour(){
  closeTutorial();
  tourIndex = 0;
  document.getElementById('tourOverlay').classList.add('show');
  showTourStep();
}
function endGuidedTour(){
  document.getElementById('tourOverlay').classList.remove('show');
}
function nextTourStep(){
  tourIndex++;
  if(tourIndex >= TOUR_STEPS.length){ endGuidedTour(); showToast(t('Latihan selesai! Sekarang kamu siap pakai aplikasi ini 🎉')); return; }
  showTourStep();
}
function showTourStep(){
  const step = TOUR_STEPS[tourIndex];
  switchTab(step.tab);
  if(step.pre) step.pre();
  document.getElementById('tourStepLabel').textContent = `${t('Langkah')} ${tourIndex+1} ${t('dari')} ${TOUR_STEPS.length}`;
  document.getElementById('tourText').textContent = t(step.text);
  document.getElementById('tourNextBtn').textContent = (tourIndex===TOUR_STEPS.length-1) ? t('Selesai') : t('Lanjut');
  setTimeout(()=>positionTourSpotlight(step.el), 120);
}
function positionTourSpotlight(selector){
  const target = document.querySelector(selector);
  const spot = document.getElementById('tourSpotlight');
  const tip = document.getElementById('tourTooltip');
  if(!target){ spot.style.display='none'; tip.style.top='40%'; tip.style.left='50%'; tip.style.transform='translate(-50%,-50%)'; return; }
  target.scrollIntoView({ behavior:'smooth', block:'center' });
  setTimeout(()=>{
    const r = target.getBoundingClientRect();
    const pad = 8;
    spot.style.display='block';
    spot.style.left = (r.left-pad)+'px';
    spot.style.top = (r.top-pad)+'px';
    spot.style.width = (r.width+pad*2)+'px';
    spot.style.height = (r.height+pad*2)+'px';

    const tipWidth = 280;
    let tipTop = r.bottom + 14;
    let tipLeft = Math.min(Math.max(r.left, 12), window.innerWidth - tipWidth - 12);
    if(tipTop + 140 > window.innerHeight){ tipTop = Math.max(r.top - 150, 12); }
    tip.style.transform='none';
    tip.style.top = tipTop+'px';
    tip.style.left = tipLeft+'px';
  }, 200);
}

