'use strict';
/* eslint-env serviceworker */

const CACHE_NAME = 'hamster-v1';

// Static assets that should be pre-cached on install
const PRECACHE_URLS = [
  '/manifest.json',
  '/css/styles.css',
  '/js/app.js',
  '/js/analytics.js',
  '/js/chart.umd.min.js',
  '/js/lightbox.js',
  '/js/live-status.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];

// ─── Install: pre-cache static assets ────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

// ─── Activate: remove stale caches ───────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

// ─── Fetch: per-resource strategy ────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle GET requests
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // ── API / readyz: network-only (always fetch fresh live data) ──────────────
  if (url.pathname.startsWith('/api/') || url.pathname === '/readyz') return;

  // ── Static assets (CSS, JS, icons, manifest): cache-first ──────────────────
  if (
    url.pathname.startsWith('/css/')  ||
    url.pathname.startsWith('/js/')   ||
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/manifest.json'
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            caches.open(CACHE_NAME).then((c) => c.put(request, response.clone()));
          }
          return response;
        });
      }),
    );
    return;
  }

  // ── Gallery images: cache-first (images change rarely) ─────────────────────
  if (url.pathname.startsWith('/images/')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            caches.open(CACHE_NAME).then((c) => c.put(request, response.clone()));
          }
          return response;
        });
      }),
    );
    return;
  }

  // ── HTML pages: network-first; fall back to cache, then offline page ────────
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          caches.open(CACHE_NAME).then((c) => c.put(request, response.clone()));
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then(
          (cached) => cached || new Response(
            '<!DOCTYPE html><html lang="en"><head>' +
            '<meta charset="UTF-8">' +
            '<meta name="viewport" content="width=device-width,initial-scale=1">' +
            '<title>Offline – Chocolate\'s Monitor</title>' +
            '<style>body{font-family:sans-serif;text-align:center;padding:3rem;background:#fdf8f0}' +
            'h1{font-size:2rem}p{color:#923717}</style>' +
            '</head><body>' +
            '<p style="font-size:4rem">🐹</p>' +
            '<h1>Offline</h1>' +
            '<p>Hamster monitor is unavailable. Check your connection.</p>' +
            '</body></html>',
            { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
          ),
        ),
      ),
  );
});
