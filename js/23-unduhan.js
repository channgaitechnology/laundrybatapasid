/* ===================== UNDUHAN (galeri file yang pernah diunduh) =====================
   PWA yang di-install ("Add to Home Screen") tidak selalu bisa langsung buka folder
   Download HP dari dalam app-nya sendiri -- harus keluar dulu ke file manager/browser
   biasa. Supaya nota/laporan yang sudah diunduh tetap gampang dibuka lagi TANPA keluar
   dari app, setiap kali sesuatu diunduh (lihat saveToDownloadsGallery() dipanggil dari
   js/10-nota-cetak.js, js/17-papan-laundry.js, js/18-laporan.js, dll), salinannya juga
   disimpan di sini -- IndexedDB, lokal di perangkat itu saja, TIDAK dikirim ke server
   mana pun. Dibatasi 50 file terbaru supaya penyimpanan lokal tidak membengkak terus. */
const UNDUHAN_DB_NAME = 'laundry_unduhan';
const UNDUHAN_STORE = 'files';
const UNDUHAN_MAX_ITEMS = 50;

function openUnduhanDB(){
  return new Promise((resolve, reject) => {
    if(typeof indexedDB === 'undefined'){ reject(new Error('IndexedDB tidak tersedia')); return; }
    const req = indexedDB.open(UNDUHAN_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if(!db.objectStoreNames.contains(UNDUHAN_STORE)){
        const store = db.createObjectStore(UNDUHAN_STORE, { keyPath:'id' });
        store.createIndex('createdAt', 'createdAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
/* Dipanggil dari tiap titik unduh nota/gambar/PDF -- sengaja dibungkus try/catch penuh
   di sini (bukan di titik panggilnya) supaya kalau IndexedDB gagal (mode penyamaran/
   private browsing, kuota penuh, dll), unduhan ASLI yang sedang berjalan tetap lancar,
   fitur galeri ini cuma "bonus" yang boleh diam-diam tidak aktif. */
async function saveToDownloadsGallery(blob, filename){
  try{
    const db = await openUnduhanDB();
    const id = 'dl-' + Date.now() + '-' + Math.random().toString(36).slice(2,8);
    const record = { id, filename, blob, type: blob.type||'', createdAt: Date.now() };
    await new Promise((resolve, reject) => {
      const tx = db.transaction(UNDUHAN_STORE, 'readwrite');
      tx.objectStore(UNDUHAN_STORE).put(record);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    await pruneUnduhanOldEntries(db);
  }catch(e){ /* diamkan -- lihat komentar di atas */ }
}
function pruneUnduhanOldEntries(db){
  return new Promise((resolve) => {
    const tx = db.transaction(UNDUHAN_STORE, 'readwrite');
    const store = tx.objectStore(UNDUHAN_STORE);
    const idx = store.index('createdAt');
    const keys = [];
    idx.openCursor(null, 'prev').onsuccess = (e) => {
      const cursor = e.target.result;
      if(cursor){ keys.push(cursor.primaryKey); cursor.continue(); }
      else { keys.slice(UNDUHAN_MAX_ITEMS).forEach(id => store.delete(id)); resolve(); }
    };
    tx.onerror = () => resolve();
  });
}
async function loadUnduhanList(){
  try{
    const db = await openUnduhanDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(UNDUHAN_STORE, 'readonly');
      const idx = tx.objectStore(UNDUHAN_STORE).index('createdAt');
      const results = [];
      idx.openCursor(null, 'prev').onsuccess = (e) => {
        const cursor = e.target.result;
        if(cursor){ results.push(cursor.value); cursor.continue(); }
        else resolve(results);
      };
      tx.onerror = () => reject(tx.error);
    });
  }catch(e){ return []; }
}
async function getUnduhanEntry(id){
  try{
    const db = await openUnduhanDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(UNDUHAN_STORE, 'readonly');
      const req = tx.objectStore(UNDUHAN_STORE).get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }catch(e){ return null; }
}
function fmtUnduhanDate(ts){
  const d = new Date(ts);
  return d.toLocaleDateString('id-ID', { day:'2-digit', month:'short', year:'numeric' }) + ' ' + d.toLocaleTimeString('id-ID', { hour:'2-digit', minute:'2-digit' });
}
async function openUnduhanModal(){
  document.getElementById('unduhanModal').classList.add('show');
  await renderUnduhanList();
}
function closeUnduhanModal(){ document.getElementById('unduhanModal').classList.remove('show'); }
async function renderUnduhanList(){
  const el = document.getElementById('unduhanList');
  const items = await loadUnduhanList();
  if(items.length===0){
    el.innerHTML = `<div class="empty">
      <svg class="bubble-icon" viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="21" stroke="#146C8E" stroke-width="2" opacity="0.4"/><circle cx="24" cy="24" r="12" stroke="#5FC9BE" stroke-width="2"/></svg>
      <h3>${t('Belum ada file')}</h3>
      <p>${t('Nota/laporan yang kamu unduh akan tersimpan di sini juga, supaya gampang dibuka lagi tanpa keluar dari app.')}</p>
    </div>`;
    return;
  }
  el.innerHTML = items.map(it => `
    <div class="item-line" style="align-items:center;">
      <span>${escapeHTML(it.filename)}<br><span style="font-size:11px;color:var(--ink-soft);">${fmtUnduhanDate(it.createdAt)}</span></span>
      <span style="display:flex;gap:6px;flex:none;">
        <button class="btn btn-outline btn-sm" style="width:auto;padding:6px 10px;" onclick="openUnduhanEntry('${it.id}')">${t('Buka')}</button>
        <button class="btn btn-accent btn-sm" style="width:auto;padding:6px 10px;" onclick="shareUnduhanEntry('${it.id}')">↗️ ${t('Bagikan')}</button>
        <button class="btn btn-ghost btn-sm" style="width:auto;padding:6px 10px;color:var(--danger);" onclick="deleteUnduhanEntry('${it.id}')">✕</button>
      </span>
    </div>
  `).join('');
}
async function openUnduhanEntry(id){
  const record = await getUnduhanEntry(id);
  if(!record){ showToast(t('File tidak ditemukan')); return; }
  const url = URL.createObjectURL(record.blob);
  window.open(url, '_blank');
  setTimeout(()=> URL.revokeObjectURL(url), 60000);
}
/* "Bagikan" membuka dialog Share bawaan OS (WhatsApp, WhatsApp Business,
   email, Bluetooth, dll -- apa pun yang terdaftar di HP-nya) lewat Web
   Share API, persis pola yang sudah dipakai shareOrDownloadNotaImage()
   (js/10-nota-cetak.js) -- termasuk gate isMobileDevice() yang SAMA:
   navigator.canShare() melaporkan true di desktop juga, tapi
   navigator.share() di desktop cuma membuka dialog Share OS tanpa opsi
   simpan biasa, jadi desktop tetap fallback ke unduh biasa. */
async function shareUnduhanEntry(id){
  const record = await getUnduhanEntry(id);
  if(!record){ showToast(t('File tidak ditemukan')); return; }
  try{
    const file = new File([record.blob], record.filename, { type: record.type || record.blob.type || '' });
    if(isMobileDevice() && navigator.canShare && navigator.canShare({ files:[file] })){
      await navigator.share({ files:[file], title: record.filename });
      return;
    }
  }catch(e){ /* dibatalkan atau tidak didukung, lanjut unduh biasa */ }
  const url = URL.createObjectURL(record.blob);
  const a = document.createElement('a');
  a.href = url; a.download = record.filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(()=> URL.revokeObjectURL(url), 5000);
  showToast(isMobileDevice()
    ? t('File diunduh. Buka WhatsApp/app tujuan lalu lampirkan dari folder Download.')
    : t('File diunduh ke folder Download.'));
}
async function deleteUnduhanEntry(id){
  try{
    const db = await openUnduhanDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(UNDUHAN_STORE, 'readwrite');
      tx.objectStore(UNDUHAN_STORE).delete(id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }catch(e){}
  renderUnduhanList();
}
