/* ===================== PAKET BULANAN ===================== */
function addOneMonthClamped(dateStr){
  const d = new Date(dateStr+'T00:00:00');
  const day = d.getDate();
  const totalMonth = d.getMonth() + 1; // add 1 month
  const targetYear = d.getFullYear() + Math.floor(totalMonth/12);
  const targetMonth = totalMonth % 12;
  const daysInTargetMonth = new Date(targetYear, targetMonth+1, 0).getDate();
  const finalDay = Math.min(day, daysInTargetMonth);
  const result = new Date(targetYear, targetMonth, finalDay);
  return result.toISOString().slice(0,10);
}
function updateSubsEndPreview(){
  const start = document.getElementById('subsTanggalMulai').value;
  const el = document.getElementById('subsEndPreview');
  if(!start){ el.textContent = '-'; return; }
  el.textContent = fmtDate(addOneMonthClamped(start));
}
/* Pelanggan Tempo (bayar nanti) ditandai dengan kuota_kg = 0 — validasi Paket Bulanan
   selalu mewajibkan kuota > 0, jadi 0 hanya mungkin berasal dari alur Tempo. */
function isTempo(s){ return Number(s.kuotaKg) === 0; }
function onSubsTipeChange(){
  const tipe = document.getElementById('subsTipe').value;
  const tempo = tipe === 'tempo';
  document.getElementById('subsPaketField').style.display = tempo ? 'none' : 'block';
  document.getElementById('subsKuotaField').style.display = tempo ? 'none' : 'block';
  document.getElementById('subsRow2').style.gridTemplateColumns = tempo ? '1fr' : '1fr 1fr';
  document.getElementById('subsEndPreviewRow').style.display = tempo ? 'none' : 'block';
  document.getElementById('subsTempoHint').style.display = tempo ? 'block' : 'none';
}
async function loadSubscriptionsFromDB(){
  const { data, error } = await sb.from('subscriptions').select('*').eq('user_id', shopOwnerId).order('tanggal_mulai', { ascending:false });
  if(error){ return; }
  subscriptions = (data||[]).map(r => ({
    id:r.id, nama:r.nama, hp:r.hp, paketNama:r.paket_nama, hargaPaket:Number(r.harga_paket)||0,
    hargaLebihKg:Number(r.harga_lebih_kg)||0,
    kuotaKg:Number(r.kuota_kg)||0, tanggalMulai:r.tanggal_mulai, tanggalSelesai:r.tanggal_selesai,
    status:r.status||'aktif', statusBayar:r.status_bayar||'belum', dp:Number(r.dp)||0,
    lunasAt:r.lunas_at||null, transactionId:r.transaction_id||null, terpakai:0,
    outletId: r.outlet_id!=null ? String(r.outlet_id) : null
  }));
  await loadAllUsageTotals();
}
/* Semua catatan subscription_usage bertipe layanan_tambahan (Paket Bulanan
   "layanan lain" + seluruh kunjungan Tempo) lintas SEMUA pelanggan paket —
   dipakai Daftar Tugas supaya kerjaan Paket Bulanan/Tempo ikut muncul di
   papan, bukan cuma transaksi reguler. Timbangan kg polos (type "pemakaian")
   tidak diikutkan karena tidak punya harga per-baris yang jelas untuk
   ditampilkan di kartu Daftar Tugas. */
var allWorkUsage = [];
async function loadAllWorkUsage(){
  const { data, error } = await sb.from('subscription_usage').select('*').eq('user_id', shopOwnerId);
  if(error){ allWorkUsage = []; return; }
  allWorkUsage = (data||[]).map(r=>({
    id:r.id, subscriptionId:r.subscription_id, tanggal:r.tanggal, estimasi:r.estimasi||null,
    type:r.type||'pemakaian', layananNama:r.layanan_nama||'', qty:Number(r.qty)||0,
    satuan:r.satuan||'', harga:Number(r.harga)||0, subtotal:Number(r.subtotal)||0,
    berat:Number(r.berat_kg)||0, catatan:r.catatan||'',
    workStatus:r.work_status||'belum'
  }));
}
async function loadAllUsageTotals(){
  if(subscriptions.length===0) return;
  const ids = subscriptions.map(s=>s.id);
  const { data, error } = await sb.from('subscription_usage').select('subscription_id, berat_kg, type, subtotal').in('subscription_id', ids);
  if(error) return;
  const totals = {}, tempoTotals = {}, tempoCounts = {};
  (data||[]).forEach(row=>{
    if(row.type === 'layanan_tambahan'){
      tempoTotals[row.subscription_id] = (tempoTotals[row.subscription_id]||0) + Number(row.subtotal||0);
      tempoCounts[row.subscription_id] = (tempoCounts[row.subscription_id]||0) + 1;
      return;
    }
    totals[row.subscription_id] = (totals[row.subscription_id]||0) + Number(row.berat_kg||0);
  });
  subscriptions.forEach(s=>{
    s.terpakai = totals[s.id] || 0;
    s.tempoTotal = tempoTotals[s.id] || 0;
    s.tempoCount = tempoCounts[s.id] || 0;
  });
}
function renderSubscriptions(){
  const filterEl = document.getElementById('subsFilterStatus');
  const filter = filterEl ? filterEl.value : 'aktif';
  const filterTipeEl = document.getElementById('subsFilterTipe');
  const filterTipe = filterTipeEl ? filterTipeEl.value : 'semua';
  const today = todayISO();
  const el = document.getElementById('subscriptionList');
  let list = visibleSubscriptions().slice();
  if(filterTipe==='bulanan') list = list.filter(s=>!isTempo(s));
  else if(filterTipe==='tempo') list = list.filter(s=>isTempo(s));
  if(filter==='aktif'){
    // Tempo tidak punya batas periode, jadi selalu dianggap aktif selama belum dihapus.
    list = list.filter(s => isTempo(s) || (s.tanggalMulai <= today && today <= s.tanggalSelesai));
  }
  list.sort((a,b)=> (b.tanggalMulai||'').localeCompare(a.tanggalMulai||''));

  if(list.length===0){
    el.innerHTML = `<div class="empty">
      <svg class="bubble-icon" viewBox="0 0 48 48" fill="none"><circle cx="24" cy="24" r="21" stroke="#146C8E" stroke-width="2" opacity="0.4"/></svg>
      <h3>${t('Belum ada pelanggan')} ${filter==='aktif' ? t('yang sedang aktif') : ''}</h3>
      <p>${t('Klik "+ Pelanggan" untuk mendaftarkan pelanggan paket atau tempo baru.')}</p>
    </div>`;
    return;
  }
  el.innerHTML = list.map(s=>{
    if(isTempo(s)){
      const belumBayar = Math.max((s.tempoTotal||0) - (s.dp||0), 0);
      let badgeText, badgeClass;
      if((s.tempoTotal||0)<=0){ badgeText=t('Belum Ada Transaksi'); badgeClass='badge-belum'; }
      else if(belumBayar<=0){ badgeText=t('Lunas'); badgeClass='badge-lunas'; }
      else { badgeText=t('Belum Lunas'); badgeClass='badge-belum'; }
      return `
      <div class="trx-card" onclick="openSubsDetail('${s.id}')" style="cursor:pointer;">
        <div class="trx-top">
          <div>
            <div class="trx-name">${escapeHTML(s.nama)}</div>
            <div class="kode">${t('Tempo — Bayar Nanti')}</div>
          </div>
          <span class="badge ${badgeClass}">${badgeText}</span>
        </div>
        <div class="trx-meta" style="margin-bottom:6px;">${t('Terdaftar sejak')} ${fmtDate(s.tanggalMulai)} · ${s.tempoCount||0} ${currentLang==='en' ? (s.tempoCount===1?'visit':'visits') : t('kunjungan')}</div>
        <div class="trx-meta">${t('Belum dibayar:')} <b>${rupiah(belumBayar)}</b>${(s.dp||0)>0 ? ` · ${t('Sudah bayar')} ${rupiah(s.dp)}` : ''}</div>
      </div>`;
    }
    const sisa = Math.max(s.kuotaKg - s.terpakai, 0);
    const pct = Math.min((s.terpakai/s.kuotaKg)*100, 100);
    const overKuota = s.terpakai > s.kuotaKg;
    const expired = s.tanggalSelesai < today;
    let badgeText, badgeClass;
    if(expired){ badgeText=t('Berakhir'); badgeClass='badge-belum'; }
    else if(overKuota){ badgeText=t('Lebih Kuota'); badgeClass='badge-belum'; }
    else { badgeText=t('Aktif'); badgeClass='badge-lunas'; }
    return `
    <div class="trx-card" onclick="openSubsDetail('${s.id}')" style="cursor:pointer;">
      <div class="trx-top">
        <div>
          <div class="trx-name">${escapeHTML(s.nama)}</div>
          <div class="kode">${escapeHTML(s.paketNama)}</div>
        </div>
        <span class="badge ${badgeClass}">${badgeText}</span>
      </div>
      <div class="trx-meta" style="margin-bottom:6px;">${t('Periode:')} ${fmtDate(s.tanggalMulai)} – ${fmtDate(s.tanggalSelesai)} · <span style="color:${s.statusBayar==='lunas'?'var(--success)':'var(--warn)'};font-weight:700;">${s.statusBayar==='lunas'?t('Lunas'):t('Belum Lunas')}</span></div>
      <div style="background:var(--mist);border-radius:10px;height:8px;margin:8px 0 6px;overflow:hidden;">
        <div style="width:${pct}%;height:100%;background:${overKuota?'var(--warn)':'var(--bubble)'};"></div>
      </div>
      <div class="trx-meta">${fmtKg(s.terpakai)} / ${fmtKg(s.kuotaKg)} kg ${t('terpakai')} · ${t('Sisa')} ${fmtKg(sisa)} kg</div>
    </div>`;
  }).join('');
}
function openNewSubscription(){
  editingSubscriptionId = null;
  document.getElementById('subsModalTitle').textContent = t('Pelanggan Paket Baru');
  document.getElementById('subsSubmitBtn').textContent = t('Simpan Pelanggan Paket');
  document.getElementById('subsNama').value = '';
  document.getElementById('subsHP').value = '';
  document.getElementById('subsKuota').value = '';
  document.getElementById('subsTanggalMulai').value = todayISO();
  const filterTipe = document.getElementById('subsFilterTipe');
  document.getElementById('subsTipe').value = (filterTipe && filterTipe.value === 'tempo') ? 'tempo' : 'bulanan';
  onSubsTipeChange();
  updateSubsEndPreview();
  populateSubsPaketSelect();
  document.getElementById('subsModal').classList.add('show');
}
function closeNewSubscription(){ document.getElementById('subsModal').classList.remove('show'); }
function populateSubsPaketSelect(){
  const sel = document.getElementById('subsPaket');
  const paketList = serviceCatalog.filter(s=>s.type==='paket');
  if(paketList.length===0){
    sel.innerHTML = `<option value="">${t('Belum ada paket di katalog')}</option>`;
    return;
  }
  sel.innerHTML = paketList.map(p=>`<option value="${p.id}">${escapeHTML(p.nama)} — ${rupiah(p.harga)}/${t('bln')} (${p.kuotaKg}kg)</option>`).join('');
  fillSubsFromPaket();
}
function fillSubsFromPaket(){
  const id = document.getElementById('subsPaket').value;
  const paket = serviceCatalog.find(p=>p.id===id);
  if(paket) document.getElementById('subsKuota').value = paket.kuotaKg||0;
}
async function createSubscription(){
  const nama = document.getElementById('subsNama').value.trim();
  const hp = document.getElementById('subsHP').value.trim();
  const tanggalMulai = document.getElementById('subsTanggalMulai').value;
  const tempo = document.getElementById('subsTipe').value === 'tempo';

  if(!nama){ showToast(t('Nama pelanggan wajib diisi')); return; }
  if(!tanggalMulai){ showToast(t('Pilih tanggal mulai')); return; }

  let payload;
  if(tempo){
    payload = {
      nama, hp, paket_nama: t('Tempo (Bayar Nanti)'), harga_paket: 0, harga_lebih_kg: 0,
      kuota_kg: 0, tanggal_mulai: tanggalMulai, tanggal_selesai: tanggalMulai
    };
  } else {
    const paketId = document.getElementById('subsPaket').value;
    const kuota = parseFloat(document.getElementById('subsKuota').value) || 0;
    const paket = serviceCatalog.find(p=>p.id===paketId);
    if(!paket){ showToast(t('Pilih paket dari katalog dulu (tambahkan di Kelola Katalog jika belum ada)')); return; }
    if(kuota<=0){ showToast(t('Kuota harus lebih dari 0')); return; }
    payload = {
      nama, hp, paket_nama: paket.nama, harga_paket: paket.harga, harga_lebih_kg: paket.hargaLebihKg||0,
      kuota_kg: kuota, tanggal_mulai: tanggalMulai, tanggal_selesai: addOneMonthClamped(tanggalMulai)
    };
  }

  let beforeSnapshot = null;
  if(editingSubscriptionId){
    const before = subscriptions.find(s=>s.id===editingSubscriptionId);
    beforeSnapshot = before ? {...before} : null;
    const { error } = await sb.from('subscriptions').update(payload).eq('id', editingSubscriptionId);
    if(error){ showToast(t('Gagal menyimpan perubahan')); return; }
    showToast(t('Data pelanggan paket diperbarui'));
  } else {
    const { error } = await sb.from('subscriptions').insert({
      user_id: shopOwnerId, ...payload, status:'aktif', status_bayar:'belum', dp:0,
      ...(currentOutletId ? { outlet_id: currentOutletId } : {})
    });
    if(error){ showToast(t('Gagal menyimpan pelanggan paket')); return; }
    showToast(tempo ? t('Pelanggan tempo ditambahkan') : t('Pelanggan paket ditambahkan'));
    saveContactIfNew(nama, hp);
  }
  const editedId = editingSubscriptionId;
  editingSubscriptionId = null;
  closeNewSubscription();
  await loadSubscriptionsFromDB();
  if(beforeSnapshot){
    const after = subscriptions.find(s=>s.id===editedId);
    if(after) await logEditHistory('subscription', editedId, diffSubscriptionFields(beforeSnapshot, after));
  }
  renderSubscriptions();
}
async function openSubsDetail(id){
  currentSubscriptionId = id;
  const s = subscriptions.find(x=>x.id===id);
  if(!s) return;
  document.getElementById('subsDetailTitle').textContent = isTempo(s) ? `${s.nama} — ${t('Tempo (Bayar Nanti)')}` : `${s.nama} — ${s.paketNama}`;
  document.getElementById('usageTanggal').value = todayISO();
  document.getElementById('usageEstimasi').value = '';
  document.getElementById('usageBerat').value = '';
  document.getElementById('usageCatatan').value = '';
  document.getElementById('extraTanggal').value = todayISO();
  document.getElementById('extraEstimasi').value = '';
  document.getElementById('extraQty').value = '1';
  draftExtraItems = [];
  renderExtraDraftList();
  await refreshSubsDetail();
  document.getElementById('subsDetailModal').classList.add('show');
}
function closeSubsDetail(){ document.getElementById('subsDetailModal').classList.remove('show'); }
async function refreshSubsDetail(){
  const s = subscriptions.find(x=>x.id===currentSubscriptionId);
  if(!s) return;
  const { data, error } = await sb.from('subscription_usage').select('*').eq('subscription_id', s.id).order('tanggal', { ascending:false });
  currentUsageList = error ? [] : (data||[]).map(r=>({
    id:r.id, tanggal:r.tanggal, estimasi:r.estimasi||null, berat:Number(r.berat_kg)||0, catatan:r.catatan||'',
    type: r.type || 'pemakaian', layananNama:r.layanan_nama||'', qty:Number(r.qty)||0,
    satuan:r.satuan||'', harga:Number(r.harga)||0, subtotal:Number(r.subtotal)||0,
    workStatus: r.work_status || 'belum'
  }));

  const tempo = isTempo(s);
  const terpakai = currentUsageList.filter(u=>u.type==='pemakaian').reduce((sum,u)=>sum+u.berat,0);
  s.terpakai = terpakai;
  const sisaKg = Math.max(s.kuotaKg - terpakai, 0);
  const excessKg = Math.max(terpakai - s.kuotaKg, 0);
  const excessRate = s.hargaLebihKg>0 ? s.hargaLebihKg : (s.kuotaKg>0 ? s.hargaPaket/s.kuotaKg : 0);
  const excessCost = excessKg * excessRate;
  const extraList = currentUsageList.filter(u=>u.type==='layanan_tambahan');
  const extraTotal = extraList.reduce((sum,u)=>sum+u.subtotal,0);
  const totalTagihan = s.hargaPaket + excessCost + extraTotal;
  const sisaBayar = Math.max(totalTagihan - (s.dp||0), 0);
  const lebihBayar = Math.max((s.dp||0) - totalTagihan, 0);
  const lunasNow = tempo ? (totalTagihan>0 && sisaBayar<=0) : s.statusBayar==='lunas';
  s._calc = { excessKg, excessCost, extraTotal, totalTagihan, sisaBayar, lebihBayar, excessRate, lunasNow };

  document.getElementById('subsKuotaCard').style.display = tempo ? 'none' : 'block';
  document.getElementById('subsTempoCard').style.display = tempo ? 'block' : 'none';
  document.getElementById('subsUsageKgSection').style.display = tempo ? 'none' : 'block';
  document.getElementById('extraSectionHeading').textContent = tempo ? t('Catat Laundry Masuk') : t('Tambah Layanan Lain (di luar paket)');
  document.getElementById('extraSectionHint').textContent = tempo
    ? t('Pilih dari saran katalog atau ketik nama layanan sendiri — bisa tambah beberapa layanan sekaligus sebelum disimpan jadi satu nota.')
    : t('cth. ekspres — pilih dari saran katalog atau ketik manual, ditagih bersama saat lunas.');
  document.getElementById('extraSectionSubmitBtn').textContent = tempo ? t('+ Tambah Layanan') : t('+ Tambah Layanan Ini');
  document.getElementById('usageListHeading').textContent = tempo ? t('Rekap Riwayat Transaksi (Belum Ditagih)') : t('Riwayat Periode Ini');
  document.getElementById('sumHargaPaketRow').style.display = tempo ? 'none' : 'flex';
  document.getElementById('sumExtraLabel').textContent = tempo ? t('Total Kunjungan') : t('Layanan Tambahan');
  document.getElementById('btnMarkLunas').textContent = tempo ? t('✅ Tandai Lunas & Mulai Baru') : t('✅ Tandai Lunas');

  if(tempo){
    document.getElementById('subsTempoKunjungan').textContent = extraList.length;
    document.getElementById('subsTempoBelum').textContent = rupiah(sisaBayar);
    document.getElementById('subsDetailPeriode').textContent = `${t('Terdaftar sejak')} ${fmtDate(s.tanggalMulai)} · ${extraList.length} ${t('kunjungan tercatat')}`;
  } else {
    document.getElementById('subsDetailPeriode').textContent = `${t('Periode:')} ${fmtDate(s.tanggalMulai)} – ${fmtDate(s.tanggalSelesai)}`;
    document.getElementById('subsDetailKuota').textContent = `${fmtKg(s.kuotaKg)} kg`;
    document.getElementById('subsDetailSisa').textContent = excessKg>0 ? `${t('Lebih')} ${fmtKg(excessKg)} kg` : `${fmtKg(sisaKg)} kg`;
  }

  document.getElementById('sumHargaPaket').textContent = rupiah(s.hargaPaket);
  document.getElementById('sumKelebihanRow').style.display = excessCost>0 ? 'flex' : 'none';
  document.getElementById('sumKelebihan').textContent = `${fmtKg(excessKg)} kg × ${rupiah(excessRate)} = ${rupiah(excessCost)}`;
  document.getElementById('sumExtraRow').style.display = extraTotal>0 ? 'flex' : 'none';
  document.getElementById('sumExtra').textContent = rupiah(extraTotal);
  document.getElementById('sumTotal').textContent = rupiah(totalTagihan);
  document.getElementById('sumDP').textContent = rupiah(s.dp||0);
  document.getElementById('sumSisa').textContent = rupiah(sisaBayar);
  document.getElementById('sumLebihBayarRow').style.display = lebihBayar>0 ? 'flex' : 'none';
  document.getElementById('sumLebihBayar').textContent = rupiah(lebihBayar);
  document.getElementById('subsDPInput').value = s.dp||0;

  document.getElementById('subsPayBadge').innerHTML = `<span class="badge ${lunasNow?'badge-lunas':'badge-belum'}">${lunasNow?t('LUNAS'):t('BELUM LUNAS')}</span>`;
  document.getElementById('btnMarkLunas').style.display = (tempo ? totalTagihan<=0 : s.statusBayar==='lunas') ? 'none' : 'flex';

  renderUsageList();
}
/* Nomor urut 2 digit (01, 02, ...) dari tanggal tertua ke termuda. */
function padNo(n){ return String(n).padStart(2,'0'); }
function renderUsageList(){
  const el = document.getElementById('usageList');
  if(currentUsageList.length===0){
    el.innerHTML = `<div style="font-size:12.5px;color:var(--ink-soft);text-align:center;padding:10px 0;">${t('Belum ada catatan di periode ini.')}</div>`;
    return;
  }
  const byDateAsc = (a,b)=> a.tanggal<b.tanggal?-1:(a.tanggal>b.tanggal?1:0);
  const pemakaianList = currentUsageList.filter(u=>u.type!=='layanan_tambahan').slice().sort(byDateAsc);
  const extraList = currentUsageList.filter(u=>u.type==='layanan_tambahan').slice().sort(byDateAsc);

  /* Nomor urut ditaruh di kolom sendiri (lebar tetap) supaya baris lanjutan saat teks
     membungkus rata di bawah teksnya (menjorok), bukan mepet balik ke bawah angkanya. */
  const numberedLabel = (no, text)=> `<span style="display:flex;gap:4px;flex:1;min-width:0;">
        <span style="flex:none;">${padNo(no)}.</span>
        <span style="min-width:0;">${text}</span>
      </span>`;
  const pemakaianHTML = pemakaianList.map((u,i)=>`<div class="item-line" style="align-items:center;">
      ${numberedLabel(i+1, `${fmtDate(u.tanggal)} — ${t('Laundry masuk')} ${u.catatan ? '('+escapeHTML(u.catatan)+')' : ''}`)}
      <span style="display:flex;align-items:center;gap:8px;flex:none;">${fmtKg(u.berat)} kg
        <button onclick="openUsageNotaOptions('${u.id}')" style="background:none;border:none;color:var(--suds);font-size:14px;cursor:pointer;" title="${t('Kirim nota')}">🧾</button>
        <button onclick="deleteUsage('${u.id}')" style="background:none;border:none;color:var(--danger);font-size:15px;cursor:pointer;">✕</button>
      </span>
    </div>`).join('');
  const extraHTML = extraList.map((u,i)=>`<div class="item-line" style="align-items:center;">
      ${numberedLabel(i+1, `${fmtDate(u.tanggal)} — ${escapeHTML(u.layananNama)} (${u.qty} ${u.satuan})`)}
      <span style="display:flex;align-items:center;gap:8px;flex:none;">${rupiah(u.subtotal)}
        <button onclick="deleteUsage('${u.id}')" style="background:none;border:none;color:var(--danger);font-size:15px;cursor:pointer;">✕</button>
      </span>
    </div>`).join('');
  const sectionLabel = (text)=> `<div class="section-title" style="margin:0 0 6px;">${text}</div>`;

  /* Kalau dua-duanya ada (Paket Bulanan dengan layanan tambahan), pisahkan jadi dua
     blok — paket di atas, layanan tambahan di bawah — biar tidak tercampur jadi satu
     daftar kronologis yang membingungkan (nomor urut loncat antar jenis). */
  if(pemakaianList.length>0 && extraList.length>0){
    el.innerHTML = sectionLabel(t('Timbangan Paket')) + pemakaianHTML
      + `<div style="border-top:3px solid #000;margin:14px 0;"></div>`
      + sectionLabel(t('Layanan Tambahan')) + extraHTML;
  } else if(pemakaianList.length>0){
    el.innerHTML = pemakaianHTML;
  } else {
    el.innerHTML = extraHTML;
  }
}
async function addUsage(){
  const s = subscriptions.find(x=>x.id===currentSubscriptionId);
  if(!s) return;
  const tanggal = document.getElementById('usageTanggal').value || todayISO();
  const estimasi = document.getElementById('usageEstimasi').value || null;
  const berat = parseFloat(document.getElementById('usageBerat').value) || 0;
  const catatan = document.getElementById('usageCatatan').value.trim();
  if(berat<=0){ showToast(t('Isi berat laundry (kg)')); return; }

  const { data: inserted, error } = await sb.from('subscription_usage').insert({
    subscription_id: s.id, user_id: shopOwnerId, tanggal, estimasi, berat_kg: berat, catatan, type:'pemakaian'
  }).select().single();
  if(error){ showToast(t('Gagal mencatat laundry masuk')); return; }
  document.getElementById('usageEstimasi').value = '';
  document.getElementById('usageBerat').value = '';
  document.getElementById('usageCatatan').value = '';
  if(inserted){
    allWorkUsage.push({
      id:inserted.id, subscriptionId:s.id, tanggal:inserted.tanggal, estimasi:inserted.estimasi||null,
      type:'pemakaian', layananNama:'', qty:0, satuan:'', harga:0, subtotal:0,
      berat:Number(inserted.berat_kg)||0, catatan:inserted.catatan||'', workStatus:'belum'
    });
  }
  await refreshSubsDetail();
  showToast(t('Laundry masuk tercatat'));
  if(inserted) openUsageNotaOptions(inserted.id);
}
/* Layanan boleh dipilih dari katalog (autocomplete) ATAU diketik manual bebas —
   tidak wajib ada di katalog, beda dari <select> lama yang memaksa pilih katalog. */
function showExtraLayananSuggest(){
  const val = document.getElementById('extraLayanan').value.trim().toLowerCase();
  const box = document.getElementById('extraLayananSuggestBox');
  const options = serviceCatalog.filter(s=>s.type!=='paket' && (!val || s.nama.toLowerCase().includes(val)));
  if(options.length===0){ box.classList.remove('show'); box.innerHTML=''; return; }
  box.innerHTML = options.map(s=>`
    <div class="suggest-item" onmousedown="event.preventDefault();selectExtraLayananSuggest('${s.id}')">
      ${escapeHTML(s.nama)}<small>${s.satuan} · ${rupiah(s.harga)}</small>
    </div>`).join('');
  box.classList.add('show');
}
function hideExtraLayananSuggestDelayed(){
  setTimeout(()=>{ const box=document.getElementById('extraLayananSuggestBox'); if(box) box.classList.remove('show'); }, 150);
}
function selectExtraLayananSuggest(id){
  const match = serviceCatalog.find(s=>String(s.id)===String(id));
  if(!match) return;
  document.getElementById('extraLayanan').value = match.nama;
  document.getElementById('extraHarga').value = match.harga;
  document.getElementById('extraSatuan').value = match.satuan;
  document.getElementById('extraLayananSuggestBox').classList.remove('show');
}
/* Untuk Tempo: "+ Tambah Layanan Ini" hanya menambah ke daftar draft (belum
   tersimpan ke database) supaya bisa input banyak layanan sekaligus dalam satu
   kunjungan, persis seperti Layanan di Transaksi Baru — baru benar-benar
   tersimpan + jadi satu nota gabungan saat "Simpan & Buat Nota" ditekan.
   Untuk Paket Bulanan, perilaku lama dipertahankan: tersimpan langsung sekali
   tambah, tanpa nota otomatis. */
async function addExtraService(){
  const s = subscriptions.find(x=>x.id===currentSubscriptionId);
  if(!s) return;
  const nama = document.getElementById('extraLayanan').value.trim();
  const satuan = document.getElementById('extraSatuan').value;
  const qty = parseFloat(document.getElementById('extraQty').value) || 0;
  const harga = parseFloat(document.getElementById('extraHarga').value) || 0;
  if(!nama){ showToast(t('Isi nama layanan dulu')); return; }
  if(qty<=0 || harga<=0){ showToast(t('Isi qty dan harga layanan')); return; }
  const subtotal = qty*harga;
  const tanggal = document.getElementById('extraTanggal').value || todayISO();
  const estimasi = document.getElementById('extraEstimasi').value || null;

  if(isTempo(s)){
    draftExtraItems.push({ tanggal, estimasi, nama, qty, satuan, harga, subtotal });
    document.getElementById('extraLayanan').value = '';
    document.getElementById('extraQty').value = '1';
    document.getElementById('extraHarga').value = '';
    renderExtraDraftList();
    return;
  }

  const { data, error } = await sb.from('subscription_usage').insert({
    subscription_id: s.id, user_id: shopOwnerId, tanggal, estimasi,
    type:'layanan_tambahan', layanan_nama: nama, qty, satuan, harga, subtotal
  }).select().single();
  if(error){ showToast(t('Gagal menambah layanan')); return; }
  allWorkUsage.push({ id:data.id, subscriptionId:s.id, tanggal:data.tanggal, estimasi:data.estimasi||null, type:'layanan_tambahan', layananNama:data.layanan_nama, qty:Number(data.qty)||0, satuan:data.satuan||'', harga:Number(data.harga)||0, subtotal:Number(data.subtotal)||0, workStatus:'belum' });
  document.getElementById('extraLayanan').value = '';
  document.getElementById('extraQty').value = '1';
  document.getElementById('extraHarga').value = '';
  await refreshSubsDetail();
  showToast(t('Layanan tambahan dicatat'));
}
function renderExtraDraftList(){
  const wrap = document.getElementById('extraDraftListWrap');
  const el = document.getElementById('extraDraftList');
  if(draftExtraItems.length===0){ wrap.style.display = 'none'; el.innerHTML=''; return; }
  wrap.style.display = 'block';
  el.innerHTML = draftExtraItems.map((it,i)=>`
    <div class="item-line" style="align-items:center;">
      <span>${escapeHTML(it.nama)} (${it.qty} ${escapeHTML(it.satuan)})</span>
      <span style="display:flex;align-items:center;gap:8px;">
        ${rupiah(it.subtotal)}
        <button onclick="removeExtraDraftItem(${i})" style="background:none;border:none;color:var(--danger);font-size:15px;cursor:pointer;">✕</button>
      </span>
    </div>`).join('');
}
function removeExtraDraftItem(idx){
  draftExtraItems.splice(idx,1);
  renderExtraDraftList();
}
async function submitExtraServiceBatch(){
  const s = subscriptions.find(x=>x.id===currentSubscriptionId);
  if(!s || draftExtraItems.length===0){ showToast(t('Tambahkan minimal 1 layanan dulu')); return; }
  const insertedIds = [];
  for(const it of draftExtraItems){
    const { data, error } = await sb.from('subscription_usage').insert({
      subscription_id: s.id, user_id: shopOwnerId, tanggal: it.tanggal, estimasi: it.estimasi,
      type:'layanan_tambahan', layanan_nama: it.nama, qty: it.qty, satuan: it.satuan, harga: it.harga, subtotal: it.subtotal
    }).select().single();
    if(error){ showToast(t('Gagal menyimpan salah satu layanan, coba lagi')); return; }
    insertedIds.push(data.id);
    allWorkUsage.push({ id:data.id, subscriptionId:s.id, tanggal:data.tanggal, estimasi:data.estimasi||null, type:'layanan_tambahan', layananNama:data.layanan_nama, qty:Number(data.qty)||0, satuan:data.satuan||'', harga:Number(data.harga)||0, subtotal:Number(data.subtotal)||0, workStatus:'belum' });
  }
  draftExtraItems = [];
  renderExtraDraftList();
  await refreshSubsDetail();
  showToast(t('Layanan tercatat'));
  openBatchUsageNotaOptions(insertedIds);
}
async function deleteUsage(id){
  const item = currentUsageList.find(u=>u.id===id);
  if(!item) return;
  const label = item.type==='layanan_tambahan' ? `${t('layanan')} "${item.layananNama}"` : t('catatan laundry masuk');
  if(!confirm(`${t('Hapus')} ${label} ${t('tanggal')} ${fmtDate(item.tanggal)}?`)) return;
  const { error } = await sb.from('subscription_usage').delete().eq('id', id);
  if(error){ showToast(t('Gagal menghapus catatan')); return; }
  allWorkUsage = allWorkUsage.filter(u=>u.id!==id);
  const subId = currentSubscriptionId;
  await refreshSubsDetail();
  showToast(t('Catatan dihapus'), {
    label: t('Urungkan'),
    onClick: async ()=>{
      const payload = item.type==='layanan_tambahan'
        ? { subscription_id: subId, user_id: shopOwnerId, tanggal: item.tanggal, estimasi: item.estimasi, type:'layanan_tambahan', layanan_nama: item.layananNama, qty: item.qty, satuan: item.satuan, harga: item.harga, subtotal: item.subtotal }
        : { subscription_id: subId, user_id: shopOwnerId, tanggal: item.tanggal, estimasi: item.estimasi, berat_kg: item.berat, catatan: item.catatan, type:'pemakaian' };
      const { data, error: err2 } = await sb.from('subscription_usage').insert(payload).select().single();
      if(err2){ showToast(t('Gagal mengembalikan catatan')); return; }
      if(data && data.type==='layanan_tambahan'){
        allWorkUsage.push({ id:data.id, subscriptionId:subId, tanggal:data.tanggal, estimasi:data.estimasi||null, type:'layanan_tambahan', layananNama:data.layanan_nama, qty:Number(data.qty)||0, satuan:data.satuan||'', harga:Number(data.harga)||0, subtotal:Number(data.subtotal)||0, workStatus:'belum' });
      } else if(data){
        allWorkUsage.push({ id:data.id, subscriptionId:subId, tanggal:data.tanggal, estimasi:data.estimasi||null, type:'pemakaian', layananNama:'', qty:0, satuan:'', harga:0, subtotal:0, berat:Number(data.berat_kg)||0, catatan:data.catatan||'', workStatus:'belum' });
      }
      if(currentSubscriptionId===subId) await refreshSubsDetail();
      showToast(t('Catatan dikembalikan'));
    }
  });
}
async function saveSubsDP(){
  const s = subscriptions.find(x=>x.id===currentSubscriptionId);
  if(!s) return;
  const dp = parseFloat(document.getElementById('subsDPInput').value) || 0;
  const { error } = await sb.from('subscriptions').update({ dp }).eq('id', s.id);
  if(error){ showToast(t('Gagal menyimpan DP')); return; }
  s.dp = dp;
  showToast(t('DP disimpan'));
  await refreshSubsDetail();
}
async function markSubsLunas(){
  const s = subscriptions.find(x=>x.id===currentSubscriptionId);
  if(!s || !s._calc) return;
  const tempo = isTempo(s);
  if(tempo && s._calc.totalTagihan<=0){ showToast(t('Belum ada laundry yang tercatat untuk ditagih')); return; }
  const carryOverPreview = tempo ? (s._calc.lebihBayar||0) : 0;
  const confirmMsg = tempo
    ? `${t('Tandai seluruh tagihan Tempo pelanggan ini LUNAS? Rekap transaksi akan masuk ke Laporan & Riwayat Transaksi, lalu catatan kunjungan di sini direset untuk siklus bayar berikutnya.')}${carryOverPreview>0 ? ` ${t('Kelebihan bayar')} ${rupiah(carryOverPreview)} ${t('akan disimpan jadi saldo untuk laundry berikutnya (bukan dikembalikan tunai).')}` : ''}`
    : t('Tandai periode paket ini LUNAS? Tagihan akan otomatis masuk ke Laporan & Riwayat Transaksi.');
  if(!confirm(confirmMsg)) return;
  const calc = s._calc;
  const extras = currentUsageList.filter(u=>u.type==='layanan_tambahan');
  const items = [];
  if(!tempo) items.push({ nama:`${t('Paket Bulanan')} - ${s.paketNama}`, qty:1, satuan:t('paket'), harga:s.hargaPaket, subtotal:s.hargaPaket });
  if(calc.excessCost>0) items.push({ nama:t('Kelebihan Kuota'), qty:calc.excessKg, satuan:'kg', harga:calc.excessRate, subtotal:calc.excessCost });
  extras.forEach(u=>{
    items.push({ nama:u.layananNama, qty:u.qty, satuan:u.satuan, harga:u.harga, subtotal:u.subtotal });
  });
  const today = todayISO();
  const catatan = tempo
    ? `${t('Pembayaran Tempo (Bayar Nanti) - rekap')} ${extras.length} ${currentLang==='en' ? (extras.length===1?'visit':'visits') : t('kunjungan')}`
    : `${t('Pembayaran Paket Bulanan periode')} ${fmtDate(s.tanggalMulai)} - ${fmtDate(s.tanggalSelesai)}`;
  const { data, error } = await sb.from('transactions').insert({
    user_id: shopOwnerId, kode: nextKode(), nama:s.nama, hp:s.hp, tanggal: today,
    estimasi:null, items, diskon:0, total: calc.totalTagihan, dp: calc.totalTagihan,
    status:'lunas', catatan
  }).select().single();
  if(error){ showToast(t('Gagal membuat catatan pembayaran')); return; }
  transactions.push({
    id:data.id, kode:data.kode, nama:data.nama, hp:data.hp, tanggal:data.tanggal, estimasi:data.estimasi,
    items:data.items, diskon:Number(data.diskon), total:Number(data.total), dp:Number(data.dp),
    status:data.status, catatan:data.catatan
  });
  if(tempo){
    const carryOver = calc.lebihBayar||0;
    await sb.from('subscription_usage').delete().eq('subscription_id', s.id);
    allWorkUsage = allWorkUsage.filter(u=>u.subscriptionId!==s.id);
    const { error: err2 } = await sb.from('subscriptions').update({
      status_bayar:'belum', dp: carryOver, lunas_at: today, transaction_id: data.id
    }).eq('id', s.id);
    if(err2){ showToast(t('Pembayaran tercatat, tapi gagal mereset catatan Tempo')); }
    s.statusBayar = 'belum'; s.dp = carryOver; s.lunasAt = today; s.transactionId = data.id;
    s.tempoTotal = 0; s.tempoCount = 0;
    currentUsageList = [];
    showToast(carryOver>0
      ? `${t('Pembayaran tercatat. Kelebihan')} ${rupiah(carryOver)} ${t('disimpan jadi saldo untuk laundry berikutnya.')}`
      : t('Pembayaran tercatat & masuk ke laporan omset. Siklus baru dimulai.'));
  } else {
    const { error: err2 } = await sb.from('subscriptions').update({
      status_bayar:'lunas', dp: calc.totalTagihan, lunas_at: today, transaction_id: data.id
    }).eq('id', s.id);
    if(err2){ showToast(t('Pembayaran tercatat, tapi gagal update status paket')); }
    s.statusBayar = 'lunas'; s.dp = calc.totalTagihan; s.lunasAt = today; s.transactionId = data.id;
    showToast(t('Paket ditandai lunas & masuk ke laporan omset'));
  }
  await refreshSubsDetail();
  renderSubscriptions();
}
function subsInvoiceTextWA(s){
  const calc = s._calc || { excessKg:0, excessCost:0, excessRate:0, totalTagihan:s.hargaPaket, sisaBayar:s.hargaPaket-(s.dp||0), lebihBayar:Math.max((s.dp||0)-s.hargaPaket,0), lunasNow:s.statusBayar==='lunas' };
  const tempo = isTempo(s);
  const lines = [];
  const hdr = notaHeaderInfo(s.outletId);
  lines.push(`*${hdr.nama}*`);
  if(hdr.subtitle) lines.push(hdr.subtitle);
  if(hdr.alamat) lines.push(hdr.alamat);
  if(hdr.telp) lines.push(hdr.telp);
  lines.push('-------------------------------');
  lines.push(`${t('Pelanggan')}  : ${s.nama}`);
  if(tempo){
    const extras = currentUsageList.filter(u=>u.type==='layanan_tambahan')
      .slice().sort((a,b)=> a.tanggal<b.tanggal?-1:(a.tanggal>b.tanggal?1:0));
    const latest = extras[extras.length-1];
    lines.push(`${t('Jenis')}      : ${t('Tempo (Bayar Nanti)')}`);
    lines.push(`${t('Terdaftar')}  : ${fmtDate(s.tanggalMulai)}`);
    if(latest){
      lines.push('-------------------------------');
      lines.push(`*${t('Timbangan Sekarang')}*`);
      lines.push(`*${fmtDate(latest.tanggal)} — ${latest.layananNama} : ${fmtKg(latest.qty)} ${latest.satuan} x ${rupiah(latest.harga)} = ${rupiah(latest.subtotal)}*`);
    }
    lines.push('-------------------------------');
    lines.push(`*${t('Rekap Riwayat Transaksi (Belum Ditagih)')}*`);
    extras.forEach((u,i)=>{
      lines.push(`${padNo(i+1)}. ${fmtDate(u.tanggal)} — ${u.layananNama} : ${fmtKg(u.qty)} ${u.satuan} x ${rupiah(u.harga)} = ${rupiah(u.subtotal)}`);
    });
  } else {
    lines.push(`${t('Paket')}      : ${s.paketNama}`);
    lines.push(`${t('Periode')}    : ${fmtDate(s.tanggalMulai)} - ${fmtDate(s.tanggalSelesai)}`);
    lines.push('-------------------------------');
    lines.push(`${t('Terpakai')}   : ${fmtKg(s.terpakai)} / ${fmtKg(s.kuotaKg)} kg`);
    lines.push(`${t('Harga Paket')} : ${rupiah(s.hargaPaket)}`);
    if(calc.excessCost>0) lines.push(`${t('Kelebihan')}  : ${fmtKg(calc.excessKg)} kg x ${rupiah(calc.excessRate)} = ${rupiah(calc.excessCost)}`);
    currentUsageList.filter(u=>u.type==='layanan_tambahan')
      .slice().sort((a,b)=> a.tanggal<b.tanggal?-1:(a.tanggal>b.tanggal?1:0))
      .forEach((u,i)=>{
        lines.push(`${padNo(i+1)}. ${u.layananNama} : ${fmtKg(u.qty)} ${u.satuan} x ${rupiah(u.harga)} = ${rupiah(u.subtotal)}`);
      });
  }
  lines.push('-------------------------------');
  lines.push(`*${t('TOTAL TAGIHAN')} : ${rupiah(calc.totalTagihan)}*`);
  lines.push(`${t('Sudah Dibayar')} : ${rupiah(s.dp||0)}`);
  lines.push(`${t('Sisa Bayar')} : ${rupiah(calc.sisaBayar)}`);
  if(calc.lebihBayar>0) lines.push(`${t('Kelebihan Bayar')} : ${rupiah(calc.lebihBayar)} (${t('saldo untuk laundry berikutnya, bukan kembalian')})`);
  lines.push(`${t('Status')}     : ${calc.lunasNow ? t('LUNAS') : t('BELUM LUNAS')}`);
  lines.push('-------------------------------');
  lines.push(settings.note || t('Terima kasih'));
  lines.push(...notaFooterLinesWA());
  return lines.join('\n');
}
function buildSubsInvoicePDFLines(s){
  const calc = s._calc || { excessKg:0, excessCost:0, excessRate:0, totalTagihan:s.hargaPaket, sisaBayar:s.hargaPaket-(s.dp||0), lebihBayar:Math.max((s.dp||0)-s.hargaPaket,0), lunasNow:s.statusBayar==='lunas' };
  const tempo = isTempo(s);
  const L = [];
  const div = '--------------------------------';
  const hdr = notaHeaderInfo(s.outletId);
  L.push({t: hdr.nama, c:true, b:true, s:12});
  if(hdr.subtitle) L.push({t: hdr.subtitle, c:true, s:8});
  if(hdr.alamat) L.push({t: hdr.alamat, c:true, s:8});
  if(hdr.telp) L.push({t: hdr.telp, c:true, s:8});
  L.push({t: div, s:9});
  L.push({t: tempo ? t('REKAP TAGIHAN TEMPO') : t('TAGIHAN PAKET BULANAN'), c:true, b:true, s:10});
  L.push({t:`${t('Pelanggan')}  : ${s.nama}`, s:9, indent:13});
  if(tempo){
    const extras = currentUsageList.filter(u=>u.type==='layanan_tambahan')
      .slice().sort((a,b)=> a.tanggal<b.tanggal?-1:(a.tanggal>b.tanggal?1:0));
    const latest = extras[extras.length-1];
    L.push({t:`${t('Jenis')}      : ${t('Tempo (Bayar Nanti)')}`, s:9, indent:13});
    L.push({t:`${t('Terdaftar')}  : ${fmtDate(s.tanggalMulai)}`, s:9, indent:13});
    if(latest){
      L.push({t: div, s:9});
      L.push({t:t('TIMBANGAN SEKARANG'), b:true, s:9});
      L.push({t:`${fmtDate(latest.tanggal)} — ${latest.layananNama} : ${fmtKg(latest.qty)} ${latest.satuan} x ${rupiah(latest.harga)} = ${rupiah(latest.subtotal)}`, b:true, s:11});
    }
    L.push({t: div, s:9});
    L.push({t:t('REKAP RIWAYAT TRANSAKSI (BELUM DITAGIH)'), b:true, s:9});
    extras.forEach((u,i)=>{
      L.push({t:`${padNo(i+1)}. ${fmtDate(u.tanggal)} — ${u.layananNama} : ${fmtKg(u.qty)} ${u.satuan} x ${rupiah(u.harga)} = ${rupiah(u.subtotal)}`, s:8, indent:4});
    });
  } else {
    L.push({t:`${t('Paket')}      : ${s.paketNama}`, s:9, indent:13});
    L.push({t:`${t('Periode')}    : ${fmtDate(s.tanggalMulai)} - ${fmtDate(s.tanggalSelesai)}`, s:9, indent:13});
    L.push({t: div, s:9});
    L.push({t:`${t('Terpakai')}    : ${fmtKg(s.terpakai)} / ${fmtKg(s.kuotaKg)} kg`, s:9, indent:14});
    L.push({t:`${t('Harga Paket')} : ${rupiah(s.hargaPaket)}`, s:9, indent:14});
    if(calc.excessCost>0) L.push({t:`${t('Kelebihan')}   : ${fmtKg(calc.excessKg)} kg x ${rupiah(calc.excessRate)} = ${rupiah(calc.excessCost)}`, s:8, indent:14});
    currentUsageList.filter(u=>u.type==='layanan_tambahan')
      .slice().sort((a,b)=> a.tanggal<b.tanggal?-1:(a.tanggal>b.tanggal?1:0))
      .forEach((u,i)=>{
        L.push({t:`${padNo(i+1)}. ${u.layananNama} : ${fmtKg(u.qty)} ${u.satuan} x ${rupiah(u.harga)} = ${rupiah(u.subtotal)}`, s:8, indent:4});
      });
  }
  L.push({t: div, s:9});
  L.push({t:`${t('Total Tagihan')}  : ${rupiah(calc.totalTagihan)}`, b:true, s:9, indent:17});
  L.push({t:`${t('Sudah Dibayar')}  : ${rupiah(s.dp||0)}`, s:9, indent:17});
  L.push({t:`${t('Sisa Bayar')}     : ${rupiah(calc.sisaBayar)}`, s:9, indent:17});
  if(calc.lebihBayar>0) L.push({t:`${t('Kelebihan Bayar')} : ${rupiah(calc.lebihBayar)} (${t('saldo laundry berikutnya')})`, s:8, indent:17});
  L.push({t:`${t('Status')}         : ${calc.lunasNow ? t('LUNAS') : t('BELUM LUNAS')}`, s:9, indent:17});
  L.push({t: div, s:9});
  L.push({t: settings.note || t('Terima kasih'), c:true, s:8});
  L.push(...notaFooterLinesPDF());
  return L;
}
function openSubsInvoiceShare(){
  const s = subscriptions.find(x=>x.id===currentSubscriptionId);
  if(!s) return;
  document.getElementById('subsInvoiceShareModal').classList.add('show');
}
function closeSubsInvoiceShare(){
  document.getElementById('subsInvoiceShareModal').classList.remove('show');
}
function sendSubsInvoiceWA(target){
  const s = subscriptions.find(x=>x.id===currentSubscriptionId);
  if(!s) return;
  if(!s.hp){ showToast(t('No. WhatsApp pelanggan belum diisi')); closeSubsInvoiceShare(); return; }
  openWA(normalizePhone(s.hp), subsInvoiceTextWA(s), target);
  closeSubsInvoiceShare();
}
async function downloadSubsInvoiceImage(){
  const s = subscriptions.find(x=>x.id===currentSubscriptionId);
  if(!s) return;
  await shareOrDownloadNotaImage(buildSubsInvoicePDFLines(s), `${t('Tagihan')}-${(s.nama||t('pelanggan')).replace(/\s+/g,'-')}`, 80, `${t('Tagihan paket')} - ${s.nama}`);
  closeSubsInvoiceShare();
}
function editSubscription(){
  const s = subscriptions.find(x=>x.id===currentSubscriptionId);
  if(!s) return;
  editingSubscriptionId = s.id;
  document.getElementById('subsModalTitle').textContent = t('Edit Pelanggan Paket');
  document.getElementById('subsSubmitBtn').textContent = t('Simpan Perubahan');
  document.getElementById('subsNama').value = s.nama;
  document.getElementById('subsHP').value = s.hp||'';
  document.getElementById('subsKuota').value = s.kuotaKg;
  document.getElementById('subsTanggalMulai').value = s.tanggalMulai;
  document.getElementById('subsTipe').value = isTempo(s) ? 'tempo' : 'bulanan';
  onSubsTipeChange();
  populateSubsPaketSelect();
  const paketOpt = serviceCatalog.find(p=>p.type==='paket' && p.nama===s.paketNama);
  if(paketOpt) document.getElementById('subsPaket').value = paketOpt.id;
  updateSubsEndPreview();
  closeSubsDetail();
  document.getElementById('subsModal').classList.add('show');
}
async function deleteSubscription(){
  const s = subscriptions.find(x=>x.id===currentSubscriptionId);
  if(!s) return;
  if(!confirm(`${t('Hapus pelanggan paket')} "${s.nama}"? ${t('Semua riwayat pemakaian & layanan tambahan periode ini juga akan terhapus.')}`)) return;
  await sb.from('subscription_usage').delete().eq('subscription_id', s.id);
  allWorkUsage = allWorkUsage.filter(u=>u.subscriptionId!==s.id);
  const { error } = await sb.from('subscriptions').delete().eq('id', s.id);
  if(error){ showToast(t('Gagal menghapus paket')); return; }
  subscriptions = subscriptions.filter(x=>x.id!==s.id);
  closeSubsDetail();
  renderSubscriptions();
  showToast(t('Pelanggan paket dihapus'));
}

