'use strict';
/**
 * lightbox.js – gallery lightbox on the home page.
 * Uses event delegation on data-lightbox-filename attributes so that
 * no inline onclick handlers are needed in the server-rendered HTML.
 */

function openLightbox(filename, desc) {
  document.getElementById('lbImg').src        = '/images/' + filename;
  document.getElementById('lbCaption').textContent = desc;
  document.getElementById('lightbox').style.display = 'flex';
}

function closeLightbox() {
  document.getElementById('lightbox').style.display = 'none';
}

document.addEventListener('DOMContentLoaded', function () {
  // ── Close on backdrop click ─────────────────────────────────────────────────
  var lb = document.getElementById('lightbox');
  if (lb) {
    lb.addEventListener('click', closeLightbox);
  }

  // ── Close button ────────────────────────────────────────────────────────────
  var closeBtn = document.getElementById('lbClose');
  if (closeBtn) {
    closeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      closeLightbox();
    });
  }

  // ── Inner container: stop propagation so clicking the photo doesn't close ───
  var lbInner = document.getElementById('lbInner');
  if (lbInner) {
    lbInner.addEventListener('click', function (e) { e.stopPropagation(); });
  }

  // ── Gallery clicks via event delegation ─────────────────────────────────────
  // Server renders gallery cards with data-lightbox-filename / data-lightbox-desc
  document.addEventListener('click', function (e) {
    var card = e.target.closest('[data-lightbox-filename]');
    if (card) {
      openLightbox(
        card.dataset.lightboxFilename,
        card.dataset.lightboxDesc || '',
      );
    }
  });
});

// ── Close on Escape key ─────────────────────────────────────────────────────────
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') closeLightbox();
});
