import { chromium } from 'playwright';

const errors = [];
// PW_CHROMIUM_PATH hanya perlu di-set di sandbox tertentu yang tidak menyediakan
// Chromium bawaan Playwright di lokasi default (lihat tests/README.md). Di mesin
// biasa (sudah `npx playwright install chromium`), biarkan kosong.
const launchOpts = process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {};
const browser = await chromium.launch(launchOpts);
const page = await browser.newPage();
await page.route(/^https:\/\/(fonts\.googleapis\.com|cdn\.jsdelivr\.net)\//, r => r.fulfill({ status: 200, contentType: 'text/plain', body: '' }));
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', msg => { if (msg.type() === 'error') errors.push('CONSOLE: ' + msg.text()); });

// The real @supabase/supabase-js CDN script can't load in this sandbox (network blocked),
// so `const sb = supabase.createClient(...)` at the top of index.html would throw and leave
// the lexical `sb` binding permanently in the TDZ. Stub `window.supabase` BEFORE the page's
// own script runs, so that assignment succeeds and `sb` becomes a real (fake) client object
// whose methods we can still override per-test from inside page.evaluate.
await page.addInitScript(() => {
  function fakeQuery(data) {
    const q = {
      select: () => q, eq: () => q, in: () => q, order: () => q, limit: () => q,
      update: () => q, insert: () => q, delete: () => q,
      single: () => Promise.resolve({ data: Array.isArray(data) ? data[0] : data, error: null }),
      maybeSingle: () => Promise.resolve({ data: Array.isArray(data) ? data[0] : data, error: null }),
      then: (resolve) => resolve({ data, error: null }),
    };
    return q;
  }
  window.supabase = {
    createClient: () => ({
      auth: {
        // Fires the caller's callback with a fake "already logged in" session via a
        // microtask -- this mimics real supabase-js's _emitInitialSession() timing,
        // which can resolve BETWEEN two <script src="js/*.js"> tags finishing/starting
        // (classic scripts only block each other, they don't wait out queued microtasks
        // from the previous one). This is exactly the shape of a real regression that
        // shipped once: the auth listener called resolveRoleAndInit() (defined in a
        // LATER-loaded module) and threw "ReferenceError: resolveRoleAndInit is not
        // defined" in production, silently forcing every user to log in again on every
        // visit. Exercising the real callback here on every test run is the cheapest
        // possible regression guard for that whole class of "works in one script,
        // breaks once split across <script src> tags" bug.
        onAuthStateChange: (cb) => {
          Promise.resolve().then(() => cb('SIGNED_IN', { user: { id: 'init-load-test-user', email: 'init-load@test.com' } }));
          return { data: { subscription: { unsubscribe(){} } } };
        },
        signInWithPassword: async () => ({ data:null, error:{message:'stubbed'} }),
        signUp: async () => ({ data:null, error:{message:'stubbed'} }),
        signOut: async () => ({ error:null }),
        resetPasswordForEmail: async () => ({ error:null }),
        updateUser: async () => ({ error:null }),
        getSession: async () => ({ data:{ session:null }, error:null }),
      },
      from: () => fakeQuery([]),
    }),
  };
});

await page.goto('http://127.0.0.1:8931/index.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(300); // let the fake-session microtask above (and whatever it triggers) settle

console.log('--- initial load errors ---');
console.log(errors.length ? errors.join('\n') : '(none)');

// Known-benign noise from this sandbox's blocked network (CDN fetches for the real
// supabase-js/jspdf/html2canvas/Google Fonts scripts, and the manifest icon files) --
// anything else here is a REAL bug (like the resolveRoleAndInit ReferenceError above)
// and must fail the run, not just get printed.
const BENIGN_INITIAL_LOAD_ERROR = /ERR_CONNECTION_RESET|bad HTTP response code \(404\)|status of 404|favicon|icon-(192|512)\.png/i;
const unexpectedInitialErrors = errors.filter(e => !BENIGN_INITIAL_LOAD_ERROR.test(e));
if (unexpectedInitialErrors.length) {
  console.log('--- UNEXPECTED initial load errors (failing) ---');
  console.log(unexpectedInitialErrors.join('\n'));
  await browser.close();
  process.exit(1);
}

// Now stub environment and exercise the tempo feature functions directly,
// bypassing real Supabase network calls.
const result = await page.evaluate(async () => {
  const out = { steps: [], errors: [] };
  async function step(name, fn) {
    try { await fn(); out.steps.push(`OK: ${name}`); }
    catch (e) { out.errors.push(`FAIL: ${name} -> ${e.message}\n${e.stack}`); }
  }

  // Fake chainable supabase query builder that resolves to given data.
  function fakeQuery(data) {
    const q = {
      select: () => q, eq: () => q, in: () => q, order: () => q, limit: () => q,
      update: () => q, insert: () => q, delete: () => q,
      single: () => Promise.resolve({ data: Array.isArray(data) ? data[0] : data, error: null }),
      maybeSingle: () => Promise.resolve({ data: Array.isArray(data) ? data[0] : data, error: null }),
      then: (resolve) => resolve({ data, error: null }),
    };
    return q;
  }
  // `sb` itself is `const` (declared in index.html), but the client object it points to
  // (created from our addInitScript stub) is a plain mutable object, so overriding its
  // `.from` method here works fine without touching the `sb` binding itself.
  //
  // refreshSubsDetail()/openSubsDetail() always REFETCH `subscription_usage` from the DB
  // and overwrite `currentUsageList` with the result — so a test that calls either of those
  // (directly or via markSubsLunas) must drive `fakeUsageRows` (DB-shaped), not just set
  // `currentUsageList` (app-shaped) and expect it to survive.
  let fakeTxCounter = 0;
  let fakeUsageRows = [];
  function toDbRow(u) {
    return { id:u.id, subscription_id: currentSubscriptionId, tanggal:u.tanggal, berat_kg:u.berat||0,
      catatan:u.catatan||'', type:u.type, layanan_nama:u.layananNama||'', qty:u.qty||0,
      satuan:u.satuan||'', harga:u.harga||0, subtotal:u.subtotal||0 };
  }
  function fakeUsageQuery() {
    // Real supabase-js builds the request lazily across chained calls (.delete().eq('id',x),
    // or .insert(row).select().single()) and only executes on await/.single() — so this mock
    // tracks mode + filters and only mutates fakeUsageRows once the chain is actually run,
    // instead of acting immediately inside delete()/insert() (which would run before .eq()
    // even attaches its filter).
    let mode = 'select', eqFilters = {}, insertRow = null;
    const makeId = () => 'fake-usage-' + Math.random().toString(36).slice(2);
    const q = {
      select: () => q,
      eq: (col, val) => { eqFilters[col] = val; return q; },
      in: () => q, order: () => q, update: () => q,
      insert: (row) => { mode = 'insert'; insertRow = row; return q; },
      delete: () => { mode = 'delete'; return q; },
      single: () => {
        if (mode === 'insert' && insertRow) {
          const withId = { id: insertRow.id || makeId(), ...insertRow };
          fakeUsageRows.push(withId);
          insertRow = null;
          return Promise.resolve({ data: withId, error: null });
        }
        return Promise.resolve({ data: fakeUsageRows[0], error: null });
      },
      then: (resolve) => {
        if (mode === 'delete') {
          if (eqFilters.id !== undefined) fakeUsageRows = fakeUsageRows.filter(r => r.id !== eqFilters.id);
          else if (eqFilters.subscription_id !== undefined) fakeUsageRows = fakeUsageRows.filter(r => r.subscription_id !== eqFilters.subscription_id);
          else fakeUsageRows = [];
          return resolve({ data: null, error: null });
        }
        if (mode === 'insert' && insertRow) {
          const withId = { id: insertRow.id || makeId(), ...insertRow };
          fakeUsageRows.push(withId);
          insertRow = null;
          return resolve({ data: [withId], error: null });
        }
        return resolve({ data: fakeUsageRows, error: null });
      },
    };
    return q;
  }
  let lastSettingsUpsert = null;
  function fakeSettingsQuery() {
    const q = {
      select: () => q, eq: () => q, in: () => q, order: () => q, delete: () => q, insert: () => q, update: () => q,
      upsert: (row) => { lastSettingsUpsert = { ...(lastSettingsUpsert||{}), ...row }; return q; },
      single: () => Promise.resolve({ data: lastSettingsUpsert, error: null }),
      maybeSingle: () => Promise.resolve({ data: lastSettingsUpsert, error: null }),
      then: (resolve) => resolve({ data: lastSettingsUpsert ? [lastSettingsUpsert] : [], error: null }),
    };
    return q;
  }
  let lastAppBrandingUpsert = null;
  function fakeAppBrandingQuery() {
    const q = {
      select: () => q, eq: () => q, in: () => q, order: () => q, delete: () => q, insert: () => q, update: () => q,
      upsert: (row) => { lastAppBrandingUpsert = { ...(lastAppBrandingUpsert||{}), ...row }; return q; },
      single: () => Promise.resolve({ data: lastAppBrandingUpsert, error: null }),
      maybeSingle: () => Promise.resolve({ data: lastAppBrandingUpsert, error: null }),
      then: (resolve) => resolve({ data: lastAppBrandingUpsert ? [lastAppBrandingUpsert] : [], error: null }),
    };
    return q;
  }
  function fakeTransactionsQuery() {
    // insert() echoes back the actual payload (plus a fake id/kode), like a real Supabase
    // .insert(row).select().single() round-trip, so assertions on total/dp/items are meaningful.
    const q = {
      select: () => q, eq: () => q, in: () => q, order: () => q, update: () => q, delete: () => q,
      insert: (row) => { q._inserted = { id: 'fake-tx-' + (++fakeTxCounter), kode: 'TX-TEST-' + fakeTxCounter, ...row }; return q; },
      single: () => Promise.resolve({ data: q._inserted, error: null }),
      then: (resolve) => resolve({ data: q._inserted ? [q._inserted] : [], error: null }),
    };
    return q;
  }
  // Same lazy-chain-then-execute shape as fakeUsageQuery(), backing a shared
  // `fakeExpenseRows` array so insert/delete/select stay consistent across calls.
  let fakeExpenseRows = [];
  let fakeExpCounter = 0;
  function fakeExpensesQuery() {
    let mode = 'select', eqFilters = {}, insertRow = null;
    const q = {
      select: () => q,
      eq: (col, val) => { eqFilters[col] = val; return q; },
      in: () => q, order: () => q, update: () => q,
      insert: (row) => { mode = 'insert'; insertRow = row; return q; },
      delete: () => { mode = 'delete'; return q; },
      single: () => {
        if (mode === 'insert' && insertRow) {
          const withId = { id: insertRow.id || ('fake-exp-' + (++fakeExpCounter)), ...insertRow };
          fakeExpenseRows.push(withId);
          insertRow = null;
          return Promise.resolve({ data: withId, error: null });
        }
        return Promise.resolve({ data: fakeExpenseRows[0], error: null });
      },
      then: (resolve) => {
        if (mode === 'delete') {
          if (eqFilters.id !== undefined) fakeExpenseRows = fakeExpenseRows.filter(r => r.id !== eqFilters.id);
          else fakeExpenseRows = [];
          return resolve({ data: null, error: null });
        }
        if (mode === 'insert' && insertRow) {
          const withId = { id: insertRow.id || ('fake-exp-' + (++fakeExpCounter)), ...insertRow };
          fakeExpenseRows.push(withId);
          insertRow = null;
          return resolve({ data: [withId], error: null });
        }
        return resolve({ data: fakeExpenseRows, error: null });
      },
    };
    return q;
  }
  let fakeExpenseCatalogRows = [];
  let fakeExpCatCounter = 0;
  function fakeExpenseCatalogQuery() {
    let mode = 'select', eqFilters = {}, insertRow = null, updateRow = null;
    const q = {
      select: () => q,
      eq: (col, val) => { eqFilters[col] = val; return q; },
      in: () => q, order: () => q,
      update: (row) => { mode = 'update'; updateRow = row; return q; },
      insert: (row) => { mode = 'insert'; insertRow = row; return q; },
      delete: () => { mode = 'delete'; return q; },
      single: () => {
        if (mode === 'insert' && insertRow) {
          const withId = { id: insertRow.id || ('fake-expcat-' + (++fakeExpCatCounter)), ...insertRow };
          fakeExpenseCatalogRows.push(withId);
          insertRow = null;
          return Promise.resolve({ data: withId, error: null });
        }
        return Promise.resolve({ data: fakeExpenseCatalogRows[0], error: null });
      },
      then: (resolve) => {
        if (mode === 'delete') {
          if (eqFilters.id !== undefined) fakeExpenseCatalogRows = fakeExpenseCatalogRows.filter(r => r.id !== eqFilters.id);
          else fakeExpenseCatalogRows = [];
          return resolve({ data: null, error: null });
        }
        if (mode === 'update' && updateRow) {
          if (eqFilters.id !== undefined) {
            fakeExpenseCatalogRows = fakeExpenseCatalogRows.map(r => r.id === eqFilters.id ? { ...r, ...updateRow } : r);
          }
          updateRow = null;
          return resolve({ data: null, error: null });
        }
        if (mode === 'insert' && insertRow) {
          const withId = { id: insertRow.id || ('fake-expcat-' + (++fakeExpCatCounter)), ...insertRow };
          fakeExpenseCatalogRows.push(withId);
          insertRow = null;
          return resolve({ data: [withId], error: null });
        }
        return resolve({ data: fakeExpenseCatalogRows, error: null });
      },
    };
    return q;
  }
  let fakeOutletRows = [];
  let fakeOutletCounter = 0;
  function fakeOutletsQuery() {
    let mode = 'select', eqFilters = {}, insertRow = null;
    const q = {
      select: () => q,
      eq: (col, val) => { eqFilters[col] = val; return q; },
      in: () => q, order: () => q, update: () => q,
      insert: (row) => { mode = 'insert'; insertRow = row; return q; },
      delete: () => { mode = 'delete'; return q; },
      single: () => {
        if (mode === 'insert' && insertRow) {
          const withId = { id: insertRow.id || ('fake-outlet-' + (++fakeOutletCounter)), ...insertRow };
          fakeOutletRows.push(withId);
          insertRow = null;
          return Promise.resolve({ data: withId, error: null });
        }
        return Promise.resolve({ data: fakeOutletRows[0], error: null });
      },
      then: (resolve) => {
        if (mode === 'delete') {
          if (eqFilters.id !== undefined) fakeOutletRows = fakeOutletRows.filter(r => r.id !== eqFilters.id);
          else fakeOutletRows = [];
          return resolve({ data: null, error: null });
        }
        if (mode === 'insert' && insertRow) {
          const withId = { id: insertRow.id || ('fake-outlet-' + (++fakeOutletCounter)), ...insertRow };
          fakeOutletRows.push(withId);
          insertRow = null;
          return resolve({ data: [withId], error: null });
        }
        return resolve({ data: fakeOutletRows, error: null });
      },
    };
    return q;
  }
  let fakeEditLogRows = [];
  let fakeEditLogCounter = 0;
  function fakeEditLogQuery() {
    let mode = 'select', eqFilters = {}, insertRow = null;
    const q = {
      select: () => q,
      eq: (col, val) => { eqFilters[col] = val; return q; },
      in: () => q, order: () => q, update: () => q,
      insert: (row) => { mode = 'insert'; insertRow = row; return q; },
      delete: () => { mode = 'delete'; return q; },
      single: () => {
        if (mode === 'insert' && insertRow) {
          const withId = { id: insertRow.id || ('fake-editlog-' + (++fakeEditLogCounter)), edited_at: insertRow.edited_at || new Date().toISOString(), ...insertRow };
          fakeEditLogRows.push(withId);
          insertRow = null;
          return Promise.resolve({ data: withId, error: null });
        }
        return Promise.resolve({ data: fakeEditLogRows[0], error: null });
      },
      then: (resolve) => {
        if (mode === 'insert' && insertRow) {
          const withId = { id: insertRow.id || ('fake-editlog-' + (++fakeEditLogCounter)), edited_at: insertRow.edited_at || new Date().toISOString(), ...insertRow };
          fakeEditLogRows.push(withId);
          insertRow = null;
          return resolve({ data: [withId], error: null });
        }
        let rows = fakeEditLogRows;
        if (eqFilters.entity_type !== undefined) rows = rows.filter(r => r.entity_type === eqFilters.entity_type);
        if (eqFilters.entity_id !== undefined) rows = rows.filter(r => r.entity_id === eqFilters.entity_id);
        return resolve({ data: rows, error: null });
      },
    };
    return q;
  }
  let fakeNoteRows = [];
  let fakeNoteCounter = 0;
  // Unlike fakeOutletsQuery()/fakeExpensesQuery(), update() here actually mutates the
  // stored row (notes are edited in place via saveNote()'s edit path).
  function fakeNotesQuery() {
    let mode = 'select', eqFilters = {}, payload = null;
    const q = {
      select: () => q,
      eq: (col, val) => { eqFilters[col] = val; return q; },
      in: () => q, order: () => q,
      update: (row) => { mode = 'update'; payload = row; return q; },
      insert: (row) => { mode = 'insert'; payload = row; return q; },
      delete: () => { mode = 'delete'; return q; },
      single: () => {
        if (mode === 'insert') {
          const withId = { id: payload.id || ('fake-note-' + (++fakeNoteCounter)), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...payload };
          fakeNoteRows.push(withId);
          return Promise.resolve({ data: withId, error: null });
        }
        if (mode === 'update') {
          const idx = fakeNoteRows.findIndex(r => String(r.id) === String(eqFilters.id));
          if (idx >= 0) { fakeNoteRows[idx] = { ...fakeNoteRows[idx], ...payload }; return Promise.resolve({ data: fakeNoteRows[idx], error: null }); }
          return Promise.resolve({ data: null, error: { message: 'not found' } });
        }
        return Promise.resolve({ data: fakeNoteRows[0], error: null });
      },
      then: (resolve) => {
        if (mode === 'delete') {
          if (eqFilters.id !== undefined) fakeNoteRows = fakeNoteRows.filter(r => String(r.id) !== String(eqFilters.id));
          else fakeNoteRows = [];
          return resolve({ data: null, error: null });
        }
        return resolve({ data: fakeNoteRows, error: null });
      },
    };
    return q;
  }
  sb.from = (table) => {
    if (table === 'transactions') return fakeTransactionsQuery();
    if (table === 'subscription_usage') return fakeUsageQuery();
    if (table === 'settings') return fakeSettingsQuery();
    if (table === 'app_branding') return fakeAppBrandingQuery();
    if (table === 'expenses') return fakeExpensesQuery();
    if (table === 'expense_catalog') return fakeExpenseCatalogQuery();
    if (table === 'outlets') return fakeOutletsQuery();
    if (table === 'edit_log') return fakeEditLogQuery();
    if (table === 'notes') return fakeNotesQuery();
    return fakeQuery([]);
  };
  shopOwnerId = 'test-owner';
  settings = { shopName: 'Laundry Test' };
  serviceCatalog = [{ id: 'svc1', nama: 'Cuci Reguler', type: 'reguler', satuan: 'kg', harga: 7000 }];

  const tempoSub = {
    id: 'sub-tempo-1', nama: 'Budi Tempo', hp: '081234567890', paketNama: 'Tempo (Bayar Nanti)',
    hargaPaket: 0, hargaLebihKg: 0, kuotaKg: 0, tanggalMulai: '2026-08-01', tanggalSelesai: '2026-08-01',
    status: 'aktif', statusBayar: 'belum', dp: 0, lunasAt: null, transactionId: null, terpakai: 0,
    tempoTotal: 21000, tempoCount: 2
  };
  const bulananSub = {
    id: 'sub-bulanan-1', nama: 'Sari Bulanan', hp: '081298765432', paketNama: 'Paket 50kg',
    hargaPaket: 150000, hargaLebihKg: 8000, kuotaKg: 50, tanggalMulai: '2026-08-01', tanggalSelesai: '2026-09-01',
    status: 'aktif', statusBayar: 'belum', dp: 0, lunasAt: null, transactionId: null, terpakai: 10
  };
  subscriptions = [tempoSub, bulananSub];
  currentSubscriptionId = 'sub-tempo-1';
  currentUsageList = [
    { id:'u1', tanggal:'2026-08-10', berat:0, catatan:'', type:'layanan_tambahan', layananNama:'Cuci Reguler', qty:1, satuan:'kg', harga:7000, subtotal:7000 },
    { id:'u2', tanggal:'2026-08-15', berat:0, catatan:'', type:'layanan_tambahan', layananNama:'Cuci Reguler', qty:2, satuan:'kg', harga:7000, subtotal:14000 },
  ];
  fakeUsageRows = currentUsageList.map(toDbRow);
  transactions = [];

  await step('isTempo() detects tempo vs bulanan', () => {
    if (!isTempo(tempoSub)) throw new Error('expected tempoSub to be tempo');
    if (isTempo(bulananSub)) throw new Error('expected bulananSub to NOT be tempo');
  });

  await step('renderSubscriptions() renders both card types', () => {
    switchTab('paket');
    // Filter status default "aktif" membandingkan tanggalSelesai bulananSub ('2026-09-01')
    // dengan todayISO() (jam sistem ASLI, bukan tanggal dunia fixture ini) -- begitu waktu
    // nyata lewat awal September, kartu Bulanan "kedaluwarsa" dan hilang meski markup-nya
    // sendiri benar. Set eksplisit ke "semua" supaya test ini murni menguji markup kartu,
    // bukan ikut terseret filter periode aktif (yang bukan fokus test ini).
    const filterStatusEl = document.getElementById('subsFilterStatus');
    if (filterStatusEl) filterStatusEl.value = 'semua';
    renderSubscriptions();
    const html = document.getElementById('subscriptionList').innerHTML;
    if (!html.includes('Budi Tempo') || !html.includes('Tempo — Bayar Nanti')) throw new Error('tempo card missing');
    if (!html.includes('Sari Bulanan') || !html.includes('Paket 50kg')) throw new Error('bulanan card missing');
    if (filterStatusEl) filterStatusEl.value = 'aktif';
  });

  await step('subsFilterTipe=tempo filters list to tempo only', () => {
    document.getElementById('subsFilterTipe').value = 'tempo';
    renderSubscriptions();
    const html = document.getElementById('subscriptionList').innerHTML;
    if (html.includes('Sari Bulanan')) throw new Error('bulanan leaked into tempo filter');
    if (!html.includes('Budi Tempo')) throw new Error('tempo missing from tempo filter');
    document.getElementById('subsFilterTipe').value = 'semua';
  });

  await step('openNewSubscription() + onSubsTipeChange() toggles fields', () => {
    openNewSubscription();
    document.getElementById('subsTipe').value = 'tempo';
    onSubsTipeChange();
    if (document.getElementById('subsPaketField').style.display !== 'none') throw new Error('paket field should hide for tempo');
    if (document.getElementById('subsKuotaField').style.display !== 'none') throw new Error('kuota field should hide for tempo');
    document.getElementById('subsTipe').value = 'bulanan';
    onSubsTipeChange();
    if (document.getElementById('subsPaketField').style.display === 'none') throw new Error('paket field should show for bulanan');
    closeNewSubscription();
  });

  await step('refreshSubsDetail() computes tempo totals without kuota/hargaPaket UI', async () => {
    await openSubsDetail('sub-tempo-1');
    if (document.getElementById('subsKuotaCard').style.display !== 'none') throw new Error('kuota card should be hidden for tempo');
    if (document.getElementById('subsTempoCard').style.display !== 'block') throw new Error('tempo card should show');
    const totalTagihanText = document.getElementById('sumTotal').textContent;
    if (!totalTagihanText.includes('21.000') && !totalTagihanText.includes('21,000')) throw new Error('expected total 21000, got ' + totalTagihanText);
    closeSubsDetail();
  });

  await step('subsInvoiceTextWA() produces tempo-flavored recap text', () => {
    currentSubscriptionId = 'sub-tempo-1';
    tempoSub._calc = { excessKg:0, excessCost:0, excessRate:0, extraTotal:21000, totalTagihan:21000, sisaBayar:21000, lunasNow:false };
    const txt = subsInvoiceTextWA(tempoSub);
    if (!txt.includes('Tempo (Bayar Nanti)')) throw new Error('missing tempo label in invoice text');
    if (!txt.includes('Rekap Riwayat Transaksi')) throw new Error('missing recap section');
    if (txt.includes('Kuota')) throw new Error('should not mention kuota for tempo invoice');
  });

  await step('usageNotaTextWA() for a tempo visit uses tempo branch', () => {
    const usage = currentUsageList[1];
    const txt = usageNotaTextWA(usage, tempoSub);
    if (!txt.includes('CATATAN TRANSAKSI - TEMPO')) throw new Error('expected tempo nota header, got: ' + txt.slice(0,80));
    if (!txt.includes('Rekap Riwayat Transaksi')) throw new Error('missing recap in per-visit nota');
  });

  await step('subsInvoiceTextWA() includes bold "Timbangan Sekarang" for latest tempo entry', () => {
    currentSubscriptionId = 'sub-tempo-1';
    tempoSub._calc = { excessKg:0, excessCost:0, excessRate:0, extraTotal:21000, totalTagihan:21000, sisaBayar:21000, lunasNow:false };
    const txt = subsInvoiceTextWA(tempoSub);
    if (!txt.includes('*Timbangan Sekarang*')) throw new Error('missing Timbangan Sekarang header: ' + txt);
    if (!/\*[^*\n]*14[.,]000[^*\n]*\*/.test(txt)) throw new Error('latest entry line not bold with cost detail: ' + txt);
  });

  await step('buildSubsInvoicePDFLines() includes bold+bigger "TIMBANGAN SEKARANG" line for tempo', () => {
    const L = buildSubsInvoicePDFLines(tempoSub);
    const idx = L.findIndex(l => l.t === 'TIMBANGAN SEKARANG');
    if (idx === -1) throw new Error('TIMBANGAN SEKARANG header not found');
    const detailLine = L[idx+1];
    if (!detailLine.b || detailLine.s <= 9) throw new Error('detail line not bold/bigger: ' + JSON.stringify(detailLine));
    if (!detailLine.t.includes('14.000') && !detailLine.t.includes('14,000')) throw new Error('detail line missing cost breakdown: ' + detailLine.t);
  });

  await step('tempoUsageNotaTextWA "Timbangan Sekarang" line is bold with cost detail', () => {
    const usage = currentUsageList[1];
    const txt = usageNotaTextWA(usage, tempoSub);
    if (!txt.includes('*Timbangan Sekarang*')) throw new Error('missing bold header');
    if (!/\*15 Agu 2026.*14[.,]000\*/.test(txt) && !/\*[^*\n]*14[.,]000[^*\n]*\*/.test(txt)) throw new Error('detail line not bold with cost: ' + txt);
  });

  await step('buildTempoUsageNotaPDFLines "TIMBANGAN SEKARANG" is bold+bigger with cost detail', () => {
    const usage = currentUsageList[1];
    const L = buildUsageNotaPDFLines(usage, tempoSub);
    const idx = L.findIndex(l => l.t === 'TIMBANGAN SEKARANG');
    if (idx === -1) throw new Error('TIMBANGAN SEKARANG header not found');
    const detailLine = L[idx+1];
    if (!detailLine.b || detailLine.s <= 9) throw new Error('detail line not bold/bigger: ' + JSON.stringify(detailLine));
  });

  // --- Tempo: layanan bisa diketik manual + tombol "Tambah Layanan" bertahap (draft) sebelum jadi satu nota ---
  await step('showExtraLayananSuggest()/selectExtraLayananSuggest() autocomplete fills nama/harga/satuan from catalog', () => {
    document.getElementById('extraLayanan').value = 'Cuci';
    showExtraLayananSuggest();
    const box = document.getElementById('extraLayananSuggestBox');
    if (!box.classList.contains('show') || !box.innerHTML.includes('Cuci Reguler')) throw new Error('catalog suggest box did not show match');
    selectExtraLayananSuggest('svc1');
    if (document.getElementById('extraLayanan').value !== 'Cuci Reguler') throw new Error('selecting suggestion should fill nama');
    if (document.getElementById('extraHarga').value != 7000) throw new Error('selecting suggestion should fill harga');
    if (document.getElementById('extraSatuan').value !== 'kg') throw new Error('selecting suggestion should fill satuan');
  });

  await step('addExtraService() for Tempo: manual (non-catalog) layanan name is accepted and staged as a draft, NOT saved immediately', async () => {
    currentSubscriptionId = 'sub-tempo-1';
    draftExtraItems = [];
    renderExtraDraftList();
    const rowsBefore = fakeUsageRows.length;
    document.getElementById('extraTanggal').value = '2026-08-20';
    document.getElementById('extraLayanan').value = 'Setrika Saja'; // sengaja bukan nama dari katalog
    document.getElementById('extraQty').value = '3';
    document.getElementById('extraSatuan').value = 'pcs';
    document.getElementById('extraHarga').value = '5000';
    await addExtraService();
    if (fakeUsageRows.length !== rowsBefore) throw new Error('Tempo should NOT insert to DB immediately, only stage a draft');
    if (draftExtraItems.length !== 1) throw new Error('expected 1 draft item, got ' + draftExtraItems.length);
    const it = draftExtraItems[0];
    if (it.nama !== 'Setrika Saja' || it.qty !== 3 || it.satuan !== 'pcs' || it.harga !== 5000 || it.subtotal !== 15000) throw new Error('draft item mismatch: ' + JSON.stringify(it));
    if (document.getElementById('extraLayanan').value !== '') throw new Error('nama field should reset after staging');
    if (document.getElementById('extraDraftListWrap').style.display === 'none') throw new Error('draft list wrap should become visible once an item is staged');
    if (!document.getElementById('extraDraftList').innerHTML.includes('Setrika Saja')) throw new Error('draft list should render the staged item');
  });

  await step('addExtraService() can be called again to add multiple layanan into the same draft (like items in Transaksi Baru); removeExtraDraftItem() removes one', async () => {
    document.getElementById('extraLayanan').value = 'Cuci Reguler';
    document.getElementById('extraQty').value = '2';
    document.getElementById('extraSatuan').value = 'kg';
    document.getElementById('extraHarga').value = '7000';
    await addExtraService();
    if (draftExtraItems.length !== 2) throw new Error('expected 2 draft items after adding again, got ' + draftExtraItems.length);
    removeExtraDraftItem(0);
    if (draftExtraItems.length !== 1 || draftExtraItems[0].nama !== 'Cuci Reguler') throw new Error('removeExtraDraftItem should remove the first item, leaving the second: ' + JSON.stringify(draftExtraItems));
  });

  await step('submitExtraServiceBatch() inserts all draft items at once, clears the draft, and opens ONE combined batch nota', async () => {
    draftExtraItems = [
      { tanggal:'2026-08-25', nama:'Cuci Kilat', qty:1, satuan:'kg', harga:12000, subtotal:12000 },
      { tanggal:'2026-08-25', nama:'Setrika', qty:2, satuan:'pcs', harga:3000, subtotal:6000 },
    ];
    renderExtraDraftList();
    const rowsBefore = fakeUsageRows.length;
    await submitExtraServiceBatch();
    if (fakeUsageRows.length !== rowsBefore + 2) throw new Error('expected 2 new rows inserted, fakeUsageRows now: ' + fakeUsageRows.length);
    if (draftExtraItems.length !== 0) throw new Error('draft should be cleared after batch submit');
    if (document.getElementById('extraDraftListWrap').style.display !== 'none') throw new Error('draft wrap should hide again after batch submit');
    if (!currentBatchUsageIds || currentBatchUsageIds.length !== 2) throw new Error('expected openBatchUsageNotaOptions() to set currentBatchUsageIds to the 2 new rows');
    const modal = document.getElementById('usageNotaModal');
    if (!modal.classList.contains('show')) throw new Error('usageNotaModal should open after batch submit');
    closeUsageNotaOptions();
  });

  await step('tempoBatchUsageNotaTextWA()/buildTempoBatchUsageNotaPDFLines() show every newly-added item bold under "Timbangan Sekarang"', () => {
    const s = subscriptions.find(x=>x.id==='sub-tempo-1');
    const newItems = [
      { id:'batch1', tanggal:'2026-08-25', layananNama:'Cuci Kilat', qty:1, satuan:'kg', harga:12000, subtotal:12000 },
      { id:'batch2', tanggal:'2026-08-25', layananNama:'Setrika', qty:2, satuan:'pcs', harga:3000, subtotal:6000 },
    ];
    currentUsageList = currentUsageList.filter(u => u.id !== 'batch1' && u.id !== 'batch2').concat(newItems);
    const txt = tempoBatchUsageNotaTextWA(newItems, s);
    if (!/\*[^*\n]*Cuci Kilat[^*\n]*12[.,]000[^*\n]*\*/.test(txt)) throw new Error('Cuci Kilat line not bold with amount: ' + txt);
    if (!/\*[^*\n]*Setrika[^*\n]*6[.,]000[^*\n]*\*/.test(txt)) throw new Error('Setrika line not bold with amount: ' + txt);
    const L = buildTempoBatchUsageNotaPDFLines(newItems, s);
    const idx = L.findIndex(l => l.t === 'TIMBANGAN SEKARANG');
    if (idx === -1) throw new Error('TIMBANGAN SEKARANG header not found');
    if (!L[idx+1].t.includes('Cuci Kilat') || !L[idx+1].b) throw new Error('first batch line not bold: ' + JSON.stringify(L[idx+1]));
    if (!L[idx+2].t.includes('Setrika') || !L[idx+2].b) throw new Error('second batch line not bold: ' + JSON.stringify(L[idx+2]));
  });

  await step('addExtraService() for Paket Bulanan still saves immediately (unchanged behavior), and also now accepts a manually-typed layanan name', async () => {
    currentSubscriptionId = 'sub-bulanan-1';
    draftExtraItems = [];
    const rowsBefore = fakeUsageRows.length;
    document.getElementById('extraTanggal').value = '2026-08-12';
    document.getElementById('extraLayanan').value = 'Layanan Manual Bulanan';
    document.getElementById('extraQty').value = '1';
    document.getElementById('extraSatuan').value = 'pcs';
    document.getElementById('extraHarga').value = '10000';
    await addExtraService();
    if (fakeUsageRows.length !== rowsBefore + 1) throw new Error('Bulanan should still insert immediately, one row, got ' + (fakeUsageRows.length - rowsBefore));
    if (draftExtraItems.length !== 0) throw new Error('Bulanan should never use the draft queue');
    currentSubscriptionId = 'sub-tempo-1';
  });

  await step('usageNotaTextWA() for bulanan customer stays on original kg-based branch', () => {
    const kgUsage = { id:'u3', tanggal:'2026-08-05', berat:5, catatan:'', type:'pemakaian', layananNama:'', qty:0, satuan:'', harga:0, subtotal:0 };
    const savedList = currentUsageList;
    currentUsageList = [kgUsage];
    const txt = usageNotaTextWA(kgUsage, bulananSub);
    currentUsageList = savedList;
    if (!txt.includes('CATATAN TRANSAKSI') || txt.includes('TEMPO')) throw new Error('bulanan nota text regressed: ' + txt.slice(0,80));
  });

  // --- Bug nyata dilaporkan user: Paket Bulanan punya 2 macam layanan (kg bulanan
  // + layanan tambahan). Cetak nota dari salah satu jenis harus tetap merangkum
  // riwayat jenis lainnya (sampai tanggal nota), bukan cuma jenisnya sendiri, dan
  // TIDAK boleh jatuh ke builder khusus Tempo (yang sama sekali tidak menyebut kg). ---
  await step('usageNotaTextWA()/buildUsageNotaPDFLines() untuk baris layanan_tambahan Paket Bulanan tetap merangkum riwayat kg (bug lintas-jenis)', () => {
    const savedList = currentUsageList;
    const kgUsage = { id:'kgu1', tanggal:'2026-09-03', berat:8, catatan:'', type:'pemakaian', layananNama:'', qty:0, satuan:'', harga:0, subtotal:0 };
    const extraUsage = { id:'exu1', tanggal:'2026-09-05', berat:0, catatan:'', type:'layanan_tambahan', layananNama:'Cuci Sepatu', qty:1, satuan:'pasang', harga:25000, subtotal:25000 };
    currentUsageList = [kgUsage, extraUsage];

    // Nota dicetak dari baris layanan tambahan (5 Sept) -- harus tetap kelihatan
    // timbangan kg bulanan (3 Sept) yang lebih tua, bukan hanya layanan tambahan itu sendiri.
    const txt = usageNotaTextWA(extraUsage, bulananSub);
    if (txt.includes('TEMPO')) throw new Error('nota Paket Bulanan tidak boleh jatuh ke builder Tempo: ' + txt.slice(0,120));
    if (!txt.includes('Cuci Sepatu')) throw new Error('baris "Timbangan Sekarang" (layanan tambahan) hilang: ' + txt);
    if (!txt.includes('8 kg')) throw new Error('riwayat kg bulanan (3 Sept) yang lebih tua tidak ikut masuk nota layanan tambahan: ' + txt);

    const L = buildUsageNotaPDFLines(extraUsage, bulananSub);
    const idx = L.findIndex(l => l.t === 'TIMBANGAN SEKARANG');
    if (idx === -1) throw new Error('header TIMBANGAN SEKARANG hilang di versi PDF');
    if (!L[idx+1].t.includes('Cuci Sepatu')) throw new Error('baris detail layanan tambahan hilang di versi PDF: ' + L[idx+1].t);
    if (!L.some(l => l.t.includes('8 kg'))) throw new Error('riwayat kg bulanan tidak ikut masuk versi PDF');

    // Sebaliknya: nota dari baris kg (3 Sept) TIDAK ikut layanan tambahan yang lebih baru (5 Sept) --
    // ini bukan bug, memang disengaja (cetak ulang nota lama tidak boleh ikut transaksi sesudahnya).
    const txtOld = usageNotaTextWA(kgUsage, bulananSub);
    if (txtOld.includes('Cuci Sepatu')) throw new Error('nota tanggal lama seharusnya TIDAK ikut layanan tambahan yang lebih baru');

    currentUsageList = savedList;
  });

  // --- Overpayment ("kelebihan bayar") scenario: DP 100rb, tagihan berjalan 33rb ---
  await step('refreshSubsDetail() computes lebihBayar=67rb when DP > total (100rb vs 33rb bill)', async () => {
    tempoSub.dp = 100000;
    currentSubscriptionId = 'sub-tempo-1';
    fakeUsageRows = [
      { id:'v1', tanggal:'2026-08-20', berat:0, catatan:'', type:'layanan_tambahan', layananNama:'Cuci Reguler', qty:1, satuan:'kg', harga:33000, subtotal:33000 },
    ].map(toDbRow);
    await openSubsDetail('sub-tempo-1');
    if (tempoSub._calc.lebihBayar !== 67000) throw new Error('expected lebihBayar 67000, got ' + tempoSub._calc.lebihBayar);
    if (tempoSub._calc.sisaBayar !== 0) throw new Error('expected sisaBayar 0, got ' + tempoSub._calc.sisaBayar);
    if (document.getElementById('sumLebihBayarRow').style.display !== 'flex') throw new Error('sumLebihBayarRow should be visible');
    const shown = document.getElementById('sumLebihBayar').textContent;
    if (!shown.includes('67.000') && !shown.includes('67,000')) throw new Error('sumLebihBayar wrong text: ' + shown);
    closeSubsDetail();
  });

  await step('subsInvoiceTextWA()/PDF show "Kelebihan Bayar" line with correct wording (not kembalian)', () => {
    const txt = subsInvoiceTextWA(tempoSub);
    if (!/Kelebihan Bayar : Rp67[.,]000 \(saldo untuk laundry berikutnya, bukan kembalian\)/.test(txt)) {
      throw new Error('missing/incorrect Kelebihan Bayar line in WA text: ' + txt);
    }
    const L = buildSubsInvoicePDFLines(tempoSub);
    const found = L.find(l => l.t && l.t.startsWith('Kelebihan Bayar'));
    if (!found) throw new Error('missing Kelebihan Bayar line in PDF lines');
    if (!found.t.includes('67.000') && !found.t.includes('67,000')) throw new Error('PDF Kelebihan Bayar wrong amount: ' + found.t);
  });

  await step('tempoUsageNotaTextWA()/PDF show "Kelebihan Bayar" line for a visit', () => {
    const usage = currentUsageList[0];
    const txt = usageNotaTextWA(usage, tempoSub);
    if (!txt.includes('Kelebihan Bayar : Rp67.000') && !txt.includes('Kelebihan Bayar : Rp67,000')) {
      throw new Error('missing Kelebihan Bayar in per-visit WA nota: ' + txt);
    }
    const L = buildUsageNotaPDFLines(usage, tempoSub);
    const found = L.find(l => l.t && l.t.includes('Kelebihan Bayar'));
    if (!found) throw new Error('missing Kelebihan Bayar in per-visit PDF nota');
  });

  await step('markSubsLunas() carries the 67rb overpayment forward as next-cycle DP', async () => {
    const originalConfirm = window.confirm;
    window.confirm = () => true;
    currentSubscriptionId = 'sub-tempo-1';
    await openSubsDetail('sub-tempo-1');
    await markSubsLunas();
    window.confirm = originalConfirm;
    if (tempoSub.dp !== 67000) throw new Error('expected carried-over dp 67000, got ' + tempoSub.dp);
    if (currentUsageList.length !== 0) throw new Error('expected usage list cleared after settlement');
    const lastTx = transactions[transactions.length - 1];
    if (!lastTx || lastTx.total !== 33000 || lastTx.dp !== 33000) {
      throw new Error('expected settlement transaction of exactly the 33000 bill, got ' + JSON.stringify(lastTx));
    }
    closeSubsDetail();
  });

  // --- Regression: regular (non-Tempo) walk-in transaction, DP > total while status=Lunas ---
  // Reproduces the reported bug: DP Rp100.000 typed in, bill only Rp13.000, status set to
  // Lunas -> the app used to silently overwrite dp with `total`, discarding the 100.000.
  await step('submitTransaction() preserves DP > total for a regular Lunas transaction', async () => {
    editingTransactionId = null;
    draftItems = [{ nama:'cuci lipat super ekspress', qty:1, satuan:'kg', harga:13000, subtotal:13000 }];
    document.getElementById('inNama').value = 'Pak Manto';
    document.getElementById('inHP').value = '';
    document.getElementById('inTanggal').value = '2026-08-27';
    document.getElementById('inEstimasi').value = '';
    document.getElementById('inDiskon').value = '0';
    document.getElementById('inDP').value = '100000';
    document.getElementById('inStatus').value = 'lunas';
    document.getElementById('inCatatan').value = '';
    await submitTransaction();
    const trx = transactions[transactions.length - 1];
    if (!trx || trx.nama !== 'Pak Manto') throw new Error('expected the new transaction to be pushed, got ' + JSON.stringify(trx));
    if (trx.total !== 13000) throw new Error('expected total 13000, got ' + trx.total);
    if (trx.dp !== 100000) throw new Error('BUG REPRODUCED: expected dp preserved at 100000, got ' + trx.dp);
    if (trx.status !== 'lunas') throw new Error('expected status lunas, got ' + trx.status);
    if (trx.workStatus !== 'belum') throw new Error('expected new transaction to default workStatus to "belum" for Papan Kerja, got ' + trx.workStatus);

    const kelebihan = 'Rp87.000';
    const html = buildReceiptHTML(trx);
    if (!html.includes('Kelebihan Bayar') || !html.includes(kelebihan)) throw new Error('receipt HTML missing Kelebihan Bayar 87000: ' + html);
    const wa = receiptTextForWA(trx);
    if (!wa.includes('Kelebihan Bayar') || !wa.includes(kelebihan)) throw new Error('receipt WA text missing Kelebihan Bayar 87000: ' + wa);
    const pdf = buildReceiptPDFLines(trx);
    const pdfLine = pdf.find(l => l.t && l.t.includes('Kelebihan Bayar'));
    if (!pdfLine || !pdfLine.t.includes(kelebihan)) throw new Error('receipt PDF lines missing Kelebihan Bayar 87000: ' + JSON.stringify(pdf));
  });

  // --- Regression: reported live -- opening Edit on an ordinary Lunas transaction (paid in full
  // in cash, cashier never typed a DP) showed the DP field pre-filled with the full total, because
  // submitTransaction() used to force dp=Math.max(dp,total) into the STORED row whenever status was
  // Lunas. DP must only ever hold a genuine advance payment; the cash-basis math for Lunas totals
  // is now computed on read (trxCashReceived()), not baked into the stored dp. ---
  await step('submitTransaction() does NOT force dp to equal total for a plain Lunas transaction -- dp stays 0 unless the cashier actually typed one', async () => {
    const savedEditingId = editingTransactionId;
    try {
      editingTransactionId = null;
      draftItems = [{ nama:'cuci kilat', qty:1, satuan:'kg', harga:19740, subtotal:19740 }];
      document.getElementById('inNama').value = 'Udin';
      document.getElementById('inHP').value = '';
      document.getElementById('inTanggal').value = '2026-09-21';
      document.getElementById('inEstimasi').value = '';
      document.getElementById('inDiskon').value = '0';
      document.getElementById('inDP').value = '0'; // kasir tidak pernah isi DP, pelanggan cuma bayar tunai penuh
      document.getElementById('inStatus').value = 'lunas';
      document.getElementById('inCatatan').value = '';
      await submitTransaction();
      const trx = transactions[transactions.length - 1];
      if (!trx || trx.nama !== 'Udin') throw new Error('expected the new transaction to be pushed, got ' + JSON.stringify(trx));
      if (trx.dp !== 0) throw new Error('BUG: dp should stay 0 (no forced Math.max(dp,total)) for a plain Lunas transaction, got dp=' + trx.dp);
      if (trxCashReceived(trx) !== 19740) throw new Error('trxCashReceived() should still count the full total as cash received for Lunas even with dp=0, got ' + trxCashReceived(trx));

      // Buka Edit lagi -- field DP harus menunjukkan nilai asli tersimpan (0), bukan total.
      // (editTransaction() sendiri mengubah editingTransactionId -- makanya dibungkus try/finally
      // di sini, supaya test-test sesudahnya yang bikin transaksi baru tidak keliru masuk ke jalur
      // edit gara-gara editingTransactionId keburu ke-set ke id transaksi tes ini.)
      editTransaction(trx.id);
      if (document.getElementById('inDP').value != 0) throw new Error('BUG: form Edit seharusnya menampilkan dp=0 (nilai asli tersimpan), got ' + document.getElementById('inDP').value);
    } finally {
      editingTransactionId = savedEditingId;
    }
  });

  await step('toggleLunas() (tombol "Lunasi" di Riwayat) mengubah status ke Lunas TANPA memaksa dp jadi sama dengan total', async () => {
    const savedTransactions = transactions;
    transactions = transactions.slice();
    try {
      const trx = { id:'tl1', kode:'LND-TL1', nama:'Slamet', hp:'', tanggal:'2026-09-20', estimasi:null,
        items:[{ nama:'Cuci', qty:1, satuan:'kg', harga:12000, subtotal:12000 }], diskon:0, total:12000, dp:0, status:'belum', catatan:'' };
      transactions.push(trx);
      const originalFrom = sb.from;
      sb.from = (table) => {
        if (table !== 'transactions') return originalFrom(table);
        const q = { select: () => q, update: () => q, eq: () => Promise.resolve({ error: null }) };
        return q;
      };
      try {
        await toggleLunas(trx.id);
      } finally {
        sb.from = originalFrom;
      }
      if (trx.status !== 'lunas') throw new Error('expected status lunas after toggleLunas(), got ' + trx.status);
      if (trx.dp !== 0) throw new Error('BUG: toggleLunas() should not force dp to equal total, got dp=' + trx.dp);
      if (trxCashReceived(trx) !== 12000) throw new Error('trxCashReceived() should still count the full total as cash received for Lunas, got ' + trxCashReceived(trx));
    } finally {
      transactions = savedTransactions;
    }
  });

  // --- Regression: reported live on the deploy preview -- an OLD transaction saved before this
  // fix (dp was force-written = total in the database back then, e.g. real nota "udin"/LND-0134)
  // still shows that stale dp when opened in Edit, looking exactly like the bug that was supposedly
  // fixed. editTransaction() must blank it back to 0 for display (a genuine dp>total overpayment
  // must still show through, though) -- and since submitTransaction() no longer force-writes dp,
  // simply re-saving that Edit (even for an unrelated field) now heals the old record for good. ---
  await step('editTransaction(): transaksi Lunas LAMA yang dp-nya masih tersimpan = total (dari sebelum perbaikan ini) ditampilkan sebagai DP=0 di form Edit, tapi kelebihan bayar sungguhan (dp>total) tetap ditampilkan apa adanya', () => {
    const savedEditingId = editingTransactionId;
    const savedDraftItems = draftItems;
    try {
      const legacyLunas = { id:'legacy-1', kode:'LND-0134', nama:'udin', hp:'', tanggal:'2026-09-21', estimasi:null,
        items:[{ nama:'cuci lipat reguler', qty:2.82, satuan:'kg', harga:7000, subtotal:19740 }], diskon:0, total:19740, dp:19740, status:'lunas', catatan:'' };
      transactions.push(legacyLunas);
      editTransaction(legacyLunas.id);
      if (document.getElementById('inDP').value != 0) throw new Error('BUG: transaksi Lunas lama dengan dp lama = total seharusnya ditampilkan sebagai DP=0 di Edit, got ' + document.getElementById('inDP').value);
      transactions.pop();

      const legacyOverpaid = { id:'legacy-2', kode:'LND-0200', nama:'Overpaid', hp:'', tanggal:'2026-09-21', estimasi:null,
        items:[{ nama:'Cuci', qty:1, satuan:'kg', harga:10000, subtotal:10000 }], diskon:0, total:10000, dp:15000, status:'lunas', catatan:'' };
      transactions.push(legacyOverpaid);
      editTransaction(legacyOverpaid.id);
      if (document.getElementById('inDP').value != 15000) throw new Error('kelebihan bayar sungguhan (dp 15000 > total 10000) tidak boleh ikut dinolkan di Edit, got ' + document.getElementById('inDP').value);
      transactions.pop();
    } finally {
      editingTransactionId = savedEditingId;
      draftItems = savedDraftItems;
    }
  });

  // --- Regression: DP fully covers the total but status dropdown was left on "Belum Lunas" ---
  // Reproduces the confusing case reported live: kasir types a DP equal to (or more than) the
  // bill but forgets to switch the status dropdown to Lunas -- Rekap/Laporan (cash-basis, using
  // dp) then look "fully paid" while the per-transaction badge still says "Belum Lunas",
  // which read as a bug even though both numbers were individually correct. Fix: auto-promote
  // status to lunas whenever the typed DP already covers the total.
  await step('submitTransaction() auto-promotes status to Lunas when a "Belum Lunas" DP already covers the total', async () => {
    const savedTransactions = transactions;
    const savedDraftItems = draftItems;
    const savedEditingId = editingTransactionId;
    transactions = transactions.slice(); // isolate pushes from the rest of the suite
    try {
      editingTransactionId = null;
      draftItems = [{ nama:'cuci setrika hemat', qty:11.06, satuan:'kg', harga:8000, subtotal:88480 }];
      document.getElementById('inNama').value = 'Abid';
      document.getElementById('inHP').value = ''; // kosong -> hindari jalur saveContactIfNew().upsert() yang tidak didukung mock generik, tidak relevan buat test ini
      document.getElementById('inTanggal').value = '2026-09-17';
      document.getElementById('inEstimasi').value = '';
      document.getElementById('inDiskon').value = '0';
      document.getElementById('inDP').value = '88480'; // pas dengan total, status masih dipilih "belum"
      document.getElementById('inStatus').value = 'belum';
      document.getElementById('inCatatan').value = '';
      await submitTransaction();
      const trx = transactions[transactions.length - 1];
      if (!trx || trx.nama !== 'Abid') throw new Error('expected the new transaction to be pushed, got ' + JSON.stringify(trx));
      if (trx.status !== 'lunas') throw new Error('BUG: DP (88480) already covers total (88480) with status left on "belum" -- should auto-promote to lunas, got status=' + trx.status);
      if (trx.dp !== 88480) throw new Error('expected dp preserved at 88480, got ' + trx.dp);

      // Editing an EXISTING "belum" transaction whose dp already covers the total (without
      // touching the status dropdown) must also auto-promote -- this is how a shop owner fixes
      // old records affected by the bug above, just by opening Edit and saving again.
      // (fakeTransactionsQuery()'s generic .update() doesn't echo a row back, unlike .insert(),
      // so this update path needs its own small stub -- same pattern as other tests that
      // exercise submitTransaction()'s edit branch against a real Supabase response shape.)
      trx.status = 'belum'; // simulate an old record still stuck on "belum" despite full dp
      editTransaction(trx.id);
      if (document.getElementById('inStatus').value !== 'belum') throw new Error('sanity check failed: editTransaction() should reload the stale "belum" status for this test to be meaningful');
      const originalFrom = sb.from;
      sb.from = (table) => {
        if (table !== 'transactions') return originalFrom(table);
        const q = {
          select: () => q, eq: () => q, in: () => q, order: () => q, insert: () => q, delete: () => q,
          update: (row) => { q._updated = { ...trx, ...row }; return q; },
          single: () => Promise.resolve({ data: q._updated, error: null }),
        };
        return q;
      };
      try {
        await submitTransaction();
      } finally {
        sb.from = originalFrom;
      }
      const edited = transactions.find(x => x.id === trx.id);
      if (edited.status !== 'lunas') throw new Error('BUG: re-saving an existing transaction whose dp already covers the total should auto-promote to lunas too, got status=' + edited.status);

      // Sanity check the negative case: a genuine partial DP must NOT be auto-promoted.
      editingTransactionId = null;
      draftItems = [{ nama:'cuci reguler', qty:1, satuan:'kg', harga:20000, subtotal:20000 }];
      document.getElementById('inNama').value = 'Abid';
      document.getElementById('inHP').value = '';
      document.getElementById('inTanggal').value = '2026-09-19';
      document.getElementById('inDiskon').value = '0';
      document.getElementById('inDP').value = '5000'; // jauh dari total 20000
      document.getElementById('inStatus').value = 'belum';
      document.getElementById('inCatatan').value = '';
      await submitTransaction();
      const partial = transactions[transactions.length - 1];
      if (partial.status !== 'belum') throw new Error('a genuine partial DP (5000 of 20000) must stay "belum", got status=' + partial.status);
      if (partial.dp !== 5000) throw new Error('expected dp preserved at 5000, got ' + partial.dp);
    } finally {
      transactions = savedTransactions;
      draftItems = savedDraftItems;
      editingTransactionId = savedEditingId;
    }
  });

  // --- Sequential numbering (01, 02, ...) oldest -> newest, separate for timbangan vs layanan tambahan ---
  await step('padNo() zero-pads to at least 2 digits', () => {
    if (padNo(1) !== '01') throw new Error('padNo(1) expected 01, got ' + padNo(1));
    if (padNo(11) !== '11') throw new Error('padNo(11) expected 11, got ' + padNo(11));
  });

  await step('renderUsageList() splits Paket Bulanan into two separate blocks (Timbangan Paket, then a thick divider, then Layanan Tambahan), each numbered independently oldest-first', async () => {
    currentSubscriptionId = 'sub-bulanan-1';
    // Deliberately out of chronological order and interleaved, like a real DB fetch.
    fakeUsageRows = [
      { id:'b-p2', tanggal:'2026-08-05', berat:5, catatan:'', type:'pemakaian', layananNama:'', qty:0, satuan:'', harga:0, subtotal:0 },
      { id:'b-e2', tanggal:'2026-08-06', berat:0, catatan:'', type:'layanan_tambahan', layananNama:'Sprei', qty:1, satuan:'set', harga:15000, subtotal:15000 },
      { id:'b-p1', tanggal:'2026-08-02', berat:3, catatan:'', type:'pemakaian', layananNama:'', qty:0, satuan:'', harga:0, subtotal:0 },
      { id:'b-e1', tanggal:'2026-08-03', berat:0, catatan:'', type:'layanan_tambahan', layananNama:'Handuk', qty:2, satuan:'pcs', harga:5000, subtotal:10000 },
    ].map(toDbRow);
    await openSubsDetail('sub-bulanan-1');
    const el = document.getElementById('usageList');
    const html = el.innerHTML;
    // The number ("01.") now lives in its own flex child (for a proper hanging indent
    // when the rest of the line wraps), so it's no longer contiguous with the date in
    // raw innerHTML — compare against normalized textContent instead.
    const text = el.textContent.replace(/\s+/g,' ').trim();
    const posLabelPaket = text.indexOf('Timbangan Paket');
    const posP1 = text.indexOf('01. 02 Agu 2026 — Laundry masuk'); // oldest pemakaian
    const posP2 = text.indexOf('02. 05 Agu 2026 — Laundry masuk'); // newest pemakaian
    const posLabelExtra = text.indexOf('Layanan Tambahan');
    const posE1 = text.indexOf('01. 03 Agu 2026 — Handuk'); // oldest extra
    const posE2 = text.indexOf('02. 06 Agu 2026 — Sprei'); // newest extra
    const positions = { posLabelPaket, posP1, posP2, posLabelExtra, posE1, posE2 };
    if (Object.values(positions).some(p => p === -1)) {
      throw new Error('expected sections/rows not found: ' + JSON.stringify(positions) + '\ntext: ' + text + '\nhtml: ' + html);
    }
    // Hanging-indent structure: number and rest-of-line must be separate flex children.
    if (!/<span style="flex:none;">01\.<\/span>/.test(html)) {
      throw new Error('number not rendered in its own fixed-width span for hanging indent: ' + html);
    }
    // Divider (in raw html, since it's an empty div with no text) must sit between the
    // two section labels (also checked in raw html space, since these ARE contiguous text).
    const posDivider = html.indexOf('border-top:3px solid #000');
    const posLabelPaketHtml = html.indexOf('Timbangan Paket');
    const posLabelExtraHtml = html.indexOf('Layanan Tambahan');
    if (posDivider === -1 || !(posLabelPaketHtml < posDivider && posDivider < posLabelExtraHtml)) {
      throw new Error('divider not positioned between the two section labels: ' + html);
    }
    // Both pemakaian rows (block 1) must come before the divider, which must come before
    // both layanan tambahan rows (block 2) — i.e. no interleaving between the two blocks.
    if (!(posLabelPaket < posP1 && posP1 < posP2 && posP2 < posLabelExtra && posLabelExtra < posE1 && posE1 < posE2)) {
      throw new Error('sections are interleaved instead of separated into two blocks: ' + html);
    }
    closeSubsDetail();
  });

  await step('Bulanan per-visit nota numbers "Riwayat Timbangan" and "Layanan Tambahan" separately', () => {
    currentSubscriptionId = 'sub-bulanan-1';
    currentUsageList = fakeUsageRows.map(r => ({
      id:r.id, tanggal:r.tanggal, berat:Number(r.berat_kg)||0, catatan:r.catatan||'',
      type:r.type||'pemakaian', layananNama:r.layanan_nama||'', qty:Number(r.qty)||0,
      satuan:r.satuan||'', harga:Number(r.harga)||0, subtotal:Number(r.subtotal)||0
    }));
    const latestUsage = currentUsageList.find(u => u.id === 'b-p2'); // 2026-08-05, latest pemakaian
    const txt = usageNotaTextWA(latestUsage, bulananSub);
    if (!/01\. 02 Agu 2026 — 3 kg[\s\S]*02\. 05 Agu 2026 — 5 kg/.test(txt)) {
      throw new Error('Riwayat Timbangan not numbered oldest->newest: ' + txt);
    }
    if (!/01\. 03 Agu 2026 — Handuk/.test(txt)) throw new Error('Layanan Tambahan missing numbered Handuk line: ' + txt);
    const pdf = buildUsageNotaPDFLines(latestUsage, bulananSub);
    const timbanganIdx = pdf.findIndex(l => l.t === 'RIWAYAT TIMBANGAN PAKET INI');
    if (timbanganIdx === -1 || !pdf[timbanganIdx+1].t.startsWith('01. 02 Agu 2026')) {
      throw new Error('PDF Riwayat Timbangan first line not numbered 01: ' + JSON.stringify(pdf));
    }
    // indent:4 = length of "01. " prefix -> wrapCanvasLines hangs continuation lines
    // under the text, not flush left under the number, when a numbered line wraps.
    if (pdf[timbanganIdx+1].indent !== 4) {
      throw new Error('PDF Riwayat Timbangan line missing indent:4 for hanging indent: ' + JSON.stringify(pdf[timbanganIdx+1]));
    }
    const layananIdx = pdf.findIndex(l => l.t === 'LAYANAN TAMBAHAN (di luar paket)');
    if (layananIdx === -1 || pdf[layananIdx+1].indent !== 4) {
      throw new Error('PDF Layanan Tambahan line missing indent:4 for hanging indent: ' + JSON.stringify(pdf[layananIdx+1]));
    }
  });

  await step('Tempo rekap nota (per-visit & tagihan) numbers entries oldest -> newest', () => {
    currentSubscriptionId = 'sub-tempo-1';
    tempoSub.dp = 0;
    currentUsageList = [
      { id:'t1', tanggal:'2026-08-20', berat:0, catatan:'', type:'layanan_tambahan', layananNama:'Cuci Reguler', qty:1, satuan:'kg', harga:33000, subtotal:33000 },
      { id:'t2', tanggal:'2026-08-15', berat:0, catatan:'', type:'layanan_tambahan', layananNama:'Cuci Reguler', qty:1, satuan:'kg', harga:20000, subtotal:20000 },
    ];
    const latestUsage = currentUsageList[0]; // 08-20, chronologically the latest
    const txt = tempoUsageNotaTextWA(latestUsage, tempoSub);
    if (!/01\. 15 Agu 2026[\s\S]*02\. 20 Agu 2026/.test(txt)) {
      throw new Error('Tempo per-visit rekap not numbered 15th=01 then 20th=02: ' + txt);
    }
    tempoSub._calc = { excessKg:0, excessCost:0, excessRate:0, extraTotal:53000, totalTagihan:53000, sisaBayar:53000, lebihBayar:0, lunasNow:false };
    const invoiceTxt = subsInvoiceTextWA(tempoSub);
    if (!/01\. 15 Agu 2026[\s\S]*02\. 20 Agu 2026/.test(invoiceTxt)) {
      throw new Error('Tempo Nota Tagihan rekap not numbered oldest->newest: ' + invoiceTxt);
    }
    // PDF/JPG versions must carry indent:4 on numbered rekap lines too, so a wrapped
    // continuation line hangs under the text instead of flush left under the number.
    const perVisitPdf = buildUsageNotaPDFLines(latestUsage, tempoSub);
    const rekapIdx = perVisitPdf.findIndex(l => l.t === 'REKAP RIWAYAT TRANSAKSI (BELUM DITAGIH)');
    if (rekapIdx === -1 || perVisitPdf[rekapIdx+1].indent !== 4) {
      throw new Error('Tempo per-visit PDF rekap line missing indent:4: ' + JSON.stringify(perVisitPdf[rekapIdx+1]));
    }
    const invoicePdf = buildSubsInvoicePDFLines(tempoSub);
    const invoiceRekapIdx = invoicePdf.findIndex(l => l.t === 'REKAP RIWAYAT TRANSAKSI (BELUM DITAGIH)');
    if (invoiceRekapIdx === -1 || invoicePdf[invoiceRekapIdx+1].indent !== 4) {
      throw new Error('Tempo Nota Tagihan PDF rekap line missing indent:4: ' + JSON.stringify(invoicePdf[invoiceRekapIdx+1]));
    }
  });

  await step('groupExtrasIntoTransactions()/renderUsageList() merge items saved in the same batch (batch_id) into ONE numbered transaction with bullet details, but keep legacy rows without batch_id separate', async () => {
    currentSubscriptionId = 'sub-tempo-1';
    const batchItems = [
      { id:'g1', tanggal:'2026-08-24', berat:0, catatan:'', type:'layanan_tambahan', layananNama:'Cuci setrika super ekspress', qty:5.54, satuan:'kg', harga:15000, subtotal:83100, batchId:'batch-xyz' },
      { id:'g2', tanggal:'2026-08-24', berat:0, catatan:'', type:'layanan_tambahan', layananNama:'handuk', qty:1, satuan:'pcs', harga:5000, subtotal:5000, batchId:'batch-xyz' },
    ];
    const groups = groupExtrasIntoTransactions(batchItems);
    if (groups.length !== 1) throw new Error('expected 1 merged group for 2 items sharing the same batch_id, got ' + groups.length);
    if (groups[0].items.length !== 2) throw new Error('merged group should contain both items: ' + JSON.stringify(groups));
    if (groups[0].total !== 88100) throw new Error('merged group total should be 88100, got ' + groups[0].total);

    currentUsageList = batchItems;
    document.getElementById('subsDetailModal').classList.add('show');
    renderUsageList();
    const html = document.getElementById('usageList').innerHTML;
    document.getElementById('subsDetailModal').classList.remove('show');
    const numberMatches = html.match(/>0\d\./g) || [];
    if (numberMatches.length !== 1) throw new Error('expected exactly ONE numbered row (01.) for the merged transaction, found ' + numberMatches.length + ':\n' + html);
    if ((html.match(/•/g)||[]).length !== 2) throw new Error('expected 2 bullet sub-lines (one per service) inside the merged transaction:\n' + html);
    if (!html.includes('88.100')) throw new Error('merged transaction total (88.100) not shown:\n' + html);

    // Legacy rows saved before batch_id existed must NOT be merged with each other.
    const legacyGroups = groupExtrasIntoTransactions([
      { id:'legacy1', tanggal:'2026-08-10', layananNama:'Cuci Reguler', qty:1, satuan:'kg', harga:10000, subtotal:10000, batchId:null },
      { id:'legacy2', tanggal:'2026-08-11', layananNama:'Cuci Reguler', qty:1, satuan:'kg', harga:12000, subtotal:12000, batchId:null },
    ]);
    if (legacyGroups.length !== 2) throw new Error('legacy rows without batch_id must stay as separate transactions, got ' + legacyGroups.length + ' groups');

    // Same grouping must carry through to the WA-text/PDF rekap builders used by the notas.
    const waLines = extraGroupLinesWA(batchItems);
    if (waLines.length !== 3) throw new Error('expected 1 header line + 2 bullet lines, got ' + waLines.length + ': ' + JSON.stringify(waLines));
    if (!/^01\. .*Transaksi \(2 layanan\)/.test(waLines[0])) throw new Error('header line malformed: ' + waLines[0]);
    if (!waLines[1].includes('•') || !waLines[2].includes('•')) throw new Error('bullet lines missing bullet marker: ' + JSON.stringify(waLines));
    const pdfLines = extraGroupLinesPDF(batchItems);
    if (pdfLines.length !== 3 || !/Transaksi \(2 layanan\)/.test(pdfLines[0].t)) throw new Error('PDF rekap lines malformed: ' + JSON.stringify(pdfLines));

    // submitExtraServiceBatch() must actually tag every row it inserts with the SAME batch_id.
    currentSubscriptionId = 'sub-tempo-1';
    draftExtraItems = [
      { tanggal:'2026-08-26', nama:'Cuci Kilat 2', qty:1, satuan:'kg', harga:9000, subtotal:9000 },
      { tanggal:'2026-08-26', nama:'Setrika 2', qty:1, satuan:'pcs', harga:3000, subtotal:3000 },
    ];
    renderExtraDraftList();
    const rowsBefore = fakeUsageRows.length;
    await submitExtraServiceBatch();
    const inserted = fakeUsageRows.slice(rowsBefore);
    if (inserted.length !== 2) throw new Error('expected 2 newly inserted rows, got ' + inserted.length);
    if (!inserted[0].batch_id || inserted[0].batch_id !== inserted[1].batch_id) {
      throw new Error('submitExtraServiceBatch() must save the same batch_id on every row of one submission: ' + JSON.stringify(inserted));
    }
    closeUsageNotaOptions();
  });

  // --- Undo/confirm delete: deleteUsage() (Paket Bulanan/Tempo "Riwayat Periode Ini" rows) ---
  await step('deleteUsage() asks for confirmation and does NOT delete when cancelled', async () => {
    currentSubscriptionId = 'sub-bulanan-1';
    fakeUsageRows = [
      { id:'dp1', tanggal:'2026-08-05', berat:5, catatan:'', type:'pemakaian', layananNama:'', qty:0, satuan:'', harga:0, subtotal:0 },
    ].map(toDbRow);
    await openSubsDetail('sub-bulanan-1');
    const originalConfirm = window.confirm;
    window.confirm = () => false; // user clicks "Batal"
    await deleteUsage('dp1');
    window.confirm = originalConfirm;
    if (fakeUsageRows.length !== 1) throw new Error('row should NOT have been deleted when confirm() is cancelled');
    closeSubsDetail();
  });

  await step('deleteUsage() deletes after confirmation, then "Urungkan" in the toast restores it', async () => {
    currentSubscriptionId = 'sub-bulanan-1';
    fakeUsageRows = [
      { id:'dp2', tanggal:'2026-08-06', berat:0, catatan:'', type:'layanan_tambahan', layananNama:'Handuk', qty:1, satuan:'pcs', harga:5000, subtotal:5000 },
    ].map(toDbRow);
    await openSubsDetail('sub-bulanan-1');
    const originalConfirm = window.confirm;
    window.confirm = () => true; // user confirms delete
    await deleteUsage('dp2');
    window.confirm = originalConfirm;
    if (fakeUsageRows.length !== 0) throw new Error('row should have been deleted after confirming');
    const toast = document.getElementById('toast');
    if (!toast.classList.contains('has-action')) throw new Error('toast should show an Urungkan (undo) action after delete');
    const btn = toast.querySelector('.toast-action');
    if (!btn || btn.textContent !== 'Urungkan') throw new Error('toast action button missing or mislabeled: ' + (btn && btn.textContent));
    btn.onclick(); // fire the undo handler (async — awaited via the settle delay below)
    await new Promise(r => setTimeout(r, 150));
    if (fakeUsageRows.length !== 1) throw new Error('undo should have re-inserted the deleted row, fakeUsageRows: ' + JSON.stringify(fakeUsageRows));
    const restored = fakeUsageRows[0];
    if (restored.layanan_nama !== 'Handuk' || Number(restored.subtotal) !== 5000) {
      throw new Error('restored row has wrong data: ' + JSON.stringify(restored));
    }
    closeSubsDetail();
  });

  // --- Undo delete: deleteTransaction() (Riwayat Transaksi regular transactions) ---
  await step('deleteTransaction() deletes after confirmation, then "Urungkan" restores it into transactions[]', async () => {
    transactions.push({ id:'del-tx-1', kode:'DEL-1', nama:'Budi Uji', hp:'', tanggal:'2026-08-27', estimasi:null, items:[{nama:'Cuci',qty:1,satuan:'kg',harga:9000,subtotal:9000}], diskon:0, total:9000, dp:9000, status:'lunas', catatan:'' });
    const originalConfirm = window.confirm;
    window.confirm = () => true;
    await deleteTransaction('del-tx-1');
    window.confirm = originalConfirm;
    if (transactions.some(t => t.id === 'del-tx-1')) throw new Error('transaction should be removed after confirmed delete');
    const toast = document.getElementById('toast');
    const btn = toast.querySelector('.toast-action');
    if (!btn || btn.textContent !== 'Urungkan') throw new Error('deleteTransaction toast missing Urungkan action');
    btn.onclick();
    await new Promise(r => setTimeout(r, 150));
    const restored = transactions.find(t => t.kode === 'DEL-1');
    if (!restored || restored.nama !== 'Budi Uji' || restored.total !== 9000) {
      throw new Error('undo should have restored the deleted transaction: ' + JSON.stringify(restored));
    }
  });

  // --- Custom shop logo (in-app only, distinct from the fixed auth-screen logo) ---
  await step('shopLogoSrc() falls back to the default SHOP_LOGO_B64 until a custom logo is set', () => {
    settings.logoUrl = null;
    if (shopLogoSrc() !== SHOP_LOGO_B64) throw new Error('expected default logo when logoUrl is null');
    settings.logoUrl = 'data:image/jpeg;base64,CUSTOMLOGO';
    if (shopLogoSrc() !== 'data:image/jpeg;base64,CUSTOMLOGO') throw new Error('expected custom logo once logoUrl is set');
    settings.logoUrl = null;
  });

  await step('saveShopLogo() persists via a settings upsert and updates the appbar logo', async () => {
    lastSettingsUpsert = null;
    settings.shopName = 'Laundry Uji'; settings.address = ''; settings.phone = ''; settings.note = '';
    await saveShopLogo('data:image/jpeg;base64,NEWLOGO123');
    if (settings.logoUrl !== 'data:image/jpeg;base64,NEWLOGO123') throw new Error('settings.logoUrl not updated');
    if (!lastSettingsUpsert || lastSettingsUpsert.logo_url !== 'data:image/jpeg;base64,NEWLOGO123') {
      throw new Error('logo_url not sent in the settings upsert payload: ' + JSON.stringify(lastSettingsUpsert));
    }
    const appbarLogo = document.getElementById('appbarLogo');
    if (appbarLogo.src !== 'data:image/jpeg;base64,NEWLOGO123') throw new Error('appbar logo <img> src not updated: ' + appbarLogo.src);
  });

  await step('resetShopLogo() clears the custom logo back to the default', async () => {
    const originalConfirm = window.confirm;
    window.confirm = () => true;
    await resetShopLogo();
    window.confirm = originalConfirm;
    if (settings.logoUrl !== null) throw new Error('settings.logoUrl should be null after reset, got ' + settings.logoUrl);
    if (lastSettingsUpsert.logo_url !== null) throw new Error('reset should upsert logo_url:null, got ' + lastSettingsUpsert.logo_url);
    const appbarLogo = document.getElementById('appbarLogo');
    if (appbarLogo.src !== SHOP_LOGO_B64) throw new Error('appbar logo should revert to default SHOP_LOGO_B64: ' + appbarLogo.src);
  });

  await step('The auth-screen (login) logo is a separate hardcoded <img>, unaffected by shopLogoSrc()', () => {
    const authLogoImgs = document.querySelectorAll('#authScreen img');
    if (authLogoImgs.length === 0) throw new Error('expected at least one <img> inside #authScreen');
    const stillDefault = Array.from(authLogoImgs).every(img => img.src.endsWith('/icons/logo-auth.png'));
    if (!stillDefault) throw new Error('auth screen logo should stay the fixed default (icons/logo-auth.png), not follow shopLogoSrc(): ' + Array.from(authLogoImgs).map(i=>i.src).join(', '));
  });

  await step('Layar Daftar: checkbox setuju Syarat & Ketentuan wajib dicentang sebelum handleAuthSubmit() lanjut ke signUp(), dan tersembunyi lagi di mode Masuk', async () => {
    setAuthMode('masuk');
    if (getComputedStyle(document.getElementById('authTosField')).display !== 'none') throw new Error('checkbox S&K seharusnya tersembunyi di mode Masuk');
    if (!document.querySelector('.auth-footer-links').textContent.includes('Syarat & Ketentuan')) throw new Error('footer link S&K/Privasi/Refund harus tetap tampil di layar login (mode Masuk)');

    setAuthMode('daftar');
    if (getComputedStyle(document.getElementById('authTosField')).display === 'none') throw new Error('checkbox S&K seharusnya tampil di mode Daftar');
    if (document.getElementById('authTosCheck').checked) throw new Error('checkbox S&K seharusnya belum tercentang saat baru pindah ke mode Daftar');

    document.getElementById('authEmail').value = 'calon-pelanggan@example.com';
    document.getElementById('authPassword').value = 'password123';
    await handleAuthSubmit();
    if (!document.getElementById('authMsg').textContent.includes('Syarat & Ketentuan')) throw new Error('submit tanpa centang harus diblok dengan pesan wajib setuju S&K, got: ' + document.getElementById('authMsg').textContent);

    document.getElementById('authTosCheck').checked = true;
    await handleAuthSubmit();
    if (document.getElementById('authMsg').textContent.includes('Syarat & Ketentuan')) throw new Error('setelah dicentang, validasi S&K seharusnya tidak lagi menghalangi submit');

    setAuthMode('masuk');
    if (getComputedStyle(document.getElementById('authTosField')).display !== 'none' || document.getElementById('authTosCheck').checked) throw new Error('balik ke mode Masuk harus menyembunyikan & mereset checkbox S&K');
  });

  // --- Promo footer: "Tinggiran Tech Studio" across every nota surface ---
  await step('WA-text notas (tempo, bulanan, invoice, regular receipt) carry the new promo footer', () => {
    tempoSub.dp = 0;
    currentUsageList = [
      { id:'pf1', tanggal:'2026-08-20', berat:0, catatan:'', type:'layanan_tambahan', layananNama:'Cuci Reguler', qty:1, satuan:'kg', harga:20000, subtotal:20000 },
    ];
    tempoSub._calc = { excessKg:0, excessCost:0, excessRate:0, extraTotal:20000, totalTagihan:20000, sisaBayar:20000, lebihBayar:0, lunasNow:false };
    const texts = [
      tempoUsageNotaTextWA(currentUsageList[0], tempoSub),
      subsInvoiceTextWA(tempoSub),
      receiptTextForWA({ kode:'PF-1', tanggal:'2026-08-27', nama:'Uji', estimasi:null, items:[{nama:'Cuci',qty:1,satuan:'kg',harga:9000,subtotal:9000}], diskon:0, total:9000, dp:9000, status:'lunas' }),
    ];
    texts.forEach((txt, i) => {
      if (!txt.includes('dikembangkan oleh Tinggiran Tech Studio')) throw new Error(`text #${i} missing studio name: ` + txt);
      if (!txt.includes('Bikin Apps & Website Kilat')) throw new Error(`text #${i} missing tagline: ` + txt);
      if (!txt.includes('081293228520')) throw new Error(`text #${i} missing WA number: ` + txt);
      if (!txt.includes('tinggirantech@gmail.com')) throw new Error(`text #${i} missing email: ` + txt);
    });
  });

  await step('PDF/JPG notas render the promo footer with real green-WA / gray-email icon badges', () => {
    const pdfLineSets = [
      buildTempoUsageNotaPDFLines(currentUsageList[0], tempoSub),
      buildSubsInvoicePDFLines(tempoSub),
      buildReceiptPDFLines({ kode:'PF-2', tanggal:'2026-08-27', nama:'Uji', estimasi:null, items:[{nama:'Cuci',qty:1,satuan:'kg',harga:9000,subtotal:9000}], diskon:0, total:9000, dp:9000, status:'lunas' }),
    ];
    pdfLineSets.forEach((L, i) => {
      const nameLine = L.find(l => l.t === 'dikembangkan oleh Tinggiran Tech Studio');
      if (!nameLine || !nameLine.b) throw new Error(`PDF set #${i} missing bold studio name line`);
      if (!L.some(l => l.t === 'Bikin Apps & Website Kilat')) throw new Error(`PDF set #${i} missing tagline line`);
      const waLine = L.find(l => l.icon === 'wa');
      if (!waLine || waLine.t !== '081293228520') throw new Error(`PDF set #${i} missing wa-icon line with the number: ` + JSON.stringify(waLine));
      const emailLine = L.find(l => l.icon === 'email');
      if (!emailLine || emailLine.t !== 'tinggirantech@gmail.com') throw new Error(`PDF set #${i} missing email-icon line: ` + JSON.stringify(emailLine));
    });
  });

  await step('buildNotaCanvas() draws icon-badge lines without throwing (green WA circle + gray email circle)', async () => {
    const L = buildReceiptPDFLines({ kode:'PF-3', tanggal:'2026-08-27', nama:'Uji Canvas', estimasi:null, items:[{nama:'Cuci',qty:1,satuan:'kg',harga:9000,subtotal:9000}], diskon:0, total:9000, dp:9000, status:'lunas' });
    const canvas = await buildNotaCanvas(L, 80);
    if (!canvas || !canvas.width || !canvas.height) throw new Error('buildNotaCanvas did not return a valid canvas');
    const ctx = canvas.getContext('2d');
    // Scan the rendered pixels for the WhatsApp green (#25D366) — confirms the badge was
    // actually painted, not just that the code ran without throwing.
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let foundGreen = false;
    for (let p = 0; p < imgData.length; p += 4*23) { // sample, not every pixel (perf)
      if (imgData[p] > 20 && imgData[p] < 55 && imgData[p+1] > 190 && imgData[p+1] < 230 && imgData[p+2] > 90 && imgData[p+2] < 130) {
        foundGreen = true; break;
      }
    }
    if (!foundGreen) throw new Error('expected to find WhatsApp-green (#25D366) pixels in the rendered canvas');
  });

  // --- Regression: on desktop, "Unduh Gambar" opened the OS-level Share sheet (Windows/Mac),
  // which only lists other apps to share to and has NO plain "save file" option -- so a desktop
  // user could never actually open the receipt image except by sending it through one of those
  // apps. navigator.canShare({files}) reports true on desktop Chromium/Edge too, so the bug was
  // using that alone to decide; the fix also requires a mobile user agent. ---
  await step('shareOrDownloadNotaImage(): Web Share API (dialog Share OS) hanya dipakai di HP -- desktop selalu langsung unduh biasa meski browser lapor canShare mendukung', async () => {
    const originalCanShare = navigator.canShare;
    const originalShare = navigator.share;
    const originalCreateElement = document.createElement.bind(document);
    let shareCalls = 0;
    let clickedDownloads = [];
    navigator.canShare = () => true;
    navigator.share = async () => { shareCalls++; };
    document.createElement = (tag) => {
      const el = originalCreateElement(tag);
      if (tag === 'a') {
        const originalClick = el.click.bind(el);
        el.click = () => { clickedDownloads.push(el.download); originalClick(); };
      }
      return el;
    };
    const setUA = (ua) => Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
    try {
      const lines = [{ t: 'Test', s: 9 }];

      setUA('Mozilla/5.0 (Linux; Android 13; SM-A125F) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36');
      shareCalls = 0; clickedDownloads = [];
      await shareOrDownloadNotaImage(lines, 'Test-Mobile', 80, 'Test');
      if (shareCalls !== 1) throw new Error('HP (Android UA) seharusnya memakai navigator.share(), got shareCalls=' + shareCalls);
      if (clickedDownloads.length !== 0) throw new Error('HP seharusnya TIDAK ikut memicu <a download>.click() kalau navigator.share() jalan');

      setUA('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36');
      shareCalls = 0; clickedDownloads = [];
      await shareOrDownloadNotaImage(lines, 'Test-Desktop', 80, 'Test');
      if (shareCalls !== 0) throw new Error('BUG: desktop (Windows UA) tidak boleh membuka dialog Share OS (tidak ada opsi simpan biasa di sana) meski canShare melaporkan dukung, got shareCalls=' + shareCalls);
      if (clickedDownloads.length !== 1 || !clickedDownloads[0].startsWith('Test-Desktop')) throw new Error('desktop seharusnya langsung memicu <a download>.click() biasa, got ' + JSON.stringify(clickedDownloads));
    } finally {
      navigator.canShare = originalCanShare;
      navigator.share = originalShare;
      document.createElement = originalCreateElement;
      delete navigator.userAgent;
    }
  });

  await step('buildReceiptHTML() includes clickable wa.me and mailto links with icon badges', () => {
    const html = buildReceiptHTML({ kode:'PF-4', tanggal:'2026-08-27', nama:'Uji HTML', estimasi:null, items:[{nama:'Cuci',qty:1,satuan:'kg',harga:9000,subtotal:9000}], diskon:0, total:9000, dp:9000, status:'lunas', catatan:'' });
    if (!html.includes('dikembangkan oleh Tinggiran Tech Studio')) throw new Error('HTML receipt missing studio name');
    if (!html.includes('href="https://wa.me/6281293228520"')) throw new Error('HTML receipt missing clickable WA link');
    if (!html.includes('href="mailto:tinggirantech@gmail.com"')) throw new Error('HTML receipt missing mailto link');
    if (!html.includes('#25D366')) throw new Error('HTML receipt missing green WA badge color');
  });

  await step('buildReceiptHTML()/renderDraftItems() escape item nama/satuan — a customer-typed layanan name is free text (no catalog validation) and must not be injectable as HTML', () => {
    const payload = '<img src=x onerror="window.__xssFired=true">';
    const trx = { kode:'PF-XSS', tanggal:'2026-08-27', nama:'Uji XSS', estimasi:null, items:[{nama:payload, qty:1, satuan:'<b>kg</b>', harga:9000, subtotal:9000}], diskon:0, total:9000, dp:9000, status:'lunas', catatan:'' };
    const html = buildReceiptHTML(trx);
    if (html.includes('<img src=x onerror=')) throw new Error('buildReceiptHTML() must escape item.nama, not inject it raw into innerHTML (stored XSS): ' + html);
    if (html.includes('<b>kg</b>')) throw new Error('buildReceiptHTML() must escape item.satuan too: ' + html);
    if (!html.includes('&lt;img src=x onerror=')) throw new Error('expected the payload to appear HTML-escaped, not silently dropped: ' + html);

    draftItems = [{ nama:payload, qty:1, satuan:'<b>kg</b>', harga:9000, subtotal:9000 }];
    renderDraftItems();
    const draftHtml = document.getElementById('itemsList').innerHTML;
    if (draftHtml.includes('<img src=x onerror=')) throw new Error('renderDraftItems() must escape item.nama before the item is even saved, not just at nota time: ' + draftHtml);
    if (draftHtml.includes('<b>kg</b>')) throw new Error('renderDraftItems() must escape item.satuan too: ' + draftHtml);
    draftItems = [];
    renderDraftItems();
  });

  // --- Pengeluaran (expenses): nota beritem seperti transaksi reguler ---
  await step('renderReport() Rincian Transaksi is sorted by tanggal ascending (oldest first), not insertion order', () => {
    transactions = [
      { id:'ord1', kode:'ORD-1', nama:'C', hp:'', tanggal:'2026-08-24', estimasi:null, items:[], diskon:0, total:1000, dp:1000, status:'lunas', catatan:'' },
      { id:'ord2', kode:'ORD-2', nama:'A', hp:'', tanggal:'2026-08-03', estimasi:null, items:[], diskon:0, total:1000, dp:1000, status:'lunas', catatan:'' },
      { id:'ord3', kode:'ORD-3', nama:'B', hp:'', tanggal:'2026-08-16', estimasi:null, items:[], diskon:0, total:1000, dp:1000, status:'lunas', catatan:'' },
    ];
    document.getElementById('reportMonth').value = '2026-08';
    renderReport();
    const html = document.getElementById('reportList').innerHTML;
    const posA = html.indexOf('03 Agu'), posB = html.indexOf('16 Agu'), posC = html.indexOf('24 Agu');
    if (!(posA >= 0 && posA < posB && posB < posC)) throw new Error('Rincian Transaksi not sorted oldest-first: ' + html);
  });

  // --- Papan Kerja: auto-populated board grouped by day-of-week (Senin-Ahad), gabungan transaksi reguler + kerjaan Paket Bulanan/Tempo ---
  await step('indoDayName() maps a date to the correct Indonesian weekday name', () => {
    const cases = { '2026-08-24':'Senin', '2026-08-25':'Selasa', '2026-08-26':'Rabu', '2026-08-27':'Kamis', '2026-08-28':'Jumat', '2026-08-29':'Sabtu', '2026-08-30':'Ahad' };
    Object.entries(cases).forEach(([d, expected]) => {
      if (indoDayName(d) !== expected) throw new Error(`indoDayName(${d}) expected ${expected}, got ${indoDayName(d)}`);
    });
  });

  await step('renderWorkBoard() renders a fixed 7-column Senin->Ahad grid (columns always present, even empty), regardless of insertion order, showing ONLY nama/layanan/tanggal/harga on each card (no kode, no payment badge)', () => {
    allWorkUsage = [];
    transactions = [
      { id:'wb-ahad', kode:'WB-1', nama:'Rudi', hp:'', tanggal:'2026-09-06', estimasi:null, items:[{nama:'Cuci Kilat',qty:1,satuan:'kg',harga:20000,subtotal:20000}], diskon:0, total:20000, dp:0, status:'belum', catatan:'', workStatus:'belum' },
      { id:'wb-senin', kode:'WB-2', nama:'Sari', hp:'', tanggal:'2026-08-31', estimasi:null, items:[{nama:'Cuci Lipat Reguler',qty:2,satuan:'kg',harga:7000,subtotal:14000}], diskon:0, total:14000, dp:14000, status:'lunas', catatan:'', workStatus:'belum' },
      { id:'wb-rabu', kode:'WB-3', nama:'Acha', hp:'', tanggal:'2026-09-02', estimasi:null, items:[{nama:'Karpet',qty:1,satuan:'m²',harga:35000,subtotal:35000}], diskon:0, total:35000, dp:0, status:'belum', catatan:'', workStatus:'belum' },
      { id:'wb-picked-up', kode:'WB-4', nama:'Sudah Diambil', hp:'', tanggal:'2026-08-31', estimasi:null, items:[], diskon:0, total:9000, dp:9000, status:'lunas', catatan:'', workStatus:'diambil' },
    ];
    switchTab('papan');
    const html = document.getElementById('workBoardGrid').innerHTML;
    const dayCols = document.querySelectorAll('#workBoardGrid .work-day-col');
    if (dayCols.length !== 7) throw new Error('expected exactly 7 day columns (Senin-Ahad) always rendered, got ' + dayCols.length);
    if (!html.includes('Rudi') || !html.includes('Sari') || !html.includes('Acha')) throw new Error('board missing one or more active customer cards: ' + html);
    if (html.includes('Sudah Diambil') && html.includes('Diambil Nanti')) throw new Error('a transaction with workStatus="diambil" should NOT appear on the board');
    // urutan tetap Senin -> Ahad, bukan urutan insert (Ahad dulu di array, Senin duluan di array ke-2)
    const posSenin = html.indexOf('>Senin'), posRabu = html.indexOf('>Rabu'), posAhad = html.indexOf('>Ahad');
    if (!(posSenin >= 0 && posSenin < posRabu && posRabu < posAhad)) throw new Error('day columns not in fixed Senin->Ahad left-to-right order: ' + html);
    if (!html.includes('Karpet') || !html.includes('Rp35.000')) throw new Error('card missing layanan name or harga: ' + html);
    if (html.includes('WB-3') || html.includes('WB-1')) throw new Error('card should NOT show the nota kode anymore (simplified to nama/layanan/tanggal/harga only): ' + html);
    if (html.includes('badge-lunas') || html.includes('badge-belum')) throw new Error('card should NOT show the Lunas/Belum Lunas payment badge anymore: ' + html);
    if (!html.includes('Belum ada')) throw new Error('empty day columns (e.g. Selasa, Kamis) should show a "Belum ada" placeholder: ' + html);
  });

  await step('workBoardCardHTML() shows "Lunas" instead of harga when paid, and harga when not yet lunas', () => {
    allWorkUsage = [];
    transactions = [
      { id:'wb-lunas', kode:'WB-20', nama:'Sudah Bayar', hp:'', tanggal:'2026-08-31', estimasi:null, items:[{nama:'Cuci Reguler',qty:1,satuan:'kg',harga:8000,subtotal:8000}], diskon:0, total:8000, dp:8000, status:'lunas', catatan:'', workStatus:'belum' },
      { id:'wb-belum', kode:'WB-21', nama:'Belum Bayar', hp:'', tanggal:'2026-08-31', estimasi:null, items:[{nama:'Cuci Reguler',qty:1,satuan:'kg',harga:6000,subtotal:6000}], diskon:0, total:6000, dp:0, status:'belum', catatan:'', workStatus:'belum' },
    ];
    renderWorkBoard();
    const html = document.getElementById('workBoardGrid').innerHTML;
    if (!html.includes('class="work-lunas">Lunas</div>')) throw new Error('lunas transaction should show a "Lunas" label instead of harga: ' + html);
    if (html.includes('Rp8.000')) throw new Error('lunas transaction should NOT show its harga: ' + html);
    if (!html.includes('class="work-harga">Rp6.000</div>')) throw new Error('belum-lunas transaction should still show its harga: ' + html);
  });

  await step('workBoardDate()/renderWorkBoard() group by ESTIMASI SELESAI (completion date), not tanggal masuk (intake date), when estimasi is set', () => {
    // Pak Manto: masuk Senin (31 Agu), layanan selesai 1 hari -> estimasi Selasa (1 Sep) -> harus muncul di kolom Selasa, bukan Senin.
    transactions = [
      { id:'wb-manto', kode:'WB-10', nama:'Pak Manto', hp:'', tanggal:'2026-08-31', estimasi:'2026-09-01', items:[{nama:'Cuci Setrika Ekspress',qty:1,satuan:'kg',harga:15000,subtotal:15000}], diskon:0, total:15000, dp:0, status:'belum', catatan:'', workStatus:'belum' },
    ];
    renderWorkBoard();
    const html = document.getElementById('workBoardGrid').innerHTML;
    const selasaIdx = html.indexOf('>Selasa'), rabuIdx = html.indexOf('>Rabu'), namaIdx = html.indexOf('Pak Manto');
    if (namaIdx === -1) throw new Error('Pak Manto card not rendered at all: ' + html);
    if (!(namaIdx > selasaIdx && namaIdx < rabuIdx)) throw new Error('Pak Manto should be grouped under Selasa (his estimasi selesai date 2026-09-01), not Senin (intake day): ' + html);
    if (!html.includes('Selesai 01 Sep 2026')) throw new Error('card should show "Selesai" before the estimasi selesai date: ' + html);
  });

  await step('workBoardDate() falls back to tanggal masuk (with a visible note) when estimasi was never filled in', () => {
    transactions = [
      { id:'wb-noest', kode:'WB-11', nama:'Tanpa Estimasi', hp:'', tanggal:'2026-09-02', estimasi:null, items:[], diskon:0, total:5000, dp:0, status:'belum', catatan:'', workStatus:'belum' },
    ];
    renderWorkBoard();
    const html = document.getElementById('workBoardGrid').innerHTML;
    const rabuIdx = html.indexOf('>Rabu'), namaIdx = html.indexOf('Tanpa Estimasi');
    if (rabuIdx === -1 || namaIdx < rabuIdx) throw new Error('without estimasi, should fall back to grouping by tanggal masuk (Rabu, 2026-09-02): ' + html);
    if (!html.includes('Selesai 02 Sep 2026 (belum ada estimasi)')) throw new Error('card should show "Selesai" before the fallback tanggal-masuk note when estimasi is missing: ' + html);
  });

  await step('renderWorkBoard() shows a "Hari Ini" badge on today\'s day column header', () => {
    const todayName = indoDayName(todayISO());
    transactions = [
      { id:'wb-today', kode:'WB-5', nama:'Hari Ini', hp:'', tanggal: todayISO(), estimasi:null, items:[], diskon:0, total:5000, dp:0, status:'belum', catatan:'', workStatus:'belum' },
    ];
    renderWorkBoard();
    const todayHeader = Array.from(document.querySelectorAll('#workBoardGrid .work-day-col-header')).find(h => h.textContent.startsWith(todayName));
    if (!todayHeader) throw new Error(`could not find today's (${todayName}) column header`);
    if (!todayHeader.classList.contains('is-today')) throw new Error('today\'s column header should carry the is-today class');
    if (!todayHeader.textContent.includes('Hari Ini')) throw new Error('today\'s column header should show a "Hari Ini" badge: ' + todayHeader.innerHTML);
  });

  await step('setWorkStatus()/markPickedUp() for source="trx" cycles a regular transaction through belum -> sedang -> selesai, then removes it from the board on pickup', async () => {
    transactions = [
      { id:'wb-cycle', kode:'WB-6', nama:'Budi Cycle', hp:'', tanggal:'2026-08-31', estimasi:null, items:[], diskon:0, total:1000, dp:0, status:'belum', catatan:'', workStatus:'belum' },
    ];
    renderWorkBoard();
    let html = document.getElementById('workBoardGrid').innerHTML;
    if (html.includes('Sudah Diambil')) throw new Error('should not offer "Sudah Diambil" while workStatus is "belum"');

    await setWorkStatus('wb-cycle', 'sedang', 'trx');
    if (transactions[0].workStatus !== 'sedang') throw new Error('setWorkStatus should update the in-memory transaction');

    await setWorkStatus('wb-cycle', 'selesai', 'trx');
    if (transactions[0].workStatus !== 'selesai') throw new Error('setWorkStatus should update to selesai');
    html = document.getElementById('workBoardGrid').innerHTML;
    if (!html.includes('Sudah Diambil')) throw new Error('"Sudah Diambil" button should appear once workStatus is "selesai": ' + html);

    await markPickedUp('wb-cycle', 'trx');
    if (transactions[0].workStatus !== 'diambil') throw new Error('markPickedUp should set workStatus to "diambil"');
    html = document.getElementById('workBoardGrid').innerHTML;
    if (html.includes('Budi Cycle')) throw new Error('card should disappear from the board after markPickedUp(): ' + html);
  });

  // --- Papan Kerja: kerjaan Paket Bulanan & Tempo, bukan cuma transaksi reguler ---
  await step('buildWorkItems()/renderWorkBoard() include Paket Bulanan "layanan tambahan", Tempo visits, AND plain kg timbangan ("pemakaian") — the last showing berat (kg) instead of harga', () => {
    transactions = [];
    allWorkUsage = [
      { id:'au-bulanan', subscriptionId:'sub-bulanan-1', tanggal:'2026-08-31', estimasi:'2026-09-01', type:'layanan_tambahan', layananNama:'Handuk Besar', qty:2, satuan:'pcs', harga:5000, subtotal:10000, workStatus:'belum' },
      { id:'au-tempo', subscriptionId:'sub-tempo-1', tanggal:'2026-08-31', estimasi:'2026-09-02', type:'layanan_tambahan', layananNama:'Cuci Setrika Ekspress', qty:1, satuan:'kg', harga:15000, subtotal:15000, workStatus:'belum' },
      { id:'au-kg', subscriptionId:'sub-bulanan-1', tanggal:'2026-08-31', estimasi:'2026-08-31', type:'pemakaian', berat:5, harga:0, subtotal:0, workStatus:'belum' },
    ];
    renderWorkBoard();
    const html = document.getElementById('workBoardGrid').innerHTML;
    if (!html.includes(bulananSub.nama)) throw new Error(`expected Bulanan layanan_tambahan card to show the subscription's nama (${bulananSub.nama}): ` + html);
    if (!html.includes('Handuk Besar')) throw new Error('missing Bulanan layanan_tambahan card: ' + html);
    if (!html.includes(tempoSub.nama)) throw new Error(`expected Tempo card to show the subscription's nama (${tempoSub.nama}): ` + html);
    if (!html.includes('Cuci Setrika Ekspress')) throw new Error('missing Tempo visit card: ' + html);
    if (!html.includes('Rp10.000') || !html.includes('Rp15.000')) throw new Error('missing harga on usage-sourced cards: ' + html);
    // "pemakaian" (kg timbangan polos) kini ikut ditampilkan, dengan berat (bukan harga) di kartunya
    if (!html.includes(bulananSub.paketNama)) throw new Error(`expected pemakaian card to show the subscription's paketNama (${bulananSub.paketNama}): ` + html);
    if (!html.includes('class="work-harga">5 kg</div>')) throw new Error('expected pemakaian card to show berat (5 kg) instead of harga: ' + html);
    const cardCount = (html.match(/class="work-card"/g) || []).length;
    if (cardCount !== 3) throw new Error(`expected exactly 3 cards (layanan_tambahan x2 + pemakaian), got ${cardCount}: ` + html);
  });

  await step('buildWorkItems()/renderWorkBoard() exclude transactions & usage dated before the Papan Kerja start cutoff (2026-08-25), treated as old backfilled/finished notes', () => {
    transactions = [
      { id:'wb-old', kode:'WB-22', nama:'Nota Lama', hp:'', tanggal:'2026-08-20', estimasi:null, items:[{nama:'Cuci Reguler',qty:1,satuan:'kg',harga:5000,subtotal:5000}], diskon:0, total:5000, dp:0, status:'belum', catatan:'', workStatus:'belum' },
      { id:'wb-new', kode:'WB-23', nama:'Nota Baru', hp:'', tanggal:'2026-08-25', estimasi:null, items:[{nama:'Cuci Reguler',qty:1,satuan:'kg',harga:5000,subtotal:5000}], diskon:0, total:5000, dp:0, status:'belum', catatan:'', workStatus:'belum' },
    ];
    allWorkUsage = [
      { id:'au-old', subscriptionId:'sub-bulanan-1', tanggal:'2026-08-24', estimasi:null, type:'layanan_tambahan', layananNama:'Handuk Lama', qty:1, satuan:'pcs', harga:5000, subtotal:5000, workStatus:'belum' },
    ];
    renderWorkBoard();
    const html = document.getElementById('workBoardGrid').innerHTML;
    if (html.includes('Nota Lama')) throw new Error('transaction dated before the 2026-08-25 cutoff should be excluded from Papan Kerja: ' + html);
    if (!html.includes('Nota Baru')) throw new Error('transaction dated exactly on the cutoff (2026-08-25, inclusive) should still appear: ' + html);
    if (html.includes('Handuk Lama')) throw new Error('usage item dated before the 2026-08-25 cutoff should be excluded from Papan Kerja: ' + html);
  });

  await step('setWorkStatus()/markPickedUp() for source="usage" update subscription_usage (not transactions) and allWorkUsage in-memory', async () => {
    allWorkUsage = [
      { id:'au-status', subscriptionId:'sub-tempo-1', tanggal:'2026-08-31', estimasi:'2026-09-01', type:'layanan_tambahan', layananNama:'Cuci Kilat', qty:1, satuan:'kg', harga:9000, subtotal:9000, workStatus:'belum' },
    ];
    transactions = [];
    renderWorkBoard();
    await setWorkStatus('au-status', 'selesai', 'usage');
    if (allWorkUsage[0].workStatus !== 'selesai') throw new Error('setWorkStatus(source="usage") should update allWorkUsage, not transactions');
    let html = document.getElementById('workBoardGrid').innerHTML;
    if (!html.includes('Sudah Diambil')) throw new Error('"Sudah Diambil" should appear for a usage-sourced card once selesai: ' + html);

    await markPickedUp('au-status', 'usage');
    if (allWorkUsage[0].workStatus !== 'diambil') throw new Error('markPickedUp(source="usage") should set workStatus to diambil on allWorkUsage');
    html = document.getElementById('workBoardGrid').innerHTML;
    if (html.includes('Cuci Kilat')) throw new Error('usage-sourced card should disappear from the board after pickup: ' + html);
  });

  await step('addExtraService() (Paket Bulanan, non-Tempo) saves estimasi and syncs the new row into allWorkUsage for the board', async () => {
    currentSubscriptionId = 'sub-bulanan-1';
    allWorkUsage = [];
    document.getElementById('extraTanggal').value = '2026-08-24';
    document.getElementById('extraEstimasi').value = '2026-08-26';
    document.getElementById('extraLayanan').value = 'Setrika Jas';
    document.getElementById('extraQty').value = '1';
    document.getElementById('extraSatuan').value = 'pcs';
    document.getElementById('extraHarga').value = '20000';
    await addExtraService();
    if (allWorkUsage.length !== 1) throw new Error('expected addExtraService (Bulanan) to push a row into allWorkUsage, got ' + allWorkUsage.length);
    const row = allWorkUsage[0];
    if (row.layananNama !== 'Setrika Jas' || row.estimasi !== '2026-08-26' || row.subtotal !== 20000) throw new Error('allWorkUsage row mismatch: ' + JSON.stringify(row));
    currentSubscriptionId = 'sub-tempo-1';
  });

  await step('addUsage() (Paket Bulanan, plain kg intake) saves estimasi and syncs the new row into allWorkUsage for the board', async () => {
    currentSubscriptionId = 'sub-bulanan-1';
    allWorkUsage = [];
    document.getElementById('usageTanggal').value = '2026-08-27';
    document.getElementById('usageEstimasi').value = '2026-08-30';
    document.getElementById('usageBerat').value = '3.63';
    document.getElementById('usageCatatan').value = '';
    await addUsage();
    if (allWorkUsage.length !== 1) throw new Error('expected addUsage() to push a row into allWorkUsage, got ' + allWorkUsage.length);
    const row = allWorkUsage[0];
    if (row.type !== 'pemakaian' || row.estimasi !== '2026-08-30' || row.berat !== 3.63) throw new Error('allWorkUsage row mismatch: ' + JSON.stringify(row));
    renderWorkBoard();
    const html = document.getElementById('workBoardGrid').innerHTML;
    if (!html.includes(bulananSub.nama)) throw new Error('addUsage() row should appear on Papan Kerja right after saving (no reload needed): ' + html);
    if (!html.includes('class="work-harga">3.63 kg</div>')) throw new Error('addUsage() card should show berat (3.63 kg) instead of harga: ' + html);
    currentSubscriptionId = 'sub-tempo-1';
  });

  await step('submitExtraServiceBatch() (Tempo) saves estimasi per item and syncs every newly-inserted row into allWorkUsage for the board', async () => {
    currentSubscriptionId = 'sub-tempo-1';
    allWorkUsage = [];
    draftExtraItems = [
      { tanggal:'2026-08-24', estimasi:'2026-08-25', nama:'Cuci Ekspress', qty:1, satuan:'kg', harga:15000, subtotal:15000 },
      { tanggal:'2026-08-24', estimasi:'2026-08-27', nama:'Setrika Jaket', qty:1, satuan:'pcs', harga:10000, subtotal:10000 },
    ];
    renderExtraDraftList();
    await submitExtraServiceBatch();
    if (allWorkUsage.length !== 2) throw new Error('expected submitExtraServiceBatch (Tempo) to push 2 rows into allWorkUsage, got ' + allWorkUsage.length);
    if (!allWorkUsage.some(u=>u.layananNama==='Cuci Ekspress' && u.estimasi==='2026-08-25')) throw new Error('missing/mismatched Cuci Ekspress row: ' + JSON.stringify(allWorkUsage));
    if (!allWorkUsage.some(u=>u.layananNama==='Setrika Jaket' && u.estimasi==='2026-08-27')) throw new Error('missing/mismatched Setrika Jaket row: ' + JSON.stringify(allWorkUsage));
  });

  await step('deleteUsage() removes the row from allWorkUsage, and "Urungkan" restores it (preserving estimasi)', async () => {
    currentSubscriptionId = 'sub-tempo-1';
    fakeUsageRows = [
      { id:'du-1', subscription_id:'sub-tempo-1', tanggal:'2026-08-24', estimasi:'2026-08-25', type:'layanan_tambahan', layanan_nama:'Cuci Sepatu', qty:1, satuan:'pasang', harga:25000, subtotal:25000 },
    ];
    allWorkUsage = [
      { id:'du-1', subscriptionId:'sub-tempo-1', tanggal:'2026-08-24', estimasi:'2026-08-25', type:'layanan_tambahan', layananNama:'Cuci Sepatu', qty:1, satuan:'pasang', harga:25000, subtotal:25000, workStatus:'belum' },
    ];
    currentUsageList = allWorkUsage.map(u=>({ id:u.id, tanggal:u.tanggal, estimasi:u.estimasi, berat:0, catatan:'', type:u.type, layananNama:u.layananNama, qty:u.qty, satuan:u.satuan, harga:u.harga, subtotal:u.subtotal }));
    const originalConfirm = window.confirm;
    window.confirm = () => true;
    await deleteUsage('du-1');
    window.confirm = originalConfirm;
    if (allWorkUsage.some(u=>u.id==='du-1')) throw new Error('deleteUsage should remove the row from allWorkUsage');

    const toast = document.getElementById('toast');
    const btn = toast.querySelector('.toast-action');
    if (!btn || btn.textContent !== 'Urungkan') throw new Error('deleteUsage toast missing Urungkan action');
    btn.onclick();
    await new Promise(r => setTimeout(r, 150));
    const restored = allWorkUsage.find(u=>u.layananNama==='Cuci Sepatu');
    if (!restored) throw new Error('Urungkan should restore the row into allWorkUsage');
    if (restored.estimasi !== '2026-08-25') throw new Error('Urungkan should preserve the estimasi date: ' + JSON.stringify(restored));
  });

  await step('deleteUsage() on a plain kg intake ("pemakaian") also removes it from allWorkUsage, and "Urungkan" restores it (preserving berat/estimasi)', async () => {
    currentSubscriptionId = 'sub-bulanan-1';
    fakeUsageRows = [
      { id:'du-2', subscription_id:'sub-bulanan-1', tanggal:'2026-08-27', estimasi:'2026-08-30', type:'pemakaian', berat_kg:3.63, catatan:'' },
    ];
    allWorkUsage = [
      { id:'du-2', subscriptionId:'sub-bulanan-1', tanggal:'2026-08-27', estimasi:'2026-08-30', type:'pemakaian', berat:3.63, catatan:'', workStatus:'belum' },
    ];
    currentUsageList = allWorkUsage.map(u=>({ id:u.id, tanggal:u.tanggal, estimasi:u.estimasi, berat:u.berat, catatan:u.catatan, type:u.type, layananNama:'', qty:0, satuan:'', harga:0, subtotal:0 }));
    const originalConfirm = window.confirm;
    window.confirm = () => true;
    await deleteUsage('du-2');
    window.confirm = originalConfirm;
    if (allWorkUsage.some(u=>u.id==='du-2')) throw new Error('deleteUsage should remove the pemakaian row from allWorkUsage');

    const toast = document.getElementById('toast');
    const btn = toast.querySelector('.toast-action');
    if (!btn || btn.textContent !== 'Urungkan') throw new Error('deleteUsage toast missing Urungkan action');
    btn.onclick();
    await new Promise(r => setTimeout(r, 150));
    const restored = allWorkUsage.find(u=>u.type==='pemakaian' && u.tanggal==='2026-08-27');
    if (!restored) throw new Error('Urungkan should restore the pemakaian row into allWorkUsage');
    if (restored.berat !== 3.63 || restored.estimasi !== '2026-08-30') throw new Error('Urungkan should preserve berat/estimasi: ' + JSON.stringify(restored));
    currentSubscriptionId = 'sub-tempo-1';
  });

  await step('earliestWorkDate()/renderWorkBoard() default the "Unduh JPG" date range to [tanggal nota tertua, hari ini] the first time, without overwriting a value the user already set', () => {
    transactions = [
      { id:'wb-earliest', kode:'WB-40', nama:'Nota Lama Sekali', hp:'', tanggal:'2026-07-01', estimasi:null, items:[], diskon:0, total:1000, dp:0, status:'belum', catatan:'', workStatus:'belum' },
    ];
    allWorkUsage = [];
    document.getElementById('papanUnduhDari').value = '';
    document.getElementById('papanUnduhSampai').value = '';
    renderWorkBoard();
    if (document.getElementById('papanUnduhDari').value !== '2026-07-01') throw new Error('expected default "Dari" to be the earliest recorded tanggal (2026-07-01): ' + document.getElementById('papanUnduhDari').value);
    if (document.getElementById('papanUnduhSampai').value !== todayISO()) throw new Error('expected default "Sampai" to be today: ' + document.getElementById('papanUnduhSampai').value);
    document.getElementById('papanUnduhDari').value = '2026-08-01';
    renderWorkBoard();
    if (document.getElementById('papanUnduhDari').value !== '2026-08-01') throw new Error('renderWorkBoard() should not overwrite a "Dari" value the user already set');
  });

  await step('downloadWorkBoardImage() validates the date range (required, and "Dari" must not be after "Sampai") before touching html2canvas', async () => {
    let html2canvasCalled = false;
    window.html2canvas = async () => { html2canvasCalled = true; return document.createElement('canvas'); };

    document.getElementById('papanUnduhDari').value = '';
    document.getElementById('papanUnduhSampai').value = '2026-09-01';
    await downloadWorkBoardImage();
    if (!document.getElementById('toast').textContent.includes('Isi rentang tanggal dulu')) throw new Error('expected "Isi rentang tanggal dulu" toast: ' + document.getElementById('toast').textContent);

    document.getElementById('papanUnduhDari').value = '2026-09-05';
    document.getElementById('papanUnduhSampai').value = '2026-09-01';
    await downloadWorkBoardImage();
    if (!document.getElementById('toast').textContent.includes('harus sebelum')) throw new Error('expected an invalid-range toast when Dari > Sampai: ' + document.getElementById('toast').textContent);

    delete window.html2canvas;
    if (html2canvasCalled) throw new Error('html2canvas should never be called while the date range is invalid');
  });

  await step('downloadWorkBoardImage() shows a toast when there is nothing in the chosen date range', async () => {
    transactions = []; allWorkUsage = [];
    document.getElementById('papanUnduhDari').value = '2026-01-01';
    document.getElementById('papanUnduhSampai').value = '2026-01-31';
    await downloadWorkBoardImage();
    if (!document.getElementById('toast').textContent.includes('Tidak ada cucian di rentang tanggal ini')) throw new Error('expected an empty-range toast: ' + document.getElementById('toast').textContent);
  });

  await step('downloadWorkBoardImage() shows a toast when html2canvas failed to load from the CDN', async () => {
    transactions = [
      { id:'wb-img', kode:'WB-30', nama:'Uji Gambar', hp:'', tanggal:'2026-08-31', estimasi:null, items:[{nama:'Cuci',qty:1,satuan:'kg',harga:5000,subtotal:5000}], diskon:0, total:5000, dp:0, status:'belum', catatan:'', workStatus:'belum' },
    ];
    document.getElementById('papanUnduhDari').value = '2026-08-01';
    document.getElementById('papanUnduhSampai').value = '2026-09-30';
    if (typeof window.html2canvas !== 'undefined') throw new Error('test setup assumes html2canvas is not loaded in this sandbox');
    await downloadWorkBoardImage();
    const toast = document.getElementById('toast');
    if (!toast.textContent.includes('Gagal memuat alat unduh gambar')) throw new Error('expected "Gagal memuat alat unduh gambar" toast: ' + toast.textContent);
  });

  await step('downloadWorkBoardImage() renders a detached full-history grid (grouped by real calendar date, including old/"diambil" cards the live board hides) via html2canvas, then cleans it up', async () => {
    transactions = [
      // Sebelum cutoff papan aktif (25 Agu) DAN sudah "diambil" -> tidak akan pernah muncul di papan aktif,
      // tapi harus tetap muncul di unduhan rentang tanggal karena itu justru tujuannya (lihat papan lama).
      { id:'wb-img2', kode:'WB-31', nama:'Uji Gambar Dua', hp:'', tanggal:'2026-08-10', estimasi:null, items:[{nama:'Cuci',qty:1,satuan:'kg',harga:5000,subtotal:5000}], diskon:0, total:5000, dp:5000, status:'lunas', catatan:'', workStatus:'diambil' },
    ];
    document.getElementById('papanUnduhDari').value = '2026-08-01';
    document.getElementById('papanUnduhSampai').value = '2026-09-30';
    let capturedEl = null, capturedOptions = null;
    window.html2canvas = async (el, options) => {
      capturedEl = el; capturedOptions = options;
      const canvas = document.createElement('canvas');
      canvas.width = 10; canvas.height = 10;
      return canvas;
    };
    await downloadWorkBoardImage();
    delete window.html2canvas;
    if (!capturedEl) throw new Error('html2canvas should have been called');
    if (capturedEl === document.getElementById('workBoardGrid')) throw new Error('html2canvas should capture a detached history grid, not the live #workBoardGrid');
    if (document.body.contains(capturedEl)) throw new Error('the detached history grid should be removed from the DOM again after capture (finally block)');
    if (!capturedEl.innerHTML.includes('Uji Gambar Dua')) throw new Error('history grid missing the old/"diambil" card: ' + capturedEl.innerHTML);
    if (!capturedEl.innerHTML.includes('✓ Sudah Diambil')) throw new Error('a "diambil" card in the export should show a static "Sudah Diambil" label instead of interactive buttons: ' + capturedEl.innerHTML);
    if (capturedEl.querySelector('.work-pill[onclick]')) throw new Error('export cards should not have interactive/clickable status buttons: ' + capturedEl.innerHTML);
    const toast = document.getElementById('toast');
    if (!toast.textContent.includes('diunduh')) throw new Error('expected a download-success toast: ' + toast.textContent);
  });

  await step('downloadWorkBoardImage() wraps date columns into rows of at most 7 (stacked below), not one long row, when the range spans more than 7 distinct days', async () => {
    transactions = Array.from({ length: 9 }).map((_, i) => {
      const day = String(i + 1).padStart(2, '0');
      return { id:`wb-wrap-${i}`, kode:`WB-5${i}`, nama:`Uji Wrap ${i}`, hp:'', tanggal:`2026-08-${day}`, estimasi:null, items:[{nama:'Cuci',qty:1,satuan:'kg',harga:5000,subtotal:5000}], diskon:0, total:5000, dp:0, status:'belum', catatan:'', workStatus:'belum' };
    });
    document.getElementById('papanUnduhDari').value = '2026-08-01';
    document.getElementById('papanUnduhSampai').value = '2026-08-09';
    let capturedEl = null;
    window.html2canvas = async (el) => {
      capturedEl = el;
      const canvas = document.createElement('canvas');
      canvas.width = 10; canvas.height = 10;
      return canvas;
    };
    await downloadWorkBoardImage();
    delete window.html2canvas;
    const rowEls = capturedEl.querySelectorAll(':scope > .work-board-grid');
    if (rowEls.length !== 2) throw new Error(`expected 9 distinct days to wrap into 2 stacked rows (7+2), got ${rowEls.length}: ` + capturedEl.innerHTML);
    if (rowEls[0].querySelectorAll('.work-day-col').length !== 7) throw new Error('first row should have exactly 7 day columns: ' + rowEls[0].innerHTML);
    if (rowEls[1].querySelectorAll('.work-day-col').length !== 2) throw new Error('second (overflow) row should have the remaining 2 day columns, not extend the first row further right: ' + rowEls[1].innerHTML);

    // Rentang <=7 hari tetap satu baris saja.
    document.getElementById('papanUnduhDari').value = '2026-08-01';
    document.getElementById('papanUnduhSampai').value = '2026-08-05';
    window.html2canvas = async (el) => { capturedEl = el; const c = document.createElement('canvas'); c.width=10;c.height=10; return c; };
    await downloadWorkBoardImage();
    delete window.html2canvas;
    const rowEls2 = capturedEl.querySelectorAll(':scope > .work-board-grid');
    if (rowEls2.length !== 1) throw new Error(`expected a single row for a 5-day range, got ${rowEls2.length}`);
    if (rowEls2[0].querySelectorAll('.work-day-col').length !== 5) throw new Error('single row should have exactly 5 day columns: ' + rowEls2[0].innerHTML);
  });

  await step('workBoardCardHTML() live pill button reads "Dikerjakan" (not the ambiguous "Sedang") for the in-progress status', () => {
    transactions = [
      { id:'wb-label', kode:'WB-60', nama:'Uji Label', hp:'', tanggal:'2026-08-31', estimasi:null, items:[], diskon:0, total:1000, dp:0, status:'belum', catatan:'', workStatus:'belum' },
    ];
    renderWorkBoard();
    const html = document.getElementById('workBoardGrid').innerHTML;
    if (!html.includes('>Dikerjakan</button>')) throw new Error('expected the in-progress pill button to read "Dikerjakan": ' + html);
    if (html.includes('>Sedang<')) throw new Error('the ambiguous "Sedang" label should no longer appear on the live board: ' + html);
  });

  await step('downloadWorkBoardImage() forces cucian bertanggal sebelum cutoff (25 Agu 2026) to show "Selesai Dikerjakan" + "Lunas" in the export, but leaves newer cucian showing their real status/lunas', async () => {
    transactions = [
      { id:'wb-old-status', kode:'WB-61', nama:'Nota Lama Belum Lunas', hp:'', tanggal:'2026-08-10', estimasi:null, items:[{nama:'Cuci',qty:1,satuan:'kg',harga:5000,subtotal:5000}], diskon:0, total:5000, dp:0, status:'belum', catatan:'', workStatus:'belum' },
      { id:'wb-new-status', kode:'WB-62', nama:'Nota Baru Belum Lunas', hp:'', tanggal:'2026-08-26', estimasi:null, items:[{nama:'Cuci',qty:1,satuan:'kg',harga:6000,subtotal:6000}], diskon:0, total:6000, dp:0, status:'belum', catatan:'', workStatus:'belum' },
    ];
    document.getElementById('papanUnduhDari').value = '2026-08-01';
    document.getElementById('papanUnduhSampai').value = '2026-08-31';
    let capturedEl = null;
    window.html2canvas = async (el) => { capturedEl = el; const c = document.createElement('canvas'); c.width=10;c.height=10; return c; };
    await downloadWorkBoardImage();
    delete window.html2canvas;
    const cards = Array.from(capturedEl.querySelectorAll('.work-card'));
    const oldCard = cards.find(c => c.textContent.includes('Nota Lama Belum Lunas'));
    const newCard = cards.find(c => c.textContent.includes('Nota Baru Belum Lunas'));
    if (!oldCard) throw new Error('old (pre-cutoff) card not found in export: ' + capturedEl.innerHTML);
    if (!oldCard.querySelector('.work-pill').textContent.includes('Selesai Dikerjakan')) throw new Error('old card should be forced to "Selesai Dikerjakan" regardless of its real workStatus="belum": ' + oldCard.innerHTML);
    if (!oldCard.querySelector('.work-lunas')) throw new Error('old card should be forced to show "Lunas" regardless of its real status="belum": ' + oldCard.innerHTML);
    if (oldCard.querySelector('.work-harga')) throw new Error('old card should NOT show its real unpaid harga once forced to Lunas: ' + oldCard.innerHTML);
    if (!newCard) throw new Error('new (post-cutoff) card not found in export: ' + capturedEl.innerHTML);
    if (!newCard.querySelector('.work-pill').textContent.includes('Belum Dikerjakan')) throw new Error('a newer, genuinely-unstarted card should keep showing its real "Belum Dikerjakan" status: ' + newCard.innerHTML);
    if (newCard.querySelector('.work-lunas')) throw new Error('a newer, genuinely-unpaid card should NOT be forced to Lunas: ' + newCard.innerHTML);
    if (!newCard.querySelector('.work-harga') || !newCard.querySelector('.work-harga').textContent.includes('Rp6.000')) throw new Error('a newer, genuinely-unpaid card should keep showing its real harga: ' + newCard.innerHTML);
  });

  await step('buildWorkItems()/renderWorkBoard(): 1 nota Tempo berisi beberapa layanan (batch_id sama, dari submitExtraServiceBatch()) tampil sebagai SATU kartu, bukan pecah per layanan (regresi bug nyata)', async () => {
    transactions = [];
    allWorkUsage = [
      { id:'au-batch-1', subscriptionId:'sub-tempo-1', tanggal:'2026-09-20', estimasi:'2026-09-23', type:'layanan_tambahan', layananNama:'Cuci Lipat Ekspress', qty:1, satuan:'kg', harga:37400, subtotal:37400, workStatus:'belum', batchId:'batch-mahkota' },
      { id:'au-batch-2', subscriptionId:'sub-tempo-1', tanggal:'2026-09-20', estimasi:'2026-09-23', type:'layanan_tambahan', layananNama:'Handuk', qty:1, satuan:'pcs', harga:5000, subtotal:5000, workStatus:'belum', batchId:'batch-mahkota' },
      { id:'au-batch-3', subscriptionId:'sub-tempo-1', tanggal:'2026-09-20', estimasi:'2026-09-23', type:'layanan_tambahan', layananNama:'Sajadah', qty:1, satuan:'pcs', harga:10000, subtotal:10000, workStatus:'belum', batchId:'batch-mahkota' },
      { id:'au-batch-4', subscriptionId:'sub-tempo-1', tanggal:'2026-09-20', estimasi:'2026-09-23', type:'layanan_tambahan', layananNama:'Bedcover 200x200', qty:1, satuan:'pcs', harga:40000, subtotal:40000, workStatus:'belum', batchId:'batch-mahkota' },
    ];
    renderWorkBoard();
    let html = document.getElementById('workBoardGrid').innerHTML;
    let cardCount = (html.match(/class="work-card"/g) || []).length;
    if (cardCount !== 1) throw new Error(`1 nota Tempo dengan 4 layanan (batch_id sama) seharusnya jadi 1 kartu, bukan ${cardCount}: ` + html);
    if (!html.includes('Cuci Lipat Ekspress') || !html.includes('Handuk') || !html.includes('Sajadah') || !html.includes('Bedcover 200x200')) throw new Error('kartu gabungan harus tetap menyebutkan keempat layanan: ' + html);
    if (!html.includes('Rp92.400')) throw new Error('harga kartu gabungan harus dijumlahkan dari semua layanan (37400+5000+10000+40000=92400): ' + html);

    // setWorkStatus() pada kartu gabungan harus memindahkan SEMUA baris DB dalam batch itu sekaligus
    const cardIdMatch = html.match(/setWorkStatus\('([^']+)','belum'/);
    if (!cardIdMatch) throw new Error('tidak menemukan id kartu gabungan di markup: ' + html);
    const groupId = cardIdMatch[1];
    if (groupId.split(',').length !== 4) throw new Error('id kartu gabungan harus berisi keempat id baris DB, got: ' + groupId);
    await setWorkStatus(groupId, 'selesai', 'usage');
    if (allWorkUsage.some(u => u.workStatus !== 'selesai')) throw new Error('setWorkStatus() pada kartu gabungan harus mengubah workStatus SEMUA baris dalam batch itu: ' + JSON.stringify(allWorkUsage));

    await markPickedUp(groupId, 'usage');
    if (allWorkUsage.some(u => u.workStatus !== 'diambil')) throw new Error('markPickedUp() pada kartu gabungan harus menandai SEMUA baris dalam batch itu sebagai diambil: ' + JSON.stringify(allWorkUsage));
    renderWorkBoard();
    html = document.getElementById('workBoardGrid').innerHTML;
    if (html.includes('Cuci Lipat Ekspress')) throw new Error('kartu gabungan yang sudah diambil seharusnya hilang seluruhnya dari papan: ' + html);
  });

  await step('expense catalog: add via addOrUpdateExpenseCatalogItem(), autocomplete fills harga/satuan, edit updates it', async () => {
    switchTab('pengeluaran');
    expenseCatalog = [];
    document.getElementById('expCatNama').value = 'Sabun Cair 5L';
    document.getElementById('expCatSatuan').value = 'liter';
    document.getElementById('expCatHarga').value = '30000';
    await addOrUpdateExpenseCatalogItem();
    if (expenseCatalog.length !== 1 || expenseCatalog[0].nama !== 'Sabun Cair 5L') throw new Error('catalog item not added: ' + JSON.stringify(expenseCatalog));

    document.getElementById('expNama').value = 'Sabun';
    showExpenseCatalogSuggest();
    const box = document.getElementById('expNamaSuggestBox');
    if (!box.classList.contains('show') || !box.innerHTML.includes('Sabun Cair 5L')) throw new Error('catalog suggest box did not show match');
    selectExpenseCatalogSuggest(expenseCatalog[0].id);
    if (document.getElementById('expHarga').value != 30000) throw new Error('selecting suggestion should fill harga');
    if (document.getElementById('expSatuan').value !== 'liter') throw new Error('selecting suggestion should fill satuan');

    editExpenseCatalogItem(expenseCatalog[0].id);
    document.getElementById('expCatHarga').value = '32000';
    await addOrUpdateExpenseCatalogItem();
    if (expenseCatalog[0].harga !== 32000) throw new Error('edit should update harga to 32000, got ' + expenseCatalog[0].harga);
  });

  await step('kategori pengeluaran is a free-text autocomplete (not a fixed dropdown) suggesting defaults + previously used values', () => {
    expenses = [{ id:'e-prev', tanggal:'2026-08-01', nama:'Beli X', qty:1, satuan:'pcs', harga:1000, jumlah:1000, kategori:'Kategori Custom Saya', catatan:'' }];
    document.getElementById('expKategori').value = '';
    showExpKategoriSuggest();
    const box = document.getElementById('expKategoriSuggestBox');
    if (!box.innerHTML.includes('Listrik')) throw new Error('default categories should be suggested');
    if (!box.innerHTML.includes('Kategori Custom Saya')) throw new Error('previously-used custom category should also be suggested (extensible categories)');
    selectExpKategoriSuggest('Kategori Custom Saya');
    if (document.getElementById('expKategori').value !== 'Kategori Custom Saya') throw new Error('selecting suggestion should fill the input');
  });

  await step('submitExpense() builds an itemized nota (nama+qty+satuan+harga -> jumlah), like a regular transaction', async () => {
    expenses = [];
    document.getElementById('expTanggal').value = '2026-08-05';
    document.getElementById('expNama').value = 'Sabun Cair 5L';
    document.getElementById('expQty').value = '2';
    document.getElementById('expSatuan').value = 'liter';
    document.getElementById('expHarga').value = '30000';
    document.getElementById('expKategori').value = 'Deterjen & Perlengkapan';
    document.getElementById('expCatatan').value = 'Stok bulan Agustus';
    updateExpenseSubtotalPreview();
    if (document.getElementById('expJumlahPreview').textContent.indexOf('60.000') === -1 && document.getElementById('expJumlahPreview').textContent.indexOf('60,000') === -1) throw new Error('live preview should show 60.000');
    await submitExpense();
    if (expenses.length !== 1) throw new Error('expected 1 expense after submit, got ' + expenses.length);
    const e = expenses[0];
    if (e.nama !== 'Sabun Cair 5L' || e.qty !== 2 || e.harga !== 30000 || e.jumlah !== 60000) throw new Error('expense row mismatch: ' + JSON.stringify(e));
    if (document.getElementById('expNama').value !== '') throw new Error('nama field should reset after submit');
  });

  await step('submitExpense() rejects when nama is empty or qty*harga is zero', async () => {
    const before = expenses.length;
    document.getElementById('expNama').value = '';
    document.getElementById('expHarga').value = '5000';
    await submitExpense();
    if (expenses.length !== before) throw new Error('should not insert expense without nama');
    document.getElementById('expNama').value = 'Barang Gratis';
    document.getElementById('expHarga').value = '0';
    await submitExpense();
    if (expenses.length !== before) throw new Error('should not insert expense with jumlah=0');
  });

  await step('getExpPeriodeRange()/renderExpenseList() support Harian, Bulanan, and Tahunan and filter correctly', () => {
    expenses = [
      { id:'exp-in', tanggal:'2026-08-20', nama:'Gaji', qty:1, satuan:'kali', harga:500000, jumlah:500000, kategori:'Gaji Karyawan', catatan:'' },
      { id:'exp-other-day', tanggal:'2026-08-05', nama:'Token', qty:1, satuan:'kali', harga:150000, jumlah:150000, kategori:'Listrik', catatan:'' },
      { id:'exp-other-month', tanggal:'2026-07-15', nama:'Air', qty:1, satuan:'kali', harga:80000, jumlah:80000, kategori:'Air', catatan:'' },
      { id:'exp-other-year', tanggal:'2025-08-15', nama:'Sewa', qty:1, satuan:'kali', harga:1000000, jumlah:1000000, kategori:'Sewa Tempat', catatan:'' },
    ];
    document.getElementById('expPeriodeType').value = 'harian';
    document.getElementById('expHari').value = '2026-08-20';
    renderExpenseList();
    if (document.getElementById('expStTotal').textContent.indexOf('500.000') === -1 && document.getElementById('expStTotal').textContent.indexOf('500,000') === -1) throw new Error('harian filter wrong total: ' + document.getElementById('expStTotal').textContent);
    if (document.getElementById('expStCount').textContent !== '1') throw new Error('harian filter should match exactly 1 row');

    document.getElementById('expPeriodeType').value = 'bulanan';
    document.getElementById('expBulan').value = '2026-08';
    renderExpenseList();
    if (document.getElementById('expStCount').textContent !== '2') throw new Error('bulanan filter should match 2 rows (Aug), got ' + document.getElementById('expStCount').textContent);

    document.getElementById('expPeriodeType').value = 'tahunan';
    document.getElementById('expTahun').value = '2026';
    renderExpenseList();
    if (document.getElementById('expStCount').textContent !== '3') throw new Error('tahunan filter should match 3 rows (2026), got ' + document.getElementById('expStCount').textContent);
    if (!expenseReportCache || expenseReportCache.list.length !== 3) throw new Error('expenseReportCache should be populated for PDF export');
  });

  await step('deleteExpense() asks confirmation, does NOT delete when cancelled, deletes when confirmed, then "Urungkan" restores it (with items intact)', async () => {
    const originalConfirm = window.confirm;
    window.confirm = () => false;
    await deleteExpense('exp-in');
    if (!expenses.some(e => e.id === 'exp-in')) throw new Error('expense should NOT be deleted when confirm() returns false');

    window.confirm = () => true;
    await deleteExpense('exp-in');
    window.confirm = originalConfirm;
    if (expenses.some(e => e.id === 'exp-in')) throw new Error('expense should be deleted after confirming');

    const toast = document.getElementById('toast');
    const btn = toast.querySelector('.toast-action');
    if (!btn || btn.textContent !== 'Urungkan') throw new Error('deleteExpense toast missing Urungkan action');
    btn.onclick();
    await new Promise(r => setTimeout(r, 150));
    const restored = expenses.find(e => e.kategori === 'Gaji Karyawan' && e.jumlah === 500000);
    if (!restored) throw new Error('expense not restored by Urungkan');
    if (restored.nama !== 'Gaji' || restored.qty !== 1) throw new Error('undo should restore full itemized row, got ' + JSON.stringify(restored));
  });

  // --- Laba Rugi: per bulan & per tahun, dengan rincian per kategori ---
  await step('renderLabaRugi() (Bulanan) computes Pendapatan Bersih = pemasukan (omzet) - pengeluaran, with a kategori breakdown', () => {
    transactions = [
      { id:'t1', kode:'TX-1', nama:'Budi', hp:'', tanggal:'2026-08-10', estimasi:null, items:[], diskon:0, total:300000, dp:300000, status:'lunas', catatan:'' },
    ];
    expenses = [
      { id:'exp-a', tanggal:'2026-08-05', nama:'Token', qty:1, satuan:'kali', harga:150000, jumlah:150000, kategori:'Listrik', catatan:'' },
      { id:'exp-b', tanggal:'2026-08-20', nama:'Gaji', qty:1, satuan:'kali', harga:500000, jumlah:500000, kategori:'Gaji Karyawan', catatan:'' },
    ];
    document.getElementById('lrPeriodeType').value = 'bulanan';
    document.getElementById('lrBulan').value = '2026-08';
    renderLabaRugi();
    const pemasukan = document.getElementById('lrPemasukan').textContent;
    const pengeluaran = document.getElementById('lrPengeluaran').textContent;
    const labaRugi = document.getElementById('lrLabaRugi').textContent;
    if (!pemasukan.includes('300.000') && !pemasukan.includes('300,000')) throw new Error('expected pemasukan 300.000, got ' + pemasukan);
    if (!pengeluaran.includes('650.000') && !pengeluaran.includes('650,000')) throw new Error('expected pengeluaran 650.000, got ' + pengeluaran);
    if (!labaRugi.startsWith('Rugi') || (!labaRugi.includes('350.000') && !labaRugi.includes('350,000'))) throw new Error('expected "Rugi Rp350.000", got ' + labaRugi);
    const breakdown = document.getElementById('lrBreakdown').innerHTML;
    if (!breakdown.includes('Gaji Karyawan') || !breakdown.includes('Listrik')) throw new Error('kategori breakdown missing entries: ' + breakdown);
    if (!labaRugiCache) throw new Error('labaRugiCache should be populated for PDF export');
  });

  await step('renderLabaRugi() (Tahunan) aggregates the whole year and shows "Untung" (profit) in green', () => {
    transactions = [
      { id:'t2', kode:'TX-2', nama:'Sari', hp:'', tanggal:'2026-03-12', estimasi:null, items:[], diskon:0, total:900000, dp:900000, status:'lunas', catatan:'' },
      { id:'t3', kode:'TX-3', nama:'Rudi', hp:'', tanggal:'2026-11-01', estimasi:null, items:[], diskon:0, total:400000, dp:400000, status:'lunas', catatan:'' },
    ];
    expenses = [
      { id:'exp-c', tanggal:'2026-01-05', nama:'Token', qty:1, satuan:'kali', harga:150000, jumlah:150000, kategori:'Listrik', catatan:'' },
      { id:'exp-old', tanggal:'2025-12-31', nama:'Token Lama', qty:1, satuan:'kali', harga:99999, jumlah:99999, kategori:'Listrik', catatan:'' },
    ];
    document.getElementById('lrPeriodeType').value = 'tahunan';
    document.getElementById('lrTahun').value = '2026';
    renderLabaRugi();
    const pemasukan = document.getElementById('lrPemasukan').textContent;
    const labaRugi = document.getElementById('lrLabaRugi').textContent;
    if (!pemasukan.includes('1.300.000') && !pemasukan.includes('1,300,000')) throw new Error('expected yearly pemasukan 1.300.000 (900k+400k), got ' + pemasukan);
    if (!labaRugi.startsWith('Untung') || (!labaRugi.includes('1.150.000') && !labaRugi.includes('1,150,000'))) throw new Error('expected "Untung Rp1.150.000", got ' + labaRugi);
  });

  await step('renderReport()/renderPerPelangganReport() count a Tempo customer\'s still-running (unpaid) tab in "Belum Lunas", even with zero transactions rows', () => {
    outlets = []; currentOutletId = null; reportOutletFilter = '';
    transactions = [
      { id:'paid-1', kode:'TX-PAID', nama:'Fitri/ Azkiya', hp:'0812', tanggal:'2026-08-05', estimasi:null, items:[], diskon:0, total:50000, dp:50000, status:'lunas', catatan:'', outletId:null },
    ];
    const tempoUnpaid = { id:'sub-tempo-unpaid', nama:'Fitri/ Azkiya', hp:'0812', paketNama:'Tempo (Bayar Nanti)', hargaPaket:0, hargaLebihKg:0, kuotaKg:0, tanggalMulai:'2026-08-01', tanggalSelesai:'2026-08-01', status:'aktif', statusBayar:'belum', dp:0, lunasAt:null, transactionId:null, terpakai:0, outletId:null };
    subscriptions = [tempoUnpaid];
    allWorkUsage = [
      { id:'wu1', subscriptionId:'sub-tempo-unpaid', tanggal:'2026-08-24', estimasi:null, type:'layanan_tambahan', layananNama:'Cuci setrika super ekspress', qty:5.54, satuan:'kg', harga:15000, subtotal:83100, workStatus:'belum', batchId:'b-unpaid' },
      { id:'wu2', subscriptionId:'sub-tempo-unpaid', tanggal:'2026-08-24', estimasi:null, type:'layanan_tambahan', layananNama:'handuk', qty:1, satuan:'pcs', harga:5000, subtotal:5000, workStatus:'belum', batchId:'b-unpaid' },
    ];

    // subscriptionOutstanding() must read live from allWorkUsage (no dp paid, no excess-kuota component for Tempo).
    if (subscriptionOutstanding(tempoUnpaid) !== 88100) throw new Error('expected outstanding 88100, got ' + subscriptionOutstanding(tempoUnpaid));

    // Main monthly Laporan: the running Tempo tab must count in "Belum Lunas" for the current month.
    document.getElementById('reportMonth').value = '2026-08';
    renderReport();
    const stBelum = document.getElementById('stBelum').textContent;
    if (!stBelum.includes('88.100')) throw new Error('main Laporan "Belum Lunas" should include the running Tempo tab (88.100): ' + stBelum);
    const stTrx = document.getElementById('stTrx').textContent;
    if (stTrx !== '1') throw new Error('main Laporan "Jumlah Transaksi" should still be 1 (only the real paid transaction; running tab is not a `transactions` row): ' + stTrx);

    // Laporan Per Pelanggan: pick the same customer, must show BOTH a "Lunas" section (the paid transaction)
    // AND a "Belum Lunas" section (the 2 Tempo visits merged into 1 transaction, as fixed earlier), as two
    // distinct parts, matching the user's explicit ask.
    populatePerNamaSelect();
    const opts = Array.from(document.getElementById('perNama').options).map(o=>o.value);
    if (!opts.includes('Fitri/ Azkiya')) throw new Error('Laporan Per Pelanggan customer dropdown missing the Tempo customer: ' + JSON.stringify(opts));
    document.getElementById('perNama').value = 'Fitri/ Azkiya';
    document.getElementById('perPeriodeType').value = 'custom';
    togglePerPeriodeFields();
    document.getElementById('perDari').value = '2026-01-01';
    document.getElementById('perSampai').value = '2026-12-31';
    renderPerPelangganReport();

    const perStBelum = document.getElementById('perStBelum').textContent;
    if (!perStBelum.includes('88.100')) throw new Error('Laporan Per Pelanggan "Belum Lunas" should include the running Tempo tab: ' + perStBelum);
    const perStLunas = document.getElementById('perStLunas').textContent;
    if (!perStLunas.includes('50.000')) throw new Error('Laporan Per Pelanggan "Sudah Lunas" should only count the real paid transaction: ' + perStLunas);
    const perStTrx = document.getElementById('perStTrx').textContent;
    if (perStTrx !== '2') throw new Error('expected Jumlah Transaksi 2 (1 paid + 1 merged unpaid Tempo transaction), got ' + perStTrx);

    const html = document.getElementById('perResultList').innerHTML;
    if (!html.includes(t('Lunas')) || !html.includes(t('Belum Lunas'))) throw new Error('per-customer report must render two distinct sections, Lunas and Belum Lunas: ' + html);
    if ((html.match(/•/g)||[]).length !== 2) throw new Error('the 2 Tempo visits (same batch) must appear merged with 2 bullet lines under Belum Lunas: ' + html);
    if (!html.includes('88.100')) throw new Error('merged Tempo transaction total not shown in Belum Lunas section: ' + html);
    if (!html.includes(t('Sisa Tagihan Saat Ini'))) throw new Error('missing the "Sisa Tagihan Saat Ini" subtotal row for the running Tempo tab: ' + html);
  });

  // Regression: reported live -- a partially-paid "Belum Lunas" transaction showed its per-line amount
  // in the itemized breakdown as the FULL total (trx.total) instead of the actual outstanding balance
  // (total-dp), so it visually disagreed with the correct "Belum Lunas" summary card right above it
  // (which already used total-trxCashReceived(t)). Same bug existed in the PDF export's row for it.
  await step('renderPerPelangganReport(): baris rincian "Belum Lunas" per transaksi menampilkan sisa (total-dp) yang belum dibayar, bukan total penuh -- harus sinkron dengan kartu ringkasan di atasnya', () => {
    outlets = []; currentOutletId = null; reportOutletFilter = '';
    subscriptions = []; allWorkUsage = [];
    transactions = [
      { id:'b1', kode:'LND-B1', nama:'Abid', hp:'', tanggal:'2026-09-11', estimasi:null, items:[], diskon:0, total:81000, dp:30000, status:'belum', catatan:'', outletId:null },
    ];
    populatePerNamaSelect();
    document.getElementById('perNama').value = 'Abid';
    document.getElementById('perPeriodeType').value = 'custom';
    togglePerPeriodeFields();
    document.getElementById('perDari').value = '2026-01-01';
    document.getElementById('perSampai').value = '2026-12-31';
    renderPerPelangganReport();

    const perStBelum = document.getElementById('perStBelum').textContent;
    if (!perStBelum.includes('51.000')) throw new Error('kartu ringkasan "Belum Lunas" seharusnya 51.000 (81000-30000), got ' + perStBelum);

    const html = document.getElementById('perResultList').innerHTML;
    if (!html.includes('51.000')) throw new Error('BUG: baris rincian di bawah "Belum Lunas" seharusnya menampilkan sisa 51.000 (total-dp), bukan total penuh -- tidak sinkron dengan kartu ringkasan di atas: ' + html);
    if (html.includes('81.000')) throw new Error('baris rincian tidak boleh menampilkan total penuh (81.000) untuk transaksi yang sudah sebagian dibayar: ' + html);
  });

  await step('trxCashReceived() reflects actual cash received (dp), not the gross order total, for both lunas and belum-lunas transactions', () => {
    const lunasFull = { total:100000, dp:100000, status:'lunas' };
    const lunasOverpaid = { total:100000, dp:120000, status:'lunas' };
    const belumZero = { total:100000, dp:0, status:'belum' };
    const belumPartial = { total:100000, dp:30000, status:'belum' };
    if (trxCashReceived(lunasFull) !== 100000) throw new Error('lunas (exact) should be 100000, got ' + trxCashReceived(lunasFull));
    if (trxCashReceived(lunasOverpaid) !== 120000) throw new Error('lunas (overpaid) should be 120000, got ' + trxCashReceived(lunasOverpaid));
    if (trxCashReceived(belumZero) !== 0) throw new Error('belum with no DP should be 0, got ' + trxCashReceived(belumZero));
    if (trxCashReceived(belumPartial) !== 30000) throw new Error('belum with partial DP should be 30000, got ' + trxCashReceived(belumPartial));
  });

  await step('renderReport() "Sudah Lunas" includes DP already collected on still-unpaid transactions, so it reconciles with Total Omzet (Lunas + Belum Lunas = Omzet)', () => {
    outlets = []; currentOutletId = null; reportOutletFilter = '';
    subscriptions = []; allWorkUsage = [];
    transactions = [
      { id:'rk1', kode:'RK-1', nama:'Andi', hp:'', tanggal:'2026-08-05', estimasi:null, items:[], diskon:0, total:100000, dp:100000, status:'lunas', catatan:'', outletId:null },
      { id:'rk2', kode:'RK-2', nama:'Budi', hp:'', tanggal:'2026-08-06', estimasi:null, items:[], diskon:0, total:200000, dp:50000, status:'belum', catatan:'', outletId:null },
      { id:'rk3', kode:'RK-3', nama:'Citra', hp:'', tanggal:'2026-08-07', estimasi:null, items:[], diskon:0, total:80000, dp:0, status:'belum', catatan:'', outletId:null },
    ];
    document.getElementById('reportMonth').value = '2026-08';
    renderReport();
    const omzetTxt = document.getElementById('stOmzet').textContent;
    const lunasTxt = document.getElementById('stLunas').textContent;
    const belumTxt = document.getElementById('stBelum').textContent;
    // Omzet (gross) unchanged: 100000+200000+80000 = 380000.
    if (!omzetTxt.includes('380.000')) throw new Error('Total Omzet should stay gross (380.000): ' + omzetTxt);
    // Sudah Lunas must now include the 50.000 DP already collected on rk2 (still "belum"): 100000+50000 = 150000.
    if (!lunasTxt.includes('150.000')) throw new Error('Sudah Lunas should be 150.000 (100.000 lunas + 50.000 DP collected on an unpaid transaction), got: ' + lunasTxt);
    // Belum Lunas = outstanding receivable: (200000-50000) + (80000-0) = 230000.
    if (!belumTxt.includes('230.000')) throw new Error('Belum Lunas should be 230.000, got: ' + belumTxt);
    // Reconciliation identity: Lunas + Belum harus = Omzet (dasar akuntansi: omzet = kas diterima + piutang).
    const parseRp = (s) => parseInt(s.replace(/[^0-9]/g,''), 10);
    if (parseRp(lunasTxt) + parseRp(belumTxt) !== parseRp(omzetTxt)) {
      throw new Error(`Sudah Lunas + Belum Lunas must equal Total Omzet: ${lunasTxt} + ${belumTxt} != ${omzetTxt}`);
    }
  });

  await step('renderLabaRugi() computes Pemasukan from cash actually received, not gross omzet -- an unpaid transaction must NOT inflate "Untung"', () => {
    outlets = []; currentOutletId = null; reportOutletFilter = '';
    transactions = [
      { id:'lr1', kode:'LR-1', nama:'Dedi', hp:'', tanggal:'2026-08-10', estimasi:null, items:[], diskon:0, total:1000000, dp:0, status:'belum', catatan:'', outletId:null },
    ];
    expenses = [];
    document.getElementById('lrPeriodeType').value = 'bulanan';
    document.getElementById('lrBulan').value = '2026-08';
    renderLabaRugi();
    const pemasukan = document.getElementById('lrPemasukan').textContent;
    const labaRugi = document.getElementById('lrLabaRugi').textContent;
    if (!pemasukan.includes('Rp0')) throw new Error('Pemasukan must be Rp0 when the only transaction is fully unpaid (no cash received yet), got: ' + pemasukan);
    if (!labaRugi.startsWith(t('Rugi')) && !labaRugi.includes('Rp0')) throw new Error('with zero cash received and zero expenses, Laba Rugi must not show a profit from an unpaid order: ' + labaRugi);
  });

  await step('nextKode() uses the database sequence (next_transaction_kode RPC) when available, and falls back to the old array-length scheme only when it is not', async () => {
    const originalRpc = sb.rpc;
    sb.rpc = async (name) => name === 'next_transaction_kode' ? { data: 'LND-0042', error: null } : { data: null, error: { message: 'unknown rpc' } };
    const kode1 = await nextKode();
    if (kode1 !== 'LND-0042') throw new Error('expected nextKode() to use the RPC-provided value LND-0042, got ' + kode1);

    sb.rpc = async () => ({ data: null, error: { message: 'function next_transaction_kode() does not exist' } });
    transactions = [{ id:'x1' }, { id:'x2' }];
    const kode2 = await nextKode();
    if (kode2 !== 'LND-0003') throw new Error('expected nextKode() to fall back to LND-0003 (transactions.length+1) when the RPC is unavailable, got ' + kode2);

    sb.rpc = originalRpc;
  });

  // --- Peringkat Pemasukan Pelanggan: urut dari paling banyak bayar ---
  await step('renderPeringkatPelanggan() ranks customers by total paid, descending', () => {
    transactions = [
      { id:'r1', kode:'R-1', nama:'Kecil', hp:'', tanggal:'2026-08-02', estimasi:null, items:[], diskon:0, total:20000, dp:20000, status:'lunas', catatan:'' },
      { id:'r2', kode:'R-2', nama:'Besar', hp:'', tanggal:'2026-08-03', estimasi:null, items:[], diskon:0, total:500000, dp:500000, status:'lunas', catatan:'' },
      { id:'r3', kode:'R-3', nama:'Besar', hp:'', tanggal:'2026-08-15', estimasi:null, items:[], diskon:0, total:100000, dp:100000, status:'lunas', catatan:'' },
      { id:'r4', kode:'R-4', nama:'Sedang', hp:'', tanggal:'2026-08-20', estimasi:null, items:[], diskon:0, total:200000, dp:200000, status:'lunas', catatan:'' },
    ];
    document.getElementById('rankPeriodeType').value = 'bulanan';
    document.getElementById('rankBulan').value = '2026-08';
    renderPeringkatPelanggan();
    if (!peringkatPelangganCache) throw new Error('peringkatPelangganCache should be populated');
    const ranked = peringkatPelangganCache.ranked;
    if (ranked[0].nama !== 'Besar' || ranked[0].total !== 600000 || ranked[0].count !== 2) throw new Error('expected Besar first with 600.000 total across 2 trx, got ' + JSON.stringify(ranked[0]));
    if (ranked[1].nama !== 'Sedang' || ranked[2].nama !== 'Kecil') throw new Error('ranking order wrong: ' + JSON.stringify(ranked.map(r=>r.nama)));
    const html = document.getElementById('rankList').innerHTML;
    if (html.indexOf('Besar') > html.indexOf('Sedang') || html.indexOf('Sedang') > html.indexOf('Kecil')) throw new Error('rendered list not in descending order: ' + html);
  });

  // --- Multi-Outlet (opt-in): tanpa outlet, app harus jalan persis seperti sebelumnya ---
  await step('Multi-outlet is fully opt-in: with zero outlets, submitTransaction() sends no outlet_id and visibleTransactions()/visibleSubscriptions()/visibleExpenses() return everything unfiltered', async () => {
    outlets = []; currentOutletId = null;
    transactions = []; subscriptions = [tempoSub, bulananSub]; expenses = [];
    let capturedInsertPayload = null;
    const originalFrom = sb.from;
    sb.from = (table) => {
      const q = originalFrom(table);
      if (table === 'transactions') {
        const origInsert = q.insert.bind(q);
        q.insert = (row) => { capturedInsertPayload = row; return origInsert(row); };
      }
      return q;
    };
    document.getElementById('inNama').value = 'Uji Tanpa Outlet';
    document.getElementById('inHP').value = '';
    draftItems = [{ nama:'Cuci', qty:1, satuan:'kg', harga:5000, subtotal:5000 }];
    document.getElementById('inDiskon').value = '0';
    document.getElementById('inDP').value = '0';
    document.getElementById('inStatus').value = 'belum';
    // Tanggal dipatok manual (bukan ikut todayISO()) supaya test Laporan bulan Agustus
    // di bawah tidak tergantung jam sistem asli saat suite ini dijalankan.
    document.getElementById('inTanggal').value = '2026-08-18';
    await submitTransaction();
    document.getElementById('inTanggal').value = '';
    sb.from = originalFrom;
    if (!capturedInsertPayload) throw new Error('expected submitTransaction() to insert a transaction row');
    if ('outlet_id' in capturedInsertPayload) throw new Error('outlet_id key should be entirely absent from the insert payload when no outlets exist (avoids breaking un-migrated databases): ' + JSON.stringify(capturedInsertPayload));
    if (visibleTransactions().length !== transactions.length) throw new Error('visibleTransactions() should return everything when outlets.length===0');
    if (visibleSubscriptions().length !== subscriptions.length) throw new Error('visibleSubscriptions() should return everything when outlets.length===0');
    if (visibleExpenses().length !== expenses.length) throw new Error('visibleExpenses() should return everything when outlets.length===0');
    const wrap = document.getElementById('outletSwitcherWrap');
    if (wrap.style.display !== 'none') throw new Error('outlet switcher badge should stay hidden when there are no outlets');
  });

  await step('addOutlet() creates an outlet via Supabase, auto-selects it as currentOutletId, and shows it in the manager list', async () => {
    outlets = []; currentOutletId = null;
    document.getElementById('outletNama').value = 'Cabang Fatmawati';
    document.getElementById('outletAlamat').value = 'Jl. Fatmawati No. 5';
    document.getElementById('outletTelp').value = '0812111';
    await addOutlet();
    if (outlets.length !== 1 || outlets[0].nama !== 'Cabang Fatmawati') throw new Error('expected outlet to be added: ' + JSON.stringify(outlets));
    if (!currentOutletId || currentOutletId !== String(outlets[0].id)) throw new Error('the first outlet created should be auto-selected as currentOutletId');
    if (document.getElementById('outletNama').value !== '') throw new Error('form fields should reset after adding');
    const listHtml = document.getElementById('outletManagerList').innerHTML;
    if (!listHtml.includes('Cabang Fatmawati') || !listHtml.includes('Jl. Fatmawati No. 5')) throw new Error('outlet manager list missing the new outlet: ' + listHtml);
    if (document.getElementById('outletSwitcherWrap').style.display === 'none') throw new Error('outlet switcher badge should appear once an outlet exists');

    document.getElementById('outletNama').value = 'Cabang Kemang';
    await addOutlet();
    if (outlets.length !== 2) throw new Error('expected 2 outlets after adding a second one');
  });

  await step('submitTransaction()/createSubscription()/submitExpense() tag the new row with the current outlet_id when one is active', async () => {
    const outletA = outlets[0].id, outletB = outlets[1].id;
    switchOutlet(outletA);

    document.getElementById('inNama').value = 'Pelanggan Outlet A';
    document.getElementById('inHP').value = '';
    draftItems = [{ nama:'Cuci', qty:1, satuan:'kg', harga:7000, subtotal:7000 }];
    document.getElementById('inDiskon').value = '0'; document.getElementById('inDP').value = '0'; document.getElementById('inStatus').value = 'belum';
    // Sama seperti "Uji Tanpa Outlet" di atas: tanggal dipatok manual, bukan todayISO(),
    // supaya test Laporan bulan Agustus di bawah tidak tergantung jam sistem asli.
    document.getElementById('inTanggal').value = '2026-08-19';
    await submitTransaction();
    document.getElementById('inTanggal').value = '';
    const trxA = transactions.find(t=>t.nama==='Pelanggan Outlet A');
    if (!trxA || trxA.outletId !== String(outletA)) throw new Error('new transaction should be tagged with the active outlet: ' + JSON.stringify(trxA));

    // createSubscription() re-fetches via loadSubscriptionsFromDB() after inserting, which in this
    // test harness has no stateful backing store for the "subscriptions" table (it's not one of the
    // fake*Query() mocks — every other Papan/Tempo test drives `subscriptions` directly instead) — so
    // capture the actual insert payload here rather than relying on that round-trip.
    let capturedSubsInsert = null;
    const originalFrom2 = sb.from;
    sb.from = (table) => {
      const q = originalFrom2(table);
      if (table === 'subscriptions') {
        const origInsert = q.insert.bind(q);
        q.insert = (row) => { capturedSubsInsert = row; return origInsert(row); };
      }
      return q;
    };
    document.getElementById('subsNama').value = 'Sub Outlet A';
    document.getElementById('subsHP').value = '';
    document.getElementById('subsTanggalMulai').value = '2026-08-01';
    document.getElementById('subsTipe').value = 'tempo';
    editingSubscriptionId = null;
    await createSubscription();
    sb.from = originalFrom2;
    if (!capturedSubsInsert || capturedSubsInsert.nama !== 'Sub Outlet A') throw new Error('expected createSubscription() to insert a new tempo subscription: ' + JSON.stringify(capturedSubsInsert));
    if (capturedSubsInsert.outlet_id !== String(outletA)) throw new Error('new subscription should be tagged with the active outlet: ' + JSON.stringify(capturedSubsInsert));
    // loadSubscriptionsFromDB() dipanggil createSubscription() lalu menimpa `subscriptions` jadi kosong
    // (backing store fake-nya statis) — pulihkan manual supaya test berikutnya masih bisa memakainya.
    const subA = { id:'sub-outlet-a', nama:'Sub Outlet A', hp:'', paketNama:'Tempo (Bayar Nanti)', hargaPaket:0, hargaLebihKg:0, kuotaKg:0, tanggalMulai:'2026-08-01', tanggalSelesai:'2026-08-01', status:'aktif', statusBayar:'belum', dp:0, lunasAt:null, transactionId:null, terpakai:0, outletId: String(outletA) };
    subscriptions = [subA];

    switchOutlet(outletB);
    document.getElementById('expTanggal').value = '2026-08-10';
    document.getElementById('expNama').value = 'Listrik Outlet B';
    document.getElementById('expQty').value = '1';
    document.getElementById('expHarga').value = '150000';
    document.getElementById('expKategori').value = 'Listrik';
    await submitExpense();
    const expB = expenses.find(e=>e.nama==='Listrik Outlet B');
    if (!expB || expB.outletId !== String(outletB)) throw new Error('new expense should be tagged with the active outlet: ' + JSON.stringify(expB));
  });

  await step('renderHistory()/renderExpenseList() filter to the currently active outlet, and switchOutlet() persists the choice to localStorage', async () => {
    const outletA = outlets[0].id, outletB = outlets[1].id;
    switchOutlet(outletA);
    if (localStorage.getItem('nk_lastOutletId') !== String(outletA)) throw new Error('switchOutlet() should persist the choice to localStorage');
    renderHistory();
    let html = document.getElementById('historyList').innerHTML;
    if (!html.includes('Pelanggan Outlet A')) throw new Error('Riwayat at Outlet A should show its own transaction: ' + html);
    if (html.includes('Pelanggan Outlet B') || html.includes('Uji Tanpa Outlet')) throw new Error('Riwayat at Outlet A should NOT show another outlet\'s transaction: ' + html);

    switchOutlet(outletB);
    if (localStorage.getItem('nk_lastOutletId') !== String(outletB)) throw new Error('switching again should update the persisted outlet');
    renderExpenseList();
    document.getElementById('expBulan').value = '2026-08';
    document.getElementById('expPeriodeType').value = 'bulanan';
    renderExpenseList();
    html = document.getElementById('expenseList').innerHTML;
    if (!html.includes('Listrik Outlet B')) throw new Error('Pengeluaran at Outlet B should show its own expense: ' + html);
  });

  await step('Riwayat: filter Status (Lunas/Belum Lunas) dan Periode (Dari/Sampai Tanggal) menyaring daftar transaksi, dan tombol "Bersihkan Filter" cuma tampil saat ada filter aktif', () => {
    const savedTransactions = transactions;
    const savedOutlets = outlets;
    const savedOutletId = currentOutletId;
    outlets = []; currentOutletId = null;
    transactions = [
      { id:'f1', kode:'F1', nama:'Filter Lunas Awal', hp:'', tanggal:'2026-08-01', estimasi:null, items:[], diskon:0, total:10000, dp:10000, status:'lunas', catatan:'' },
      { id:'f2', kode:'F2', nama:'Filter Belum Tengah', hp:'', tanggal:'2026-08-15', estimasi:null, items:[], diskon:0, total:20000, dp:0, status:'belum', catatan:'' },
      { id:'f3', kode:'F3', nama:'Filter Lunas Akhir', hp:'', tanggal:'2026-08-28', estimasi:null, items:[], diskon:0, total:30000, dp:30000, status:'lunas', catatan:'' },
    ];
    try {
      document.getElementById('searchInput').value = '';
      document.getElementById('historyStatusFilter').value = '';
      document.getElementById('historyDariFilter').value = '';
      document.getElementById('historySampaiFilter').value = '';
      renderHistory();
      if (document.getElementById('historyResetFilterBtn').style.display !== 'none') throw new Error('tombol Bersihkan Filter tidak boleh tampil kalau belum ada filter aktif');
      let html = document.getElementById('historyList').innerHTML;
      if (!html.includes('Filter Lunas Awal') || !html.includes('Filter Belum Tengah') || !html.includes('Filter Lunas Akhir')) throw new Error('tanpa filter, ketiga transaksi harus tampil: ' + html);

      document.getElementById('historyStatusFilter').value = 'lunas';
      renderHistory();
      if (document.getElementById('historyResetFilterBtn').style.display === 'none') throw new Error('tombol Bersihkan Filter harus tampil begitu status difilter');
      html = document.getElementById('historyList').innerHTML;
      if (html.includes('Filter Belum Tengah')) throw new Error('filter status Lunas tidak boleh ikut menampilkan transaksi Belum Lunas: ' + html);
      if (!html.includes('Filter Lunas Awal') || !html.includes('Filter Lunas Akhir')) throw new Error('filter status Lunas harus tetap menampilkan kedua transaksi Lunas: ' + html);

      document.getElementById('historyStatusFilter').value = '';
      document.getElementById('historyDariFilter').value = '2026-08-10';
      document.getElementById('historySampaiFilter').value = '2026-08-20';
      renderHistory();
      html = document.getElementById('historyList').innerHTML;
      if (!html.includes('Filter Belum Tengah')) throw new Error('filter periode 10-20 Agu harus menampilkan transaksi tanggal 15 Agu: ' + html);
      if (html.includes('Filter Lunas Awal') || html.includes('Filter Lunas Akhir')) throw new Error('filter periode 10-20 Agu tidak boleh menampilkan transaksi di luar rentang itu: ' + html);

      resetHistoryFilter();
      if (document.getElementById('historyStatusFilter').value !== '' || document.getElementById('historyDariFilter').value !== '' || document.getElementById('historySampaiFilter').value !== '') throw new Error('resetHistoryFilter() harus mengosongkan semua field filter');
      if (document.getElementById('historyResetFilterBtn').style.display !== 'none') throw new Error('tombol Bersihkan Filter harus sembunyi lagi setelah di-reset');
      html = document.getElementById('historyList').innerHTML;
      if (!html.includes('Filter Lunas Awal') || !html.includes('Filter Belum Tengah') || !html.includes('Filter Lunas Akhir')) throw new Error('setelah reset, ketiga transaksi harus tampil lagi: ' + html);
    } finally {
      transactions = savedTransactions;
      outlets = savedOutlets;
      currentOutletId = savedOutletId;
      document.getElementById('historyStatusFilter').value = '';
      document.getElementById('historyDariFilter').value = '';
      document.getElementById('historySampaiFilter').value = '';
    }
  });

  await step('buildAllWorkItemsRaw()/Daftar Tugas only includes cucian belonging to the active outlet, for both direct transactions and Paket/Tempo customers linked via subscriptions', async () => {
    const outletA = outlets[0].id, outletB = outlets[1].id;
    const subA = subscriptions.find(s=>s.nama==='Sub Outlet A');
    subA.outletId = String(outletA);
    allWorkUsage = [
      { id:'au-outlet-a', subscriptionId: subA.id, tanggal:'2026-08-20', estimasi:null, type:'layanan_tambahan', layananNama:'Cuci Kilat', qty:1, satuan:'kg', harga:9000, subtotal:9000, workStatus:'belum' },
    ];
    switchOutlet(outletA);
    let items = buildAllWorkItemsRaw();
    if (!items.some(it=>it.nama==='Pelanggan Outlet A')) throw new Error('Daftar Tugas at Outlet A should include its own transaction');
    if (!items.some(it=>it.nama==='Sub Outlet A')) throw new Error('Daftar Tugas at Outlet A should include the linked Tempo customer\'s kerjaan');
    if (items.some(it=>it.nama==='Pelanggan Outlet B')) throw new Error('Daftar Tugas at Outlet A should NOT include Outlet B\'s transaction');

    switchOutlet(outletB);
    items = buildAllWorkItemsRaw();
    if (items.some(it=>it.nama==='Sub Outlet A')) throw new Error('Daftar Tugas at Outlet B should NOT include Outlet A\'s Tempo customer kerjaan');
    if (items.some(it=>it.nama==='Pelanggan Outlet A')) throw new Error('Daftar Tugas at Outlet B should NOT include Outlet A\'s regular transaction either');
  });

  await step('Laporan outlet filter (reportOutletFilter) is independent from the operational outlet switcher, defaults to "Semua Outlet", and can be narrowed to one outlet', async () => {
    const outletA = outlets[0].id, outletB = outlets[1].id;
    switchOutlet(outletA); // konteks operasional aktif di A...
    populateReportOutletFilter();
    if (document.getElementById('reportOutletFilterSelect').value !== '') throw new Error('report filter should default to "" (Semua Outlet) regardless of the active operational outlet');
    if (document.getElementById('reportOutletFilterWrap').style.display === 'none') throw new Error('report outlet filter should be visible once outlets exist');
    document.getElementById('reportMonth').value = '2026-08';
    renderReport();
    let html = document.getElementById('reportList').innerHTML;
    // "Uji Tanpa Outlet" (outletId null) + "Pelanggan Outlet A" (outletId outletA) harus dua-duanya
    // muncul di "Semua Outlet", membuktikan Laporan menggabungkan lintas outlet (dan yang tanpa outlet).
    if (!html.includes('Uji Tanpa Outlet') || !html.includes('Pelanggan Outlet A')) throw new Error('...tapi Laporan "Semua Outlet" tetap harus menggabungkan transaksi semua outlet (termasuk yang belum punya outlet): ' + html);

    document.getElementById('reportOutletFilterSelect').value = String(outletA);
    onReportOutletFilterChange();
    html = document.getElementById('reportList').innerHTML;
    if (html.includes('Uji Tanpa Outlet')) throw new Error('Laporan yang dipersempit ke Outlet A tidak boleh menampilkan transaksi yang tidak terkait outlet manapun: ' + html);
    if (!html.includes('Pelanggan Outlet A')) throw new Error('Laporan yang dipersempit ke Outlet A harus tetap menampilkan transaksi Outlet A: ' + html);
    document.getElementById('reportOutletFilterSelect').value = '';
    onReportOutletFilterChange();
  });

  await step('notaHeaderInfo()/nota builders (WA text, PDF lines, receipt HTML) use the outlet\'s own alamat/telp when the transaction has one, and fall back to the global toko settings otherwise', async () => {
    const outletA = outlets[0].id, outletB = outlets[1].id;
    // outletA (Cabang Fatmawati) punya alamat/telp sendiri; outletB (Cabang Kemang) tidak.
    const hdrA = notaHeaderInfo(outletA);
    if (hdrA.nama !== 'Laundry Uji') throw new Error('notaHeaderInfo() nama should always come from global shopName: ' + JSON.stringify(hdrA));
    if (hdrA.subtitle !== 'Cabang Fatmawati') throw new Error('notaHeaderInfo() subtitle should be the outlet\'s own nama: ' + JSON.stringify(hdrA));
    if (hdrA.alamat !== 'Jl. Fatmawati No. 5') throw new Error('notaHeaderInfo() should use the outlet\'s own alamat: ' + JSON.stringify(hdrA));
    if (hdrA.telp !== '0812111') throw new Error('notaHeaderInfo() should use the outlet\'s own telp: ' + JSON.stringify(hdrA));

    const hdrB = notaHeaderInfo(outletB);
    if (hdrB.subtitle !== 'Cabang Kemang') throw new Error('notaHeaderInfo() subtitle should still be the outlet\'s nama even without its own alamat/telp: ' + JSON.stringify(hdrB));
    if (hdrB.alamat !== settings.address || hdrB.telp !== settings.phone) throw new Error('notaHeaderInfo() should fall back to global settings.address/phone when the outlet has none of its own: ' + JSON.stringify(hdrB));

    const hdrNone = notaHeaderInfo(null);
    if (hdrNone.subtitle !== '') throw new Error('notaHeaderInfo(null) should have no outlet subtitle: ' + JSON.stringify(hdrNone));
    if (hdrNone.alamat !== settings.address || hdrNone.telp !== settings.phone) throw new Error('notaHeaderInfo(null) should use global settings.address/phone: ' + JSON.stringify(hdrNone));

    const trxA = transactions.find(t=>t.nama==='Pelanggan Outlet A');
    if (!trxA) throw new Error('expected the earlier "Pelanggan Outlet A" transaction (tagged with outletA) to still exist');
    const pdfLines = buildReceiptPDFLines(trxA).map(l=>l.t).join(' | ');
    if (!pdfLines.includes('Cabang Fatmawati') || !pdfLines.includes('Jl. Fatmawati No. 5') || !pdfLines.includes('0812111')) throw new Error('buildReceiptPDFLines() should include the outlet\'s subtitle/alamat/telp: ' + pdfLines);
    const waText = receiptTextForWA(trxA);
    if (!waText.includes('Cabang Fatmawati') || !waText.includes('Jl. Fatmawati No. 5') || !waText.includes('0812111')) throw new Error('receiptTextForWA() should include the outlet\'s subtitle/alamat/telp: ' + waText);
    const html = buildReceiptHTML(trxA);
    if (!html.includes('Cabang Fatmawati') || !html.includes('Jl. Fatmawati No. 5') || !html.includes('0812111')) throw new Error('buildReceiptHTML() should include the outlet\'s subtitle/alamat/telp: ' + html);
  });

  await step('Settings modal: openSettingsSub()/closeSettingsSub() show one category panel at a time (grid <-> sub-panel), and openSettings() always resets to the grid + toggles the Admin Platform tile by ADMIN_EMAIL', async () => {
    const savedUser = currentUser, savedRole = currentRole;
    try {
      currentRole = 'owner';
      currentUser = { email: 'someone-else@example.com' };

      closeSettingsSub();
      if (document.getElementById('settingsHome').style.display === 'none') throw new Error('closeSettingsSub() should show the category grid');
      if (document.getElementById('settingsSubView').style.display !== 'none') throw new Error('closeSettingsSub() should hide the sub-panel view');

      openSettingsSub('outlet');
      if (document.getElementById('settingsHome').style.display !== 'none') throw new Error('openSettingsSub() should hide the category grid');
      if (!document.getElementById('settingsSub-outlet').classList.contains('active')) throw new Error('openSettingsSub(\'outlet\') should activate the outlet panel');
      if (!document.getElementById('settingsSubTitle').textContent.includes('Outlet')) throw new Error('the sub-panel title should reflect the opened category');

      openSettingsSub('keamanan');
      if (document.getElementById('settingsSub-outlet').classList.contains('active')) throw new Error('switching straight to another category should deactivate the previous panel (only one visible at a time)');
      if (!document.getElementById('settingsSub-keamanan').classList.contains('active')) throw new Error('openSettingsSub(\'keamanan\') should activate the keamanan panel');

      openSettings();
      if (document.getElementById('settingsHome').style.display === 'none') throw new Error('openSettings() should always reset back to the category grid, not stay on the last-opened sub-panel');
      if (document.getElementById('settingsTileAdmin').style.display !== 'none') throw new Error('the Admin Platform tile should stay hidden for a non-admin email');

      currentUser = { email: ADMIN_EMAIL };
      openSettings();
      if (document.getElementById('settingsTileAdmin').style.display === 'none') throw new Error('the Admin Platform tile should show once currentUser.email matches ADMIN_EMAIL');
    } finally {
      currentUser = savedUser;
      currentRole = savedRole;
      closeSettings();
      closeSettingsSub();
    }
  });

  await step('appBranding: saveAppBranding()/loadAppBranding() persist & reload the developer-credit footer, and every nota builder (WA text, PDF lines, HTML) reflects it instead of the old hardcoded Tinggiran Tech Studio values', async () => {
    const savedBranding = { ...appBranding };
    try {
      document.getElementById('brandNama').value = '';
      await saveAppBranding();
      if (lastAppBrandingUpsert) throw new Error('saveAppBranding() should refuse to save when Nama Pengembang is empty');

      document.getElementById('brandNama').value = 'Contoh Studio';
      document.getElementById('brandTagline').value = 'Bikin Nota Kilat';
      document.getElementById('brandWA').value = '081200000000';
      document.getElementById('brandEmail').value = 'halo@contohstudio.id';
      await saveAppBranding();
      if (!lastAppBrandingUpsert || lastAppBrandingUpsert.dev_nama !== 'Contoh Studio') throw new Error('saveAppBranding() should upsert the new branding row: ' + JSON.stringify(lastAppBrandingUpsert));
      if (appBranding.nama !== 'Contoh Studio' || appBranding.wa !== '081200000000') throw new Error('saveAppBranding() should update the in-memory appBranding immediately: ' + JSON.stringify(appBranding));

      // reset in-memory state lalu reload dari "DB" (upsert row yang barusan tersimpan) untuk buktikan round-trip-nya utuh
      appBranding = { nama:'lama', tagline:'lama', wa:'000', email:'lama@lama.id' };
      await loadAppBranding();
      if (appBranding.nama !== 'Contoh Studio' || appBranding.tagline !== 'Bikin Nota Kilat' || appBranding.email !== 'halo@contohstudio.id') throw new Error('loadAppBranding() should reload the persisted branding: ' + JSON.stringify(appBranding));

      const trxA = transactions.find(t=>t.nama==='Pelanggan Outlet A');
      const pdfText = buildReceiptPDFLines(trxA).map(l=>l.t).join(' | ');
      if (!pdfText.includes('Contoh Studio') || !pdfText.includes('081200000000') || !pdfText.includes('halo@contohstudio.id')) throw new Error('buildReceiptPDFLines() footer should reflect the updated appBranding: ' + pdfText);
      if (pdfText.includes('Tinggiran Tech Studio')) throw new Error('the old hardcoded branding should no longer appear once appBranding is changed: ' + pdfText);
      const waText = receiptTextForWA(trxA);
      if (!waText.includes('Contoh Studio') || !waText.includes('081200000000')) throw new Error('receiptTextForWA() footer should reflect the updated appBranding: ' + waText);
      const html = buildReceiptHTML(trxA);
      if (!html.includes('Contoh Studio') || !html.includes('halo@contohstudio.id') || !html.includes('wa.me/6281200000000')) throw new Error('buildReceiptHTML() footer should reflect the updated appBranding, with a normalized wa.me link: ' + html);
    } finally {
      appBranding = savedBranding;
      fillAppBrandingForm();
    }
  });

  await step('diffTransactionFields() only reports fields that actually changed (scalars, items array, and derived total), leaving unchanged fields out entirely', async () => {
    const before = { nama:'Budi', hp:'0812', tanggal:'2026-08-01', estimasi:'2026-08-02', diskon:0, dp:0, status:'belum', catatan:'', items:[{nama:'Cuci',qty:1,satuan:'kg',harga:7000,subtotal:7000}], total:7000 };
    const after = { ...before, nama:'Budi Santoso', diskon:1000, total:6000, items:[{nama:'Cuci',qty:1,satuan:'kg',harga:7000,subtotal:7000}] };
    const changes = diffTransactionFields(before, after);
    const fields = changes.map(c=>c.field);
    if (!fields.includes('nama') || !fields.includes('diskon') || !fields.includes('total')) throw new Error('expected nama/diskon/total to be reported as changed: ' + JSON.stringify(changes));
    if (fields.includes('hp') || fields.includes('tanggal') || fields.includes('items')) throw new Error('unchanged fields (hp/tanggal/items) should NOT appear in the diff: ' + JSON.stringify(changes));
    const namaChange = changes.find(c=>c.field==='nama');
    if (namaChange.from !== 'Budi' || namaChange.to !== 'Budi Santoso') throw new Error('nama diff should carry the old and new values: ' + JSON.stringify(namaChange));

    const noChanges = diffTransactionFields(before, { ...before });
    if (noChanges.length !== 0) throw new Error('identical before/after should produce an empty diff: ' + JSON.stringify(noChanges));

    const itemsChanged = diffTransactionFields(before, { ...before, items:[{nama:'Cuci Kilat',qty:1,satuan:'kg',harga:9000,subtotal:9000}], total:9000 });
    if (!itemsChanged.some(c=>c.field==='items')) throw new Error('a changed item list should be reported under field "items": ' + JSON.stringify(itemsChanged));
  });

  await step('diffSubscriptionFields() only reports identity/harga fields that actually changed, formatting rupiah fields for display', async () => {
    const before = { nama:'Ani', hp:'0813', paketNama:'Paket Reguler', hargaPaket:100000, hargaLebihKg:5000, kuotaKg:10, tanggalMulai:'2026-08-01', tanggalSelesai:'2026-09-01' };
    const after = { ...before, hargaPaket:120000, kuotaKg:12 };
    const changes = diffSubscriptionFields(before, after);
    const fields = changes.map(c=>c.field);
    if (!fields.includes('hargaPaket') || !fields.includes('kuotaKg')) throw new Error('expected hargaPaket/kuotaKg to be reported as changed: ' + JSON.stringify(changes));
    if (fields.includes('nama') || fields.includes('paketNama')) throw new Error('unchanged fields should NOT appear in the diff: ' + JSON.stringify(changes));
    const hargaChange = changes.find(c=>c.field==='hargaPaket');
    if (hargaChange.from !== 'Rp100.000' || hargaChange.to !== 'Rp120.000') throw new Error('hargaPaket diff should be formatted as rupiah: ' + JSON.stringify(hargaChange));

    const noChanges = diffSubscriptionFields(before, { ...before });
    if (noChanges.length !== 0) throw new Error('identical before/after should produce an empty diff: ' + JSON.stringify(noChanges));
  });

  await step('createSubscription() edit path writes a subscription edit-log entry reflecting the real before/after diff (harga & kuota changed)', async () => {
    const subId = 'sub-edit-test-1';
    const savedSubscriptions = subscriptions, savedCatalog = serviceCatalog, savedEditingId = editingSubscriptionId;
    try {
      subscriptions = [{ id:subId, nama:'Rina', hp:'0812', paketNama:'Paket Reguler', hargaPaket:100000, hargaLebihKg:5000, kuotaKg:10, tanggalMulai:'2026-08-01', tanggalSelesai:'2026-09-01', status:'aktif', statusBayar:'belum', dp:0, lunasAt:null, transactionId:null, terpakai:0, outletId:null }];
      editingSubscriptionId = subId;
      serviceCatalog = [{ id:'paket-reguler', type:'paket', nama:'Paket Reguler', harga:150000, hargaLebihKg:6000, kuotaKg:15 }];
      document.getElementById('subsNama').value = 'Rina';
      document.getElementById('subsHP').value = '0812';
      document.getElementById('subsTanggalMulai').value = '2026-08-01';
      document.getElementById('subsTipe').value = 'bulanan';
      populateSubsPaketSelect(); // isi <option> dari serviceCatalog & auto-pilih paket-nya + isi subsKuota (15), seperti UI aslinya

      // "subscriptions" tidak punya mock stateful (lihat catatan di test lain) — loadSubscriptionsFromDB()
      // dipanggil createSubscription() setelah update, jadi di sini di-stub supaya mengembalikan baris
      // hasil-edit yang sebenarnya, supaya alur logEditHistory()-nya jalan sungguhan, bukan cuma dilewati.
      const originalFrom = sb.from;
      sb.from = (table) => {
        if (table === 'subscriptions') {
          const q = {
            select: () => q, eq: () => q, order: () => q, update: () => q,
            then: (resolve) => resolve({ data: [{ id:subId, nama:'Rina', hp:'0812', paket_nama:'Paket Reguler', harga_paket:150000, harga_lebih_kg:6000, kuota_kg:15, tanggal_mulai:'2026-08-01', tanggal_selesai:'2026-09-01', status:'aktif', status_bayar:'belum', dp:0, lunas_at:null, transaction_id:null, outlet_id:null }], error: null }),
          };
          return q;
        }
        return originalFrom(table);
      };
      try {
        await createSubscription();
      } finally {
        sb.from = originalFrom;
      }

      await openEditHistory('subscription', subId, 'Riwayat Edit Pelanggan');
      const html = document.getElementById('editHistoryList').innerHTML;
      if (!html.includes('Harga Paket') || !html.includes('Rp100.000') || !html.includes('Rp150.000')) throw new Error('subscription edit history should show the real harga change from the DB round-trip: ' + html);
      if (!html.includes('Kuota')) throw new Error('subscription edit history should also show the kuota change: ' + html);
    } finally {
      // Beberapa test lain sesudah ini masih mengandalkan `subscriptions`/`serviceCatalog` bawaan suite
      // (mis. fixture "Sub Outlet A") — pulihkan supaya tidak ikut kepakai/ketiban step berikutnya.
      subscriptions = savedSubscriptions;
      serviceCatalog = savedCatalog;
      editingSubscriptionId = savedEditingId;
    }
  });

  await step('logEditHistory()/openEditHistory() write an edit-log row (skipping when there is nothing to log), scoped per entity_type+entity_id, and render it with editor name, timestamp, and from/to change lines', async () => {
    const savedRole = currentRole, savedEmployeeName = employeeName;
    try {
      currentRole = 'kasir';
      employeeName = 'Sari';
      await logEditHistory('transaction', 'trx-edit-test-1', []); // tidak ada perubahan -> tidak boleh menulis apa pun
      await logEditHistory('transaction', 'trx-edit-test-1', [{ field:'nama', label:'Nama Pelanggan', from:'Budi', to:'Budi Santoso' }]);
      await logEditHistory('subscription', 'trx-edit-test-1', [{ field:'hargaPaket', label:'Harga Paket', from:'Rp100.000', to:'Rp120.000' }]); // entity_type beda, id sama -> tidak boleh tercampur

      await openEditHistory('transaction', 'trx-edit-test-1', 'Riwayat Transaksi');
      let html = document.getElementById('editHistoryList').innerHTML;
      if (!html.includes('Sari')) throw new Error('edit history should show the kasir\'s employeeName as the editor: ' + html);
      if (!html.includes('Nama Pelanggan') || !html.includes('Budi') || !html.includes('Budi Santoso')) throw new Error('edit history should render the field label and from/to values: ' + html);
      if (html.includes('Harga Paket')) throw new Error('a "transaction" entity_type lookup should NOT include a "subscription" log row with the same entity_id: ' + html);
      if (document.getElementById('editHistoryModalTitle').textContent !== 'Riwayat Transaksi') throw new Error('the modal title should reflect the title passed to openEditHistory()');

      currentRole = 'owner';
      await logEditHistory('transaction', 'trx-edit-test-1', [{ field:'diskon', label:'Diskon', from:'0', to:'1000' }]);
      await openEditHistory('transaction', 'trx-edit-test-1', 'Riwayat Transaksi');
      html = document.getElementById('editHistoryList').innerHTML;
      if (!html.includes('Pemilik')) throw new Error('edit history should show "Pemilik" as the editor when currentRole is owner: ' + html);
      if ((html.match(/Diskon/g)||[]).length < 1) throw new Error('the second log entry should also be rendered: ' + html);

      await openEditHistory('transaction', 'trx-with-no-history-at-all', 'Riwayat Transaksi');
      html = document.getElementById('editHistoryList').innerHTML;
      if (!html.includes('Belum ada riwayat edit')) throw new Error('a transaction with no log rows should show the empty-state message: ' + html);
    } finally {
      currentRole = savedRole;
      employeeName = savedEmployeeName;
    }
  });

  await step('openEditHistory() shows a friendly fallback message (not a crash) when the edit_log table is not migrated yet', async () => {
    const originalFrom = sb.from;
    sb.from = (table) => {
      if (table === 'edit_log') {
        const q = { select:()=>q, eq:()=>q, order:()=>q, then:(resolve)=>resolve({ data:null, error:{ message:'relation "edit_log" does not exist' } }) };
        return q;
      }
      return originalFrom(table);
    };
    try {
      await openEditHistory('transaction', 'trx-any-id', 'Riwayat Transaksi');
      const html = document.getElementById('editHistoryList').innerHTML;
      if (!html.includes('belum dimigrasi')) throw new Error('should show a migration hint instead of crashing when the table is missing: ' + html);
    } finally {
      sb.from = originalFrom;
    }
  });

  await step('sanitizeForThermal()/escposBytesFromLines() turn nota lines into safe ESC/POS bytes: emoji/em-dash stripped, ESC @ init present, and align/bold/size commands emitted per line', async () => {
    const cleaned = sanitizeForThermal('🟢 WhatsApp — "Cepat" • Bersih ✓ 081293228520');
    if (/[\u{1F000}-\u{1FFFF}]/u.test(cleaned)) throw new Error('sanitizeForThermal() should strip emoji: ' + cleaned);
    if (cleaned.includes('—') || cleaned.includes('•')) throw new Error('sanitizeForThermal() should replace em-dash/bullet with ASCII: ' + cleaned);
    if (!cleaned.includes('WhatsApp') || !cleaned.includes('081293228520')) throw new Error('sanitizeForThermal() should keep plain ASCII content intact: ' + cleaned);

    const lines = [
      { t: 'Laundry Uji', c:true, b:true, s:12 },
      { t: 'Pelanggan  : Budi', s:9 },
    ];
    const bytes = escposBytesFromLines(lines);
    if (!(bytes instanceof Uint8Array)) throw new Error('escposBytesFromLines() should return a Uint8Array');
    if (bytes[0] !== 0x1B || bytes[1] !== 0x40) throw new Error('escposBytesFromLines() should start with ESC @ (init): ' + Array.from(bytes.slice(0,4)));
    const text = new TextDecoder().decode(bytes);
    if (!text.includes('Laundry Uji') || !text.includes('Pelanggan  : Budi')) throw new Error('escposBytesFromLines() should embed the line text: ' + text);
    // ESC a 1 (rata tengah) untuk baris pertama (c:true) harus muncul sebelum teksnya
    const centerCmdIdx = text.indexOf('\x1B\x61\x01');
    const firstTextIdx = text.indexOf('Laundry Uji');
    if (centerCmdIdx === -1 || centerCmdIdx > firstTextIdx) throw new Error('escposBytesFromLines() should emit ESC a 1 (center align) before a c:true line');
  });

  await step('printReceiptBluetooth()/printSubsInvoiceBluetooth()/printUsageNotaBluetooth() degrade gracefully (no throw, no printer connected) when Web Bluetooth is unsupported, as in this headless browser', async () => {
    if (isBluetoothPrintSupported()) throw new Error('test assumes navigator.bluetooth is unavailable in this headless environment');
    const s = subscriptions.find(x=>x.nama==='Sub Outlet A');
    currentSubscriptionId = s.id;
    currentUsageNotaId = null;
    currentBatchUsageIds = null;
    currentUsageList = [{ id:'u-bt-test', subscriptionId: s.id, tanggal:'2026-08-20', type:'layanan_tambahan', layananNama:'Cuci Kilat', qty:1, satuan:'kg', harga:9000, subtotal:9000 }];
    currentUsageNotaId = 'u-bt-test';
    await printReceiptBluetooth(); // baik lewat cabang "tidak ditemukan" maupun lanjut ke printLinesViaBluetooth(), tidak boleh throw
    await printSubsInvoiceBluetooth();
    await printUsageNotaBluetooth();
    if (btPrinterDevice || btPrinterChar) throw new Error('no printer should end up connected when Web Bluetooth is unsupported');
  });

  await step('printReceiptViaBrowser()/printSubsInvoiceViaBrowser()/printUsageNotaViaBrowser() render the same nota lines into #printArea and call window.print() — the iPhone/AirPrint fallback since Web Bluetooth is unsupported on Safari', async () => {
    const originalPrint = window.print;
    let printCalls = 0;
    window.print = () => { printCalls++; };
    try {
      const s = subscriptions.find(x=>x.nama==='Sub Outlet A');
      currentSubscriptionId = s.id;
      currentBatchUsageIds = null;
      currentUsageList = [{ id:'u-print-test', subscriptionId: s.id, tanggal:'2026-08-20', type:'layanan_tambahan', layananNama:'Cuci Kilat', qty:1, satuan:'kg', harga:9000, subtotal:9000 }];
      currentUsageNotaId = 'u-print-test';

      printSubsInvoiceViaBrowser();
      let html = document.getElementById('printArea').innerHTML;
      if (!html.includes('Sub Outlet A')) throw new Error('printSubsInvoiceViaBrowser() should render the subscription nota into #printArea: ' + html);

      printUsageNotaViaBrowser();
      html = document.getElementById('printArea').innerHTML;
      if (!html.includes('Cuci Kilat')) throw new Error('printUsageNotaViaBrowser() should render the usage nota into #printArea: ' + html);

      const trxA = transactions.find(t=>t.nama==='Pelanggan Outlet A');
      notaShareTrxId = trxA.id;
      printReceiptViaBrowser();
      html = document.getElementById('printArea').innerHTML;
      if (!html.includes('Pelanggan Outlet A')) throw new Error('printReceiptViaBrowser() should render the regular transaction nota into #printArea: ' + html);

      if (printCalls !== 3) throw new Error('window.print() should be called once per print action, got ' + printCalls);

      // Nama pelanggan mengandung karakter HTML-sensitif harus di-escape, bukan disuntikkan mentah
      const originalNama = trxA.nama;
      trxA.nama = '<script>x</script> & Co';
      printReceiptViaBrowser();
      html = document.getElementById('printArea').innerHTML;
      if (html.includes('<script>x</script>')) throw new Error('printReceiptViaBrowser() must escape HTML in nota text, not inject it raw: ' + html);
      trxA.nama = originalNama;
    } finally {
      window.print = originalPrint;
    }
  });

  await step('toggleAutoNotifySelesai() persists settings.autoNotifySelesai via a settings upsert', async () => {
    await toggleAutoNotifySelesai(true);
    if (settings.autoNotifySelesai !== true) throw new Error('settings.autoNotifySelesai should be true after enabling');
    if (lastSettingsUpsert.auto_notify_selesai !== true) throw new Error('the upsert payload should carry auto_notify_selesai:true: ' + JSON.stringify(lastSettingsUpsert));
    await toggleAutoNotifySelesai(false);
    if (settings.autoNotifySelesai !== false) throw new Error('settings.autoNotifySelesai should be false after disabling');
    if (lastSettingsUpsert.auto_notify_selesai !== false) throw new Error('the upsert payload should carry auto_notify_selesai:false: ' + JSON.stringify(lastSettingsUpsert));
  });

  await step('workDoneNotifTextWA()/sendWorkDoneNotification() build an outlet-aware "sudah selesai" WA message and open it via openWA(), but skip (with a toast) when the customer has no phone on file', async () => {
    const trxA = transactions.find(t=>t.nama==='Pelanggan Outlet A'); // tagged with outletA = Cabang Fatmawati
    const originalHp = trxA.hp;
    const waCalls = [];
    const originalOpenWA = window.openWA;
    window.openWA = (...args) => waCalls.push(args);
    try {
      trxA.hp = '';
      sendWorkDoneNotification(trxA.id, 'trx');
      if (waCalls.length !== 0) throw new Error('sendWorkDoneNotification() should not open WA when the customer has no phone number');

      trxA.hp = '0812999999';
      sendWorkDoneNotification(trxA.id, 'trx');
      if (waCalls.length !== 1) throw new Error('sendWorkDoneNotification() should call openWA() once a phone number exists');
      const [, text, target] = waCalls[0];
      if (target !== 'wa') throw new Error('sendWorkDoneNotification() should default to the plain WhatsApp target, got ' + target);
      if (!text.includes('Pelanggan Outlet A') || !text.includes('SELESAI') || !text.includes('Cabang Fatmawati')) throw new Error('the WA notification text should mention the customer, the SELESAI status, and the outlet name: ' + text);
    } finally {
      window.openWA = originalOpenWA;
      trxA.hp = originalHp;
    }
  });

  await step('setWorkStatus() auto-sends the WA notification only when settings.autoNotifySelesai is on, and workBoardCardHTML() only shows the manual "Kirim Notifikasi" button when it is off', async () => {
    const trxA = transactions.find(t=>t.nama==='Pelanggan Outlet A');
    const originalHp = trxA.hp, originalWs = trxA.workStatus;
    trxA.hp = '0812999999';
    let waCalls = 0;
    const originalOpenWA = window.openWA;
    window.openWA = () => { waCalls++; };
    const cardBase = { id: trxA.id, source:'trx', nama: trxA.nama, layanan:'Cuci', tanggal: trxA.tanggal, estimasi: trxA.estimasi, lunas:false, harga:trxA.total };
    try {
      await toggleAutoNotifySelesai(false);
      trxA.workStatus = 'belum';
      await setWorkStatus(trxA.id, 'selesai', 'trx');
      if (waCalls !== 0) throw new Error('setWorkStatus() should NOT auto-notify when autoNotifySelesai is off');
      let html = workBoardCardHTML({ ...cardBase, workStatus:'selesai' });
      if (!html.includes('Kirim Notifikasi')) throw new Error('the manual "Kirim Notifikasi" button should show on a Selesai card when auto-notify is off: ' + html);

      await toggleAutoNotifySelesai(true);
      trxA.workStatus = 'belum';
      await setWorkStatus(trxA.id, 'selesai', 'trx');
      if (waCalls !== 1) throw new Error('setWorkStatus() should auto-notify exactly once when autoNotifySelesai is on, got ' + waCalls);
      html = workBoardCardHTML({ ...cardBase, workStatus:'selesai' });
      if (html.includes('Kirim Notifikasi')) throw new Error('the manual button should be hidden once auto-notify is on: ' + html);
    } finally {
      window.openWA = originalOpenWA;
      trxA.hp = originalHp;
      trxA.workStatus = originalWs;
      await toggleAutoNotifySelesai(false);
    }
  });

  await step('Pembayaran manual (transfer) selalu menyebut PAKET & JUMLAH transfer di pesan WA maupun catatan yang dilihat admin -- baik untuk perpanjangan (paywallModal/requestRenewal) maupun pendaftaran baru (paymentInfoModal/submitPaymentRequest), dan memakai nomor WA admin yang benar (regresi bug nyata)', async () => {
    const originalOpen = window.open;
    const originalFrom = sb.from;
    const originalShopOwnerId = shopOwnerId;
    const originalSettings = settings;
    const openedUrls = [];
    let capturedInsert = null;
    window.open = (url) => { openedUrls.push(url); return { closed: false }; };
    sb.from = (table) => {
      const q = originalFrom(table);
      if (table === 'payment_requests') {
        const origInsert = q.insert.bind(q);
        q.insert = (row) => { capturedInsert = row; return origInsert(row); };
      }
      return q;
    };
    try {
      // 1. Perpanjangan (sudah login): paywallModal harus punya 4 opsi paket, jumlah
      //    transfer ikut berubah sesuai paket dipilih, dan pesan WA + catatan admin
      //    menyebut paket & harganya -- SEBELUM perbaikan, pesan ini kosong info harga.
      shopOwnerId = 'owner-uji-bayar';
      settings = { shopName: 'Toko Uji Bayar' };
      showPaywallModal();
      if (document.getElementById('paywallPlan').options.length !== 4) throw new Error('dropdown paywallPlan harus berisi 4 pilihan paket (1/3/6/12 bulan)');
      if (document.getElementById('paywallPlan').value !== '12bulan') throw new Error('paket 12 bulan harus tetap default (SENGAJA, lihat CLAUDE.md) -- jangan diubah tanpa diminta');
      document.getElementById('paywallPlan').value = '1bulan';
      updatePlanAmountDisplay('paywallPlan', 'paywallAmount');
      if (!document.getElementById('paywallAmount').textContent.includes('Rp50.000')) throw new Error('jumlah transfer tidak ikut update ke Rp50.000 saat paket diganti ke 1 Bulan: ' + document.getElementById('paywallAmount').textContent);

      await requestRenewal();
      const renewalUrl = decodeURIComponent(openedUrls[openedUrls.length - 1] || '');
      if (!renewalUrl.startsWith('https://wa.me/6285696487884')) throw new Error('link WA konfirmasi perpanjangan harus ke nomor admin 6285696487884, got: ' + renewalUrl);
      if (!renewalUrl.includes('1 Bulan') || !renewalUrl.includes('Rp50.000')) throw new Error('BUG: pesan WA konfirmasi perpanjangan tidak menyebut paket & jumlah transfer sama sekali: ' + renewalUrl);
      if (!capturedInsert || !capturedInsert.catatan.includes('1 Bulan') || !capturedInsert.catatan.includes('Rp50.000')) throw new Error('BUG: catatan payment_requests (perpanjangan) yang dilihat admin tidak menyebut paket & jumlah: ' + JSON.stringify(capturedInsert));

      // 2. Pendaftaran baru (belum login): paymentInfoModal SEBELUMNYA tidak punya
      //    pilihan paket sama sekali (bug nyata) -- sekarang harus ada 4 opsi juga,
      //    dan submitPaymentRequest() harus menyebut paket & harga di catatan + WA.
      openedUrls.length = 0;
      capturedInsert = null;
      openPaymentInfo();
      if (document.getElementById('preqPlan').options.length !== 4) throw new Error('BUG: dropdown preqPlan (form Daftar) belum punya 4 pilihan paket 1/3/6/12 bulan');
      document.getElementById('preqPlan').value = '6bulan';
      updatePlanAmountDisplay('preqPlan', 'preqAmount');
      if (!document.getElementById('preqAmount').textContent.includes('Rp240.000')) throw new Error('jumlah transfer form Daftar tidak update ke Rp240.000 saat pilih 6 Bulan: ' + document.getElementById('preqAmount').textContent);

      document.getElementById('preqNama').value = 'Calon Pelanggan Uji';
      document.getElementById('preqWA').value = '081234500000';
      document.getElementById('preqCatatan').value = '';
      await submitPaymentRequest();
      if (!capturedInsert || !capturedInsert.catatan.includes('6 Bulan') || !capturedInsert.catatan.includes('Rp240.000')) throw new Error('BUG: catatan payment_requests (pendaftaran baru) tidak menyebut paket & jumlah transfer: ' + JSON.stringify(capturedInsert));
      document.getElementById('preqNotifBtn').onclick();
      const regUrl = decodeURIComponent(openedUrls[openedUrls.length - 1] || '');
      if (!regUrl.startsWith('https://wa.me/6285696487884')) throw new Error('link WA konfirmasi pendaftaran harus ke nomor admin 6285696487884, got: ' + regUrl);
      if (!regUrl.includes('6 Bulan') || !regUrl.includes('Rp240.000')) throw new Error('BUG: pesan WA konfirmasi pendaftaran tidak menyebut paket & jumlah transfer: ' + regUrl);
    } finally {
      window.open = originalOpen;
      sb.from = originalFrom;
      shopOwnerId = originalShopOwnerId;
      settings = originalSettings;
      closePaywallModal();
      closePaymentInfo();
    }
  });

  await step('Papan Hapus (bulk): mode "mulai X ke belakang"/"semua" menandai tugas yang cocok jadi "diambil" sekaligus, tanpa mengubah data transaksinya sama sekali', async () => {
    const savedTransactions = transactions;
    const savedOutlets = outlets;
    const savedOutletId = currentOutletId;
    outlets = []; currentOutletId = null;
    const today = todayISO();
    const daysAgo = (n) => { const d = new Date(today+'T00:00:00'); d.setDate(d.getDate()-n); return d.toISOString().slice(0,10); };
    transactions = [
      { id:'ph1', kode:'PH1', nama:'Hapus 3 Hari Lalu', hp:'', tanggal: daysAgo(3), estimasi:null, items:[], diskon:0, total:10000, dp:10000, status:'lunas', catatan:'', workStatus:'belum' },
      { id:'ph2', kode:'PH2', nama:'Hapus Kemarin', hp:'', tanggal: daysAgo(1), estimasi:null, items:[], diskon:0, total:10000, dp:10000, status:'lunas', catatan:'', workStatus:'belum' },
      { id:'ph3', kode:'PH3', nama:'Jangan Hapus Hari Ini', hp:'', tanggal: today, estimasi:null, items:[], diskon:0, total:10000, dp:10000, status:'lunas', catatan:'', workStatus:'belum' },
      { id:'ph4', kode:'PH4', nama:'Jangan Hapus Besok', hp:'', tanggal: daysAgo(-1), estimasi:null, items:[], diskon:0, total:10000, dp:10000, status:'lunas', catatan:'', workStatus:'belum' },
    ];
    const originalFrom = sb.from;
    const originalConfirm = window.confirm;
    sb.from = (table) => {
      if (table !== 'transactions') return originalFrom(table);
      const q = { select: () => q, update: () => q, eq: () => Promise.resolve({ error: null }) };
      return q;
    };
    try {
      // "kemarin ke belakang" harus mencakup ph1 (3 hari lalu) dan ph2 (kemarin), TIDAK ph3 (hari ini)/ph4 (besok).
      document.getElementById('papanHapusMode').value = 'kemarin';
      togglePapanHapusCustomFields();
      window.confirm = () => true;
      await confirmPapanHapus();
      if (transactions.find(x=>x.id==='ph1').workStatus !== 'diambil') throw new Error('BUG: 3 hari lalu harus ikut ditandai diambil oleh mode "kemarin ke belakang"');
      if (transactions.find(x=>x.id==='ph2').workStatus !== 'diambil') throw new Error('BUG: kemarin harus ikut ditandai diambil oleh mode "kemarin ke belakang"');
      if (transactions.find(x=>x.id==='ph3').workStatus === 'diambil') throw new Error('BUG: hari ini TIDAK boleh ikut ditandai diambil oleh mode "kemarin ke belakang"');
      if (transactions.find(x=>x.id==='ph4').workStatus === 'diambil') throw new Error('BUG: besok TIDAK boleh ikut ditandai diambil oleh mode "kemarin ke belakang"');
      // Cuma workStatus yang berubah -- status pembayaran/nota TIDAK ikut disentuh.
      if (transactions.find(x=>x.id==='ph1').status !== 'lunas' || transactions.find(x=>x.id==='ph1').total !== 10000) throw new Error('bulk hapus tidak boleh mengubah data transaksi selain workStatus');

      // Membatalkan dialog konfirmasi -- tidak ada apa pun yang berubah.
      document.getElementById('papanHapusMode').value = 'semua';
      window.confirm = () => false;
      await confirmPapanHapus();
      if (transactions.find(x=>x.id==='ph3').workStatus === 'diambil') throw new Error('membatalkan dialog konfirmasi tidak boleh ikut menandai apa pun');

      // "Semua" (dikonfirmasi) menandai sisa tugas yang masih ada di papan (ph3 & ph4; ph1/ph2 sudah "diambil" duluan).
      window.confirm = () => true;
      await confirmPapanHapus();
      if (transactions.find(x=>x.id==='ph3').workStatus !== 'diambil') throw new Error('mode "semua" harus menandai sisa tugas yang masih ada di papan');
      if (transactions.find(x=>x.id==='ph4').workStatus !== 'diambil') throw new Error('mode "semua" harus menandai sisa tugas yang masih ada di papan (termasuk yang estimasinya besok)');
    } finally {
      sb.from = originalFrom;
      window.confirm = originalConfirm;
      transactions = savedTransactions;
      outlets = savedOutlets;
      currentOutletId = savedOutletId;
      document.getElementById('papanHapusMode').value = 'semua';
      document.getElementById('papanHapusCustomFields').style.display = 'none';
    }
  });

  await step('a kasir restricted to one outlet (team_members.outlet_id) is locked to it: loadOutletsFromDB() forces currentOutletId there, switchOutlet() refuses other outlets, and the picker/switcher reflect the lock', async () => {
    const outletA = outlets[0].id, outletB = outlets[1].id;
    const savedRole = currentRole;
    try {
      currentRole = 'kasir';
      kasirOutletId = String(outletB);
      await loadOutletsFromDB();
      if (currentOutletId !== String(outletB)) throw new Error('loadOutletsFromDB() should force currentOutletId to the kasir\'s restricted outlet: ' + currentOutletId);

      switchOutlet(outletA);
      if (currentOutletId !== String(outletB)) throw new Error('switchOutlet() should refuse to move a restricted kasir to another outlet: ' + currentOutletId);

      switchOutlet(outletB);
      if (currentOutletId !== String(outletB)) throw new Error('switchOutlet() to the kasir\'s own restricted outlet should still work');

      renderOutletSwitcherLabel();
      const label = document.getElementById('outletSwitcherLabel').textContent;
      if (!label.includes('🔒')) throw new Error('outlet switcher label should show a lock indicator for a restricted kasir: ' + label);

      document.getElementById('outletPickerModal').classList.remove('show');
      openOutletPicker();
      if (document.getElementById('outletPickerModal').classList.contains('show')) throw new Error('openOutletPicker() should refuse to open the picker for a restricted kasir');
    } finally {
      currentRole = savedRole;
      kasirOutletId = null;
      await loadOutletsFromDB();
    }
  });

  await step('deleteOutlet() removes the outlet without deleting its transactions/expenses (they just become unlinked), and falls back to another outlet if the deleted one was active', async () => {
    const outletA = outlets[0].id, outletB = outlets[1].id;
    switchOutlet(outletA);
    const trxCountBefore = transactions.length;
    const originalConfirm = window.confirm;
    window.confirm = () => true;
    await deleteOutlet(outletA);
    window.confirm = originalConfirm;
    if (outlets.some(o=>String(o.id)===String(outletA))) throw new Error('deleted outlet should be removed from the outlets array');
    if (transactions.length !== trxCountBefore) throw new Error('deleteOutlet() should NOT delete the transactions that were tagged with it');
    if (currentOutletId !== String(outletB)) throw new Error('deleting the active outlet should fall back to another remaining outlet, got ' + currentOutletId);
  });

  await step('renderOmzetTrend() shows a 6-month bar chart ending at the selected reportMonth, using the same omset definition as the daily chart', () => {
    reportOutletFilter = '';
    transactions = [
      { id:'t1', kode:'T1', nama:'A', hp:'', tanggal:'2026-03-05', estimasi:null, items:[], diskon:0, total:1000, dp:1000, status:'lunas', catatan:'' },
      { id:'t2', kode:'T2', nama:'B', hp:'', tanggal:'2026-04-10', estimasi:null, items:[], diskon:0, total:2000, dp:2000, status:'lunas', catatan:'' },
      // 2026-05: sengaja kosong, harus tetap muncul sebagai bar bernilai 0
      { id:'t3', kode:'T3', nama:'C', hp:'', tanggal:'2026-06-01', estimasi:null, items:[], diskon:0, total:2500, dp:0, status:'belum', catatan:'' },
      { id:'t4', kode:'T4', nama:'D', hp:'', tanggal:'2026-06-20', estimasi:null, items:[], diskon:0, total:2500, dp:0, status:'belum', catatan:'' },
      { id:'t5', kode:'T5', nama:'E', hp:'', tanggal:'2026-07-15', estimasi:null, items:[], diskon:0, total:3000, dp:3000, status:'lunas', catatan:'' },
      { id:'t6', kode:'T6', nama:'F', hp:'', tanggal:'2026-08-02', estimasi:null, items:[], diskon:0, total:4000, dp:4000, status:'lunas', catatan:'' },
      { id:'t7', kode:'T7', nama:'G', hp:'', tanggal:'2026-02-28', estimasi:null, items:[], diskon:0, total:99999, dp:0, status:'belum', catatan:'' }, // di luar jendela 6 bulan, harus DIABAIKAN
    ];
    document.getElementById('reportMonth').value = '2026-08';
    renderReport();

    const bars = document.querySelectorAll('#trendChartBars .bar');
    const labels = document.querySelectorAll('#trendChartLabels span');
    if (bars.length !== 6) throw new Error('expected 6 bars (Mar-Agu 2026), got ' + bars.length);
    if (labels.length !== 6) throw new Error('expected 6 month labels, got ' + labels.length);

    const expected = [
      { label: "Mar'26", omzet: 'Rp1.000', compact: '1rb' },
      { label: "Apr'26", omzet: 'Rp2.000', compact: '2rb' },
      { label: "Mei'26", omzet: 'Rp0', compact: '0' },
      { label: "Jun'26", omzet: 'Rp5.000', compact: '5rb' }, // 2500+2500, termasuk transaksi 'belum lunas' -- sama seperti totalOmzet di chart harian
      { label: "Jul'26", omzet: 'Rp3.000', compact: '3rb' },
      { label: "Agu'26", omzet: 'Rp4.000', compact: '4rb' },
    ];
    expected.forEach((exp, i) => {
      if (labels[i].textContent !== exp.label) throw new Error(`bar ${i}: expected label ${exp.label}, got ${labels[i].textContent}`);
      const title = bars[i].getAttribute('title');
      if (!title.includes(exp.omzet)) throw new Error(`bar ${i} (${exp.label}): expected title to include ${exp.omzet}, got "${title}"`);
      // Nominal harus KELIHATAN langsung (bukan cuma di title/hover, yang tidak kepakai di HP).
      const valEl = bars[i].querySelector('.bar-val');
      if (!valEl || valEl.textContent !== exp.compact) throw new Error(`bar ${i} (${exp.label}): expected visible .bar-val "${exp.compact}", got ${valEl && valEl.textContent}`);
    });
    // Rp99.999 dari Feb 2026 (di luar jendela 6 bulan) tidak boleh nyelip ke bar manapun
    bars.forEach((b, i) => { if (b.getAttribute('title').includes('99.999')) throw new Error(`bar ${i} leaked the out-of-window Feb transaction: ${b.getAttribute('title')}`); });
  });

  await step('Appbar: tombol "Keluar" khusus kasir (owner tetap logout lewat Pengaturan -> Keamanan Akun)', () => {
    const appbarButtons = document.querySelectorAll('.appbar .icon-btn');
    const labels = Array.from(appbarButtons).map(b => b.querySelector('.icon-btn-label').textContent);
    if (!labels.includes('Catatan')) throw new Error('tombol Catatan seharusnya ada di appbar, got ' + labels.join(','));
    const catatanBtn = Array.from(appbarButtons).find(b => b.getAttribute('onclick') === 'openCatatan()' || b.querySelector('.icon-btn-label').textContent === 'Catatan');
    if (!catatanBtn) throw new Error('tombol Catatan tidak memanggil openCatatan()');

    const keamananPanel = document.getElementById('settingsSub-keamanan');
    const logoutBtn = keamananPanel.querySelector('button[onclick="handleLogout()"]');
    if (!logoutBtn) throw new Error('tombol handleLogout() seharusnya ada di dalam panel Keamanan Akun');

    const keluarBtn = document.querySelector('.appbar .icon-btn.kasir-only-logout');
    if (!keluarBtn) throw new Error('tombol Keluar khusus kasir seharusnya ada di appbar');
    if (keluarBtn.getAttribute('onclick') !== 'handleLogout()') throw new Error('tombol Keluar appbar seharusnya memanggil handleLogout()');

    currentRole = 'owner';
    applyRoleUI();
    if (getComputedStyle(keluarBtn).display !== 'none') throw new Error('tombol Keluar appbar seharusnya tersembunyi untuk owner (sudah ada di Pengaturan -> Keamanan Akun)');
    const pengaturanBtnOwner = document.querySelector('.appbar .icon-btn.owner-only');
    if (getComputedStyle(pengaturanBtnOwner).display === 'none') throw new Error('tombol Pengaturan seharusnya tampil untuk owner');

    currentRole = 'kasir';
    applyRoleUI();
    if (getComputedStyle(keluarBtn).display === 'none') throw new Error('tombol Keluar appbar seharusnya tampil untuk kasir supaya bisa logout (bug: kasir tidak bisa akses Pengaturan)');
    if (getComputedStyle(pengaturanBtnOwner).display !== 'none') throw new Error('tombol Pengaturan seharusnya tetap tersembunyi untuk kasir');

    currentRole = 'owner';
    applyRoleUI();
  });

  await step('Catatan: grid sampul buku menampilkan judul + tanggal dibuat/diedit, dan create/edit/delete+Urungkan berfungsi', async () => {
    notes = [];
    editingNoteId = null;

    openCatatan();
    if (!document.getElementById('catatanModal').classList.contains('show')) throw new Error('openCatatan() should show the modal');
    if (document.getElementById('catatanHome').style.display === 'none') throw new Error('openCatatan() should land on the grid (home) view');
    if (!document.getElementById('notesGrid').querySelector('.notes-empty')) throw new Error('empty notes should show the "Belum ada catatan" empty state');

    createNewNote();
    if (document.getElementById('catatanEditorView').style.display === 'none') throw new Error('createNewNote() should switch to the editor view');
    if (document.getElementById('noteJudul').value !== '' || document.getElementById('noteIsi').innerHTML !== '') throw new Error('createNewNote() should start with empty fields');

    document.getElementById('noteJudul').value = 'Stok Deterjen';
    document.getElementById('noteIsi').innerHTML = 'Beli deterjen 5kg minggu depan';
    await saveNote();
    if (notes.length !== 1) throw new Error('saveNote() (create) should add exactly one note, got ' + notes.length);
    if (notes[0].judul !== 'Stok Deterjen' || notes[0].isi !== 'Beli deterjen 5kg minggu depan') throw new Error('saveNote() did not persist judul/isi correctly: ' + JSON.stringify(notes[0]));
    if (!notes[0].createdAt || !notes[0].updatedAt) throw new Error('saveNote() should stamp createdAt/updatedAt from the DB round-trip');
    if (document.getElementById('catatanEditorView').style.display === '') throw new Error('saveNote() should close the editor and return to the grid');

    let gridHtml = document.getElementById('notesGrid').innerHTML;
    if (!gridHtml.includes('Stok Deterjen')) throw new Error('grid should show the new note title: ' + gridHtml);
    if (!gridHtml.includes('Dibuat:') || !gridHtml.includes('Diedit:')) throw new Error('each book cover should show Dibuat & Diedit dates: ' + gridHtml);
    const bookCount = document.querySelectorAll('#notesGrid .note-book').length;
    if (bookCount !== 1) throw new Error('expected 1 book cover in the grid, got ' + bookCount);

    const savedId = notes[0].id;
    openNote(savedId);
    if (document.getElementById('noteJudul').value !== 'Stok Deterjen') throw new Error('openNote() should populate the judul field');
    if (!document.getElementById('noteDatesInfo').textContent.includes('Terakhir diedit')) throw new Error('editor should show a "Terakhir diedit" hint when opening an existing note');

    document.getElementById('noteJudul').value = 'Stok Deterjen (revisi)';
    await saveNote();
    if (notes.length !== 1) throw new Error('editing an existing note should NOT create a second note, got ' + notes.length);
    if (notes[0].id !== savedId) throw new Error('editing an existing note should keep the same id, got ' + notes[0].id + ' vs ' + savedId);
    if (notes[0].judul !== 'Stok Deterjen (revisi)') throw new Error('edit should update judul, got ' + notes[0].judul);

    openNote(savedId);
    const originalConfirm = window.confirm;
    window.confirm = () => false;
    await deleteNote();
    if (notes.length !== 1) throw new Error('note should NOT be deleted when confirm() returns false');

    window.confirm = () => true;
    await deleteNote();
    window.confirm = originalConfirm;
    if (notes.length !== 0) throw new Error('note should be deleted after confirming');

    const toast = document.getElementById('toast');
    const undoBtn = toast.querySelector('.toast-action');
    if (!undoBtn || undoBtn.textContent !== 'Urungkan') throw new Error('deleteNote toast missing Urungkan action');
    undoBtn.onclick();
    await new Promise(r => setTimeout(r, 150));
    if (notes.length !== 1 || notes[0].judul !== 'Stok Deterjen (revisi)') throw new Error('Urungkan should restore the deleted note, got ' + JSON.stringify(notes));
  });

  await step('Catatan: format ala OneNote (bold/italic/underline, bullet, penomoran, kotak centang, stabilo) tersimpan sebagai HTML dan status centang ikut tersimpan', async () => {
    notes = [];
    editingNoteId = null;
    createNewNote();
    const ed = document.getElementById('noteIsi');
    ed.innerHTML = 'contoh teks';
    ed.focus();
    const range = document.createRange();
    range.selectNodeContents(ed);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    noteFormat('bold');
    if (!/<b>|<strong>/i.test(ed.innerHTML)) throw new Error('noteFormat(bold) should wrap the selection in <b>/<strong>, got: ' + ed.innerHTML);

    ed.innerHTML = 'stabilo ini';
    range.selectNodeContents(ed);
    sel.removeAllRanges();
    sel.addRange(range);
    noteHighlight('#FFF176');
    if (!/background-color/i.test(ed.innerHTML)) throw new Error('noteHighlight() should apply a background-color to the selection, got: ' + ed.innerHTML);

    ed.innerHTML = '';
    ed.focus();
    insertNoteChecklist();
    if (!ed.innerHTML.includes('note-check-line') || !/type="checkbox"/i.test(ed.innerHTML)) throw new Error('insertNoteChecklist() should insert a checkbox line, got: ' + ed.innerHTML);

    const checkbox = ed.querySelector('input[type=checkbox]');
    if (!checkbox) throw new Error('expected a checkbox element inside the editor');
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    if (!checkbox.hasAttribute('checked')) throw new Error('handleNoteEditorChange() should sync the checked PROPERTY to the checked ATTRIBUTE (innerHTML serialization only reads the attribute)');

    document.getElementById('noteJudul').value = 'Catatan Format';
    await saveNote();
    if (!notes[0].isi.includes('checked')) throw new Error('saveNote() should persist the checked checkbox state in isi: ' + notes[0].isi);

    const dirty = sanitizeNoteHTML('<img src=x onerror="window.__noteXss=true"><script>window.__noteXss2=true</script><a href="javascript:alert(1)">tautan</a><b onclick="window.__noteXss3=true">tebal</b>');
    if (dirty.includes('onerror') || dirty.includes('<script') || dirty.includes('javascript:') || dirty.includes('onclick')) throw new Error('sanitizeNoteHTML() must strip script tags, on* handlers, and javascript: URLs: ' + dirty);
    if (!dirty.includes('<b') || !dirty.includes('tebal')) throw new Error('sanitizeNoteHTML() should keep allowed formatting tags/text intact: ' + dirty);
    window.__noteXss = false; window.__noteXss2 = false; window.__noteXss3 = false;
    const probe = document.createElement('div');
    probe.innerHTML = dirty;
    document.body.appendChild(probe);
    await new Promise(r => setTimeout(r, 30));
    document.body.removeChild(probe);
    if (window.__noteXss || window.__noteXss2 || window.__noteXss3) throw new Error('sanitized note HTML must not execute any injected script/handler when rendered');
  });

  await step('i18n: t() only translates when currentLang==="en", translateStaticDOM() swaps known text/attributes in place, and pluralization is count-aware', () => {
    const originalLang = currentLang;
    try {
      currentLang = 'id';
      if (t('Simpan') !== 'Simpan') throw new Error('t() should return the Indonesian source string unchanged when currentLang is "id"');

      currentLang = 'en';
      if (t('Simpan') !== 'Save') throw new Error('t("Simpan") should return "Save" when currentLang is "en", got ' + t('Simpan'));
      if (t('some unknown string not in the dictionary') !== 'some unknown string not in the dictionary') throw new Error('t() should fall back to the original string for an unmapped key');

      const probe = document.createElement('div');
      probe.innerHTML = '<label>  Simpan  </label><input placeholder="cth. Budi Santoso"><span>Untranslated Text</span>';
      translateStaticDOM(probe);
      if (probe.querySelector('label').textContent !== '  Save  ') throw new Error('translateStaticDOM() should replace only the trimmed text, preserving surrounding whitespace: ' + JSON.stringify(probe.querySelector('label').textContent));
      if (probe.querySelector('input').getAttribute('placeholder') !== 'e.g. Budi Santoso') throw new Error('translateStaticDOM() should translate the placeholder attribute too');
      if (probe.querySelector('span').textContent !== 'Untranslated Text') throw new Error('translateStaticDOM() must leave text with no dictionary match unchanged');

      // Pluralization: bare dictionary words ("service"/"visit"/"transaction") are singular-by-default in
      // I18N_EN, so count-aware call sites bypass t() with an inline ternary instead (see js/16-riwayat.js,
      // js/08-paket.js, js/18-laporan.js) -- assert the actual rendered output, not just the dictionary.
      outlets = []; currentOutletId = null;
      transactions = [
        { id:'p1', kode:'P1', nama:'Satu', hp:'', tanggal:'2026-08-20', estimasi:null, items:[{nama:'Cuci',qty:1,satuan:'kg',harga:5000,subtotal:5000}], diskon:0, total:5000, dp:5000, status:'lunas', catatan:'' },
        { id:'p2', kode:'P2', nama:'Dua', hp:'', tanggal:'2026-08-21', estimasi:null, items:[{nama:'Cuci',qty:1,satuan:'kg',harga:5000,subtotal:5000},{nama:'Setrika',qty:1,satuan:'kg',harga:3000,subtotal:3000}], diskon:0, total:8000, dp:8000, status:'lunas', catatan:'' },
      ];
      renderHistory();
      const html = document.getElementById('historyList').innerHTML;
      if (!html.includes('1 service') || html.includes('1 services')) throw new Error('a single-item transaction should say "1 service", not "1 services": ' + html);
      if (!html.includes('2 services')) throw new Error('a two-item transaction should say "2 services" (plural), got: ' + html);
    } finally {
      currentLang = originalLang;
    }
  });

  await step('initUserData() restores the tab the user actually ended up on, not a stale pre-load snapshot, when they switch tabs mid-load', async () => {
    switchTab('baru'); // seeds localStorage.nk_lastTab = 'baru' before the slow load starts
    let releaseTransactions;
    const pending = new Promise(resolve => { releaseTransactions = resolve; });
    const originalFrom = sb.from;
    sb.from = (table) => {
      if (table === 'transactions') {
        const q = {
          select: () => q, eq: () => q, in: () => q, order: () => q, update: () => q, insert: () => q, delete: () => q,
          then: (resolve) => pending.then(() => resolve({ data: [], error: null })),
        };
        return q;
      }
      return originalFrom(table);
    };
    const initPromise = initUserData();
    await new Promise(r => setTimeout(r, 30)); // let the other 10 parallel loads settle first
    switchTab('papan'); // user taps Daftar Tugas while transactions are still "loading"
    releaseTransactions();
    await initPromise;
    sb.from = originalFrom;
    if (currentTabName !== 'papan') throw new Error('initUserData() should not override a tab the user switched to during load, got currentTabName=' + currentTabName);
    if (!document.getElementById('view-papan').classList.contains('active')) throw new Error('view-papan should stay the active view after initUserData() resolves');
    const activeTabBtn = document.querySelector('.tab.active');
    if (!activeTabBtn || activeTabBtn.getAttribute('data-tab') !== 'papan') throw new Error('the Daftar Tugas tab button should stay marked active, got ' + (activeTabBtn && activeTabBtn.getAttribute('data-tab')));
  });

  await step('Rekap Transaksi Pelanggan: menjumlahkan seluruh transaksi reguler 1 nama lintas tanggal berbeda (cocok nama saja, tidak ikut nama lain)', async () => {
    const savedTransactions = transactions;
    const savedOutletId = currentOutletId;
    currentOutletId = null;
    transactions = [
      { id:'rk1', kode:'LND-1001', nama:'Budi Santoso', hp:'081200001111', tanggal:'2026-09-01', estimasi:'', items:[{nama:'Cuci Setrika',qty:3,satuan:'kg',harga:8000,subtotal:24000}], diskon:0, total:24000, dp:24000, status:'lunas', workStatus:'selesai', catatan:'', outletId:null },
      { id:'rk2', kode:'LND-1002', nama:'Budi Santoso', hp:'081200001111', tanggal:'2026-09-05', estimasi:'', items:[{nama:'Cuci Sepatu',qty:1,satuan:'pasang',harga:25000,subtotal:25000}], diskon:0, total:25000, dp:0, status:'belum', workStatus:'belum', catatan:'', outletId:null },
      { id:'rk3', kode:'LND-1003', nama:'Budi Santoso', hp:'081200001111', tanggal:'2026-09-10', estimasi:'', items:[{nama:'Cuci Kilat',qty:2,satuan:'kg',harga:12000,subtotal:24000}], diskon:0, total:24000, dp:10000, status:'belum', workStatus:'belum', catatan:'', outletId:null },
      { id:'rk4', kode:'LND-1004', nama:'Siti Aminah', hp:'081299998888', tanggal:'2026-09-03', estimasi:'', items:[{nama:'Cuci Reguler',qty:2,satuan:'kg',harga:7000,subtotal:14000}], diskon:0, total:14000, dp:14000, status:'lunas', workStatus:'selesai', catatan:'', outletId:null },
    ];
    try {
      // Cari lewat saran autocomplete (ketik sebagian nama -> pilih dari kotak saran)
      openRekapPelanggan();
      document.getElementById('rekapNamaInput').value = 'budi';
      showRekapNamaSuggest();
      const box = document.getElementById('rekapNamaSuggestBox');
      if (!box.classList.contains('show') || !box.innerHTML.includes('Budi Santoso')) throw new Error('saran nama tidak muncul untuk "budi": ' + box.innerHTML);
      selectRekapNamaSuggest(0);

      if (document.getElementById('rekapResultStep').style.display === 'none') throw new Error('hasil rekap seharusnya tampil setelah memilih saran');
      if (document.getElementById('rekapResultNama').textContent !== 'Budi Santoso') throw new Error('nama hasil rekap salah: ' + document.getElementById('rekapResultNama').textContent);
      if (document.getElementById('rekapStTrx').textContent !== '3') throw new Error('jumlah transaksi Budi seharusnya 3 (3 tanggal berbeda), got ' + document.getElementById('rekapStTrx').textContent);
      if (document.getElementById('rekapStTotal').textContent !== rupiah(73000)) throw new Error('Total Keseluruhan salah: ' + document.getElementById('rekapStTotal').textContent);
      if (document.getElementById('rekapStLunas').textContent !== rupiah(34000)) throw new Error('Sudah Dibayar salah (24000 lunas + 0 + 10000 dp): ' + document.getElementById('rekapStLunas').textContent);
      if (document.getElementById('rekapStBelum').textContent !== rupiah(39000)) throw new Error('Belum Dibayar salah: ' + document.getElementById('rekapStBelum').textContent);
      const cards = document.querySelectorAll('#rekapList .trx-card');
      if (cards.length !== 3) throw new Error('daftar rekap seharusnya berisi 3 kartu transaksi, got ' + cards.length);
      if (document.getElementById('rekapList').innerHTML.includes('Siti Aminah')) throw new Error('rekap Budi tidak boleh ikut mencampur transaksi Siti Aminah (nama beda)');
      // Urutan harus ascending by tanggal (01 -> 05 -> 10 Sep), bukan urutan insersi
      const names = Array.from(cards).map(c => c.querySelector('.trx-name').textContent);
      if (names[0] !== '01 Sep 2026' || names[1] !== '05 Sep 2026' || names[2] !== '10 Sep 2026') throw new Error('urutan tanggal di rekap salah: ' + names.join(', '));

      // Nota rekap (WA text) harus merinci tiap transaksi per tanggal + total keseluruhan
      const wa = rekapPelangganTextWA();
      if (!wa.includes('1. 01 Sep 2026') || !wa.includes('2. 05 Sep 2026') || !wa.includes('3. 10 Sep 2026')) throw new Error('teks WA rekap tidak merinci ketiga tanggal: ' + wa);
      if (!wa.includes('Cuci Sepatu') || !wa.includes('Cuci Kilat')) throw new Error('teks WA rekap tidak menyebut nama layanan tiap transaksi: ' + wa);
      if (!wa.includes(rupiah(73000))) throw new Error('teks WA rekap tidak menyebut Total Keseluruhan yang benar: ' + wa);

      // buildNotaCanvas() harus jalan tanpa throw untuk lines versi JPG/PDF-nya (pola sama dengan nota lain)
      const pdfLines = buildRekapPelangganPDFLines();
      const canvas = await buildNotaCanvas(pdfLines, 80);
      if (!canvas || !canvas.width || !canvas.height) throw new Error('buildNotaCanvas() tidak menghasilkan canvas valid untuk rekap pelanggan');

      // Kirim WA: nomor diambil dari transaksi (bukan tabel kontak terpisah)
      const waCalls = [];
      const originalOpenWA = window.openWA;
      window.openWA = (...args) => waCalls.push(args);
      try {
        openRekapPelangganShare();
        sendRekapPelangganWA('wa');
      } finally {
        window.openWA = originalOpenWA;
      }
      if (waCalls.length !== 1) throw new Error('sendRekapPelangganWA() seharusnya memanggil openWA() sekali, got ' + waCalls.length);
      if (waCalls[0][0] !== '6281200001111') throw new Error('nomor WA rekap salah, seharusnya diambil dari transaksi: ' + waCalls[0][0]);
      if (document.getElementById('rekapShareModal').classList.contains('show')) throw new Error('rekapShareModal seharusnya tertutup lagi setelah kirim WA');

      // Cari nama lain dengan 1 transaksi saja -- tidak boleh ikut tercampur Budi
      backToRekapSearch();
      document.getElementById('rekapNamaInput').value = 'Siti Aminah';
      searchRekapPelanggan();
      if (document.getElementById('rekapStTrx').textContent !== '1') throw new Error('Siti Aminah seharusnya cuma 1 transaksi, got ' + document.getElementById('rekapStTrx').textContent);
      if (document.getElementById('rekapStTotal').textContent !== rupiah(14000)) throw new Error('Total Siti Aminah salah: ' + document.getElementById('rekapStTotal').textContent);

      // Nama yang belum pernah bertransaksi -> TETAP tampil sebagai hasil (bukan cuma
      // toast lalu berhenti), dengan daftar kosong + ajakan tambah transaksi baru --
      // supaya nama yang datanya belum ada di database bisa langsung diisi dari sini.
      backToRekapSearch();
      document.getElementById('rekapNamaInput').value = 'Nama Tidak Pernah Ada';
      searchRekapPelanggan();
      if (document.getElementById('rekapResultStep').style.display === 'none') throw new Error('nama yang belum ada transaksinya seharusnya tetap masuk ke hasil (bukan berhenti di pencarian)');
      if (document.getElementById('rekapResultNama').textContent !== 'Nama Tidak Pernah Ada') throw new Error('nama hasil salah untuk pencarian kosong');
      if (document.getElementById('rekapStTrx').textContent !== '0') throw new Error('jumlah transaksi seharusnya 0 untuk nama yang belum ada datanya');
      if (document.getElementById('rekapStTotal').textContent !== rupiah(0)) throw new Error('Total Keseluruhan seharusnya Rp0 untuk nama yang belum ada datanya');
      if (!document.getElementById('rekapList').innerHTML.includes('Tambah Transaksi Baru')) throw new Error('daftar kosong seharusnya mengajak tambah transaksi baru: ' + document.getElementById('rekapList').innerHTML);
      if (document.getElementById('rekapSelectControls').style.display !== 'none') throw new Error('kontrol Semua/Kosongkan seharusnya tersembunyi kalau tidak ada transaksi sama sekali');
      const addBtn = document.querySelector('#rekapResultStep button[onclick="startRekapAddTransaction()"]');
      if (!addBtn) throw new Error('tombol Tambah Transaksi Baru seharusnya selalu ada di hasil rekap');

      closeRekapPelanggan();
    } finally {
      transactions = savedTransactions;
      currentOutletId = savedOutletId;
    }
  });

  await step('Rekap Transaksi Pelanggan: bisa pilih transaksi mana saja yang ikut direkap (centang per baris, Semua/Kosongkan)', async () => {
    const savedTransactions = transactions;
    const savedOutletId = currentOutletId;
    currentOutletId = null;
    transactions = [
      { id:'rs1', kode:'LND-2001', nama:'Dewi Lestari', hp:'081277776666', tanggal:'2026-09-02', estimasi:'', items:[{nama:'Cuci Reguler',qty:2,satuan:'kg',harga:7000,subtotal:14000}], diskon:0, total:14000, dp:14000, status:'lunas', workStatus:'selesai', catatan:'', outletId:null },
      { id:'rs2', kode:'LND-2002', nama:'Dewi Lestari', hp:'081277776666', tanggal:'2026-09-06', estimasi:'', items:[{nama:'Cuci Sepatu',qty:1,satuan:'pasang',harga:20000,subtotal:20000}], diskon:0, total:20000, dp:0, status:'belum', workStatus:'belum', catatan:'', outletId:null },
      { id:'rs3', kode:'LND-2003', nama:'Dewi Lestari', hp:'081277776666', tanggal:'2026-09-12', estimasi:'', items:[{nama:'Cuci Kilat',qty:1,satuan:'kg',harga:12000,subtotal:12000}], diskon:0, total:12000, dp:12000, status:'lunas', workStatus:'selesai', catatan:'', outletId:null },
    ];
    try {
      openRekapPelanggan();
      document.getElementById('rekapNamaInput').value = 'Dewi Lestari';
      searchRekapPelanggan();

      // Default: semua 3 transaksi tercentang
      if (document.getElementById('rekapStTrx').textContent !== '3') throw new Error('default seharusnya semua tercentang (3), got ' + document.getElementById('rekapStTrx').textContent);
      if (document.getElementById('rekapStTotal').textContent !== rupiah(46000)) throw new Error('Total Keseluruhan default (semua tercentang) salah: ' + document.getElementById('rekapStTotal').textContent);
      const checkboxesBefore = document.querySelectorAll('#rekapList input[type="checkbox"]');
      if (checkboxesBefore.length !== 3) throw new Error('seharusnya ada 3 checkbox, got ' + checkboxesBefore.length);
      if (!Array.from(checkboxesBefore).every(cb => cb.checked)) throw new Error('semua checkbox seharusnya tercentang secara default');
      if (document.getElementById('rekapSelectHint').textContent.trim() !== '3 dari 3 transaksi yang ditemukan dipilih') throw new Error('hint seleksi salah: ' + document.getElementById('rekapSelectHint').textContent);

      // Hilangkan centang transaksi ke-2 (LND-2002, belum lunas 20000) lewat toggleRekapTrxSelect()
      toggleRekapTrxSelect('rs2', false);
      if (document.getElementById('rekapStTrx').textContent !== '2') throw new Error('setelah uncheck 1, jumlah terpilih seharusnya 2, got ' + document.getElementById('rekapStTrx').textContent);
      if (document.getElementById('rekapStTotal').textContent !== rupiah(26000)) throw new Error('Total Keseluruhan setelah uncheck LND-2002 salah (14000+12000=26000): ' + document.getElementById('rekapStTotal').textContent);
      if (document.getElementById('rekapStLunas').textContent !== rupiah(26000)) throw new Error('Sudah Dibayar setelah uncheck salah (kedua transaksi terpilih lunas penuh): ' + document.getElementById('rekapStLunas').textContent);
      if (document.getElementById('rekapStBelum').textContent !== rupiah(0)) throw new Error('Belum Dibayar setelah uncheck salah, seharusnya 0: ' + document.getElementById('rekapStBelum').textContent);
      // Baris yang di-uncheck tetap tampil di daftar (bukan dihilangkan), tapi checkbox-nya kosong
      const checkboxesAfterUncheck = document.querySelectorAll('#rekapList input[type="checkbox"]');
      if (checkboxesAfterUncheck.length !== 3) throw new Error('baris yang di-uncheck seharusnya tetap tampil di daftar, bukan hilang');
      if (checkboxesAfterUncheck[1].checked) throw new Error('checkbox transaksi ke-2 seharusnya sudah tidak tercentang');

      // Nota rekap (WA/PDF) hanya berisi transaksi yang MASIH tercentang (LND-2001 & LND-2003), bukan LND-2002
      const wa = rekapPelangganTextWA();
      if (wa.includes('LND-2002') || wa.includes('Cuci Sepatu')) throw new Error('transaksi yang di-uncheck tidak boleh ikut masuk nota rekap: ' + wa);
      if (!wa.includes('LND-2001') || !wa.includes('LND-2003')) throw new Error('transaksi yang masih tercentang harus tetap masuk nota rekap: ' + wa);
      if (!wa.includes(rupiah(26000))) throw new Error('total di nota rekap tidak mengikuti transaksi yang tercentang saja: ' + wa);
      const pdfLines = buildRekapPelangganPDFLines().map(l => l.t).join(' | ');
      if (pdfLines.includes('LND-2002')) throw new Error('versi PDF/JPG rekap juga tidak boleh ikut transaksi yang di-uncheck: ' + pdfLines);

      // Kosongkan semua -> tombol kirim/cetak harus menolak dengan toast, bukan membuka modal share
      deselectAllRekapTrx();
      if (document.getElementById('rekapStTrx').textContent !== '0') throw new Error('setelah Kosongkan, jumlah terpilih seharusnya 0');
      if (document.getElementById('rekapStTotal').textContent !== rupiah(0)) throw new Error('Total Keseluruhan setelah Kosongkan seharusnya Rp0');
      const toastCalls = [];
      const originalShowToast = window.showToast;
      window.showToast = (msg) => toastCalls.push(msg);
      try {
        openRekapPelangganShare();
      } finally {
        window.showToast = originalShowToast;
      }
      if (document.getElementById('rekapShareModal').classList.contains('show')) throw new Error('modal kirim/cetak tidak boleh terbuka saat tidak ada transaksi tercentang');
      if (!toastCalls.some(m => m.includes('Centang minimal satu transaksi'))) throw new Error('seharusnya ada toast peringatan saat kirim tanpa centang apa pun: ' + JSON.stringify(toastCalls));

      // Pilih Semua lagi -> balik ke 3 tercentang, total penuh lagi
      selectAllRekapTrx();
      if (document.getElementById('rekapStTrx').textContent !== '3') throw new Error('setelah Semua, jumlah terpilih seharusnya kembali 3');
      if (document.getElementById('rekapStTotal').textContent !== rupiah(46000)) throw new Error('Total Keseluruhan setelah Semua seharusnya kembali penuh (46000)');

      closeRekapPelanggan();
    } finally {
      transactions = savedTransactions;
      currentOutletId = savedOutletId;
    }
  });

  await step('Rekap Transaksi Pelanggan: keterangan atas nota mencantumkan Pelanggan, Periode (dari transaksi tercentang), dan No. WhatsApp kalau ada', () => {
    const savedTransactions = transactions;
    const savedOutletId = currentOutletId;
    currentOutletId = null;
    try {
      // Kasus ada No. WA + lebih dari 1 tanggal -> Periode berupa rentang
      transactions = [
        { id:'rp1', kode:'LND-3001', nama:'Hendra', hp:'081255554444', tanggal:'2026-09-01', estimasi:'', items:[{nama:'Cuci',qty:1,satuan:'kg',harga:10000,subtotal:10000}], diskon:0, total:10000, dp:10000, status:'lunas', workStatus:'selesai', catatan:'', outletId:null },
        { id:'rp2', kode:'LND-3002', nama:'Hendra', hp:'081255554444', tanggal:'2026-09-08', estimasi:'', items:[{nama:'Setrika',qty:1,satuan:'kg',harga:9000,subtotal:9000}], diskon:0, total:9000, dp:9000, status:'lunas', workStatus:'selesai', catatan:'', outletId:null },
      ];
      openRekapPelanggan();
      document.getElementById('rekapNamaInput').value = 'Hendra';
      searchRekapPelanggan();
      const wa1 = rekapPelangganTextWA();
      if (!wa1.includes('Pelanggan') || !wa1.includes('Hendra')) throw new Error('nota rekap harus menyebut nama pelanggan: ' + wa1);
      if (!wa1.includes('Periode') || !wa1.includes('01 Sep 2026 - 08 Sep 2026')) throw new Error('nota rekap harus menyebut Periode sebagai rentang tanggal transaksi tercentang: ' + wa1);
      if (!wa1.includes('No. WhatsApp') || !wa1.includes('081255554444')) throw new Error('nota rekap harus menyebut No. WhatsApp kalau ada: ' + wa1);
      const pdf1 = buildRekapPelangganPDFLines().map(l => l.t).join(' | ');
      if (!pdf1.includes('Periode') || !pdf1.includes('01 Sep 2026 - 08 Sep 2026')) throw new Error('versi PDF/JPG juga harus menyebut Periode: ' + pdf1);
      if (!pdf1.includes('No. WhatsApp') || !pdf1.includes('081255554444')) throw new Error('versi PDF/JPG juga harus menyebut No. WhatsApp: ' + pdf1);
      closeRekapPelanggan();

      // Kasus TIDAK ada No. WA sama sekali -> baris No. WhatsApp tidak boleh ikut muncul
      transactions = [
        { id:'rp3', kode:'LND-3003', nama:'Wati', hp:'', tanggal:'2026-09-12', estimasi:'', items:[{nama:'Cuci',qty:1,satuan:'kg',harga:10000,subtotal:10000}], diskon:0, total:10000, dp:10000, status:'lunas', workStatus:'selesai', catatan:'', outletId:null },
      ];
      openRekapPelanggan();
      document.getElementById('rekapNamaInput').value = 'Wati';
      searchRekapPelanggan();
      const wa2 = rekapPelangganTextWA();
      if (wa2.includes('No. WhatsApp')) throw new Error('nota rekap TIDAK boleh menyebut No. WhatsApp kalau memang tidak ada nomornya di transaksi manapun: ' + wa2);
      // Cuma 1 tanggal -> Periode tampil sebagai satu tanggal, bukan rentang dengan tanda hubung
      if (!wa2.includes('Periode') || !wa2.includes('12 Sep 2026') || wa2.includes('12 Sep 2026 - 12 Sep 2026')) throw new Error('Periode untuk 1 transaksi seharusnya tanggal tunggal, bukan rentang: ' + wa2);
      closeRekapPelanggan();
    } finally {
      transactions = savedTransactions;
      currentOutletId = savedOutletId;
    }
  });

  await step('Rekap Transaksi Pelanggan: "+ Tambah Transaksi Baru" menyimpan lewat submitTransaction() asli (masuk ke transactions[] seperti transaksi normal), lalu otomatis kembali ke Rekap', async () => {
    const savedTransactions = transactions;
    const savedOutletId = currentOutletId;
    const savedDraftItems = draftItems;
    currentOutletId = null;
    transactions = [];
    try {
      openRekapPelanggan();
      document.getElementById('rekapNamaInput').value = 'Rina Baru';
      searchRekapPelanggan();
      if (document.getElementById('rekapStTrx').textContent !== '0') throw new Error('Rina Baru belum pernah bertransaksi, seharusnya 0');

      startRekapAddTransaction();
      if (rekapReturnPending !== true) throw new Error('rekapReturnPending seharusnya true setelah startRekapAddTransaction()');
      if (document.getElementById('rekapPelangganModal').classList.contains('show')) throw new Error('modal Rekap seharusnya tertutup dulu saat mulai tambah transaksi baru');
      if (currentTabName !== 'baru') throw new Error('startRekapAddTransaction() seharusnya pindah ke tab Transaksi Baru, got ' + currentTabName);
      if (document.getElementById('inNama').value !== 'Rina Baru') throw new Error('nama pelanggan seharusnya sudah terisi otomatis di form Transaksi Baru: ' + document.getElementById('inNama').value);

      // Isi seperti transaksi normal biasa, lalu simpan lewat submitTransaction() ASLI (bukan tiruan)
      document.getElementById('inTanggal').value = '2026-09-15';
      draftItems = [{ nama:'Cuci Setrika', qty:2, satuan:'kg', harga:8000, subtotal:16000 }];
      document.getElementById('inDiskon').value = '0';
      document.getElementById('inDP').value = '16000';
      document.getElementById('inStatus').value = 'lunas';
      await submitTransaction();

      const newTrx = transactions.find(x => x.nama === 'Rina Baru');
      if (!newTrx) throw new Error('transaksi yang ditambahkan dari Rekap seharusnya masuk ke transactions[] persis seperti transaksi normal (ikut Riwayat/Laporan)');
      if (newTrx.total !== 16000) throw new Error('total transaksi baru salah: ' + newTrx.total);
      if (newTrx.tanggal !== '2026-09-15') throw new Error('tanggal transaksi baru salah: ' + newTrx.tanggal);

      if (rekapReturnPending !== false) throw new Error('rekapReturnPending seharusnya sudah dikonsumsi (false) setelah tersimpan');
      if (!document.getElementById('rekapPelangganModal').classList.contains('show')) throw new Error('modal Rekap seharusnya otomatis terbuka lagi setelah transaksi baru tersimpan');
      if (document.getElementById('rekapStTrx').textContent !== '1') throw new Error('Rekap seharusnya langsung menampilkan transaksi yang baru ditambahkan: ' + document.getElementById('rekapStTrx').textContent);
      if (document.getElementById('rekapStTotal').textContent !== rupiah(16000)) throw new Error('Total Rekap setelah tambah transaksi baru salah: ' + document.getElementById('rekapStTotal').textContent);

      closeRekapPelanggan();
    } finally {
      transactions = savedTransactions;
      currentOutletId = savedOutletId;
      draftItems = savedDraftItems;
      rekapReturnPending = false;
    }
  });

  await step('Rekap Transaksi Pelanggan: kelebihan bayar (dp > total) di satu transaksi TIDAK BOLEH menutupi tagihan transaksi lain yang benar-benar belum dibayar (regresi bug nyata)', () => {
    // Skenario asli yang dilaporkan: 1 transaksi belum lunas TANPA dp sama sekali
    // (LND-0067 di dunia nyata), dan 1 transaksi lain yang dp-nya jauh melebihi
    // totalnya sendiri (kelebihan bayar besar). Rumus agregat lama
    // (totalKeseluruhan - sudahDibayar) membuat kelebihan bayar itu "menutupi"
    // tagihan yang sama sekali belum dibayar pada transaksi lain -- Belum Dibayar
    // tampil jauh lebih kecil dari kenyataan. Rumus yang benar (per-transaksi,
    // hanya yang statusnya "belum") tidak boleh ikut kena pengaruh itu.
    const savedTransactions = transactions;
    const savedOutletId = currentOutletId;
    currentOutletId = null;
    transactions = [
      { id:'bug1', kode:'LND-9001', nama:'Abid', hp:'083869942788', tanggal:'2026-09-11', estimasi:'', items:[{nama:'Bed cover',qty:1,satuan:'pcs',harga:81000,subtotal:81000}], diskon:0, total:81000, dp:70500, status:'belum', workStatus:'belum', catatan:'', outletId:null },
      { id:'bug2', kode:'LND-9002', nama:'Abid', hp:'083869942788', tanggal:'2026-09-14', estimasi:'', items:[{nama:'Cuci Sepatu',qty:1,satuan:'pasang',harga:88480,subtotal:88480}], diskon:0, total:88480, dp:0, status:'belum', workStatus:'belum', catatan:'', outletId:null },
      { id:'bug3', kode:'LND-9003', nama:'Abid', hp:'083869942788', tanggal:'2026-09-17', estimasi:'', items:[{nama:'Setrika',qty:1,satuan:'kg',harga:44000,subtotal:44000}], diskon:0, total:44000, dp:132480, status:'lunas', workStatus:'selesai', catatan:'', outletId:null },
    ];
    try {
      openRekapPelanggan();
      document.getElementById('rekapNamaInput').value = 'Abid';
      searchRekapPelanggan();
      // Semua 3 tercentang (default) -- total 81000+88480+44000 = 213480
      if (document.getElementById('rekapStTotal').textContent !== rupiah(213480)) throw new Error('Total Keseluruhan salah: ' + document.getElementById('rekapStTotal').textContent);
      // Sudah Dibayar = jumlah SEMUA dp apa adanya (70500+0+132480=202980) -- ini benar & tidak berubah
      if (document.getElementById('rekapStLunas').textContent !== rupiah(202980)) throw new Error('Sudah Dibayar salah: ' + document.getElementById('rekapStLunas').textContent);
      // Belum Dibayar HARUS dihitung dari LND-9001 (81000-70500=10500) + LND-9002 (88480-0=88480) = 98980,
      // BUKAN cuma 10500 (yang berarti kelebihan bayar LND-9003 salah menutupi tagihan LND-9002)
      if (document.getElementById('rekapStBelum').textContent !== rupiah(98980)) throw new Error('BUG: Belum Dibayar seharusnya Rp98.980 (tagihan LND-9002 yang sama sekali belum dibayar harus tetap kelihatan, tidak boleh tertutupi kelebihan bayar LND-9003 yang tidak berhubungan), got ' + document.getElementById('rekapStBelum').textContent);

      // Nota rekap juga harus konsisten dengan angka yang benar ini
      const wa = rekapPelangganTextWA();
      if (!wa.includes(rupiah(98980))) throw new Error('teks WA rekap tidak menyebut Belum Dibayar yang benar (98980): ' + wa);

      closeRekapPelanggan();
    } finally {
      transactions = savedTransactions;
      currentOutletId = savedOutletId;
    }
  });

  await step('Unduhan: saveToDownloadsGallery()/loadUnduhanList() menyimpan & membaca balik file dari IndexedDB, openUnduhanModal() menampilkannya, deleteUnduhanEntry() menghapusnya', async () => {
    const blob = new Blob(['isi tes'], { type: 'text/plain' });
    await saveToDownloadsGallery(blob, 'tes-unduhan-otomatis.txt');
    const items = await loadUnduhanList();
    if (items.length < 1 || items[0].filename !== 'tes-unduhan-otomatis.txt') throw new Error('saveToDownloadsGallery()/loadUnduhanList() tidak menyimpan entry dengan benar');
    if (!(items[0].blob instanceof Blob)) throw new Error('entry tersimpan tidak membawa blob asli');

    await openUnduhanModal();
    const list = document.getElementById('unduhanList');
    if (!list.querySelector('.item-line')) throw new Error('renderUnduhanList() tidak menampilkan entry yang baru disimpan');
    if (!list.textContent.includes('tes-unduhan-otomatis.txt')) throw new Error('nama file tidak muncul di daftar Unduhan');
    closeUnduhanModal();

    await deleteUnduhanEntry(items[0].id);
    const afterDelete = await loadUnduhanList();
    if (afterDelete.some(it => it.id === items[0].id)) throw new Error('deleteUnduhanEntry() tidak menghapus entry dari IndexedDB');
  });

  await step('Unduhan: tombol "Bagikan" ada di tiap baris, dan shareUnduhanEntry() memakai navigator.share() di HP MAUPUN desktop kalau didukung (TIDAK di-gate isMobileDevice() seperti shareOrDownloadNotaImage() -- filenya sudah tersimpan di galeri, jadi tidak butuh fallback simpan), baru unduh biasa kalau Web Share benar-benar tidak didukung', async () => {
    const blob = new Blob(['isi tes share'], { type: 'text/plain' });
    await saveToDownloadsGallery(blob, 'tes-share-unduhan.txt');
    const items = await loadUnduhanList();
    const entryId = items[0].id;

    await openUnduhanModal();
    const list = document.getElementById('unduhanList');
    if (!list.innerHTML.includes(`shareUnduhanEntry('${entryId}')`)) throw new Error('tombol Bagikan (shareUnduhanEntry) tidak ada di baris entry: ' + list.innerHTML);
    closeUnduhanModal();

    const originalCanShare = navigator.canShare;
    const originalShare = navigator.share;
    const originalCreateElement = document.createElement.bind(document);
    let shareCalls = 0;
    let clickedDownloads = [];
    document.createElement = (tag) => {
      const el = originalCreateElement(tag);
      if (tag === 'a') {
        const originalClick = el.click.bind(el);
        el.click = () => { clickedDownloads.push(el.download); originalClick(); };
      }
      return el;
    };
    const setUA = (ua) => Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
    try {
      // HP: Web Share didukung -> harus pakai navigator.share(), TIDAK unduh
      setUA('Mozilla/5.0 (Linux; Android 13; SM-A125F) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36');
      navigator.canShare = () => true;
      navigator.share = async () => { shareCalls++; };
      shareCalls = 0; clickedDownloads = [];
      await shareUnduhanEntry(entryId);
      if (shareCalls !== 1) throw new Error('HP seharusnya memakai navigator.share(), got shareCalls=' + shareCalls);
      if (clickedDownloads.length !== 0) throw new Error('HP seharusnya TIDAK ikut memicu <a download>.click() kalau navigator.share() jalan');

      // Desktop TAPI Web Share didukung (Chrome/Edge Windows modern) -> harus TETAP
      // pakai navigator.share() juga, BUKAN unduh biasa -- ini bug nyata yang dilaporkan
      // user (tombol "Bagikan" di desktop cuma mengunduh ulang, tidak benar-benar share).
      setUA('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36');
      shareCalls = 0; clickedDownloads = [];
      await shareUnduhanEntry(entryId);
      if (shareCalls !== 1) throw new Error('BUG: desktop yang mendukung Web Share API harus tetap pakai navigator.share(), bukan cuma unduh ulang, got shareCalls=' + shareCalls);
      if (clickedDownloads.length !== 0) throw new Error('desktop yang mendukung Web Share seharusnya TIDAK ikut mengunduh ulang: ' + JSON.stringify(clickedDownloads));

      // Desktop DAN Web Share TIDAK didukung sama sekali -> baru fallback unduh biasa
      navigator.canShare = undefined;
      navigator.share = undefined;
      shareCalls = 0; clickedDownloads = [];
      await shareUnduhanEntry(entryId);
      if (clickedDownloads.length !== 1 || clickedDownloads[0] !== 'tes-share-unduhan.txt') throw new Error('kalau Web Share benar-benar tidak didukung, seharusnya fallback unduh biasa dengan nama file asli, got ' + JSON.stringify(clickedDownloads));
    } finally {
      navigator.canShare = originalCanShare;
      navigator.share = originalShare;
      document.createElement = originalCreateElement;
      delete navigator.userAgent;
      await deleteUnduhanEntry(entryId);
    }
  });

  return out;
});

console.log('--- feature smoke test steps ---');
result.steps.forEach(s => console.log(s));
if (result.errors.length) {
  console.log('--- feature smoke test FAILURES ---');
  result.errors.forEach(e => console.log(e));
}

console.log('--- console/page errors captured throughout ---');
console.log(errors.length ? errors.join('\n') : '(none)');

await browser.close();
process.exit(result.errors.length || 0);
