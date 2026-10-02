/* ===================== TRIAL & LANGGANAN APLIKASI ===================== */
async function ensureAppSubscription(ownerId, isSelf){
  try{
    const { data, error } = await sb.from('app_subscriptions').select('*').eq('owner_id', ownerId).maybeSingle();
    if(data){ appSubscription = data; renderSubscriptionBadge(); return; }
    if(error || !isSelf){ appSubscription = null; renderSubscriptionBadge(); return; }
    let paidSignup = false, referredBy = null;
    try{
      paidSignup = localStorage.getItem('nk_paidSignup') === '1';
      referredBy = localStorage.getItem('nk_referredBy') || null;
    }catch(e){}
    const now = new Date();
    const trialEnds = new Date(now.getTime() + 30*24*60*60*1000).toISOString();
    const insertRow = paidSignup
      ? { owner_id: ownerId, status: 'aktif', trial_ends_at: now.toISOString(), paid_until: trialEnds }
      : { owner_id: ownerId, status: 'trial', trial_ends_at: trialEnds };
    /* Akun baru yang daftar pakai kode referral tetap mulai dari trial biasa
       (lihat komentar di js/01-auth.js) -- cuma dicatat SIAPA yang
       mereferensikannya di sini, supaya bonus 15 hari buat akun ini DAN buat
       si perefensi bisa dikreditkan nanti begitu akun ini benar-benar bayar
       (lihat apply_referral_bonus_if_pending() di README). */
    if(referredBy) insertRow.referred_by_owner_id = referredBy;
    const { data: created, error: insErr } = await sb.from('app_subscriptions').insert(insertRow).select().single();
    if(paidSignup){ try{ localStorage.removeItem('nk_paidSignup'); }catch(e){} }
    if(referredBy){ try{ localStorage.removeItem('nk_referredBy'); }catch(e){} }
    appSubscription = insErr ? null : created;
    renderSubscriptionBadge();
  }catch(e){
    appSubscription = null;
    renderSubscriptionBadge();
  }
}
function isSubscriptionActive(){
  if(!appSubscription) return true; // gagal muat data -> jangan kunci user karena bug jaringan
  if(appSubscription.status === 'aktif'){
    if(!appSubscription.paid_until) return true;
    return new Date(appSubscription.paid_until) >= new Date();
  }
  if(appSubscription.status === 'trial'){
    return new Date(appSubscription.trial_ends_at) >= new Date();
  }
  return false;
}
function subscriptionDaysLeft(){
  if(!appSubscription) return null;
  const end = appSubscription.status === 'aktif' ? appSubscription.paid_until : appSubscription.trial_ends_at;
  if(!end) return null;
  return Math.ceil((new Date(end) - new Date()) / (1000*60*60*24));
}
function renderSubscriptionBadge(){
  const el = document.getElementById('subStatusBadge');
  const setEl = document.getElementById('settingsSubStatus');
  if(setEl){
    if(!appSubscription){ setEl.textContent = ''; }
    else {
      const d = subscriptionDaysLeft();
      if(appSubscription.status === 'trial') setEl.textContent = isSubscriptionActive() ? `${t('Trial')}, ${d} ${t('hari lagi')}` : t('Trial berakhir');
      else if(isSubscriptionActive() && isLifetimePaidUntil(appSubscription.paid_until)) setEl.textContent = `${t('Aktif')} — ${t('Seumur Hidup')}`;
      else setEl.textContent = isSubscriptionActive() ? `${t('Aktif s.d.')} ${fmtDate((appSubscription.paid_until||'').slice(0,10))}` : t('Tidak aktif');
    }
  }
  if(!el) return;
  if(!appSubscription){ el.style.display = 'none'; return; }
  const days = subscriptionDaysLeft();
  const active = isSubscriptionActive();
  el.style.display = 'block';
  if(!active){
    el.innerHTML = `⚠️ ${t('Trial berakhir')} — <a href="#" onclick="showPaywallModal();return false;" style="color:#fff;text-decoration:underline;">${t('perpanjang sekarang')}</a>`;
    el.style.background = 'var(--danger, #d33)';
  } else if(appSubscription.status === 'trial'){
    el.innerHTML = `${t('Trial')}: ${days} ${t('hari lagi')} — <a href="#" onclick="showPaywallModal();return false;" style="color:#fff;text-decoration:underline;">${t('aktifkan langganan')}</a>`;
    el.style.background = '#c8860a';
  } else if(appSubscription.status === 'aktif' && appSubscription.paid_until && days !== null && days <= 5){
    el.innerHTML = `${t('Langganan berakhir')} ${days} ${t('hari lagi')} — <a href="#" onclick="showPaywallModal();return false;" style="color:#fff;text-decoration:underline;">${t('perpanjang')}</a>`;
    el.style.background = '#c8860a';
  } else {
    el.style.display = 'none';
  }
}
function showPaywallModal(){
  renderPlanSelectOptions('paywallPlan');
  updatePlanAmountDisplay('paywallPlan', 'paywallAmount');
  updateMidtransButtonVisibility();
  const modal = document.getElementById('paywallModal');
  if(modal) modal.classList.add('show');
}
function closePaywallModal(){
  const modal = document.getElementById('paywallModal');
  if(modal) modal.classList.remove('show');
}
/* Beda dari sb.functions.invoke() (itu khusus Supabase Edge Functions) --
   ini fetch biasa ke Netlify Function (lihat netlify/functions/midtrans-
   create-transaction.js). Server Key Midtrans yang rahasia cuma ada di
   function itu, tidak pernah dikirim ke browser. */
async function payViaMidtrans(){
  const btn = document.getElementById('btnPayMidtrans');
  if(!shopOwnerId){ showToast(t('Data toko belum siap')); return; }
  const plan = document.getElementById('paywallPlan').value;
  const nama = (settings && settings.shopName) ? settings.shopName : t('Toko');
  const wa = (settings && settings.phone) ? settings.phone : '';
  if(btn){ btn.disabled = true; btn.textContent = t('Memproses...'); }
  try{
    const res = await fetch('/.netlify/functions/midtrans-create-transaction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nama, wa, owner_id: shopOwnerId, plan })
    });
    const data = await res.json().catch(()=>null);
    if(!res.ok || !data || !data.redirect_url){
      showToast(t('Gagal membuat tagihan, coba lagi atau pakai transfer manual'));
      if(btn){ btn.disabled = false; btn.textContent = t('💳 Bayar Otomatis (QRIS / VA / E-wallet)'); }
      return;
    }
    window.open(data.redirect_url, '_blank');
    showToast(t('Halaman pembayaran dibuka. Langganan aktif otomatis setelah bayar.'));
    closePaywallModal();
  }catch(e){
    showToast(t('Gagal membuat tagihan, coba lagi atau pakai transfer manual'));
  }
  if(btn){ btn.disabled = false; btn.textContent = t('💳 Bayar Otomatis (QRIS / VA / E-wallet)'); }
}
/* Isi <select id="selectId"> dari SUBSCRIPTION_PLANS (satu-satunya sumber
   harga TAMPILAN, lihat komentar di js/00-globals.js) -- dipakai untuk
   dropdown paket di paywallModal (perpanjangan) MAUPUN paymentInfoModal
   (pendaftaran baru), supaya keduanya selalu menyebut paket & harga yang
   sama persis, tidak ditulis manual dua kali yang bisa kebablasan beda. */
function renderPlanSelectOptions(selectId){
  const sel = document.getElementById(selectId);
  if(!sel || sel.dataset.filled) return;
  sel.innerHTML = Object.keys(SUBSCRIPTION_PLANS).map(key=>{
    const p = SUBSCRIPTION_PLANS[key];
    const hematTxt = p.hemat>0 ? ` (${t('hemat')} ${p.hemat}%${key==='12bulan' ? ', '+t('paling hemat') : ''})` : '';
    return `<option value="${key}"${key==='12bulan'?' selected':''}>${p.label} — ${rupiah(p.harga)}${hematTxt}</option>`;
  }).join('');
  sel.dataset.filled = '1';
}
/* Teks "Jumlah transfer" yang ditampilkan di dekat QRIS/rekening bank,
   dan disebutkan juga di pesan WA konfirmasi -- supaya admin & pengguna
   sama-sama tahu pasti nominalnya, tidak cuma nomor rekening kosongan. */
function updatePlanAmountDisplay(selectId, displayId){
  const sel = document.getElementById(selectId);
  const disp = document.getElementById(displayId);
  if(!sel || !disp) return;
  const p = SUBSCRIPTION_PLANS[sel.value];
  disp.textContent = p ? `${t('Jumlah transfer')}: ${rupiah(p.harga)} (${t('Paket')} ${p.label})` : '';
}
async function requestRenewal(){
  if(!shopOwnerId){ showToast(t('Data toko belum siap')); return; }
  const nama = (settings && settings.shopName) ? settings.shopName : t('Toko');
  const wa = (settings && settings.phone) ? settings.phone : '';
  const plan = SUBSCRIPTION_PLANS[document.getElementById('paywallPlan').value];
  const planTxt = plan ? `${plan.label} (${rupiah(plan.harga)})` : '';
  const { error } = await sb.from('payment_requests').insert({
    nama, wa, catatan: `${t('Perpanjangan langganan aplikasi')} — ${t('Paket')} ${planTxt}`,
    status: 'menunggu', type: 'perpanjangan', owner_id: shopOwnerId,
    plan_days: plan ? plan.hari : 30
  });
  if(error){ showToast(t('Gagal mengirim permintaan, coba lagi')); return; }
  showToast(t('Permintaan perpanjangan terkirim, admin akan verifikasi'));
  const waNum = String(ADMIN_WA || '6285696487884').replace(/[^0-9]/g,'');
  const text = encodeURIComponent(`${t('Halo admin, saya mau perpanjang langganan Dokter Laundry untuk toko')} "${nama}", ${t('Paket')} ${planTxt}. ${t('Berikut bukti pembayarannya.')}`);
  window.open(`https://wa.me/${waNum}?text=${text}`, '_blank');
  closePaywallModal();
}

/* ===================== PROGRAM REFERRAL ===================== */
/* Kode referral numpang di tabel registration_codes yang sudah ada
   (kolom baru referrer_owner_id, lihat README) -- BEDA dari kode admin
   biasa: statusnya tetap 'aktif' selamanya (sengaja bisa dipakai ulang
   oleh banyak orang, bukan sekali pakai), supaya 1 toko bisa membagikan
   kode yang sama ke banyak calon pelanggan. Tiap kali ada yang daftar
   pakai kode ini, redeem_registration_code() (RPC, dipanggil dari
   js/01-auth.js/02-init-data.js saat signup) otomatis menambah 15 hari
   ke langganan pemilik kode -- bukan di sini, supaya kreditnya tetap
   berjalan walau pemilik kode sedang offline saat kode itu dipakai. */
async function getOrCreateReferralCode(){
  if(!shopOwnerId) return null;
  const { data: existing } = await sb.from('registration_codes').select('code').eq('referrer_owner_id', shopOwnerId).limit(1).maybeSingle();
  if(existing && existing.code) return existing.code;
  const code = 'REF-' + genRegCode();
  const { data, error } = await sb.from('registration_codes').insert({ code, status:'aktif', referrer_owner_id: shopOwnerId, note:'Kode referral' }).select().single();
  return error ? null : data.code;
}
async function loadReferralCode(){
  const el = document.getElementById('referralCodeDisplay');
  if(!el) return;
  el.textContent = t('Memuat...');
  const code = await getOrCreateReferralCode();
  el.textContent = code || t('Gagal memuat kode');
}
async function shareReferral(){
  const el = document.getElementById('referralCodeDisplay');
  const stale = !el || el.textContent === t('Memuat...') || el.textContent === t('Gagal memuat kode');
  const code = stale ? await getOrCreateReferralCode() : el.textContent;
  if(!code){ showToast(t('Gagal membuat kode referral, coba lagi')); return; }
  if(el) el.textContent = code;
  const text = `${t('Saya pakai Dokter Laundry buat kasir & nota laundry toko saya, gampang banget!')} ${t('Coba juga -- pas Daftar, isi Kode Pendaftaran ini. Begitu akun barumu aktif berbayar, kita berdua sama-sama dapat bonus 15 hari gratis:')} ${code}\n\nhttps://laundryassist.netlify.app`;
  try{
    if(navigator.share){
      await navigator.share({ title:'Dokter Laundry', text });
      return;
    }
  }catch(e){
    if(e && e.name==='AbortError') return; // user sengaja batal, jangan fallback ke WA
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
}

