/* ===================== AUTH ===================== */
function togglePasswordVisibility(){
  const input = document.getElementById('authPassword');
  const eye = document.getElementById('eyeIcon');
  if(input.type === 'password'){
    input.type = 'text';
    eye.innerHTML = '<path d="M17.94 17.94A10.94 10.94 0 0112 20c-7 0-11-8-11-8a21.6 21.6 0 015.06-6.06M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a21.4 21.4 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>';
  } else {
    input.type = 'password';
    eye.innerHTML = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
  }
}
function setAuthMode(mode){
  authMode = mode;
  document.getElementById('tabMasuk').classList.toggle('active', mode==='masuk');
  document.getElementById('tabDaftar').classList.toggle('active', mode==='daftar');
  document.getElementById('authSubmitBtn').textContent = mode==='masuk' ? 'Masuk' : 'Daftar';
  document.getElementById('authMsg').textContent = '';
  document.getElementById('regCodeField').style.display = mode==='daftar' ? 'block' : 'none';
}
function setAuthMsg(msg, type){
  const el = document.getElementById('authMsg');
  el.textContent = msg;
  el.className = 'auth-msg' + (type ? ' '+type : '');
}
async function handleAuthSubmit(){
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const card = document.querySelector('.auth-card');
  if(!email || !password){ setAuthMsg('Isi email dan password terlebih dahulu', 'error'); return; }
  if(password.length < 6){ setAuthMsg('Password minimal 6 karakter', 'error'); return; }
  let regCode = '';
  if(authMode === 'daftar'){
    regCode = document.getElementById('regCodeInput').value.trim().toUpperCase();
    // kode pendaftaran sekarang OPSIONAL: kosongkan untuk trial 30 hari otomatis
  }
  card.classList.add('auth-loading');
  setAuthMsg('Memproses...', '');
  try{
    if(authMode === 'masuk'){
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if(error) throw error;
    } else {
      if(regCode){
        const { data: valid, error: codeErr } = await sb.rpc('check_registration_code', { p_code: regCode });
        if(codeErr || !valid){
          setAuthMsg('Kode pendaftaran tidak valid atau sudah dipakai', 'error');
          card.classList.remove('auth-loading');
          return;
        }
      }
      const { data, error } = await sb.auth.signUp({ email, password });
      if(error) throw error;
      if(data.user && !data.session){
        try{
          if(regCode) localStorage.setItem('nk_pendingRegCode', regCode);
        }catch(e){}
        setAuthMsg(regCode ? 'Akun dibuat! Cek email untuk konfirmasi, lalu masuk.' : 'Akun dibuat! Cek email untuk konfirmasi, lalu masuk. Trial 30 hari akan aktif otomatis.', 'ok');
        card.classList.remove('auth-loading');
        return;
      }
      if(data.session && regCode){
        try{ localStorage.setItem('nk_paidSignup', '1'); }catch(e){}
        await sb.from('registration_codes').update({ status:'terpakai', used_by: data.user.id }).eq('code', regCode).eq('status','aktif');
      }
    }
  }catch(e){
    setAuthMsg(translateAuthError(e.message), 'error');
    card.classList.remove('auth-loading');
    return;
  }
  card.classList.remove('auth-loading');
}
function translateAuthError(msg){
  if(/invalid login credentials/i.test(msg)) return 'Email atau password salah';
  if(/already registered|already exists/i.test(msg)) return 'Email sudah terdaftar, coba menu Masuk';
  if(/rate limit/i.test(msg)) return 'Terlalu banyak percobaan, coba lagi beberapa saat';
  return msg;
}
async function handleLogout(){
  await sb.auth.signOut();
}
function openForgotPassword(){
  document.getElementById('forgotEmail').value='';
  document.getElementById('forgotMsg').textContent='';
  document.getElementById('forgotModal').classList.add('show');
}
function closeForgotPassword(){ document.getElementById('forgotModal').classList.remove('show'); }
async function sendResetPasswordEmail(){
  const email = document.getElementById('forgotEmail').value.trim();
  const msgEl = document.getElementById('forgotMsg');
  if(!email){ msgEl.className='auth-msg error'; msgEl.textContent='Isi email terlebih dahulu'; return; }
  msgEl.className='auth-msg'; msgEl.textContent='Mengirim...';
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + window.location.pathname });
  if(error){ msgEl.className='auth-msg error'; msgEl.textContent=error.message; return; }
  msgEl.className='auth-msg ok'; msgEl.textContent='Link reset password sudah dikirim, cek email kamu.';
}
async function submitNewPassword(){
  const password = document.getElementById('newPasswordInput').value;
  const msgEl = document.getElementById('newPasswordMsg');
  if(!password || password.length<6){ msgEl.className='auth-msg error'; msgEl.textContent='Password minimal 6 karakter'; return; }
  msgEl.className='auth-msg'; msgEl.textContent='Menyimpan...';
  const { error } = await sb.auth.updateUser({ password });
  if(error){ msgEl.className='auth-msg error'; msgEl.textContent=error.message; return; }
  msgEl.className='auth-msg ok'; msgEl.textContent='Password berhasil diganti!';
  setTimeout(()=>{ document.getElementById('newPasswordModal').classList.remove('show'); }, 1200);
}
/* Pendaftaran sb.auth.onAuthStateChange() SENGAJA dipindah ke <script> paling
   akhir di index.html (setelah js/21-i18n.js), BUKAN di sini -- lihat catatan
   di sana. Dulu ada di sini karena file ini pernah jadi bagian dari satu
   <script> monolitik (semua fungsi otomatis sudah ke-hoist dalam satu
   eksekusi), tapi sekarang js/*.js dipecah jadi banyak <script src> terpisah
   yang dieksekusi berurutan -- taruh listener ini di sini kembali membuka
   race condition: versi supabase-js terbaru bisa memicu callback INI lewat
   microtask sesaat setelah file ini selesai dieksekusi, SEBELUM js/02-init-
   data.js (tempat resolveRoleAndInit didefinisikan) sempat dimuat, bikin
   "ReferenceError: resolveRoleAndInit is not defined" dan user gagal
   auto-login (harus masuk ulang terus). */

