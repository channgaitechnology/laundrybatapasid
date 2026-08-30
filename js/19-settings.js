/* ===================== SETTINGS MODAL ===================== */
function openSettings(){
  document.getElementById('setNama').value = settings.shopName||'';
  document.getElementById('setAlamat').value = settings.address||'';
  document.getElementById('setHP').value = settings.phone||'';
  document.getElementById('setCatatan').value = settings.note||'';
  const autoNotifyChk = document.getElementById('setAutoNotifySelesai');
  if(autoNotifyChk) autoNotifyChk.checked = !!settings.autoNotifySelesai;
  const logoPreview = document.getElementById('logoPreviewImg');
  if(logoPreview) logoPreview.src = shopLogoSrc();
  renderContactsList();
  renderOutletManagerList();
  renderBtPrinterStatus();
  if(currentRole==='owner') loadTeamList();
  const isAdmin = !!(currentUser && currentUser.email===ADMIN_EMAIL);
  document.getElementById('adminPlatformSection').style.display = isAdmin ? 'block' : 'none';
  document.getElementById('settingsTileAdmin').style.display = isAdmin ? 'flex' : 'none';
  if(isAdmin){ loadAdminData(); fillAppBrandingForm(); }
  closeSettingsSub(); // selalu mulai dari grid kategori, bukan nyangkut di sub terakhir yang dibuka
  document.getElementById('settingsModal').classList.add('show');
}
function closeSettings(){ document.getElementById('settingsModal').classList.remove('show'); }
/* Layar Pengaturan dua tingkat: grid kategori (kotak berlogo) dulu, baru
   ketuk satu kotak untuk masuk ke panel pengaturan spesifiknya — supaya
   tidak jadi satu halaman panjang berisi semua pengaturan sekaligus. */
function openSettingsSub(id){
  document.getElementById('settingsHome').style.display = 'none';
  document.getElementById('settingsSubView').style.display = 'block';
  document.querySelectorAll('.settings-sub-panel').forEach(p=>p.classList.remove('active'));
  const panel = document.getElementById('settingsSub-'+id);
  if(panel) panel.classList.add('active');
  const titles = {
    langganan:'💳 Langganan Aplikasi', profil:'🏪 Profil Toko', notifikasi:'🔔 Notifikasi',
    keamanan:'🔒 Keamanan Akun', kontak:'📇 Kontak Pelanggan', outlet:'🏬 Outlet / Cabang',
    printer:'🖨️ Printer Bluetooth', karyawan:'👥 Karyawan / Kasir', bahasa:'🌐 Bahasa / Language',
    admin:'🔐 Admin Platform'
  };
  document.getElementById('settingsSubTitle').textContent = t(titles[id] || 'Pengaturan');
  if(id==='bahasa'){
    const btnId = document.getElementById('langBtnId');
    const btnEn = document.getElementById('langBtnEn');
    [ [btnId, currentLang==='id'], [btnEn, currentLang==='en'] ].forEach(([btn, active])=>{
      if(!btn) return;
      btn.style.background = active ? 'var(--mist)' : '';
      btn.style.borderColor = active ? 'var(--suds)' : '';
    });
  }
  document.getElementById('settingsModal').querySelector('.modal').scrollTop = 0;
}
function closeSettingsSub(){
  document.getElementById('settingsSubView').style.display = 'none';
  document.getElementById('settingsHome').style.display = 'block';
}
async function saveSettingsForm(){
  settings.shopName = document.getElementById('setNama').value.trim() || 'Laundry Batapas.id';
  settings.address = document.getElementById('setAlamat').value.trim();
  settings.phone = document.getElementById('setHP').value.trim();
  settings.note = document.getElementById('setCatatan').value.trim();
  await persistSettings();
  applySettingsToUI();
  closeSettings();
  showToast(t('Pengaturan disimpan'));
}
function applySettingsToUI(){
  document.getElementById('shopNameLabel').textContent = settings.shopName || 'Laundry Batapas.id';
  const logoEl = document.getElementById('appbarLogo');
  if(logoEl) logoEl.src = shopLogoSrc();
}
function setAccountMsg(msg, ok){
  const el = document.getElementById('accountMsg');
  el.textContent = msg;
  el.style.color = ok ? 'var(--success)' : 'var(--danger)';
}
async function changeAccountEmail(){
  const email = document.getElementById('setEmailBaru').value.trim();
  if(!email){ setAccountMsg(t('Isi email baru terlebih dahulu'), false); return; }
  const { error } = await sb.auth.updateUser({ email });
  if(error){ setAccountMsg(t('Gagal mengganti email:')+' '+error.message, false); return; }
  setAccountMsg(t('Cek email lama & baru untuk konfirmasi perubahan.'), true);
  document.getElementById('setEmailBaru').value='';
}
async function changeAccountPassword(){
  const password = document.getElementById('setPasswordBaru').value;
  if(!password || password.length<6){ setAccountMsg(t('Password baru minimal 6 karakter'), false); return; }
  const { error } = await sb.auth.updateUser({ password });
  if(error){ setAccountMsg(t('Gagal mengganti password:')+' '+error.message, false); return; }
  setAccountMsg(t('Password berhasil diganti.'), true);
  document.getElementById('setPasswordBaru').value='';
}

/* ===================== INIT ===================== */
function renderAll(){
  document.getElementById('inTanggal').value = todayISO();
  renderDraftItems();
  renderHistory();
}
