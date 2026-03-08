/* ============================================
   RENTAL MANAGER — APPLICATION LOGIC
   ============================================ */


/* ============================================
   CONFIGURATION
   ============================================ */
const STORAGE_KEY = 'rental_manager_sheet_id';
const API_KEY = 'AIzaSyBxaFGGCVGH8z4PmSJwEjKiXbBfMsSlovQ';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

let SHEET_ID = localStorage.getItem(STORAGE_KEY) || '';
let DATA = {};

let STATE = {
  view: SHEET_ID ? 'loading' : 'setup',
  year: '2025',
  unit: null,
  search: '',
  filter: 'All'
};


/* ============================================
   GOOGLE SHEETS — DATA FETCHING
   ============================================ */

/**
 * Fetches all tenant data from a Google Sheet.
 * Expects yearly tabs (2018, 2019, etc.) with columns:
 * No | Name | Cell Number | Rent/Month | Jan | Feb | ... | Dec
 */
async function fetchSheetData(sheetId) {
  // Get list of sheet tabs
  var metaUrl = 'https://sheets.googleapis.com/v4/spreadsheets/' + sheetId + '?key=' + API_KEY + '&fields=sheets.properties.title';
  var metaRes = await fetch(metaUrl);

  if (!metaRes.ok) {
    throw new Error('Could not access the Google Sheet. Make sure sharing is set to "Anyone with the link".');
  }

  var meta = await metaRes.json();
  var sheetNames = meta.sheets.map(function (s) { return s.properties.title; });

  // Find year-named tabs (2018, 2019, 2020, etc.)
  var yearSheets = sheetNames.filter(function (n) { return /^(20\d{2})$/.test(n.trim()); });
  var data = {};

  for (var yi = 0; yi < yearSheets.length; yi++) {
    var year = yearSheets[yi];

    var url = 'https://sheets.googleapis.com/v4/spreadsheets/' + sheetId + '/values/' + encodeURIComponent(year) + '?key=' + API_KEY;
    var res = await fetch(url);
    if (!res.ok) continue;

    var json = await res.json();
    var rows = json.values || [];
    if (rows.length < 2) continue;

    // Find the header row (contains "Name" or month names)
    var headerIdx = -1;
    for (var i = 0; i < Math.min(rows.length, 5); i++) {
      var r = rows[i].map(function (v) { return (v || '').toString().toLowerCase().trim(); });
      if (r.indexOf('name') >= 0 || r.indexOf('jan') >= 0 || r.some(function (v) { return v.indexOf('rent') >= 0; })) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx < 0) continue;

    var header = rows[headerIdx].map(function (v) { return (v || '').toString().toLowerCase().trim(); });

    // Map month columns
    var monthMap = {};
    var mLookup = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
    var noCol = -1, nameCol = -1, phoneCol = -1, rentCol = -1;

    for (var ci = 0; ci < header.length; ci++) {
      var v = header[ci];
      if (v === 'no' || v === 'unit') { noCol = ci; }
      else if (v.indexOf('name') >= 0 && nameCol < 0) { nameCol = ci; }
      else if (v.indexOf('cell') >= 0 || v.indexOf('phone') >= 0) { phoneCol = ci; }
      else if (v.indexOf('rent') >= 0) { rentCol = ci; }
      else {
        for (var mk in mLookup) {
          if (v === mk) { monthMap[ci] = mLookup[mk]; break; }
        }
      }
    }

    // Process each tenant row
    for (var ri = headerIdx + 1; ri < rows.length; ri++) {
      var row = rows[ri];
      var unit = (row[noCol] || '').toString().trim();
      var name = (row[nameCol] || '').toString().trim();

      // Skip empty, blocked, or vacant rows
      if (!unit || !name) continue;
      var nameLower = name.toLowerCase();
      if (nameLower.indexOf('blocked') >= 0 || nameLower.indexOf('care taker') >= 0 || nameLower.indexOf('vacant') >= 0) continue;

      var phone = phoneCol >= 0 ? (row[phoneCol] || '').toString().trim() : '';
      var rent = rentCol >= 0 ? parseFloat((row[rentCol] || '0').toString().replace(/[^0-9.\-]/g, '')) : 0;
      if (isNaN(rent)) rent = 0;

      // Extract monthly payments
      var payments = {};
      for (var mci in monthMap) {
        var val = row[parseInt(mci)];
        if (val !== undefined && val !== null && val !== '') {
          var num = parseFloat(val.toString().replace(/[^0-9.\-]/g, ''));
          if (!isNaN(num) && num !== 0) {
            payments[monthMap[mci]] = num;
          }
        }
      }

      // Store tenant data
      if (!data[unit]) data[unit] = { years: {} };
      data[unit].years[year] = { name: name, phone: phone, rent: rent, payments: payments };
    }
  }

  return data;
}


/* ============================================
   HELPER FUNCTIONS
   ============================================ */

/** Format a number as KES currency */
function fmt(n) {
  if (!n && n !== 0) return '-';
  return 'KES ' + Math.round(n).toLocaleString();
}

/** Sort unit names: Block A first, then B, C, then numbered */
function sortUnits(a, b) {
  var blockA = a.match(/^[A-C]/) ? a[0] : 'Z';
  var blockB = b.match(/^[A-C]/) ? b[0] : 'Z';
  var numA = parseInt(a.replace(/\D/g, '')) || 0;
  var numB = parseInt(b.replace(/\D/g, '')) || 0;
  if (blockA !== blockB) return blockA < blockB ? -1 : 1;
  return numA - numB;
}

/** Get block letter from unit name */
function getBlock(u) {
  if (u.charAt(0) === 'A') return 'A';
  if (u.charAt(0) === 'B') return 'B';
  if (u.charAt(0) === 'C') return 'C';
  return 'Other';
}

/** Get all unique years from loaded data */
function getAllYears() {
  var yrs = {};
  for (var u in DATA) {
    for (var y in DATA[u].years) {
      yrs[y] = true;
    }
  }
  return Object.keys(yrs).sort();
}


/* ============================================
   VIEW RENDERERS
   ============================================ */

/** Render the setup/connection screen */
function renderSetup() {
  return '' +
    '<div class="topbar"><h1><span>🏠</span> Rental Manager — Setup</h1></div>' +
    '<div class="content">' +
    '<div class="setup">' +
    '<h2>👋 Welcome! Let\'s connect your Google Sheet</h2>' +
    '<p>Follow these steps to get started:</p>' +

    '<div class="step">' +
    '<span class="step-num">1</span>' +
    '<strong>Upload your Excel file to Google Sheets</strong><br>' +
    'Go to <a href="https://sheets.google.com" target="_blank" style="color:#4a7fb5">sheets.google.com</a> → ' +
    'Click <strong>"Blank spreadsheet"</strong> → Then <strong>File → Import → Upload</strong> → Select your Excel file' +
    '</div>' +

    '<div class="step">' +
    '<span class="step-num">2</span>' +
    '<strong>Share the sheet</strong><br>' +
    'Click the green <strong>"Share"</strong> button (top right) → Change to <strong>"Anyone with the link"</strong> → ' +
    'Set as <strong>"Viewer"</strong> → Click Done' +
    '</div>' +

    '<div class="step">' +
    '<span class="step-num">3</span>' +
    '<strong>Copy the Sheet ID from the URL</strong><br>' +
    'Your URL looks like: sheets.google.com/spreadsheets/d/<strong style="color:#c8956c">THIS-LONG-ID-HERE</strong>/edit<br>' +
    'Copy just the long ID part between /d/ and /edit' +
    '</div>' +

    '<p style="margin-top:16px"><strong>Paste your Google Sheet ID below:</strong></p>' +
    '<input type="text" id="sheet-id-input" placeholder="e.g. 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms" />' +
    '<div id="setup-error"></div>' +
    '<button class="big-btn" onclick="connectSheet()">Connect My Sheet →</button>' +

    '<p class="privacy-note">' +
    '<strong>Your data stays private.</strong> Only you can see this app. The Google Sheet is read-only — nobody can change your data through this app.' +
    '</p>' +
    '</div>' +
    '</div>';
}

/** Render the dashboard/summary view */
function renderDashboard() {
  var units = Object.keys(DATA);
  var totalExpected = 0;
  var totalCollected = 0;
  var paidFull = 0;
  var partial = 0;
  var unpaid = 0;
  var monthlyIncome = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

  units.forEach(function (u) {
    var yd = DATA[u].years[STATE.year];
    if (!yd || !yd.rent) return;
    totalExpected += yd.rent * 12;
    var collected = 0;
    for (var m in yd.payments) collected += yd.payments[m];
    totalCollected += collected;
    var mp = Object.keys(yd.payments).length;
    if (mp >= 12) paidFull++;
    else if (mp > 0) partial++;
    else unpaid++;
    for (var m in yd.payments) {
      monthlyIncome[parseInt(m) - 1] += yd.payments[m];
    }
  });

  var arrears = totalExpected - totalCollected;
  var rate = totalExpected > 0 ? Math.round(totalCollected / totalExpected * 100) : 0;
  var maxMonth = Math.max.apply(null, monthlyIncome.concat([1]));

  // Build bar chart HTML
  var chartBars = '';
  for (var i = 0; i < 12; i++) {
    var val = monthlyIncome[i];
    var h = (val / maxMonth) * 110;
    chartBars += '' +
      '<div class="chart-bar-wrapper">' +
      '<div class="chart-bar-label">' + (val > 0 ? Math.round(val / 1000) + 'k' : '') + '</div>' +
      '<div class="chart-bar ' + (val > 0 ? 'has-data' : 'no-data') + '" style="height:' + Math.max(h, 3) + 'px"></div>' +
      '<div class="chart-month-label">' + MONTHS[i] + '</div>' +
      '</div>';
  }

  return '' +
    '<div class="stat-grid">' +
    '<div class="stat-card blue"><div class="stat-label">💰 Total Collected</div><div class="stat-value">' + fmt(totalCollected) + '</div></div>' +
    '<div class="stat-card green"><div class="stat-label">📊 Collection Rate</div><div class="stat-value">' + rate + '%</div></div>' +
    '<div class="stat-card red"><div class="stat-label">⚠️ Total Arrears</div><div class="stat-value">' + fmt(arrears > 0 ? arrears : 0) + '</div></div>' +
    '<div class="stat-card"><div class="stat-label">🎯 Expected (Full Year)</div><div class="stat-value">' + fmt(totalExpected) + '</div></div>' +
    '</div>' +

    '<div class="section-title">Monthly Collection — ' + STATE.year + '</div>' +
    '<div class="chart-container">' + chartBars + '</div>' +

    '<div class="section-title">Payment Status</div>' +
    '<div class="stat-grid">' +
    '<div class="stat-card green"><div class="stat-label">✅ Fully Paid</div><div class="stat-value">' + paidFull + '</div></div>' +
    '<div class="stat-card" style="border-left-color:#c89a2c"><div class="stat-label">⏳ Partial</div><div class="stat-value" style="color:#c89a2c">' + partial + '</div></div>' +
    '<div class="stat-card red"><div class="stat-label">❌ No Payment</div><div class="stat-value">' + unpaid + '</div></div>' +
    '</div>';
}

/** Render the tenants list view */
function renderTenants() {
  var allUnits = Object.keys(DATA).sort(sortUnits);

  // Apply filters
  var units = allUnits.filter(function (u) {
    var yd = DATA[u].years[STATE.year];
    if (!yd) return false;
    if (STATE.filter !== 'All' && getBlock(u) !== STATE.filter) return false;
    if (STATE.search) {
      var s = STATE.search.toLowerCase();
      var unitMatch = u.toLowerCase().indexOf(s) >= 0;
      var nameMatch = false;
      var phoneMatch = false;
      for (var y in DATA[u].years) {
        if (DATA[u].years[y].name.toLowerCase().indexOf(s) >= 0) nameMatch = true;
        if ((DATA[u].years[y].phone || '').indexOf(s) >= 0) phoneMatch = true;
      }
      return unitMatch || nameMatch || phoneMatch;
    }
    return true;
  });

  // Build filter buttons
  var filterBtns = '';
  ['All', 'A', 'B', 'C', 'Other'].forEach(function (b) {
    var label = b === 'All' ? 'All' : (b === 'Other' ? '1-13' : 'Block ' + b);
    filterBtns += '<button class="filter-btn ' + (STATE.filter === b ? 'active' : '') + '" onclick="STATE.filter=\'' + b + '\';render()">' + label + '</button>';
  });

  // Build tenant cards
  var cards = '';
  units.forEach(function (u) {
    var yd = DATA[u].years[STATE.year];
    var paid = 0;
    for (var m in yd.payments) paid += yd.payments[m];
    var mp = Object.keys(yd.payments).length;
    var expected = yd.rent * 12;
    var status = paid >= expected ? 'good' : (mp > 0 ? 'partial' : 'unpaid');

    cards += '' +
      '<div class="tenant-card" onclick="openProfile(\'' + u + '\')">' +
      '<div class="tc-left">' +
      '<div class="tc-unit">' + u + '</div>' +
      '<div>' +
      '<div class="tc-name">' + yd.name + '</div>' +
      '<div class="tc-sub">' + (yd.phone || 'No phone') + ' · ' + fmt(yd.rent) + '/mo</div>' +
      '</div>' +
      '</div>' +
      '<div>' +
      '<div class="tc-amount ' + status + '">' + fmt(paid) + '</div>' +
      '<div class="tc-months">' + mp + '/12 months paid</div>' +
      '</div>' +
      '</div>';
  });

  return '' +
    '<input class="search-box" type="text" placeholder="🔍  Type a name, unit, or phone number..." ' +
    'value="' + STATE.search + '" oninput="STATE.search=this.value;render()" />' +
    '<div class="filter-row">' + filterBtns + '</div>' +
    '<div class="results-count">' + units.length + ' tenants found</div>' +
    cards;
}

/** Render a single tenant's profile */
function renderProfile() {
  if (!STATE.unit || !DATA[STATE.unit]) return '<p>Tenant not found</p>';

  var t = DATA[STATE.unit];
  var yd = t.years[STATE.year];

  // No data for selected year
  if (!yd) {
    return '' +
      '<button class="back-btn" onclick="go(\'tenants\')">← Back to All Tenants</button>' +
      '<div class="no-data-msg">No data for Unit ' + STATE.unit + ' in ' + STATE.year + '.<br>Try selecting a different year above.</div>';
  }

  var paid = 0;
  for (var m in yd.payments) paid += yd.payments[m];
  var expected = yd.rent * 12;
  var arrears = expected - paid;

  // Build month grid
  var monthCells = '';
  for (var i = 0; i < 12; i++) {
    var payment = yd.payments[i + 1];
    var isPaid = payment !== undefined;
    var isOver = isPaid && payment >= yd.rent;
    var isUnder = isPaid && payment < yd.rent;
    var cls = isOver ? 'paid' : (isUnder ? 'short' : 'missed');
    var noteText = '';
    if (isPaid) {
      noteText = isOver ? (payment > yd.rent ? '+' + fmt(payment - yd.rent) : '✓ Full') : 'Short ' + fmt(yd.rent - payment);
    } else {
      noteText = 'Not paid';
    }

    monthCells += '' +
      '<div class="month-cell ' + cls + '">' +
      '<div class="mc-month">' + MONTHS[i] + '</div>' +
      '<div class="mc-amount ' + cls + '">' + (isPaid ? fmt(payment) : '—') + '</div>' +
      '<div class="mc-note">' + noteText + '</div>' +
      '</div>';
  }

  // Build history chips
  var allYears = Object.keys(t.years).sort();
  var historyChips = '';
  allYears.forEach(function (yr) {
    var d = t.years[yr];
    var yrPaid = 0;
    for (var m in d.payments) yrPaid += d.payments[m];
    var shortName = d.name.split(' ').slice(0, 2).join(' ');

    historyChips += '' +
      '<div class="history-chip ' + (yr === STATE.year ? 'active' : '') + '" onclick="setYear(\'' + yr + '\')">' +
      '<div class="hc-year">' + yr + '</div>' +
      '<div class="hc-name">' + shortName + '</div>' +
      '<div class="hc-total">' + fmt(yrPaid) + '</div>' +
      '</div>';
  });

  return '' +
    '<button class="back-btn" onclick="go(\'tenants\')">← Back to All Tenants</button>' +

    '<div class="profile-header">' +
    '<div class="ph-unit">UNIT ' + STATE.unit + '</div>' +
    '<div class="ph-name">' + yd.name + '</div>' +
    '<div class="ph-detail">📱 ' + (yd.phone || 'No phone on file') + '</div>' +
    '<div class="ph-detail">💰 Rent: ' + fmt(yd.rent) + ' per month</div>' +
    '<div class="ph-total-row">' +
    '<div>' +
    '<div class="ph-total-label">Total Paid in ' + STATE.year + '</div>' +
    (arrears > 0 ? '<div class="ph-arrears">Arrears: ' + fmt(arrears) + '</div>' : '') +
    '</div>' +
    '<div class="ph-total-val">' + fmt(paid) + '</div>' +
    '</div>' +
    '</div>' +

    '<div class="section-title">Payments — ' + STATE.year + '</div>' +
    '<div class="month-grid">' + monthCells + '</div>' +

    '<div class="section-title">History — Unit ' + STATE.unit + '</div>' +
    '<div class="history-row">' + historyChips + '</div>';
}

/** Render the KRA tax view */
function renderTax() {
  var monthly = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

  for (var u in DATA) {
    var yd = DATA[u].years[STATE.year];
    if (!yd) continue;
    for (var m in yd.payments) {
      monthly[parseInt(m) - 1] += yd.payments[m];
    }
  }

  var annual = 0;
  for (var i = 0; i < 12; i++) annual += monthly[i];
  var tax = annual > 288000 ? annual * 0.075 : 0;

  // Build table rows
  var tableRows = '';
  for (var i = 0; i < 12; i++) {
    var g = monthly[i];
    var t = g * 0.075;
    tableRows += '' +
      '<tr>' +
      '<td>' + MONTHS[i] + '</td>' +
      '<td>' + (g > 0 ? fmt(g) : '—') + '</td>' +
      '<td class="tax-red">' + (g > 0 ? fmt(t) : '—') + '</td>' +
      '<td class="tax-green">' + (g > 0 ? fmt(g - t) : '—') + '</td>' +
      '</tr>';
  }

  return '' +
    '<div class="stat-grid">' +
    '<div class="stat-card blue"><div class="stat-label">💰 Gross Rent (' + STATE.year + ')</div><div class="stat-value">' + fmt(annual) + '</div></div>' +
    '<div class="stat-card red"><div class="stat-label">📋 MRI Tax (7.5%)</div><div class="stat-value">' + fmt(tax) + '</div></div>' +
    '<div class="stat-card green"><div class="stat-label">✅ Net After Tax</div><div class="stat-value">' + fmt(annual - tax) + '</div></div>' +
    '</div>' +

    '<div class="tax-info">' +
    '<strong>KRA Monthly Rental Income (MRI) Tax</strong><br>' +
    'Rate: <strong>7.5%</strong> of gross rent · Exempt if annual rent ≤ KES 288,000 · Due by <strong>20th of the following month</strong>' +
    '</div>' +

    '<div class="tax-card">' +
    '<table>' +
    '<thead><tr><th>Month</th><th>Gross Rent</th><th>Tax (7.5%)</th><th>Net Income</th></tr></thead>' +
    '<tbody>' +
    tableRows +
    '<tr class="total-row">' +
    '<td>TOTAL</td>' +
    '<td>' + fmt(annual) + '</td>' +
    '<td class="tax-red">' + fmt(tax) + '</td>' +
    '<td class="tax-green">' + fmt(annual - tax) + '</td>' +
    '</tr>' +
    '</tbody>' +
    '</table>' +
    '</div>';
}


/* ============================================
   MAIN RENDER FUNCTION
   ============================================ */
function render() {
  var app = document.getElementById('app');

  // Setup screen
  if (STATE.view === 'setup') {
    app.innerHTML = renderSetup();
    return;
  }

  // Loading screen
  if (STATE.view === 'loading') {
    app.innerHTML = '' +
      '<div class="topbar"><h1><span>🏠</span> Rental Manager</h1></div>' +
      '<div class="loading">' +
      '<div class="loading-spinner"></div>' +
      '<div class="loading-text">Loading your data...</div>' +
      '</div>';
    loadData();
    return;
  }

  // Make sure selected year is valid
  var allYears = getAllYears();
  if (allYears.indexOf(STATE.year) < 0) {
    STATE.year = allYears[allYears.length - 1] || '2025';
  }

  // Build year buttons
  var yearBtns = '';
  allYears.forEach(function (y) {
    yearBtns += '<button class="year-btn ' + (STATE.year === y ? 'active' : '') + '" onclick="setYear(\'' + y + '\')">' + y + '</button>';
  });

  // Build nav buttons
  var navItems = [
    { id: 'dashboard', icon: '📊', label: 'Summary' },
    { id: 'tenants', icon: '👥', label: 'Tenants' },
    { id: 'tax', icon: '📋', label: 'Tax' }
  ];
  var navBtns = '';
  navItems.forEach(function (n) {
    var isActive = STATE.view === n.id || (STATE.view === 'profile' && n.id === 'tenants');
    navBtns += '<button class="' + (isActive ? 'active' : '') + '" onclick="go(\'' + n.id + '\')">' + n.icon + ' ' + n.label + '</button>';
  });

  // Build page content
  var pageContent = '';
  if (STATE.view === 'dashboard') pageContent = renderDashboard();
  else if (STATE.view === 'tenants') pageContent = renderTenants();
  else if (STATE.view === 'profile') pageContent = renderProfile();
  else if (STATE.view === 'tax') pageContent = renderTax();

  app.innerHTML = '' +
    '<div class="topbar">' +
    '<h1><span>🏠</span> Rental Manager</h1>' +
    '<div class="topbar-sub">' + Object.keys(DATA).length + ' Units · ' + (allYears[0] || '') + '-' + (allYears[allYears.length - 1] || '') + '</div>' +
    '</div>' +
    '<div class="nav">' + navBtns + '</div>' +
    '<div class="year-bar">' + yearBtns + '</div>' +
    '<div class="content">' + pageContent + '</div>';
}


/* ============================================
   USER ACTIONS
   ============================================ */

/** Switch to a different view */
function go(view) {
  STATE.view = view;
  STATE.unit = null;
  render();
}

/** Change the selected year */
function setYear(y) {
  STATE.year = y;
  render();
}

/** Open a tenant's profile */
function openProfile(u) {
  STATE.unit = u;
  STATE.view = 'profile';
  render();
}

/** Connect to a Google Sheet */
async function connectSheet() {
  var input = document.getElementById('sheet-id-input');
  var errDiv = document.getElementById('setup-error');
  var id = input.value.trim();

  // Handle if user pastes the full URL
  var match = id.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (match) id = match[1];

  if (!id) {
    errDiv.innerHTML = '<div class="error-msg">Please paste your Google Sheet ID or URL</div>';
    return;
  }

  errDiv.innerHTML = '';
  input.disabled = true;
  STATE.view = 'loading';
  SHEET_ID = id;
  render();

  try {
    DATA = await fetchSheetData(id);
    if (Object.keys(DATA).length === 0) {
      throw new Error('No tenant data found. Make sure your sheet has yearly tabs (2018, 2019, etc.) with columns: No, Name, Cell Number, Rent, Jan-Dec');
    }
    localStorage.setItem(STORAGE_KEY, id);
    STATE.view = 'dashboard';
  } catch (e) {
    SHEET_ID = '';
    localStorage.removeItem(STORAGE_KEY);
    STATE.view = 'setup';
    render();
    setTimeout(function () {
      var ed = document.getElementById('setup-error');
      if (ed) ed.innerHTML = '<div class="error-msg">❌ ' + e.message + '</div>';
      var inp = document.getElementById('sheet-id-input');
      if (inp) inp.disabled = false;
    }, 50);
    return;
  }

  render();
}

/** Load data from a previously saved Sheet ID */
async function loadData() {
  try {
    DATA = await fetchSheetData(SHEET_ID);
    if (Object.keys(DATA).length === 0) throw new Error('No data found');
    STATE.view = 'dashboard';
  } catch (e) {
    SHEET_ID = '';
    localStorage.removeItem(STORAGE_KEY);
    STATE.view = 'setup';
  }
  render();
}


/* ============================================
   START THE APP
   ============================================ */
render();
