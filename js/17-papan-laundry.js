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
/* Urutan "kemajuan" status kerja, dari paling awal ke paling akhir --
   dipakai untuk menggabungkan status beberapa baris subscription_usage
   yang berasal dari satu batch (lihat groupUsageRowsByBatch()) jadi SATU
   status kartu: dipilih yang PALING AWAL supaya kartu gabungan tidak
   kelihatan "Selesai"/hilang dari papan kalau ada layanan di dalamnya yang
   sebenarnya belum kelar semua. */
const WORK_STATUS_ORDER = ['belum','sedang','selesai','diambil'];
function groupWorkStatus(rows){
  let idx = WORK_STATUS_ORDER.length-1;
  rows.forEach(u=>{
    const i = WORK_STATUS_ORDER.indexOf(u.workStatus||'belum');
    if(i>=0 && i<idx) idx = i;
  });
  return WORK_STATUS_ORDER[idx];
}
/* 1 nota Tempo yang isinya beberapa layanan (mis. cuci lipat + handuk +
   sajadah) disimpan sebagai beberapa baris subscription_usage terpisah
   lewat submitExtraServiceBatch(), tapi semuanya berbagi batch_id yang
   sama -- kalau tidak dikelompokkan disini, tiap baris jadi kartu Daftar
   Tugas sendiri-sendiri (bug nyata: nota tempo pecah jadi banyak kartu
   "Belum"/"Dikerjakan"/"Selesai" terpisah untuk satu pelanggan yang sama).
   Baris lama tanpa batch_id (sebelum kolom ini ada) tetap dianggap satu
   kartu tersendiri, sama seperti groupExtrasIntoTransactions(). */
function groupUsageRowsByBatch(rows){
  const map = new Map();
  rows.forEach(u=>{
    const key = u.batchId || `single-${u.id}`;
    if(!map.has(key)) map.set(key, []);
    map.get(key).push(u);
  });
  return Array.from(map.values()).map(group=> group.slice().sort((a,b)=> a.id<b.id?-1:(a.id>b.id?1:0)));
}
/* Kartu yang berasal dari gabungan beberapa baris (id-nya digabung jadi
   satu string "id1,id2,...") -- dipakai setWorkStatus()/markPickedUp()/
   confirmPapanHapus() untuk tahu baris DB mana saja yang perlu diperbarui
   sekaligus supaya seluruh isi nota tetap bergerak bersama sebagai satu
   kartu. Untuk kartu biasa (1 baris), hasilnya tetap array 1 elemen. */
function workItemIds(it){ return String(it.id).split(','); }
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
  const usageRows = allWorkUsage.filter(u=>u.type==='layanan_tambahan' && visSubIds.has(String(u.subscriptionId)));
  const usageItems = groupUsageRowsByBatch(usageRows).map(group=>{
    const sub = subscriptions.find(s=>s.id===group[0].subscriptionId);
    const tanggal = group.reduce((max,u)=> u.tanggal>max?u.tanggal:max, group[0].tanggal);
    const estimasi = group.reduce((max,u)=> (u.estimasi||'')>(max||'')?u.estimasi:max, group[0].estimasi);
    return {
      id: group.map(u=>u.id).join(','), source:'usage', nama: sub ? sub.nama : '-', hp: sub ? sub.hp : '', outletId: sub ? sub.outletId : null,
      layanan: group.map(u=>u.layananNama||'-').join(', '), harga: group.reduce((sum,u)=>sum+u.subtotal,0),
      tanggal, estimasi, workStatus: groupWorkStatus(group),
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
/* `id` disini bisa berupa gabungan beberapa id baris DB ("id1,id2,...")
   kalau kartunya adalah 1 nota Tempo yang berisi beberapa layanan (lihat
   groupUsageRowsByBatch()) -- semua baris dalam grup itu ikut diperbarui
   sekaligus supaya seluruh isi nota tetap 1 kartu yang bergerak bersama. */
async function setWorkStatus(id, status, source){
  const table = source==='usage' ? 'subscription_usage' : 'transactions';
  const list = source==='usage' ? allWorkUsage : transactions;
  const ids = id.split(',');
  for(const rowId of ids){
    const item = list.find(x=>x.id===rowId);
    if(!item) continue;
    const { error } = await sb.from(table).update({ work_status: status }).eq('id', rowId);
    if(error){ showToast(t('Gagal memperbarui status kerja')); return; }
    item.workStatus = status;
  }
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
  const ids = id.split(',');
  for(const rowId of ids){
    const item = list.find(x=>x.id===rowId);
    if(!item) continue;
    const { error } = await sb.from(table).update({ work_status: 'diambil' }).eq('id', rowId);
    if(error){ showToast(t('Gagal menandai sudah diambil')); return; }
    item.workStatus = 'diambil';
  }
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
/* ===== Hapus Tugas dari Papan (bulk) =====
   Bulk version of markPickedUp(): tandai banyak kartu sekaligus jadi
   "diambil" (menghilang dari papan aktif via buildWorkItems()) berdasarkan
   rentang tanggal Estimasi Selesai/tanggal masuk (workBoardDate()) --
   TIDAK menghapus baris transactions/subscription_usage-nya sama sekali,
   supaya Riwayat & Laporan tetap lengkap. Ini murni buat merapikan papan
   yang menumpuk, bukan buat menghapus data transaksi. */
function papanHapusDateThreshold(mode){
  const d = new Date(todayISO()+'T00:00:00');
  if(mode==='hari-ini') return todayISO();
  if(mode==='kemarin') d.setDate(d.getDate()-1);
  else if(mode==='2-hari') d.setDate(d.getDate()-2);
  else if(mode==='3-hari') d.setDate(d.getDate()-3);
  else return null;
  return d.toISOString().slice(0,10);
}
function papanHapusMatchingItems(){
  const mode = document.getElementById('papanHapusMode').value;
  const items = buildWorkItems();
  if(mode==='semua') return items;
  if(mode==='custom'){
    const dari = document.getElementById('papanHapusDari').value;
    const sampai = document.getElementById('papanHapusSampai').value;
    if(!dari || !sampai) return [];
    return items.filter(it=>{ const d = workBoardDate(it); return d>=dari && d<=sampai; });
  }
  const threshold = papanHapusDateThreshold(mode);
  if(!threshold) return [];
  return items.filter(it=>workBoardDate(it)<=threshold);
}
function updatePapanHapusPreview(){
  const n = papanHapusMatchingItems().length;
  document.getElementById('papanHapusPreview').textContent = n>0
    ? `${n} ${t('tugas akan ditandai Sudah Diambil.')}`
    : t('Tidak ada tugas yang cocok dengan pilihan ini.');
}
function togglePapanHapusCustomFields(){
  const mode = document.getElementById('papanHapusMode').value;
  document.getElementById('papanHapusCustomFields').style.display = mode==='custom' ? 'grid' : 'none';
  updatePapanHapusPreview();
}
function openPapanHapusModal(){
  document.getElementById('papanHapusMode').value = 'semua';
  document.getElementById('papanHapusCustomFields').style.display = 'none';
  document.getElementById('papanHapusDari').value = '';
  document.getElementById('papanHapusSampai').value = '';
  updatePapanHapusPreview();
  document.getElementById('papanHapusModal').classList.add('show');
}
function closePapanHapusModal(){ document.getElementById('papanHapusModal').classList.remove('show'); }
async function confirmPapanHapus(){
  const items = papanHapusMatchingItems();
  if(items.length===0){ showToast(t('Tidak ada tugas yang cocok untuk dihapus')); return; }
  if(!confirm(`${t('Tandai')} ${items.length} ${t('tugas sebagai Sudah Diambil? Nota/transaksinya TIDAK ikut terhapus.')}`)) return;
  for(const it of items){
    const table = it.source==='usage' ? 'subscription_usage' : 'transactions';
    const list = it.source==='usage' ? allWorkUsage : transactions;
    for(const rowId of workItemIds(it)){
      await sb.from(table).update({ work_status:'diambil' }).eq('id', rowId);
      const rec = list.find(x=>x.id===rowId);
      if(rec) rec.workStatus = 'diambil';
    }
  }
  closePapanHapusModal();
  showToast(`${items.length} ${t('tugas ditandai Sudah Diambil')}`);
  renderWorkBoard();
}
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
    saveToDownloadsGallery(blob, filename);
    try{
      const file = new File([blob], filename, { type:'image/jpeg' });
      if(isMobileDevice() && navigator.canShare && navigator.canShare({ files:[file] })){
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

