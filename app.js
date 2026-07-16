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
  dirty: new Set(), // set of day numbers with unsaved changes
  bill: {
    month: '',
    totalBill: 0,
    totalDays: 30,
    members: []     // array of member names
  },
  // All members' hours data (keyed by name)
  allHours: {}
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
  billMonthInput: document.getElementById('billMonthInput'),
  billTotal: document.getElementById('billTotal'),
  billTotalInput: document.getElementById('billTotalInput'),
  billDaysInput: document.getElementById('billDaysInput'),
  billBody: document.getElementById('billBody'),
  billGrandHours: document.getElementById('billGrandHours'),
  billStatus: document.getElementById('billStatus'),
  memberList: document.getElementById('memberList'),
  memberNameInput: document.getElementById('memberNameInput'),
  addMemberBtn: document.getElementById('addMemberBtn'),
  refreshBillBtn: document.getElementById('refreshBillBtn'),
  helpBtn: document.getElementById('helpBtn'),
  helpPanel: document.getElementById('helpPanel')
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

/* ---------------- UTILITY ---------------- */

function formatMoney(n) {
  return CONFIG.CURRENCY_SYMBOL + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ---------------- VIEW SWITCHING ---------------- */

function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + name).classList.add('active');
  document.querySelectorAll('.tab[data-view]').forEach(t => {
    t.classList.toggle('active', t.dataset.view === name);
  });
  if (name === 'bill') {
    loadServerHours();
    renderBill();
  }
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

el.helpBtn.addEventListener('click', () => {
  el.helpPanel.classList.toggle('hidden');
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
    // Sync bill state totalDays from server data
    state.bill.totalDays = res.totalDays;
    if (el.billDaysInput) el.billDaysInput.value = res.totalDays;
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

/* ---------------- LOAD ALL MEMBERS' HOURS FROM SERVER ---------------- */

async function loadServerHours() {
  try {
    const res = await apiGet({ action: 'getBillData' });
    if (!res.success) return;
    // Build allHours map
    state.allHours = {};
    if (res.people) {
      res.people.forEach(p => {
        state.allHours[p] = res.totals ? (res.totals[p] || 0) : 0;
      });
    }
    // Populate members list from server data if not already set
    if (res.people && state.bill.members.length === 0) {
      state.bill.members = res.people.slice();
    }
    // Update bill state from server
    if (res.month) state.bill.month = res.month;
    if (res.totalBill) state.bill.totalBill = res.totalBill;
    if (res.totalDays) state.bill.totalDays = res.totalDays;
  } catch (e) {
    // Silently fail — we can still work with local data
  }
}

/* ---------------- BILL CONFIGURATION ---------------- */

// Wire up bill config inputs
el.billMonthInput.addEventListener('input', () => {
  state.bill.month = el.billMonthInput.value;
  renderBill();
});

el.billTotalInput.addEventListener('input', () => {
  const val = parseFloat(el.billTotalInput.value);
  state.bill.totalBill = isNaN(val) ? 0 : val;
  renderBill();
});

el.billDaysInput.addEventListener('input', () => {
  const val = parseInt(el.billDaysInput.value, 10);
  state.bill.totalDays = (isNaN(val) || val < 1) ? 30 : val;
  renderBill();
});

// Add member
el.addMemberBtn.addEventListener('click', () => {
  const name = el.memberNameInput.value.trim();
  if (!name) return;
  if (state.bill.members.includes(name)) {
    el.billStatus.textContent = 'Member "' + name + '" already exists.';
    return;
  }
  state.bill.members.push(name);
  el.memberNameInput.value = '';
  renderBill();
  renderMemberList();
});

el.memberNameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    el.addMemberBtn.click();
  }
});

function renderMemberList() {
  el.memberList.innerHTML = '';
  state.bill.members.forEach((name, idx) => {
    const chip = document.createElement('span');
    chip.className = 'member-chip';
    chip.innerHTML = `
      <span class="chip-name">${escapeHtml(name)}</span>
      <span class="chip-remove" data-idx="${idx}">&times;</span>
    `;
    el.memberList.appendChild(chip);
  });
  // Wire remove buttons
  el.memberList.querySelectorAll('.chip-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx, 10);
      state.bill.members.splice(idx, 1);
      renderMemberList();
      renderBill();
    });
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* ---------------- BILL CALCULATION ---------------- */

function calculateBill() {
  const { month, totalBill, totalDays, members } = state.bill;

  // Compute total hours for each member
  // Use server hours if available, otherwise 0
  const memberHours = {};
  let grandTotal = 0;

  // Combine server data and local logged-in user data
  const allData = { ...state.allHours };
  // Override with local data if user is logged in
  if (state.name && state.hours.length > 0) {
    const localTotal = state.hours.reduce((sum, h) => sum + (h || 0), 0);
    allData[state.name] = localTotal;
  }

  members.forEach(name => {
    const hrs = allData[name] || 0;
    memberHours[name] = hrs;
    grandTotal += hrs;
  });

  // Calculate shares
  const shares = {};
  members.forEach(name => {
    if (grandTotal === 0) {
      shares[name] = 0;
    } else {
      shares[name] = (memberHours[name] / grandTotal) * totalBill;
    }
  });

  return { month, totalBill, totalDays, members, memberHours, grandTotal, shares };
}

/* ---------------- RENDER BILL ---------------- */

function renderBill() {
  const result = calculateBill();
  const { month, totalBill, members, memberHours, grandTotal, shares } = result;

  // Month display
  el.billMonth.textContent = month || '—';

  // Total bill display
  el.billTotal.textContent = totalBill > 0 ? formatMoney(totalBill) : '—';
  el.billGrandHours.textContent = grandTotal > 0 ? grandTotal.toLocaleString() : '—';

  // Render table
  el.billBody.innerHTML = '';

  if (members.length === 0) {
    el.billStatus.textContent = 'Add members above to see the bill split.';
    return;
  }

  if (grandTotal === 0) {
    el.billStatus.textContent = 'No hours logged yet — shares will appear once hours are entered.';
    // Still show rows with 0s
    members.forEach(name => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(name)}</td>
        <td>0</td>
        <td>0%</td>
        <td>${formatMoney(0)}</td>
      `;
      el.billBody.appendChild(tr);
    });
    return;
  }

  members.forEach(name => {
    const hrs = memberHours[name];
    const pct = (hrs / grandTotal) * 100;
    const bill = shares[name];

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(name)}</td>
      <td>${hrs.toLocaleString()}</td>
      <td>${pct.toFixed(2)}%</td>
      <td>${formatMoney(bill)}</td>
    `;
    el.billBody.appendChild(tr);
  });

  // Validate sum of bills equals total bill
  const sumBills = Object.values(shares).reduce((s, v) => s + v, 0);
  const diff = Math.abs(sumBills - totalBill);
  if (diff < 0.01) {
    el.billStatus.textContent = '✓ All bills add up to ' + formatMoney(totalBill);
  } else if (totalBill > 0) {
    el.billStatus.textContent = 'Bills sum to ' + formatMoney(sumBills) + ' (target: ' + formatMoney(totalBill) + ')';
  } else {
    el.billStatus.textContent = '';
  }
}

/* ---------------- REFRESH BILL ---------------- */

el.refreshBillBtn.addEventListener('click', async () => {
  await loadServerHours();
  // Sync config inputs from server data
  if (state.bill.month) el.billMonthInput.value = state.bill.month;
  if (state.bill.totalBill) el.billTotalInput.value = state.bill.totalBill;
  if (state.bill.totalDays) el.billDaysInput.value = state.bill.totalDays;
  renderMemberList();
  renderBill();
});

/* ---------------- INIT ---------------- */

// Initialize bill days input default
if (el.billDaysInput) el.billDaysInput.value = state.bill.totalDays;

showView('login');