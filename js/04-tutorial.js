/* ===================== TUTORIAL ===================== */
function openTutorial(){ document.getElementById('tutorialModal').classList.add('show'); }
function closeTutorial(){ document.getElementById('tutorialModal').classList.remove('show'); }
function toggleTut(btn){
  const body = btn.nextElementSibling;
  const wasOpen = body.classList.contains('open');
  document.querySelectorAll('.tut-body.open').forEach(b=>b.classList.remove('open'));
  if(!wasOpen) body.classList.add('open');
}

/* ===================== LATIHAN PRAKTIK LANGSUNG (tur spotlight) ===================== */
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
  if(tourIndex >= TOUR_STEPS.length){ endGuidedTour(); showToast('Latihan selesai! Sekarang kamu siap pakai aplikasi ini 🎉'); return; }
  showTourStep();
}
function showTourStep(){
  const step = TOUR_STEPS[tourIndex];
  switchTab(step.tab);
  if(step.pre) step.pre();
  document.getElementById('tourStepLabel').textContent = `Langkah ${tourIndex+1} dari ${TOUR_STEPS.length}`;
  document.getElementById('tourText').textContent = step.text;
  document.getElementById('tourNextBtn').textContent = (tourIndex===TOUR_STEPS.length-1) ? 'Selesai' : 'Lanjut';
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

