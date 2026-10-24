/* ===================== MODE OFFLINE (Tahap 1: buka & baca) =====================
   Tujuan: app bisa DIBUKA tanpa internet dan menampilkan data terakhir yang
   pernah dimuat. (Tahap 2 menambah antrean transaksi + sinkron otomatis.)

   Cara kerja:
   1. Setiap kali data berhasil dimuat online, salinan ("snapshot") seluruh
      state toko disimpan ke IndexedDB. Disimpan lagi berkala (offlineSaveSnapshot)
      supaya transaksi yang dibuat saat online ikut ada di snapshot.
   2. Saat app dibuka tanpa internet (atau server tidak terjangkau), state
      dipulihkan dari snapshot itu -- BUKAN lewat query Supabase -- dan banner
      "Mode offline" tampil.
   3. Begitu internet kembali, app memuat ulang data asli dari server.

   Snapshot dihapus saat user keluar akun (handleLogout), supaya data toko
   tidak tertinggal di perangkat yang dipakai orang lain.

   Semua akses IndexedDB dibungkus try/catch: di mode privat / penyimpanan
   diblokir, app tetap jalan normal seperti sebelumnya, hanya tanpa offline. */

var offlineMode = false; // true selama state berasal dari snapshot, bukan dari server
/* true HANYA setelah initUserData() (js/05-admin.js) selesai memuat semua data.
   Selama pemuatan, array global baru terisi sebagian -- snapshot yang disimpan
   saat itu bisa menimpa data lengkap dengan data setengah jadi. */
var offlineDataReady = false;
var OFFLINE_DB_NAME = 'nk-offline';
var OFFLINE_DB_VERSION = 2;
var OFFLINE_STORE = 'kv';
var OFFLINE_QUEUE_STORE = 'queue';
var OFFLINE_SNAPSHOT_KEY = 'snapshot';
var OFFLINE_SNAPSHOT_VERSION = 1;
var OFFLINE_SAVE_INTERVAL_MS = 60000;
var OFFLINE_PROBE_TIMEOUT_MS = 4000;

/* ---------- IndexedDB (key-value + queue) ---------- */
function offlineOpenDB(){
  return new Promise((resolve, reject) => {
    if(typeof indexedDB === 'undefined'){ reject(new Error('IndexedDB tidak tersedia')); return; }
    let req;
    try{ req = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION); }catch(e){ reject(e); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if(!db.objectStoreNames.contains(OFFLINE_STORE)) db.createObjectStore(OFFLINE_STORE);
      if(!db.objectStoreNames.contains(OFFLINE_QUEUE_STORE)) db.createObjectStore(OFFLINE_QUEUE_STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Gagal membuka IndexedDB'));
  });
}
async function offlineIdbGet(key){
  const db = await offlineOpenDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORE, 'readonly');
    const r = tx.objectStore(OFFLINE_STORE).get(key);
    r.onsuccess = () => { db.close(); resolve(r.result); };
    r.onerror = () => { db.close(); reject(r.error); };
  });
}
async function offlineIdbSet(key, value){
  const db = await offlineOpenDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORE, 'readwrite');
    tx.objectStore(OFFLINE_STORE).put(value, key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error || new Error('Transaksi IndexedDB dibatalkan')); };
  });
}
async function offlineIdbDel(key){
  const db = await offlineOpenDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORE, 'readwrite');
    tx.objectStore(OFFLINE_STORE).delete(key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

/* ---------- Antrean aksi offline (queue) ---------- */
async function offlineEnqueue(actionType, payload){
  try{
    const db = await offlineOpenDB();
    const item = {
      id: 'q_' + Date.now() + '_' + Math.random().toString(36).slice(2,8),
      type: actionType,
      payload: JSON.parse(JSON.stringify(payload)),
      createdAt: Date.now()
    };
    await new Promise((resolve, reject) => {
      const tx = db.transaction(OFFLINE_QUEUE_STORE, 'readwrite');
      tx.objectStore(OFFLINE_QUEUE_STORE).put(item);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
    offlineUpdateBanner();
    return item;
  }catch(e){
    console.warn('Gagal menyimpan ke antrean offline:', e);
    return null;
  }
}
async function offlineGetQueue(){
  try{
    const db = await offlineOpenDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(OFFLINE_QUEUE_STORE, 'readonly');
      const req = tx.objectStore(OFFLINE_QUEUE_STORE).getAll();
      req.onsuccess = () => {
        db.close();
        const res = req.result || [];
        res.sort((a,b) => a.createdAt - b.createdAt);
        resolve(res);
      };
      req.onerror = () => { db.close(); reject(req.error); };
    });
  }catch(e){
    return [];
  }
}
async function offlineRemoveFromQueue(id){
  try{
    const db = await offlineOpenDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(OFFLINE_QUEUE_STORE, 'readwrite');
      tx.objectStore(OFFLINE_QUEUE_STORE).delete(id);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
    offlineUpdateBanner();
  }catch(e){}
}
async function offlineSyncQueue(){
  const queue = await offlineGetQueue();
  if(!queue || queue.length === 0) return 0;
  let syncedCount = 0;
  for(const item of queue){
    try{
      let err = null;
      if(item.type === 'ADD_TRANSACTION'){
        const p = item.payload;
        const { error } = await sb.from('transactions').insert(p);
        err = error;
      } else if(item.type === 'UPDATE_WORK_STATUS'){
        const { table, id, work_status } = item.payload;
        const { error } = await sb.from(table).update({ work_status }).eq('id', id);
        err = error;
      } else if(item.type === 'MARK_LUNAS'){
        const { id, lunas_at } = item.payload;
        const { error } = await sb.from('transactions').update({ status: 'lunas', lunas_at }).eq('id', id);
        err = error;
      } else if(item.type === 'ADD_EXPENSE'){
        const p = item.payload;
        const { error } = await sb.from('expenses').insert(p);
        err = error;
      } else if(item.type === 'ADD_USAGE'){
        const p = item.payload;
        const { error } = await sb.from('subscription_usage').insert(p);
        err = error;
      }
      if(!err || !offlineIsNetworkError(err)){
        await offlineRemoveFromQueue(item.id);
        if(!err) syncedCount++;
      } else {
        break;
      }
    }catch(e){
      if(!offlineIsNetworkError(e)) await offlineRemoveFromQueue(item.id);
      else break;
    }
  }
  return syncedCount;
}

/* ---------- Snapshot state toko ---------- */
function offlineBuildSnapshot(){
  return {
    v: OFFLINE_SNAPSHOT_VERSION,
    savedAt: Date.now(),
    userId: currentUser ? currentUser.id : null,
    userEmail: currentUser ? currentUser.email : null,
    role: currentRole,
    shopOwnerId: shopOwnerId,
    employeeName: employeeName,
    kasirOutletId: kasirOutletId,
    currentOutletId: currentOutletId,
    settings: settings,
    appBranding: appBranding,
    transactions: transactions,
    transactionsWindowStart: transactionsWindowStart,
    transactionsFullyLoaded: transactionsFullyLoaded,
    serviceCatalog: serviceCatalog,
    subscriptions: subscriptions,
    allWorkUsage: allWorkUsage,
    savedContacts: savedContacts,
    expenses: expenses,
    expenseCatalog: expenseCatalog,
    notes: notes,
    outlets: outlets,
    appSubscription: appSubscription
  };
}
/* Simpan snapshot. Tidak menyimpan kalau: belum login/data toko belum siap,
   sedang berjalan dari snapshot (state-nya bukan data segar dari server --
   Tahap 2 menyimpan sendiri lewat jalur antrean), data belum selesai dimuat
   (offlineDataReady), atau offlineSnapshotPaused (dipasang sementara saat
   logout supaya timer tidak menulis ulang snapshot yang baru dihapus). */
var offlineSnapshotPaused = false;
async function offlineSaveSnapshot(){
  if(offlineSnapshotPaused || offlineMode || !offlineDataReady) return false;
  if(!currentUser || !shopOwnerId) return false;
  try{
    const snap = offlineBuildSnapshot();
    /* Pengaman: kalau pemuatan transaksi gagal (toast "Gagal memuat data
       transaksi", array tetap kosong) jangan timpa snapshot lama yang masih
       berisi transaksi milik toko yang sama dengan data kosong. */
    if(snap.transactions.length === 0){
      const prev = await offlineLoadSnapshot();
      if(prev && prev.shopOwnerId === snap.shopOwnerId && prev.transactions && prev.transactions.length > 0) return false;
    }
    try{
      await offlineIdbSet(OFFLINE_SNAPSHOT_KEY, snap);
    }catch(e){
      // structured clone gagal (mis. ada nilai yang tidak bisa diklon) --
      // ulangi lewat JSON, yang membuang nilai semacam itu.
      if(e && e.name === 'DataCloneError') await offlineIdbSet(OFFLINE_SNAPSHOT_KEY, JSON.parse(JSON.stringify(snap)));
      else throw e;
    }
    return true;
  }catch(e){
    console.warn('Snapshot offline gagal disimpan:', e);
    return false;
  }
}
async function offlineLoadSnapshot(){
  try{
    const s = await offlineIdbGet(OFFLINE_SNAPSHOT_KEY);
    if(!s || s.v !== OFFLINE_SNAPSHOT_VERSION || !s.userId || !s.shopOwnerId) return null;
    return s;
  }catch(e){
    return null;
  }
}
async function offlineClearSnapshot(){
  try{ await offlineIdbDel(OFFLINE_SNAPSHOT_KEY); }catch(e){}
}
function offlineApplySnapshot(s){
  currentUser = { id: s.userId, email: s.userEmail, offlineRestored: true };
  currentRole = s.role || 'owner';
  shopOwnerId = s.shopOwnerId;
  employeeName = s.employeeName || '';
  kasirOutletId = s.kasirOutletId != null ? s.kasirOutletId : null;
  currentOutletId = s.currentOutletId != null ? s.currentOutletId : null;
  if(s.settings) settings = s.settings;
  if(s.appBranding) appBranding = s.appBranding;
  transactions = s.transactions || [];
  transactionsWindowStart = s.transactionsWindowStart != null ? s.transactionsWindowStart : null;
  transactionsFullyLoaded = !!s.transactionsFullyLoaded;
  serviceCatalog = s.serviceCatalog || [];
  subscriptions = s.subscriptions || [];
  allWorkUsage = s.allWorkUsage || [];
  savedContacts = s.savedContacts || [];
  expenses = s.expenses || [];
  expenseCatalog = s.expenseCatalog || [];
  notes = s.notes || [];
  outlets = s.outlets || [];
  appSubscription = s.appSubscription || null;
}

/* ---------- Boot dari snapshot ---------- */
function offlineRestoreLastTab(){
  // Sama seperti akhir initUserData() (js/05-admin.js).
  let lastTab = 'baru';
  try{
    const saved = localStorage.getItem('nk_lastTab');
    if(saved && ['baru','riwayat','paket','laporan','pengeluaran','papan'].includes(saved)) lastTab = saved;
  }catch(e){}
  switchTab(lastTab);
}
/* expectedUserId (opsional): kalau ada sesi login yang terbaca, snapshot HANYA
   dipakai kalau milik user yang sama -- jangan sampai data toko orang lain di
   perangkat yang sama muncul untuk akun lain. */
async function offlineBootFromSnapshot(expectedUserId){
  const s = await offlineLoadSnapshot();
  if(!s) return false;
  if(expectedUserId && s.userId !== expectedUserId) return false;
  offlineApplySnapshot(s);
  offlineMode = true;
  const authEl = document.getElementById('authScreen');
  if(authEl) authEl.classList.add('hidden');
  const onb = document.getElementById('onboardingScreen');
  if(onb) onb.classList.remove('show');
  applyRoleUI();
  applySettingsToUI();
  renderSubscriptionBadge();
  renderOutletSwitcherLabel();
  populateReportOutletFilter();
  renderAll();
  offlineRestoreLastTab();
  await offlineUpdateBanner();
  return true;
}

/* ---------- Deteksi koneksi ---------- */
/* navigator.onLine cuma tahu "ada jaringan", bukan "server terjangkau" --
   di HP sinyal macet nilainya tetap true. Probe singkat ke Supabase untuk
   kasus itu. Respons apa pun (termasuk 401/404) berarti server terjangkau. */
async function offlineProbeConnection(){
  if(navigator.onLine === false) return false;
  try{
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), OFFLINE_PROBE_TIMEOUT_MS) : null;
    await fetch(SUPABASE_URL + '/auth/v1/health', {
      method: 'GET',
      headers: { apikey: SUPABASE_KEY },
      cache: 'no-store',
      signal: ctrl ? ctrl.signal : undefined
    });
    if(timer) clearTimeout(timer);
    return true;
  }catch(e){
    return false;
  }
}
/* Apakah error dari supabase-js akibat jaringan (bukan error aplikasi seperti
   izin/RLS)? Dipakai supaya error asli tetap diperlakukan seperti biasa. */
function offlineIsNetworkError(err){
  if(!err) return false;
  if(navigator.onLine === false) return true;
  const txt = [err.message, err.details, err.hint, err.name].filter(Boolean).join(' ');
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed|err_internet|err_network|timed? ?out|aborted/i.test(txt);
}
/* Dipakai resolveRoleAndInit() (js/02-init-data.js) saat pemeriksaan peran gagal
   karena error jaringan: jangan salah mengira ini "akun baru" lalu menampilkan
   layar pilih peran. Kembalikan true kalau berhasil jalan dari snapshot. */
async function offlineFallbackOrNotify(expectedUserId){
  if(await offlineBootFromSnapshot(expectedUserId)) return true;
  showToast(t('Tidak bisa terhubung ke server. Periksa internet lalu muat ulang halaman.'));
  return false;
}

/* ---------- Banner status ---------- */
async function offlineUpdateBanner(){
  const el = document.getElementById('offlineBanner');
  if(!el) return;
  const isOff = offlineMode || navigator.onLine === false;
  if(!isOff){ el.style.display = 'none'; return; }
  el.style.display = 'block';
  let queueCount = 0;
  try{ const q = await offlineGetQueue(); queueCount = q ? q.length : 0; }catch(e){}
  if(queueCount > 0){
    el.textContent = t('📴 Mode offline — ') + queueCount + t(' perubahan tersimpan di perangkat. Akan disinkronkan otomatis saat internet kembali.');
  } else {
    el.textContent = t('📴 Mode offline — menampilkan data terakhir. Transaksi & perubahan tersimpan di perangkat saat offline.');
  }
}

/* Dipanggil listener sesi (index.html) saat TIDAK ada sesi login. Kalau
   penyebabnya offline, buka dari snapshot; kalau tidak, layar login tetap
   tampil (plus tombol "Lanjut offline" kalau server tidak terjangkau). */
async function offlineHandleNoSession(){
  const authEl = document.getElementById('authScreen');
  if(offlineMode){
    if(authEl) authEl.classList.add('hidden');
    return;
  }
  if(navigator.onLine === false){
    if(await offlineBootFromSnapshot()) return;
  }
  offlineRefreshAuthShortcut();
}

/* Tombol "Lanjut offline" di layar login: untuk kasus sinyal macet (navigator.onLine
   true tapi server tidak terjangkau) di mana sesi gagal dipulihkan otomatis. */
async function offlineRefreshAuthShortcut(){
  const btn = document.getElementById('offlineContinueBtn');
  if(!btn) return;
  const s = await offlineLoadSnapshot();
  if(!s){ btn.style.display = 'none'; return; }
  const reachable = await offlineProbeConnection();
  btn.style.display = reachable ? 'none' : 'block';
}
async function offlineContinueFromAuth(){
  const ok = await offlineBootFromSnapshot();
  if(!ok) showToast(t('Belum ada data offline di perangkat ini. Masuk saat ada internet dulu.'));
}

/* ---------- Kembali online ---------- */
var offlineReconnecting = false;
async function offlineHandleBackOnline(){
  offlineUpdateBanner();
  if(!offlineMode || offlineReconnecting) return;
  offlineReconnecting = true;
  try{
    const synced = await offlineSyncQueue();
    if(synced > 0){
      showToast(synced + ' ' + t('perubahan offline berhasil disinkronkan ke server'));
    }
    const { data } = await sb.auth.getSession();
    const session = data && data.session;
    if(session && session.user){
      offlineMode = false;
      currentUser = session.user;
      offlineUpdateBanner();
      await resolveRoleAndInit(); // muat ulang data asli dari server
    } else {
      // Sesi sudah tidak sah (kedaluwarsa/dicabut) -- minta login ulang.
      // Snapshot sengaja dibiarkan; login berikutnya menggantinya dengan data segar.
      offlineMode = false;
      currentUser = null;
      offlineUpdateBanner();
      const authEl = document.getElementById('authScreen');
      if(authEl) authEl.classList.remove('hidden');
    }
  }catch(e){
    // masih belum benar-benar tersambung; tetap di mode offline
  }finally{
    offlineReconnecting = false;
  }
}

/* ---------- Pemasangan ---------- */
window.addEventListener('online', () => { offlineHandleBackOnline(); });
window.addEventListener('offline', () => {
  offlineUpdateBanner();
  offlineSaveSnapshot(); // simpan keadaan terakhir selagi masih sempat
});
document.addEventListener('visibilitychange', () => {
  if(document.visibilityState === 'hidden') offlineSaveSnapshot();
});
window.addEventListener('pagehide', () => { offlineSaveSnapshot(); });
setInterval(() => {
  if(navigator.onLine !== false) offlineSaveSnapshot();
}, OFFLINE_SAVE_INTERVAL_MS);
document.addEventListener('DOMContentLoaded', offlineUpdateBanner);
