/* ---------------- CONFIG ---------------- */
const CONFIG = {
  // Paste your deployed Google Apps Script Web App URL here (ends in /exec)
  API_URL: 'https://script.google.com/macros/s/AKfycbygqoe6Y4xFZckfnfJeWwB_ry_S4vG4kzghbsdbLCs9c9ji2ggL7535do5OZx3NleC8Sw/exec',
  CURRENCY_SYMBOL: 'Rs. '
};

/* ---------------- STATE ---------------- */
const state = {
  key: null,
  name: null,
  totalDays: 0,
  // Each day: { from: 'HH:MM' or null, to: 'HH:MM' or null }
  slots: [],
  dirty: new Set(),
  bill: {
    month: '',
    totalBill: 0,
    totalDays: 30,
    members: []
  },
  // All members' per-day time slots (keyed by name)
  // { memberName: [ { from: 'HH:MM', to: 'HH:MM' }, ... ] }
  allSlots: {}
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
  billGrandHours: document.getElementById('billGrandHours'),
  billMemberCount: document.getElementById('billMemberCount'),
  billBody: document.getElementById('billBody'),
  billSum: document.getElementById('billSum'),
  billStatus: document.getElementById('billStatus'),
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

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/** Parse 'HH:MM' to total minutes from midnight (0-1440). Returns null if invalid. */
function parseTime(str) {
  if (!str || typeof str !== 'string') return null;
  const parts = str.split(':');
  if (parts.length !== 2) return null;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m) || h < 0 || h > 24 || m < 0 || m > 59) return null;
  // 24:00 is treated as 1440 minutes (end of day)
  if (h === 24 && m === 0) return 1440;
  if (h === 24) return null;
  return h * 60 + m;
}

/** Format minutes (0-1440) to 'HH:MM' */
function formatMinutes(mins) {
  if (mins === null || mins === undefined) return '';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

/** Compute hours from a time slot, handling overnight (to < from). */
function slotHours(fromStr, toStr) {
  const from = parseTime(fromStr);
  const to = parseTime(toStr);
  if (from === null || to === null) return 0;
  if (to >= from) return (to - from) / 60;
  // Overnight: to < from means crosses midnight
  return (1440 - from + to) / 60;
}

/* ---------------- VIEW SWITCHING ---------------- */

function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + name).classList.add('active');
  document.querySelectorAll('.tab[data-view]').forEach(t => {
    t.classList.toggle('active', t.dataset.view === name);
  });
  if (name === 'bill') {
    loadServerData();
    renderBill();
  }
}

document.querySelectorAll('.tab[data-view]').forEach(btn => {
  btn.addEventListener('click', () => showView(btn.dataset.view));
});

el.logoutBtn.addEventListener('click', () => {
  state.key = null;
  state.name = null;
  state.slots = [];
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
    state.bill.totalDays = res.totalDays;

    // Convert server data to time slots
    // Server may return slots as { from: 'HH:MM', to: 'HH:MM' } strings
    // or as { from: 152, to: 872 } integers (minutes from midnight)
    // or as legacy hours array
    if (res.slots && Array.isArray(res.slots)) {
      state.slots = res.slots.map(s => {
        let fromStr = null;
        let toStr = null;
        if (s.from !== null && s.from !== undefined && s.from !== '' && s.from !== -1) {
          if (typeof s.from === 'number') {
            fromStr = formatMinutes(s.from);
          } else {
            fromStr = String(s.from);
          }
        }
        if (s.to !== null && s.to !== undefined && s.to !== '' && s.to !== -1) {
          if (typeof s.to === 'number') {
            toStr = formatMinutes(s.to);
          } else {
            toStr = String(s.to);
          }
        }
        return { from: fromStr, to: toStr };
      });
    } else if (res.hours && Array.isArray(res.hours)) {
      // Convert legacy hours to slots
      state.slots = res.hours.map(h => {
        const hrs = Number(h);
        if (hrs <= 0) return { from: null, to: null };
        if (hrs >= 24) return { from: '00:00', to: '24:00' };
        // Center the block around midday: 12 - hrs/2 to 12 + hrs/2
        const half = hrs / 2;
        const fromMin = Math.round(720 - half * 60);
        const toMin = Math.round(720 + half * 60);
        return { from: formatMinutes(fromMin), to: formatMinutes(toMin) };
      });
    } else {
      state.slots = [];
    }

    state.dirty.clear();
    el.attGreeting.textContent = 'Hi, ' + res.name;
    renderAttendanceTable();
    el.attStatus.textContent = '';
    updateSaveButton();
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

    const slot = state.slots[d - 1] || { from: null, to: null };

    // From input
    const tdFrom = document.createElement('td');
    const fromInput = document.createElement('input');
    fromInput.type = 'time';
    fromInput.className = 'time-input';
    fromInput.value = slot.from || '';
    fromInput.dataset.day = d;
    fromInput.dataset.edge = 'from';
    fromInput.addEventListener('input', onSlotInput);

    // To input
    const tdTo = document.createElement('td');
    const toInput = document.createElement('input');
    toInput.type = 'time';
    toInput.className = 'time-input';
    toInput.value = slot.to || '';
    toInput.dataset.day = d;
    toInput.dataset.edge = 'to';
    toInput.addEventListener('input', onSlotInput);

    // Computed hours display
    const tdHours = document.createElement('td');
    tdHours.className = 'computed-hours';
    tdHours.id = 'computed-' + d;
    tdHours.textContent = slot.from && slot.to
      ? slotHours(slot.from, slot.to).toFixed(1)
      : '—';

    // Status
    const tdStatus = document.createElement('td');
    tdStatus.className = 'row-status';
    tdStatus.id = 'rowstatus-' + d;

    tdFrom.appendChild(fromInput);
    tdTo.appendChild(toInput);
    tr.appendChild(tdDay);
    tr.appendChild(tdFrom);
    tr.appendChild(tdTo);
    tr.appendChild(tdHours);
    tr.appendChild(tdStatus);
    el.attBody.appendChild(tr);
  }
}

function onSlotInput(e) {
  const day = Number(e.target.dataset.day);
  const edge = e.target.dataset.edge;

  // Get both inputs for this day
  const fromInput = el.attBody.querySelector('input[data-day="' + day + '"][data-edge="from"]');
  const toInput = el.attBody.querySelector('input[data-day="' + day + '"][data-edge="to"]');
  const fromVal = fromInput.value;
  const toVal = toInput.value;
  const hoursCell = document.getElementById('computed-' + day);
  const statusCell = document.getElementById('rowstatus-' + day);

  // Validate
  const fromMin = parseTime(fromVal);
  const toMin = parseTime(toVal);

  // If both empty, it's valid (away all day)
  if (!fromVal && !toVal) {
    state.slots[day - 1] = { from: null, to: null };
    hoursCell.textContent = '—';
    statusCell.textContent = 'unsaved';
    statusCell.className = 'row-status pending';
    fromInput.classList.add('dirty');
    toInput.classList.add('dirty');
    state.dirty.add(day);
    updateSaveButton();
    return;
  }

  // If one is filled and the other isn't, show error
  if ((fromVal && !toVal) || (!fromVal && toVal)) {
    hoursCell.textContent = '—';
    statusCell.textContent = 'Fill both or leave both empty';
    statusCell.className = 'row-status error';
    fromInput.classList.add('dirty');
    toInput.classList.add('dirty');
    state.dirty.delete(day);
    updateSaveButton();
    return;
  }

  // Both filled — validate times
  if (fromMin === null || toMin === null) {
    hoursCell.textContent = '—';
    statusCell.textContent = 'Invalid time';
    statusCell.className = 'row-status error';
    fromInput.classList.add('dirty');
    toInput.classList.add('dirty');
    state.dirty.delete(day);
    updateSaveButton();
    return;
  }

  // Valid
  state.slots[day - 1] = { from: fromVal, to: toVal };
  const hrs = slotHours(fromVal, toVal);
  hoursCell.textContent = hrs.toFixed(1);
  statusCell.textContent = 'unsaved';
  statusCell.className = 'row-status pending';
  fromInput.classList.add('dirty');
  toInput.classList.add('dirty');
  state.dirty.add(day);
  updateSaveButton();
}

function updateSaveButton() {
  // Always enabled when there are days loaded — save will send all days,
  // treating empty inputs as 0 hours
  el.saveBtn.disabled = state.totalDays === 0;
  el.saveBtn.textContent = state.dirty.size > 0
    ? 'Save changes (' + state.dirty.size + ')'
    : 'Save all days';
}

el.saveBtn.addEventListener('click', async () => {
  el.saveBtn.disabled = true;
  el.saveBtn.textContent = 'Saving…';
  const totalDays = state.totalDays;

  // Build all save requests
  const requests = [];
  for (let day = 1; day <= totalDays; day++) {
    const fromInput = el.attBody.querySelector('input[data-day="' + day + '"][data-edge="from"]');
    const toInput = el.attBody.querySelector('input[data-day="' + day + '"][data-edge="to"]');
    if (!fromInput || !toInput) continue;

    const fromVal = fromInput.value;
    const toVal = toInput.value;

    let hrs = 0;
    let fromStr = '';
    let toStr = '';
    if (fromVal && toVal) {
      const fromMin = parseTime(fromVal);
      const toMin = parseTime(toVal);
      if (fromMin !== null && toMin !== null) {
        hrs = slotHours(fromVal, toVal);
        fromStr = fromVal;
        toStr = toVal;
      }
    }

    state.slots[day - 1] = fromStr ? { from: fromStr, to: toStr } : { from: null, to: null };

    // Show saving indicator
    const statusCell = document.getElementById('rowstatus-' + day);
    if (statusCell) {
      statusCell.textContent = '…';
      statusCell.className = 'row-status pending';
    }

    // Convert times to integer minutes for sheet storage
    const fromInt = fromStr ? parseTime(fromStr) : -1;
    const toInt = toStr ? parseTime(toStr) : -1;

    requests.push(
      apiPost({
        action: 'update',
        key: state.key,
        day,
        hours: hrs,
        from: fromInt,
        to: toInt
      }).then(res => ({ day, success: res.success, error: res.error }))
       .catch(err => ({ day, success: false, error: err.message }))
    );
  }

  // Fire all requests in parallel
  const results = await Promise.all(requests);
  let failCount = 0;

  for (const result of results) {
    const statusCell = document.getElementById('rowstatus-' + result.day);
    const fromInput = el.attBody.querySelector('input[data-day="' + result.day + '"][data-edge="from"]');
    const toInput = el.attBody.querySelector('input[data-day="' + result.day + '"][data-edge="to"]');

    if (result.success) {
      state.dirty.delete(result.day);
      if (fromInput) fromInput.classList.remove('dirty');
      if (toInput) toInput.classList.remove('dirty');
      if (statusCell) {
        statusCell.textContent = 'saved';
        statusCell.className = 'row-status';
        setTimeout(() => { if (statusCell.textContent === 'saved') statusCell.textContent = ''; }, 2000);
      }
    } else {
      failCount++;
      if (statusCell) {
        statusCell.textContent = result.error || 'failed';
        statusCell.className = 'row-status error';
      }
    }
  }

  updateSaveButton();
  el.attStatus.textContent = failCount === 0
    ? 'All changes saved.'
    : failCount + ' day(s) failed — check your connection and try again.';
});

/* ---------------- LOAD SERVER DATA FOR BILL ---------------- */

async function loadServerData() {
  try {
    const res = await apiGet({ action: 'getBillData' });
    if (!res.success) return;

    // Update bill info
    if (res.month) state.bill.month = res.month;
    if (res.totalBill) state.bill.totalBill = res.totalBill;
    if (res.totalDays) state.bill.totalDays = res.totalDays;

    // Load all members' time slots
    state.allSlots = {};
    if (res.people) {
      state.bill.members = res.people.slice();
      res.people.forEach(p => {
        // If server provides per-day slots for each member, use them
        if (res.slots && res.slots[p]) {
          state.allSlots[p] = res.slots[p].map(s => {
            let fromStr = null;
            let toStr = null;
            if (s.from !== null && s.from !== undefined && s.from !== '' && s.from !== -1) {
              fromStr = typeof s.from === 'number' ? formatMinutes(s.from) : String(s.from);
            }
            if (s.to !== null && s.to !== undefined && s.to !== '' && s.to !== -1) {
              toStr = typeof s.to === 'number' ? formatMinutes(s.to) : String(s.to);
            }
            return { from: fromStr, to: toStr };
          });
        } else if (res.totals) {
          // Fallback: create a single daily block from total hours
          const totalHrs = res.totals[p] || 0;
          const days = res.totalDays || 30;
          const avgDaily = totalHrs / days;
          state.allSlots[p] = Array.from({ length: days }, () => {
            if (avgDaily <= 0) return { from: null, to: null };
            if (avgDaily >= 24) return { from: '00:00', to: '24:00' };
            const half = avgDaily / 2;
            const fromMin = Math.round(720 - half * 60);
            const toMin = Math.round(720 + half * 60);
            return { from: formatMinutes(fromMin), to: formatMinutes(toMin) };
          });
        }
      });
    }
  } catch (e) {
    // Silently fail
  }
}

/* ---------------- OVERLAP-AWARE BILL CALCULATION ---------------- */

/**
 * The fairest model:
 * For each minute of the month, count how many people were present.
 * The cost of that minute is split equally among those present.
 * Each person's bill = sum of their share for each minute they were present.
 */
function calculateBillOverlap() {
  const { month, totalBill, totalDays, members } = state.bill;
  if (members.length === 0 || totalDays === 0) {
    return { month, totalBill, totalDays, members: [], memberHours: {}, grandTotal: 0, shares: {}, totalMinutes: 0 };
  }

  const totalMinutes = totalDays * 1440; // 1440 minutes per day
  const costPerMinute = totalBill > 0 ? totalBill / totalMinutes : 0;

  // Build a map: for each minute index (0 to totalMinutes-1), list of present members
  // minuteIndex = (day-1) * 1440 + minuteOfDay
  // To save memory, we'll compute per-person totals using the overlap formula directly

  // For each member, compute their "presence mask" as a list of [startMinute, endMinute] intervals
  // Then for each minute, count how many members are present, and add to each member's share

  // Get slots for each member (use local data for logged-in user, server data for others)
  const memberSlots = {};
  members.forEach(name => {
    if (name === state.name && state.slots.length > 0) {
      memberSlots[name] = state.slots;
    } else if (state.allSlots[name]) {
      memberSlots[name] = state.allSlots[name];
    } else {
      memberSlots[name] = [];
    }
  });

  // Convert each member's slots to minute intervals
  // Each interval: [startMinute, endMinute) where startMinute is global minute index
  const intervals = {}; // { memberName: [ [start, end], ... ] }
  members.forEach(name => {
    const slots = memberSlots[name] || [];
    const list = [];
    for (let d = 0; d < totalDays && d < slots.length; d++) {
      const slot = slots[d];
      if (!slot || !slot.from || !slot.to) continue;
      const fromMin = parseTime(slot.from);
      const toMin = parseTime(slot.to);
      if (fromMin === null || toMin === null) continue;

      const dayOffset = d * 1440;
      if (toMin >= fromMin) {
        // Normal: same day
        list.push([dayOffset + fromMin, dayOffset + toMin]);
      } else {
        // Overnight: crosses midnight
        list.push([dayOffset + fromMin, dayOffset + 1440]);
        if (d + 1 < totalDays) {
          list.push([(d + 1) * 1440, (d + 1) * 1440 + toMin]);
        }
      }
    }
    intervals[name] = list;
  });

  // For each minute, count present members and add to their share
  // We'll use a sweep-line algorithm for efficiency
  // Create events: (minute, type, name) where type = +1 for enter, -1 for leave
  const events = [];
  members.forEach(name => {
    (intervals[name] || []).forEach(([start, end]) => {
      events.push({ minute: start, type: 1, name });
      events.push({ minute: end, type: -1, name });
    });
  });

  // Sort events by minute
  events.sort((a, b) => a.minute - b.minute);

  // Sweep through events
  const present = {}; // { name: count of active intervals }
  members.forEach(name => { present[name] = 0; });
  let prevMinute = 0;
  let activeCount = 0;
  const memberCost = {};
  members.forEach(name => { memberCost[name] = 0; });

  for (const evt of events) {
    const duration = evt.minute - prevMinute;
    if (duration > 0 && activeCount > 0) {
      const costThisSegment = costPerMinute * duration;
      const perPerson = costThisSegment / activeCount;
      members.forEach(name => {
        if (present[name] > 0) {
          memberCost[name] += perPerson;
        }
      });
    }

    // Apply event
    if (evt.type === 1) {
      if (present[evt.name] === 0) activeCount++;
      present[evt.name]++;
    } else {
      present[evt.name]--;
      if (present[evt.name] === 0) activeCount--;
    }
    prevMinute = evt.minute;
  }

  // Compute hours for display
  const memberHours = {};
  let grandTotal = 0;
  members.forEach(name => {
    let totalHrs = 0;
    (intervals[name] || []).forEach(([start, end]) => {
      totalHrs += (end - start) / 60;
    });
    memberHours[name] = totalHrs;
    grandTotal += totalHrs;
  });

  return {
    month,
    totalBill,
    totalDays,
    members,
    memberHours,
    grandTotal,
    shares: memberCost,
    totalMinutes
  };
}

/* ---------------- RENDER BILL ---------------- */

function renderBill() {
  const result = calculateBillOverlap();
  const { month, totalBill, members, memberHours, grandTotal, shares } = result;

  el.billMonth.textContent = month || '—';
  el.billTotal.textContent = totalBill > 0 ? formatMoney(totalBill) : '—';
  el.billGrandHours.textContent = grandTotal > 0 ? grandTotal.toFixed(1) : '—';
  el.billMemberCount.textContent = members.length > 0 ? members.length : '—';

  el.billBody.innerHTML = '';

  if (members.length === 0) {
    el.billStatus.textContent = 'No members loaded yet.';
    el.billSum.textContent = '—';
    return;
  }

  if (grandTotal === 0) {
    el.billStatus.textContent = 'No hours logged yet — shares will appear once time is entered.';
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
    el.billSum.textContent = formatMoney(0);
    return;
  }

  members.forEach(name => {
    const hrs = memberHours[name] || 0;
    const pct = grandTotal > 0 ? (hrs / grandTotal) * 100 : 0;
    const bill = shares[name] || 0;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(name)}</td>
      <td>${hrs.toFixed(1)}</td>
      <td>${pct.toFixed(2)}%</td>
      <td>${formatMoney(bill)}</td>
    `;
    el.billBody.appendChild(tr);
  });

  // Sum check
  const sumBills = Object.values(shares).reduce((s, v) => s + v, 0);
  el.billSum.textContent = formatMoney(sumBills);

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
  await loadServerData();
  renderBill();
});

/* ---------------- INIT ---------------- */

showView('login');