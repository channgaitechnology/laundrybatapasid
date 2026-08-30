/* ===================== TRIAL & LANGGANAN APLIKASI ===================== */
async function ensureAppSubscription(ownerId, isSelf){
  try{
    const { data, error } = await sb.from('app_subscriptions').select('*').eq('owner_id', ownerId).maybeSingle();
    if(data){ appSubscription = data; renderSubscriptionBadge(); return; }
    if(error || !isSelf){ appSubscription = null; renderSubscriptionBadge(); return; }
    let paidSignup = false;
    try{ paidSignup = localStorage.getItem('nk_paidSignup') === '1'; }catch(e){}
    const now = new Date();
    const trialEnds = new Date(now.getTime() + 30*24*60*60*1000).toISOString();
    const insertRow = paidSignup
      ? { owner_id: ownerId, status: 'aktif', trial_ends_at: now.toISOString(), paid_until: trialEnds }
      : { owner_id: ownerId, status: 'trial', trial_ends_at: trialEnds };
    const { data: created, error: insErr } = await sb.from('app_subscriptions').insert(insertRow).select().single();
    if(paidSignup){ try{ localStorage.removeItem('nk_paidSignup'); }catch(e){} }
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
      if(appSubscription.status === 'trial') setEl.textContent = isSubscriptionActive() ? `Trial, ${d} hari lagi` : 'Trial berakhir';
      else setEl.textContent = isSubscriptionActive() ? `Aktif s.d. ${(appSubscription.paid_until||'').slice(0,10)}` : 'Tidak aktif';
    }
  }
  if(!el) return;
  if(!appSubscription){ el.style.display = 'none'; return; }
  const days = subscriptionDaysLeft();
  const active = isSubscriptionActive();
  el.style.display = 'block';
  if(!active){
    el.innerHTML = '⚠️ Trial berakhir — <a href="#" onclick="showPaywallModal();return false;" style="color:#fff;text-decoration:underline;">perpanjang sekarang</a>';
    el.style.background = 'var(--danger, #d33)';
  } else if(appSubscription.status === 'trial'){
    el.innerHTML = `Trial: ${days} hari lagi — <a href="#" onclick="showPaywallModal();return false;" style="color:#fff;text-decoration:underline;">aktifkan langganan</a>`;
    el.style.background = '#c8860a';
  } else if(appSubscription.status === 'aktif' && appSubscription.paid_until && days !== null && days <= 5){
    el.innerHTML = `Langganan berakhir ${days} hari lagi — <a href="#" onclick="showPaywallModal();return false;" style="color:#fff;text-decoration:underline;">perpanjang</a>`;
    el.style.background = '#c8860a';
  } else {
    el.style.display = 'none';
  }
}
function showPaywallModal(){
  const modal = document.getElementById('paywallModal');
  if(modal) modal.classList.add('show');
}
function closePaywallModal(){
  const modal = document.getElementById('paywallModal');
  if(modal) modal.classList.remove('show');
}
async function payViaXendit(){
  const btn = document.getElementById('btnPayXendit');
  if(!shopOwnerId){ showToast('Data toko belum siap'); return; }
  if(btn){ btn.disabled = true; btn.textContent = 'Memproses...'; }
  try{
    const { data, error } = await sb.functions.invoke('create-invoice', { body: { owner_id: shopOwnerId } });
    if(error || !data || !data.invoice_url){
      showToast('Gagal membuat tagihan, coba lagi atau pakai transfer manual');
      if(btn){ btn.disabled = false; btn.textContent = '💳 Bayar Otomatis (QRIS / VA / E-wallet)'; }
      return;
    }
    window.open(data.invoice_url, '_blank');
    showToast('Halaman pembayaran dibuka. Langganan aktif otomatis setelah bayar.');
    closePaywallModal();
  }catch(e){
    showToast('Gagal membuat tagihan, coba lagi atau pakai transfer manual');
  }
  if(btn){ btn.disabled = false; btn.textContent = '💳 Bayar Otomatis (QRIS / VA / E-wallet)'; }
}
async function requestRenewal(){
  if(!shopOwnerId){ showToast('Data toko belum siap'); return; }
  const nama = (settings && settings.shopName) ? settings.shopName : 'Toko';
  const wa = (settings && settings.phone) ? settings.phone : '';
  const { error } = await sb.from('payment_requests').insert({
    nama, wa, catatan: 'Perpanjangan langganan aplikasi',
    status: 'menunggu', type: 'perpanjangan', owner_id: shopOwnerId
  });
  if(error){ showToast('Gagal mengirim permintaan, coba lagi'); return; }
  showToast('Permintaan perpanjangan terkirim, admin akan verifikasi');
  const waNum = String(ADMIN_WA || '6283159294102').replace(/[^0-9]/g,'');
  const text = encodeURIComponent(`Halo admin, saya mau perpanjang langganan Laundry Batapas.id untuk toko "${nama}". Berikut bukti pembayarannya.`);
  window.open(`https://wa.me/${waNum}?text=${text}`, '_blank');
  closePaywallModal();
}

