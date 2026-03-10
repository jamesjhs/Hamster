#!/usr/bin/env python3
"""Hamster Monitor – PythonServer.

Combines two responsibilities in one process:

1. **Data logger** – a background thread polls all ESP32 endpoints every 30
   seconds and appends readings to per-day CSV files.  At midnight the final
   readings are also written to ``longtermlog.csv`` and the ESP32 counters are
   reset to zero.

2. **Web server** – a Flask application serves three pages (home, analytics,
   Kindle) and a small JSON API consumed by the analytics page.

Usage::

    python server.py

Configuration via environment variables:

``PORT``      HTTP port (default ``4000``)
``ESP32_IP``  ESP32 device IP address (default ``192.168.1.98``)
``CSV_DIR``   Directory for CSV log files (default ``/var/hamsterlogger``)
"""

import json
import logging
import os
import re
import time
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
from flask import Flask, jsonify, render_template, request

# ─── Configuration ─────────────────────────────────────────────────────────────

PORT       = int(os.environ.get('PORT', 4000))
ESP32_IP   = os.environ.get('ESP32_IP', '192.168.1.98')
CSV_DIR    = Path(os.environ.get('CSV_DIR', '/var/hamsterlogger'))
BIRTH_DATE = datetime(2025, 9, 7, tzinfo=timezone.utc)

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


def get_esp32_data():
    """Return cached ESP32 metrics, refreshing the cache when it has expired."""
    global _esp32_cache, _esp32_cache_at

    with _cache_lock:
        if _esp32_cache and (time.monotonic() - _esp32_cache_at) < CACHE_TTL:
            return _esp32_cache

    base = f'http://{ESP32_IP}/d'
    endpoints = [
        'avespeed', 'maxspeed', 'distance1', 'distance2',
        'wheelNumberLast', 'millisnow',
        'motion1count', 'motion2count', 'motion3count',
        'motionLevelLast', 'lastwheelmillis', 'lastmotionmillis',
    ]

    raw = {}
    for ep in endpoints:
        val = _http_get(f'{base}/{ep}')
        try:
            raw[ep] = float(val)
        except ValueError:
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
        levels = {1: 'ground level', 2: 'middle level', 3: 'top level'}
        raw['lastLocation'] = levels.get(
            round(raw.get('motionLevelLast', 0)), 'unknown level'
        )
    else:
        wheel_num = round(raw.get('wheelNumberLast', 1))
        raw['lastLocation'] = 'wheel 1 (bottom)' if wheel_num == 1 else 'wheel 2 (top)'

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


# ─── Background Poller ─────────────────────────────────────────────────────────

_last_poll_hour = -1


def _poll_esp32():
    """Fetch the five logged metrics from the ESP32 and append to CSV files.

    At midnight (hour wraps from 23 → 0) the final daily reading is also
    appended to ``longtermlog.csv`` and the ESP32 counters are reset.
    """
    global _last_poll_hour

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

    ts = time.time()
    row = f'{ts},{distance1},{distance2},{motion1count},{motion2count},{motion3count}\n'

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
    else:
        with open(CSV_DIR / now.strftime('%Y%m%d.csv'), 'a') as fh:
            fh.write(row)

    _last_poll_hour = current_hour
    log.debug(
        'Poll OK: d1=%s d2=%s m1=%s m2=%s m3=%s',
        distance1, distance2, motion1count, motion2count, motion3count,
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


@app.route('/kindle')
def kindle():
    esp32 = get_esp32_data()
    lt = get_longterm_summary()
    today_dist = esp32.get('distance1', 0) + esp32.get('distance2', 0)
    total_dist = lt['totalWheel1'] + lt['totalWheel2'] + today_dist
    last_ts = esp32.get('lastActiveTs', time.time() * 1000) / 1000
    return render_template(
        'kindle.html',
        esp32=esp32,
        lt_summary=lt,
        today_dist=today_dist,
        total_dist=total_dist,
        today_mi=f'{today_dist * 0.000621371:.3f}',
        total_mi=f'{total_dist * 0.000621371:.3f}',
        last_time=datetime.fromtimestamp(last_ts).strftime('%H:%M:%S'),
        now_str=datetime.now().strftime('%d/%m/%Y %H:%M:%S'),
    )


@app.route('/api/live')
def api_live():
    try:
        return jsonify(get_esp32_data())
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


@app.route('/api/images')
def api_images():
    return jsonify(load_images())


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
        'csvDir': str(CSV_DIR),
        'longtermlogExists': longterm_exists,
        'longtermlogRows': longterm_rows,
        'dailyFileCount': len(daily_files),
        'dailyFiles': daily_files,
        'esp32Ip': ESP32_IP,
        'cacheAgeMs': cache_age,
        'esp32Cached': cached,
    })


# ─── Entry Point ───────────────────────────────────────────────────────────────

if __name__ == '__main__':
    poller = threading.Thread(target=_poller_loop, daemon=True, name='esp32-poller')
    poller.start()
    log.info('Starting Hamster Monitor on port %d', PORT)
    app.run(host='0.0.0.0', port=PORT, debug=False)
