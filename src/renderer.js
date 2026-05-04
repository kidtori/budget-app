// ── State ──────────────────────────────────────────────────────────────────
let data = {
  banks: [],
  expenses: [],
  categories: [],
  exchangeRates: { EUR: 1, USD: 0.92, GBP: 1.17 },
  preferredCurrency: 'EUR'
};

const CURRENCIES = ['EUR', 'USD', 'GBP'];
const CURRENCY_SYMBOLS = { EUR: '€', USD: '$', GBP: '£' };

const DEFAULT_CATEGORIES = [
  { id: 'cat-housing',       name: 'Housing'       },
  { id: 'cat-entertainment', name: 'Entertainment'  }
];

const CAT_COLORS = [
  { bg: '#eef2ff', fg: '#4f6ef7', border: '#c0ccf8' },
  { bg: '#f0fdf4', fg: '#16a34a', border: '#86efac' },
  { bg: '#fef3c7', fg: '#d97706', border: '#fcd34d' },
  { bg: '#fdf4ff', fg: '#9333ea', border: '#d8b4fe' },
  { bg: '#f0f9ff', fg: '#0891b2', border: '#a5f3fc' },
  { bg: '#fff1f2', fg: '#e11d48', border: '#fecdd3' },
  { bg: '#f0fdfa', fg: '#0d9488', border: '#99f6e4' },
  { bg: '#fffbeb', fg: '#b45309', border: '#fde68a' },
];

const collapsed = new Set();
let _editingExpenseId = null;
let expenseTab = 'upcoming';
let wishSort = { col: 'name', dir: 'asc' };
let appStarted = false;
let authPreparedClientId = '';
const AUTH_UNLOCK_KEY = 'budget.auth.unlocked';

// ── Bootstrap ──────────────────────────────────────────────────────────────
async function init() {
  window.dataStore?.onStatus(renderSyncStatus);
  setupAuthGate();

  if (shouldShowAuthGate()) {
    showAuthGate();
    return;
  }

  await startApp();
}

function shouldShowAuthGate() {
  if (window.api) return false;
  return localStorage.getItem(AUTH_UNLOCK_KEY) !== 'true';
}

async function startApp(options = {}) {
  if (appStarted && !options.reloadData) return;
  const loaded = await window.dataStore?.load();
  if (loaded) data = loaded;

  applyDataDefaults();
  processRecurringExpenses();

  render();
  navigateTo('budget');
  hideAuthGate();
  appStarted = true;
  document.getElementById('btn-lock-app').style.display = window.api ? 'none' : '';
}

function setupAuthGate() {
  const info = window.dataStore?.getInfo?.();
  const input = document.getElementById('auth-google-client-id');
  const saveKeyBtn = document.getElementById('btn-auth-save-key');
  const googleBtn = document.getElementById('btn-auth-google');
  const localBtn = document.getElementById('btn-auth-local');
  const env = document.getElementById('auth-env');
  if (input && info?.clientId) input.value = info.clientId;
  if (env && info) {
    env.textContent = info.nativeAuthAvailable
      ? 'Android app sign-in bridge detected.'
      : info.androidWebView
        ? 'Android app detected, but the sign-in bridge is missing. Install the newest APK if sign-in fails.'
        : 'Browser sign-in mode.';
  }
  input?.addEventListener('input', () => {
    if (googleBtn) googleBtn.disabled = input.value.trim() !== authPreparedClientId;
  });
  if (localBtn && !['localhost', '127.0.0.1', ''].includes(location.hostname)) {
    localBtn.style.display = 'none';
  }

  saveKeyBtn?.addEventListener('click', prepareGoogleLogin);
  googleBtn?.addEventListener('click', unlockWithGoogle);
  document.getElementById('btn-auth-local')?.addEventListener('click', async () => {
    rememberAuthUnlock();
    await startApp();
  });
  document.getElementById('btn-lock-app')?.addEventListener('click', () => {
    forgetAuthUnlock();
    location.reload();
  });
}

function rememberAuthUnlock() {
  localStorage.setItem(AUTH_UNLOCK_KEY, 'true');
}

function forgetAuthUnlock() {
  localStorage.removeItem(AUTH_UNLOCK_KEY);
  sessionStorage.removeItem(AUTH_UNLOCK_KEY);
}

async function prepareGoogleLogin() {
  const input = document.getElementById('auth-google-client-id');
  const clientId = input.value.trim();
  const saveKeyBtn = document.getElementById('btn-auth-save-key');
  const googleBtn = document.getElementById('btn-auth-google');

  if (!clientId) {
    showAuthGate('Paste your Google OAuth Client ID first.');
    return;
  }

  saveKeyBtn.disabled = true;
  saveKeyBtn.textContent = 'Loading...';

  try {
    window.dataStore.configureGoogle(clientId);
    await window.dataStore.prepareGoogleAuth();
    authPreparedClientId = clientId;
    if (googleBtn) googleBtn.disabled = false;
    showAuthGate('Google services are ready. Now tap Sign in with Google.', 'ready');
  } catch (err) {
    authPreparedClientId = '';
    if (googleBtn) googleBtn.disabled = true;
    showAuthGate(err.message || 'Could not load Google sign-in.');
  } finally {
    saveKeyBtn.disabled = false;
    saveKeyBtn.textContent = 'Save key';
  }
}

function showAuthGate(message = '', type = 'error') {
  const gate = document.getElementById('auth-gate');
  const err = document.getElementById('auth-error');
  gate.classList.add('active');
  document.getElementById('shell').setAttribute('aria-hidden', 'true');
  if (err) {
    err.textContent = message;
    err.classList.toggle('active', Boolean(message));
    err.classList.toggle('ready', type === 'ready');
  }
}

function hideAuthGate() {
  document.getElementById('auth-gate').classList.remove('active');
  document.getElementById('shell').removeAttribute('aria-hidden');
}

async function unlockWithGoogle() {
  const input = document.getElementById('auth-google-client-id');
  const clientId = input.value.trim();
  if (!clientId) {
    showAuthGate('Paste your Google OAuth Client ID first.');
    return;
  }

  const btn = document.getElementById('btn-auth-google');
  if (clientId !== authPreparedClientId) {
    btn.disabled = true;
    showAuthGate('Save the key first, then tap Sign in with Google.');
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Signing in...';

  try {
    const result = await window.dataStore.connectGoogle(data);
    if (result?.data) data = result.data;
    rememberAuthUnlock();
    await startApp({ reloadData: false });
  } catch (err) {
    showAuthGate(err.message || 'Could not sign in with Google.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sign in with Google';
  }
}

function applyDataDefaults() {
  if (!Array.isArray(data.expenses))       data.expenses       = [];
  if (!Array.isArray(data.categories))     data.categories     = DEFAULT_CATEGORIES.map(c => ({ ...c }));
  if (!Array.isArray(data.expenseHistory)) data.expenseHistory = [];
  if (!Array.isArray(data.wishlist))       data.wishlist       = [];
  if (!data.settings)                      data.settings       = {};
}

function save() {
  window.dataStore?.save(data).catch(err => {
    console.error('[budget] save failed', err);
    renderSyncStatus({
      status: 'Save failed',
      detail: err.message || 'Could not save data'
    });
  });
}

function renderSyncStatus(info = window.dataStore?.getInfo?.()) {
  if (!info) return;
  const badges = [
    document.getElementById('sync-status-badge'),
    document.getElementById('sync-status-badge-settings')
  ].filter(Boolean);
  const detail = document.getElementById('sync-status-detail');
  const clientInput = document.getElementById('google-client-id');
  const oneDriveClientInput = document.getElementById('onedrive-client-id');
  const modeText = document.getElementById('sync-mode-label');
  const connectBtn = document.getElementById('btn-google-connect');
  const pullBtn = document.getElementById('btn-google-pull');
  const disconnectBtn = document.getElementById('btn-google-disconnect');
  const oneDriveConnectBtn = document.getElementById('btn-onedrive-connect');
  const oneDrivePullBtn = document.getElementById('btn-onedrive-pull');

  for (const badge of badges) {
    badge.textContent = info.status || 'Local only';
    badge.className = 'sync-badge';
    if (info.status?.toLowerCase().includes('synced') || info.status?.toLowerCase().includes('connected')) {
      badge.classList.add('sync-good');
    } else if (info.status?.toLowerCase().includes('conflict') || info.status?.toLowerCase().includes('failed')) {
      badge.classList.add('sync-warn');
    }
  }
  const modeDetail = info.mode === 'google'
    ? 'Google Drive appDataFolder'
    : info.mode === 'onedrive'
      ? 'OneDrive app folder'
      : 'This device only';
  if (detail) detail.textContent = info.detail || modeDetail;
  if (clientInput && document.activeElement !== clientInput) clientInput.value = info.clientId || '';
  if (oneDriveClientInput && document.activeElement !== oneDriveClientInput) oneDriveClientInput.value = info.oneDriveClientId || '';
  if (modeText) modeText.textContent = info.mode === 'google' ? 'Google Drive' : info.mode === 'onedrive' ? 'OneDrive' : 'Local';
  if (connectBtn) connectBtn.textContent = info.signedIn ? 'Reconnect Google' : 'Connect Google';
  if (pullBtn) pullBtn.disabled = !info.clientId;
  if (oneDriveConnectBtn) oneDriveConnectBtn.textContent = info.signedIn && info.mode === 'onedrive' ? 'Reconnect OneDrive' : 'Connect OneDrive';
  if (oneDrivePullBtn) oneDrivePullBtn.disabled = !info.oneDriveClientId;
  if (disconnectBtn) disconnectBtn.disabled = info.mode === 'local';
}

// ── Utils ──────────────────────────────────────────────────────────────────
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function toEUR(amount, currency) {
  return amount * (data.exchangeRates[currency] ?? 1);
}

function fmtCurrency(n, currency) {
  const sym = CURRENCY_SYMBOLS[currency] || currency + ' ';
  return sym + n.toLocaleString('en-IE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtEUR(n) {
  return '€' + n.toLocaleString('en-IE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function bankTotalEUR(bank) {
  return bank.accounts.reduce((s, a) => s + toEUR(a.balance, a.currency), 0);
}

function grandTotal() {
  return data.banks.reduce((s, b) => s + bankTotalEUR(b), 0);
}

function bankInitials(name) {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getCatColor(catId) {
  const idx = data.categories.findIndex(c => c.id === catId);
  return CAT_COLORS[Math.max(0, idx) % CAT_COLORS.length];
}

function getAccountLabel(bankId, accountId) {
  const bank = data.banks.find(b => b.id === bankId);
  if (!bank) return '—';
  const acc = bank.accounts.find(a => a.id === accountId);
  return acc ? `${bank.name} · ${acc.name}` : bank.name;
}

function dateStatus(dateStr) {
  if (!dateStr) return 'ok';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + 'T00:00:00');
  const diff = Math.round((d - today) / 86400000);
  if (diff < 0)  return 'overdue';
  if (diff <= 7) return 'soon';
  return 'ok';
}

function fmtDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-IE', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Advance a date forward by whole months until it's today or in the future
function advanceDDDate(dateStr) {
  if (!dateStr) return dateStr;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + 'T00:00:00');
  while (d < today) d.setMonth(d.getMonth() + 1);
  return dateFmt(d);
}

function dateFmt(d) {
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, '0');
  const dy = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dy}`;
}

// On load (and when navigating to expenses), roll any recurring expenses whose
// nextDate has passed: record each missed occurrence to history, advance to future.
function processRecurringExpenses() {
  if (!Array.isArray(data.expenseHistory)) data.expenseHistory = [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let changed = false;

  for (const exp of data.expenses) {
    if (!exp.isRecurring || !exp.nextDate) continue;
    const d = new Date(exp.nextDate + 'T00:00:00');
    if (d >= today) continue; // nothing to do

    // Roll forward, recording each past occurrence
    let cur = new Date(d);
    while (cur < today) {
      data.expenseHistory.push({
        id: uid(),
        expenseId:    exp.id,
        name:         exp.name,
        amount:       exp.amount,
        currency:     exp.currency,
        date:         dateFmt(cur),
        bankId:       exp.bankId,
        accountId:    exp.accountId,
        categoryId:   exp.categoryId,
        isDirectDebit: exp.isDirectDebit
      });
      cur.setMonth(cur.getMonth() + 1);
    }
    exp.nextDate = dateFmt(cur);
    exp.isPaid   = false; // reset paid flag for the new cycle
    changed = true;
  }

  if (changed) save();
}

// ── Render (accounts) ──────────────────────────────────────────────────────
function render() {
  renderSummary();
  renderBanks();
}

function renderSummary() {
  document.getElementById('total-value').textContent = fmtEUR(grandTotal());

  const totals = {};
  for (const bank of data.banks)
    for (const acc of bank.accounts)
      totals[acc.currency] = (totals[acc.currency] || 0) + acc.balance;

  const bEl = document.getElementById('breakdown-items');
  bEl.innerHTML = '';
  if (Object.keys(totals).length === 0) {
    bEl.innerHTML = '<span style="font-size:12px;color:var(--text-3)">No accounts yet</span>';
  } else {
    for (const [cur, amt] of Object.entries(totals)) {
      const row = document.createElement('div');
      row.className = 'breakdown-row';
      row.innerHTML = `
        <span class="breakdown-currency">${escHtml(cur)}</span>
        <span class="breakdown-amount">${fmtCurrency(amt, cur)}</span>
      `;
      bEl.appendChild(row);
    }
  }

  const rEl = document.getElementById('rates-items');
  rEl.innerHTML = '';
  for (const [cur, rate] of Object.entries(data.exchangeRates)) {
    if (cur === 'EUR') continue;
    const row = document.createElement('div');
    row.className = 'rate-row';
    row.innerHTML = `
      <span class="rate-pair">1 ${escHtml(cur)} =</span>
      <span class="rate-value" data-currency="${escHtml(cur)}">${rate.toFixed(4)} EUR</span>
    `;
    rEl.appendChild(row);
    row.querySelector('.rate-value').addEventListener('click', (e) => {
      startInlineRateEdit(e.target, cur);
    });
  }
}

function renderBanks() {
  const grid  = document.getElementById('banks-grid');
  const empty = document.getElementById('empty-state');
  grid.innerHTML = '';

  if (data.banks.length === 0) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');

  for (const bank of data.banks) grid.appendChild(makeBankCard(bank));
}

// ── Bank card ──────────────────────────────────────────────────────────────
function makeBankCard(bank) {
  const isOpen = !collapsed.has(bank.id);
  const total  = bankTotalEUR(bank);
  const count  = bank.accounts.length;

  const card = document.createElement('div');
  card.className = 'bank-card';
  card.dataset.bankId = bank.id;

  const header = document.createElement('div');
  header.className = 'bank-card-header';
  header.innerHTML = `
    <div class="bank-header-left">
      <div class="bank-icon">${escHtml(bankInitials(bank.name))}</div>
      <div class="bank-info">
        <span class="bank-name-text editable-text" data-bank-id="${escHtml(bank.id)}">${escHtml(bank.name)}</span>
        <span class="bank-account-count">${count} account${count !== 1 ? 's' : ''}</span>
      </div>
    </div>
    <div class="bank-header-right">
      <span class="bank-total-badge">${fmtEUR(total)}</span>
      <button class="bank-delete-btn" data-action="delete-bank" title="Delete bank">×</button>
      <span class="bank-chevron ${isOpen ? 'open' : ''}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </span>
    </div>
  `;

  header.addEventListener('click', (e) => {
    if (e.target.closest('.bank-name-text') || e.target.closest('.bank-delete-btn')) return;
    if (collapsed.has(bank.id)) collapsed.delete(bank.id); else collapsed.add(bank.id);
    render();
  });

  header.querySelector('.bank-name-text').addEventListener('click', (e) => {
    e.stopPropagation();
    startInlineText(e.target, bank.name, (val) => {
      if (val.trim()) { bank.name = val.trim(); save(); render(); }
    });
  });

  header.querySelector('[data-action="delete-bank"]').addEventListener('click', (e) => {
    e.stopPropagation();
    const msg = bank.accounts.length > 0
      ? `Delete "${bank.name}" and its ${bank.accounts.length} account(s)?`
      : `Delete "${bank.name}"?`;
    if (!confirm(msg)) return;
    data.banks = data.banks.filter(b => b.id !== bank.id);
    save(); render();
  });

  card.appendChild(header);

  const list = document.createElement('div');
  list.className = 'account-list' + (isOpen ? '' : ' collapsed');

  if (isOpen && bank.accounts.length > 0) {
    const lblRow = document.createElement('div');
    lblRow.className = 'account-list-header';
    lblRow.innerHTML = `
      <span class="acc-col-label">Account</span>
      <span class="acc-col-label">Currency</span>
      <span class="acc-col-label right">Balance</span>
      <span class="acc-col-label right">In EUR</span>
      <span></span>
    `;
    list.appendChild(lblRow);
  }

  for (const acc of bank.accounts) list.appendChild(makeAccountRow(bank, acc));

  const addRow = document.createElement('div');
  addRow.className = 'add-account-row';
  addRow.innerHTML = `
    <button class="btn-add-account">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      Add account
    </button>
  `;
  addRow.querySelector('.btn-add-account').addEventListener('click', () => showAddAccountModal(bank));
  list.appendChild(addRow);

  card.appendChild(list);
  return card;
}

// ── Account row ────────────────────────────────────────────────────────────
function makeAccountRow(bank, acc) {
  const converted = toEUR(acc.balance, acc.currency);

  const row = document.createElement('div');
  row.className = 'account-row';
  row.dataset.accId = acc.id;
  row.innerHTML = `
    <span class="acc-name editable-text" data-field="name">${escHtml(acc.name)}</span>
    <span class="acc-currency-pill" data-field="currency">${escHtml(acc.currency)}</span>
    <span class="acc-balance-cell" data-field="balance">${fmtCurrency(acc.balance, acc.currency)}</span>
    <span class="acc-converted-cell">${acc.currency !== 'EUR' ? fmtEUR(converted) : '—'}</span>
    <button class="acc-delete-btn" title="Delete account">×</button>
  `;

  row.querySelector('[data-field="name"]').addEventListener('click', (e) => {
    startInlineText(e.target, acc.name, (val) => {
      if (val.trim()) { acc.name = val.trim(); save(); render(); }
    });
  });

  row.querySelector('[data-field="currency"]').addEventListener('click', (e) => {
    startInlineCurrency(e.target, acc.currency, (val) => {
      acc.currency = val; save(); render();
    });
  });

  row.querySelector('[data-field="balance"]').addEventListener('click', (e) => {
    startInlineNumber(e.target, acc.balance, (val) => {
      if (!isNaN(val)) { acc.balance = val; save(); render(); }
    });
  });

  row.querySelector('.acc-delete-btn').addEventListener('click', () => {
    bank.accounts = bank.accounts.filter(a => a.id !== acc.id);
    save(); render();
  });

  return row;
}

// ── Inline editors ─────────────────────────────────────────────────────────
function startInlineText(el, current, onCommit) {
  if (el.querySelector('input')) return;
  const saved = el.innerHTML;
  const input = document.createElement('input');
  input.className = 'inline-input';
  input.value = current;
  el.innerHTML = '';
  el.appendChild(input);
  input.focus(); input.select();

  let committed = false;
  function commit() { if (committed) return; committed = true; onCommit(input.value); }
  function cancel() { if (committed) return; committed = true; el.innerHTML = saved; }

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter')  { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.removeEventListener('blur', commit); cancel(); }
  });
}

function startInlineNumber(el, current, onCommit) {
  if (el.querySelector('input')) return;
  const input = document.createElement('input');
  input.className = 'inline-input num';
  input.type = 'number'; input.step = '0.01'; input.value = current;
  el.innerHTML = '';
  el.appendChild(input);
  input.focus(); input.select();

  let committed = false;
  function commit() { if (committed) return; committed = true; onCommit(parseFloat(input.value)); }
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter')  { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.removeEventListener('blur', commit); render(); committed = true; }
  });
}

function startInlineCurrency(el, current, onCommit) {
  if (document.querySelector('.currency-dropdown')) return;
  el.classList.add('currency-pill-open');

  const dropdown = document.createElement('div');
  dropdown.className = 'currency-dropdown';

  for (const c of CURRENCIES) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'currency-option' + (c === current ? ' active' : '');
    item.textContent = c;
    item.addEventListener('mousedown', (e) => {
      e.preventDefault();
      cleanup();
      if (c !== current) onCommit(c); else render();
    });
    dropdown.appendChild(item);
  }

  const rect = el.getBoundingClientRect();
  dropdown.style.top  = (rect.bottom + window.scrollY + 4) + 'px';
  dropdown.style.left = rect.left + 'px';
  document.body.appendChild(dropdown);

  function cleanup() {
    dropdown.remove();
    el.classList.remove('currency-pill-open');
    document.removeEventListener('mousedown', onOutside);
    document.removeEventListener('keydown', onKey);
  }
  function onOutside(e) { if (!dropdown.contains(e.target) && e.target !== el) { cleanup(); render(); } }
  function onKey(e)     { if (e.key === 'Escape') { cleanup(); render(); } }

  setTimeout(() => {
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('keydown', onKey);
  }, 0);
}

function startInlineRateEdit(el, currency) {
  if (el.querySelector('input')) return;
  const current = data.exchangeRates[currency];
  const input = document.createElement('input');
  input.className = 'inline-input num';
  input.type = 'number'; input.step = '0.0001'; input.min = '0.0001';
  input.value = current; input.style.width = '90px';
  el.innerHTML = ''; el.appendChild(input);
  input.focus(); input.select();

  let committed = false;
  function commit() {
    if (committed) return; committed = true;
    const val = parseFloat(input.value);
    if (val > 0) { data.exchangeRates[currency] = val; save(); }
    render();
  }
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter')  { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.removeEventListener('blur', commit); render(); committed = true; }
  });
}

// ── Generic Modal ──────────────────────────────────────────────────────────
let _modalCallback = null;

function showModal({ title, fields, confirmLabel = 'Add', onConfirm }) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-confirm').textContent = confirmLabel;

  const fieldsEl = document.getElementById('modal-fields');
  fieldsEl.innerHTML = '';

  for (const f of fields) {
    const wrap = document.createElement('div');
    wrap.className = 'field-row';

    const label = document.createElement('label');
    label.textContent = f.label;
    label.setAttribute('for', 'field-' + f.name);

    let input;
    if (f.type === 'select') {
      input = document.createElement('select');
      for (const opt of f.options) {
        const o = document.createElement('option');
        o.value = opt; o.textContent = opt;
        input.appendChild(o);
      }
    } else {
      input = document.createElement('input');
      input.type = f.type || 'text';
      if (f.placeholder) input.placeholder = f.placeholder;
      if (f.step)        input.step = f.step;
      if (f.min != null) input.min = f.min;
    }

    input.name = f.name;
    input.id = 'field-' + f.name;
    if (f.value != null) input.value = f.value;

    wrap.appendChild(label);
    wrap.appendChild(input);
    fieldsEl.appendChild(wrap);
  }

  _modalCallback = onConfirm;
  document.getElementById('modal-overlay').classList.remove('hidden');
  setTimeout(() => { const first = fieldsEl.querySelector('input, select'); if (first) first.focus(); }, 60);
}

function hideModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  _modalCallback = null;
}

function showAddBankModal() {
  showModal({
    title: 'Add bank',
    fields: [{ name: 'name', label: 'Bank name', placeholder: 'e.g. ING, Revolut, Chase' }],
    onConfirm: ({ name }) => {
      if (!name.trim()) return;
      data.banks.push({ id: uid(), name: name.trim(), accounts: [] });
      save(); render();
    }
  });
}

function showAddAccountModal(bank) {
  showModal({
    title: `Add account — ${bank.name}`,
    fields: [
      { name: 'name',     label: 'Account name', placeholder: 'e.g. Current, Savings' },
      { name: 'currency', label: 'Currency',      type: 'select', options: CURRENCIES },
      { name: 'balance',  label: 'Balance',       type: 'number', placeholder: '0.00', step: '0.01', min: 0, value: '0' }
    ],
    onConfirm: ({ name, currency, balance }) => {
      if (!name.trim()) return;
      bank.accounts.push({ id: uid(), name: name.trim(), currency, balance: parseFloat(balance) || 0 });
      save(); render();
    }
  });
}

document.getElementById('btn-add-bank').addEventListener('click', showAddBankModal);
document.getElementById('modal-cancel').addEventListener('click', hideModal);
document.getElementById('modal-close').addEventListener('click', hideModal);
document.getElementById('modal-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'modal-overlay') hideModal();
});
document.getElementById('modal-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!_modalCallback) return;
  const values = {};
  document.getElementById('modal-form').querySelectorAll('input, select').forEach(el => {
    values[el.name] = el.value;
  });
  _modalCallback(values);
  hideModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { hideModal(); hideExpenseModal(); }
});

// ── Expenses ───────────────────────────────────────────────────────────────
function renderExpenses() {
  processRecurringExpenses();
  renderExpSummary();

  const isHistory = expenseTab === 'history';

  // Toggle the two content areas
  document.getElementById('expense-rows').style.display          = isHistory ? 'none' : '';
  document.getElementById('expense-history-rows').style.display  = isHistory ? ''     : 'none';

  if (isHistory) {
    document.getElementById('expense-list-header').classList.add('hidden');
    document.getElementById('exp-empty-state').classList.add('hidden');
    renderExpHistory();
  } else {
    document.getElementById('expense-history-header').classList.add('hidden');
    document.getElementById('exp-history-empty-state').classList.add('hidden');
    renderExpList();
  }
}

function renderExpSummary() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let totalEUR = 0, ddCount = 0, overdueCount = 0;

  for (const exp of data.expenses) {
    totalEUR += toEUR(exp.amount || 0, exp.currency || 'EUR');
    if (exp.isDirectDebit) ddCount++;
    if (exp.nextDate && new Date(exp.nextDate + 'T00:00:00') < today) overdueCount++;
  }

  document.getElementById('exp-total-value').textContent = fmtEUR(totalEUR);
  document.getElementById('exp-count-value').textContent = data.expenses.length;
  document.getElementById('exp-dd-value').textContent    = ddCount + ' direct debit' + (ddCount !== 1 ? 's' : '');

  const ovEl = document.getElementById('exp-overdue-value');
  ovEl.textContent  = overdueCount;
  ovEl.style.color  = overdueCount > 0 ? 'var(--red)' : 'var(--green)';
}

function renderExpList() {
  const rows   = document.getElementById('expense-rows');
  const header = document.getElementById('expense-list-header');
  const empty  = document.getElementById('exp-empty-state');

  rows.innerHTML = '';

  if (data.expenses.length === 0) {
    empty.classList.remove('hidden');
    header.classList.add('hidden');
    return;
  }

  empty.classList.add('hidden');
  header.classList.remove('hidden');

  const sorted = [...data.expenses].sort((a, b) => {
    if (!a.nextDate) return 1;
    if (!b.nextDate) return -1;
    return new Date(a.nextDate) - new Date(b.nextDate);
  });

  for (const exp of sorted) rows.appendChild(makeExpenseRow(exp));
}

function makeExpenseRow(exp) {
  const color  = getCatColor(exp.categoryId);
  const cat    = data.categories.find(c => c.id === exp.categoryId);
  const status = dateStatus(exp.nextDate);

  const row = document.createElement('div');
  row.className = 'expense-row';
  row.dataset.expId = exp.id;
  row.style.borderLeftColor = color.fg;

  const dateClass = status === 'overdue' ? 'exp-date-overdue'
                  : status === 'soon'    ? 'exp-date-soon'
                  : 'exp-date-ok';

  const statusCell = exp.isDirectDebit
    ? `<span class="dd-badge">DD</span>`
    : `<input type="checkbox" class="exp-paid-cb" ${exp.isPaid ? 'checked' : ''} title="${exp.isPaid ? 'Paid' : 'Mark as paid'}" />`;

  const amtLine2 = exp.currency !== 'EUR'
    ? `<div class="exp-amount-sub">${fmtEUR(toEUR(exp.amount || 0, exp.currency))}</div>`
    : '';

  const recurText = exp.isRecurring ? ' · <span class="recurring-badge">↻ monthly</span>' : '';

  const catPill = cat
    ? `<span class="exp-cat-pill" style="background:${color.bg};color:${color.fg};border-color:${color.border}">${escHtml(cat.name)}</span>`
    : '';

  row.innerHTML = `
    <div class="exp-status-cell">${statusCell}</div>
    <div class="exp-name-cell">
      <span class="exp-name">${escHtml(exp.name)}</span>
      <span class="exp-sub">${escHtml(getAccountLabel(exp.bankId, exp.accountId))}${recurText}</span>
    </div>
    <div class="exp-date-cell ${dateClass}">${escHtml(fmtDate(exp.nextDate))}</div>
    <div class="exp-amount-cell">
      <div>${escHtml(fmtCurrency(exp.amount || 0, exp.currency || 'EUR'))}</div>
      ${amtLine2}
    </div>
    <div class="exp-cat-cell">${catPill}</div>
    <div class="exp-actions">
      <button class="exp-edit-btn" title="Edit">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </button>
      <button class="exp-delete-btn" title="Delete">×</button>
    </div>
  `;

  const cb = row.querySelector('.exp-paid-cb');
  if (cb) {
    cb.addEventListener('change', () => {
      exp.isPaid = cb.checked;
      save();
      renderExpSummary();
    });
  }

  row.querySelector('.exp-edit-btn').addEventListener('click', () => showExpenseModal(exp));

  row.querySelector('.exp-delete-btn').addEventListener('click', () => {
    if (!confirm(`Delete "${exp.name}"?`)) return;
    data.expenses = data.expenses.filter(e => e.id !== exp.id);
    save();
    renderExpenses();
  });

  return row;
}

function renderExpHistory() {
  const rows   = document.getElementById('expense-history-rows');
  const header = document.getElementById('expense-history-header');
  const empty  = document.getElementById('exp-history-empty-state');

  rows.innerHTML = '';

  if (data.expenseHistory.length === 0) {
    header.classList.add('hidden');
    empty.classList.remove('hidden');
    return;
  }

  header.classList.remove('hidden');
  empty.classList.add('hidden');

  // Newest first
  const sorted = [...data.expenseHistory].sort((a, b) => new Date(b.date) - new Date(a.date));
  for (const entry of sorted) rows.appendChild(makeHistoryRow(entry));
}

function makeHistoryRow(entry) {
  const color = getCatColor(entry.categoryId);
  const cat   = data.categories.find(c => c.id === entry.categoryId);

  const row = document.createElement('div');
  row.className = 'history-row';
  row.style.borderLeftColor = color.fg;

  const catPill = cat
    ? `<span class="exp-cat-pill" style="background:${color.bg};color:${color.fg};border-color:${color.border}">${escHtml(cat.name)}</span>`
    : '';

  const amtLine2 = entry.currency !== 'EUR'
    ? `<div class="exp-amount-sub">${fmtEUR(toEUR(entry.amount || 0, entry.currency))}</div>`
    : '';

  row.innerHTML = `
    <div class="history-date">${escHtml(fmtDate(entry.date))}</div>
    <div class="exp-name-cell">
      <span class="exp-name">${escHtml(entry.name)}</span>
      <span class="exp-sub">${escHtml(getAccountLabel(entry.bankId, entry.accountId))}</span>
    </div>
    <div class="exp-amount-cell">
      <div>${escHtml(fmtCurrency(entry.amount || 0, entry.currency || 'EUR'))}</div>
      ${amtLine2}
    </div>
    <div class="exp-cat-cell">${catPill}</div>
  `;
  return row;
}

// ── Expense modal ──────────────────────────────────────────────────────────
function showExpenseModal(expense = null) {
  _editingExpenseId = expense ? expense.id : null;

  // Title + confirm button label
  document.getElementById('exp-modal-title').textContent    = expense ? 'Edit expense'  : 'Add expense';
  document.getElementById('exp-modal-confirm').textContent  = expense ? 'Save changes'  : 'Add expense';

  // Bank select
  const bankSel = document.getElementById('exp-bank');
  bankSel.innerHTML = '';
  if (data.banks.length === 0) {
    bankSel.innerHTML = '<option value="">— no banks added —</option>';
    bankSel.disabled = true;
    const accSel = document.getElementById('exp-account');
    accSel.innerHTML = '<option value="">—</option>';
    accSel.disabled = true;
  } else {
    bankSel.disabled = false;
    for (const b of data.banks) {
      const o = document.createElement('option');
      o.value = b.id; o.textContent = b.name;
      bankSel.appendChild(o);
    }
    // When editing, pre-select the right bank; otherwise default to first
    const targetBank = expense
      ? (data.banks.find(b => b.id === expense.bankId) || data.banks[0])
      : data.banks[0];
    bankSel.value = targetBank.id;
    populateExpAccountSelect(targetBank, expense ? expense.accountId : null);
  }

  // Currency select
  const curSel = document.getElementById('exp-currency');
  curSel.innerHTML = '';
  for (const c of CURRENCIES) {
    const o = document.createElement('option');
    o.value = c; o.textContent = c;
    curSel.appendChild(o);
  }

  // Category select
  const catSel = document.getElementById('exp-category');
  catSel.innerHTML = '';
  if (data.categories.length === 0) {
    catSel.innerHTML = '<option value="">— no categories —</option>';
  } else {
    for (const cat of data.categories) {
      const o = document.createElement('option');
      o.value = cat.id; o.textContent = cat.name;
      catSel.appendChild(o);
    }
  }

  if (expense) {
    // Pre-fill all fields for editing
    document.getElementById('exp-name').value           = expense.name;
    document.getElementById('exp-amount').value         = expense.amount;
    document.getElementById('exp-currency').value       = expense.currency || 'EUR';
    document.getElementById('exp-date').value           = expense.nextDate || '';
    document.getElementById('exp-category').value       = expense.categoryId || '';
    document.getElementById('exp-is-recurring').checked = !!expense.isRecurring;
    document.getElementById('exp-is-dd').checked        = !!expense.isDirectDebit;
    document.getElementById('exp-is-paid').checked      = !!expense.isPaid;
    document.getElementById('exp-paid-row').style.display = expense.isDirectDebit ? 'none' : '';
  } else {
    // Blank form for new expense
    document.getElementById('exp-name').value            = '';
    document.getElementById('exp-amount').value          = '';
    document.getElementById('exp-is-recurring').checked  = false;
    document.getElementById('exp-is-dd').checked         = false;
    document.getElementById('exp-is-paid').checked       = false;
    document.getElementById('exp-paid-row').style.display = '';
    // Default date = today
    const t = new Date();
    const yy = t.getFullYear();
    const mm = String(t.getMonth() + 1).padStart(2, '0');
    const dd = String(t.getDate()).padStart(2, '0');
    document.getElementById('exp-date').value = `${yy}-${mm}-${dd}`;
  }

  document.getElementById('exp-modal-overlay').classList.remove('hidden');
  setTimeout(() => document.getElementById('exp-name').focus(), 60);
}

function populateExpAccountSelect(bank, selectedAccountId = null) {
  const sel = document.getElementById('exp-account');
  sel.innerHTML = '';
  if (!bank || bank.accounts.length === 0) {
    sel.innerHTML = '<option value="">— no accounts —</option>';
    sel.disabled = true;
    return;
  }
  sel.disabled = false;
  for (const acc of bank.accounts) {
    const o = document.createElement('option');
    o.value = acc.id; o.textContent = acc.name;
    sel.appendChild(o);
  }
  if (selectedAccountId) {
    sel.value = selectedAccountId;
    // Don't override currency when editing — caller sets it separately
  } else {
    // Auto-match currency to first account when adding
    const firstCur = bank.accounts[0].currency;
    if (CURRENCIES.includes(firstCur)) {
      document.getElementById('exp-currency').value = firstCur;
    }
  }
}

function hideExpenseModal() {
  document.getElementById('exp-modal-overlay').classList.add('hidden');
}

document.getElementById('btn-add-expense').addEventListener('click', showExpenseModal);
document.getElementById('exp-modal-close').addEventListener('click', hideExpenseModal);
document.getElementById('exp-modal-cancel').addEventListener('click', hideExpenseModal);
document.getElementById('exp-modal-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'exp-modal-overlay') hideExpenseModal();
});

document.getElementById('exp-bank').addEventListener('change', function () {
  const bank = data.banks.find(b => b.id === this.value);
  populateExpAccountSelect(bank || null, null);
});

document.getElementById('exp-is-dd').addEventListener('change', function () {
  document.getElementById('exp-paid-row').style.display = this.checked ? 'none' : '';
});

document.querySelectorAll('.exp-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    expenseTab = tab.dataset.tab;
    document.querySelectorAll('.exp-tab').forEach(t =>
      t.classList.toggle('active', t.dataset.tab === expenseTab)
    );
    renderExpenses();
  });
});

document.getElementById('exp-modal-form').addEventListener('submit', (e) => {
  e.preventDefault();

  const name      = document.getElementById('exp-name').value.trim();
  const bankId    = document.getElementById('exp-bank').value;
  const accountId = document.getElementById('exp-account').value;
  const amount    = parseFloat(document.getElementById('exp-amount').value) || 0;
  const currency  = document.getElementById('exp-currency').value;
  const catId       = document.getElementById('exp-category').value;
  const isDD        = document.getElementById('exp-is-dd').checked;
  const isRecurring = document.getElementById('exp-is-recurring').checked;
  const isPaid      = !isDD && document.getElementById('exp-is-paid').checked;
  let   nextDate    = document.getElementById('exp-date').value;

  if (!name) { document.getElementById('exp-name').focus(); return; }

  // For DDs and recurring expenses, roll any past date forward to the next future occurrence
  if ((isDD || isRecurring) && nextDate) nextDate = advanceDDDate(nextDate);

  if (_editingExpenseId) {
    const idx = data.expenses.findIndex(e => e.id === _editingExpenseId);
    if (idx !== -1) {
      data.expenses[idx] = {
        ...data.expenses[idx],
        name, bankId, accountId, amount, currency, nextDate,
        categoryId: catId, isDirectDebit: isDD, isRecurring, isPaid
      };
    }
  } else {
    data.expenses.push({
      id: uid(), name, bankId, accountId,
      amount, currency, nextDate,
      categoryId: catId,
      isDirectDebit: isDD,
      isRecurring,
      isPaid
    });
  }

  save();
  hideExpenseModal();
  renderExpenses();
});

// ── Page navigation ────────────────────────────────────────────────────────
function navigateTo(page) {
  document.querySelectorAll('.nav-item[data-page]').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });

  document.getElementById('page-accounts').style.display = page === 'accounts' ? 'flex' : 'none';
  document.getElementById('page-expenses').style.display = page === 'expenses' ? 'flex' : 'none';
  document.getElementById('page-budget').style.display   = page === 'budget'   ? 'flex' : 'none';
  document.getElementById('page-wishlist').style.display = page === 'wishlist' ? 'flex' : 'none';
  document.getElementById('page-settings').style.display = page === 'settings' ? 'flex' : 'none';

  document.getElementById('btn-add-bank').style.display    = page === 'accounts' ? '' : 'none';
  document.getElementById('btn-add-expense').style.display = page === 'expenses' ? '' : 'none';
  document.getElementById('btn-add-wish').style.display    = page === 'wishlist' ? '' : 'none';

  const titles = { accounts: 'Accounts', expenses: 'Expenses', budget: 'Dashboard', wishlist: 'Wishlist', settings: 'Settings' };
  document.getElementById('page-title').textContent = titles[page] || page;

  if (page === 'settings') initSettingsPage();
  if (page === 'budget')   renderBudgetPage();
  if (page === 'wishlist') renderWishlist();
  if (page === 'expenses') {
    expenseTab = 'upcoming';
    document.querySelectorAll('.exp-tab').forEach(t =>
      t.classList.toggle('active', t.dataset.tab === 'upcoming')
    );
    renderExpenses();
  }
}

document.querySelectorAll('.nav-item[data-page]').forEach(el => {
  el.addEventListener('click', () => navigateTo(el.dataset.page));
});

document.getElementById('sidebar-logo').addEventListener('click', () => navigateTo('budget'));

// ── Settings ───────────────────────────────────────────────────────────────
async function initSettingsPage() {
  const p = await window.dataStore?.getDataLocation?.();
  document.getElementById('data-path-display').textContent = p || '—';
  renderSyncStatus();

  renderCategories();
  renderLinkedAccountSelects();

  // Budget amount
  document.getElementById('settings-budget-amount').value = data.settings?.monthlyBudget || '';

  // Payday
  const paydayType = data.settings?.paydayType || 'last';
  const paydaySel  = document.getElementById('payday-type');
  paydaySel.value  = paydayType;
  const dayWrap = document.getElementById('payday-day-wrap');
  dayWrap.style.display = paydayType === 'specific' ? '' : 'none';
  document.getElementById('payday-day').value = data.settings?.paydayDay || 25;
}

function renderCategories() {
  const container = document.getElementById('categories-list');
  container.innerHTML = '';

  for (const cat of data.categories) {
    const color = getCatColor(cat.id);
    const pill  = document.createElement('div');
    pill.className = 'cat-pill-item';
    pill.style.cssText = `background:${color.bg};color:${color.fg};border-color:${color.border}`;
    pill.innerHTML = `
      <span>${escHtml(cat.name)}</span>
      <button class="cat-pill-del" title="Remove">×</button>
    `;
    pill.querySelector('.cat-pill-del').addEventListener('click', () => {
      data.categories = data.categories.filter(c => c.id !== cat.id);
      save();
      renderCategories();
    });
    container.appendChild(pill);
  }
}

document.getElementById('btn-add-category').addEventListener('click', () => {
  const input = document.getElementById('new-category-input');
  const name  = input.value.trim();
  if (!name) { input.focus(); return; }
  if (data.categories.some(c => c.name.toLowerCase() === name.toLowerCase())) {
    input.value = ''; return;
  }
  data.categories.push({ id: uid(), name });
  save();
  renderCategories();
  input.value = '';
  input.focus();
});

document.getElementById('new-category-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); document.getElementById('btn-add-category').click(); }
});

// ── Budget ─────────────────────────────────────────────────────────────────
function getPayday(year, month) {
  const type = data.settings?.paydayType || 'last';
  const day  = data.settings?.paydayDay  || 25;
  if (type === 'last') return new Date(year, month + 1, 0);
  if (type === 'lastWorkday') {
    const d = new Date(year, month + 1, 0);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
    return d;
  }
  // 'specific'
  return new Date(year, month, Math.min(day, new Date(year, month + 1, 0).getDate()));
}

function getBudgetPeriod() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const y = today.getFullYear(), m = today.getMonth();
  const thisPayday = getPayday(y, m); thisPayday.setHours(0, 0, 0, 0);
  let start, end;
  if (today > thisPayday) {
    start = new Date(thisPayday); start.setDate(start.getDate() + 1);
    const nm = m === 11 ? 0 : m + 1, ny = m === 11 ? y + 1 : y;
    end = getPayday(ny, nm); end.setHours(0, 0, 0, 0);
  } else {
    const pm = m === 0 ? 11 : m - 1, py = m === 0 ? y - 1 : y;
    const prev = getPayday(py, pm); prev.setHours(0, 0, 0, 0);
    start = new Date(prev); start.setDate(start.getDate() + 1);
    end = new Date(thisPayday);
  }
  const daysInPeriod = Math.round((end - start) / 86400000) + 1;
  const daysElapsed  = Math.max(1, Math.round((today - start) / 86400000) + 1);
  const daysLeft     = Math.max(0, Math.round((end - today) / 86400000));
  return { start, end, daysInPeriod, daysElapsed, daysLeft };
}

function renderBudgetPage() {
  if (!data.settings) data.settings = {};
  const budget = data.settings.monthlyBudget || 0;
  const { start, end, daysInPeriod, daysElapsed, daysLeft } = getBudgetPeriod();

  // Account label + balance
  const bBank = data.banks.find(b => b.id === data.settings.budgetBankId);
  const bAcc  = bBank?.accounts.find(a => a.id === data.settings.budgetAccountId);
  document.getElementById('budget-account-display').textContent =
    bBank && bAcc ? `${bBank.name} · ${bAcc.name}` : 'Not set — configure in Settings';

  const balEUR = bAcc ? toEUR(bAcc.balance, bAcc.currency) : null;

  // Time bar
  const timePct = Math.min(100, (daysElapsed / daysInPeriod) * 100);
  document.getElementById('budget-time-fill').style.width = timePct + '%';
  document.getElementById('budget-time-label-start').textContent = fmtDate(dateFmt(start));
  document.getElementById('budget-time-label-end').textContent   = fmtDate(dateFmt(end));
  document.getElementById('budget-time-elapsed').textContent     = `Day ${daysElapsed} of ${daysInPeriod}`;

  // Stats
  const dailyBudget    = budget > 0 && daysInPeriod > 0 ? budget / daysInPeriod : 0;
  const dailyRemaining = balEUR !== null && daysLeft > 0 ? balEUR / daysLeft : null;

  const balEl = document.getElementById('bstat-balance');
  balEl.textContent = balEUR !== null ? fmtEUR(balEUR) : '—';
  balEl.style.color = balEUR !== null && budget > 0
    ? (balEUR >= budget * (daysLeft / daysInPeriod) ? 'var(--green)' : 'var(--red)')
    : 'var(--text)';

  document.getElementById('bstat-days-left').textContent =
    `${daysLeft} day${daysLeft !== 1 ? 's' : ''} left`;
  document.getElementById('bstat-daily-budget').textContent =
    budget > 0 ? fmtEUR(dailyBudget) : '—';

  const drEl = document.getElementById('bstat-daily-remaining');
  if (dailyRemaining !== null) {
    drEl.textContent = fmtEUR(dailyRemaining);
    drEl.style.color = (dailyBudget === 0 || dailyRemaining >= dailyBudget)
      ? 'var(--green)' : 'var(--red)';
  } else {
    drEl.textContent = '—';
    drEl.style.color = 'var(--text)';
  }

  // Pace status
  const paceEl = document.getElementById('budget-pace-status');
  if (budget === 0) {
    paceEl.innerHTML = `<span style="font-size:12px;color:var(--text-3)">Set a budget in Settings</span>`;
  } else if (balEUR === null) {
    paceEl.innerHTML = `<span style="font-size:12px;color:var(--text-3)">Configure budget account in Settings</span>`;
  } else {
    const impliedSpend  = budget - balEUR;
    const expectedSpend = dailyBudget * daysElapsed;
    const diff   = Math.abs(expectedSpend - impliedSpend);
    const isGood = impliedSpend <= expectedSpend;
    paceEl.innerHTML = `
      <div class="pace-status-line ${isGood ? 'pace-under' : 'pace-over'}">
        ${isGood ? '↓' : '↑'} ${fmtEUR(diff)} ${isGood ? 'under' : 'over'} pace
      </div>
      <div class="pace-detail-line" style="text-align:right">
        Implied spend ${fmtEUR(Math.max(0, impliedSpend))}<br>
        Expected ${fmtEUR(expectedSpend)} by day ${daysElapsed}
      </div>
    `;
  }

  // ── Middle row ───────────────────────────────────────────────────────────

  // Net worth
  document.getElementById('dash-net-worth').textContent = fmtEUR(grandTotal());
  const totalAccs = data.banks.reduce((s, b) => s + b.accounts.length, 0);
  document.getElementById('dash-account-count').textContent =
    `${data.banks.length} bank${data.banks.length !== 1 ? 's' : ''}, ${totalAccs} account${totalAccs !== 1 ? 's' : ''}`;

  // Expenses this period
  const periodExps = (data.expenses || []).filter(e => {
    if (!e.nextDate) return false;
    const d = new Date(e.nextDate + 'T00:00:00');
    return d >= start && d <= end;
  });
  const expTotal   = periodExps.reduce((s, e) => s + toEUR(e.amount || 0, e.currency || 'EUR'), 0);
  const overdueExp = (data.expenses || []).filter(e => dateStatus(e.nextDate) === 'overdue');
  document.getElementById('dash-exp-total').textContent = fmtEUR(expTotal);
  document.getElementById('dash-exp-count').textContent =
    `${periodExps.length} expense${periodExps.length !== 1 ? 's' : ''} this period`;
  const ovEl = document.getElementById('dash-exp-overdue');
  ovEl.textContent   = overdueExp.length > 0 ? `${overdueExp.length} overdue` : 'None overdue';
  ovEl.style.color   = overdueExp.length > 0 ? 'var(--red)' : 'var(--green)';

  // Wishlist
  const wishList = data.wishlist || [];
  const affordable = wishList.filter(item => {
    const wb  = data.banks.find(b => b.id === item.bankId);
    const wa  = wb?.accounts.find(a => a.id === item.accountId);
    return wa && toEUR(wa.balance, wa.currency) >= toEUR(item.price || 0, item.currency || 'EUR');
  }).length;
  document.getElementById('dash-wish-count').textContent =
    wishList.length > 0 ? `${wishList.length} item${wishList.length !== 1 ? 's' : ''}` : 'Empty';
  const affEl = document.getElementById('dash-wish-afford');
  affEl.textContent = wishList.length === 0 ? '—' : `${affordable} affordable`;
  affEl.style.color = affordable > 0 ? 'var(--green)' : 'var(--text-3)';

  // ── Upcoming expenses list ───────────────────────────────────────────────
  const listEl = document.getElementById('dash-exp-rows');
  listEl.innerHTML = '';
  const upcoming = [...(data.expenses || [])]
    .filter(e => e.nextDate)
    .sort((a, b) => new Date(a.nextDate) - new Date(b.nextDate))
    .slice(0, 6);

  if (upcoming.length === 0) {
    listEl.innerHTML = `<div class="dash-exp-empty">No upcoming expenses.</div>`;
  } else {
    for (const exp of upcoming) {
      const status = dateStatus(exp.nextDate);
      const dotColor = status === 'overdue' ? 'var(--red)' : status === 'soon' ? 'var(--amber)' : 'var(--border)';
      const dateLabel = status === 'overdue' ? 'Overdue' : status === 'soon' ? `Soon · ${fmtDate(exp.nextDate)}` : fmtDate(exp.nextDate);
      const dateColor = status === 'overdue' ? 'var(--red)' : status === 'soon' ? 'var(--amber)' : 'var(--text-3)';
      const row = document.createElement('div');
      row.className = 'dash-exp-row';
      row.innerHTML = `
        <span class="dash-exp-dot" style="background:${dotColor}"></span>
        <span class="dash-exp-name">${escHtml(exp.name || '')}</span>
        <span class="dash-exp-date" style="color:${dateColor}">${escHtml(dateLabel)}</span>
        <span class="dash-exp-amount">${fmtCurrency(exp.amount || 0, exp.currency || 'EUR')}</span>
      `;
      listEl.appendChild(row);
    }
  }
}

// Budget amount setting
document.getElementById('settings-budget-amount').addEventListener('change', function () {
  if (!data.settings) data.settings = {};
  const val = parseFloat(this.value);
  data.settings.monthlyBudget = (!isNaN(val) && val >= 0) ? val : 0;
  save();
});

// Payday settings
document.getElementById('payday-type').onchange = function () {
  if (!data.settings) data.settings = {};
  data.settings.paydayType = this.value;
  document.getElementById('payday-day-wrap').style.display = this.value === 'specific' ? '' : 'none';
  save();
  if (document.getElementById('page-budget').style.display !== 'none') renderBudgetPage();
};
document.getElementById('payday-day').onchange = function () {
  if (!data.settings) data.settings = {};
  data.settings.paydayDay = parseInt(this.value, 10) || 25;
  save();
  if (document.getElementById('page-budget').style.display !== 'none') renderBudgetPage();
};

// Google Drive sync settings
document.getElementById('btn-google-save-client')?.addEventListener('click', () => {
  const input = document.getElementById('google-client-id');
  window.dataStore?.configureGoogle(input.value);
  renderSyncStatus();
});

document.getElementById('btn-google-connect')?.addEventListener('click', async () => {
  try {
    const result = await window.dataStore.connectGoogle(data);
    if (result?.foundRemote) {
      const useRemote = confirm('Google Drive already has budget data. Load that copy now? Choose Cancel to keep this device copy and upload it instead.');
      if (useRemote) {
        data = result.data;
        applyDataDefaults();
        render();
        navigateTo('budget');
      } else {
        await window.dataStore.save(data, { force: true });
      }
    } else {
      await window.dataStore.save(data, { force: true });
    }
    initSettingsPage();
  } catch (err) {
    alert(err.message || 'Could not connect to Google Drive.');
    renderSyncStatus({ status: 'Google sync failed', detail: err.message || '' });
  }
});

document.getElementById('btn-google-pull')?.addEventListener('click', async () => {
  try {
    const result = await window.dataStore.pullGoogle();
    if (!result?.data) return;
    if (!confirm('Replace this device copy with the latest Google Drive data?')) return;
    data = result.data;
    applyDataDefaults();
    render();
    navigateTo('budget');
  } catch (err) {
    alert(err.message || 'Could not load Google Drive data.');
  }
});

document.getElementById('btn-google-sync')?.addEventListener('click', async () => {
  try {
    await window.dataStore.save(data, { force: true });
    initSettingsPage();
  } catch (err) {
    alert(err.message || 'Could not sync to Google Drive.');
  }
});

document.getElementById('btn-google-disconnect')?.addEventListener('click', () => {
  window.dataStore?.disconnectGoogle();
  renderSyncStatus();
});

// OneDrive sync settings
document.getElementById('btn-onedrive-save-client')?.addEventListener('click', () => {
  const input = document.getElementById('onedrive-client-id');
  window.dataStore?.configureOneDrive(input.value);
  renderSyncStatus();
});

document.getElementById('btn-onedrive-connect')?.addEventListener('click', async () => {
  try {
    const result = await window.dataStore.connectOneDrive(data);
    if (result?.foundRemote) {
      const useRemote = confirm('OneDrive already has budget data. Load that copy now? Choose Cancel to keep this device copy and upload it instead.');
      if (useRemote) {
        data = result.data;
        applyDataDefaults();
        render();
        navigateTo('budget');
      } else {
        await window.dataStore.save(data, { force: true });
      }
    } else {
      await window.dataStore.save(data, { force: true });
    }
    initSettingsPage();
  } catch (err) {
    alert(err.message || 'Could not connect to OneDrive.');
    renderSyncStatus({ status: 'OneDrive sync failed', detail: err.message || '' });
  }
});

document.getElementById('btn-onedrive-pull')?.addEventListener('click', async () => {
  try {
    const result = await window.dataStore.pullOneDrive();
    if (!result?.data) return;
    if (!confirm('Replace this device copy with the latest OneDrive data?')) return;
    data = result.data;
    applyDataDefaults();
    render();
    navigateTo('budget');
  } catch (err) {
    alert(err.message || 'Could not load OneDrive data.');
  }
});

document.getElementById('btn-onedrive-sync')?.addEventListener('click', async () => {
  try {
    await window.dataStore.save(data, { force: true });
    initSettingsPage();
  } catch (err) {
    alert(err.message || 'Could not sync to OneDrive.');
  }
});

// ── Wishlist ────────────────────────────────────────────────────────────────
function renderWishlist() {
  const rows  = document.getElementById('wish-rows');
  const empty = document.getElementById('wish-empty');
  const hdr   = document.getElementById('wish-header');
  rows.innerHTML = '';

  const list = data.wishlist || [];

  // Update sort indicators on headers
  document.querySelectorAll('.wish-sort-btn').forEach(btn => {
    const col = btn.dataset.col;
    const isActive = wishSort.col === col;
    btn.classList.toggle('active', isActive);
    btn.querySelector('.wish-sort-arrow').textContent = isActive ? (wishSort.dir === 'asc' ? ' ▲' : ' ▼') : '';
  });

  if (list.length === 0) {
    hdr.classList.add('hidden');
    empty.classList.remove('hidden');
    return;
  }
  hdr.classList.remove('hidden');
  empty.classList.add('hidden');

  // Sort
  const sorted = [...list].sort((a, b) => {
    let av, bv;
    if (wishSort.col === 'price') {
      av = toEUR(a.price || 0, a.currency || 'EUR');
      bv = toEUR(b.price || 0, b.currency || 'EUR');
    } else if (wishSort.col === 'account') {
      const getLabel = item => {
        const bank = data.banks.find(x => x.id === item.bankId);
        const acc  = bank?.accounts.find(x => x.id === item.accountId);
        return bank && acc ? `${bank.name} ${acc.name}`.toLowerCase() : '';
      };
      av = getLabel(a); bv = getLabel(b);
    } else if (wishSort.col === 'afford') {
      const getAfford = item => {
        const bank = data.banks.find(x => x.id === item.bankId);
        const acc  = bank?.accounts.find(x => x.id === item.accountId);
        if (!acc) return -1;
        const bal = toEUR(acc.balance, acc.currency);
        return bal - toEUR(item.price || 0, item.currency || 'EUR');
      };
      av = getAfford(a); bv = getAfford(b);
    } else {
      av = (a.name || '').toLowerCase();
      bv = (b.name || '').toLowerCase();
    }
    if (av < bv) return wishSort.dir === 'asc' ? -1 : 1;
    if (av > bv) return wishSort.dir === 'asc' ? 1 : -1;
    return 0;
  });

  for (const item of sorted) {
    const bank     = data.banks.find(b => b.id === item.bankId);
    const acc      = bank?.accounts.find(a => a.id === item.accountId);
    const accLabel = bank && acc ? `${bank.name} · ${acc.name}` : '—';
    const priceEUR = toEUR(item.price || 0, item.currency || 'EUR');
    const balEUR   = acc ? toEUR(acc.balance, acc.currency) : null;

    let badgeHtml;
    if (balEUR === null) {
      badgeHtml = `<span class="wish-badge wish-badge-none">—</span>`;
    } else if (balEUR >= priceEUR) {
      badgeHtml = `<span class="wish-badge wish-badge-yes">✓ Yes</span>`;
    } else {
      const short = priceEUR - balEUR;
      badgeHtml = `<span class="wish-badge wish-badge-no" title="Short ${fmtEUR(short)}">✗ ${fmtEUR(short)} short</span>`;
    }

    const linkHtml = item.url
      ? `<button class="wish-link-btn" title="Open link" data-url="${escHtml(item.url)}">
           <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
         </button>`
      : `<span class="wish-link-empty"></span>`;

    const row = document.createElement('div');
    row.className = 'wish-row';
    row.innerHTML = `
      <div class="wish-name">${escHtml(item.name || '')}</div>
      <div class="wish-price">${fmtCurrency(item.price || 0, item.currency || 'EUR')}</div>
      <div class="wish-account">${escHtml(accLabel)}</div>
      <div class="wish-afford">${badgeHtml}</div>
      <div class="wish-link-cell">${linkHtml}</div>
      <div class="wish-actions">
        <button class="wish-edit-btn" title="Edit">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="wish-del-btn" title="Delete">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </button>
      </div>
    `;

    row.querySelector('.wish-link-btn[data-url]')?.addEventListener('click', e => {
      const url = e.currentTarget.dataset.url;
      if (url) window.dataStore?.openUrl(url);
    });
    row.querySelector('.wish-edit-btn').addEventListener('click', () => showWishlistModal(item));
    row.querySelector('.wish-del-btn').addEventListener('click', () => {
      data.wishlist = data.wishlist.filter(w => w.id !== item.id);
      save();
      renderWishlist();
    });

    rows.appendChild(row);
  }
}

let _editingWishId = null;

function populateWishBankSel(selectedBankId = null, selectedAccId = null) {
  const bankSel = document.getElementById('wish-bank');
  const accSel  = document.getElementById('wish-account');
  bankSel.innerHTML = '<option value="">No account</option>';
  for (const b of data.banks) {
    const o = document.createElement('option');
    o.value = b.id; o.textContent = b.name;
    bankSel.appendChild(o);
  }
  if (selectedBankId) bankSel.value = selectedBankId;

  const selBank = data.banks.find(b => b.id === bankSel.value);
  accSel.innerHTML = '<option value="">—</option>';
  if (selBank) {
    accSel.disabled = false;
    for (const a of selBank.accounts) {
      const o = document.createElement('option');
      o.value = a.id; o.textContent = a.name;
      accSel.appendChild(o);
    }
    if (selectedAccId) accSel.value = selectedAccId;
  } else {
    accSel.disabled = true;
  }
}

function showWishlistModal(item = null) {
  _editingWishId = item ? item.id : null;
  document.getElementById('wish-modal-title').textContent = item ? 'Edit item' : 'Add to wishlist';
  document.getElementById('wish-modal-confirm').textContent = item ? 'Save' : 'Add';

  // Reset
  document.getElementById('wish-name').value   = item?.name   || '';
  document.getElementById('wish-amount').value = item?.price  || '';
  document.getElementById('wish-url').value    = item?.url    || '';

  // Currency
  const curSel = document.getElementById('wish-currency');
  curSel.innerHTML = '';
  for (const c of CURRENCIES) {
    const o = document.createElement('option');
    o.value = c; o.textContent = c;
    curSel.appendChild(o);
  }
  curSel.value = item?.currency || data.preferredCurrency || 'EUR';

  // Bank/account cascade
  populateWishBankSel(item?.bankId || null, item?.accountId || null);

  document.getElementById('wish-modal-overlay').classList.remove('hidden');
  document.getElementById('wish-name').focus();
}

function closeWishModal() {
  document.getElementById('wish-modal-overlay').classList.add('hidden');
  _editingWishId = null;
}

document.getElementById('wish-modal-close').addEventListener('click', closeWishModal);
document.getElementById('wish-modal-cancel').addEventListener('click', closeWishModal);
document.getElementById('wish-modal-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('wish-modal-overlay')) closeWishModal();
});

document.getElementById('wish-bank').addEventListener('change', function () {
  const bank = data.banks.find(b => b.id === this.value);
  const accSel = document.getElementById('wish-account');
  accSel.innerHTML = '<option value="">—</option>';
  if (bank) {
    accSel.disabled = false;
    for (const a of bank.accounts) {
      const o = document.createElement('option');
      o.value = a.id; o.textContent = a.name;
      accSel.appendChild(o);
    }
    // Auto-match currency
    if (bank.accounts.length > 0) {
      const c = bank.accounts[0].currency;
      if (CURRENCIES.includes(c)) document.getElementById('wish-currency').value = c;
    }
  } else {
    accSel.disabled = true;
  }
});

document.getElementById('wish-modal-form').addEventListener('submit', e => {
  e.preventDefault();
  const name     = document.getElementById('wish-name').value.trim();
  const price    = parseFloat(document.getElementById('wish-amount').value) || 0;
  const currency = document.getElementById('wish-currency').value;
  const bankId   = document.getElementById('wish-bank').value || null;
  const accountId= document.getElementById('wish-account').value || null;
  const url      = document.getElementById('wish-url').value.trim();

  if (!name) return;

  if (_editingWishId) {
    const idx = data.wishlist.findIndex(w => w.id === _editingWishId);
    if (idx !== -1) data.wishlist[idx] = { ...data.wishlist[idx], name, price, currency, bankId, accountId, url };
  } else {
    data.wishlist.push({ id: uid(), name, price, currency, bankId, accountId, url });
  }

  save();
  closeWishModal();
  renderWishlist();
});

document.getElementById('btn-add-wish').addEventListener('click', () => showWishlistModal());

document.querySelectorAll('.wish-sort-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const col = btn.dataset.col;
    if (wishSort.col === col) {
      wishSort.dir = wishSort.dir === 'asc' ? 'desc' : 'asc';
    } else {
      wishSort.col = col;
      wishSort.dir = 'asc';
    }
    renderWishlist();
  });
});

// ── Settings — linked accounts ──────────────────────────────────────────────
function renderLinkedAccountSelects() {
  if (!data.settings) data.settings = {};
  populateLinkedBankSel('linked-budget-bank', 'linked-budget-account', 'budgetBankId', 'budgetAccountId');
  populateLinkedBankSel('linked-main-bank',   'linked-main-account',   'mainBankId',   'mainAccountId');
}

function populateLinkedBankSel(bankSelId, accSelId, bankKey, accKey) {
  const bankSel = document.getElementById(bankSelId);
  const accSel  = document.getElementById(accSelId);
  bankSel.innerHTML = '';

  if (data.banks.length === 0) {
    bankSel.innerHTML = '<option value="">No banks yet</option>';
    bankSel.disabled  = true;
    accSel.innerHTML  = '<option value="">—</option>';
    accSel.disabled   = true;
    return;
  }

  bankSel.disabled = false;
  bankSel.innerHTML = '<option value="">Select…</option>';
  for (const b of data.banks) {
    const o = document.createElement('option');
    o.value = b.id; o.textContent = b.name;
    bankSel.appendChild(o);
  }
  if (data.settings[bankKey]) bankSel.value = data.settings[bankKey];

  const selBank = data.banks.find(b => b.id === bankSel.value);
  populateSettingsAccountSel(accSel, selBank, data.settings[accKey]);
}

function populateSettingsAccountSel(sel, bank, selectedAccId) {
  sel.innerHTML = '';
  if (!bank || bank.accounts.length === 0) {
    sel.innerHTML = '<option value="">—</option>';
    sel.disabled  = true;
    return;
  }
  sel.disabled = false;
  sel.innerHTML = '<option value="">Select…</option>';
  for (const acc of bank.accounts) {
    const o = document.createElement('option');
    o.value = acc.id; o.textContent = acc.name;
    sel.appendChild(o);
  }
  if (selectedAccId) sel.value = selectedAccId;
}

// Wire linked-account settings listeners once at load (use onchange to avoid duplicates)
['budget', 'main'].forEach(key => {
  const bankId = `linked-${key}-bank`;
  const accId  = `linked-${key}-account`;
  const bKey   = `${key}BankId`;
  const aKey   = `${key}AccountId`;

  document.getElementById(bankId).onchange = function () {
    if (!data.settings) data.settings = {};
    data.settings[bKey] = this.value || null;
    data.settings[aKey] = null;
    const bank = data.banks.find(b => b.id === this.value);
    populateSettingsAccountSel(document.getElementById(accId), bank || null, null);
    save();
  };
  document.getElementById(accId).onchange = function () {
    if (!data.settings) data.settings = {};
    data.settings[aKey] = this.value || null;
    save();
  };
});

// ── Go ─────────────────────────────────────────────────────────────────────
init();
