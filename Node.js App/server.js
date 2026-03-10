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

async function getESP32Data() {
  if (esp32Cache && (Date.now() - esp32CacheAt) < CACHE_TTL_MS) {
    return esp32Cache;
  }

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

  esp32Cache   = raw;
  esp32CacheAt = nowMs;
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

// Kindle-friendly page (no JS)
app.get('/kindle', async (_req, res) => {
  const [esp32, ltSummary] = await Promise.all([
    getESP32Data().catch(() => ({})),
    Promise.resolve(getLongtermSummary()),
  ]);
  res.send(renderKindle({ esp32, ltSummary }));
});

// API – live ESP32 data
app.get('/api/live', async (_req, res) => {
  try {
    res.json(await getESP32Data());
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
        <a href="/"          class="hover:text-hamster-200 transition-colors">Home</a>
        <a href="/analytics" class="hover:text-hamster-200 transition-colors">Analytics</a>
        <a href="/kindle"    class="hover:text-hamster-200 transition-colors">Kindle</a>
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
        <a href="/"          style="display:block;padding:10px 8px;border-radius:6px;font-size:.875rem;font-weight:500;color:inherit;text-decoration:none" onmouseenter="this.style.backgroundColor='rgba(255,255,255,0.1)'" onmouseleave="this.style.backgroundColor='transparent'">Home</a>
        <a href="/analytics" style="display:block;padding:10px 8px;border-radius:6px;font-size:.875rem;font-weight:500;color:inherit;text-decoration:none" onmouseenter="this.style.backgroundColor='rgba(255,255,255,0.1)'" onmouseleave="this.style.backgroundColor='transparent'">Analytics</a>
        <a href="/kindle"    style="display:block;padding:10px 8px;border-radius:6px;font-size:.875rem;font-weight:500;color:inherit;text-decoration:none" onmouseenter="this.style.backgroundColor='rgba(255,255,255,0.1)'" onmouseleave="this.style.backgroundColor='transparent'">Kindle</a>
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

function renderKindle({ esp32, ltSummary }) {
  const nowStr      = new Date().toLocaleString('en-GB', { timeZone: 'Europe/London' });
  const todayDist   = ((esp32.distance1 || 0) + (esp32.distance2 || 0));
  const totalDist   = ltSummary.totalWheel1 + ltSummary.totalWheel2 + todayDist;
  const todayMi     = (todayDist  * 0.000621371).toFixed(3);
  const totalMi     = (totalDist  * 0.000621371).toFixed(3);
  const lastTime    = new Date(esp32.lastActiveTs || Date.now())
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
  <li>Wheel 1 (bottom) distance: ${(esp32.distance1 || 0).toFixed(2)} m</li>
  <li>Wheel 2 (top) distance: ${(esp32.distance2 || 0).toFixed(2)} m</li>
  <li><b>Total distance: ${todayDist.toFixed(2)} m (${todayMi} miles)</b></li>
  <li>Max speed: ${(esp32.maxspeed || 0).toFixed(2)} m/s</li>
  <li>Average speed: ${(esp32.avespeed || 0).toFixed(2)} m/s</li>
  <li>Ground floor active: ${(esp32.motion1count || 0).toFixed(1)} s</li>
  <li>Middle floor active: ${(esp32.motion2count || 0).toFixed(1)} s</li>
  <li>Top floor active: ${(esp32.motion3count || 0).toFixed(1)} s</li>
  <li>Total active: ${((esp32.motion1count||0)+(esp32.motion2count||0)+(esp32.motion3count||0)).toFixed(1)} s</li>
</ul>
<h2>All Time</h2>
<ul>
  <li>Wheel 1 total: ${(ltSummary.totalWheel1 + (esp32.distance1||0)).toFixed(2)} m</li>
  <li>Wheel 2 total: ${(ltSummary.totalWheel2 + (esp32.distance2||0)).toFixed(2)} m</li>
  <li><b>Total distance: ${totalDist.toFixed(2)} m (${totalMi} miles)</b></li>
  <li>Ground floor total: ${(ltSummary.totalMotion1 + (esp32.motion1count||0)).toFixed(1)} s</li>
  <li>Middle floor total: ${(ltSummary.totalMotion2 + (esp32.motion2count||0)).toFixed(1)} s</li>
  <li>Top floor total: ${(ltSummary.totalMotion3 + (esp32.motion3count||0)).toFixed(1)} s</li>
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
