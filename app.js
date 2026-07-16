/* ---------------- CONFIG ---------------- */
const CONFIG = {
  // Paste your deployed Google Apps Script Web App URL here (ends in /exec)
  API_URL: 'https://script.google.com/macros/s/AKfycbygqoe6Y4xFZckfnfJeWwB_ry_S4vG4kzghbsdbLCs9c9ji2ggL7535do5OZx3NleC8Sw/exec',
  CURRENCY_SYMBOL: 'Rs. '
};

/* ---------------- STATE (in-memory only, cleared on reload) ---------------- */
const state = {
  key: null,
  name: null,
  totalDays: 0,
  hours: [],        // hours[i] = hours for day i+1
  dirty: new Set()  // set of day numbers with unsaved changes
};

/* ---------------- DOM ---------------- */
const el = {
  tabs: document.getElementById('tabs'),
  logoutBtn: document.getElementById('logoutBtn'),

  loginForm: document.getElementById('loginForm'),
  keyInput: document.getElementById('keyInput'),
  loginBtn: document.getElementById('loginBtn'),
  loginError: document.getElementById('loginError'),

  attMonth: document.getElementById('attMonth'),
  attGreeting: document.getElementById('attGreeting'),
  attBody: document.getElementById('attBody'),
  attStatus: document.getElementById('attStatus'),
  saveBtn: document.getElementById('saveBtn'),

  billMonth: document.getElementById('billMonth'),
  billTotal: document.getElementById('billTotal'),
  billBody: document.getElementById('billBody'),
  billGrandHours: document.getElementById('billGrandHours'),
  billStatus: document.getElementById('billStatus'),
  refreshBillBtn: document.getElementById('refreshBillBtn')
};

/* ---------------- API HELPERS ---------------- */

function checkConfigured() {
  if (!CONFIG.API_URL || CONFIG.API_URL.indexOf('PASTE_YOUR') === 0) {
    throw new Error('App is not configured yet: set CONFIG.API_URL in app.js to your Apps Script Web App URL.');
  }
}

async function apiGet(params) {
  checkConfigured();
  const url = new URL(CONFIG.API_URL);
  Object.keys(params).forEach(k => url.searchParams.set(k, params[k]));
  let res;
  try {
    res = await fetch(url.toString(), { method: 'GET' });
  } catch (err) {
    throw new Error('Network error — check your connection.');
  }
  if (!res.ok) throw new Error('Server error (' + res.status + ')');
  const data = await res.json();
  return data;
}

async function apiPost(body) {
  checkConfigured();
  let res;
  try {
    // text/plain avoids a CORS preflight against the Apps Script endpoint
    res = await fetch(CONFIG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    });
  } catch (err) {
    throw new Error('Network error — check your connection.');
  }
  if (!res.ok) throw new Error('Server error (' + res.status + ')');
  return res.json();
}

/* ---------------- VIEW SWITCHING ---------------- */

function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + name).classList.add('active');
  document.querySelectorAll('.tab[data-view]').forEach(t => {
    t.classList.toggle('active', t.dataset.view === name);
  });
  if (name === 'bill') loadBill();
}

document.querySelectorAll('.tab[data-view]').forEach(btn => {
  btn.addEventListener('click', () => showView(btn.dataset.view));
});

el.logoutBtn.addEventListener('click', () => {
  state.key = null;
  state.name = null;
  state.hours = [];
  state.dirty.clear();
  el.tabs.hidden = true;
  el.keyInput.value = '';
  el.loginError.hidden = true;
  showView('login');
});

/* ---------------- LOGIN ---------------- */

el.loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const key = el.keyInput.value.trim();
  if (!key) return;

  el.loginError.hidden = true;
  el.loginBtn.disabled = true;
  el.loginBtn.textContent = 'Checking…';

  try {
    const res = await apiGet({ action: 'login', key });
    if (!res.success) {
      el.loginError.textContent = res.error || 'Invalid key.';
      el.loginError.hidden = false;
      return;
    }
    state.key = key;
    state.name = res.name;
    el.tabs.hidden = false;
    await loadAttendance();
    showView('attendance');
  } catch (err) {
    el.loginError.textContent = err.message;
    el.loginError.hidden = false;
  } finally {
    el.loginBtn.disabled = false;
    el.loginBtn.textContent = 'Continue';
  }
});

/* ---------------- ATTENDANCE ---------------- */

async function loadAttendance() {
  el.attStatus.textContent = 'Loading…';
  try {
    const res = await apiGet({ action: 'getMyAttendance', key: state.key });
    if (!res.success) {
      el.attStatus.textContent = res.error || 'Could not load hours.';
      return;
    }
    state.totalDays = res.totalDays;
    state.hours = res.hours.slice();
    state.dirty.clear();
    el.attGreeting.textContent = 'Hi, ' + res.name;
    renderAttendanceTable();
    el.attStatus.textContent = '';
    el.saveBtn.disabled = true;
  } catch (err) {
    el.attStatus.textContent = err.message;
  }
}

function renderAttendanceTable() {
  el.attBody.innerHTML = '';
  for (let d = 1; d <= state.totalDays; d++) {
    const tr = document.createElement('tr');

    const tdDay = document.createElement('td');
    tdDay.className = 'day';
    tdDay.textContent = 'Day ' + d;

    const tdInput = document.createElement('td');
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.max = '24';
    input.step = '0.5';
    input.value = state.hours[d - 1];
    input.dataset.day = d;
    input.addEventListener('input', onHoursInput);

    const tdStatus = document.createElement('td');
    tdStatus.className = 'row-status';
    tdStatus.id = 'rowstatus-' + d;

    tdInput.appendChild(input);
    tr.appendChild(tdDay);
    tr.appendChild(tdInput);
    tr.appendChild(tdStatus);
    el.attBody.appendChild(tr);
  }
}

function onHoursInput(e) {
  const day = Number(e.target.dataset.day);
  const val = e.target.value;
  const num = Number(val);

  const statusCell = document.getElementById('rowstatus-' + day);

  if (val === '' || isNaN(num) || num < 0 || num > 24) {
    e.target.classList.add('dirty');
    statusCell.textContent = '0–24 only';
    statusCell.className = 'row-status error';
    state.dirty.delete(day); // don't attempt to save invalid values
    updateSaveButton();
    return;
  }

  e.target.classList.add('dirty');
  statusCell.textContent = 'unsaved';
  statusCell.className = 'row-status pending';
  state.dirty.add(day);
  updateSaveButton();
}

function updateSaveButton() {
  el.saveBtn.disabled = state.dirty.size === 0;
  el.saveBtn.textContent = state.dirty.size > 0
    ? 'Save changes (' + state.dirty.size + ')'
    : 'Save changes';
}

el.saveBtn.addEventListener('click', async () => {
  if (state.dirty.size === 0) return;
  el.saveBtn.disabled = true;
  const days = Array.from(state.dirty);
  let failCount = 0;

  for (const day of days) {
    const input = el.attBody.querySelector('input[data-day="' + day + '"]');
    const statusCell = document.getElementById('rowstatus-' + day);
    const hours = Number(input.value);
    statusCell.textContent = 'saving…';
    statusCell.className = 'row-status pending';
    try {
      const res = await apiPost({ action: 'update', key: state.key, day, hours });
      if (!res.success) {
        failCount++;
        statusCell.textContent = res.error || 'failed';
        statusCell.className = 'row-status error';
        continue;
      }
      state.hours[day - 1] = hours;
      state.dirty.delete(day);
      input.classList.remove('dirty');
      statusCell.textContent = 'saved';
      statusCell.className = 'row-status';
      setTimeout(() => { if (statusCell.textContent === 'saved') statusCell.textContent = ''; }, 2000);
    } catch (err) {
      failCount++;
      statusCell.textContent = err.message;
      statusCell.className = 'row-status error';
    }
  }

  updateSaveButton();
  el.attStatus.textContent = failCount === 0
    ? 'All changes saved.'
    : failCount + ' day(s) failed to save — check your connection and try again.';
});

/* ---------------- BILL ---------------- */

function formatMoney(n) {
  return CONFIG.CURRENCY_SYMBOL + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function loadBill() {
  el.billStatus.textContent = 'Loading…';
  el.billBody.innerHTML = '';
  el.billTotal.textContent = '—';
  el.billGrandHours.textContent = '—';
  try {
    const res = await apiGet({ action: 'getBillData' });
    if (!res.success) {
      el.billStatus.textContent = res.error || 'Could not load bill data.';
      return;
    }
    el.billMonth.textContent = res.month || '—';
    el.billTotal.textContent = formatMoney(res.totalBill);
    el.billGrandHours.textContent = res.grandTotal.toLocaleString();

    if (res.grandTotal === 0) {
      el.billStatus.textContent = 'No hours logged yet this month — shares will appear once hours are entered.';
    } else {
      el.billStatus.textContent = '';
    }

    res.people.forEach(p => {
      const tr = document.createElement('tr');
      const tdName = document.createElement('td');
      tdName.textContent = p;
      const tdHours = document.createElement('td');
      tdHours.textContent = res.totals[p].toLocaleString();
      const tdShare = document.createElement('td');
      tdShare.textContent = formatMoney(res.shares[p]);
      tr.appendChild(tdName);
      tr.appendChild(tdHours);
      tr.appendChild(tdShare);
      el.billBody.appendChild(tr);
    });
  } catch (err) {
    el.billStatus.textContent = err.message;
  }
}

el.refreshBillBtn.addEventListener('click', loadBill);

/* ---------------- INIT ---------------- */
showView('login');
