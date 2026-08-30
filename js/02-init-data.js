/* ===================== DATA (Supabase) ===================== */
/* ===================== PERAN: PEMILIK / KASIR ===================== */
function openPaymentInfo(){ document.getElementById('paymentInfoModal').classList.add('show'); }
function closePaymentInfo(){ document.getElementById('paymentInfoModal').classList.remove('show'); }
const ADMIN_WA = '6283159294102'; // nomor WhatsApp admin

async function submitPaymentRequest(){
  const nama = document.getElementById('preqNama').value.trim();
  const wa = document.getElementById('preqWA').value.trim();
  const catatan = document.getElementById('preqCatatan').value.trim();
  const msgEl = document.getElementById('preqMsg');
  if(!nama || !wa){ msgEl.className='auth-msg error'; msgEl.textContent='Isi nama dan no. WhatsApp dulu'; return; }
  msgEl.className='auth-msg'; msgEl.textContent='Mengirim...';
  const { error } = await sb.from('payment_requests').insert({ nama, wa, catatan, status:'menunggu' });
  if(error){ msgEl.className='auth-msg error'; msgEl.textContent='Gagal mengirim, coba lagi'; return; }
  msgEl.className='auth-msg ok'; msgEl.textContent='Terkirim! Sekarang kirim juga notifikasi WA ke admin lewat tombol di bawah ini.';
  document.getElementById('preqNama').value='';
  document.getElementById('preqWA').value='';
  document.getElementById('preqCatatan').value='';

  const text = encodeURIComponent(
    `🔔 *Pendaftaran Baru*\n\nNama: ${nama}\nNo. WA: ${wa}\nCatatan: ${catatan || '-'}\n\nMohon dicek pembayarannya, terima kasih.`
  );
  document.getElementById('preqNotifBtn').style.display = 'block';
  document.getElementById('preqNotifBtn').onclick = function(){
    window.open(`https://wa.me/${ADMIN_WA}?text=${text}`, '_blank');
  };
}
async function resolveRoleAndInit(){
  document.getElementById('onboardingScreen').classList.remove('show');
  try{
    const pending = localStorage.getItem('nk_pendingRegCode');
    if(pending){
      await sb.from('registration_codes').update({ status:'terpakai', used_by: currentUser.id }).eq('code', pending).eq('status','aktif');
      localStorage.removeItem('nk_pendingRegCode');
      localStorage.setItem('nk_paidSignup', '1');
    }
  }catch(e){}
  const { data: memberRow } = await sb.from('team_members').select('*').eq('member_id', currentUser.id).eq('status','aktif').maybeSingle();
  if(memberRow){
    currentRole = 'kasir';
    shopOwnerId = memberRow.owner_id;
    employeeName = memberRow.nama;
    kasirOutletId = memberRow.outlet_id!=null ? String(memberRow.outlet_id) : null;
    applyRoleUI();
    await ensureAppSubscription(shopOwnerId, false);
    await initUserData();
    return;
  }
  const { data: ownSettings } = await sb.from('settings').select('user_id').eq('user_id', currentUser.id).maybeSingle();
  const { data: ownTrx } = await sb.from('transactions').select('id').eq('user_id', currentUser.id).limit(1);
  if(ownSettings || (ownTrx && ownTrx.length>0)){
    currentRole = 'owner';
    shopOwnerId = currentUser.id;
    applyRoleUI();
    await ensureAppSubscription(shopOwnerId, true);
    await initUserData();
    return;
  }
  // akun benar-benar baru: tanya perannya dulu
  document.getElementById('inviteCodeInput').value = '';
  document.getElementById('inviteMsg').textContent = '';
  document.getElementById('onboardingScreen').classList.add('show');
}
function applyRoleUI(){
  document.body.classList.toggle('role-kasir', currentRole==='kasir');
  const sub = document.querySelector('.appbar-title p');
  if(sub) sub.textContent = currentRole==='kasir' ? `Kasir: ${employeeName}` : 'Kasir & Nota Digital Laundry';
}
async function chooseOwnerRole(){
  currentRole = 'owner';
  shopOwnerId = currentUser.id;
  document.getElementById('onboardingScreen').classList.remove('show');
  applyRoleUI();
  await ensureAppSubscription(shopOwnerId, true);
  initUserData();
}
async function claimInviteCode(){
  const code = document.getElementById('inviteCodeInput').value.trim().toUpperCase();
  const msgEl = document.getElementById('inviteMsg');
  if(!code){ msgEl.className='auth-msg error'; msgEl.textContent='Masukkan kode undangan dulu'; return; }
  msgEl.className='auth-msg'; msgEl.textContent='Memeriksa kode...';
  const { data: row, error: findErr } = await sb.from('team_members').select('*').eq('invite_code', code).eq('status','pending').maybeSingle();
  if(findErr || !row){ msgEl.className='auth-msg error'; msgEl.textContent='Kode tidak ditemukan atau sudah dipakai'; return; }
  const { error } = await sb.from('team_members').update({ member_id: currentUser.id, status:'aktif' }).eq('id', row.id);
  if(error){ msgEl.className='auth-msg error'; msgEl.textContent='Gagal bergabung, coba lagi'; return; }
  currentRole = 'kasir';
  shopOwnerId = row.owner_id;
  employeeName = row.nama;
  kasirOutletId = row.outlet_id!=null ? String(row.outlet_id) : null;
  document.getElementById('onboardingScreen').classList.remove('show');
  applyRoleUI();
  showToast(`Berhasil bergabung sebagai kasir "${row.nama}"`);
  await ensureAppSubscription(shopOwnerId, false);
  await initUserData();
}
function genInviteCode(){
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for(let i=0;i<6;i++) code += chars[Math.floor(Math.random()*chars.length)];
  return code;
}
async function createInvite(){
  const nama = prompt('Nama karyawan/kasir ini:');
  if(!nama || !nama.trim()) return;
  let outletId = null;
  if(outlets.length>0){
    const daftar = outlets.map((o,i)=>`${i+1}. ${o.nama}`).join('\n');
    const pilihan = prompt(`Batasi kasir ini ke satu outlet tertentu? Ketik nomor outlet di bawah, atau kosongkan untuk kasir bebas akses semua outlet:\n\n${daftar}`);
    if(pilihan && pilihan.trim()){
      const idx = parseInt(pilihan.trim(), 10) - 1;
      if(outlets[idx]) outletId = outlets[idx].id;
    }
  }
  const code = genInviteCode();
  const { error } = await sb.from('team_members').insert({
    owner_id: shopOwnerId, nama: nama.trim(), role:'kasir', invite_code: code, status:'pending',
    ...(outletId ? { outlet_id: outletId } : {})
  });
  if(error){ showToast('Gagal membuat undangan'); return; }
  await loadTeamList();
  alert(`Kode undangan untuk ${nama.trim()}:\n\n${code}\n\nMinta karyawan buka aplikasi ini, buat akun baru (email/password sendiri), lalu pilih "Saya kasir" dan masukkan kode ini.`);
}
var teamListCache = [];
async function loadTeamList(){
  const { data, error } = await sb.from('team_members').select('*').eq('owner_id', shopOwnerId).order('created_at', { ascending:false });
  teamListCache = error ? [] : (data||[]);
  renderTeamList();
}
function renderTeamList(){
  const el = document.getElementById('teamList');
  if(!el) return;
  if(teamListCache.length===0){
    el.innerHTML = '<div style="font-size:12.5px;color:var(--ink-soft);text-align:center;padding:8px 0;">Belum ada karyawan ditambahkan.</div>';
    return;
  }
  el.innerHTML = teamListCache.map(m=>{
    const outletNama = m.outlet_id!=null ? (outlets.find(o=>String(o.id)===String(m.outlet_id))?.nama || 'outlet terhapus') : '';
    return `
    <div class="item-line" style="align-items:center;">
      <span>${escapeHTML(m.nama)} <span style="color:var(--ink-soft);">${m.status==='aktif' ? '· Aktif' : '· Menunggu ('+m.invite_code+')'}${outletNama ? ' · 🔒 '+escapeHTML(outletNama) : ''}</span></span>
      <button onclick="removeMember('${m.id}')" style="background:none;border:none;color:var(--danger);font-size:15px;cursor:pointer;">✕</button>
    </div>`;
  }).join('');
}
async function removeMember(id){
  if(!confirm('Hapus karyawan ini? Dia tidak akan bisa akses data toko lagi.')) return;
  const { error } = await sb.from('team_members').delete().eq('id', id);
  if(error){ showToast('Gagal menghapus'); return; }
  await loadTeamList();
  showToast('Karyawan dihapus');
}

