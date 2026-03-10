'use strict';
/* global Chart */

// ─── State ────────────────────────────────────────────────────────────────────
let wheelChart  = null;
let motionChart = null;
let _heatmapMetric = 'distance';

// ─── Initialise ───────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Populate the file selector with available daily CSV files.
  // longtermlog.csv is already represented by the default option.
  try {
    const files = await fetch('/api/csv-files').then((r) => r.json());
    const sel   = document.getElementById('fileSelect');
    files.forEach((f) => {
      if (f === 'longtermlog.csv') return; // already covered by default option
      const opt      = document.createElement('option');
      opt.value      = f;
      opt.textContent = fmtFilename(f);
      sel.appendChild(opt);
    });
  } catch (e) {
    console.warn('Could not load CSV file list:', e);
  }

  // Auto-load data when a specific file is selected.
  document.getElementById('fileSelect').addEventListener('change', () => {
    const isSpecific = document.getElementById('fileSelect').value !== '';
    document.getElementById('dateRangePicker').style.display = isSpecific ? 'none' : 'flex';
    loadData();
  });

  // Default view: last 30 days on the long-term log. setPreset calls loadData().
  setPreset(30);
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Format a YYYYMMDD.csv filename as DD/MM/YYYY. */
function fmtFilename(f) {
  const m = f.match(/^(\d{4})(\d{2})(\d{2})\.csv$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : f;
}

/**
 * Set the date-range picker to the last `days` days and reload data.
 * Pass 0 for "all time" (uses a far-past start date).
 * Pass 1 for "today" — selects today's intraday CSV directly (today's data
 * is not in longtermlog.csv until midnight).
 */
function setPreset(days) {
  const to   = new Date();
  const from = new Date();

  // Special case: "today" → prefer the intraday CSV for today's date.
  if (days === 1) {
    const pad     = (n) => String(n).padStart(2, '0');
    const yyyy    = to.getFullYear();
    const mm      = pad(to.getMonth() + 1);
    const dd      = pad(to.getDate());
    const todayFile = `${yyyy}${mm}${dd}.csv`;
    const sel     = document.getElementById('fileSelect');
    // Add option dynamically if the file is not yet in the list
    if (!Array.from(sel.options).find((o) => o.value === todayFile)) {
      const opt       = document.createElement('option');
      opt.value       = todayFile;
      opt.textContent = fmtFilename(todayFile);
      sel.appendChild(opt);
    }
    sel.value = todayFile;
    document.getElementById('dateRangePicker').style.display = 'none';
    loadData();
    return;
  }

  if (days > 0) {
    from.setDate(from.getDate() - days + 1);
  } else {
    from.setFullYear(2000); // effectively "all time"
  }
  document.getElementById('fromDate').value = from.toISOString().slice(0, 10);
  document.getElementById('toDate').value   = to.toISOString().slice(0, 10);

  // Reset file selector to long-term log
  document.getElementById('fileSelect').value = '';
  document.getElementById('dateRangePicker').style.display = 'flex';

  loadData();
}

// Expose to window so onclick handlers work
window.setPreset = setPreset;

// ─── UI state helpers ─────────────────────────────────────────────────────────
function showLoading(visible) {
  document.getElementById('loadingState').classList.toggle('hidden', !visible);
}

function showError(message) {
  document.getElementById('errorMessage').textContent = message;
  document.getElementById('errorState').classList.remove('hidden');
}

function showNoData() {
  document.getElementById('noDataState').classList.remove('hidden');
}

function clearStates() {
  document.getElementById('loadingState').classList.add('hidden');
  document.getElementById('errorState').classList.add('hidden');
  document.getElementById('noDataState').classList.add('hidden');
  document.getElementById('summaryCards').classList.add('hidden');
  // Clear data table
  document.getElementById('dataTableBody').innerHTML = '';
  // Destroy existing charts so canvases are reused cleanly
  if (wheelChart)  { wheelChart.destroy();  wheelChart  = null; }
  if (motionChart) { motionChart.destroy(); motionChart = null; }
}

// ─── Data loading ─────────────────────────────────────────────────────────────
async function loadData() {
  const file     = document.getElementById('fileSelect').value;
  const fromDate = document.getElementById('fromDate').value;
  const toDate   = document.getElementById('toDate').value;

  let url = '/api/csv-data';
  if (file) {
    url += `?file=${encodeURIComponent(file)}`;
  } else {
    const params = new URLSearchParams();
    if (fromDate) params.set('from', fromDate);
    if (toDate)   params.set('to',   toDate);
    url += '?' + params.toString();
  }

  clearStates();
  showLoading(true);

  try {
    const response = await fetch(url);

    if (!response.ok) {
      showLoading(false);
      let msg = `Server error ${response.status}`;
      try { msg = (await response.json()).error || msg; } catch { /* ignore */ }
      showError(msg);
      return;
    }

    const data = await response.json();
    showLoading(false);

    if (!data.rows || data.rows.length === 0) {
      showNoData();
      return;
    }

    renderCharts(data);
    renderSummary(data);
    renderTable(data);
    loadHeatmap();
  } catch (e) {
    showLoading(false);
    showError('Network error — could not reach the server.');
    console.error('Failed to load CSV data:', e);
  }
}

window.loadData = loadData;

// ─── Chart rendering ──────────────────────────────────────────────────────────
function renderCharts({ rows, type }) {
  if (!rows || rows.length === 0) return;

  const isLongterm = type === 'longterm';

  // X-axis labels
  const labels = rows.map((r) => {
    const d = new Date(r[0] * 1000);
    return isLongterm
      ? d.toLocaleDateString('en-GB')
      : d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  });

  /**
   * Build a data series for a given column.
   *
   * Long-term log: each row IS the daily total → plot directly.
   * Intraday log:  values are cumulative → plot delta between consecutive readings
   *                so the chart shows activity per interval rather than a step curve.
   */
  function series(col) {
    if (isLongterm) return rows.map((r) => +(r[col] || 0).toFixed(3));
    return rows.map((r, i) => {
      if (i === 0) return 0;
      return +Math.max(0, (r[col] || 0) - (rows[i - 1][col] || 0)).toFixed(3);
    });
  }

  const commonOptions = {
    responsive: true,
    maintainAspectRatio: true,
    plugins: { legend: { position: 'bottom' } },
    elements: { point: { radius: rows.length > 100 ? 0 : 2 } },
    scales: { y: { beginAtZero: true } },
  };

  // Wheel distance chart
  wheelChart = new Chart(document.getElementById('wheelChart'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Wheel 1 (bottom)', data: series(1),
          borderColor: '#d9600e', backgroundColor: 'rgba(217,96,14,0.12)',
          fill: true, tension: 0.3,
        },
        {
          label: 'Wheel 2 (top)', data: series(2),
          borderColor: '#923717', backgroundColor: 'rgba(146,55,23,0.12)',
          fill: true, tension: 0.3,
        },
      ],
    },
    options: {
      ...commonOptions,
      scales: { y: { beginAtZero: true, title: { display: true, text: 'metres' } } },
    },
  });

  // Cage motion chart
  motionChart = new Chart(document.getElementById('motionChart'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Ground floor', data: series(3),
          borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.12)',
          fill: true, tension: 0.3,
        },
        {
          label: 'Middle floor', data: series(4),
          borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.12)',
          fill: true, tension: 0.3,
        },
        {
          label: 'Top floor', data: series(5),
          borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.12)',
          fill: true, tension: 0.3,
        },
      ],
    },
    options: {
      ...commonOptions,
      scales: { y: { beginAtZero: true, title: { display: true, text: 'seconds' } } },
    },
  });
}

// ─── Summary cards ────────────────────────────────────────────────────────────
function renderSummary({ rows, type }) {
  if (!rows || rows.length === 0) return;

  const isLongterm = type === 'longterm';

  /**
   * Compute the total for a column over the range.
   *
   * Long-term: sum all rows (each row is a daily total).
   * Intraday:  last value − first value (cumulative counters).
   */
  function total(col) {
    if (isLongterm) {
      return rows.reduce((acc, r) => acc + (r[col] || 0), 0);
    }
    return Math.max(0, (rows[rows.length - 1]?.[col] || 0) - (rows[0]?.[col] || 0));
  }

  const w1 = total(1), w2 = total(2);
  const m1 = total(3), m2 = total(4), m3 = total(5);

  document.getElementById('sumWheel1').textContent      = w1.toFixed(2) + ' m';
  document.getElementById('sumWheel2').textContent      = w2.toFixed(2) + ' m';
  document.getElementById('sumTotalDist').textContent   = (w1 + w2).toFixed(2) + ' m';
  document.getElementById('sumTotalMotion').textContent = (m1 + m2 + m3).toFixed(1) + ' s';

  document.getElementById('summaryCards').classList.remove('hidden');
}

// ─── Data table ───────────────────────────────────────────────────────────────
function renderTable({ rows, type }) {
  if (!rows || rows.length === 0) return;

  const isLongterm = type === 'longterm';
  const tbody      = document.getElementById('dataTableBody');
  tbody.innerHTML  = '';

  rows.forEach((row, i) => {
    const d       = new Date(row[0] * 1000);
    const timeStr = isLongterm
      ? d.toLocaleDateString('en-GB')
      : d.toLocaleTimeString('en-GB');

    const tr        = document.createElement('tr');
    tr.className    = i % 2 === 0 ? '' : 'bg-hamster-50';

    // CSV columns: 0=timestamp, 1=wheel1_m, 2=wheel2_m, 3=motion1_s, 4=motion2_s, 5=motion3_s
    let w1, w2, wTot, m1, m2, m3, mTot;
    if (isLongterm || i === 0) {
      w1   = (row[1] || 0).toFixed(2);
      w2   = (row[2] || 0).toFixed(2);
      wTot = ((row[1] || 0) + (row[2] || 0)).toFixed(2);
      m1   = (row[3] || 0).toFixed(1);
      m2   = (row[4] || 0).toFixed(1);
      m3   = (row[5] || 0).toFixed(1);
      mTot = ((row[3] || 0) + (row[4] || 0) + (row[5] || 0)).toFixed(1);
    } else {
      const prev = rows[i - 1];
      const dw1  = Math.max(0, (row[1] || 0) - (prev[1] || 0));
      const dw2  = Math.max(0, (row[2] || 0) - (prev[2] || 0));
      const dm1  = Math.max(0, (row[3] || 0) - (prev[3] || 0));
      const dm2  = Math.max(0, (row[4] || 0) - (prev[4] || 0));
      const dm3  = Math.max(0, (row[5] || 0) - (prev[5] || 0));
      w1   = dw1.toFixed(2);
      w2   = dw2.toFixed(2);
      wTot = (dw1 + dw2).toFixed(2);
      m1   = dm1.toFixed(1);
      m2   = dm2.toFixed(1);
      m3   = dm3.toFixed(1);
      mTot = (dm1 + dm2 + dm3).toFixed(1);
    }

    tr.innerHTML = `
      <td class="px-2 py-1">${timeStr}</td>
      <td class="px-2 py-1 text-right">${w1}</td>
      <td class="px-2 py-1 text-right">${w2}</td>
      <td class="px-2 py-1 text-right font-semibold">${wTot}</td>
      <td class="px-2 py-1 text-right">${m1}</td>
      <td class="px-2 py-1 text-right">${m2}</td>
      <td class="px-2 py-1 text-right">${m3}</td>
      <td class="px-2 py-1 text-right font-semibold">${mTot}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ─── Table toggle ─────────────────────────────────────────────────────────────
function toggleTable() {
  const container = document.getElementById('tableContainer');
  const icon      = document.getElementById('tableToggleIcon');
  const isHidden  = container.classList.toggle('hidden');
  icon.textContent = isHidden ? '▶' : '▼';
}

window.toggleTable = toggleTable;

// ─── Heatmap ──────────────────────────────────────────────────────────────────

/**
 * Map a normalised value [0..1] to a warm colour:
 *   0 → near-black (#120500)  →  1 → bright orange (#ef7c17)
 * A gamma curve (0.5) lifts low values so even sparse activity is visible.
 */
function _heatColor(val, maxVal) {
  if (maxVal === 0) return '#120500';
  const t = Math.pow(Math.min(val / maxVal, 1), 0.5);
  const r = Math.round(18  + t * (239 - 18));
  const g = Math.round(5   + t * (124 - 5));
  const b = Math.round(0   + t * (23  - 0));
  return `rgb(${r},${g},${b})`;
}

/** Render the colour-scale legend bar. */
function _drawLegend(maxVal) {
  const canvas = document.getElementById('heatmapLegend');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w   = canvas.width;
  const h   = canvas.height;
  for (let x = 0; x < w; x++) {
    ctx.fillStyle = _heatColor(x, w - 1);
    ctx.fillRect(x, 0, 1, h);
  }
}

/**
 * Draw the heatmap on #heatmapCanvas.
 * Layout: X-axis = dates, Y-axis = 30-min time slots (noon → midnight → noon).
 */
function renderHeatmap({ dates, slots, matrix, maxVal }) {
  const canvas    = document.getElementById('heatmapCanvas');
  const noDataEl  = document.getElementById('heatmapNoData');
  if (!canvas) return;

  if (!dates || dates.length === 0) {
    canvas.style.display = 'none';
    noDataEl.classList.remove('hidden');
    return;
  }
  noDataEl.classList.add('hidden');
  canvas.style.display = 'block';

  // Cell dimensions: auto-fit width; fixed height per slot
  const containerW = canvas.parentElement.clientWidth || 600;
  const MARGIN_L   = 42;   // space for time labels on left
  const MARGIN_T   = 34;   // space for date labels on top
  const MARGIN_B   = 4;
  const NUM_SLOTS  = slots.length;

  const CELL_W = Math.max(4, Math.floor((containerW - MARGIN_L) / dates.length));
  const CELL_H = 10;

  canvas.width  = MARGIN_L + dates.length * CELL_W;
  canvas.height = MARGIN_T + NUM_SLOTS * CELL_H + MARGIN_B;

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // ── Draw cells ──────────────────────────────────────────────────────────────
  for (let s = 0; s < NUM_SLOTS; s++) {
    for (let d = 0; d < dates.length; d++) {
      ctx.fillStyle = _heatColor(matrix[s][d], maxVal);
      ctx.fillRect(
        MARGIN_L + d * CELL_W,
        MARGIN_T + s * CELL_H,
        Math.max(1, CELL_W - 1),
        CELL_H - 1,
      );
    }
  }

  // ── Time labels (Y-axis, every 2 hours = 4 slots) ───────────────────────────
  ctx.fillStyle  = '#923717';
  ctx.font       = '9px sans-serif';
  ctx.textAlign  = 'right';
  ctx.textBaseline = 'middle';
  for (let s = 0; s < NUM_SLOTS; s += 4) {      // every 2 hours
    const label = slots[s];
    const y     = MARGIN_T + s * CELL_H + CELL_H / 2;
    ctx.fillText(label, MARGIN_L - 3, y);
  }

  // ── Midnight marker line ─────────────────────────────────────────────────────
  const midnightSlot = 24;   // slot 24 = 00:00
  const midY = MARGIN_T + midnightSlot * CELL_H;
  ctx.strokeStyle = 'rgba(239,124,23,0.6)';
  ctx.lineWidth   = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(MARGIN_L, midY);
  ctx.lineTo(canvas.width, midY);
  ctx.stroke();
  ctx.setLineDash([]);

  // ── Date labels (X-axis) ─────────────────────────────────────────────────────
  const step = Math.max(1, Math.ceil(dates.length / Math.floor((canvas.width - MARGIN_L) / 30)));
  ctx.fillStyle    = '#923717';
  ctx.font         = '9px sans-serif';
  ctx.textAlign    = 'right';
  ctx.textBaseline = 'alphabetic';
  for (let d = 0; d < dates.length; d += step) {
    const x     = MARGIN_L + d * CELL_W + CELL_W / 2;
    const label = dates[d].slice(5);   // MM-DD
    ctx.save();
    ctx.translate(x, MARGIN_T - 4);
    ctx.rotate(-Math.PI / 4);
    ctx.fillText(label, 0, 0);
    ctx.restore();
  }

  _drawLegend(maxVal);
}

/** Fetch heatmap data from the API using the current date range. */
async function loadHeatmap() {
  const file     = document.getElementById('fileSelect').value;
  const fromDate = document.getElementById('fromDate').value;
  const toDate   = document.getElementById('toDate').value;

  const params = new URLSearchParams({ metric: _heatmapMetric });

  if (file && file !== '') {
    // For an intraday file, derive the date from the filename (YYYYMMDD.csv)
    const m = file.match(/^(\d{4})(\d{2})(\d{2})\.csv$/);
    if (m) {
      const dateStr = `${m[1]}-${m[2]}-${m[3]}`;
      params.set('from', dateStr);
      params.set('to',   dateStr);
    } else {
      // longtermlog selected – no date filter
    }
  } else {
    if (fromDate) params.set('from', fromDate);
    if (toDate)   params.set('to',   toDate);
  }

  try {
    const data = await fetch(`/api/heatmap?${params}`).then((r) => r.json());
    renderHeatmap(data);
  } catch (e) {
    console.warn('Heatmap load failed:', e);
  }
}

/** Switch the heatmap metric and reload. */
function setHeatmapMetric(metric) {
  _heatmapMetric = metric;
  // Update button styles
  const btnDist = document.getElementById('heatmapBtnDistance');
  const btnAct  = document.getElementById('heatmapBtnActivity');
  if (btnDist && btnAct) {
    const activeClass   = ['bg-hamster-700', 'hover:bg-hamster-800', 'text-white'];
    const inactiveClass = ['bg-hamster-100', 'hover:bg-hamster-200', 'text-hamster-700'];
    if (metric === 'distance') {
      activeClass.forEach((c) => btnDist.classList.add(c));
      inactiveClass.forEach((c) => btnDist.classList.remove(c));
      inactiveClass.forEach((c) => btnAct.classList.add(c));
      activeClass.forEach((c) => btnAct.classList.remove(c));
    } else {
      activeClass.forEach((c) => btnAct.classList.add(c));
      inactiveClass.forEach((c) => btnAct.classList.remove(c));
      inactiveClass.forEach((c) => btnDist.classList.add(c));
      activeClass.forEach((c) => btnDist.classList.remove(c));
    }
  }
  loadHeatmap();
}

window.setHeatmapMetric = setHeatmapMetric;
