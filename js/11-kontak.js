/* ===================== PILIH KONTAK (Contact Picker API) ===================== */
async function pickContact(){
  const supported = ('contacts' in navigator) && ('ContactsManager' in window);
  if(!supported){
    showToast('Fitur kontak tidak didukung di sini. Buka lewat Chrome Android (bukan preview) & pastikan aplikasi sudah di-Add to Home Screen.');
    return;
  }
  try{
    const props = ['name','tel'];
    const opts = { multiple:false };
    const contacts = await navigator.contacts.select(props, opts);
    if(!contacts || contacts.length===0) return;
    const c = contacts[0];
    const nama = (c.name && c.name.length>0) ? c.name[0] : '';
    const hp = (c.tel && c.tel.length>0) ? c.tel[0].replace(/[^0-9+]/g,'') : '';
    if(nama) document.getElementById('inNama').value = nama;
    if(hp) document.getElementById('inHP').value = hp;
    if(nama){
      await sb.from('contacts').upsert({ user_id: shopOwnerId, nama, hp: hp||null }, { onConflict:'user_id,hp' });
      await loadContactsFromDB();
    }
    showToast('Kontak berhasil dipilih');
  }catch(e){
    if(e.name !== 'AbortError'){
      showToast('Gagal mengambil kontak. Pastikan izin kontak diizinkan.');
    }
  }
}

/* ===================== KONTAK TERSIMPAN (untuk saran nama otomatis) ===================== */
async function loadContactsFromDB(){
  const { data, error } = await sb.from('contacts').select('*').eq('user_id', shopOwnerId).order('nama', { ascending:true });
  if(error) return;
  savedContacts = (data||[]).map(r=>({ id:r.id, nama:r.nama, hp:r.hp||'' }));
}
async function importContactsFromPhone(){
  const supported = ('contacts' in navigator) && ('ContactsManager' in window);
  if(!supported){
    showToast('Impor kontak tidak didukung di sini. Buka lewat Chrome Android (bukan preview) & pastikan aplikasi sudah di-Add to Home Screen.');
    return;
  }
  try{
    const props = ['name','tel'];
    const opts = { multiple:true };
    const contacts = await navigator.contacts.select(props, opts);
    if(!contacts || contacts.length===0) return;
    let ok = 0, gagal = 0;
    for(const c of contacts){
      const nama = (c.name && c.name[0]) || '';
      const hp = (c.tel && c.tel[0]) ? c.tel[0].replace(/[^0-9+]/g,'') : '';
      if(!nama){ gagal++; continue; }
      const { error } = await sb.from('contacts').upsert(
        { user_id: shopOwnerId, nama, hp: hp||null },
        { onConflict: 'user_id,hp' }
      );
      if(error){ gagal++; } else { ok++; }
    }
    await loadContactsFromDB();
    renderContactsList();
    if(gagal===0){
      showToast(`${ok} kontak berhasil diimpor`);
    } else {
      showToast(`${ok} berhasil, ${gagal} gagal disimpan. Pastikan sudah menjalankan fix-kontak-import.sql di Supabase.`);
    }
  }catch(e){
    if(e.name !== 'AbortError'){
      showToast('Gagal mengambil kontak. Pastikan izin kontak diizinkan.');
    }
  }
}
function renderContactsList(){
  const el = document.getElementById('contactsList');
  if(!el) return;
  if(savedContacts.length===0){
    el.innerHTML = '<div style="font-size:12.5px;color:var(--ink-soft);text-align:center;padding:8px 0;">Belum ada kontak tersimpan.</div>';
    return;
  }
  el.innerHTML = savedContacts.map(c=>`
    <div class="item-line" style="align-items:center;">
      <span>${escapeHTML(c.nama)} <span style="color:var(--ink-soft);">${c.hp?('· '+escapeHTML(c.hp)):''}</span></span>
      <button onclick="deleteContact('${c.id}')" style="background:none;border:none;color:var(--danger);font-size:15px;cursor:pointer;">✕</button>
    </div>`).join('');
}
async function deleteContact(id){
  const { error } = await sb.from('contacts').delete().eq('id', id);
  if(error){ showToast('Gagal menghapus kontak'); return; }
  savedContacts = savedContacts.filter(c=>c.id!==id);
  renderContactsList();
}
async function saveContactIfNew(nama, hp){
  if(!nama) return;
  if(hp){
    await sb.from('contacts').upsert({ user_id: shopOwnerId, nama, hp }, { onConflict:'user_id,hp' });
  } else {
    const exists = savedContacts.some(c=>c.nama.toLowerCase()===nama.toLowerCase());
    if(exists) return;
    await sb.from('contacts').insert({ user_id: shopOwnerId, nama, hp:null });
  }
  await loadContactsFromDB();
}
function showContactSuggest(inputId, boxId){
  const val = document.getElementById(inputId).value.trim().toLowerCase();
  const box = document.getElementById(boxId);
  if(!val){ box.classList.remove('show'); box.innerHTML=''; return; }
  const options = savedContacts.filter(c=>c.nama.toLowerCase().includes(val));
  if(options.length===0){ box.classList.remove('show'); box.innerHTML=''; return; }
  box.innerHTML = options.slice(0,8).map(c=>`
    <div class="suggest-item" onmousedown="event.preventDefault();selectContactSuggest('${inputId}','${boxId}','${c.id}')">
      ${escapeHTML(c.nama)}<small>${escapeHTML(c.hp||'-')}</small>
    </div>`).join('');
  box.classList.add('show');
}
function hideContactSuggestDelayed(boxId){
  setTimeout(()=>{ const b=document.getElementById(boxId); if(b) b.classList.remove('show'); }, 150);
}
function selectContactSuggest(inputId, boxId, contactId){
  const c = savedContacts.find(x=>String(x.id)===String(contactId));
  if(!c) return;
  document.getElementById(inputId).value = c.nama;
  const hpFieldId = inputId==='inNama' ? 'inHP' : (inputId==='subsNama' ? 'subsHP' : null);
  if(hpFieldId && c.hp) document.getElementById(hpFieldId).value = c.hp;
  document.getElementById(boxId).classList.remove('show');
}

