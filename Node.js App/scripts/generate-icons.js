#!/usr/bin/env node
'use strict';
/**
 * Generate PWA icons (PNG + favicon.ico) for the Hamster Monitor app.
 * Uses only Node.js built-ins (zlib) – no npm dependencies required.
 *
 * The icon design is a simplified hamster face drawn with geometric shapes,
 * using the same colour palette as the original 16×16 pixel-art favicon.ico:
 *   fur   #d18136  orange-brown
 *   face  #f2e8df  warm cream
 *   cheek #da92de  soft pink
 *   eye   #3c2205  dark brown
 *   bg    transparent (RGBA PNG)
 *
 * Run:  node scripts/generate-icons.js
 * Output:
 *   public/favicon.ico            (16×16 + 32×32, RGBA PNG-in-ICO)
 *   public/icons/icon-192.png
 *   public/icons/icon-512.png
 *   public/icons/icon-512-maskable.png  (with safe-zone padding for maskable)
 *   public/icons/apple-touch-icon.png
 */

const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const ICONS_DIR  = path.join(PUBLIC_DIR, 'icons');

// ─── CRC-32 ───────────────────────────────────────────────────────────────────
function buildCRCTable() {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
}
const CRC_TABLE = buildCRCTable();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (const b of buf) crc = CRC_TABLE[(crc ^ b) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const typeB = Buffer.from(type, 'ascii');
  const len   = Buffer.alloc(4);  len.writeUInt32BE(data.length);
  const crcB  = Buffer.alloc(4);  crcB.writeUInt32BE(crc32(Buffer.concat([typeB, data])));
  return Buffer.concat([len, typeB, data, crcB]);
}

// ─── RGBA pixel canvas ────────────────────────────────────────────────────────
/** Create a flat RGBA pixel array (width × height × 4 bytes). */
function createCanvas(w, h) {
  return new Uint8Array(w * h * 4); // default: transparent black
}

/** Set one pixel (no bounds check). */
function setPixel(canvas, w, x, y, r, g, b, a = 255) {
  const i = (y * w + x) * 4;
  canvas[i] = r; canvas[i + 1] = g; canvas[i + 2] = b; canvas[i + 3] = a;
}

/** Get one pixel as [r,g,b,a]. */
function getPixel(canvas, w, x, y) {
  const i = (y * w + x) * 4;
  return [canvas[i], canvas[i + 1], canvas[i + 2], canvas[i + 3]];
}

/** Filled circle using anti-aliased coverage (Wu-style soft edge). */
function fillCircle(canvas, w, cx, cy, radius, r, g, b) {
  const x0 = Math.max(0, Math.floor(cx - radius - 1));
  const x1 = Math.min(w - 1, Math.ceil(cx + radius + 1));
  const y0 = Math.max(0, Math.floor(cy - radius - 1));
  const y1 = Math.min(w - 1, Math.ceil(cy + radius + 1));
  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      const dist = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
      const alpha = Math.max(0, Math.min(1, radius + 0.5 - dist));
      if (alpha <= 0) continue;
      // Alpha-composite over existing pixel
      const [er, eg, eb, ea] = getPixel(canvas, w, px, py);
      const a1 = alpha;
      const a0 = ea / 255;
      const ao = a1 + a0 * (1 - a1);
      if (ao < 0.001) continue;
      const nr = Math.round((r * a1 + er * a0 * (1 - a1)) / ao);
      const ng = Math.round((g * a1 + eg * a0 * (1 - a1)) / ao);
      const nb = Math.round((b * a1 + eb * a0 * (1 - a1)) / ao);
      setPixel(canvas, w, px, py, nr, ng, nb, Math.round(ao * 255));
    }
  }
}

/** Filled ellipse. */
function fillEllipse(canvas, w, cx, cy, rx, ry, r, g, b) {
  const x0 = Math.max(0, Math.floor(cx - rx - 1));
  const x1 = Math.min(w - 1, Math.ceil(cx + rx + 1));
  const y0 = Math.max(0, Math.floor(cy - ry - 1));
  const y1 = Math.min(w - 1, Math.ceil(cy + ry + 1));
  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) {
      const d = ((px - cx) / rx) ** 2 + ((py - cy) / ry) ** 2;
      const dist = Math.sqrt(d) * Math.min(rx, ry); // effective radius
      const edge = Math.min(rx, ry);
      const alpha = Math.max(0, Math.min(1, edge + 0.5 - dist));
      if (alpha <= 0) continue;
      const [er, eg, eb, ea] = getPixel(canvas, w, px, py);
      const a1 = alpha;
      const a0 = ea / 255;
      const ao = a1 + a0 * (1 - a1);
      if (ao < 0.001) continue;
      const nr = Math.round((r * a1 + er * a0 * (1 - a1)) / ao);
      const ng = Math.round((g * a1 + eg * a0 * (1 - a1)) / ao);
      const nb = Math.round((b * a1 + eb * a0 * (1 - a1)) / ao);
      setPixel(canvas, w, px, py, nr, ng, nb, Math.round(ao * 255));
    }
  }
}

// ─── Hamster face renderer ────────────────────────────────────────────────────
// Colour palette (matches the original pixel-art favicon.ico)
const COL = {
  fur:    [0xd1, 0x81, 0x36], // #d18136 orange-brown fur
  face:   [0xf2, 0xe8, 0xdf], // #f2e8df warm cream face patch
  cheek:  [0xda, 0x92, 0xde], // #da92de soft pink cheeks
  eye:    [0x3c, 0x22, 0x05], // #3c2205 dark brown eyes
  nose:   [0xb5, 0x6a, 0xa0], // #b56aa0 pink nose
  ear:    [0xda, 0x92, 0xde], // same pink for inner ears
};

/**
 * Draw a hamster face onto a square canvas of side `size`.
 * All measurements are expressed as fractions of `size` so the design
 * scales cleanly from 16 px to 512 px.
 *
 * @param {number} size   Canvas side length in pixels
 * @param {number} pad    Extra inset on every side (0 = full bleed, 0.1 = 10% safe zone)
 */
function drawHamster(size, pad = 0) {
  const canvas = createCanvas(size, size);
  const s = size * (1 - 2 * pad);  // usable square size
  const ox = size * pad;            // top-left origin x
  const oy = size * pad;            // top-left origin y

  // Helper: convert fraction of usable area → absolute pixel
  const ax = (fx) => ox + fx * s;
  const ay = (fy) => oy + fy * s;
  const ar = (fr) => fr * s;

  // ── Outer ears (fur colour) ──
  fillCircle(canvas, size, ax(0.26), ay(0.18), ar(0.14), ...COL.fur);
  fillCircle(canvas, size, ax(0.74), ay(0.18), ar(0.14), ...COL.fur);

  // ── Inner ears (cheek pink) ──
  fillCircle(canvas, size, ax(0.26), ay(0.18), ar(0.08), ...COL.ear);
  fillCircle(canvas, size, ax(0.74), ay(0.18), ar(0.08), ...COL.ear);

  // ── Round head (fur) ──
  fillCircle(canvas, size, ax(0.5), ay(0.52), ar(0.42), ...COL.fur);

  // ── Face patch (cream oval) ──
  fillEllipse(canvas, size, ax(0.5), ay(0.56), ar(0.29), ar(0.34), ...COL.face);

  // ── Cheek pouches ──
  fillEllipse(canvas, size, ax(0.24), ay(0.64), ar(0.18), ar(0.15), ...COL.cheek);
  fillEllipse(canvas, size, ax(0.76), ay(0.64), ar(0.18), ar(0.15), ...COL.cheek);

  // ── Eyes ──
  fillCircle(canvas, size, ax(0.38), ay(0.48), ar(0.06), ...COL.eye);
  fillCircle(canvas, size, ax(0.62), ay(0.48), ar(0.06), ...COL.eye);

  // ── Eye highlights (tiny white dot) ──
  fillCircle(canvas, size, ax(0.395), ay(0.465), ar(0.02), 255, 255, 255);
  fillCircle(canvas, size, ax(0.635), ay(0.465), ar(0.02), 255, 255, 255);

  // ── Nose ──
  fillEllipse(canvas, size, ax(0.5), ay(0.60), ar(0.055), ar(0.04), ...COL.nose);

  return canvas;
}

// ─── Encode RGBA canvas → PNG ─────────────────────────────────────────────────
function encodePng(canvas, w, h) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(w, 0);
  ihdrData.writeUInt32BE(h, 4);
  ihdrData[8]  = 8;  // bit depth
  ihdrData[9]  = 6;  // colour type: RGBA truecolour
  ihdrData[10] = 0;  // compression: deflate
  ihdrData[11] = 0;  // filter: adaptive
  ihdrData[12] = 0;  // interlace: none
  const ihdr = pngChunk('IHDR', ihdrData);

  // Raw scanlines: filter byte (0 = None) + width×4 RGBA bytes per row
  const rowLen = 1 + w * 4;
  const raw    = Buffer.alloc(h * rowLen);
  for (let y = 0; y < h; y++) {
    const off = y * rowLen;
    raw[off] = 0; // filter: None
    for (let x = 0; x < w; x++) {
      const si = (y * w + x) * 4;
      raw[off + 1 + x * 4]     = canvas[si];
      raw[off + 1 + x * 4 + 1] = canvas[si + 1];
      raw[off + 1 + x * 4 + 2] = canvas[si + 2];
      raw[off + 1 + x * 4 + 3] = canvas[si + 3];
    }
  }

  const compressed = zlib.deflateSync(raw, { level: 9 });
  const idat = pngChunk('IDAT', compressed);
  const iend = pngChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([sig, ihdr, idat, iend]);
}

// ─── Build favicon.ico (multi-size PNG-in-ICO) ───────────────────────────────
/**
 * Build a valid .ico file containing PNG images at the requested sizes.
 * Modern ICO format allows embedding full PNG data directly (Chrome, Firefox,
 * Edge and Safari all support this).  Each embedded PNG is an RGBA image,
 * so transparency is preserved at every size.
 */
function buildIco(sizes) {
  const pngs = sizes.map((sz) => {
    const canvas = drawHamster(sz);
    return encodePng(canvas, sz, sz);
  });

  const count     = sizes.length;
  const dirSize   = 6 + count * 16;   // ICONDIR + count × ICONDIRENTRY
  const offsets   = [];
  let   dataStart = dirSize;
  for (const png of pngs) {
    offsets.push(dataStart);
    dataStart += png.length;
  }

  const buf = Buffer.alloc(dirSize);
  buf.writeUInt16LE(0, 0);     // reserved
  buf.writeUInt16LE(1, 2);     // type: icon
  buf.writeUInt16LE(count, 4); // number of images

  for (let i = 0; i < count; i++) {
    const sz  = sizes[i];
    const off = 6 + i * 16;
    // ICONDIRENTRY
    buf[off + 0] = sz >= 256 ? 0 : sz;  // width  (0 = 256)
    buf[off + 1] = sz >= 256 ? 0 : sz;  // height (0 = 256)
    buf[off + 2] = 0;                   // color count (0 = no palette)
    buf[off + 3] = 0;                   // reserved
    buf.writeUInt16LE(1,    off + 4);   // planes
    buf.writeUInt16LE(32,   off + 6);   // bit count (32 bpp RGBA)
    buf.writeUInt32LE(pngs[i].length, off + 8);  // byte size of image data
    buf.writeUInt32LE(offsets[i],     off + 12); // offset of image data
  }

  return Buffer.concat([buf, ...pngs]);
}

// ─── Generate everything ──────────────────────────────────────────────────────
fs.mkdirSync(ICONS_DIR, { recursive: true });

// favicon.ico — 16×16 and 32×32 RGBA PNG-in-ICO
const icoPath = path.join(PUBLIC_DIR, 'favicon.ico');
fs.writeFileSync(icoPath, buildIco([16, 32]));
console.log(`✓  ${icoPath}`);

// PWA icons
const pwaIcons = [
  { name: 'icon-192.png',          size: 192, pad: 0    },
  { name: 'icon-512.png',          size: 512, pad: 0    },
  { name: 'icon-512-maskable.png', size: 512, pad: 0.1  }, // 10 % safe zone
  { name: 'apple-touch-icon.png',  size: 180, pad: 0    },
];

for (const { name, size, pad } of pwaIcons) {
  const canvas   = drawHamster(size, pad);
  const pngBytes = encodePng(canvas, size, size);
  const filePath = path.join(ICONS_DIR, name);
  fs.writeFileSync(filePath, pngBytes);
  console.log(`✓  ${filePath}`);
}

console.log('Done – PWA icons generated.');
