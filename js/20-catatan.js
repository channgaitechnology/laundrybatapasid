/* ===================== CATATAN (buku catatan bebas seputar laundry) ===================== */
var notes = [];
var editingNoteId = null;
const NOTE_BOOK_PALETTE = [
  ['#146C8E','#0D4F68'],
  ['#5FC9BE','#146C8E'],
  ['#F2A54A','#D9822B'],
  ['#2E9E63','#1F7A4D'],
  ['#0D4F68','#122430'],
  ['#D6483F','#A83229'],
];
/* Tabel notes opsional (lihat README) — kalau query gagal (tabel belum dibuat),
   diamkan saja dan anggap belum ada catatan, supaya fitur lain tetap jalan normal. */
async function loadNotesFromDB(){
  const { data, error } = await sb.from('notes').select('*').eq('user_id', shopOwnerId).order('updated_at', { ascending:false });
  if(error){ notes = []; return; }
  notes = (data||[]).map(row => ({
    id: row.id, judul: row.judul || t('Tanpa Judul'), isi: row.isi || '',
    createdAt: row.created_at, updatedAt: row.updated_at
  }));
}
function openCatatan(){
  document.getElementById('catatanModal').classList.add('show');
  document.getElementById('catatanHome').style.display = '';
  document.getElementById('catatanEditorView').style.display = 'none';
  renderNotesGrid();
}
function closeCatatan(){
  document.getElementById('catatanModal').classList.remove('show');
}
function renderNotesGrid(){
  const grid = document.getElementById('notesGrid');
  if(!grid) return;
  if(notes.length === 0){
    grid.innerHTML = `<div class="notes-empty">${t('Belum ada catatan. Ketuk "+ Catatan Baru" di atas untuk mulai mencatat.')}</div>`;
    return;
  }
  grid.innerHTML = notes.map((n, i) => {
    const [c1, c2] = NOTE_BOOK_PALETTE[i % NOTE_BOOK_PALETTE.length];
    return `
    <button type="button" class="note-book" style="background:linear-gradient(160deg,${c1},${c2});" onclick="openNote('${n.id}')">
      <div class="note-book-title">${escapeHTML(n.judul)}</div>
      <div class="note-book-dates">${t('Dibuat')}: ${fmtDateTime(n.createdAt)}<br>${t('Diedit')}: ${fmtDateTime(n.updatedAt)}</div>
    </button>`;
  }).join('');
}
function createNewNote(){
  editingNoteId = null;
  document.getElementById('noteJudul').value = '';
  document.getElementById('noteIsi').innerHTML = '';
  document.getElementById('noteDatesInfo').textContent = t('Catatan baru — belum disimpan.');
  document.getElementById('catatanHome').style.display = 'none';
  document.getElementById('catatanEditorView').style.display = '';
  document.getElementById('catatanModal').querySelector('.modal').scrollTop = 0;
}
function openNote(id){
  const n = notes.find(x => String(x.id) === String(id));
  if(!n) return;
  editingNoteId = n.id;
  document.getElementById('noteJudul').value = n.judul;
  document.getElementById('noteIsi').innerHTML = sanitizeNoteHTML(n.isi);
  document.getElementById('noteDatesInfo').textContent = `${t('Dibuat')}: ${fmtDateTime(n.createdAt)}  •  ${t('Terakhir diedit')}: ${fmtDateTime(n.updatedAt)}`;
  document.getElementById('catatanHome').style.display = 'none';
  document.getElementById('catatanEditorView').style.display = '';
  document.getElementById('catatanModal').querySelector('.modal').scrollTop = 0;
}
function closeCatatanEditor(){
  document.getElementById('catatanEditorView').style.display = 'none';
  document.getElementById('catatanHome').style.display = '';
  renderNotesGrid();
}
/* Format bebas ala OneNote (bold/italic/underline/bullet/penomoran/kotak
   centang/stabilo/foto) disimpan sebagai HTML di kolom notes.isi, bukan teks
   polos lagi. onmousedown=preventDefault() di semua tombol toolbar supaya
   fokus & seleksi teks di dalam #noteIsi tidak hilang saat tombol diketuk. */
function noteFormat(cmd){
  const ed = document.getElementById('noteIsi');
  if(document.activeElement !== ed) ed.focus();
  document.execCommand(cmd, false, null);
}
function noteHighlight(color){
  const ed = document.getElementById('noteIsi');
  if(document.activeElement !== ed) ed.focus();
  document.execCommand('hiliteColor', false, color);
}
function insertNoteChecklist(){
  const ed = document.getElementById('noteIsi');
  if(document.activeElement !== ed) ed.focus();
  document.execCommand('insertHTML', false, '<div class="note-check-line"><input type="checkbox"> <span>&nbsp;</span></div>');
}
/* Sinkronkan properti .checked checkbox ke atribut `checked` — browser
   TIDAK otomatis melakukan ini saat user klik, padahal serialisasi
   .innerHTML (dipakai saveNote()) hanya membaca atribut, bukan properti
   live. Tanpa ini status centang akan selalu "belum dicentang" saat disimpan. */
function handleNoteEditorChange(e){
  if(e.target && e.target.type === 'checkbox'){
    if(e.target.checked) e.target.setAttribute('checked', 'checked');
    else e.target.removeAttribute('checked');
  }
}
function insertNoteImage(event){
  const file = event.target.files && event.target.files[0];
  event.target.value = '';
  if(!file) return;
  if(!file.type.startsWith('image/')){ showToast(t('Pilih berkas gambar (JPG/PNG)')); return; }
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const maxW = 480;
      const scale = Math.min(1, maxW / img.width);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUri = canvas.toDataURL('image/jpeg', 0.75);
      const ed = document.getElementById('noteIsi');
      ed.focus();
      document.execCommand('insertImage', false, dataUri);
    };
    img.onerror = () => showToast(t('Gagal membaca gambar'));
    img.src = reader.result;
  };
  reader.onerror = () => showToast(t('Gagal membaca berkas'));
  reader.readAsDataURL(file);
}
/* Whitelist tag/atribut untuk isi catatan — dipakai baik saat menyimpan
   maupun saat memuat ulang (defense-in-depth kalau data di DB diubah
   langsung lewat API, bukan lewat editor ini). Sengaja permisif untuk
   tag format (bold/italic/underline/list/checkbox/gambar/stabilo), tapi
   selalu buang script/iframe, atribut event "on..." dan URL javascript:
   — pelajaran dari perbaikan XSS nama layanan di nota (commit 2be2b1d). */
const NOTE_ALLOWED_TAGS = new Set(['B','STRONG','I','EM','U','UL','OL','LI','DIV','BR','SPAN','P','IMG','INPUT','FONT']);
const NOTE_STRIP_ENTIRELY_TAGS = new Set(['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','LINK','META','NOSCRIPT']);
function sanitizeNoteHTML(html){
  const tmp = document.createElement('div');
  tmp.innerHTML = html || '';
  (function walk(parent){
    Array.from(parent.childNodes).forEach(node => {
      if(node.nodeType === 1){
        if(NOTE_STRIP_ENTIRELY_TAGS.has(node.tagName)){
          parent.removeChild(node);
          return;
        }
        if(!NOTE_ALLOWED_TAGS.has(node.tagName)){
          while(node.firstChild) parent.insertBefore(node.firstChild, node);
          parent.removeChild(node);
          return;
        }
        Array.from(node.attributes).forEach(attr => {
          const name = attr.name.toLowerCase();
          const val = attr.value || '';
          if(name.startsWith('on')){ node.removeAttribute(attr.name); return; }
          if((name === 'src' || name === 'href') && /javascript:/i.test(val)){ node.removeAttribute(attr.name); return; }
          if(node.tagName === 'IMG' && name !== 'src' && name !== 'alt' && name !== 'style'){ node.removeAttribute(attr.name); }
          if(node.tagName === 'INPUT' && name !== 'type' && name !== 'checked'){ node.removeAttribute(attr.name); }
        });
        if(node.tagName === 'INPUT') node.setAttribute('type', 'checkbox');
        walk(node);
      } else if(node.nodeType !== 3){
        parent.removeChild(node);
      }
    });
  })(tmp);
  return tmp.innerHTML;
}
async function saveNote(){
  const judul = document.getElementById('noteJudul').value.trim() || t('Tanpa Judul');
  const isi = sanitizeNoteHTML(document.getElementById('noteIsi').innerHTML);
  const result = editingNoteId
    ? await sb.from('notes').update({ judul, isi, updated_at: new Date().toISOString() }).eq('id', editingNoteId).select().single()
    : await sb.from('notes').insert({ user_id: shopOwnerId, judul, isi }).select().single();
  const { data, error } = result;
  if(error){ showToast(t('Gagal menyimpan catatan — pastikan tabel notes sudah dimigrasi (lihat README)')); return; }
  notes = notes.filter(n => String(n.id) !== String(data.id));
  notes.unshift({ id: data.id, judul: data.judul, isi: data.isi || '', createdAt: data.created_at, updatedAt: data.updated_at });
  editingNoteId = data.id;
  showToast(t('Catatan tersimpan'));
  closeCatatanEditor();
}
async function deleteNote(){
  if(!editingNoteId) return;
  const note = notes.find(n => String(n.id) === String(editingNoteId));
  if(!note) return;
  if(!confirm(`${t('Hapus catatan')} "${note.judul}"?`)) return;
  const { error } = await sb.from('notes').delete().eq('id', editingNoteId);
  if(error){ showToast(t('Gagal menghapus catatan')); return; }
  notes = notes.filter(n => String(n.id) !== String(editingNoteId));
  closeCatatanEditor();
  showToast(t('Catatan dihapus'), {
    label: t('Urungkan'),
    onClick: async () => {
      const { data, error: err2 } = await sb.from('notes').insert({ user_id: shopOwnerId, judul: note.judul, isi: note.isi }).select().single();
      if(err2) return;
      notes.unshift({ id: data.id, judul: data.judul, isi: data.isi || '', createdAt: data.created_at, updatedAt: data.updated_at });
      renderNotesGrid();
    }
  });
}
