#!/usr/bin/env node
/**
 * Generate browser extension PNG icons from scratch using only Node.js built-ins.
 * No npm dependencies required — uses zlib for PNG compression and CRC32.
 *
 * Output: browser-extension/icons/icon{16,32,48,128}.png
 */

'use strict';

const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'browser-extension', 'icons');

// ─── CRC32 ────────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ─── PNG encoder ─────────────────────────────────────────────────────────────
// getPixel(x, y) → [r, g, b, a]  (0-255 each)

function encodePNG(w, h, getPixel) {
  const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  function chunk(type, data) {
    const t = Buffer.from(type, 'ascii');
    const l = Buffer.allocUnsafe(4); l.writeUInt32BE(data.length);
    const c = Buffer.allocUnsafe(4); c.writeUInt32BE(crc32(Buffer.concat([t, data])));
    return Buffer.concat([l, t, data, c]);
  }

  // IHDR: RGBA 8-bit
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr.fill(0, 10); // 6 = RGBA

  // Raw scanlines: [filter_byte, R, G, B, A, ...]
  const raw = Buffer.allocUnsafe(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    const row = y * (1 + w * 4);
    raw[row] = 0; // filter: None
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = getPixel(x, y);
      const off = row + 1 + x * 4;
      raw[off] = r; raw[off + 1] = g; raw[off + 2] = b; raw[off + 3] = a;
    }
  }

  return Buffer.concat([
    SIG,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ─── Math helpers ─────────────────────────────────────────────────────────────

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const mix   = (a, b, t)   => a + (b - a) * clamp(t, 0, 1);
const smoothstep = (edge0, edge1, x) => {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

// Anti-aliased circle: returns coverage 0-1 (0=outside, 1=inside)
function circle(px, py, cx, cy, r) {
  const d = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
  return smoothstep(r + 0.7, r - 0.7, d);
}

// Anti-aliased ring: returns coverage 0-1
function ring(px, py, cx, cy, r, thickness) {
  const d = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
  return smoothstep(r + thickness / 2 + 0.7, r + thickness / 2, d)
       * smoothstep(r - thickness / 2 - 0.7, r - thickness / 2, d);
}

// Rounded rectangle coverage
function roundedRect(px, py, x0, y0, x1, y1, radius) {
  const qx = Math.max(x0 + radius - px, px - (x1 - radius), 0);
  const qy = Math.max(y0 + radius - py, py - (y1 - radius), 0);
  const d  = Math.sqrt(qx * qx + qy * qy) - radius;
  return smoothstep(0.7, -0.7, d);
}

// ─── Icon pixel function ──────────────────────────────────────────────────────
// Everything is expressed in the 128×128 coordinate space, then scaled.

function getPixelAt(size, px, py) {
  // Map pixel coords into 128-space
  const s  = 128 / size;
  const x  = (px + 0.5) * s;
  const y  = (py + 0.5) * s;

  // ── Background: black rounded rect ──────────────────────────────────────────
  const bgA = roundedRect(x, y, 0, 0, 128, 128, 20);
  if (bgA < 0.01) return [0, 0, 0, 0]; // transparent outside

  // ── "@" symbol ──────────────────────────────────────────────────────────────
  // Outer ring, centered at (54, 50)
  const cx = 54, cy = 50;
  const outerR = 26, thickness = 7;

  // Full ring
  let atCoverage = ring(x, y, cx, cy, outerR, thickness);

  // Cut opening on the right side (angle ~-25° to +30°) to form the "@" arc
  const angle = Math.atan2(y - cy, x - cx); // radians, -π to π
  const openStart = -0.45; // ~-26°
  const openEnd   =  0.55; // ~+32°
  if (angle > openStart && angle < openEnd && x > cx) {
    // Soft fade at opening edges
    const fade = 1 - smoothstep(0.05, -0.05, Math.min(angle - openStart, openEnd - angle));
    atCoverage *= fade;
  }

  // Vertical tail/stem on the right of the "@" (the descending stroke)
  const stemX0 = cx + outerR - thickness + 1;
  const stemX1 = cx + outerR + 2;
  const stemY0 = cy - thickness * 0.5;
  const stemY1 = cy + outerR * 0.65;
  const stemW  = smoothstep(stemX0 - 0.7, stemX0, x) * smoothstep(stemX1 + 0.7, stemX1, x);
  const stemH  = smoothstep(stemY0 - 0.7, stemY0, y) * smoothstep(stemY1 + 0.7, stemY1, y);
  const stemCoverage = stemW * stemH;

  // Inner "a" blob
  const innerCoverage = circle(x, y, cx - 1, cy, 10);

  const atTotal = clamp(atCoverage + stemCoverage + innerCoverage, 0, 1);

  // ── "ai.md" label (only for 48px and 128px) ──────────────────────────────────
  let labelCoverage = 0;
  if (size >= 48) {
    labelCoverage = drawLabel(x, y, size);
  }

  // ── Small indicator dot top-right ────────────────────────────────────────────
  const dotCoverage = circle(x, y, 104, 18, 6);

  // ── Composite ────────────────────────────────────────────────────────────────
  const whiteCoverage = clamp(atTotal + labelCoverage + dotCoverage, 0, 1);
  const r = Math.round(mix(0, 255, whiteCoverage));
  const a = Math.round(bgA * 255);
  return [r, r, r, a];
}

// Minimal bitmap font: each char is a 5×7 grid encoded as row bitmasks
const FONT = {
  'a': [0b01110, 0b10001, 0b01111, 0b10001, 0b01111, 0, 0],
  'i': [0b00100, 0, 0b00100, 0b00100, 0b00100, 0, 0],
  '.': [0, 0, 0, 0, 0b00100, 0, 0],
  'm': [0, 0b11011, 0b10101, 0b10101, 0b10101, 0, 0],
  'd': [0b00010, 0b00010, 0b01110, 0b10010, 0b01110, 0, 0],
};

function drawLabel(x, y, size) {
  // "ai.md" placed at bottom of icon in 128-space
  const chars  = ['a', 'i', '.', 'm', 'd'];
  const charW  = size >= 128 ? 7 : 6;
  const charH  = 7;
  const startX = size >= 128 ? 18 : 22;
  const startY = size >= 128 ? 90 : 88;
  const scale  = size >= 128 ? 1.0 : 0.85;

  for (let ci = 0; ci < chars.length; ci++) {
    const bmap = FONT[chars[ci]];
    const ox = startX + ci * (charW + 2);
    for (let row = 0; row < 7; row++) {
      const bits = bmap[row] ?? 0;
      for (let col = 0; col < 5; col++) {
        if (bits & (1 << (4 - col))) {
          const px = ox + col * scale;
          const py = startY + row * scale;
          const coverage = Math.max(0, 1 - ((x - px) ** 2 + (y - py) ** 2) * 0.9);
          if (coverage > 0) return coverage;
        }
      }
    }
  }
  return 0;
}

// ─── Generate all sizes ───────────────────────────────────────────────────────

const SIZES = [16, 32, 48, 128];

console.log('');
for (const size of SIZES) {
  const png  = encodePNG(size, size, (px, py) => getPixelAt(size, px, py));
  const out  = path.join(OUT, `icon${size}.png`);
  fs.writeFileSync(out, png);
  console.log(`  ✔  icon${size}.png  (${(png.length / 1024).toFixed(1)} KB)`);
}
console.log('\n  All icons generated → browser-extension/icons/\n');
