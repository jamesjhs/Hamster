# Python Server – Setup Guide

This folder contains a self-contained Python application that replaces both
the NAS PHP gateway and the Node.js web server, reducing the stack to just
**ESP32 → Raspberry Pi (Python)**.

## What it does

| Responsibility | Detail |
|---|---|
| **Data logger** | Background thread polls all ESP32 sensor endpoints every **30 seconds** and appends a CSV row to a per-day log file |
| **Midnight reset** | At midnight the final daily reading is also written to `longtermlog.csv` and the ESP32 counters are reset to zero |
| **Web server** | Flask app serves the dashboard on port 4000 (or `$PORT`) |

### Pages

| URL | Description |
|---|---|
| `/` | Live monitor – current stats, age, photo gallery |
| `/analytics` | Charts and data table with date-range filtering |
| `/kindle` | Plain HTML page, no JavaScript, auto-refreshes every 60 s |

### JSON API

| Endpoint | Returns |
|---|---|
| `/api/live` | Live ESP32 data (all metrics + derived fields) |
| `/api/csv-files` | List of available daily CSV filenames |
| `/api/csv-data?file=YYYYMMDD.csv` | Rows from a specific daily file |
| `/api/csv-data?from=YYYY-MM-DD&to=YYYY-MM-DD` | Date-filtered long-term log rows |
| `/api/images` | Gallery image metadata from `images.json` |
| `/api/status` | System health (CSV path, file counts, cache age) |

---

## Requirements

- Python 3.9 or later
- Network access to the ESP32 (default IP `192.168.1.98`)

---

## Installation

```bash
cd "Python Server"

# (Recommended) Create a virtual environment
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt
```

---

## Configuration

All settings are controlled by environment variables so the script can be
started without modifying source code.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4000` | HTTP listening port |
| `ESP32_IP` | `192.168.1.98` | IP address of the ESP32 on the local network |
| `CSV_DIR` | `/var/hamsterlogger` | Directory where CSV log files are read and written |

Example:

```bash
export ESP32_IP=192.168.1.98
export CSV_DIR=/home/pi/hamsterdata
export PORT=4000
```

---

## Running

```bash
python server.py
```

The server starts immediately.  The background poller thread fires its first
poll right away and then every 30 seconds.  Logs are printed to stdout.

### Running as a service (systemd)

Create `/etc/systemd/system/hamster.service`:

```ini
[Unit]
Description=Hamster Monitor
After=network.target

[Service]
User=pi
WorkingDirectory=/home/pi/Hamster/Python Server
Environment=ESP32_IP=192.168.1.98
Environment=CSV_DIR=/var/hamsterlogger
Environment=PORT=4000
ExecStart=/home/pi/Hamster/Python Server/.venv/bin/python server.py
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable hamster
sudo systemctl start hamster
sudo journalctl -u hamster -f   # follow logs
```

---

## Photo Gallery

1. Place full-size photos in `static/images/`
2. Place thumbnail images in `static/images/thumbs/`
3. Edit `images.json` to add entries:

```json
[
  {
    "filename": "chocolate-nest.jpg",
    "thumb": "thumbs/chocolate-nest-thumb.jpg",
    "description": "Chocolate peeking out of his nest",
    "date": "2025-09-07"
  }
]
```

---

## CSV File Format

Each row written by the data logger:

```
<unix_timestamp>,<distance1_m>,<distance2_m>,<motion1count_s>,<motion2count_s>,<motion3count_s>
```

Daily files are named `YYYYMMDD.csv`; the cumulative file is `longtermlog.csv`.
Both files are created automatically in `CSV_DIR` when the logger first runs.
