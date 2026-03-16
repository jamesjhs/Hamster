#!/usr/bin/env python3
"""Hamster Monitor – PythonServer.

Combines two responsibilities in one process:

1. **Data logger** – a background thread polls all ESP32 endpoints every 30
   seconds and appends readings to per-day CSV files.  At midnight the final
   readings are also written to ``longtermlog.csv`` and the ESP32 counters are
   reset to zero.

2. **Web server** – a Flask application serves four pages (home, analytics,
   blog, Kindle) and a small JSON API consumed by the analytics page.

Usage::

    python server.py

Configuration via environment variables:

``PORT``      HTTP port (default ``4000``)
``ESP32_IP``  ESP32 device IP address (default ``192.168.1.98``)
``CSV_DIR``   Directory for CSV log files (default ``/var/hamsterlogger``)
"""

import json
import logging
import math
import os
import re
import time
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
from flask import Flask, jsonify, render_template, request

# ─── Configuration ─────────────────────────────────────────────────────────────

PORT       = int(os.environ.get('PORT', 4000))
ESP32_IP   = os.environ.get('ESP32_IP', '192.168.1.98')
CSV_DIR    = Path(os.environ.get('CSV_DIR', '/var/hamsterlogger'))
BIRTH_DATE = datetime(2025, 9, 7, tzinfo=timezone.utc)

# Wheel diameter configuration (cm).  Set WHEEL1_DIAMETER_CM / WHEEL2_DIAMETER_CM
# environment variables when the physical wheels differ from the ESP32 firmware's
# reference diameter (13.5 cm).  Defaults reflect the new cage fitted on
# CAGE_UPGRADE_DATE: Wheel 1 is the big wheel (30 cm), Wheel 2 the small wheel
# (14 cm).  The poller applies a proportional correction to the metres reported
# by the ESP32, which always computes distance based on the 13.5 cm reference.
_ESP32_BASE_DIAM_CM  = 13.5   # diameter (cm) hard-coded in the ESP32 firmware
WHEEL1_DIAMETER_CM   = float(os.environ.get('WHEEL1_DIAMETER_CM', 30.0))
WHEEL2_DIAMETER_CM   = float(os.environ.get('WHEEL2_DIAMETER_CM', 14.0))

# Date (YYYY-MM-DD) from which the new cage configuration (two different-sized
# wheels, renamed sensor positions) took effect.  Data before this date is
# labelled with the original cage terminology in the UI.
CAGE_UPGRADE_DATE = os.environ.get('CAGE_UPGRADE_DATE', '2026-03-15')

# ─── App ───────────────────────────────────────────────────────────────────────

app = Flask(__name__, static_folder='static', template_folder='templates')

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(levelname)s %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S',
)
log = logging.getLogger(__name__)

# ─── ESP32 Data Cache ──────────────────────────────────────────────────────────

CACHE_TTL = 30  # seconds

_esp32_cache = None
_esp32_cache_at = 0.0
_cache_lock = threading.Lock()


def _http_get(url, timeout=3):
    """Fetch *url* and return the trimmed response body; returns ``'0'`` on any error."""
    try:
        resp = requests.get(url, timeout=timeout)
        return resp.text.strip()
    except Exception:
        return '0'


def get_esp32_data(fresh=False):
    """Return cached ESP32 metrics, refreshing the cache when it has expired.

    When *fresh* is ``True`` the cache is bypassed and the ESP32 is queried
    directly.  The result still updates the shared cache so subsequent calls
    with ``fresh=False`` benefit from the latest reading.
    """
    global _esp32_cache, _esp32_cache_at

    with _cache_lock:
        if not fresh and _esp32_cache and (time.monotonic() - _esp32_cache_at) < CACHE_TTL:
            return _esp32_cache

    base = f'http://{ESP32_IP}/d'
    endpoints = [
        'avespeed', 'maxspeed', 'distance1', 'distance2',
        'wheelNumberLast', 'millisnow',
        'motion1count', 'motion2count', 'motion3count',
        'motionLevelLast', 'lastwheelmillis', 'lastmotionmillis',
    ]

    # Fetch all endpoints in parallel so a slow/unresponsive ESP32 only
    # blocks for one timeout duration (3 s) rather than N × 3 s.
    raw = {}
    with ThreadPoolExecutor(max_workers=len(endpoints)) as pool:
        future_to_ep = {pool.submit(_http_get, f'{base}/{ep}'): ep for ep in endpoints}
        for future in as_completed(future_to_ep):
            ep = future_to_ep[future]
            try:
                val = future.result()
                raw[ep] = float(val)
            except Exception as exc:
                log.debug('ESP32 endpoint %s error: %s', ep, exc)
                raw[ep] = 0.0

    # ESP32 is considered online when millisnow returns a positive uptime value.
    raw['esp32Online'] = raw.get('millisnow', 0) > 0

    # lastwheelmillis / lastmotionmillis are elapsed ms since the last event.
    now_ms = time.time() * 1000
    raw['lastWheelTs']       = now_ms - raw.get('lastwheelmillis', 0)
    raw['lastMotionTs']      = now_ms - raw.get('lastmotionmillis', 0)
    raw['lastActiveTs']      = max(raw['lastWheelTs'], raw['lastMotionTs'])
    raw['lastActiveMinsAgo'] = max(0, int((now_ms - raw['lastActiveTs']) / 60_000))

    # Human-readable last-known location.
    if not raw['esp32Online']:
        raw['lastLocation'] = 'offline'
    elif raw.get('lastwheelmillis') == 0 and raw.get('lastmotionmillis') == 0:
        raw['lastLocation'] = 'unknown'
    elif raw.get('lastmotionmillis', 0) < raw.get('lastwheelmillis', float('inf')):
        levels = {1: 'under cover', 2: 'open-space', 3: 'mezzanine'}
        raw['lastLocation'] = levels.get(
            round(raw.get('motionLevelLast', 0)), 'unknown level'
        )
    else:
        wheel_num = round(raw.get('wheelNumberLast', 1))
        raw['lastLocation'] = 'big wheel' if wheel_num == 1 else 'small wheel'

    # Age calculation using a polynomial hamster-year conversion.
    now_dt = datetime.now(timezone.utc)
    diff_sec = (now_dt - BIRTH_DATE).total_seconds()
    secs_per_year = 365.25 * 24 * 3600
    raw['humanYears'] = diff_sec / secs_per_year
    h = raw['humanYears']
    raw['hamsterYears'] = (
        -1.3415 * h ** 4 + 15.678 * h ** 3 - 54.837 * h ** 2 + 92.659 * h + 2.3173
    )

    with _cache_lock:
        _esp32_cache = raw
        _esp32_cache_at = time.monotonic()
    return raw


# ─── CSV Utilities ─────────────────────────────────────────────────────────────

def read_csv(file_path):
    """Parse *file_path* into a list of ``[float, …]`` rows; skips bad lines."""
    rows = []
    try:
        with open(file_path, 'r') as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                parts = line.split(',')
                if len(parts) < 6:
                    continue
                try:
                    row = [float(p) for p in parts]
                    if row[0] > 0:
                        rows.append(row)
                except ValueError:
                    continue
    except OSError:
        pass
    return rows


def list_csv_files():
    """Return daily CSV filenames sorted newest-first (``longtermlog.csv`` excluded)."""
    try:
        return sorted(
            [
                f.name
                for f in CSV_DIR.iterdir()
                if f.name.endswith('.csv') and f.name != 'longtermlog.csv'
            ],
            reverse=True,
        )
    except OSError:
        return []


def get_longterm_summary():
    """Sum every column across all rows of ``longtermlog.csv`` (one row per day)."""
    rows = read_csv(CSV_DIR / 'longtermlog.csv')
    summary = {
        'totalWheel1': 0.0, 'totalWheel2': 0.0,
        'totalMotion1': 0.0, 'totalMotion2': 0.0, 'totalMotion3': 0.0,
    }
    for row in rows:
        if len(row) > 1: summary['totalWheel1']  += row[1]
        if len(row) > 2: summary['totalWheel2']  += row[2]
        if len(row) > 3: summary['totalMotion1'] += row[3]
        if len(row) > 4: summary['totalMotion2'] += row[4]
        if len(row) > 5: summary['totalMotion3'] += row[5]
    return summary


def load_images():
    """Load gallery image metadata from ``images.json`` next to this file."""
    try:
        images_path = Path(__file__).parent / 'images.json'
        with open(images_path, 'r') as fh:
            return json.load(fh)
    except (OSError, json.JSONDecodeError):
        return []


def load_blog_posts():
    """Load blog posts from ``blog.json`` next to this file.

    Posts are sorted newest-first by their ``date`` field.  Each post gains a
    ``paragraphs`` list (the ``content`` string split on blank lines) so the
    template can render each paragraph inside its own ``<p>`` element.
    """
    try:
        blog_path = Path(__file__).parent / 'blog.json'
        with open(blog_path, 'r') as fh:
            posts = json.load(fh)
    except (OSError, json.JSONDecodeError):
        return []

    for post in posts:
        raw = post.get('content', '')
        post['paragraphs'] = [p.strip() for p in raw.split('\n\n') if p.strip()]

    posts.sort(key=lambda p: p.get('date', ''), reverse=True)
    return posts


# ─── Background Poller ─────────────────────────────────────────────────────────

_last_poll_hour = -1

# Per-day maximum and cumulative offset for each of the five logged metrics
# (distance1, distance2, motion1, motion2, motion3).  Tracking these lets the
# poller detect mid-day ESP32 resets (power cut / cage clean) and continue
# accumulating daily totals from where they left off before the reset.
_daily_max    = [0.0, 0.0, 0.0, 0.0, 0.0]
_daily_offset = [0.0, 0.0, 0.0, 0.0, 0.0]


def _correct_wheel_distance(raw_m, actual_diam_cm):
    """Scale an ESP32 wheel distance (metres) to account for a different wheel diameter.

    The ESP32 firmware computes distance by multiplying revolution count by a
    circumference calculated from the hard-coded reference diameter
    (``_ESP32_BASE_DIAM_CM`` = 13.5 cm).  When the physical wheel is larger or
    smaller, the reported metres are proportionally wrong.  This function
    corrects by scaling: ``raw_m × (actual_diam_cm / _ESP32_BASE_DIAM_CM)``.

    Example: big wheel (30 cm) → correction factor 30 / 13.5 ≈ 2.22,
    so 100 m reported by the ESP32 becomes 222 m of true distance.
    """
    return raw_m * (actual_diam_cm / _ESP32_BASE_DIAM_CM)


def _poll_esp32():
    """Fetch the five logged metrics from the ESP32 and append to CSV files.

    The ESP32 reports wheel distances in centimetres (revolution count ×
    circumference in cm).  This function converts them to metres and applies
    a per-wheel correction when the actual wheel diameter differs from the
    firmware's hard-coded reference.

    Mid-day resets (power cut or cage clean) are detected by comparing each
    new reading to the maximum value seen since the last midnight: if a metric
    drops below its previous high the ESP32 was reset, so the previous maximum
    is added to a running offset so that the daily total continues smoothly.

    At midnight (hour wraps from 23 → 0) the final daily reading is also
    appended to ``longtermlog.csv`` and the ESP32 counters are reset.
    """
    global _last_poll_hour, _daily_max, _daily_offset

    CSV_DIR.mkdir(parents=True, exist_ok=True)
    now = datetime.now()
    current_hour = now.hour

    def fetch(ep):
        try:
            return float(
                requests.get(f'http://{ESP32_IP}/d/{ep}', timeout=5).text.strip()
            )
        except Exception:
            return None

    distance1    = fetch('distance1')
    distance2    = fetch('distance2')
    motion1count = fetch('motion1count')
    motion2count = fetch('motion2count')
    motion3count = fetch('motion3count')

    if any(v is None for v in [distance1, distance2, motion1count, motion2count, motion3count]):
        log.warning('Poll skipped – one or more ESP32 endpoints did not respond')
        return

    # ── Mid-day reset detection ────────────────────────────────────────────────
    # The ESP32 counters are cumulative within a day.  If any metric drops
    # below its previously recorded maximum, the device was reset mid-day.
    # Accumulate the previous maximum into the offset so the daily total
    # continues from where it left off.
    raw_vals = [distance1, distance2, motion1count, motion2count, motion3count]
    for i, raw in enumerate(raw_vals):
        if raw < _daily_max[i]:
            log.info(
                'Mid-day ESP32 reset detected on metric %d '
                '(dropped %.2f → %.2f); accumulating offset %.2f',
                i, _daily_max[i], raw, _daily_max[i],
            )
            _daily_offset[i] += _daily_max[i]
            _daily_max[i] = 0.0
        _daily_max[i] = max(_daily_max[i], raw)

    # Effective cumulative values for today (raw + accumulated offset)
    eff_d1, eff_d2, eff_m1, eff_m2, eff_m3 = (
        raw_vals[i] + _daily_offset[i] for i in range(5)
    )

    # ── Diameter correction ────────────────────────────────────────────────────
    # The ESP32 reports distances in metres, computed using its hard-coded 13.5 cm
    # reference diameter.  Apply a proportional correction for each wheel's
    # actual diameter.  Motion counts are already in seconds; no conversion needed.
    d1_m = _correct_wheel_distance(eff_d1, WHEEL1_DIAMETER_CM)
    d2_m = _correct_wheel_distance(eff_d2, WHEEL2_DIAMETER_CM)
    m1_s = eff_m1   # motion counts are already in seconds
    m2_s = eff_m2
    m3_s = eff_m3

    ts  = time.time()
    row = f'{ts},{d1_m},{d2_m},{m1_s},{m2_s},{m3_s}\n'

    if _last_poll_hour != -1 and current_hour < _last_poll_hour:
        # Midnight has just passed – persist yesterday's final values in both logs.
        yesterday = (now - timedelta(days=1)).strftime('%Y%m%d')
        with open(CSV_DIR / f'{yesterday}.csv', 'a') as fh:
            fh.write(row)
        with open(CSV_DIR / 'longtermlog.csv', 'a') as fh:
            fh.write(row)
        try:
            requests.get(f'http://{ESP32_IP}/reset', timeout=5)
            log.info('Midnight: ESP32 counters reset for new day')
        except Exception as exc:
            log.warning('Failed to reset ESP32 at midnight: %s', exc)
        # Reset daily tracking for the new day
        _daily_max    = [0.0, 0.0, 0.0, 0.0, 0.0]
        _daily_offset = [0.0, 0.0, 0.0, 0.0, 0.0]
    else:
        with open(CSV_DIR / now.strftime('%Y%m%d.csv'), 'a') as fh:
            fh.write(row)

    _last_poll_hour = current_hour
    log.debug(
        'Poll OK: d1=%.4fm d2=%.4fm m1=%.2fs m2=%.2fs m3=%.2fs',
        d1_m, d2_m, m1_s, m2_s, m3_s,
    )


def _poller_loop():
    """Daemon thread: poll ESP32 indefinitely, sleeping 30 s between each poll."""
    log.info('Poller started – polling http://%s every 30 s', ESP32_IP)
    while True:
        try:
            _poll_esp32()
        except Exception as exc:
            log.error('Unexpected poll error: %s', exc)
        time.sleep(30)


# ─── Web Routes ────────────────────────────────────────────────────────────────

@app.route('/')
def index():
    esp32 = get_esp32_data()
    lt = get_longterm_summary()
    images = load_images()

    today_dist = esp32.get('distance1', 0) + esp32.get('distance2', 0)
    total_dist = lt['totalWheel1'] + lt['totalWheel2'] + today_dist
    last_ts = esp32.get('lastActiveTs', time.time() * 1000) / 1000
    last_active_time = datetime.fromtimestamp(last_ts).strftime('%H:%M:%S')
    today_motion = (
        esp32.get('motion1count', 0)
        + esp32.get('motion2count', 0)
        + esp32.get('motion3count', 0)
    )

    return render_template(
        'index.html',
        esp32=esp32,
        lt_summary=lt,
        images=images,
        today_dist_km=f'{today_dist / 1000:.2f}',
        total_dist_km=f'{total_dist / 1000:.2f}',
        today_dist_mi=f'{today_dist * 0.000621371:.2f}',
        total_dist_mi=f'{total_dist * 0.000621371:.2f}',
        last_active_time=last_active_time,
        today_motion=f'{today_motion:.1f}',
        has_history=(lt['totalWheel1'] + lt['totalWheel2']) > 0,
    )


@app.route('/analytics')
def analytics():
    return render_template('analytics.html')


@app.route('/blog')
def blog():
    return render_template('blog.html', posts=load_blog_posts())


@app.route('/kindle')
def kindle():
    esp32 = get_esp32_data()
    lt = get_longterm_summary()

    # Read today's intraday CSV for persistent distance/motion totals.
    # Unlike the ESP32's in-memory counters, the CSV survives a power loss or
    # reboot, so the "Today" figures remain accurate after an ESP32 reset.
    today_str = datetime.now().strftime('%Y%m%d')
    csv_rows = read_csv(CSV_DIR / f'{today_str}.csv')
    if csv_rows:
        first, last = csv_rows[0], csv_rows[-1]
        today_wheel1  = max(0.0, last[1] - first[1])
        today_wheel2  = max(0.0, last[2] - first[2])
        today_motion1 = max(0.0, last[3] - first[3])
        today_motion2 = max(0.0, last[4] - first[4])
        today_motion3 = max(0.0, last[5] - first[5])
    else:
        # Before the first CSV poll of the day, fall back to live ESP32 values.
        today_wheel1  = esp32.get('distance1', 0.0)
        today_wheel2  = esp32.get('distance2', 0.0)
        today_motion1 = esp32.get('motion1count', 0.0)
        today_motion2 = esp32.get('motion2count', 0.0)
        today_motion3 = esp32.get('motion3count', 0.0)

    today_dist = today_wheel1 + today_wheel2
    total_dist = lt['totalWheel1'] + lt['totalWheel2'] + today_dist
    last_ts = esp32.get('lastActiveTs', time.time() * 1000) / 1000
    return render_template(
        'kindle.html',
        esp32=esp32,
        lt_summary=lt,
        today_wheel1=today_wheel1,
        today_wheel2=today_wheel2,
        today_motion1=today_motion1,
        today_motion2=today_motion2,
        today_motion3=today_motion3,
        today_dist=today_dist,
        total_dist=total_dist,
        today_mi=f'{today_dist * 0.000621371:.3f}',
        total_mi=f'{total_dist * 0.000621371:.3f}',
        last_time=datetime.fromtimestamp(last_ts).strftime('%H:%M:%S'),
        now_str=datetime.now().strftime('%d/%m/%Y %H:%M:%S'),
    )


@app.route('/live-status')
def live_status():
    return render_template('live_status.html')


@app.route('/api/live')
def api_live():
    try:
        return jsonify(get_esp32_data())
    except Exception:
        return jsonify({'error': 'ESP32 unavailable'}), 503


@app.route('/api/live-now')
def api_live_now():
    """Return a fresh (non-cached) snapshot of current ESP32 metrics.

    Unlike ``/api/live`` this endpoint always queries the ESP32 directly so
    that the live-status page can display near-real-time wheel speed and RPM.
    """
    try:
        return jsonify(get_esp32_data(fresh=True))
    except Exception:
        return jsonify({'error': 'ESP32 unavailable'}), 503


@app.route('/api/csv-files')
def api_csv_files():
    return jsonify(list_csv_files())


@app.route('/api/csv-data')
def api_csv_data():
    file = request.args.get('file')
    from_date = request.args.get('from')
    to_date = request.args.get('to')

    # Prevent path traversal by allowing only safe filenames.
    if file and not re.match(r'^[\w-]+\.csv$', file):
        return jsonify({'error': 'Invalid file name'}), 400

    if file:
        rows = read_csv(CSV_DIR / file)
        is_longterm = file == 'longtermlog.csv'
        return jsonify({
            'type': 'longterm' if is_longterm else 'intraday',
            'rows': rows,
            'file': file,
        })

    rows = read_csv(CSV_DIR / 'longtermlog.csv')
    if from_date or to_date:
        try:
            from_ts = (
                datetime.strptime(from_date, '%Y-%m-%d').timestamp()
                if from_date else 0
            )
            to_ts = (
                datetime.strptime(to_date, '%Y-%m-%d').timestamp() + 86400
                if to_date else float('inf')
            )
        except ValueError:
            return jsonify({'error': 'Invalid date format – use YYYY-MM-DD'}), 400
        rows = [r for r in rows if from_ts <= r[0] <= to_ts]

    return jsonify({'type': 'longterm', 'rows': rows})


@app.route('/api/stats')
def api_stats():
    """Compute descriptive and trend statistics for the requested date range.

    Query parameters:
      from – start date YYYY-MM-DD (longterm range; ignored when ``file`` is set)
      to   – end   date YYYY-MM-DD (longterm range; ignored when ``file`` is set)
      file – specific daily CSV filename (triggers intraday statistics instead)

    **Longterm response** (one row = one day):
      type, n, activeDays, distanceStats, motionStats, trend, rolling,
      bestDay, worstDay, maxStreak, currentStreak, dowLabels, dowAvgDist,
      wheelRatio, floorRatio

    **Intraday response** (one row = one 30-second poll):
      type, n, distanceStats, motionStats, peakDistHour, peakMotionHour,
      hourlyDist, hourlyMotion
    """
    file_param    = request.args.get('file')
    from_date_str = request.args.get('from')
    to_date_str   = request.args.get('to')

    if file_param and not re.match(r'^[\w-]+\.csv$', file_param):
        return jsonify({'error': 'Invalid file name'}), 400

    # ── Helper: descriptive statistics ────────────────────────────────────────
    def _stats(values):
        if not values:
            return {}
        n_v  = len(values)
        s    = sorted(values)
        mean = sum(values) / n_v
        var  = sum((v - mean) ** 2 for v in values) / n_v if n_v > 1 else 0.0
        std  = var ** 0.5

        def pct(p):
            idx = p / 100 * (n_v - 1)
            lo  = int(idx)
            hi  = min(lo + 1, n_v - 1)
            return s[lo] + (idx - lo) * (s[hi] - s[lo])

        return {
            'mean':   round(mean, 3),
            'median': round(pct(50), 3),
            'std':    round(std, 3),
            'cv':     round(std / mean if mean > 0 else 0, 4),
            'min':    round(s[0], 3),
            'max':    round(s[-1], 3),
            'p25':    round(pct(25), 3),
            'p75':    round(pct(75), 3),
            'p95':    round(pct(95), 3),
        }

    # ── Helper: ordinary least-squares linear regression ──────────────────────
    def _linreg(ys):
        n_v = len(ys)
        if n_v < 2:
            return 0.0, (ys[0] if ys else 0.0), 0.0
        xm    = (n_v - 1) / 2.0
        ym    = sum(ys) / n_v
        num   = sum((i - xm) * (ys[i] - ym) for i in range(n_v))
        den_x = sum((i - xm) ** 2 for i in range(n_v))
        den_y = sum((v - ym)  ** 2 for v in ys)
        if den_x == 0:
            return 0.0, ym, 0.0
        slope = num / den_x
        r_sq  = (num ** 2) / (den_x * den_y) if den_y > 0 else 0.0
        return round(slope, 4), round(ym - slope * xm, 4), round(r_sq, 4)

    # ── Helper: rolling average series ────────────────────────────────────────
    def _rolling(values, window):
        out = []
        for i, _ in enumerate(values):
            chunk = values[max(0, i - window + 1): i + 1]
            out.append(round(sum(chunk) / len(chunk), 3))
        return out

    # ══════════════════════════════════════════════════════════════════════════
    # Intraday statistics (single daily CSV file)
    # ══════════════════════════════════════════════════════════════════════════
    if file_param and file_param != 'longtermlog.csv':
        rows = read_csv(CSV_DIR / file_param)
        if not rows:
            return jsonify({'type': 'intraday', 'n': 0}), 200

        deltas_dist   = []
        deltas_motion = []
        hourly_dist   = [0.0] * 24
        hourly_motion = [0.0] * 24
        speeds_kmh        = []   # speed (km/h) for each interval where dist > 0
        speed_timestamps  = []   # unix timestamps for those intervals
        time_on_wheel     = 0.0  # total seconds the hamster spent running

        for i in range(1, len(rows)):
            prev, curr = rows[i - 1], rows[i]
            delta_t = curr[0] - prev[0]
            d = (max(0.0, (curr[1] or 0) - (prev[1] or 0))
                 + max(0.0, (curr[2] or 0) - (prev[2] or 0)))
            m = (max(0.0, (curr[3] or 0) - (prev[3] or 0))
                 + max(0.0, (curr[4] or 0) - (prev[4] or 0))
                 + max(0.0, (curr[5] or 0) - (prev[5] or 0)))
            deltas_dist.append(d)
            deltas_motion.append(m)
            hour = datetime.fromtimestamp(curr[0]).hour
            hourly_dist[hour]   += d
            hourly_motion[hour] += m
            # Only compute speed for genuine polling intervals (≥ 2 s).
            # Near-duplicate row pairs (delta_t < 2 s) are a logging artefact
            # and would produce unrealistically high speed readings.
            if d > 0 and delta_t >= 2.0:
                speeds_kmh.append(round(d / delta_t * 3.6, 4))
                speed_timestamps.append(int(curr[0]))
                time_on_wheel += delta_t

        peak_dist_h   = hourly_dist.index(max(hourly_dist))
        peak_motion_h = hourly_motion.index(max(hourly_motion))

        # Speed trend within this session (linear regression on ordered speeds)
        speed_slope, _, speed_r2 = (
            _linreg(speeds_kmh) if len(speeds_kmh) >= 2 else (0.0, 0.0, 0.0)
        )

        # Wheel and floor ratios for the day
        first_row = rows[0]
        last_row  = rows[-1]
        iw1 = max(0.0, (last_row[1] if len(last_row) > 1 else 0) - (first_row[1] if len(first_row) > 1 else 0))
        iw2 = max(0.0, (last_row[2] if len(last_row) > 2 else 0) - (first_row[2] if len(first_row) > 2 else 0))
        im1 = max(0.0, (last_row[3] if len(last_row) > 3 else 0) - (first_row[3] if len(first_row) > 3 else 0))
        im2 = max(0.0, (last_row[4] if len(last_row) > 4 else 0) - (first_row[4] if len(first_row) > 4 else 0))
        im3 = max(0.0, (last_row[5] if len(last_row) > 5 else 0) - (first_row[5] if len(first_row) > 5 else 0))
        itw = iw1 + iw2
        itm = im1 + im2 + im3

        # Determine label set: files before the cage upgrade use legacy terminology.
        file_date_str = file_param[:8]  # YYYYMMDD from filename
        label_set = 'legacy' if file_date_str < CAGE_UPGRADE_DATE.replace('-', '') else 'current'

        return jsonify({
            'type':           'intraday',
            'n':              len(deltas_dist),
            'labelSet':       label_set,
            'distanceStats':  _stats(deltas_dist),
            'motionStats':    _stats(deltas_motion),
            'peakDistHour':   peak_dist_h,
            'peakMotionHour': peak_motion_h,
            'hourlyDist':     [round(v, 3) for v in hourly_dist],
            'hourlyMotion':   [round(v, 3) for v in hourly_motion],
            # Speed analytics
            'speedStats':      _stats(speeds_kmh) if speeds_kmh else {},
            'speedTrend':      {'slope': speed_slope, 'r2': speed_r2},
            'speedTimestamps': speed_timestamps,
            'speedValues':     speeds_kmh,
            'timeOnWheel':     round(time_on_wheel, 1),
            # Wheel & floor ratios (same structure as longterm)
            'wheelRatio': {
                'wheel1':    round(iw1, 2),
                'wheel2':    round(iw2, 2),
                'wheel1Pct': round(iw1 / itw * 100, 1) if itw > 0 else 50.0,
                'wheel2Pct': round(iw2 / itw * 100, 1) if itw > 0 else 50.0,
            },
            'floorRatio': {
                'underCover':    round(im1, 2),
                'openSpace':     round(im2, 2),
                'mezzanine':     round(im3, 2),
                'underCoverPct': round(im1 / itm * 100, 1) if itm > 0 else 33.3,
                'openSpacePct':  round(im2 / itm * 100, 1) if itm > 0 else 33.3,
                'mezzaninePct':  round(im3 / itm * 100, 1) if itm > 0 else 33.3,
            },
        })

    # ══════════════════════════════════════════════════════════════════════════
    # Long-term statistics (longtermlog.csv, one row per day)
    # ══════════════════════════════════════════════════════════════════════════
    rows = read_csv(CSV_DIR / 'longtermlog.csv')

    if from_date_str or to_date_str:
        try:
            from_ts = (
                datetime.strptime(from_date_str, '%Y-%m-%d').timestamp()
                if from_date_str else 0
            )
            to_ts = (
                datetime.strptime(to_date_str, '%Y-%m-%d').timestamp() + 86400
                if to_date_str else float('inf')
            )
        except ValueError:
            return jsonify({'error': 'Invalid date format – use YYYY-MM-DD'}), 400
        rows = [r for r in rows if from_ts <= r[0] <= to_ts]

    if not rows:
        return jsonify({'type': 'longterm', 'n': 0}), 200

    n           = len(rows)
    timestamps  = [r[0]                    for r in rows]
    w1          = [r[1] if len(r) > 1 else 0.0 for r in rows]
    w2          = [r[2] if len(r) > 2 else 0.0 for r in rows]
    m1          = [r[3] if len(r) > 3 else 0.0 for r in rows]
    m2          = [r[4] if len(r) > 4 else 0.0 for r in rows]
    m3          = [r[5] if len(r) > 5 else 0.0 for r in rows]
    total_dist  = [w1[i] + w2[i]          for i in range(n)]
    total_mot   = [m1[i] + m2[i] + m3[i] for i in range(n)]

    slope_d, _, r2_d = _linreg(total_dist)
    slope_m, _, r2_m = _linreg(total_mot)

    roll7  = _rolling(total_dist, 7)
    roll30 = _rolling(total_dist, 30)

    max_idx = max(range(n), key=lambda i: total_dist[i])
    active  = [(total_dist[i], i) for i in range(n) if total_dist[i] > 0]
    min_idx = min(active, key=lambda x: x[0])[1] if active else 0

    # Streaks
    max_streak = cur = 0
    for v in total_dist:
        if v > 0:
            cur += 1
            max_streak = max(max_streak, cur)
        else:
            cur = 0
    current_streak = 0
    for v in reversed(total_dist):
        if v > 0:
            current_streak += 1
        else:
            break

    # Day-of-week averages (0 = Monday … 6 = Sunday)
    dow_labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    dow_sum    = [0.0] * 7
    dow_cnt    = [0]   * 7
    for i, ts in enumerate(timestamps):
        d = datetime.fromtimestamp(ts).weekday()
        dow_sum[d] += total_dist[i]
        dow_cnt[d] += 1
    dow_avg = [
        round(dow_sum[d] / dow_cnt[d], 3) if dow_cnt[d] else 0.0
        for d in range(7)
    ]

    # Wheel & floor ratios
    tw1 = sum(w1); tw2 = sum(w2); tw = tw1 + tw2
    tm1 = sum(m1); tm2 = sum(m2); tm3 = sum(m3); tm = tm1 + tm2 + tm3

    return jsonify({
        'type':        'longterm',
        'n':           n,
        'labelSet':    'current',
        'activeDays':  sum(1 for v in total_dist if v > 0),
        'distanceStats': _stats(total_dist),
        'motionStats':   _stats(total_mot),
        'trend': {
            'distSlope':   slope_d,
            'distR2':      r2_d,
            'motionSlope': slope_m,
            'motionR2':    r2_m,
        },
        'rolling': {
            'labels': [
                datetime.fromtimestamp(ts).strftime('%Y-%m-%d')
                for ts in timestamps
            ],
            'dist7':  roll7,
            'dist30': roll30,
        },
        'bestDay': {
            'date': datetime.fromtimestamp(timestamps[max_idx]).strftime('%Y-%m-%d'),
            'dist': round(total_dist[max_idx], 2),
        },
        'worstDay': {
            'date': datetime.fromtimestamp(timestamps[min_idx]).strftime('%Y-%m-%d'),
            'dist': round(total_dist[min_idx], 2),
        },
        'maxStreak':     max_streak,
        'currentStreak': current_streak,
        'dowLabels':     dow_labels,
        'dowAvgDist':    dow_avg,
        'wheelRatio': {
            'wheel1':    round(tw1, 2),
            'wheel2':    round(tw2, 2),
            'wheel1Pct': round(tw1 / tw * 100, 1) if tw > 0 else 50.0,
            'wheel2Pct': round(tw2 / tw * 100, 1) if tw > 0 else 50.0,
        },
        'floorRatio': {
            'underCover':    round(tm1, 2),
            'openSpace':     round(tm2, 2),
            'mezzanine':     round(tm3, 2),
            'underCoverPct': round(tm1 / tm * 100, 1) if tm > 0 else 33.3,
            'openSpacePct':  round(tm2 / tm * 100, 1) if tm > 0 else 33.3,
            'mezzaninePct':  round(tm3 / tm * 100, 1) if tm > 0 else 33.3,
        },
    })


@app.route('/api/heatmap')
def api_heatmap():
    """Return heatmap data: activity/distance per 30-minute slot per day.

    Query parameters:
      from   – start date YYYY-MM-DD (default: 30 days ago)
      to     – end   date YYYY-MM-DD (default: today)
      metric – 'distance' or 'activity' (default: 'distance')

    Response JSON:
      dates  – list of date strings (X-axis, one per column)
      slots  – list of 48 time-of-day labels centred around midnight (Y-axis)
      matrix – 2-D list [slot_index][date_index] with aggregated values
      maxVal – maximum cell value (for client-side colour scaling)
      metric – the requested metric
    """
    from_date_str = request.args.get('from')
    to_date_str   = request.args.get('to')
    metric        = request.args.get('metric', 'distance')

    if metric not in ('distance', 'activity'):
        return jsonify({'error': 'metric must be "distance" or "activity"'}), 400

    try:
        today = datetime.now().date()
        from_date = (
            datetime.strptime(from_date_str, '%Y-%m-%d').date()
            if from_date_str else today - timedelta(days=29)
        )
        to_date = (
            datetime.strptime(to_date_str, '%Y-%m-%d').date()
            if to_date_str else today
        )
    except ValueError:
        return jsonify({'error': 'Invalid date format – use YYYY-MM-DD'}), 400

    if from_date > to_date:
        return jsonify({'error': 'from date must be ≤ to date'}), 400

    # Build list of all dates in range
    dates = []
    d = from_date
    while d <= to_date:
        dates.append(d)
        d += timedelta(days=1)

    # 48 half-hour slots centred around midnight:
    #   slot 0  = 12:00  slot 23 = 23:30
    #   slot 24 = 00:00  slot 47 = 11:30
    NUM_SLOTS = 48
    matrix = [[0.0] * len(dates) for _ in range(NUM_SLOTS)]

    for date_idx, date in enumerate(dates):
        fname = date.strftime('%Y%m%d.csv')
        rows  = read_csv(CSV_DIR / fname)
        for i in range(1, len(rows)):
            prev = rows[i - 1]
            curr = rows[i]
            ts   = curr[0]
            dt   = datetime.fromtimestamp(ts)
            mins_from_midnight = dt.hour * 60 + dt.minute
            # Rotate so that noon (720 min) maps to slot 0
            mins_from_noon = (mins_from_midnight - 720 + 1440) % 1440
            slot = int(mins_from_noon // 30)
            if metric == 'distance':
                val = (
                    max(0.0, (curr[1] or 0) - (prev[1] or 0))
                    + max(0.0, (curr[2] or 0) - (prev[2] or 0))
                )
            else:  # activity
                val = (
                    max(0.0, (curr[3] or 0) - (prev[3] or 0))
                    + max(0.0, (curr[4] or 0) - (prev[4] or 0))
                    + max(0.0, (curr[5] or 0) - (prev[5] or 0))
                )
            matrix[slot][date_idx] += val

    # Slot labels: derive the clock time each slot represents
    slots = []
    for i in range(NUM_SLOTS):
        mins_from_midnight = (i * 30 + 720) % 1440
        h = mins_from_midnight // 60
        m = mins_from_midnight % 60
        slots.append(f'{h:02d}:{m:02d}')

    max_val = max((v for row in matrix for v in row), default=0.0)

    return jsonify({
        'dates':  [d.strftime('%Y-%m-%d') for d in dates],
        'slots':  slots,
        'matrix': matrix,
        'maxVal': max_val,
        'metric': metric,
    })


@app.route('/api/images')
def api_images():
    return jsonify(load_images())


@app.route('/api/config')
def api_config():
    """Return the current wheel-size and cage configuration.

    This lets clients verify which wheel diameters are active and which date
    marks the boundary between legacy (old cage) and current labelling.

    Response JSON:
      wheel1DiameterCm    – configured diameter for wheel 1 / big wheel (cm)
      wheel2DiameterCm    – configured diameter for wheel 2 / small wheel (cm)
      wheel1CircumfM      – circumference for wheel 1 (metres)
      wheel2CircumfM      – circumference for wheel 2 (metres)
      esp32BaseDiameterCm – reference diameter hard-coded in ESP32 firmware (cm)
      upgradeDate         – YYYY-MM-DD from which the new cage config applies;
                            analytics data before this date uses legacy labels
    """
    w1_c = math.pi * WHEEL1_DIAMETER_CM
    w2_c = math.pi * WHEEL2_DIAMETER_CM
    return jsonify({
        'wheel1DiameterCm':    WHEEL1_DIAMETER_CM,
        'wheel2DiameterCm':    WHEEL2_DIAMETER_CM,
        'wheel1CircumfM':      round(w1_c / 100, 6),
        'wheel2CircumfM':      round(w2_c / 100, 6),
        'esp32BaseDiameterCm': _ESP32_BASE_DIAM_CM,
        'upgradeDate':         CAGE_UPGRADE_DATE,
    })


@app.route('/api/status')
def api_status():
    longterm_path = CSV_DIR / 'longtermlog.csv'
    longterm_exists = longterm_path.exists()
    longterm_rows = len(read_csv(longterm_path)) if longterm_exists else 0
    daily_files = list_csv_files()
    with _cache_lock:
        cache_age = (
            (time.monotonic() - _esp32_cache_at) * 1000 if _esp32_cache else None
        )
        cached = _esp32_cache is not None
    return jsonify({
        'longtermlogExists': longterm_exists,
        'longtermlogRows': longterm_rows,
        'dailyFileCount': len(daily_files),
        'cacheAgeMs': cache_age,
        'esp32Cached': cached,
    })


# ─── Entry Point ───────────────────────────────────────────────────────────────

if __name__ == '__main__':
    poller = threading.Thread(target=_poller_loop, daemon=True, name='esp32-poller')
    poller.start()
    log.info('Starting Hamster Monitor on port %d', PORT)
    app.run(host='0.0.0.0', port=PORT, debug=False)
