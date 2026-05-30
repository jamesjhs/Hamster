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

// ── Install prompt handling ────────────────────────────────────────────────────
(function () {
  var deferredInstallPrompt = null;
  var installButtons = Array.prototype.slice.call(document.querySelectorAll('[data-install-app]'));

  if (!installButtons.length) return;

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function isIOS() {
    return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
  }

  function isChromiumBrowser() {
    return /chrome|chromium|crios|edg|opr\//i.test(window.navigator.userAgent)
      && !/firefox|fxios/i.test(window.navigator.userAgent);
  }

  function getInstallButtonLabel() {
    return deferredInstallPrompt ? 'Install app' : 'How to install';
  }

  function canShowInstallHelp() {
    return isIOS() || isChromiumBrowser();
  }

  function updateInstallButtons() {
    var shouldShow = !isStandalone() && canShowInstallHelp();
    installButtons.forEach(function (button) {
      button.hidden = !shouldShow;
      button.disabled = false;
      button.textContent = getInstallButtonLabel();
    });
  }

  window.addEventListener('beforeinstallprompt', function (event) {
    deferredInstallPrompt = event;
    updateInstallButtons();
  });

  window.addEventListener('appinstalled', function () {
    deferredInstallPrompt = null;
    updateInstallButtons();
  });

  installButtons.forEach(function (button) {
    button.addEventListener('click', function () {
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        deferredInstallPrompt.userChoice
          .then(function (choice) {
            if (choice && choice.outcome) {
              console.info('Install prompt outcome:', choice.outcome);
            }
            deferredInstallPrompt = null;
            updateInstallButtons();
          })
          .catch(function (err) {
            console.warn('Install prompt was interrupted:', err);
            deferredInstallPrompt = null;
            updateInstallButtons();
          });
        return;
      }

      if (isIOS()) {
        window.alert('To install Hamster, tap Share and then "Add to Home Screen".');
        return;
      }

      if (/android/i.test(window.navigator.userAgent)) {
        window.alert('To install Hamster in Chrome, open the browser menu and tap "Add to Home screen".');
        return;
      }

      window.alert('To install Hamster in Chrome on desktop, use the address-bar install icon or open the browser menu and choose "Install Chocolate\'s Monitor".');
    });
  });

  updateInstallButtons();
})();
