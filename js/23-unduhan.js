/* ===================== UNDUHAN (galeri file yang pernah diunduh) =====================
   PWA yang di-install ("Add to Home Screen") tidak selalu bisa langsung buka folder
   Download HP dari dalam app-nya sendiri -- harus keluar dulu ke file manager/browser
   biasa. Supaya nota/laporan yang sudah diunduh tetap gampang dibuka lagi TANPA keluar
   dari app, setiap kali sesuatu diunduh (lihat saveToDownloadsGallery() dipanggil dari
   js/10-nota-cetak.js, js/17-papan-laundry.js, js/18-laporan.js, dll), salinannya juga
   disimpan di sini -- IndexedDB, lokal di perangkat itu saja, TIDAK dikirim ke server
   mana pun. Unduhan umum dibatasi 50 file; arsip backup nota dibatasi 200 JPG/75 MB
   per toko agar penyimpanan lokal tidak membengkak terus. */
const UNDUHAN_DB_NAME = 'laundry_unduhan';
const UNDUHAN_STORE = 'files';
const UNDUHAN_MAX_ITEMS = 50;
const UNDUHAN_MAX_BACKUP_ITEMS = 200;
const UNDUHAN_MAX_BACKUP_BYTES = 75 * 1024 * 1024;
var unduhanCategoryFilter = 'all';

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
async function saveToDownloadsGallery(blob, filename, options){
  try{
    const opts = options || {};
    const category = opts.category === 'backup_nota' ? 'backup_nota' : 'umum';
    const ownerId = category === 'backup_nota' ? String(opts.ownerId || '') : '';
    if(category === 'backup_nota' && !ownerId) return false;
    const db = await openUnduhanDB();
    const id = 'dl-' + Date.now() + '-' + Math.random().toString(36).slice(2,8);
    const record = { id, filename, blob, type: blob.type||'', category, ownerId, size: Number(blob.size)||0, createdAt: Date.now() };
    await new Promise((resolve, reject) => {
      const tx = db.transaction(UNDUHAN_STORE, 'readwrite');
      tx.objectStore(UNDUHAN_STORE).put(record);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    await pruneUnduhanOldEntries(db);
    return category !== 'backup_nota' || !!(await getUnduhanEntry(id));
  }catch(e){ return false; }
}
function pruneUnduhanOldEntries(db){
  return new Promise((resolve) => {
    const tx = db.transaction(UNDUHAN_STORE, 'readwrite');
    const store = tx.objectStore(UNDUHAN_STORE);
    const idx = store.index('createdAt');
    let umumCount = 0;
    const backupStats = new Map();
    idx.openCursor(null, 'prev').onsuccess = (e) => {
      const cursor = e.target.result;
      if(!cursor) return;
      const item = cursor.value || {};
      if(item.category === 'backup_nota' && item.ownerId){
        const ownerId = String(item.ownerId);
        const stats = backupStats.get(ownerId) || { count:0, bytes:0 };
        const size = Number(item.size) || Number(item.blob && item.blob.size) || 0;
        if(stats.count >= UNDUHAN_MAX_BACKUP_ITEMS || stats.bytes + size > UNDUHAN_MAX_BACKUP_BYTES){
          store.delete(cursor.primaryKey);
        }else{
          stats.count++;
          stats.bytes += size;
          backupStats.set(ownerId, stats);
        }
      }else if(umumCount >= UNDUHAN_MAX_ITEMS){
        store.delete(cursor.primaryKey);
      }else{
        umumCount++;
      }
      cursor.continue();
    };
    tx.oncomplete = resolve;
    tx.onerror = () => resolve();
  });
}
async function loadUnduhanList(category, ownerId){
  try{
    const db = await openUnduhanDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(UNDUHAN_STORE, 'readonly');
      const idx = tx.objectStore(UNDUHAN_STORE).index('createdAt');
      const results = [];
      idx.openCursor(null, 'prev').onsuccess = (e) => {
        const cursor = e.target.result;
        if(cursor){ results.push(cursor.value); cursor.continue(); }
        else{
          const filtered = category === 'backup_nota'
            ? results.filter(item => item.category === 'backup_nota' && ownerId && String(item.ownerId) === String(ownerId))
            : results;
          resolve(filtered);
        }
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
var unduhanPreview = null;
function closeUnduhanPreview(){
  if(!unduhanPreview) return;
  try{ URL.revokeObjectURL(unduhanPreview.url); }catch(e){}
  unduhanPreview.element.remove();
  unduhanPreview = null;
}
async function openUnduhanModal(category){
  unduhanCategoryFilter = category === 'backup_nota' ? 'backup_nota' : 'all';
  document.getElementById('unduhanModal').classList.add('show');
  await renderUnduhanList();
}
async function showUnduhanCategory(category){
  unduhanCategoryFilter = category === 'backup_nota' ? 'backup_nota' : 'all';
  await renderUnduhanList();
}
function closeUnduhanModal(){ document.getElementById('unduhanModal').classList.remove('show'); }
async function renderUnduhanList(){
  const el = document.getElementById('unduhanList');
  const ownerId = (typeof shopOwnerId !== 'undefined' && shopOwnerId) ? String(shopOwnerId) : '';
  const items = await loadUnduhanList(unduhanCategoryFilter, ownerId);
  const tabs = `<div class="row2" style="margin:0 0 12px;">
    <button class="btn ${unduhanCategoryFilter==='all'?'btn-primary':'btn-outline'} btn-sm" type="button" onclick="showUnduhanCategory('all')">${t('Semua File')}</button>
    <button class="btn ${unduhanCategoryFilter==='backup_nota'?'btn-primary':'btn-outline'} btn-sm" type="button" onclick="showUnduhanCategory('backup_nota')">${t('Arsip Backup Nota')}</button>
  </div>`;
  if(items.length===0){
    el.innerHTML = tabs + `<div class="empty">
      <svg class="bubble-icon" viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="21" stroke="#146C8E" stroke-width="2" opacity="0.4"/><circle cx="24" cy="24" r="12" stroke="#5FC9BE" stroke-width="2"/></svg>
      <h3>${unduhanCategoryFilter==='backup_nota' ? t('Belum ada backup nota') : t('Belum ada file')}</h3>
      <p>${unduhanCategoryFilter==='backup_nota' ? t('JPG dari fitur backup akan tersimpan di arsip ini setelah kamu membuat backup nota.') : t('Nota/laporan yang kamu unduh akan tersimpan di sini juga, supaya gampang dibuka lagi tanpa keluar dari app.')}</p>
    </div>`;
    return;
  }
  el.innerHTML = tabs + items.map(it => `
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
  if(record.category === 'backup_nota' && (record.type === 'image/jpeg' || /\\.jpe?g$/i.test(record.filename||''))){
    closeUnduhanPreview();
    const url = URL.createObjectURL(record.blob);
    const overlay = document.createElement('div');
    overlay.id = 'unduhanPreview';
    overlay.className = 'modal-bg show';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.style.zIndex = '10002';
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.maxWidth = '680px';
    modal.style.maxHeight = '90vh';
    modal.style.overflow = 'auto';
    const close = document.createElement('button');
    close.className = 'modal-close';
    close.type = 'button';
    close.setAttribute('aria-label', t('Tutup'));
    close.textContent = '✕';
    close.addEventListener('click', closeUnduhanPreview);
    const title = document.createElement('h3');
    title.textContent = record.filename;
    const image = document.createElement('img');
    image.src = url;
    image.alt = record.filename;
    image.style.display = 'block';
    image.style.maxWidth = '100%';
    image.style.maxHeight = '70vh';
    image.style.objectFit = 'contain';
    image.style.margin = '0 auto';
    modal.append(close, title, image);
    overlay.appendChild(modal);
    overlay.addEventListener('click', event => {
      if(event.target === overlay) closeUnduhanPreview();
    });
    document.body.appendChild(overlay);
    unduhanPreview = { element:overlay, url };
    return;
  }
  const url = URL.createObjectURL(record.blob);
  window.open(url, '_blank');
  setTimeout(()=> URL.revokeObjectURL(url), 60000);
}
/* "Bagikan" membuka dialog Share bawaan OS (WhatsApp, WhatsApp Business,
   email, AirDrop/Nearby Share, dll -- apa pun yang terdaftar di perangkat)
   lewat Web Share API. SENGAJA TIDAK memakai gate isMobileDevice() seperti
   shareOrDownloadNotaImage() (js/10-nota-cetak.js) -- gate itu ada supaya
   nota yang BARU DIBUAT tetap punya jalan "simpan" di desktop (Share OS
   desktop kadang tidak punya opsi simpan biasa). Di galeri Unduhan, filenya
   SUDAH tersimpan (itu tujuan galeri ini), jadi tidak butuh fallback simpan
   -- yang dibutuhkan justru share-nya beneran jalan. Chrome/Edge desktop
   modern (Windows 10/11) mendukung navigator.share() dengan file lewat
   panel Share asli OS; browser yang sama sekali tidak mendukung baru
   fallback ke unduh biasa. */
async function shareUnduhanEntry(id){
  const record = await getUnduhanEntry(id);
  if(!record){ showToast(t('File tidak ditemukan')); return; }
  try{
    const file = new File([record.blob], record.filename, { type: record.type || record.blob.type || '' });
    if(navigator.canShare && navigator.canShare({ files:[file] })){
      await navigator.share({ files:[file], title: record.filename });
      return;
    }
  }catch(e){ /* dibatalkan atau tidak didukung, lanjut unduh biasa */ }
  const url = URL.createObjectURL(record.blob);
  const a = document.createElement('a');
  a.href = url; a.download = record.filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(()=> URL.revokeObjectURL(url), 5000);
  showToast(t('Berbagi file tidak didukung browser ini -- file diunduh ulang ke folder Download sebagai gantinya.'));
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
