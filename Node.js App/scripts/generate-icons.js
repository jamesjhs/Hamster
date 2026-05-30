#!/usr/bin/env node
'use strict';
/**
 * Generate solid-colour PNG icons for the PWA manifest and apple-touch-icon.
 * Uses only Node.js built-ins (zlib) – no npm dependencies required.
 *
 * Run:  node scripts/generate-icons.js
 * Output: public/icons/{icon-192.png,icon-512.png,apple-touch-icon.png}
 */

const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

const ICONS_DIR = path.join(__dirname, '..', 'public', 'icons');

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

// ─── Minimal solid-colour PNG ─────────────────────────────────────────────────
function createSolidPng(size, r, g, b) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);
  ihdrData.writeUInt32BE(size, 4);
  ihdrData[8]  = 8; // bit depth
  ihdrData[9]  = 2; // colour type: RGB truecolour
  ihdrData[10] = 0; // compression: deflate
  ihdrData[11] = 0; // filter: adaptive
  ihdrData[12] = 0; // interlace: none
  const ihdr = pngChunk('IHDR', ihdrData);

  // Raw scanlines: one filter byte (0 = None) + width*3 RGB bytes per row
  const rowLen = 1 + size * 3;
  const raw    = Buffer.alloc(size * rowLen);
  for (let y = 0; y < size; y++) {
    const off = y * rowLen;
    raw[off]  = 0; // filter: None
    for (let x = 0; x < size; x++) {
      raw[off + 1 + x * 3]     = r;
      raw[off + 1 + x * 3 + 1] = g;
      raw[off + 1 + x * 3 + 2] = b;
    }
  }

  const compressed = zlib.deflateSync(raw, { level: 9 });
  const idat = pngChunk('IDAT', compressed);
  const iend = pngChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([sig, ihdr, idat, iend]);
}

// ─── Generate ─────────────────────────────────────────────────────────────────
// Hamster brand colour: hamster-800 (#923717) from tailwind.config.js
const [R, G, B] = [0x92, 0x37, 0x17];

fs.mkdirSync(ICONS_DIR, { recursive: true });

const icons = [
  { name: 'icon-192.png',         size: 192 },
  { name: 'icon-512.png',         size: 512 },
  { name: 'apple-touch-icon.png', size: 180 },
];

for (const { name, size } of icons) {
  const filePath = path.join(ICONS_DIR, name);
  fs.writeFileSync(filePath, createSolidPng(size, R, G, B));
  console.log(`✓  ${filePath}`);
}
console.log('Done – PWA icons generated in', ICONS_DIR);
