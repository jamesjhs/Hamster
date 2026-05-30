'use strict';
/**
 * app.js – loaded on every page.
 * Handles:
 *   • Responsive navigation toggle
 *   • Service-worker registration (PWA)
 *   • Generic page-reload buttons (.js-reload)
 */

(function () {
  // ── Navigation toggle ────────────────────────────────────────────────────────
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

  // ── Generic reload buttons ────────────────────────────────────────────────────
  document.querySelectorAll('.js-reload').forEach(function (el) {
    el.addEventListener('click', function () { location.reload(); });
  });
})();

// ── Service-worker registration ────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js').catch(function (err) {
      console.warn('Service worker registration failed:', err);
    });
  });
}
