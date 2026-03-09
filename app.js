/* ============================================
   RENTAL MANAGER — APPLICATION LOGIC
   No API key needed. Uses Google Sheets public CSV export.
   ============================================ */

var STORAGE_KEY = 'rental_manager_sheet_id';
var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
var SHEET_ID = localStorage.getItem(STORAGE_KEY) || '';
var DATA = {};
var STATE = { view: SHEET_ID ? 'loading' : 'setup', year: '2025', unit: null, search: '', filter: 'All' };


/* ============================================
   CSV PARSER
   ============================================ */
function parseCSV(text) {
  var rows = [], current = '', inQuote = false, row = [];
  for (var i = 0; i < text.length; i++) {
    var ch = text[i], next = text[i + 1];
    if (inQuote) {
      if (ch === '"' && next === '"') { current += '"'; i++; }
      else if (ch === '"') { inQuote = false; }
      else { current += ch; }
    } else {
      if (ch === '"') { inQuote = true; }
      else if (ch === ',') { row.push(current); current = ''; }
      else if (ch === '\n' || (ch === '\r' && next === '\n')) { row.push(current); current = ''; rows.push(row); row = []; if (ch === '\r') i++; }
      else if (ch === '\r') { row.push(current); current = ''; rows.push(row); row = []; }
      else { current += ch; }
    }
  }
  if (current || row.length > 0) { row.push(current); rows.push(row); }
  return rows;
}


/* ============================================
   GOOGLE SHEETS FETCHER (NO API KEY)
   ============================================ */
async function fetchSheetCSV(sheetId, sheetName) {
  var cacheBust = '&_t=' + Date.now();
  var url = 'https://docs.google.com/spreadsheets/d/' + sheetId + '/gviz/tq?tqx=out:csv&sheet=' + encodeURIComponent(sheetName) + cacheBust;
  var res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) return null;
  var text = await res.text();
  if (!text || text.indexOf('<!DOCTYPE') >= 0 || text.indexOf('<html') >= 0) return null;
  return parseCSV(text);
}

async function fetchSheetData(sheetId) {
  var data = {};
  var yearsToTry = ['2018', '2019', '2020', '2021', '2022', '2023', '2024', '2025', '2026'];
  var foundAny = false;

  // Test access
  var testUrl = 'https://docs.google.com/spreadsheets/d/' + sheetId + '/gviz/tq?tqx=out:csv&range=A1&_t=' + Date.now();
  var testRes = await fetch(testUrl, { cache: 'no-store' });
  if (!testRes.ok) throw new Error('Could not access the Google Sheet. Please check: 1) The Sheet ID is correct. 2) Sharing is set to "Anyone with the link".');
  var testText = await testRes.text();
  if (testText.indexOf('<!DOCTYPE') >= 0) throw new Error('Could not access the Google Sheet. Please check: 1) The Sheet ID is correct. 2) Sharing is set to "Anyone with the link".');

  // Fetch all years in parallel
  var fetches = yearsToTry.map(function (year) {
    return fetchSheetCSV(sheetId, year).then(function (rows) { return { year: year, rows: rows }; });
  });
  var results = await Promise.all(fetches);

  for (var ri = 0; ri < results.length; ri++) {
    var year = results[ri].year, rows = results[ri].rows;
    if (!rows || rows.length < 2) continue;

    var headerIdx = -1;
    for (var i = 0; i < Math.min(rows.length, 5); i++) {
      var r = rows[i].map(function (v) { return (v || '').toLowerCase().trim(); });
      if (r.indexOf('name') >= 0 || r.indexOf('jan') >= 0 || r.some(function (v) { return v.indexOf('rent') >= 0; })) { headerIdx = i; break; }
    }
    if (headerIdx < 0) continue;

    var header = rows[headerIdx].map(function (v) { return (v || '').toLowerCase().trim(); });
    var monthMap = {};
    var mLookup = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
    var noCol = -1, nameCol = -1, phoneCol = -1, rentCol = -1;

    for (var ci = 0; ci < header.length; ci++) {
      var v = header[ci];
      if (v === 'no' || v === 'unit') noCol = ci;
      else if (v.indexOf('name') >= 0 && nameCol < 0) nameCol = ci;
      else if (v.indexOf('cell') >= 0 || v.indexOf('phone') >= 0) phoneCol = ci;
      else if (v.indexOf('rent') >= 0) rentCol = ci;
      else { for (var mk in mLookup) { if (v === mk) { monthMap[ci] = mLookup[mk]; break; } } }
    }
    if (nameCol < 0) continue;

    for (var ti = headerIdx + 1; ti < rows.length; ti++) {
      var row = rows[ti];
      if (!row || row.length < 2) continue;
      var unit = noCol >= 0 ? (row[noCol] || '').trim() : '';
      var name = nameCol >= 0 ? (row[nameCol] || '').trim() : '';
      if (!unit || !name) continue;
      var nl = name.toLowerCase();
      if (nl.indexOf('blocked') >= 0 || nl.indexOf('care taker') >= 0 || nl.indexOf('vacant') >= 0) continue;

      var phone = phoneCol >= 0 ? (row[phoneCol] || '').trim() : '';
      var rent = 0;
      if (rentCol >= 0 && row[rentCol]) { rent = parseFloat(row[rentCol].replace(/[^0-9.\-]/g, '')); if (isNaN(rent)) rent = 0; }

      var payments = {};
      for (var mci in monthMap) {
        var val = row[parseInt(mci)];
        if (val) { var num = parseFloat(val.replace(/[^0-9.\-]/g, '')); if (!isNaN(num) && num !== 0) payments[monthMap[mci]] = num; }
      }

      if (!data[unit]) data[unit] = { years: {} };
      data[unit].years[year] = { name: name, phone: phone, rent: rent, payments: payments };
      foundAny = true;
    }
  }

  if (!foundAny) throw new Error('No tenant data found. Make sure your Google Sheet has tabs named by year (2018, 2019, etc.) with columns: No, Name, Cell Number, Rent/Month, Jan through Dec.');
  return data;
}


/* ============================================
   HELPERS
   ============================================ */
function fmt(n) { if (!n && n !== 0) return '-'; return 'KES ' + Math.round(n).toLocaleString(); }

function sortUnits(a, b) {
  var bA = a.match(/^[A-C]/) ? a[0] : 'Z', bB = b.match(/^[A-C]/) ? b[0] : 'Z';
  var nA = parseInt(a.replace(/\D/g, '')) || 0, nB = parseInt(b.replace(/\D/g, '')) || 0;
  if (bA !== bB) return bA < bB ? -1 : 1; return nA - nB;
}

function getBlock(u) { if (u.charAt(0) === 'A') return 'A'; if (u.charAt(0) === 'B') return 'B'; if (u.charAt(0) === 'C') return 'C'; return 'Other'; }

function getAllYears() { var y = {}; for (var u in DATA) for (var yr in DATA[u].years) y[yr] = 1; return Object.keys(y).sort(); }


/* ============================================
   RENDERERS
   ============================================ */
function renderSetup() {
  return '<div class="topbar"><h1><span>🏠</span> Rental Manager — Setup</h1></div><div class="content"><div class="setup">' +
    '<h2>👋 Welcome! Let\'s connect your Google Sheet</h2><p>Follow these simple steps:</p>' +
    '<div class="step"><span class="step-num">1</span><strong>Upload your Excel file to Google Sheets</strong><br>Go to <a href="https://sheets.google.com" target="_blank" style="color:#4a7fb5">sheets.google.com</a> → Click <strong>"Blank spreadsheet"</strong> → Then <strong>File → Import → Upload</strong> → Select your Excel file</div>' +
    '<div class="step"><span class="step-num">2</span><strong>Share the sheet</strong><br>Click the green <strong>"Share"</strong> button (top right) → Change to <strong>"Anyone with the link"</strong> → Set as <strong>"Viewer"</strong> → Click Done</div>' +
    '<div class="step"><span class="step-num">3</span><strong>Copy the link</strong><br>Click <strong>Share</strong> again → Click <strong>"Copy link"</strong> → Paste it below. You can paste the <strong>full URL</strong> or just the ID — both work!</div>' +
    '<p style="margin-top:16px"><strong>Paste your Google Sheet link or ID below:</strong></p>' +
    '<input type="text" id="sheet-id-input" placeholder="Paste full link or Sheet ID here..." />' +
    '<div id="setup-error"></div>' +
    '<button class="big-btn" onclick="connectSheet()">Connect My Sheet →</button>' +
    '<p class="privacy-note"><strong>Your data stays private.</strong> Only you can see this app. The Google Sheet is read-only — nobody can change your data through this app.</p>' +
    '</div></div>';
}

function renderDashboard() {
  var units = Object.keys(DATA), tE = 0, tC = 0, pF = 0, pa = 0, up = 0;
  var mI = [0,0,0,0,0,0,0,0,0,0,0,0];
  units.forEach(function (u) {
    var yd = DATA[u].years[STATE.year]; if (!yd || !yd.rent) return;
    tE += yd.rent * 12; var c = 0;
    for (var m in yd.payments) { c += yd.payments[m]; mI[parseInt(m) - 1] += yd.payments[m]; }
    tC += c; var mp = Object.keys(yd.payments).length;
    if (mp >= 12) pF++; else if (mp > 0) pa++; else up++;
  });
  var arr = tE - tC, rate = tE > 0 ? Math.round(tC / tE * 100) : 0;
  var mx = Math.max.apply(null, mI.concat([1]));
  var bars = '';
  for (var i = 0; i < 12; i++) { var v = mI[i], h = (v/mx)*110; bars += '<div class="chart-bar-wrapper"><div class="chart-bar-label">' + (v > 0 ? Math.round(v/1000)+'k' : '') + '</div><div class="chart-bar ' + (v > 0 ? 'has-data' : 'no-data') + '" style="height:'+Math.max(h,3)+'px"></div><div class="chart-month-label">'+MONTHS[i]+'</div></div>'; }

  return '<div class="stat-grid">' +
    '<div class="stat-card blue"><div class="stat-label">💰 Total Collected</div><div class="stat-value">'+fmt(tC)+'</div></div>' +
    '<div class="stat-card green"><div class="stat-label">📊 Collection Rate</div><div class="stat-value">'+rate+'%</div></div>' +
    '<div class="stat-card red"><div class="stat-label">⚠️ Total Arrears</div><div class="stat-value">'+fmt(arr > 0 ? arr : 0)+'</div></div>' +
    '<div class="stat-card"><div class="stat-label">🎯 Expected (Full Year)</div><div class="stat-value">'+fmt(tE)+'</div></div></div>' +
    '<div class="section-title">Monthly Collection — '+STATE.year+'</div><div class="chart-container">'+bars+'</div>' +
    '<div class="section-title">Payment Status</div><div class="stat-grid">' +
    '<div class="stat-card green"><div class="stat-label">✅ Fully Paid</div><div class="stat-value">'+pF+'</div></div>' +
    '<div class="stat-card" style="border-left-color:#c89a2c"><div class="stat-label">⏳ Partial</div><div class="stat-value" style="color:#c89a2c">'+pa+'</div></div>' +
    '<div class="stat-card red"><div class="stat-label">❌ No Payment</div><div class="stat-value">'+up+'</div></div></div>';
}

function renderTenants() {
  var all = Object.keys(DATA).sort(sortUnits);
  var units = all.filter(function (u) {
    var yd = DATA[u].years[STATE.year]; if (!yd) return false;
    if (STATE.filter !== 'All' && getBlock(u) !== STATE.filter) return false;
    if (STATE.search) { var s = STATE.search.toLowerCase(); var ok = u.toLowerCase().indexOf(s) >= 0;
      for (var y in DATA[u].years) { if (DATA[u].years[y].name.toLowerCase().indexOf(s) >= 0) ok = true; if ((DATA[u].years[y].phone||'').indexOf(s) >= 0) ok = true; }
      return ok; } return true;
  });
  var fb = ''; ['All','A','B','C','Other'].forEach(function(b) { var l = b==='All'?'All':(b==='Other'?'1-13':'Block '+b); fb += '<button class="filter-btn '+(STATE.filter===b?'active':'')+'" onclick="STATE.filter=\''+b+'\';render()">'+l+'</button>'; });
  var cards = ''; units.forEach(function(u) {
    var yd = DATA[u].years[STATE.year], p = 0; for (var m in yd.payments) p += yd.payments[m];
    var mp = Object.keys(yd.payments).length, st = p >= yd.rent*12 ? 'good' : (mp > 0 ? 'partial' : 'unpaid');
    cards += '<div class="tenant-card" onclick="openProfile(\''+u+'\')"><div class="tc-left"><div class="tc-unit">'+u+'</div><div><div class="tc-name">'+yd.name+'</div><div class="tc-sub">'+(yd.phone||'No phone')+' · '+fmt(yd.rent)+'/mo</div></div></div><div><div class="tc-amount '+st+'">'+fmt(p)+'</div><div class="tc-months">'+mp+'/12 months paid</div></div></div>';
  });
  return '<input class="search-box" type="text" placeholder="🔍  Type a name, unit, or phone number..." value="'+STATE.search+'" oninput="STATE.search=this.value;render()" /><div class="filter-row">'+fb+'</div><div class="results-count">'+units.length+' tenants found</div>'+cards;
}

function renderProfile() {
  if (!STATE.unit || !DATA[STATE.unit]) return '<p>Tenant not found</p>';
  var t = DATA[STATE.unit], yd = t.years[STATE.year];
  if (!yd) return '<button class="back-btn" onclick="go(\'tenants\')">← Back to All Tenants</button><div class="no-data-msg">No data for Unit '+STATE.unit+' in '+STATE.year+'.<br>Try selecting a different year above.</div>';

  var p = 0; for (var m in yd.payments) p += yd.payments[m];
  var exp = yd.rent * 12, arr = exp - p;

  var mc = ''; for (var i = 0; i < 12; i++) { var pay = yd.payments[i+1], ip = pay !== undefined, io = ip && pay >= yd.rent, iu = ip && pay < yd.rent;
    var cl = io ? 'paid' : (iu ? 'short' : 'missed'), nt = ip ? (io ? (pay > yd.rent ? '+'+fmt(pay-yd.rent) : '✓ Full') : 'Short '+fmt(yd.rent-pay)) : 'Not paid';
    mc += '<div class="month-cell '+cl+'"><div class="mc-month">'+MONTHS[i]+'</div><div class="mc-amount '+cl+'">'+(ip ? fmt(pay) : '—')+'</div><div class="mc-note">'+nt+'</div></div>';
  }
  var hc = ''; Object.keys(t.years).sort().forEach(function(yr) { var d = t.years[yr], yp = 0; for (var m in d.payments) yp += d.payments[m];
    hc += '<div class="history-chip '+(yr===STATE.year?'active':'')+'" onclick="setYear(\''+yr+'\')"><div class="hc-year">'+yr+'</div><div class="hc-name">'+d.name.split(' ').slice(0,2).join(' ')+'</div><div class="hc-total">'+fmt(yp)+'</div></div>';
  });

  return '<button class="back-btn" onclick="go(\'tenants\')">← Back to All Tenants</button>' +
    '<div class="profile-header"><div class="ph-unit">UNIT '+STATE.unit+'</div><div class="ph-name">'+yd.name+'</div>' +
    '<div class="ph-detail">📱 '+(yd.phone||'No phone on file')+'</div><div class="ph-detail">💰 Rent: '+fmt(yd.rent)+' per month</div>' +
    '<div class="ph-total-row"><div><div class="ph-total-label">Total Paid in '+STATE.year+'</div>'+(arr > 0 ? '<div class="ph-arrears">Arrears: '+fmt(arr)+'</div>' : '')+'</div><div class="ph-total-val">'+fmt(p)+'</div></div></div>' +
    '<div class="section-title">Payments — '+STATE.year+'</div><div class="month-grid">'+mc+'</div>' +
    '<div class="section-title">History — Unit '+STATE.unit+'</div><div class="history-row">'+hc+'</div>';
}

function renderTax() {
  var mo = [0,0,0,0,0,0,0,0,0,0,0,0];
  for (var u in DATA) { var yd = DATA[u].years[STATE.year]; if (!yd) continue; for (var m in yd.payments) mo[parseInt(m)-1] += yd.payments[m]; }
  var an = 0; for (var i = 0; i < 12; i++) an += mo[i];
  var tx = an > 288000 ? an * 0.075 : 0;
  var tr = ''; for (var i = 0; i < 12; i++) { var g = mo[i], t = g*0.075;
    tr += '<tr><td>'+MONTHS[i]+'</td><td>'+(g>0?fmt(g):'—')+'</td><td class="tax-red">'+(g>0?fmt(t):'—')+'</td><td class="tax-green">'+(g>0?fmt(g-t):'—')+'</td></tr>';
  }
  return '<div class="stat-grid">' +
    '<div class="stat-card blue"><div class="stat-label">💰 Gross Rent ('+STATE.year+')</div><div class="stat-value">'+fmt(an)+'</div></div>' +
    '<div class="stat-card red"><div class="stat-label">📋 MRI Tax (7.5%)</div><div class="stat-value">'+fmt(tx)+'</div></div>' +
    '<div class="stat-card green"><div class="stat-label">✅ Net After Tax</div><div class="stat-value">'+fmt(an-tx)+'</div></div></div>' +
    '<div class="tax-info"><strong>KRA Monthly Rental Income (MRI) Tax</strong><br>Rate: <strong>7.5%</strong> of gross rent · Exempt if annual rent ≤ KES 288,000 · Due by <strong>20th of the following month</strong></div>' +
    '<div class="tax-card"><table><thead><tr><th>Month</th><th>Gross Rent</th><th>Tax (7.5%)</th><th>Net Income</th></tr></thead><tbody>'+tr+
    '<tr class="total-row"><td>TOTAL</td><td>'+fmt(an)+'</td><td class="tax-red">'+fmt(tx)+'</td><td class="tax-green">'+fmt(an-tx)+'</td></tr></tbody></table></div>';
}


/* ============================================
   MAIN RENDER
   ============================================ */
function render() {
  var app = document.getElementById('app');
  if (STATE.view === 'setup') { app.innerHTML = renderSetup(); return; }
  if (STATE.view === 'loading') {
    app.innerHTML = '<div class="topbar"><h1><span>🏠</span> Rental Manager</h1></div><div class="loading"><div class="loading-spinner"></div><div class="loading-text">Loading your data...</div></div>';
    loadData(); return;
  }
  var ay = getAllYears(); if (ay.indexOf(STATE.year) < 0) STATE.year = ay[ay.length-1] || '2025';
  var yb = ''; ay.forEach(function(y) { yb += '<button class="year-btn '+(STATE.year===y?'active':'')+'" onclick="setYear(\''+y+'\')">'+y+'</button>'; });
  var nb = ''; [['dashboard','📊','Summary'],['tenants','👥','Tenants'],['tax','📋','Tax']].forEach(function(n) {
    var act = STATE.view===n[0] || (STATE.view==='profile' && n[0]==='tenants');
    nb += '<button class="'+(act?'active':'')+'" onclick="go(\''+n[0]+'\')">'+n[1]+' '+n[2]+'</button>';
  });
  var pc = ''; if (STATE.view==='dashboard') pc = renderDashboard(); else if (STATE.view==='tenants') pc = renderTenants(); else if (STATE.view==='profile') pc = renderProfile(); else if (STATE.view==='tax') pc = renderTax();
  app.innerHTML = '<div class="topbar" style="display:flex;justify-content:space-between;align-items:center"><div><h1><span>🏠</span> Rental Manager</h1><div class="topbar-sub">'+Object.keys(DATA).length+' Units · '+(ay[0]||'')+'–'+(ay[ay.length-1]||'')+'</div></div><button id="refresh-btn" onclick="refreshData()" style="padding:10px 18px;border-radius:12px;border:2px solid #d4c4b0;background:#fff;color:#5a3921;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap">🔄 Refresh</button></div><div class="nav">'+nb+'</div><div class="year-bar">'+yb+'</div><div class="content">'+pc+'</div>';
}


/* ============================================
   ACTIONS
   ============================================ */
function go(v) { STATE.view = v; STATE.unit = null; render(); }
function setYear(y) { STATE.year = y; render(); }
function openProfile(u) { STATE.unit = u; STATE.view = 'profile'; render(); }

async function connectSheet() {
  var input = document.getElementById('sheet-id-input'), errDiv = document.getElementById('setup-error');
  var id = input.value.trim();
  var match = id.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (match) id = match[1];
  id = id.replace(/\//g, '').trim();
  if (!id) { errDiv.innerHTML = '<div class="error-msg">Please paste your Google Sheet link or ID</div>'; return; }
  errDiv.innerHTML = ''; input.disabled = true;
  STATE.view = 'loading'; SHEET_ID = id; render();
  try { DATA = await fetchSheetData(id); localStorage.setItem(STORAGE_KEY, id); STATE.view = 'dashboard'; }
  catch (e) { SHEET_ID = ''; localStorage.removeItem(STORAGE_KEY); STATE.view = 'setup'; render();
    setTimeout(function() { var ed = document.getElementById('setup-error'); if (ed) ed.innerHTML = '<div class="error-msg">❌ '+e.message+'</div>';
      var inp = document.getElementById('sheet-id-input'); if (inp) inp.disabled = false; }, 50); return; }
  render();
}

async function loadData() {
  try { DATA = await fetchSheetData(SHEET_ID); if (Object.keys(DATA).length === 0) throw new Error('No data'); STATE.view = 'dashboard'; }
  catch (e) { SHEET_ID = ''; localStorage.removeItem(STORAGE_KEY); STATE.view = 'setup'; }
  render();
}

/** Refresh data from Google Sheets — call when you've updated payments */
async function refreshData() {
  var btn = document.getElementById('refresh-btn');
  if (btn) { btn.textContent = '⏳ Loading...'; btn.disabled = true; }
  try {
    DATA = await fetchSheetData(SHEET_ID);
    STATE.view = STATE.view || 'dashboard';
  } catch (e) {
    // Keep existing data if refresh fails
  }
  render();
}

render();
