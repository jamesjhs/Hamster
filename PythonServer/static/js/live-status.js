'use strict';
/**
 * live-status.js – real-time wheel/sensor dashboard.
 * Extracted from the inline script in server.js renderLiveStatus().
 */

(function () {
  const WHEEL1_DIAM_CM_DEFAULT = 30;
  const WHEEL2_DIAM_CM_DEFAULT = 14;
  const TIME_PAUSE_MS          = 10000;

  let w1Diam = WHEEL1_DIAM_CM_DEFAULT;
  let w2Diam = WHEEL2_DIAM_CM_DEFAULT;

  function fmt1(n)  { return Number(n).toFixed(1); }
  function fmt2(n)  { return Number(n).toFixed(2); }
  function fmtMs(s) {
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
    const el = document.getElementById(id);
    if (active) {
      el.textContent = 'RUNNING';
      el.className   = 'text-xs font-bold px-2.5 py-1 rounded-full bg-green-100 text-green-700';
    } else {
      el.textContent = 'IDLE';
      el.className   = 'text-xs font-bold px-2.5 py-1 rounded-full bg-hamster-100 text-hamster-400';
    }
  }

  function setText(id, val) { document.getElementById(id).textContent = val; }

  function render(d) {
    const lwm         = d.lastwheelmillis || 0;
    const wheelLast   = Math.round(d.wheelNumberLast || 1);
    const wheelActive = lwm > 0 && lwm < TIME_PAUSE_MS;
    const w1Active    = wheelActive && wheelLast === 1;
    const w2Active    = wheelActive && wheelLast === 2;

    const w1Speed = w1Active ? calcSpeed(lwm, w1Diam) : 0;
    const w1RPM   = w1Active ? calcRPM(lwm) : 0;
    setBadge('w1-badge', w1Active);
    setText('w1-speed',     w1Active ? fmt2(w1Speed) + ' m/s' : '0.00 m/s');
    setText('w1-speed-kmh', w1Active ? fmt2(w1Speed * 3.6) + ' km/h' : '—');
    setText('w1-rpm',       w1Active ? fmt1(w1RPM) + ' rpm' : '0 rpm');
    setText('w1-dist',      fmt2(d.distance1 || 0) + ' m');

    const w2Speed = w2Active ? calcSpeed(lwm, w2Diam) : 0;
    const w2RPM   = w2Active ? calcRPM(lwm) : 0;
    setBadge('w2-badge', w2Active);
    setText('w2-speed',     w2Active ? fmt2(w2Speed) + ' m/s' : '0.00 m/s');
    setText('w2-speed-kmh', w2Active ? fmt2(w2Speed * 3.6) + ' km/h' : '—');
    setText('w2-rpm',       w2Active ? fmt1(w2RPM) + ' rpm' : '0 rpm');
    setText('w2-dist',      fmt2(d.distance2 || 0) + ' m');

    const motionLevels = { 1: 'Level 1 – under cover', 2: 'Level 2 – open-space', 3: 'Level 3 – mezzanine' };
    const motionLevel  = Math.round(d.motionLevelLast || 0);
    setText('sensor-location',     d.lastLocation || '—');
    setText('sensor-motion-level', motionLevel > 0 ? (motionLevels[motionLevel] || 'Level ' + motionLevel) : '—');
    setText('sensor-wheel-last',   wheelLast === 1 ? 'Wheel 1 (big)' : (wheelLast === 2 ? 'Wheel 2 (small)' : '—'));

    const minsAgo = d.lastActiveMinsAgo;
    setText('sensor-last-active', minsAgo === 0 ? 'just now' : minsAgo + ' min ago');

    const esp32El = document.getElementById('sensor-esp32');
    if (d.esp32Online) {
      esp32El.textContent = 'Online ✓';
      esp32El.className   = 'font-bold text-green-600';
    } else {
      esp32El.textContent = 'Offline ✗';
      esp32El.className   = 'font-bold text-red-600';
    }

    const aveMs = d.avespeed || 0;
    const maxMs = d.maxspeed || 0;
    setText('stats-avespeed',     fmt2(aveMs) + ' m/s');
    setText('stats-avespeed-kmh', '(' + fmt2(aveMs * 3.6) + ' km/h)');
    setText('stats-maxspeed',     fmt2(maxMs) + ' m/s');
    setText('stats-maxspeed-kmh', '(' + fmt2(maxMs * 3.6) + ' km/h)');
    setText('stats-motion1', fmtMs(d.motion1count || 0));
    setText('stats-motion2', fmtMs(d.motion2count || 0));
    setText('stats-motion3', fmtMs(d.motion3count || 0));

    const dot  = document.getElementById('statusDot');
    const text = document.getElementById('statusText');
    if (d.esp32Online) {
      dot.className    = 'inline-block w-3 h-3 rounded-full bg-green-500';
      text.textContent = 'Live · ' + new Date().toLocaleTimeString();
    } else {
      dot.className    = 'inline-block w-3 h-3 rounded-full bg-red-500';
      text.textContent = 'ESP32 offline · ' + new Date().toLocaleTimeString();
    }
  }

  async function fetchConfig() {
    try {
      const r = await fetch('/api/config');
      if (!r.ok) return;
      const cfg = await r.json();
      if (cfg.wheel1DiameterCm) w1Diam = cfg.wheel1DiameterCm;
      if (cfg.wheel2DiameterCm) w2Diam = cfg.wheel2DiameterCm;
    } catch (_) { /* network unavailable */ }
  }

  async function fetchNow() {
    const dot  = document.getElementById('statusDot');
    const text = document.getElementById('statusText');
    dot.className    = 'inline-block w-3 h-3 rounded-full bg-yellow-400';
    text.textContent = 'Fetching…';
    try {
      const r = await fetch('/api/live-now');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      render(d);
    } catch (err) {
      dot.className    = 'inline-block w-3 h-3 rounded-full bg-red-500';
      text.textContent = 'Error: ' + err.message;
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    var refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) refreshBtn.addEventListener('click', fetchNow);

    fetchConfig().then(fetchNow);
    setInterval(fetchNow, 5000);
  });
})();
