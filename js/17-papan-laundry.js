/* ===================== PAPAN LAUNDRY ===================== */
/* Mengikuti pola papan tulis fisik: dikelompokkan per hari (Senin-Ahad),
   bukan per minggu kalender — kartu menumpuk terus sampai ditandai "Sudah
   Diambil" (dilepas dari papan), berapa pun lamanya.
   Hari yang dipakai untuk pengelompokan adalah HARI PERKIRAAN SELESAI
   (field "Estimasi Selesai" saat input transaksi) — bukan hari masuk,
   supaya cucian yang masuk Senin tapi baru selesai Rabu (misal butuh 2
   hari kerja) muncul di kolom Rabu. Kalau estimasi belum diisi, dipakai
   tanggal masuk sebagai fallback (paling akurat yang tersedia). */
const INDO_DAY_NAMES = ['Ahad','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
function indoDayName(tanggal){
  if(!tanggal) return INDO_DAY_NAMES[0];
  return INDO_DAY_NAMES[new Date(tanggal+'T00:00:00').getDay()];
}
function workBoardDate(t){ return t.estimasi || t.tanggal; }
/* Daftar Tugas baru mulai dipakai 25 Agustus 2026 — banyak nota lama (manual,
   belum sempat diinput, atau sudah tercatat sejak sebelumnya) yang tanggalnya
   sebelum itu dan sudah pasti selesai/diambil lama, jadi sengaja tidak usah
   ikut muncul di papan biar tidak mengotori tampilan kerjaan yang aktif. */
const PAPAN_KERJA_MULAI_TANGGAL = '2026-08-25';
/* Menyatukan SEMUA sumber kerjaan (transaksi reguler, layanan tambahan
   Bulanan/Tempo, timbangan kg polos) jadi satu daftar seragam TANPA
   filter apa pun. Dipakai oleh daftar tugas aktif (buildWorkItems, yang
   lalu memfilter status "diambil" & cutoff tanggal) MAUPUN oleh unduhan
   rentang tanggal (buildWorkItemsForRange, yang justru perlu melihat
   SEMUA riwayat termasuk yang sudah diambil/lama, supaya daftar tugas
   lama tetap bisa dilihat lewat unduhan). */
function buildAllWorkItemsRaw(){
  /* Konteks outlet ikut membatasi Daftar Tugas: kerjaan Paket Bulanan/Tempo
     hanya diikutkan kalau pelanggannya terdaftar di outlet yang sedang
     aktif (dicek lewat visibleSubscriptions(), bukan filter langsung ke
     allWorkUsage karena baris usage sendiri tidak punya outlet_id). */
  const visSubIds = new Set(visibleSubscriptions().map(s=>String(s.id)));
  const trxItems = visibleTransactions().map(t=>({
    id:t.id, source:'trx', nama:t.nama, hp:t.hp, outletId:t.outletId,
    layanan:(t.items||[]).map(it=>it.nama).join(', ')||'-',
    harga:t.total, tanggal:t.tanggal, estimasi:t.estimasi, workStatus:t.workStatus||'belum',
    lunas:t.status==='lunas'
  }));
  const usageItems = allWorkUsage.filter(u=>u.type==='layanan_tambahan' && visSubIds.has(String(u.subscriptionId))).map(u=>{
    const sub = subscriptions.find(s=>s.id===u.subscriptionId);
    return {
      id:u.id, source:'usage', nama: sub ? sub.nama : '-', hp: sub ? sub.hp : '', outletId: sub ? sub.outletId : null,
      layanan:u.layananNama||'-', harga:u.subtotal, tanggal:u.tanggal, estimasi:u.estimasi, workStatus:u.workStatus||'belum',
      lunas: sub ? sub.statusBayar==='lunas' : false
    };
  });
  const beratItems = allWorkUsage.filter(u=>u.type==='pemakaian' && visSubIds.has(String(u.subscriptionId))).map(u=>{
    const sub = subscriptions.find(s=>s.id===u.subscriptionId);
    return {
      id:u.id, source:'usage', nama: sub ? sub.nama : '-', hp: sub ? sub.hp : '', outletId: sub ? sub.outletId : null,
      layanan: sub ? sub.paketNama : t('Laundry Masuk (kg)'), beratLabel:`${u.berat} kg`,
      tanggal:u.tanggal, estimasi:u.estimasi, workStatus:u.workStatus||'belum',
      lunas: sub ? sub.statusBayar==='lunas' : false
    };
  });
  return trxItems.concat(usageItems, beratItems);
}
/* Daftar Tugas menggabungkan tiga sumber data jadi satu daftar kerjaan
   seragam: transaksi reguler (transactions), kunjungan Paket Bulanan/Tempo
   bertipe layanan_tambahan, DAN timbangan kg polos Paket Bulanan (type
   "pemakaian") — supaya SEMUA laundry yang masuk ikut muncul di papan,
   bukan cuma yang punya harga per-baris. Timbangan kg polos belum punya
   harga pasti (baru ditagih di akhir periode/kalau lebih kuota), jadi
   kartunya menampilkan berat (kg) sebagai ganti harga. */
function buildWorkItems(){
  return buildAllWorkItemsRaw().filter(it=>(it.workStatus||'belum')!=='diambil' && it.tanggal >= PAPAN_KERJA_MULAI_TANGGAL);
}
/* Untuk unduhan JPG rentang tanggal: SEMUA kerjaan (termasuk yang sudah
   diambil & yang lebih lama dari cutoff papan aktif) yang hari Estimasi
   Selesai-nya (atau tanggal masuk kalau belum ada estimasi — sama seperti
   papan aktif) jatuh di antara `dari` dan `sampai` (inklusif, format ISO
   'YYYY-MM-DD'). */
function buildWorkItemsForRange(dari, sampai){
  return buildAllWorkItemsRaw().filter(it=>{
    const d = workBoardDate(it);
    return d >= dari && d <= sampai;
  });
}
/* Tanggal transaksi/kerjaan paling lama yang tercatat di app — dipakai
   sebagai default awal rentang unduh, supaya begitu dibuka langsung bisa
   mengunduh daftar tugas dari nota pertama kali diinput. */
function earliestWorkDate(){
  const dates = transactions.map(t=>t.tanggal).concat(allWorkUsage.map(u=>u.tanggal)).filter(Boolean);
  return dates.length ? dates.reduce((min,d)=> d<min?d:min) : todayISO();
}
function groupWorkItemsByDate(items){
  const map = {};
  items.forEach(it=>{ const d = workBoardDate(it); (map[d] = map[d]||[]).push(it); });
  return Object.keys(map).sort().map(d=>({ date:d, items:map[d] }));
}
async function setWorkStatus(id, status, source){
  const table = source==='usage' ? 'subscription_usage' : 'transactions';
  const list = source==='usage' ? allWorkUsage : transactions;
  const item = list.find(x=>x.id===id);
  if(!item) return;
  const { error } = await sb.from(table).update({ work_status: status }).eq('id', id);
  if(error){ showToast(t('Gagal memperbarui status kerja')); return; }
  item.workStatus = status;
  renderWorkBoard();
  if(status==='selesai' && settings.autoNotifySelesai) sendWorkDoneNotification(id, source);
}
/* Pesan WA yang dikirim ke pelanggan begitu kerjaannya ditandai Selesai —
   dipakai baik oleh notifikasi otomatis maupun tombol "Kirim Notifikasi"
   manual, supaya isinya selalu sama. Alamat/nama outlet ikut memakai
   notaHeaderInfo() seperti nota lainnya. */
function workDoneNotifTextWA(it){
  const hdr = notaHeaderInfo(it.outletId);
  const lines = [];
  lines.push(`${t('Halo')} ${it.nama},`);
  lines.push(`${t('Laundry Anda')} (${it.layanan}) ${t('sudah *SELESAI* dan siap diambil di')} ${hdr.nama}${hdr.subtitle ? ' - '+hdr.subtitle : ''}.`);
  if(hdr.alamat) lines.push(hdr.alamat);
  lines.push('');
  lines.push(settings.note || t('Terima kasih telah menggunakan jasa kami'));
  return lines.join('\n');
}
/* Web (bukan app WhatsApp Business resmi/API) tidak bisa kirim pesan tanpa
   sentuhan pengguna sama sekali — "otomatis" di sini artinya begitu status
   diubah jadi Selesai, WhatsApp langsung terbuka dengan pesan siap kirim;
   tombol "Kirim" terakhir tetap perlu diketuk manual di WhatsApp-nya. */
function sendWorkDoneNotification(id, source){
  const it = buildAllWorkItemsRaw().find(x=>x.id===id && x.source===source);
  if(!it){ showToast(t('Data kerjaan tidak ditemukan')); return; }
  if(!it.hp){ showToast(t('Nomor WA pelanggan belum diisi — notifikasi tidak dikirim')); return; }
  openWA(normalizePhone(it.hp), workDoneNotifTextWA(it), 'wa');
}
async function markPickedUp(id, source){
  const table = source==='usage' ? 'subscription_usage' : 'transactions';
  const list = source==='usage' ? allWorkUsage : transactions;
  const item = list.find(x=>x.id===id);
  if(!item) return;
  const { error } = await sb.from(table).update({ work_status: 'diambil' }).eq('id', id);
  if(error){ showToast(t('Gagal menandai sudah diambil')); return; }
  item.workStatus = 'diambil';
  showToast(t('Ditandai sudah diambil'));
  renderWorkBoard();
}
/* Kartu hanya menampilkan 4 info sesuai permintaan: nama pelanggan, jenis
   layanan, tanggal selesai, dan harga — semua dibesarkan+bold supaya gampang
   dibaca sekilas, kecuali harga yang dikecilkan (kurang penting dilihat).
   Kata "Selesai" di depan tanggal supaya jelas ini tanggal target selesai,
   bukan tanggal masuk. */
function workBoardCardTopHTML(it){
  const tanggalInfo = it.estimasi
    ? `${t('Selesai')} ${fmtDate(it.estimasi)}`
    : `${t('Selesai')} ${fmtDate(it.tanggal)} (${t('belum ada estimasi')})`;
  const bayarInfo = it.lunas
    ? `<div class="work-lunas">${t('Lunas')}</div>`
    : `<div class="work-harga">${it.beratLabel || rupiah(it.harga)}</div>`;
  return `
      <div class="work-nama">${escapeHTML(it.nama)}</div>
      <div class="work-layanan">${escapeHTML(it.layanan)}</div>
      <div class="work-tanggal">${tanggalInfo}</div>
      ${bayarInfo}`;
}
function workBoardCardHTML(it){
  const ws = it.workStatus || 'belum';
  return `
    <div class="work-card">${workBoardCardTopHTML(it)}
      <div class="btn-row" style="gap:4px;">
        <button class="work-pill ${ws==='belum'?'on-belum':''}" onclick="setWorkStatus('${it.id}','belum','${it.source}')">${currentLang==='en'?'Not Started':'Belum'}</button>
        <button class="work-pill ${ws==='sedang'?'on-sedang':''}" onclick="setWorkStatus('${it.id}','sedang','${it.source}')">${t('Dikerjakan')}</button>
        <button class="work-pill ${ws==='selesai'?'on-selesai':''}" onclick="setWorkStatus('${it.id}','selesai','${it.source}')">${t('Selesai')}</button>
      </div>
      ${ws==='selesai' && !settings.autoNotifySelesai ? `<button class="btn btn-outline btn-sm" style="width:100%;margin-top:6px;font-size:11px;padding:6px 4px;" onclick="sendWorkDoneNotification('${it.id}','${it.source}')">${t('📣 Kirim Notifikasi')}</button>` : ''}
      ${ws==='selesai' ? `<button class="btn btn-accent btn-sm" style="width:100%;margin-top:6px;font-size:11px;padding:6px 4px;" onclick="markPickedUp('${it.id}','${it.source}')">${t('📤 Sudah Diambil')}</button>` : ''}
    </div>`;
}
/* Versi statis kartu khusus untuk gambar yang diunduh — tombol status
   interaktif diganti label teks datar (gambar diam, tombolnya percuma di
   situ), dan status "diambil" (yang di papan aktif malah disembunyikan)
   di sini justru ditampilkan sebagai label, karena unduhan rentang tanggal
   memang dipakai untuk melihat riwayat daftar tugas yang sudah lama/selesai.
   Cucian bertanggal masuk sebelum cutoff papan aktif (PAPAN_KERJA_MULAI_TANGGAL)
   otomatis ditulis minimal "Selesai Dikerjakan" + "Lunas", tanpa peduli
   status/lunas yang sebenarnya tersimpan — nota selama itu dianggap sudah
   lama beres. Kalau status aslinya malah sudah "diambil" (lebih lengkap
   dari sekadar "selesai"), label yang lebih akurat itu tetap dipakai. */
function workBoardCardHTMLForExport(it){
  const realWs = it.workStatus || 'belum';
  const dianggapBeres = it.tanggal < PAPAN_KERJA_MULAI_TANGGAL;
  const ws = (dianggapBeres && realWs!=='diambil') ? 'selesai' : realWs;
  const statusLabel = { belum:t('Belum Dikerjakan'), sedang:t('Dikerjakan'), selesai:t('Selesai Dikerjakan'), diambil:t('✓ Sudah Diambil') }[ws] || ws;
  const pillClass = { belum:'on-belum', sedang:'on-sedang', selesai:'on-selesai', diambil:'on-selesai' }[ws] || '';
  const displayIt = dianggapBeres ? { ...it, lunas:true } : it;
  return `
    <div class="work-card">${workBoardCardTopHTML(displayIt)}
      <div class="work-pill ${pillClass}" style="width:100%;text-align:center;margin-top:6px;">${statusLabel}</div>
    </div>`;
}
/* Grid horizontal 7 kolom Senin->Ahad (di-scroll ke samping), meniru
   susunan papan tulis fisik persis: nama hari di header kotak paling atas,
   kartu-kartu kerjaan tersusun ke bawah di dalam kotak harinya. Kolom hari
   SELALU ditampilkan (walau kosong) supaya bentuk grid-nya tetap utuh
   seperti papan aslinya, bukan cuma hari yang ada kerjaannya saja. */
function renderWorkBoard(){
  const dariEl = document.getElementById('papanUnduhDari');
  const sampaiEl = document.getElementById('papanUnduhSampai');
  if(dariEl && !dariEl.value) dariEl.value = earliestWorkDate();
  if(sampaiEl && !sampaiEl.value) sampaiEl.value = todayISO();
  const el = document.getElementById('workBoardGrid');
  const items = buildWorkItems();
  const todayName = indoDayName(todayISO());
  const orderedDays = ['Senin','Selasa','Rabu','Kamis','Jumat','Sabtu','Ahad'];
  el.innerHTML = orderedDays.map(day=>{
    const list = items.filter(it=>indoDayName(workBoardDate(it))===day)
      .slice().sort((a,b)=>{ const da=workBoardDate(a), db=workBoardDate(b); return da<db?-1:(da>db?1:0); });
    const isToday = day===todayName;
    const body = list.length===0
      ? `<div class="work-day-empty">${t('Belum ada')}</div>`
      : list.map(workBoardCardHTML).join('');
    return `<div class="work-day-col">
      <div class="work-day-col-header ${isToday?'is-today':''}">${t(day)}${isToday?'<small>'+t('Hari Ini')+'</small>':''}</div>
      <div class="work-day-col-body">${body}</div>
    </div>`;
  }).join('');
}
/* Unduh JPG rentang tanggal bebas — TIDAK memfoto papan aktif (#workBoardGrid,
   yang cuma 7 kolom Senin-Ahad & menyembunyikan yang sudah diambil/lama),
   tapi membangun grid sementara di luar layar (posisinya di luar viewport,
   tetap ada di DOM supaya html2canvas bisa membacanya) berisi SEMUA kerjaan
   di rentang tanggal yang diminta — dikelompokkan per TANGGAL KALENDER asli
   (bukan cuma nama hari), diurutkan dari yang paling lama, supaya papan
   laundry lama beneran bisa "dilihat lagi" persis seperti waktu itu. Rentang
   lebih dari 7 hari dipecah jadi beberapa baris 7 kolom yang ditumpuk ke
   bawah, bukan memanjang terus ke kanan. */
async function downloadWorkBoardImage(){
  const dariEl = document.getElementById('papanUnduhDari');
  const sampaiEl = document.getElementById('papanUnduhSampai');
  const dari = dariEl ? dariEl.value : '';
  const sampai = sampaiEl ? sampaiEl.value : '';
  if(!dari || !sampai){ showToast(t('Isi rentang tanggal dulu')); return; }
  if(dari > sampai){ showToast(t('Tanggal "Dari" harus sebelum "Sampai"')); return; }
  const items = buildWorkItemsForRange(dari, sampai);
  if(items.length===0){ showToast(t('Tidak ada cucian di rentang tanggal ini')); return; }
  if(typeof html2canvas==='undefined'){ showToast(t('Gagal memuat alat unduh gambar')); return; }
  showToast(t('Menyiapkan gambar Daftar Tugas...'));
  // Rentang lebih dari 7 hari TIDAK memanjang terus ke kanan — dipecah jadi
  // beberapa baris berisi maksimal 7 kolom tanggal, ditumpuk ke bawah
  // (persis seperti kalender berganti minggu), baris terakhir boleh kurang
  // dari 7 kalau sisa harinya tidak genap.
  const groups = groupWorkItemsByDate(items);
  const rows = [];
  for(let i=0;i<groups.length;i+=7) rows.push(groups.slice(i,i+7));
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:absolute;left:-99999px;top:0;display:flex;flex-direction:column;align-items:flex-start;gap:10px;';
  wrap.innerHTML = rows.map(row=>{
    const cols = row.map(g=>{
      const body = g.items.map(workBoardCardHTMLForExport).join('');
      return `<div class="work-day-col">
        <div class="work-day-col-header">${t(indoDayName(g.date))}<small>${fmtDate(g.date)}</small></div>
        <div class="work-day-col-body">${body}</div>
      </div>`;
    }).join('');
    return `<div class="work-board-grid" style="overflow:visible;">${cols}</div>`;
  }).join('');
  document.body.appendChild(wrap);
  try{
    const canvas = await html2canvas(wrap, { backgroundColor:'#EEF5F7', scale:2 });
    const filename = `daftar-pekerjaan-${dari}_sampai_${sampai}.jpg`;
    const blob = await new Promise(resolve=> canvas.toBlob(resolve, 'image/jpeg', 0.92));
    if(!blob){ showToast(t('Gagal membuat gambar Daftar Tugas')); return; }
    try{
      const file = new File([blob], filename, { type:'image/jpeg' });
      if(navigator.canShare && navigator.canShare({ files:[file] })){
        await navigator.share({ files:[file], title: filename, text:t('Daftar Tugas') });
        return;
      }
    }catch(e){ /* dibatalkan atau tidak didukung, lanjut unduh biasa */ }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(()=> URL.revokeObjectURL(url), 5000);
    showToast(t('Gambar Daftar Tugas diunduh'));
  }catch(e){
    showToast(t('Gagal membuat gambar Daftar Tugas'));
  }finally{
    wrap.remove();
  }
}

