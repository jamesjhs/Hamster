# Hamster Monitor – Deployment Guide

A Node.js/Express app that replaces the old PHP/NAS gateway stack.  
It runs directly on the **Raspberry Pi** ("motion") and serves  
**https://hamster.jahosi.co.uk** on port 4000.

---

## Requirements

| Component | Version |
|-----------|---------|
| Node.js   | ≥ 18    |
| npm       | ≥ 9     |
| nginx     | any     |

---

## Quick Start

### 1 – Copy files to the Pi

```bash
# On the Pi, as root or a user with write access:
sudo mkdir -p /var/node/cert
sudo cp -r "Node.js App/"* /var/node/cert/
```

### 2 – Install dependencies

```bash
cd /var/node/cert
npm install --omit=dev
```

### 3 – SSL certificates

The server expects these files in `/var/node/cert` (same directory as `server.js`):

| File          | Purpose          |
|---------------|------------------|
| `cert.pem`    | SSL certificate  |
| `privkey.pem` | SSL private key  |

These are typically issued by **Let's Encrypt** via Certbot.  
If the certs are not present, the server falls back to plain HTTP on port 4000 (useful during development).

Override the cert location with the `CERT_DIR` environment variable.

### 4 – Environment variables (optional)

| Variable   | Default                        | Description                              |
|------------|--------------------------------|------------------------------------------|
| `PORT`     | `4000`                         | Listening port                           |
| `ESP32_IP` | `192.168.1.98`                 | IP address of the ESP32 chip             |
| `CSV_DIR`  | `/var/www/html/hamsterlogger`  | Directory containing the CSV data files  |
| `CERT_DIR` | same directory as `server.js`  | Directory containing `cert.pem`/`privkey.pem` |

Create a `.env`-style file or pass them inline:

```bash
ESP32_IP=192.168.1.98 CSV_DIR=/var/www/html/hamsterlogger node server.js
```

### 5 – Run with PM2 (recommended)

```bash
sudo npm install -g pm2
pm2 start server.js --name hamster-monitor \
     --env production \
     -e /var/log/hamster-err.log \
     -o /var/log/hamster-out.log
pm2 save
pm2 startup   # follow the printed command to enable on boot
```

### 6 – nginx reverse proxy (port 443 → 4000)

Add this server block to `/etc/nginx/sites-available/hamster`:

```nginx
server {
    listen 80;
    server_name hamster.jahosi.co.uk;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name hamster.jahosi.co.uk;

    ssl_certificate     /var/node/cert/cert.pem;
    ssl_certificate_key /var/node/cert/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;

    location / {
        proxy_pass         https://127.0.0.1:4000;
        proxy_ssl_verify   off;          # loopback – same cert
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection keep-alive;
        proxy_set_header   Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/hamster /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

---

## Gallery images

Place full-size images in `/var/node/cert/public/images/`  
and thumbnails (≤ 300 px wide) in `/var/node/cert/public/images/thumbs/`.

Edit `/var/node/cert/images.json` to add/remove gallery entries:

```json
[
  {
    "filename": "chocolate-wheel.jpg",
    "thumb":    "thumbs/chocolate-wheel-thumb.jpg",
    "description": "Chocolate in full sprint at midnight",
    "date": "2025-10-12"
  }
]
```

---

## Tailwind CSS – optional build

The server uses the **Tailwind CDN** by default (no build step required).  
For a production build that removes unused utilities and avoids the CDN dependency:

```bash
cd /var/node/cert
npm install                               # includes devDependencies
npm run build:css                         # writes public/css/styles.css
```

Then replace the CDN `<script>` tag in `server.js` with:

```html
<link rel="stylesheet" href="/css/styles.css">
```

---

## URL map

| URL                         | Description                                      |
|-----------------------------|--------------------------------------------------|
| `https://hamster.jahosi.co.uk/`           | Landing page – live stats + gallery |
| `https://hamster.jahosi.co.uk/analytics`  | Analytics – charts + date-range     |
| `https://hamster.jahosi.co.uk/kindle`     | Kindle view – plain HTML, no JS     |
| `https://hamster.jahosi.co.uk/api/live`   | JSON – live ESP32 data              |
| `https://hamster.jahosi.co.uk/api/csv-files` | JSON – list of CSV files         |
| `https://hamster.jahosi.co.uk/api/csv-data`  | JSON – CSV rows (+ date filter)  |
| `https://hamster.jahosi.co.uk/api/images` | JSON – gallery image list           |
