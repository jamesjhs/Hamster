# Chocolate's Hamster Monitor – User Manual

_Chocolate is a Russian Dwarf Hamster born 7 September 2025._  
_This document describes every file, every data flow, every server function, and every user interaction in the monitoring system._

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture Diagram](#2-architecture-diagram)
3. [Layer 1 – ESP32 Hardware Sensor](#3-layer-1--esp32-hardware-sensor)
4. [Layer 2 – Raspberry Pi Data Logger](#4-layer-2--raspberry-pi-data-logger)
5. [Layer 3 – Node.js Web Application](#5-layer-3--nodejs-web-application)
6. [Information Flow – End to End](#6-information-flow--end-to-end)
7. [File Inventory](#7-file-inventory)
8. [Back-End Function Reference](#8-back-end-function-reference)
9. [Front-End Usage Guide](#9-front-end-usage-guide)
10. [Common Editing Tasks](#10-common-editing-tasks)
11. [Configuration Reference](#11-configuration-reference)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. System Overview

The Hamster Monitor is a four-layer IoT system that tracks Chocolate's physical activity in real time and presents the data on a public website at **https://hamster.jahosi.co.uk**.

| Layer | Technology | Role |
|-------|-----------|------|
| **Sensor hardware** | DOIT ESP32 DevKit V1 | Reads wheel rotation and motion-sensor events; serves raw data over HTTP |
| **Data logger** | Python 3 on Raspberry Pi | Polls the ESP32 every 30 seconds and writes cumulative readings to CSV files |
| **Web server** | Node.js / Express on Raspberry Pi | Reads the CSV files and the live ESP32 feed; renders pages and JSON APIs |
| **Public website** | HTML / Tailwind CSS / Chart.js | Browser-rendered pages for live stats, analytics charts, gallery, and Kindle |

The old PHP-based "NAS Gateway" layer (in `NAS Gateway Code/`) pre-dates the Node.js app and is kept for reference. The Node.js app in `Node.js App/` is the **current active system**.

---

## 2. Architecture Diagram

```
╔══════════════════════════════════════════════════════════════════════╗
║  CAGE (Physical hardware)                                            ║
║                                                                      ║
║  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐         ║
║  │ Wheel 1  │   │ Wheel 2  │   │ Motion 1 │   │ Motion 2 │ Motion 3║
║  │ (bottom) │   │  (top)   │   │ (ground) │   │ (middle) │ (top)   ║
║  └────┬─────┘   └────┬─────┘   └────┬─────┘   └────┬─────┘   │    ║
║       │              │              │              │           │    ║
║  Pin 35         Pin 34         Pin 18         Pin 19      Pin 21   ║
╚═══════╪══════════════╪══════════════╪══════════════╪═══════════╪════╝
        │              │              │              │           │
        └──────────────┴──────────────┴──────────────┴───────────┘
                                     │
                         ┌───────────┴───────────┐
                         │   ESP32 DevKit V1      │
                         │   192.168.1.98         │
                         │   Port 80              │
                         │   (wifi: home network) │
                         └───────────┬───────────┘
                                     │  HTTP GET /d/<endpoint>
                                     │  (parallel, every 30 s)
                         ┌───────────┴───────────┐
                         │   Raspberry Pi         │
                         │   datalogger.py        │
                         │   (Python 3 daemon)    │
                         └───────────┬───────────┘
                                     │  writes rows to CSV
                         ┌───────────┴───────────────────────────┐
                         │  /var/www/html/hamsterlogger/          │
                         │  ├── longtermlog.csv   (all time)      │
                         │  ├── YYYYMMDD.csv      (per day)       │
                         │  └── YYYYMMDD-log.txt  (daemon log)    │
                         └───────────────────────────────────────┘
                                     │  fs.readFileSync()
                         ┌───────────┴───────────┐
                         │   Node.js / Express    │
                         │   /var/node/cert/      │
                         │   server.js  port 4000 │
                         │   (HTTPS)              │
                         └─────────┬─────┬────────┘
              static files         │     │  HTTP GET /d/<endpoint>
              (images, JS)         │     │  (parallel, 30 s cache)
                                   │     └──────────────────────────────┐
             ┌─────────────────────┴──┐                                 │
             │  Public Website        │                     ┌───────────┴──┐
             │  /          (home)     │                     │  ESP32       │
             │  /analytics (charts)   │                     │  192.168.1.98│
             │  /kindle    (no-JS)    │                     └──────────────┘
             │  /api/live             │
             │  /api/csv-data         │
             │  /api/csv-files        │
             │  /api/images           │
             └────────────────────────┘
                          │
              ┌───────────┴──────────┐
              │  nginx (port 443)    │
              │  proxy → 4000        │
              └──────────────────────┘
                          │
                  Internet / Browser
                  https://hamster.jahosi.co.uk
```

---

## 3. Layer 1 – ESP32 Hardware Sensor

### Files
| File | Purpose |
|------|---------|
| `ESP32 Code/esp32AdvancedWebServer.ino` | Main Arduino sketch – all sensor logic and HTTP endpoints |
| `ESP32 Code/wifisetup.h` | Wi-Fi credentials (SSID + password) |
| `ESP32 Code/ci.json` | Arduino CI config – declares the ESP32 WiFi capability requirement |

### Hardware Pin Assignments

| GPIO Pin | Variable name | Connected to |
|----------|--------------|-------------|
| 35 | `pinWheel1` | Reed switch / hall-effect sensor – bottom wheel |
| 34 | `pinWheel2` | Reed switch / hall-effect sensor – top wheel |
| 18 | `pinMotion1` | PIR motion sensor – ground floor of cage |
| 19 | `pinMotion2` | PIR motion sensor – middle floor of cage |
| 21 | `pinMotion3` | PIR motion sensor – top floor of cage |
| 2  | `led` | On-board blue LED (status) |
| 32 | `ledWheel` | External LED – flashes on each wheel pulse |
| 33 | `ledMotion` | External LED – lit while motion is detected |

### How the ESP32 Works

**Wheel measurement**  
Each time a reed/hall sensor on a wheel closes (digital HIGH), the sketch counts one revolution and adds `wheelCircumf` (π × 13.5 cm ÷ 100 = 0.424 m) to the running odometer for that wheel. It debounces by holding a `triggered` flag so one physical pulse is only counted once.

Speed is computed as:
```
currentspeed = 1000 × wheelCircumf / milliseconds_since_last_pulse
```
`avespeed` is total distance ÷ total running time (excluding breaks longer than 10 seconds).

**Motion measurement**  
Each PIR input is edge-detected (rising = active, falling = inactive). When a sensor goes inactive, the sketch calculates how many seconds it was high and adds that to `totalDuration1/2/3`. These totals accumulate throughout the day without being reset between events.

**Web server (port 80)**  
The sketch starts an HTTP server. Each data point is exposed as a separate URL so they can be fetched independently or in parallel:

| URL | Returns | Unit / format |
|-----|---------|---------------|
| `/` | Full HTML dashboard (auto-refreshes every 1 s) | HTML |
| `/reset` | Clears all counters back to zero; sends a confirmation page | HTML |
| `/d/distance1` | Odometer reading for wheel 1 | metres, 2 dp |
| `/d/distance2` | Odometer reading for wheel 2 | metres, 2 dp |
| `/d/maxspeed` | Highest speed recorded today | m/s, 2 dp |
| `/d/avespeed` | Average running speed today | m/s, 2 dp |
| `/d/millisnow` | ESP32 uptime | milliseconds |
| `/d/lastwheelmillis` | Elapsed ms since last wheel pulse | milliseconds |
| `/d/lastmotionmillis` | Elapsed ms since last motion event | milliseconds |
| `/d/wheelNumberLast` | Which wheel moved last | `1` or `2` |
| `/d/motionLevelLast` | Which floor had motion last | `1`, `2`, or `3` |
| `/d/motion1count` | Total seconds motion detected – ground floor | seconds, 2 dp |
| `/d/motion2count` | Total seconds motion detected – middle floor | seconds, 2 dp |
| `/d/motion3count` | Total seconds motion detected – top floor | seconds, 2 dp |

**Important**: All values reset to zero when the `/reset` endpoint is called. The Python data logger calls `/reset` automatically at midnight when it rolls over to a new daily CSV file (see Section 4).

### Changing the Wheel Diameter
Open `esp32AdvancedWebServer.ino` and change line 34:
```cpp
float wheelDia = 13.5;  // wheel diameter in cm
```
`wheelCircumf` is derived from `wheelDia` automatically. Re-flash the ESP32 after changing.

### Changing Wi-Fi Credentials
Edit `ESP32 Code/wifisetup.h`:
```cpp
const char *ssid     = "YourNetworkName";
const char *password = "YourPassword";
```

---

## 4. Layer 2 – Raspberry Pi Data Logger

### Files (deployed to the Pi web-root, e.g., `/var/www/html/hamsterlogger/`)
| File | Purpose |
|------|---------|
| `Raspberry Pi Code/datalogger.py` | Python 3 daemon – polls ESP32 and writes CSV |
| `Raspberry Pi Code/index.php` | Admin page – shows process status and start/stop links |
| `Raspberry Pi Code/startprocess.php` | Starts `datalogger.py` as a background process |
| `Raspberry Pi Code/csvfiles.php` | Lists all `.csv` files in the directory (used by old PHP front-end) |
| `Raspberry Pi Code/resetdata.php` | Deletes today's daily CSV file |
| `Raspberry Pi Code/killpid.php` | Generated at runtime by `datalogger.py` – kills the running daemon |
| `Raspberry Pi Code/pid.php` | Generated at runtime by `datalogger.py` – returns the daemon PID |

### How the Data Logger Works

**Startup**  
`datalogger.py` is launched by `startprocess.php` (via Apache's `exec()` call). On start it:
1. Records its own process ID in `pid.php` so the admin page can show it.
2. Creates `killpid.php` containing a `kill -9` command targeting itself, so it can be stopped from the browser.
3. Logs a startup timestamp to `YYYYMMDD-log.txt`.

**Polling loop (every 30 seconds)**  
The script calls `retrieveandsave()` in an infinite loop (`repetitions = 0`).

Inside `retrieveandsave()`:
1. Five HTTP GET requests are made **sequentially** to the ESP32:
   - `/d/distance1`, `/d/distance2`
   - `/d/motion1count`, `/d/motion2count`, `/d/motion3count`
2. The responses are parsed to floats.
3. **Midnight rollover detection**: if `lasthour` (last recorded hour) is greater than the current hour (e.g., 23 → 0), the script knows midnight has just passed. In this case it:
   - Writes the final row of the day to `YYYYMMDD.csv` using _yesterday's_ date.
   - Appends the same row to `longtermlog.csv`.
   - Calls `/reset` on the ESP32 to clear its counters.
4. **Normal case**: appends one row to today's `YYYYMMDD.csv`.
5. Sleeps for 30 seconds.

### CSV File Format

Every CSV row has exactly 6 comma-separated fields:

```
timestamp,distance1,distance2,motion1count,motion2count,motion3count
```

| Column | Field | Description |
|--------|-------|-------------|
| 0 | `timestamp` | Unix timestamp (integer seconds since 1 Jan 1970 UTC) |
| 1 | `distance1` | Cumulative odometer – wheel 1, metres |
| 2 | `distance2` | Cumulative odometer – wheel 2, metres |
| 3 | `motion1count` | Cumulative active time – ground-floor PIR, seconds |
| 4 | `motion2count` | Cumulative active time – middle-floor PIR, seconds |
| 5 | `motion3count` | Cumulative active time – top-floor PIR, seconds |

**Example**:
```
1740787200,15.24,22.56,3600.0,1800.5,900.25
1740787230,15.24,23.00,3600.0,1815.2,900.25
```

**Two types of CSV file**:
- **Daily files** (`YYYYMMDD.csv`): values are **cumulative** within the day – they increase monotonically and reset at midnight. The web app displays the _difference_ between consecutive rows to show activity per 30-second interval.
- **Long-term log** (`longtermlog.csv`): each row is the **final daily total** (the midnight snapshot). Each row IS the total for that day. The web app uses values directly for trend charts.

### Starting and Stopping the Logger

**Start** (via browser): visit `http://192.168.1.72/hamsterlogger/startprocess.php`  
**Stop** (via browser): visit `http://192.168.1.72/hamsterlogger/killpid.php`  
**Admin overview**: visit `http://192.168.1.72/hamsterlogger/` → `index.php`

### Admin Page (`index.php`)

The admin page (`Raspberry Pi Code/index.php`) checks whether `killpid.php` exists to determine if the daemon is running. It shows:
- A **STOP** link if the daemon is running.
- A **START** link if not.
- The output of `top -b -n1 -p <pid>` showing CPU/memory usage of the daemon.
- Links to reset the ESP32 and delete today's CSV.

---

## 5. Layer 3 – Node.js Web Application

### Files (`Node.js App/`)

| File / Directory | Purpose |
|------------------|---------|
| `server.js` | Express application – all routes, page renderers, and API endpoints |
| `package.json` | NPM metadata, dependency list, build scripts |
| `package-lock.json` | Exact dependency versions (committed for reproducibility) |
| `tailwind.config.js` | Tailwind CSS configuration – custom "hamster" colour palette |
| `src/input.css` | Tailwind source file for optional local build |
| `images.json` | Gallery descriptor – list of photo objects |
| `public/js/analytics.js` | Client-side JavaScript for the Analytics page |
| `public/images/` | Folder for full-size gallery photos (served statically) |
| `public/images/thumbs/` | Folder for thumbnail versions of gallery photos |
| `public/css/` | Output folder for compiled Tailwind CSS (optional build) |
| `.gitignore` | Excludes `node_modules/`, built CSS, PM2 logs |
| `SETUP.md` | Deployment guide for the Raspberry Pi |

### Deployment Location on the Pi

All files in `Node.js App/` are copied to `/var/node/cert/` on the Raspberry Pi.  
The SSL certificates (`cert.pem`, `privkey.pem`) are placed in the same directory.

```
/var/node/cert/
├── server.js
├── package.json
├── images.json
├── cert.pem           ← SSL certificate (Let's Encrypt)
├── privkey.pem        ← SSL private key (Let's Encrypt)
├── public/
│   ├── js/analytics.js
│   ├── images/
│   │   ├── *.jpg      ← full-size gallery photos
│   │   └── thumbs/
│   │       └── *-thumb.jpg
│   └── css/           ← (optional) compiled Tailwind CSS
└── node_modules/      ← installed by npm install (not in git)
```

### Server Start-Up

```bash
cd /var/node/cert
node server.js
```

The server reads `cert.pem` and `privkey.pem`. If both exist it starts an HTTPS server on port 4000. If either is missing (e.g., during local development) it falls back to a plain HTTP server and logs a warning.

---

## 6. Information Flow – End to End

### A. Live data to Home page (every page request)

```
Browser → GET /  →  server.js route handler
              │
              ├── getESP32Data()          (30 s cache)
              │   └── 12 × http.get()    → ESP32 /d/* endpoints
              │       All fired in parallel via Promise.all()
              │
              ├── getLongtermSummary()    (synchronous file read)
              │   └── readCSV('longtermlog.csv')
              │       Sums all historical rows
              │
              └── loadImages()            (synchronous file read)
                  └── JSON.parse('images.json')
                      Returns array of gallery objects
              │
              └─ renderIndex() assembles HTML string
                  Returns complete HTML page to browser
```

### B. Analytics data flow (user interaction)

```
Browser loads /analytics
       │
       └── analytics.js initialises on DOMContentLoaded
               │
               ├── fetch('/api/csv-files')
               │   Returns: ["longtermlog.csv","20260301.csv", ...]
               │   Populates <select> dropdown
               │
               └── setPreset(30) → sets date pickers to last 30 days
                       │
                       └── loadData() → fetch('/api/csv-data?from=...&to=...')
                               │
                               server.js:
                               ├── Validates 'file' param (regex: ^[\w-]+\.csv$)
                               ├── readCSV('longtermlog.csv')
                               ├── filters rows by Unix timestamp range
                               └── Returns JSON: { type:'longterm', rows:[[ts,w1,w2,m1,m2,m3],...] }
                               │
                               analytics.js:
                               ├── renderCharts() → new Chart.js instances
                               ├── renderSummary() → fills stat cards
                               └── renderTable() → fills <tbody>
```

### C. Kindle page data flow

```
Kindle browser → GET /kindle → server.js
       │
       ├── getESP32Data()   (parallel ESP32 fetch, same 30 s cache)
       └── getLongtermSummary()  (CSV read)
       │
       └── renderKindle() produces pure HTML:
           - No <script> tags
           - No external resources
           - <meta http-equiv="refresh" content="60"> for auto-reload
           - Returns complete self-contained HTML
```

### D. Data writing (Python daemon, every 30 s)

```
datalogger.py                    ESP32
    │                              │
    ├── GET /d/distance1  ────────►│
    ├── GET /d/distance2  ────────►│
    ├── GET /d/motion1count ───────│
    ├── GET /d/motion2count ───────│
    └── GET /d/motion3count ───────│
                                   │ (sequential, one at a time)
    ◄── values (plain text) ───────┤
    │
    ├── Is it a new day? (lasthour > current_hour)
    │   YES:
    │   ├── Write final row to YYYYMMDD.csv (yesterday)
    │   ├── Append same row to longtermlog.csv
    │   └── GET /reset  ──────────►ESP32 (resets all counters)
    │
    │   NO:
    │   └── Append row to today's YYYYMMDD.csv
    │
    └── sleep(30)
```

---

## 7. File Inventory

### ESP32 Code

| File | Inputs | Outputs |
|------|--------|---------|
| `wifisetup.h` | _(edited manually)_ | SSID / password constants |
| `esp32AdvancedWebServer.ino` | GPIO pins 34, 35, 18, 19, 21 | HTTP responses on port 80 |
| `ci.json` | _(static config)_ | Arduino CI metadata |

### Raspberry Pi Code

| File | Inputs | Outputs |
|------|--------|---------|
| `datalogger.py` | HTTP responses from ESP32 | `YYYYMMDD.csv`, `longtermlog.csv`, `YYYYMMDD-log.txt`, `killpid.php`, `pid.php` |
| `index.php` | `pid.php`, `killpid.php`, `top` command | HTML admin page |
| `startprocess.php` | _(HTTP request from browser)_ | Starts `datalogger.py` as background process |
| `resetdata.php` | _(HTTP request)_ | Deletes today's `YYYYMMDD.csv` |
| `csvfiles.php` | Directory listing | Newline-separated list of CSV filenames |
| `killpid.php` | _(HTTP request)_ | Kills daemon, deletes `killpid.php` and `pid.php` |
| `pid.php` | _(HTTP request)_ | Returns daemon PID as plain text |

### Node.js App

| File | Inputs | Outputs |
|------|--------|---------|
| `server.js` | CSV files, `images.json`, ESP32 HTTP, browser requests | HTML pages, JSON API responses |
| `images.json` | _(edited manually)_ | Gallery data (read by `loadImages()`) |
| `analytics.js` | JSON from `/api/csv-data`, `/api/csv-files` | Chart.js charts, stat cards, data table (in browser) |
| `tailwind.config.js` | _(static)_ | Tailwind theme for optional local CSS build |
| `src/input.css` | _(static)_ | Input for `npm run build:css` |
| `public/images/*.jpg` | _(uploaded manually)_ | Served statically at `/images/<filename>` |
| `public/images/thumbs/*.jpg` | _(uploaded manually)_ | Served at `/images/thumbs/<filename>` |

---

## 8. Back-End Function Reference

All functions below live in `Node.js App/server.js`.

---

### `esc(str)` → `string`
Escapes `&`, `<`, `>`, `"` for safe HTML output. Used throughout `renderIndex()`, `renderKindle()` and gallery rendering to prevent XSS from filenames or descriptions.

---

### `httpGet(url, timeoutMs = 3000)` → `Promise<string>`
Makes a plain HTTP GET request and resolves to the trimmed response body. On any error (network, timeout) resolves to `'0'` so downstream `parseFloat()` calls always succeed.

---

### `getESP32Data()` → `Promise<object>`
Fetches all 12 ESP32 endpoints in **parallel** using `Promise.all()`. Results are cached for 30 seconds (`CACHE_TTL_MS`). Multiple simultaneous page requests within the cache window hit only the local cache, not the ESP32.

Returns an object with these fields:

| Property | Type | Description |
|----------|------|-------------|
| `avespeed` | number | Average running speed today (m/s) |
| `maxspeed` | number | Maximum speed recorded today (m/s) |
| `distance1` | number | Wheel 1 odometer today (m) |
| `distance2` | number | Wheel 2 odometer today (m) |
| `wheelNumberLast` | number | `1` or `2` |
| `millisnow` | number | ESP32 uptime in ms |
| `motion1count` | number | Ground-floor active time today (s) |
| `motion2count` | number | Middle-floor active time today (s) |
| `motion3count` | number | Top-floor active time today (s) |
| `motionLevelLast` | number | `1`, `2`, or `3` |
| `lastwheelmillis` | number | Milliseconds since last wheel pulse |
| `lastmotionmillis` | number | Milliseconds since last motion event |
| `lastWheelTs` | number | Unix epoch ms of last wheel event |
| `lastMotionTs` | number | Unix epoch ms of last motion event |
| `lastActiveTs` | number | Latest of `lastWheelTs` / `lastMotionTs` |
| `lastActiveMinsAgo` | number | Minutes since last any activity |
| `lastLocation` | string | Human-readable location (e.g., `"wheel 1 (bottom)"`) |
| `humanYears` | number | Chocolate's age in human years |
| `hamsterYears` | number | Equivalent hamster years (polynomial formula) |

---

### `readCSV(filePath)` → `number[][]`
Reads a CSV file synchronously, splits by newline, parses each line into an array of numbers, and filters out any rows that don't have at least 6 columns or have an invalid timestamp. Returns `[]` on any file error.

---

### `listCSVFiles()` → `string[]`
Reads `CSV_DIR`, filters to `.csv` files only, sorts alphabetically then reverses (newest first). Returns `[]` if the directory doesn't exist or can't be read.

---

### `getLongtermSummary()` → `object`
Reads `longtermlog.csv` and sums all historical totals. Returns:
```js
{ totalWheel1, totalWheel2, totalMotion1, totalMotion2, totalMotion3 }
```
These are **all-time** accumulated values. Added to today's live ESP32 readings to produce the "all-time" distance shown on the Home page.

---

### `loadImages()` → `object[]`
Reads and parses `images.json`. Returns the parsed array on success, `[]` on any error (file missing, invalid JSON).

---

### `layout(title, bodyContent)` → `string`
Wraps any page body in the shared HTML layout. Injects:
- UTF-8 meta tags and responsive viewport.
- Tailwind CDN script (with inline configuration of the custom `hamster` colour palette).
- Navigation bar with links to `/`, `/analytics`, `/kindle`.
- `<footer>` credits line.

---

### `statCard(icon, label, value, sub)` → `string`
Returns HTML for one stat card tile (icon + label + large value + small sub-label).

---

### `renderIndex(data)` → `string`
Builds the complete Home page HTML. Sections:
1. **Stat cards** row: today's distance (mi + km), all-time distance, last seen, active time today.
2. **Today's Activity panel**: 6-column grid with each wheel and floor broken out.
3. **Photo Gallery**: responsive grid of thumbnail cards; clicking opens a lightbox. If `images` is empty, shows a hint to populate `images.json`.
4. **Lightbox**: full-screen overlay rendered server-side; opened/closed by inline JS.

---

### `renderAnalytics()` → `string`
Builds the Analytics page HTML shell. All actual data is fetched client-side by `analytics.js`. The server renders:
- Date-range controls (from/to date inputs, preset buttons, file selector).
- Empty chart `<canvas>` elements.
- Empty summary card placeholders.
- Collapsible data table container.
- `<script>` tags loading Chart.js CDN and `/js/analytics.js`.

---

### `renderKindle(data)` → `string`
Builds a minimal HTML page suitable for a Kindle's basic browser:
- No `<script>` tags.
- No external CSS or JS.
- No `<link>` elements.
- `<meta http-equiv="refresh" content="60">` for automatic reload every minute.
- Plain text, `<ul>` lists, `<hr>` dividers.

---

## 9. Front-End Usage Guide

### 9.1 Home Page (`/`)

**What you see:**

- **Navigation bar** (dark brown): links to Home, Analytics, and Kindle.
- **Age line**: Chocolate's age in human years and hamster years (recalculated on each request).
- **Four stat cards**:
  - 🏃 Today's Distance – wheel odometer for the current ESP32 session.
  - 🌍 All-time Distance – historical CSV totals + today.
  - 👀 Last Seen – time of the most recent wheel or motion event, and how many minutes ago.
  - ⏱️ Active Today – total seconds all motion sensors detected activity.
- **Today's Activity panel**: detailed breakdown by wheel and floor.
- **Photo Gallery**: grid of all images defined in `images.json`.

**Interacting with the Gallery:**
- Click any thumbnail to open a **lightbox** with the full-size image and its annotation.
- Click outside the image, or press **Escape**, to close the lightbox.
- Click the ✕ button inside the lightbox.

**Refreshing data:**
- Click "Refresh now" (at the bottom of Today's Activity) to force a page reload.
- Or simply reload the page — ESP32 data is re-fetched if the 30-second cache has expired.

---

### 9.2 Analytics Page (`/analytics`)

The Analytics page is the most interactive part of the site. All data is fetched from the JSON API after the page loads.

**Controls**

| Control | What it does |
|---------|-------------|
| **Data source** dropdown | Choose "Long-term log" (date-range filtering applies) or a specific daily file (date picker is hidden) |
| **From / To** date pickers | Filter the long-term log to a date range |
| **Today** button | Sets the range to today only |
| **Last 7d** button | Sets the range to the last 7 calendar days |
| **Last 30d** button | Sets the range to the last 30 calendar days (default on load) |
| **All time** button | Sets the range to Jan 1 2000 → today (effectively all records) |
| **Apply ↵** button | Fetches data and refreshes all charts and tables |

**Summary Cards**  
Once data loads, four summary cards appear showing totals for the selected range:
- **Total Distance** (m) – wheel 1 + wheel 2 combined.
- **Wheel 1 (bottom)** total distance (m).
- **Wheel 2 (top)** total distance (m).
- **Total Active Time** (s) – all three motion sensors combined.

**Charts**  
Two Chart.js line charts update simultaneously:

| Chart | Y-axis | Datasets |
|-------|--------|----------|
| **Wheel Distance** | metres | Wheel 1 (bottom) in amber; Wheel 2 (top) in dark brown |
| **Cage Activity by Level** | seconds | Ground floor (red), Middle floor (green), Top floor (blue) |

- **Long-term log**: X-axis shows dates; Y values are the daily totals per row.
- **Daily file**: X-axis shows times (HH:MM); Y values are the **difference** between consecutive readings, showing activity per 30-second interval rather than a rising staircase.
- When more than 100 data points are shown, point markers are hidden to keep the chart readable.

**Data Table**  
Click the "▶ Data Table" button to expand a scrollable table showing every row from the selected dataset, with all six columns formatted and alternating row shading.

---

### 9.3 Kindle Page (`/kindle`)

Open `https://hamster.jahosi.co.uk/kindle` in any browser, including a Kindle's basic browser.

The page contains:
- A timestamp showing when the page was last generated.
- **Today**: distance (m), max speed, average speed, per-floor active seconds.
- **All Time**: total distance per wheel, total distance combined, total motion per floor.
- **Status**: last-seen time and location, minutes since last activity.

The page reloads automatically every **60 seconds** via an HTTP meta-refresh header — no JavaScript is required.

---

### 9.4 JSON APIs (for developers / integrations)

All APIs return JSON.

#### `GET /api/live`
Returns the full `getESP32Data()` object. Returns a 503 if the ESP32 is unreachable.

#### `GET /api/csv-files`
Returns an array of strings: available CSV filenames in the `CSV_DIR`, newest first.
```json
["longtermlog.csv", "20260301.csv", "20260228.csv"]
```

#### `GET /api/csv-data`
Query parameters:

| Parameter | Type | Description |
|-----------|------|-------------|
| `file` | string | Specific CSV filename (must match `^[\w-]+\.csv$`). If given, `from`/`to` are ignored. |
| `from` | date string (`YYYY-MM-DD`) | Start of date range (inclusive). Only used with the long-term log. |
| `to` | date string (`YYYY-MM-DD`) | End of date range (inclusive). |

Returns:
```json
{
  "type": "longterm",
  "rows": [
    [1740700800, 150.23, 200.45, 3600, 1800, 900],
    ...
  ]
}
```
`type` is `"longterm"` for `longtermlog.csv` and `"intraday"` for daily files.

**Security note**: The `file` parameter is validated against the regex `^[\w-]+\.csv$`. Any attempt to use `../` path traversal is rejected with HTTP 400.

#### `GET /api/images`
Returns the parsed `images.json` array.
```json
[
  {
    "filename": "chocolate-wheel.jpg",
    "thumb": "thumbs/chocolate-wheel-thumb.jpg",
    "description": "Chocolate in full sprint on the bottom wheel at midnight",
    "date": "2025-10-12"
  }
]
```

---

## 10. Common Editing Tasks

### 10.1 Add a New Gallery Photo

1. **Copy the images to the Pi:**
   ```bash
   scp my-photo.jpg pi@192.168.1.72:/var/node/cert/public/images/
   scp my-photo-thumb.jpg pi@192.168.1.72:/var/node/cert/public/images/thumbs/
   ```
   Thumbnails should be ≤ 300 px wide. Full-size can be any reasonable size (≤ 2 MB recommended for mobile).

2. **Edit `images.json`** on the Pi:
   ```bash
   nano /var/node/cert/images.json
   ```
   Add a new entry to the JSON array:
   ```json
   {
     "filename": "my-photo.jpg",
     "thumb": "thumbs/my-photo-thumb.jpg",
     "description": "Chocolate yawning during his morning grooming",
     "date": "2026-01-15"
   }
   ```
   
   All four fields are optional except `filename` (which must match the image file you uploaded). The gallery renders in the same order as the JSON array.

3. **No server restart required** – `images.json` is read on each request.

---

### 10.2 Remove a Gallery Photo

Edit `/var/node/cert/images.json` and delete the corresponding JSON object. The image file itself can be left in `public/images/` (it simply won't appear in the gallery) or deleted:
```bash
rm /var/node/cert/public/images/old-photo.jpg
rm /var/node/cert/public/images/thumbs/old-photo-thumb.jpg
```

---

### 10.3 Change the Date Range Defaults

The Analytics page defaults to **last 30 days** on load. To change this, edit `server.js` (the `renderAnalytics()` function) and search for `setPreset(30)` in the page's inline HTML, **or** edit `analytics.js`:

```js
// analytics.js, inside DOMContentLoaded:
setPreset(30);   // ← change to 7, 1, 0, etc.
```

After editing, restart the server:
```bash
pm2 restart hamster-monitor
```

---

### 10.4 Change Chocolate's Birthday

The birthday controls the age calculation shown on the Home page. Edit `server.js`:

```js
// Line 22:
const BIRTH_DATE = new Date('2025-09-07');  // YYYY-MM-DD
```

Restart the server after saving.

---

### 10.5 Change the ESP32 IP Address

If the ESP32 is assigned a new IP address by the router, update the environment variable (recommended) or the default in `server.js`.

**Via PM2 environment variable (no file edit needed):**
```bash
pm2 stop hamster-monitor
ESP32_IP=192.168.1.55 pm2 start server.js --name hamster-monitor
pm2 save
```

**Or edit `server.js` line 14:**
```js
const ESP32_IP = process.env.ESP32_IP || '192.168.1.98';
```

Also update `datalogger.py` line 42:
```python
esp32IP = "192.168.1.55"
```

---

### 10.6 Change the CSV Directory

If the Python data logger writes CSVs to a different directory, update the `CSV_DIR` environment variable when starting the Node.js server:
```bash
CSV_DIR=/path/to/csvs pm2 start server.js --name hamster-monitor
```

Or edit `server.js` line 17:
```js
const CSV_DIR = process.env.CSV_DIR || '/var/www/html/hamsterlogger';
```

---

### 10.7 Change the Polling Interval

Edit `datalogger.py` line 25:
```python
delay = 30  # seconds between each ESP32 poll
```
Then restart the daemon from the Pi admin page or:
```bash
ssh pi@192.168.1.72
curl http://192.168.1.72/hamsterlogger/killpid.php
curl http://192.168.1.72/hamsterlogger/startprocess.php
```

---

### 10.8 Renew SSL Certificates

Certificates are typically issued by Let's Encrypt via Certbot. After renewal:
```bash
# Certbot usually auto-renews and places certs in /etc/letsencrypt/live/<domain>/
sudo cp /etc/letsencrypt/live/hamster.jahosi.co.uk/cert.pem     /var/node/cert/cert.pem
sudo cp /etc/letsencrypt/live/hamster.jahosi.co.uk/privkey.pem  /var/node/cert/privkey.pem
pm2 restart hamster-monitor
```
Or configure a Certbot renewal hook to copy the files and restart automatically.

---

### 10.9 Modify the Colour Scheme

The custom "hamster" colour palette is defined in two places:

**For Tailwind CDN (live/no-build):** Edit the inline `tailwind.config` block in the `layout()` function in `server.js` (around line 262):
```js
hamster: {
  50:'#fdf8f0', 100:'#fdefd9', ..., 900:'#782f16'
}
```

**For local Tailwind build:** Edit `tailwind.config.js`:
```js
hamster: {
  50:  '#fdf8f0',
  ...
  900: '#782f16',
},
```
Then rebuild CSS: `npm run build:css`

---

### 10.10 Add More Sensor Floors or Wheels

This requires changes across all three layers:

1. **ESP32 sketch** (`esp32AdvancedWebServer.ino`): add new pin definitions, event handlers, and HTTP endpoint functions.
2. **Python data logger** (`datalogger.py`): add new `requests.get(...)` calls in `retrieveandsave()` and add the new values to the CSV output string.
3. **Node.js server** (`server.js`):
   - Add the new endpoint to `getESP32Data()`'s `endpoints` array.
   - Update `getLongtermSummary()` to include the new columns.
   - Update `renderIndex()`, `renderAnalytics()`, `renderKindle()` to display the new data.
4. **Analytics client** (`analytics.js`):
   - Update the `series()` function column references.
   - Add the new dataset to the chart `datasets` arrays.
   - Update `renderTable()` headers and row construction.

---

## 11. Configuration Reference

### Environment Variables (`server.js`)

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `4000` | TCP port the Node.js server listens on |
| `ESP32_IP` | `192.168.1.98` | LAN IP address of the ESP32 |
| `CSV_DIR` | `/var/www/html/hamsterlogger` | Directory where the Python data logger writes CSV files |
| `CERT_DIR` | `/var/node/cert` | Directory containing `cert.pem` and `privkey.pem` |

### Hard-Coded Constants (`server.js`)

| Constant | Value | Description |
|----------|-------|-------------|
| `CACHE_TTL_MS` | `30000` | ESP32 data cache lifetime (30 seconds) |
| `BIRTH_DATE` | `2025-09-07` | Chocolate's birthday (used for age calculation) |

### Hard-Coded Constants (`datalogger.py`)

| Variable | Value | Description |
|----------|-------|-------------|
| `esp32IP` | `192.168.1.98` | ESP32 LAN address |
| `delay` | `30` | Seconds between polls |
| `repetitions` | `0` | `0` = run forever; positive int = limited runs |

### Hard-Coded Constants (`esp32AdvancedWebServer.ino`)

| Variable | Value | Description |
|----------|-------|-------------|
| `wheelDia` | `13.5` (cm) | Diameter of each hamster wheel |
| `timePause` | `10000` (ms) | Gap in wheel turns that counts as a "rest" between runs |

---

## 12. Troubleshooting

### The website shows `0.00` for everything

- The ESP32 may be offline (power cut, Wi-Fi disconnected, or restarted).
- `getESP32Data()` falls back to `0` for every endpoint on timeout/error, so the page still loads.
- Check the ESP32 is reachable: `curl http://192.168.1.98/d/distance1` from the Pi.
- Check the ESP32's serial monitor for Wi-Fi connection issues.

---

### The home page shows today's distance but all-time distance is 0

- The Pi data logger may not be running, so `longtermlog.csv` is empty or missing.
- Check the admin page: `http://192.168.1.72/hamsterlogger/`
- If the daemon is not running, click START.

---

### The analytics charts are blank after loading

- The `CSV_DIR` may not exist or may be empty.
- Check: `ls /var/www/html/hamsterlogger/`
- Ensure the data logger has been running for at least one full day so `longtermlog.csv` has entries.

---

### "Invalid file name" error when using /api/csv-data

- The `file` query parameter contains characters not matching `^[\w-]+\.csv$`.
- Only alphanumeric characters, underscores, and hyphens are allowed in filenames.

---

### The Kindle page doesn't refresh

- Confirm the `<meta http-equiv="refresh" content="60">` tag is present by viewing page source on the Kindle.
- Some Kindle browsers block meta-refresh. In that case, bookmark the page and refresh it manually.

---

### SSL certificate errors in the browser

- The certificate may have expired. Re-issue via Let's Encrypt and copy to `/var/node/cert/`.
- The domain name on the certificate must match `hamster.jahosi.co.uk`.
- Check: `openssl x509 -in /var/node/cert/cert.pem -noout -dates`

---

### The Node.js server crashes on startup

- Check for missing `node_modules/`: run `npm install --omit=dev` in `/var/node/cert/`.
- Check for missing cert files: the server will log a warning and fall back to HTTP — this is normal during development.
- Check PM2 logs: `pm2 logs hamster-monitor --lines 50`

---

### The Python data logger stops writing CSVs

- The daemon process may have crashed. Check `http://192.168.1.72/hamsterlogger/` — if no PID shows, restart it.
- Check the daily log file: `cat /var/www/html/hamsterlogger/$(date +%Y%m%d)-log.txt`
- Common causes: network disruption to the ESP32 (handled by the `except` block, which retries after 30 s), or disk full.

---

*End of User Manual*
