/* ===================== UTIL ===================== */
function rupiah(n){
  n = Math.round(n||0);
  return 'Rp' + n.toLocaleString('id-ID');
}
function fmtDate(iso){
  if(!iso) return '-';
  const d = new Date(iso+'T00:00:00');
  return d.toLocaleDateString('id-ID', { day:'2-digit', month:'short', year:'numeric' });
}
function todayISO(){ return new Date().toISOString().slice(0,10); }
/* Uang yang BENAR-BENAR sudah diterima kas dari satu transaksi, apapun
   statusnya. Kalau status "lunas", submitTransaction()/toggleLunas()/
   markSubsLunas() selalu menyimpan dp >= total (dipaksa disamakan kalau
   kasir tidak isi manual) -- jadi field `dp` SELALU merepresentasikan kas
   yang sudah diterima, baik untuk transaksi lunas maupun yang masih
   sebagian dibayar (DP). Dipakai di Laporan/Laba Rugi supaya "Sudah
   Lunas"/"Pemasukan" mencerminkan uang yang benar-benar masuk kas, BUKAN
   nilai order kotor (Omzet) yang belum tentu sudah dibayar -- dan supaya
   Sudah Lunas + Belum Lunas selalu pas dengan Total Omzet/Belanja. */
function trxCashReceived(t){ return t.dp||0; }
function sortByTanggalAsc(list){
  return list.slice().sort((a,b)=> a.tanggal<b.tanggal?-1 : a.tanggal>b.tanggal?1 : 0);
}
const DEFAULT_EXPENSE_CATEGORIES = ['Listrik','Air','Gaji Karyawan','Deterjen & Perlengkapan','Sewa Tempat','Perawatan Mesin','Transportasi','Lain-lain'];
/* action opsional: { label, onClick, duration } — menampilkan tombol di toast
   (mis. "Urungkan") yang menjalankan onClick() kalau ditekan sebelum toast hilang. */
function showToast(msg, action){
  const t = document.getElementById('toast');
  clearTimeout(t._timer);
  if(action){
    t.innerHTML = `<span>${escapeHTML(msg)}</span><button type="button" class="toast-action">${escapeHTML(action.label)}</button>`;
    t.querySelector('.toast-action').onclick = ()=>{
      clearTimeout(t._timer);
      t.classList.remove('show','has-action');
      action.onClick();
    };
    t.classList.add('show','has-action');
    t._timer = setTimeout(()=>t.classList.remove('show','has-action'), action.duration || 6000);
  } else {
    t.innerHTML = '';
    t.textContent = msg;
    t.classList.remove('has-action');
    t.classList.add('show');
    t._timer = setTimeout(()=>t.classList.remove('show'), 2200);
  }
}
function normalizePhone(raw){
  let p = (raw||'').replace(/[^0-9]/g,'');
  if(p.startsWith('0')) p = '62' + p.slice(1);
  else if(!p.startsWith('62')) p = '62' + p;
  return p;
}
/* Bulatkan angka kg ke maks 2 desimal & buang nol berlebih (hindari bug floating point mis. 9.934999999999999) */
function fmtKg(n){
  const r = Math.round(((n||0) + Number.EPSILON) * 100) / 100;
  return (r % 1 === 0) ? String(r) : String(parseFloat(r.toFixed(2)));
}
/* Buka WhatsApp reguler atau WhatsApp Business secara spesifik (Android).
   target: 'wa' | 'wab' | undefined (undefined = biarkan sistem pilih/wa.me biasa) */
function openWA(phone, text, target){
  const encoded = encodeURIComponent(text);
  const waWebUrl = `https://wa.me/${phone}?text=${encoded}`;
  const isAndroid = /Android/i.test(navigator.userAgent);
  if(isAndroid && (target==='wa' || target==='wab')){
    const pkg = target==='wab' ? 'com.whatsapp.w4b' : 'com.whatsapp';
    const fallback = encodeURIComponent(waWebUrl);
    const intentUrl = `intent://send?phone=${phone}&text=${encoded}#Intent;scheme=whatsapp;package=${pkg};S.browser_fallback_url=${fallback};end`;
    window.location.href = intentUrl;
    return;
  }
  window.open(waWebUrl, '_blank');
}
