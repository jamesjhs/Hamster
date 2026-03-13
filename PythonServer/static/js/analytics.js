'use strict';
/* global Chart */

// ─── State ────────────────────────────────────────────────────────────────────
let wheelChart      = null;
let motionChart     = null;
let dowChart        = null;
let wheelRatioChart = null;
let floorRatioChart = null;
let hourlyChart     = null;
let _heatmapMetric  = 'distance';

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
  document.getElementById('deepStatsPanel').classList.add('hidden');
  // Clear data table
  document.getElementById('dataTableBody').innerHTML = '';
  // Destroy existing charts so canvases are reused cleanly
  if (wheelChart)      { wheelChart.destroy();      wheelChart      = null; }
  if (motionChart)     { motionChart.destroy();     motionChart     = null; }
  if (dowChart)        { dowChart.destroy();        dowChart        = null; }
  if (wheelRatioChart) { wheelRatioChart.destroy(); wheelRatioChart = null; }
  if (floorRatioChart) { floorRatioChart.destroy(); floorRatioChart = null; }
  if (hourlyChart)     { hourlyChart.destroy();     hourlyChart     = null; }
}

// ─── Data loading ─────────────────────────────────────────────────────────────
async function loadData() {
  const file     = document.getElementById('fileSelect').value;
  const fromDate = document.getElementById('fromDate').value;
  const toDate   = document.getElementById('toDate').value;

  let dataUrl  = '/api/csv-data';
  let statsUrl = '/api/stats';

  if (file) {
    dataUrl  += `?file=${encodeURIComponent(file)}`;
    statsUrl += `?file=${encodeURIComponent(file)}`;
  } else {
    const params = new URLSearchParams();
    if (fromDate) params.set('from', fromDate);
    if (toDate)   params.set('to',   toDate);
    const qs = params.toString();
    dataUrl  += qs ? '?' + qs : '';
    statsUrl += qs ? '?' + qs : '';
  }

  clearStates();
  showLoading(true);

  try {
    // Fetch CSV data and statistics in parallel
    const [dataResp, statsResp] = await Promise.all([
      fetch(dataUrl),
      fetch(statsUrl).catch(() => null),
    ]);

    if (!dataResp.ok) {
      showLoading(false);
      let msg = `Server error ${dataResp.status}`;
      try { msg = (await dataResp.json()).error || msg; } catch { /* ignore */ }
      showError(msg);
      return;
    }

    const data  = await dataResp.json();
    const stats = statsResp && statsResp.ok ? await statsResp.json() : null;

    showLoading(false);

    if (!data.rows || data.rows.length === 0) {
      showNoData();
      return;
    }

    renderCharts(data, stats);
    renderSummary(data);
    renderTable(data);
    if (stats && stats.n > 0) renderStats(stats);
    loadHeatmap();
  } catch (e) {
    showLoading(false);
    showError('Network error — could not reach the server.');
    console.error('Failed to load CSV data:', e);
  }
}

window.loadData = loadData;

// ─── Chart rendering ──────────────────────────────────────────────────────────
function renderCharts({ rows, type }, stats) {
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

  // Rolling average overlays (longterm only, from stats)
  const rollingDatasets = [];
  if (isLongterm && stats && stats.rolling) {
    const roll7  = stats.rolling.dist7  || [];
    const roll30 = stats.rolling.dist30 || [];
    if (roll7.length === rows.length) {
      rollingDatasets.push({
        label: '7-day rolling avg',
        data: roll7,
        borderColor: '#7c3aed',
        borderWidth: 2,
        borderDash: [5, 3],
        fill: false,
        tension: 0.4,
        pointRadius: 0,
        order: 0,
      });
    }
    if (roll30.length === rows.length && rows.length >= 30) {
      rollingDatasets.push({
        label: '30-day rolling avg',
        data: roll30,
        borderColor: '#0891b2',
        borderWidth: 2,
        borderDash: [8, 4],
        fill: false,
        tension: 0.4,
        pointRadius: 0,
        order: 0,
      });
    }
  }

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
        ...rollingDatasets,
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

// ─── Deep Statistics Panel ────────────────────────────────────────────────────

/** Render a named value into an element by id. */
function _setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

/**
 * Render the full deep statistics panel from the /api/stats response.
 * Handles both 'longterm' and 'intraday' stat shapes.
 */
function renderStats(stats) {
  if (!stats || stats.n === 0) return;

  const panel = document.getElementById('deepStatsPanel');
  panel.classList.remove('hidden');

  if (stats.type === 'longterm') {
    _renderLongtermStats(stats);
  } else {
    _renderIntradayStats(stats);
  }
}

function _renderLongtermStats(stats) {
  const ds = stats.distanceStats || {};
  const tr = stats.trend         || {};
  const rl = stats.rolling       || {};

  // Row 1: Descriptive
  _setText('statMedian', ds.median != null ? ds.median.toFixed(1) + ' m' : '—');
  _setText('statMean',   ds.mean   != null ? ds.mean.toFixed(1)   + ' m' : '—');
  _setText('statCV',     ds.cv     != null ? (ds.cv * 100).toFixed(1) + '%' : '—');
  _setText('statStd',    ds.std    != null ? ds.std.toFixed(1)    + ' m' : '—');

  // Trend: slope in m/day with direction emoji
  if (tr.distSlope != null) {
    const slope = tr.distSlope;
    const arrow = slope > 0.5 ? '↑' : slope < -0.5 ? '↓' : '→';
    _setText('statTrend', `${arrow} ${Math.abs(slope).toFixed(2)} m/d`);
    _setText('statR2',    tr.distR2 != null ? tr.distR2.toFixed(3) : '—');
  }

  // Rolling averages (latest value)
  const roll7  = rl.dist7  || [];
  const roll30 = rl.dist30 || [];
  _setText('statRoll7',  roll7.length  ? roll7[roll7.length - 1].toFixed(1)   + ' m' : '—');
  _setText('statRoll30', roll30.length ? roll30[roll30.length - 1].toFixed(1) + ' m' : '—');

  // Row 2: Records & streaks
  if (stats.bestDay) {
    _setText('statBestDay',  stats.bestDay.date);
    _setText('statBestDist', stats.bestDay.dist.toFixed(1) + ' m');
  }
  if (stats.worstDay) {
    _setText('statWorstDay',  stats.worstDay.date);
    _setText('statWorstDist', stats.worstDay.dist.toFixed(1) + ' m');
  }
  _setText('statMaxStreak',  stats.maxStreak     != null ? stats.maxStreak + 'd'  : '—');
  _setText('statActiveDays', stats.activeDays    != null ? `${stats.activeDays} / ${stats.n}` : '—');
  _setText('statCurStreak',  stats.currentStreak != null ? stats.currentStreak    : '—');

  // Row 3a: Day-of-week bar chart
  if (stats.dowLabels && stats.dowAvgDist) {
    dowChart = new Chart(document.getElementById('dowChart'), {
      type: 'bar',
      data: {
        labels: stats.dowLabels,
        datasets: [{
          label: 'Avg distance (m)',
          data: stats.dowAvgDist,
          backgroundColor: stats.dowAvgDist.map((_, i) =>
            i >= 5 ? 'rgba(217,96,14,0.85)' : 'rgba(217,96,14,0.55)'
          ),
          borderColor: '#923717',
          borderWidth: 1,
          borderRadius: 4,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, title: { display: true, text: 'm' } } },
      },
    });
  }

  // Row 3b: Wheel preference doughnut
  if (stats.wheelRatio) {
    const wr = stats.wheelRatio;
    wheelRatioChart = new Chart(document.getElementById('wheelRatioChart'), {
      type: 'doughnut',
      data: {
        labels: [
          `Wheel 1 (bottom) ${wr.wheel1Pct}%`,
          `Wheel 2 (top) ${wr.wheel2Pct}%`,
        ],
        datasets: [{
          data: [wr.wheel1, wr.wheel2],
          backgroundColor: ['rgba(217,96,14,0.8)', 'rgba(146,55,23,0.8)'],
          borderColor:     ['#d9600e',              '#923717'],
          borderWidth: 1,
        }],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'bottom', labels: { font: { size: 11 } } },
        },
      },
    });
  }

  // Row 3c: Floor distribution doughnut
  if (stats.floorRatio) {
    const fr = stats.floorRatio;
    floorRatioChart = new Chart(document.getElementById('floorRatioChart'), {
      type: 'doughnut',
      data: {
        labels: [
          `Ground ${fr.groundPct}%`,
          `Middle ${fr.middlePct}%`,
          `Top ${fr.topPct}%`,
        ],
        datasets: [{
          data: [fr.ground, fr.middle, fr.top],
          backgroundColor: [
            'rgba(239,68,68,0.8)',
            'rgba(34,197,94,0.8)',
            'rgba(59,130,246,0.8)',
          ],
          borderColor: ['#ef4444', '#22c55e', '#3b82f6'],
          borderWidth: 1,
        }],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'bottom', labels: { font: { size: 11 } } },
        },
      },
    });
  }

  // Row 4: Percentile IQR display
  if (ds.min != null) {
    _setText('statMin', ds.min.toFixed(1) + ' m');
    _setText('statP25', ds.p25.toFixed(1) + ' m');
    _setText('statP50', ds.median.toFixed(1) + ' m');
    _setText('statP75', ds.p75.toFixed(1) + ' m');
    _setText('statP95', ds.p95.toFixed(1) + ' m');
    _setText('statMax', ds.max.toFixed(1) + ' m');
    _drawBoxPlot(ds);
  }

  // Row 5: Milestones
  _renderMilestones(stats);

  // Hide intraday hourly panel
  const hp = document.getElementById('hourlyPanel');
  if (hp) hp.classList.add('hidden');
}

function _renderIntradayStats(stats) {
  // For intraday data, show the hourly chart only
  const hp = document.getElementById('hourlyPanel');
  if (!hp) return;
  hp.classList.remove('hidden');

  const hours  = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`);
  const hourly = stats.hourlyDist || new Array(24).fill(0);

  hourlyChart = new Chart(document.getElementById('hourlyChart'), {
    type: 'bar',
    data: {
      labels: hours,
      datasets: [{
        label: 'Wheel distance (m)',
        data: hourly,
        backgroundColor: 'rgba(217,96,14,0.7)',
        borderColor: '#923717',
        borderWidth: 1,
        borderRadius: 3,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, title: { display: true, text: 'm' } } },
    },
  });

  // Also show simple stat cards with what we have
  const ds = stats.distanceStats || {};
  if (ds.mean != null) {
    _setText('statMedian', ds.median.toFixed(3) + ' m');
    _setText('statMean',   ds.mean.toFixed(3)   + ' m');
    _setText('statCV',     (ds.cv * 100).toFixed(1) + '%');
    _setText('statStd',    ds.std.toFixed(3)    + ' m');
    // Show peak hour info in trend card
    if (stats.peakDistHour != null) {
      _setText('statTrend', `${String(stats.peakDistHour).padStart(2,'0')}:00`);
      _setText('statR2', 'peak hour');
    }
  }
}

/**
 * Draw a horizontal box-and-whisker plot on the #boxPlotCanvas element.
 * Shows: min, P25, median, P75, P95, max.
 */
function _drawBoxPlot(ds) {
  const canvas = document.getElementById('boxPlotCanvas');
  if (!canvas) return;
  const ctx  = canvas.getContext('2d');
  const W    = canvas.parentElement.clientWidth || 600;
  const H    = 52;
  canvas.width  = W;
  canvas.height = H;
  ctx.clearRect(0, 0, W, H);

  const PAD  = 40;   // left/right padding for labels
  const span = ds.max - ds.min;
  if (span <= 0) return;

  function xOf(v) {
    return PAD + ((v - ds.min) / span) * (W - PAD * 2);
  }

  const MID_Y  = H * 0.5;
  const BOX_H  = H * 0.42;

  // Whisker line: min → max
  ctx.strokeStyle = '#923717';
  ctx.lineWidth   = 1.5;
  ctx.beginPath();
  ctx.moveTo(xOf(ds.min), MID_Y);
  ctx.lineTo(xOf(ds.max), MID_Y);
  ctx.stroke();

  // IQR box: P25 → P75
  ctx.fillStyle   = 'rgba(217,96,14,0.25)';
  ctx.strokeStyle = '#d9600e';
  ctx.lineWidth   = 1.5;
  const bx = xOf(ds.p25);
  const bw = xOf(ds.p75) - bx;
  ctx.fillRect(bx, MID_Y - BOX_H / 2, bw, BOX_H);
  ctx.strokeRect(bx, MID_Y - BOX_H / 2, bw, BOX_H);

  // Median line
  ctx.strokeStyle = '#923717';
  ctx.lineWidth   = 2.5;
  ctx.beginPath();
  ctx.moveTo(xOf(ds.median), MID_Y - BOX_H / 2);
  ctx.lineTo(xOf(ds.median), MID_Y + BOX_H / 2);
  ctx.stroke();

  // P95 marker (diamond)
  ctx.fillStyle = '#7c3aed';
  const px = xOf(ds.p95);
  const ps = 5;
  ctx.beginPath();
  ctx.moveTo(px,      MID_Y - ps);
  ctx.lineTo(px + ps, MID_Y);
  ctx.lineTo(px,      MID_Y + ps);
  ctx.lineTo(px - ps, MID_Y);
  ctx.closePath();
  ctx.fill();

  // Tick marks: min / max
  [ds.min, ds.max].forEach((v) => {
    ctx.strokeStyle = '#923717';
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.moveTo(xOf(v), MID_Y - BOX_H / 2);
    ctx.lineTo(xOf(v), MID_Y + BOX_H / 2);
    ctx.stroke();
  });

  // Labels beneath
  ctx.fillStyle  = '#78350f';
  ctx.font       = '9px sans-serif';
  ctx.textAlign  = 'center';
  ctx.textBaseline = 'top';
  const labelY = MID_Y + BOX_H / 2 + 3;
  [
    [ds.min,    'min'],
    [ds.p25,    'P25'],
    [ds.median, 'P50'],
    [ds.p75,    'P75'],
    [ds.p95,    'P95'],
    [ds.max,    'max'],
  ].forEach(([v, lbl]) => {
    ctx.fillText(lbl, xOf(v), labelY);
  });
}

/**
 * Render milestone progress bars using the all-time total from the
 * longtermlog stats (bestDay dist gives upper bound for context).
 */
function _renderMilestones(stats) {
  const container = document.getElementById('milestones');
  if (!container) return;

  // Fetch the all-time total from longtermlog to show true cumulative distance
  fetch('/api/csv-data')
    .then((r) => r.json())
    .then((d) => {
      let totalM = 0;
      if (d.rows && d.rows.length) {
        // Each row of longtermlog IS a daily total: sum col1+col2
        d.rows.forEach((r) => { totalM += (r[1] || 0) + (r[2] || 0); });
      }

      const milestones = [
        { label: 'Park Run (5 km)',       dist: 5_000 },
        { label: '10k Race',              dist: 10_000 },
        { label: 'Half Marathon',         dist: 21_097 },
        { label: 'Full Marathon',         dist: 42_195 },
        { label: 'Channel Tunnel (50 km)', dist: 50_450 },
        { label: '100 km Ultra',          dist: 100_000 },
        { label: 'London to Birmingham',  dist: 162_000 },
        { label: 'UK End-to-End (1407 km)', dist: 1_407_000 },
      ];

      container.innerHTML = '';
      milestones.forEach(({ label, dist }) => {
        const pct     = Math.min(100, (totalM / dist) * 100);
        const reached = totalM >= dist;
        const kmLabel = totalM >= 1000
          ? `${(totalM / 1000).toFixed(2)} km`
          : `${totalM.toFixed(0)} m`;

        const row = document.createElement('div');
        row.innerHTML = `
          <div class="flex justify-between mb-0.5">
            <span class="text-hamster-700 font-semibold">${reached ? '✅ ' : ''}${label}</span>
            <span class="text-hamster-500">${kmLabel} / ${(dist / 1000).toFixed(1)} km &nbsp; ${pct.toFixed(1)}%</span>
          </div>
          <div class="w-full bg-hamster-100 rounded-full h-2">
            <div class="bg-hamster-600 h-2 rounded-full transition-all" style="width:${pct}%"></div>
          </div>
        `;
        container.appendChild(row);
      });
    })
    .catch(() => {
      container.innerHTML = '<p class="text-hamster-400 italic">Could not load all-time total.</p>';
    });
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

