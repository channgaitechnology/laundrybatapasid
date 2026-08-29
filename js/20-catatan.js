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
    id: row.id, judul: row.judul || 'Tanpa Judul', isi: row.isi || '',
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
    grid.innerHTML = `<div class="notes-empty">Belum ada catatan. Ketuk "+ Catatan Baru" di atas untuk mulai mencatat.</div>`;
    return;
  }
  grid.innerHTML = notes.map((n, i) => {
    const [c1, c2] = NOTE_BOOK_PALETTE[i % NOTE_BOOK_PALETTE.length];
    return `
    <button type="button" class="note-book" style="background:linear-gradient(160deg,${c1},${c2});" onclick="openNote('${n.id}')">
      <div class="note-book-title">${escapeHTML(n.judul)}</div>
      <div class="note-book-dates">Dibuat: ${fmtDateTime(n.createdAt)}<br>Diedit: ${fmtDateTime(n.updatedAt)}</div>
    </button>`;
  }).join('');
}
function createNewNote(){
  editingNoteId = null;
  document.getElementById('noteJudul').value = '';
  document.getElementById('noteIsi').value = '';
  document.getElementById('noteDatesInfo').textContent = 'Catatan baru — belum disimpan.';
  document.getElementById('catatanHome').style.display = 'none';
  document.getElementById('catatanEditorView').style.display = '';
  document.getElementById('catatanModal').querySelector('.modal').scrollTop = 0;
}
function openNote(id){
  const n = notes.find(x => String(x.id) === String(id));
  if(!n) return;
  editingNoteId = n.id;
  document.getElementById('noteJudul').value = n.judul;
  document.getElementById('noteIsi').value = n.isi;
  document.getElementById('noteDatesInfo').textContent = `Dibuat: ${fmtDateTime(n.createdAt)}  •  Terakhir diedit: ${fmtDateTime(n.updatedAt)}`;
  document.getElementById('catatanHome').style.display = 'none';
  document.getElementById('catatanEditorView').style.display = '';
  document.getElementById('catatanModal').querySelector('.modal').scrollTop = 0;
}
function closeCatatanEditor(){
  document.getElementById('catatanEditorView').style.display = 'none';
  document.getElementById('catatanHome').style.display = '';
  renderNotesGrid();
}
async function saveNote(){
  const judul = document.getElementById('noteJudul').value.trim() || 'Tanpa Judul';
  const isi = document.getElementById('noteIsi').value;
  const result = editingNoteId
    ? await sb.from('notes').update({ judul, isi, updated_at: new Date().toISOString() }).eq('id', editingNoteId).select().single()
    : await sb.from('notes').insert({ user_id: shopOwnerId, judul, isi }).select().single();
  const { data, error } = result;
  if(error){ showToast('Gagal menyimpan catatan — pastikan tabel notes sudah dimigrasi (lihat README)'); return; }
  notes = notes.filter(n => String(n.id) !== String(data.id));
  notes.unshift({ id: data.id, judul: data.judul, isi: data.isi || '', createdAt: data.created_at, updatedAt: data.updated_at });
  editingNoteId = data.id;
  showToast('Catatan tersimpan');
  closeCatatanEditor();
}
async function deleteNote(){
  if(!editingNoteId) return;
  const note = notes.find(n => String(n.id) === String(editingNoteId));
  if(!note) return;
  if(!confirm(`Hapus catatan "${note.judul}"?`)) return;
  const { error } = await sb.from('notes').delete().eq('id', editingNoteId);
  if(error){ showToast('Gagal menghapus catatan'); return; }
  notes = notes.filter(n => String(n.id) !== String(editingNoteId));
  closeCatatanEditor();
  showToast('Catatan dihapus', {
    label: 'Urungkan',
    onClick: async () => {
      const { data, error: err2 } = await sb.from('notes').insert({ user_id: shopOwnerId, judul: note.judul, isi: note.isi }).select().single();
      if(err2) return;
      notes.unshift({ id: data.id, judul: data.judul, isi: data.isi || '', createdAt: data.created_at, updatedAt: data.updated_at });
      renderNotesGrid();
    }
  });
}
