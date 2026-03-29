'use strict';

const https   = require('https');
const http    = require('http');
const fs      = require('fs');
const path    = require('path');
const express = require('express');

const app = express();
app.use(express.json());

// ─── Configuration ────────────────────────────────────────────────────────────
const PORT     = parseInt(process.env.PORT     || '4000', 10);
const ESP32_IP = process.env.ESP32_IP || '192.168.1.98';
// CSV files are written by datalogger.py in the Apache web-root on the Pi.
// Override with CSV_DIR env var if your setup differs.
const CSV_DIR  = process.env.CSV_DIR  || '/var/www/html/hamsterlogger';
// SSL certs live alongside this file in /var/node/cert (set CERT_DIR to override).
const CERT_DIR = process.env.CERT_DIR || __dirname;

// Wheel diameters (cm).  Must match the physical wheels installed in the cage.
// The ESP32 firmware uses a hard-coded 13.5 cm reference diameter; the server
// applies corrections when the actual diameters differ.
const ESP32_BASE_DIAM_CM = 13.5;
const WHEEL1_DIAMETER_CM = parseFloat(process.env.WHEEL1_DIAMETER_CM || '30');
const WHEEL2_DIAMETER_CM = parseFloat(process.env.WHEEL2_DIAMETER_CM || '14');
const SERVICE_NAME       = process.env.SERVICE_NAME || 'hamster';
const SERVICE_VERSION    = process.env.SERVICE_VERSION || require('./package.json').version || '1.0.0';

// Date of cage upgrade (YYYY-MM-DD); analytics labels differ before/after.
const CAGE_UPGRADE_DATE = process.env.CAGE_UPGRADE_DATE || '2026-03-15';

// Hamster birthday
const BIRTH_DATE = new Date('2025-09-07');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Escape special HTML characters. */
function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Make a plain HTTP GET request and return the trimmed response body.
 * Resolves to '0' on any error so callers can always parseFloat safely.
 */
function httpGet(url, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve(body.trim()));
    });
    req.on('error', () => resolve('0'));
    req.on('timeout', () => { req.destroy(); resolve('0'); });
  });
}

// ─── ESP32 Data (cached) ──────────────────────────────────────────────────────
const CACHE_TTL_MS = 30_000;
let esp32Cache   = null;
let esp32CacheAt = 0;

/** Fetch all ESP32 endpoints in parallel and return the processed data object.
 *  Does NOT interact with the cache – callers decide whether to store the result. */
async function _fetchESP32Data() {
  const base      = `http://${ESP32_IP}/d`;
  const endpoints = [
    'avespeed', 'maxspeed', 'distance1', 'distance2',
    'wheelNumberLast', 'millisnow',
    'motion1count', 'motion2count', 'motion3count',
    'motionLevelLast', 'lastwheelmillis', 'lastmotionmillis',
  ];

  // Fetch all endpoints in parallel; fall back to 0 on any error
  const results = await Promise.all(endpoints.map((ep) => httpGet(`${base}/${ep}`)));
  const raw = {};
  endpoints.forEach((ep, i) => {
    const v = parseFloat(results[i]);
    raw[ep] = isNaN(v) ? 0 : v;
  });

  // If millisnow > 0 the ESP32 responded with real uptime data.
  raw.esp32Online = raw.millisnow > 0;

  // Derive timestamps:
  // lastwheelmillis / lastmotionmillis are the elapsed ms since the last event
  // (the ESP32 endpoint subtracts the stored millis from millis()).
  const nowMs = Date.now();
  raw.lastWheelTs    = nowMs - raw.lastwheelmillis;
  raw.lastMotionTs   = nowMs - raw.lastmotionmillis;
  raw.lastActiveTs   = Math.max(raw.lastWheelTs, raw.lastMotionTs);
  raw.lastActiveMinsAgo = Math.max(0, Math.floor((nowMs - raw.lastActiveTs) / 60_000));

  // Human-readable last location.
  // lastwheelmillis and lastmotionmillis are milliseconds since the last event;
  // a smaller value means more recent.
  if (!raw.esp32Online) {
    raw.lastLocation = 'offline';
  } else if (raw.lastwheelmillis === 0 && raw.lastmotionmillis === 0) {
    raw.lastLocation = 'unknown';
  } else if (raw.lastmotionmillis < raw.lastwheelmillis) {
    // Motion event was more recent than wheel event
    const levels = { 1: 'ground level', 2: 'middle level', 3: 'top level' };
    raw.lastLocation = levels[Math.round(raw.motionLevelLast)] || 'unknown level';
  } else {
    // Wheel event was more recent (or tied)
    raw.lastLocation = `wheel ${Math.round(raw.wheelNumberLast) === 1 ? '1 (bottom)' : '2 (top)'}`;
  }

  // Age calculation
  const diffSec       = (nowMs - BIRTH_DATE.getTime()) / 1000;
  const secsPerYear   = 365.25 * 24 * 3600;
  raw.humanYears      = diffSec / secsPerYear;
  const h             = raw.humanYears;
  raw.hamsterYears    = -1.3415 * h ** 4 + 15.678 * h ** 3 - 54.837 * h ** 2 + 92.659 * h + 2.3173;

  return raw;
}

async function getESP32Data() {
  if (esp32Cache && (Date.now() - esp32CacheAt) < CACHE_TTL_MS) {
    return esp32Cache;
  }

  const raw = await _fetchESP32Data();
  esp32Cache   = raw;
  esp32CacheAt = Date.now();
  return raw;
}

// ─── CSV utilities ────────────────────────────────────────────────────────────

/** Parse a CSV file into an array of number arrays; skips bad lines. */
function readCSV(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return content
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split(',').map(Number))
      .filter((row) => row.length >= 6 && !isNaN(row[0]) && row[0] > 0);
  } catch {
    return [];
  }
}

/** Return list of daily CSV files in CSV_DIR, newest first (longtermlog.csv excluded). */
function listCSVFiles() {
  try {
    return fs
      .readdirSync(CSV_DIR)
      .filter((f) => f.endsWith('.csv') && f !== 'longtermlog.csv')
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

/**
 * Summarise the longtermlog.csv (each row is a daily total since the ESP32
 * resets at midnight).
 */
function getLongtermSummary() {
  const rows = readCSV(path.join(CSV_DIR, 'longtermlog.csv'));
  let totalWheel1 = 0, totalWheel2 = 0,
      totalMotion1 = 0, totalMotion2 = 0, totalMotion3 = 0;
  for (const row of rows) {
    totalWheel1  += row[1] || 0;
    totalWheel2  += row[2] || 0;
    totalMotion1 += row[3] || 0;
    totalMotion2 += row[4] || 0;
    totalMotion3 += row[5] || 0;
  }
  return { totalWheel1, totalWheel2, totalMotion1, totalMotion2, totalMotion3 };
}

/**
 * Compute per-metric daily totals from intraday CSV rows, correctly handling
 * mid-day dips caused by a Pi or ESP32 reboot.
 *
 * Each row stores the cumulative total reported by the ESP32 (with any
 * in-memory offset applied at log time).  A combined Pi+ESP32 reboot mid-day
 * creates a dip: values fall then restart from a lower value.  Simply using
 * last–first returns near-zero (or zero) in that situation.
 *
 * This function instead sums the positive increment between every pair of
 * consecutive rows, and, when a drop is detected, also adds the post-drop
 * value in full (since the ESP32 restarted from zero and had already
 * accumulated that amount by the time of the first new poll after the restart).
 *
 * Returns [wheel1, wheel2, motion1, motion2, motion3].
 */
function sumDailyCSV(rows) {
  if (rows.length < 2) return [0, 0, 0, 0, 0];
  const totals = [0, 0, 0, 0, 0];
  let prev = rows[0];
  for (let r = 1; r < rows.length; r++) {
    const curr = rows[r];
    for (let i = 0; i < 5; i++) {
      const delta = (curr[i + 1] || 0) - (prev[i + 1] || 0);
      if (delta > 0) {
        totals[i] += delta;
      } else if (delta < 0) {
        // Drop detected: ESP32 (or Pi) restarted.  The current value is the
        // total accumulated since that restart; count it in full.
        totals[i] += Math.max(0, curr[i + 1] || 0);
      }
    }
    prev = curr;
  }
  return totals;
}

// ─── Gallery helper ───────────────────────────────────────────────────────────
function loadImages() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'images.json'), 'utf8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

// ─── Static files ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ─── Routes ───────────────────────────────────────────────────────────────────

// Main landing page
app.get('/', async (_req, res) => {
  const [esp32, ltSummary, images] = await Promise.all([
    getESP32Data().catch(() => ({})),
    Promise.resolve(getLongtermSummary()),
    Promise.resolve(loadImages()),
  ]);

  const todayDist    = (esp32.distance1 || 0) + (esp32.distance2 || 0);
  const totalDist    = ltSummary.totalWheel1 + ltSummary.totalWheel2 + todayDist;
  const todayDistKm  = (todayDist  / 1000).toFixed(2);
  const totalDistKm  = (totalDist  / 1000).toFixed(2);
  const todayDistMi  = (todayDist  * 0.000621371).toFixed(2);
  const totalDistMi  = (totalDist  * 0.000621371).toFixed(2);
  const lastActiveTime = new Date(esp32.lastActiveTs || Date.now())
    .toLocaleTimeString('en-GB');
  const todayMotion = (
    (esp32.motion1count || 0) + (esp32.motion2count || 0) + (esp32.motion3count || 0)
  ).toFixed(1);

  res.send(renderIndex({
    esp32, ltSummary, images,
    todayDistKm, totalDistKm, todayDistMi, totalDistMi,
    lastActiveTime, todayMotion,
  }));
});

// Analytics page
app.get('/analytics', (_req, res) => {
  res.send(renderAnalytics());
});

// Live status page (real-time RPM, speed, sensor state)
app.get('/live-status', (_req, res) => {
  res.send(renderLiveStatus());
});

// Kindle-friendly page (no JS)
app.get('/kindle', async (_req, res) => {
  const [esp32, ltSummary] = await Promise.all([
    getESP32Data().catch(() => ({})),
    Promise.resolve(getLongtermSummary()),
  ]);

  // Read today's intraday CSV for persistent distance/motion totals.
  // sumDailyCSV() correctly handles mid-day dips caused by a combined
  // Pi+ESP32 reboot, where a simple last–first subtraction (or using raw
  // ESP32 values) would give zero or an under-count.
  const todayStr  = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/London' }).replace(/-/g, '');
  const todayRows = readCSV(path.join(CSV_DIR, `${todayStr}.csv`));
  let todayWheel1, todayWheel2, todayMotion1, todayMotion2, todayMotion3;
  if (todayRows.length >= 2) {
    [todayWheel1, todayWheel2, todayMotion1, todayMotion2, todayMotion3] = sumDailyCSV(todayRows);
  } else {
    // Before the first CSV poll of the day, fall back to live ESP32 values.
    todayWheel1  = esp32.distance1    || 0;
    todayWheel2  = esp32.distance2    || 0;
    todayMotion1 = esp32.motion1count || 0;
    todayMotion2 = esp32.motion2count || 0;
    todayMotion3 = esp32.motion3count || 0;
  }

  res.send(renderKindle({ esp32, ltSummary, todayWheel1, todayWheel2, todayMotion1, todayMotion2, todayMotion3 }));
});

// API – live ESP32 data
app.get('/api/live', async (_req, res) => {
  try {
    res.json(await getESP32Data());
  } catch {
    res.status(503).json({ error: 'ESP32 unavailable' });
  }
});

// API – fresh (non-cached) live ESP32 data for the live-status page
app.get('/api/live-now', async (_req, res) => {
  try {
    // Fetch directly from the ESP32 without reading or writing the shared cache
    // so concurrent requests to /api/live are unaffected.
    res.json(await _fetchESP32Data());
  } catch {
    res.status(503).json({ error: 'ESP32 unavailable' });
  }
});

// API – list CSV files
app.get('/api/csv-files', (_req, res) => {
  res.json(listCSVFiles());
});

// API – CSV data with optional date-range filtering
app.get('/api/csv-data', (req, res) => {
  const { file, from, to } = req.query;

  // Validate file param to prevent path traversal
  if (file && !/^[\w-]+\.csv$/.test(file)) {
    return res.status(400).json({ error: 'Invalid file name' });
  }

  if (file) {
    const rows       = readCSV(path.join(CSV_DIR, file));
    const isLongterm = file === 'longtermlog.csv';
    return res.json({ type: isLongterm ? 'longterm' : 'intraday', rows, file });
  }

  // Long-term log with optional date-range filter
  let rows = readCSV(path.join(CSV_DIR, 'longtermlog.csv'));
  if (from || to) {
    const fromTs = from ? (new Date(from).getTime() / 1000)          : 0;
    const toTs   = to   ? (new Date(to).getTime()   / 1000 + 86400)  : Infinity;
    rows = rows.filter((r) => r[0] >= fromTs && r[0] <= toTs);
  }
  return res.json({ type: 'longterm', rows });
});

// API – gallery images
app.get('/api/images', (_req, res) => {
  res.json(loadImages());
});

// API – heatmap data (activity or distance per 30-minute slot per day)
app.get('/api/heatmap', (req, res) => {
  const { from, to, metric = 'distance' } = req.query;

  if (metric !== 'distance' && metric !== 'activity') {
    return res.status(400).json({ error: 'metric must be "distance" or "activity"' });
  }

  const today     = new Date();
  today.setHours(0, 0, 0, 0);
  const fromDate  = from ? new Date(from) : (() => { const d = new Date(today); d.setDate(d.getDate() - 29); return d; })();
  const toDate    = to   ? new Date(to)   : new Date(today);
  fromDate.setHours(0, 0, 0, 0);
  toDate.setHours(0, 0, 0, 0);

  if (isNaN(fromDate) || isNaN(toDate)) {
    return res.status(400).json({ error: 'Invalid date format – use YYYY-MM-DD' });
  }
  if (fromDate > toDate) {
    return res.status(400).json({ error: 'from date must be ≤ to date' });
  }

  // Build list of all dates in range
  const dates = [];
  const d = new Date(fromDate);
  while (d <= toDate) {
    dates.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }

  // 48 half-hour slots centred around midnight:
  //   slot 0  = 12:00  slot 23 = 23:30
  //   slot 24 = 00:00  slot 47 = 11:30
  const NUM_SLOTS = 48;
  const matrix = Array.from({ length: NUM_SLOTS }, () => new Array(dates.length).fill(0));

  const pad = (n) => String(n).padStart(2, '0');

  for (let dateIdx = 0; dateIdx < dates.length; dateIdx++) {
    const dt    = dates[dateIdx];
    const fname = `${dt.getFullYear()}${pad(dt.getMonth() + 1)}${pad(dt.getDate())}.csv`;
    const rows  = readCSV(path.join(CSV_DIR, fname));

    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1];
      const curr = rows[i];
      const ts   = curr[0];
      const t    = new Date(ts * 1000);
      const minsFromMidnight = t.getHours() * 60 + t.getMinutes();
      // Rotate so noon (720 min from midnight) maps to slot 0
      const minsFromNoon = ((minsFromMidnight - 720) + 1440) % 1440;
      const slot = Math.floor(minsFromNoon / 30);

      let val;
      if (metric === 'distance') {
        val = Math.max(0, (curr[1] || 0) - (prev[1] || 0))
            + Math.max(0, (curr[2] || 0) - (prev[2] || 0));
      } else {
        val = Math.max(0, (curr[3] || 0) - (prev[3] || 0))
            + Math.max(0, (curr[4] || 0) - (prev[4] || 0))
            + Math.max(0, (curr[5] || 0) - (prev[5] || 0));
      }
      matrix[slot][dateIdx] += val;
    }
  }

  // Slot labels: derive clock time for each slot
  const slots = Array.from({ length: NUM_SLOTS }, (_, i) => {
    const minsFromMidnight = (i * 30 + 720) % 1440;
    const h = Math.floor(minsFromMidnight / 60);
    const m = minsFromMidnight % 60;
    return `${pad(h)}:${pad(m)}`;
  });

  const maxVal = Math.max(0, ...matrix.flat());

  return res.json({
    dates:  dates.map((dt) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`),
    slots,
    matrix,
    maxVal,
    metric,
  });
});



// API – system status (useful for debugging CSV path issues)
app.get('/api/status', (_req, res) => {
  const longtermPath = path.join(CSV_DIR, 'longtermlog.csv');
  const longtermExists = fs.existsSync(longtermPath);
  const longtermRows   = longtermExists ? readCSV(longtermPath).length : 0;
  const dailyFiles     = listCSVFiles();
  res.json({
    csvDir: CSV_DIR,
    longtermlogExists: longtermExists,
    longtermlogRows: longtermRows,
    dailyFileCount: dailyFiles.length,
    dailyFiles,
    esp32Ip: ESP32_IP,
    cacheAgeMs: esp32Cache ? Date.now() - esp32CacheAt : null,
    esp32Cached: esp32Cache !== null,
  });
});

// API – readiness heartbeat for uptime checks
app.get('/readyz', (_req, res) => {
  res.json({
    ok: true,
    service: SERVICE_NAME,
    version: SERVICE_VERSION,
    timestamp: new Date().toISOString(),
  });
});

// API – wheel-size and cage configuration
app.get('/api/config', (_req, res) => {
  res.json({
    wheel1DiameterCm:    WHEEL1_DIAMETER_CM,
    wheel2DiameterCm:    WHEEL2_DIAMETER_CM,
    wheel1CircumfM:      parseFloat((Math.PI * WHEEL1_DIAMETER_CM / 100).toFixed(6)),
    wheel2CircumfM:      parseFloat((Math.PI * WHEEL2_DIAMETER_CM / 100).toFixed(6)),
    esp32BaseDiameterCm: ESP32_BASE_DIAM_CM,
    upgradeDate:         CAGE_UPGRADE_DATE,
  });
});

// ─── Page renderers ───────────────────────────────────────────────────────────

/** Shared HTML layout – uses locally-built Tailwind CSS (public/css/styles.css). */
function layout(title, bodyContent) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)}</title>
  <link rel="stylesheet" href="/css/styles.css">
  <style>
    .gallery-img { transition: transform 0.2s; }
    .gallery-img:hover { transform: scale(1.04); }
  </style>
</head>
<body class="bg-hamster-50 text-hamster-900 min-h-screen flex flex-col">
  <nav class="bg-hamster-800 text-white shadow-lg" style="position:relative">
    <div class="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
      <a href="/" class="flex items-center gap-2 text-xl font-bold hover:text-hamster-200 transition-colors">
        <span>🐹</span><span>Chocolate's Monitor</span>
      </a>
      <!-- Desktop navigation links (hidden on small screens) -->
      <div id="navLinks" class="flex gap-6 text-sm font-medium" style="display:none">
        <a href="/"            class="hover:text-hamster-200 transition-colors">Home</a>
        <a href="/analytics"   class="hover:text-hamster-200 transition-colors">Analytics</a>
        <a href="/live-status" class="hover:text-hamster-200 transition-colors">Live</a>
        <a href="/kindle"      class="hover:text-hamster-200 transition-colors">Kindle</a>
      </div>
      <!-- Hamburger button (hidden on large screens) -->
      <button id="navToggle" aria-label="Toggle menu"
              style="background:none;border:none;cursor:pointer;padding:6px;border-radius:6px;color:inherit"
              onmouseenter="this.style.backgroundColor='rgba(255,255,255,0.1)'"
              onmouseleave="this.style.backgroundColor='transparent'">
        <svg id="navIconHam" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
          <line x1="3" y1="6"  x2="21" y2="6"/>
          <line x1="3" y1="12" x2="21" y2="12"/>
          <line x1="3" y1="18" x2="21" y2="18"/>
        </svg>
        <svg id="navIconX" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" style="display:none">
          <line x1="18" y1="6"  x2="6"  y2="18"/>
          <line x1="6"  y1="6"  x2="18" y2="18"/>
        </svg>
      </button>
    </div>
    <!-- Mobile dropdown menu -->
    <div id="mobileMenu" style="display:none;background:#782f16;border-top:1px solid rgba(255,255,255,0.15)">
      <div class="max-w-6xl mx-auto px-4 py-2" style="display:flex;flex-direction:column;gap:2px">
        <a href="/"            style="display:block;padding:10px 8px;border-radius:6px;font-size:.875rem;font-weight:500;color:inherit;text-decoration:none" onmouseenter="this.style.backgroundColor='rgba(255,255,255,0.1)'" onmouseleave="this.style.backgroundColor='transparent'">Home</a>
        <a href="/analytics"   style="display:block;padding:10px 8px;border-radius:6px;font-size:.875rem;font-weight:500;color:inherit;text-decoration:none" onmouseenter="this.style.backgroundColor='rgba(255,255,255,0.1)'" onmouseleave="this.style.backgroundColor='transparent'">Analytics</a>
        <a href="/live-status" style="display:block;padding:10px 8px;border-radius:6px;font-size:.875rem;font-weight:500;color:inherit;text-decoration:none" onmouseenter="this.style.backgroundColor='rgba(255,255,255,0.1)'" onmouseleave="this.style.backgroundColor='transparent'">Live</a>
        <a href="/kindle"      style="display:block;padding:10px 8px;border-radius:6px;font-size:.875rem;font-weight:500;color:inherit;text-decoration:none" onmouseenter="this.style.backgroundColor='rgba(255,255,255,0.1)'" onmouseleave="this.style.backgroundColor='transparent'">Kindle</a>
      </div>
    </div>
  </nav>
  <script>
    (function () {
      var toggle   = document.getElementById('navToggle');
      var menu     = document.getElementById('mobileMenu');
      var navLinks = document.getElementById('navLinks');
      var iconHam  = document.getElementById('navIconHam');
      var iconX    = document.getElementById('navIconX');

      function applyLayout() {
        if (window.innerWidth >= 768) {
          navLinks.style.display = 'flex';
          toggle.style.display   = 'none';
          menu.style.display     = 'none';
        } else {
          navLinks.style.display = 'none';
          toggle.style.display   = 'block';
        }
      }

      toggle.addEventListener('click', function () {
        var open = menu.style.display === 'none' || menu.style.display === '';
        menu.style.display    = open ? 'block' : 'none';
        iconHam.style.display = open ? 'none'  : 'block';
        iconX.style.display   = open ? 'block' : 'none';
      });

      applyLayout();
      window.addEventListener('resize', applyLayout);
    })();
  </script>
  <main class="max-w-6xl mx-auto px-4 py-8 flex-1 w-full">
    ${bodyContent}
  </main>
  <footer class="bg-hamster-800 text-hamster-200 text-center text-xs py-3 mt-auto">
    Chocolate &bull; Russian Dwarf Hamster &bull; hamster.jahosi.co.uk
  </footer>
</body>
</html>`;
}

function statCard(icon, label, value, sub) {
  return `<div class="bg-white rounded-xl shadow-sm border border-hamster-100 p-5 flex items-start gap-4">
      <div class="text-4xl leading-none">${icon}</div>
      <div>
        <p class="text-xs text-hamster-500 uppercase tracking-wide font-semibold">${esc(label)}</p>
        <p class="text-2xl font-bold text-hamster-800 leading-tight">${value}</p>
        ${sub ? `<p class="text-xs text-hamster-400 mt-0.5">${esc(sub)}</p>` : ''}
      </div>
    </div>`;
}

function renderIndex({
  esp32, ltSummary, images,
  todayDistKm, totalDistKm, todayDistMi, totalDistMi,
  lastActiveTime, todayMotion,
}) {
  const hasHistory = (ltSummary.totalWheel1 + ltSummary.totalWheel2) > 0;
  const offlineBadge = esp32.esp32Online === false
    ? `<span class="inline-block bg-red-100 text-red-700 text-xs font-semibold px-2 py-0.5 rounded ml-2">ESP32 offline</span>`
    : '';

  const galleryHtml = images.length
    ? `<div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
        ${images.map((img) => `
          <div class="bg-white rounded-xl overflow-hidden shadow-sm border border-hamster-100 cursor-pointer"
               onclick="openLightbox('${esc(img.filename)}','${esc(img.description || '')}')">
            <div class="aspect-square overflow-hidden bg-hamster-100">
              <img src="/images/${esc(img.thumb || img.filename)}"
                   alt="${esc(img.description || 'Chocolate')}"
                   class="gallery-img w-full h-full object-cover" loading="lazy">
            </div>
            <div class="p-2">
              <p class="text-xs text-hamster-700 leading-snug line-clamp-2">${esc(img.description || '')}</p>
              ${img.date ? `<p class="text-xs text-hamster-400 mt-0.5">${esc(img.date)}</p>` : ''}
            </div>
          </div>`).join('')}
      </div>`
    : `<p class="text-hamster-400 italic text-sm">No images yet — add entries to <code class="bg-hamster-100 px-1 rounded">images.json</code> to populate the gallery.</p>`;

  return layout("Chocolate's Monitor", `
    <h1 class="text-3xl font-bold text-hamster-800 mb-1">🐹 Chocolate's Live Monitor${offlineBadge}</h1>
    <p class="text-hamster-500 text-sm mb-6">
      Age: <strong>${(esp32.humanYears || 0).toFixed(2)} human years</strong>
      &nbsp;(${(esp32.hamsterYears || 0).toFixed(1)} hamster years)
    </p>

    <!-- Stat cards -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
      ${statCard('🏃', "Today's Distance", `${todayDistMi} mi`, `${todayDistKm} km`)}
      ${statCard('🌍', 'All-time Distance', `${totalDistMi} mi`,
        hasHistory ? `${totalDistKm} km` : `${totalDistKm} km — no historical data yet`)}
      ${statCard('👀', 'Last Seen', lastActiveTime, `on ${esc(esp32.lastLocation || '—')} · ${esp32.lastActiveMinsAgo || '?'} min ago`)}
      ${statCard('⏱️', 'Active Today', `${todayMotion} s`, 'total motion sensor time')}
    </div>

    <!-- Today's breakdown -->
    <div class="bg-white rounded-xl shadow-sm border border-hamster-100 p-5 mb-8">
      <h2 class="text-lg font-bold text-hamster-800 mb-4">Today's Activity</h2>
      <div class="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4 text-sm">
        <div>
          <p class="text-hamster-500 font-semibold text-xs uppercase tracking-wide">Wheel 1 (bottom)</p>
          <p class="text-xl font-bold">${(esp32.distance1 || 0).toFixed(2)} m</p>
        </div>
        <div>
          <p class="text-hamster-500 font-semibold text-xs uppercase tracking-wide">Wheel 2 (top)</p>
          <p class="text-xl font-bold">${(esp32.distance2 || 0).toFixed(2)} m</p>
        </div>
        <div>
          <p class="text-hamster-500 font-semibold text-xs uppercase tracking-wide">Max Speed</p>
          <p class="text-xl font-bold">${(esp32.maxspeed || 0).toFixed(2)} m/s</p>
        </div>
        <div>
          <p class="text-hamster-500 font-semibold text-xs uppercase tracking-wide">Ground Floor</p>
          <p class="text-xl font-bold">${(esp32.motion1count || 0).toFixed(1)} s</p>
        </div>
        <div>
          <p class="text-hamster-500 font-semibold text-xs uppercase tracking-wide">Middle Floor</p>
          <p class="text-xl font-bold">${(esp32.motion2count || 0).toFixed(1)} s</p>
        </div>
        <div>
          <p class="text-hamster-500 font-semibold text-xs uppercase tracking-wide">Top Floor</p>
          <p class="text-xl font-bold">${(esp32.motion3count || 0).toFixed(1)} s</p>
        </div>
      </div>
      <p class="text-xs text-hamster-400 mt-5">
        Data cached for 30 s. &nbsp;
        <a href="javascript:location.reload()" class="underline hover:text-hamster-600">Refresh now</a>
        &nbsp;·&nbsp;
        <a href="/analytics" class="underline hover:text-hamster-600">View full analytics →</a>
      </p>
    </div>

    <!-- Photo Gallery -->
    <div class="mb-6">
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-lg font-bold text-hamster-800">📸 Photo Gallery</h2>
        <span class="text-xs text-hamster-400">${images.length} photo${images.length !== 1 ? 's' : ''}</span>
      </div>
      ${galleryHtml}
    </div>

    <!-- Lightbox -->
    <div id="lightbox"
         class="fixed inset-0 bg-black/80 z-50 items-center justify-center"
         style="display:none" onclick="closeLightbox()">
      <div class="max-w-3xl w-full mx-4" onclick="event.stopPropagation()">
        <div class="bg-white rounded-xl overflow-hidden shadow-2xl">
          <img id="lbImg" src="" alt="" class="w-full object-contain max-h-[70vh]">
          <div class="p-4 flex items-start justify-between gap-4">
            <p id="lbCaption" class="text-hamster-700 text-sm flex-1"></p>
            <button onclick="closeLightbox()"
                    class="text-xs text-hamster-400 underline hover:text-hamster-700 shrink-0">Close ✕</button>
          </div>
        </div>
      </div>
    </div>
    <script>
      function openLightbox(filename, desc) {
        document.getElementById('lbImg').src = '/images/' + filename;
        document.getElementById('lbCaption').textContent = desc;
        document.getElementById('lightbox').style.display = 'flex';
      }
      function closeLightbox() {
        document.getElementById('lightbox').style.display = 'none';
      }
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLightbox(); });
    </script>
  `);
}

function renderAnalytics() {
  return layout("Chocolate's Monitor – Analytics", `
    <h1 class="text-3xl font-bold text-hamster-800 mb-6">📊 Analytics</h1>

    <!-- Controls panel -->
    <div class="bg-white rounded-xl shadow-sm border border-hamster-100 p-5 mb-6">
      <div class="flex flex-wrap gap-4 items-end">

        <div>
          <label class="text-xs text-hamster-500 font-semibold block mb-1">Data source</label>
          <select id="fileSelect"
                  class="border border-hamster-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-hamster-400 bg-white">
            <option value="">Long-term log (use date range below)</option>
          </select>
        </div>

        <div id="dateRangePicker" class="flex flex-wrap gap-3 items-end">
          <div>
            <label class="text-xs text-hamster-500 font-semibold block mb-1">From</label>
            <input type="date" id="fromDate"
                   class="border border-hamster-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-hamster-400">
          </div>
          <div>
            <label class="text-xs text-hamster-500 font-semibold block mb-1">To</label>
            <input type="date" id="toDate"
                   class="border border-hamster-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-hamster-400">
          </div>
        </div>

        <div class="flex flex-wrap gap-2">
          <button onclick="setPreset(1)"
                  class="bg-hamster-100 hover:bg-hamster-200 text-hamster-700 text-xs px-3 py-2 rounded-lg font-semibold transition-colors">Today</button>
          <button onclick="setPreset(7)"
                  class="bg-hamster-100 hover:bg-hamster-200 text-hamster-700 text-xs px-3 py-2 rounded-lg font-semibold transition-colors">Last 7d</button>
          <button onclick="setPreset(30)"
                  class="bg-hamster-100 hover:bg-hamster-200 text-hamster-700 text-xs px-3 py-2 rounded-lg font-semibold transition-colors">Last 30d</button>
          <button onclick="setPreset(0)"
                  class="bg-hamster-100 hover:bg-hamster-200 text-hamster-700 text-xs px-3 py-2 rounded-lg font-semibold transition-colors">All time</button>
          <button onclick="loadData()"
                  class="bg-hamster-700 hover:bg-hamster-800 text-white text-xs px-4 py-2 rounded-lg font-semibold transition-colors">Apply ↵</button>
        </div>
      </div>
    </div>

    <!-- Loading indicator (hidden by default) -->
    <div id="loadingState" class="hidden text-center py-8 text-hamster-500">
      <p class="text-sm font-semibold animate-pulse">Loading data…</p>
    </div>

    <!-- Error state (hidden by default) -->
    <div id="errorState" class="hidden text-center py-12">
      <p class="text-5xl mb-4">⚠️</p>
      <p class="text-lg font-bold text-red-600">Failed to load data</p>
      <p id="errorMessage" class="text-sm text-red-500 mt-2"></p>
      <p class="text-xs text-hamster-400 mt-3">Check the server logs and that CSV files exist in CSV_DIR.
        <a href="/api/status" target="_blank" class="underline hover:text-hamster-600">View /api/status →</a>
      </p>
    </div>

    <!-- No-data state (hidden by default) -->
    <div id="noDataState" class="hidden text-center py-12">
      <p class="text-5xl mb-4">📊</p>
      <p class="text-lg font-bold text-hamster-700">No data found for this selection</p>
      <p class="text-sm text-hamster-400 mt-2">Try a different date range, or check that the data logger is running.</p>
      <p class="text-xs text-hamster-400 mt-1">
        <a href="/api/status" target="_blank" class="underline hover:text-hamster-600">View /api/status →</a>
      </p>
    </div>

    <!-- Summary cards (hidden until data loads) -->
    <div id="summaryCards" class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6 hidden">
      <div class="bg-white rounded-xl shadow-sm border border-hamster-100 p-4 text-center">
        <p class="text-xs text-hamster-500 uppercase font-semibold">Total Distance</p>
        <p class="text-2xl font-bold text-hamster-800" id="sumTotalDist">—</p>
      </div>
      <div class="bg-white rounded-xl shadow-sm border border-hamster-100 p-4 text-center">
        <p class="text-xs text-hamster-500 uppercase font-semibold">Wheel 1 (bottom)</p>
        <p class="text-2xl font-bold text-hamster-800" id="sumWheel1">—</p>
      </div>
      <div class="bg-white rounded-xl shadow-sm border border-hamster-100 p-4 text-center">
        <p class="text-xs text-hamster-500 uppercase font-semibold">Wheel 2 (top)</p>
        <p class="text-2xl font-bold text-hamster-800" id="sumWheel2">—</p>
      </div>
      <div class="bg-white rounded-xl shadow-sm border border-hamster-100 p-4 text-center">
        <p class="text-xs text-hamster-500 uppercase font-semibold">Total Active Time</p>
        <p class="text-2xl font-bold text-hamster-800" id="sumTotalMotion">—</p>
      </div>
    </div>

    <!-- Charts -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
      <div class="bg-white rounded-xl shadow-sm border border-hamster-100 p-5">
        <h3 class="font-bold text-hamster-700 mb-3 text-sm uppercase tracking-wide">Wheel Distance (m)</h3>
        <canvas id="wheelChart"></canvas>
      </div>
      <div class="bg-white rounded-xl shadow-sm border border-hamster-100 p-5">
        <h3 class="font-bold text-hamster-700 mb-3 text-sm uppercase tracking-wide">Cage Activity by Level (s)</h3>
        <canvas id="motionChart"></canvas>
      </div>
    </div>

    <!-- Activity Heatmap -->
    <div class="bg-white rounded-xl shadow-sm border border-hamster-100 p-5 mb-6">
      <div class="flex flex-wrap items-center gap-4 mb-3">
        <h3 class="font-bold text-hamster-700 text-sm uppercase tracking-wide flex-1">Activity Heatmap</h3>
        <div class="flex gap-2">
          <button id="heatmapBtnDistance" onclick="setHeatmapMetric('distance')"
                  class="bg-hamster-700 hover:bg-hamster-800 text-white text-xs px-3 py-1.5 rounded-lg font-semibold transition-colors">Distance (m)</button>
          <button id="heatmapBtnActivity" onclick="setHeatmapMetric('activity')"
                  class="bg-hamster-100 hover:bg-hamster-200 text-hamster-700 text-xs px-3 py-1.5 rounded-lg font-semibold transition-colors">Activity (s)</button>
        </div>
      </div>
      <p class="text-xs text-hamster-400 mb-3">
        Horizontal axis: date &nbsp;·&nbsp; Vertical axis: time of day (centred around midnight)
        &nbsp;·&nbsp; Brighter cell = more active
      </p>
      <div id="heatmapContainer" class="overflow-x-auto">
        <canvas id="heatmapCanvas" style="display:block;max-width:100%"></canvas>
      </div>
      <div id="heatmapNoData" class="hidden text-center py-6 text-hamster-400 text-sm italic">
        No heatmap data available for the current date range.
      </div>
      <!-- Colour legend -->
      <div class="flex items-center gap-2 mt-3">
        <span class="text-xs text-hamster-500">Less</span>
        <canvas id="heatmapLegend" width="120" height="12" style="border-radius:3px"></canvas>
        <span class="text-xs text-hamster-500">More</span>
      </div>
    </div>

    <!-- Collapsible data table -->
    <div class="bg-white rounded-xl shadow-sm border border-hamster-100 p-5">
      <button onclick="toggleTable()"
              class="flex items-center gap-2 font-bold text-hamster-700 hover:text-hamster-900 transition-colors w-full text-left">
        <span id="tableToggleIcon" class="w-4 inline-block">▶</span>
        <span>Data Table</span>
      </button>
      <div id="tableContainer" class="hidden mt-4 overflow-x-auto">
        <table class="w-full text-xs border-collapse">
          <thead>
            <tr class="bg-hamster-100 text-hamster-700 text-left">
              <th class="px-2 py-1.5">Date / Time</th>
              <th class="px-2 py-1.5 text-right">Wheel 1 (m)</th>
              <th class="px-2 py-1.5 text-right">Wheel 2 (m)</th>
              <th class="px-2 py-1.5 text-right">Total Dist (m)</th>
              <th class="px-2 py-1.5 text-right">Ground (s)</th>
              <th class="px-2 py-1.5 text-right">Middle (s)</th>
              <th class="px-2 py-1.5 text-right">Top (s)</th>
              <th class="px-2 py-1.5 text-right">Total Active (s)</th>
            </tr>
          </thead>
          <tbody id="dataTableBody"></tbody>
        </table>
      </div>
    </div>

    <!-- Dependencies (locally bundled, no CDN) -->
    <script src="/js/chart.umd.min.js"></script>
    <script src="/js/analytics.js"></script>
  `);
}

function renderLiveStatus() {
  return layout("Live Status – Chocolate's Monitor", `
    <!-- Page header -->
    <div class="flex items-center justify-between mb-6 flex-wrap gap-3">
      <div>
        <h1 class="text-3xl font-bold text-hamster-800">📡 Live Status</h1>
        <p class="text-hamster-500 text-sm mt-1">Real-time wheel speed, RPM, and sensor state</p>
      </div>
      <div class="flex items-center gap-3">
        <span id="statusDot" class="inline-block w-3 h-3 rounded-full bg-hamster-300"></span>
        <span id="statusText" class="text-xs text-hamster-500 font-medium">Connecting…</span>
        <button onclick="fetchNow()" class="bg-hamster-700 hover:bg-hamster-800 text-white text-xs px-3 py-1.5 rounded-lg font-semibold transition-colors">
          Refresh ↺
        </button>
      </div>
    </div>

    <!-- Wheel cards -->
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">

      <!-- Wheel 1 (Big Wheel) -->
      <div class="bg-white rounded-xl shadow-sm border border-hamster-100 p-5">
        <div class="flex items-center justify-between mb-4">
          <div>
            <p class="text-xs text-hamster-500 uppercase tracking-wide font-semibold">Wheel 1</p>
            <p class="text-hamster-800 font-bold text-lg leading-tight">Big Wheel</p>
          </div>
          <span id="w1-badge" class="text-xs font-bold px-2.5 py-1 rounded-full bg-hamster-100 text-hamster-400">
            —
          </span>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <p class="text-xs text-hamster-400 uppercase tracking-wide font-semibold mb-0.5">Speed</p>
            <p id="w1-speed" class="text-2xl font-bold text-hamster-800">—</p>
            <p id="w1-speed-kmh" class="text-xs text-hamster-400 mt-0.5">—</p>
          </div>
          <div>
            <p class="text-xs text-hamster-400 uppercase tracking-wide font-semibold mb-0.5">RPM</p>
            <p id="w1-rpm" class="text-2xl font-bold text-hamster-800">—</p>
          </div>
          <div class="col-span-2">
            <p class="text-xs text-hamster-400 uppercase tracking-wide font-semibold mb-0.5">Today's Distance</p>
            <p id="w1-dist" class="text-xl font-bold text-hamster-700">—</p>
          </div>
        </div>
      </div>

      <!-- Wheel 2 (Small Wheel) -->
      <div class="bg-white rounded-xl shadow-sm border border-hamster-100 p-5">
        <div class="flex items-center justify-between mb-4">
          <div>
            <p class="text-xs text-hamster-500 uppercase tracking-wide font-semibold">Wheel 2</p>
            <p class="text-hamster-800 font-bold text-lg leading-tight">Small Wheel</p>
          </div>
          <span id="w2-badge" class="text-xs font-bold px-2.5 py-1 rounded-full bg-hamster-100 text-hamster-400">
            —
          </span>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <p class="text-xs text-hamster-400 uppercase tracking-wide font-semibold mb-0.5">Speed</p>
            <p id="w2-speed" class="text-2xl font-bold text-hamster-800">—</p>
            <p id="w2-speed-kmh" class="text-xs text-hamster-400 mt-0.5">—</p>
          </div>
          <div>
            <p class="text-xs text-hamster-400 uppercase tracking-wide font-semibold mb-0.5">RPM</p>
            <p id="w2-rpm" class="text-2xl font-bold text-hamster-800">—</p>
          </div>
          <div class="col-span-2">
            <p class="text-xs text-hamster-400 uppercase tracking-wide font-semibold mb-0.5">Today's Distance</p>
            <p id="w2-dist" class="text-xl font-bold text-hamster-700">—</p>
          </div>
        </div>
      </div>

    </div>

    <!-- Sensor state + Session stats -->
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">

      <!-- Sensor state -->
      <div class="bg-white rounded-xl shadow-sm border border-hamster-100 p-5">
        <h2 class="text-sm font-bold text-hamster-800 uppercase tracking-wide mb-4">📍 Sensor State</h2>
        <div class="space-y-3 text-sm">
          <div class="flex justify-between items-center">
            <span class="text-hamster-500 font-medium">Location</span>
            <span id="sensor-location" class="font-bold text-hamster-800 capitalize">—</span>
          </div>
          <div class="flex justify-between items-center">
            <span class="text-hamster-500 font-medium">Motion Level</span>
            <span id="sensor-motion-level" class="font-bold text-hamster-800">—</span>
          </div>
          <div class="flex justify-between items-center">
            <span class="text-hamster-500 font-medium">Wheel Last Used</span>
            <span id="sensor-wheel-last" class="font-bold text-hamster-800">—</span>
          </div>
          <hr class="border-hamster-100">
          <div class="flex justify-between items-center">
            <span class="text-hamster-500 font-medium">Last Active</span>
            <span id="sensor-last-active" class="font-bold text-hamster-800">—</span>
          </div>
          <div class="flex justify-between items-center">
            <span class="text-hamster-500 font-medium">ESP32</span>
            <span id="sensor-esp32" class="font-bold">—</span>
          </div>
        </div>
      </div>

      <!-- Session stats -->
      <div class="bg-white rounded-xl shadow-sm border border-hamster-100 p-5">
        <h2 class="text-sm font-bold text-hamster-800 uppercase tracking-wide mb-4">📊 Session Stats</h2>
        <div class="space-y-3 text-sm">
          <div class="flex justify-between items-center">
            <span class="text-hamster-500 font-medium">Avg Speed</span>
            <div class="text-right">
              <span id="stats-avespeed" class="font-bold text-hamster-800">—</span>
              <span id="stats-avespeed-kmh" class="text-xs text-hamster-400 ml-1">—</span>
            </div>
          </div>
          <div class="flex justify-between items-center">
            <span class="text-hamster-500 font-medium">Max Speed</span>
            <div class="text-right">
              <span id="stats-maxspeed" class="font-bold text-hamster-800">—</span>
              <span id="stats-maxspeed-kmh" class="text-xs text-hamster-400 ml-1">—</span>
            </div>
          </div>
          <hr class="border-hamster-100">
          <div class="flex justify-between items-center">
            <span class="text-hamster-500 font-medium">Under Cover</span>
            <span id="stats-motion1" class="font-bold text-hamster-800">—</span>
          </div>
          <div class="flex justify-between items-center">
            <span class="text-hamster-500 font-medium">Open-space</span>
            <span id="stats-motion2" class="font-bold text-hamster-800">—</span>
          </div>
          <div class="flex justify-between items-center">
            <span class="text-hamster-500 font-medium">Mezzanine</span>
            <span id="stats-motion3" class="font-bold text-hamster-800">—</span>
          </div>
        </div>
      </div>

    </div>

    <p class="text-xs text-hamster-400 text-center">
      Updates every 5 seconds by querying the ESP32 directly.
    </p>

    <script>
    (function () {
      const WHEEL1_DIAM_CM = 30;
      const WHEEL2_DIAM_CM = 14;
      const TIME_PAUSE_MS  = 10000;

      let w1Diam = WHEEL1_DIAM_CM;
      let w2Diam = WHEEL2_DIAM_CM;

      function fmt1(n)   { return Number(n).toFixed(1); }
      function fmt2(n)   { return Number(n).toFixed(2); }
      function fmtMs(s)  {
        const mins = Math.floor(s / 60);
        const secs = Math.round(s % 60);
        return mins > 0 ? mins + 'm ' + secs + 's' : secs + 's';
      }

      function calcRPM(lwm) {
        if (lwm <= 0 || lwm >= TIME_PAUSE_MS) return 0;
        return 60000 / lwm;
      }

      function calcSpeed(lwm, diamCm) {
        if (lwm <= 0 || lwm >= TIME_PAUSE_MS) return 0;
        return (Math.PI * diamCm / 100) / (lwm / 1000);
      }

      function setBadge(id, active) {
        var el = document.getElementById(id);
        if (active) {
          el.textContent = 'RUNNING';
          el.className = 'text-xs font-bold px-2.5 py-1 rounded-full bg-green-100 text-green-700';
        } else {
          el.textContent = 'IDLE';
          el.className = 'text-xs font-bold px-2.5 py-1 rounded-full bg-hamster-100 text-hamster-400';
        }
      }

      function setText(id, val) { document.getElementById(id).textContent = val; }

      function render(d) {
        var lwm        = d.lastwheelmillis || 0;
        var wheelLast  = Math.round(d.wheelNumberLast || 1);
        var wheelActive = lwm > 0 && lwm < TIME_PAUSE_MS;
        var w1Active   = wheelActive && wheelLast === 1;
        var w2Active   = wheelActive && wheelLast === 2;

        var w1Speed = w1Active ? calcSpeed(lwm, w1Diam) : 0;
        var w1RPM   = w1Active ? calcRPM(lwm) : 0;
        setBadge('w1-badge', w1Active);
        setText('w1-speed',     w1Active ? fmt2(w1Speed) + ' m/s' : '0.00 m/s');
        setText('w1-speed-kmh', w1Active ? fmt2(w1Speed * 3.6) + ' km/h' : '—');
        setText('w1-rpm',       w1Active ? fmt1(w1RPM) + ' rpm' : '0 rpm');
        setText('w1-dist',      fmt2(d.distance1 || 0) + ' m');

        var w2Speed = w2Active ? calcSpeed(lwm, w2Diam) : 0;
        var w2RPM   = w2Active ? calcRPM(lwm) : 0;
        setBadge('w2-badge', w2Active);
        setText('w2-speed',     w2Active ? fmt2(w2Speed) + ' m/s' : '0.00 m/s');
        setText('w2-speed-kmh', w2Active ? fmt2(w2Speed * 3.6) + ' km/h' : '—');
        setText('w2-rpm',       w2Active ? fmt1(w2RPM) + ' rpm' : '0 rpm');
        setText('w2-dist',      fmt2(d.distance2 || 0) + ' m');

        var motionLevels = { 1: 'Level 1 – under cover', 2: 'Level 2 – open-space', 3: 'Level 3 – mezzanine' };
        var motionLevel  = Math.round(d.motionLevelLast || 0);
        setText('sensor-location',     d.lastLocation || '—');
        setText('sensor-motion-level', motionLevel > 0 ? (motionLevels[motionLevel] || 'Level ' + motionLevel) : '—');
        setText('sensor-wheel-last',   wheelLast === 1 ? 'Wheel 1 (big)' : (wheelLast === 2 ? 'Wheel 2 (small)' : '—'));

        var minsAgo = d.lastActiveMinsAgo;
        setText('sensor-last-active', minsAgo === 0 ? 'just now' : minsAgo + ' min ago');

        var esp32El = document.getElementById('sensor-esp32');
        if (d.esp32Online) {
          esp32El.textContent = 'Online ✓';
          esp32El.className = 'font-bold text-green-600';
        } else {
          esp32El.textContent = 'Offline ✗';
          esp32El.className = 'font-bold text-red-600';
        }

        var aveMs = d.avespeed || 0;
        var maxMs = d.maxspeed || 0;
        setText('stats-avespeed',     fmt2(aveMs) + ' m/s');
        setText('stats-avespeed-kmh', '(' + fmt2(aveMs * 3.6) + ' km/h)');
        setText('stats-maxspeed',     fmt2(maxMs) + ' m/s');
        setText('stats-maxspeed-kmh', '(' + fmt2(maxMs * 3.6) + ' km/h)');
        setText('stats-motion1', fmtMs(d.motion1count || 0));
        setText('stats-motion2', fmtMs(d.motion2count || 0));
        setText('stats-motion3', fmtMs(d.motion3count || 0));

        var dot  = document.getElementById('statusDot');
        var text = document.getElementById('statusText');
        if (d.esp32Online) {
          dot.className  = 'inline-block w-3 h-3 rounded-full bg-green-500';
          text.textContent = 'Live · ' + new Date().toLocaleTimeString();
        } else {
          dot.className  = 'inline-block w-3 h-3 rounded-full bg-red-500';
          text.textContent = 'ESP32 offline · ' + new Date().toLocaleTimeString();
        }
      }

      async function fetchConfig() {
        try {
          var r = await fetch('/api/config');
          if (!r.ok) return;
          var cfg = await r.json();
          if (cfg.wheel1DiameterCm) w1Diam = cfg.wheel1DiameterCm;
          if (cfg.wheel2DiameterCm) w2Diam = cfg.wheel2DiameterCm;
        } catch (_) {}
      }

      async function fetchNow() {
        var dot  = document.getElementById('statusDot');
        var text = document.getElementById('statusText');
        dot.className    = 'inline-block w-3 h-3 rounded-full bg-yellow-400';
        text.textContent = 'Fetching…';
        try {
          var r = await fetch('/api/live-now');
          if (!r.ok) throw new Error('HTTP ' + r.status);
          var d = await r.json();
          render(d);
        } catch (err) {
          dot.className    = 'inline-block w-3 h-3 rounded-full bg-red-500';
          text.textContent = 'Error: ' + err.message;
        }
      }

      window.fetchNow = fetchNow;

      fetchConfig().then(fetchNow);
      setInterval(fetchNow, 5000);
    })();
    </script>
  `);
}

function renderKindle({ esp32, ltSummary, todayWheel1, todayWheel2, todayMotion1, todayMotion2, todayMotion3 }) {
  const nowStr    = new Date().toLocaleString('en-GB', { timeZone: 'Europe/London' });
  const todayDist = todayWheel1 + todayWheel2;
  const totalDist = ltSummary.totalWheel1 + ltSummary.totalWheel2 + todayDist;
  const todayMi   = (todayDist  * 0.000621371).toFixed(3);
  const totalMi   = (totalDist  * 0.000621371).toFixed(3);
  const lastTime  = new Date(esp32.lastActiveTs || Date.now())
    .toLocaleTimeString('en-GB', { timeZone: 'Europe/London' });

  // Pure HTML — no JavaScript, no external resources
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="refresh" content="60">
  <title>Chocolate - Kindle</title>
</head>
<body>
<h1>Chocolate's Monitor</h1>
<p><b>Updated:</b> ${esc(nowStr)}</p>
<hr>
<h2>Today</h2>
<ul>
  <li>Wheel 1 (bottom) distance: ${todayWheel1.toFixed(2)} m</li>
  <li>Wheel 2 (top) distance: ${todayWheel2.toFixed(2)} m</li>
  <li><b>Total distance: ${todayDist.toFixed(2)} m (${todayMi} miles)</b></li>
  <li>Max speed: ${(esp32.maxspeed || 0).toFixed(2)} m/s</li>
  <li>Average speed: ${(esp32.avespeed || 0).toFixed(2)} m/s</li>
  <li>Ground floor active: ${todayMotion1.toFixed(1)} s</li>
  <li>Middle floor active: ${todayMotion2.toFixed(1)} s</li>
  <li>Top floor active: ${todayMotion3.toFixed(1)} s</li>
  <li>Total active: ${(todayMotion1 + todayMotion2 + todayMotion3).toFixed(1)} s</li>
</ul>
<h2>All Time</h2>
<ul>
  <li>Wheel 1 total: ${(ltSummary.totalWheel1 + todayWheel1).toFixed(2)} m</li>
  <li>Wheel 2 total: ${(ltSummary.totalWheel2 + todayWheel2).toFixed(2)} m</li>
  <li><b>Total distance: ${totalDist.toFixed(2)} m (${totalMi} miles)</b></li>
  <li>Ground floor total: ${(ltSummary.totalMotion1 + todayMotion1).toFixed(1)} s</li>
  <li>Middle floor total: ${(ltSummary.totalMotion2 + todayMotion2).toFixed(1)} s</li>
  <li>Top floor total: ${(ltSummary.totalMotion3 + todayMotion3).toFixed(1)} s</li>
</ul>
<h2>Status</h2>
<ul>
  <li>Last seen: ${esc(lastTime)} on ${esc(esp32.lastLocation || 'unknown')}</li>
  <li>${esp32.lastActiveMinsAgo || '?'} minutes ago</li>
</ul>
<hr>
<p><small>hamster.jahosi.co.uk | auto-refreshes every 60 s</small></p>
</body>
</html>`;
}

// ─── Start server ─────────────────────────────────────────────────────────────
try {
  const sslOpts = {
    cert: fs.readFileSync(path.join(CERT_DIR, 'cert.pem')),
    key:  fs.readFileSync(path.join(CERT_DIR, 'privkey.pem')),
  };
  https.createServer(sslOpts, app).listen(PORT, () => {
    console.log(`🐹 Hamster monitor running on https://hamster.jahosi.co.uk:${PORT}`);
  });
} catch (err) {
  // Graceful fallback to HTTP for local development when certs are absent
  console.warn(`SSL certs not found (${err.message}). Starting HTTP server for development.`);
  http.createServer(app).listen(PORT, () => {
    console.log(`🐹 Hamster monitor running on http://localhost:${PORT} (dev/no-SSL mode)`);
  });
}
