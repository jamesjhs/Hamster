'use strict';
/* global Chart */

// ─── State ────────────────────────────────────────────────────────────────────
let wheelChart  = null;
let motionChart = null;

// ─── Initialise ───────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Default: last 30 days on the long-term log
  setPreset(30);

  // Populate the file selector with available CSV files
  try {
    const files = await fetch('/api/csv-files').then((r) => r.json());
    const sel   = document.getElementById('fileSelect');
    files.forEach((f) => {
      const opt      = document.createElement('option');
      opt.value      = f;
      opt.textContent = f === 'longtermlog.csv' ? 'Long-term log (all days)' : fmtFilename(f);
      sel.appendChild(opt);
    });
  } catch (e) {
    console.warn('Could not load CSV file list:', e);
  }

  // When a specific file is chosen, hide the date-range picker (it only applies
  // to the long-term log).
  document.getElementById('fileSelect').addEventListener('change', () => {
    const isSpecific = document.getElementById('fileSelect').value !== '';
    document.getElementById('dateRangePicker').style.display = isSpecific ? 'none' : 'flex';
  });

  loadData();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Format a YYYYMMDD.csv filename as DD/MM/YYYY. */
function fmtFilename(f) {
  const m = f.match(/^(\d{4})(\d{2})(\d{2})\.csv$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : f;
}

/**
 * Set the date-range picker to the last `days` days.
 * Pass 0 for "all time" (uses a far-past start date).
 */
function setPreset(days) {
  const to   = new Date();
  const from = new Date();
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
}

// Expose to window so onclick handlers work
window.setPreset = setPreset;

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

  try {
    const data = await fetch(url).then((r) => r.json());
    renderCharts(data);
    renderSummary(data);
    renderTable(data);
  } catch (e) {
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
  if (wheelChart) wheelChart.destroy();
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
  if (motionChart) motionChart.destroy();
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
    const w1        = (row[1] || 0).toFixed(2);
    const w2        = (row[2] || 0).toFixed(2);
    const wTot      = ((row[1] || 0) + (row[2] || 0)).toFixed(2);
    const m1        = (row[3] || 0).toFixed(1);
    const m2        = (row[4] || 0).toFixed(1);
    const m3        = (row[5] || 0).toFixed(1);
    const mTot      = ((row[3] || 0) + (row[4] || 0) + (row[5] || 0)).toFixed(1);

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
