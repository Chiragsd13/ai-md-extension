#!/usr/bin/env node
/**
 * Generate the VS Code extension marketplace icon (128x128 PNG).
 * Reuses the same icon design from browser extension icons but outputs to project root.
 *
 * Output: resources/icon.png (128x128)
 */

'use strict';

const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'resources');

// ─── CRC32 ───────────────────────────────────────────────────────────────────

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

function encodePNG(w, h, getPixel) {
  const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  function chunk(type, data) {
    const t = Buffer.from(type, 'ascii');
    const l = Buffer.allocUnsafe(4); l.writeUInt32BE(data.length);
    const c = Buffer.allocUnsafe(4); c.writeUInt32BE(crc32(Buffer.concat([t, data])));
    return Buffer.concat([l, t, data, c]);
  }

  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr.fill(0, 10);

  const raw = Buffer.allocUnsafe(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    const row = y * (1 + w * 4);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = getPixel(x, y);
      const off = row + 1 + x * 4;
      raw[off] = r; raw[off + 1] = g; raw[off + 2] = b; raw[off + 3] = a;
    }
  }

  return Buffer.concat([
    SIG,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ─── Drawing helpers ─────────────────────────────────────────────────────────

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const mix   = (a, b, t)   => a + (b - a) * clamp(t, 0, 1);
const smoothstep = (edge0, edge1, x) => {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

function circle(px, py, cx, cy, r) {
  const d = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
  return smoothstep(r + 0.7, r - 0.7, d);
}

function ring(px, py, cx, cy, r, thickness) {
  const d = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
  return smoothstep(r + thickness / 2 + 0.7, r + thickness / 2, d)
       * smoothstep(r - thickness / 2 - 0.7, r - thickness / 2, d);
}

function roundedRect(px, py, x0, y0, x1, y1, radius) {
  const qx = Math.max(x0 + radius - px, px - (x1 - radius), 0);
  const qy = Math.max(y0 + radius - py, py - (y1 - radius), 0);
  const d  = Math.sqrt(qx * qx + qy * qy) - radius;
  return smoothstep(0.7, -0.7, d);
}

// ─── Icon design: 128x128 ───────────────────────────────────────────────────

const FONT = {
  'a': [0b01110, 0b10001, 0b01111, 0b10001, 0b01111, 0, 0],
  'i': [0b00100, 0, 0b00100, 0b00100, 0b00100, 0, 0],
  '.': [0, 0, 0, 0, 0b00100, 0, 0],
  'm': [0, 0b11011, 0b10101, 0b10101, 0b10101, 0, 0],
  'd': [0b00010, 0b00010, 0b01110, 0b10010, 0b01110, 0, 0],
};

function drawLabel(x, y) {
  const chars  = ['a', 'i', '.', 'm', 'd'];
  const charW  = 7;
  const startX = 18;
  const startY = 90;
  const scale  = 1.0;

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

function getPixel128(px, py) {
  const x = px + 0.5;
  const y = py + 0.5;

  // Background: dark blue-black rounded rect
  const bgA = roundedRect(x, y, 0, 0, 128, 128, 20);
  if (bgA < 0.01) return [0, 0, 0, 0];

  // Background gradient: dark to slightly lighter
  const bgR = Math.round(mix(18, 30, y / 128));
  const bgG = Math.round(mix(18, 35, y / 128));
  const bgB = Math.round(mix(30, 55, y / 128));

  // "@" symbol
  const cx = 54, cy = 48;
  const outerR = 28, thickness = 7.5;

  let atCoverage = ring(x, y, cx, cy, outerR, thickness);

  const angle = Math.atan2(y - cy, x - cx);
  const openStart = -0.45;
  const openEnd   =  0.55;
  if (angle > openStart && angle < openEnd && x > cx) {
    const fade = 1 - smoothstep(0.05, -0.05, Math.min(angle - openStart, openEnd - angle));
    atCoverage *= fade;
  }

  // Vertical tail
  const stemX0 = cx + outerR - thickness + 1;
  const stemX1 = cx + outerR + 2;
  const stemY0 = cy - thickness * 0.5;
  const stemY1 = cy + outerR * 0.65;
  const stemW  = smoothstep(stemX0 - 0.7, stemX0, x) * smoothstep(stemX1 + 0.7, stemX1, x);
  const stemH  = smoothstep(stemY0 - 0.7, stemY0, y) * smoothstep(stemY1 + 0.7, stemY1, y);
  const stemCoverage = stemW * stemH;

  // Inner "a" blob
  const innerCoverage = circle(x, y, cx - 1, cy, 11);

  const atTotal = clamp(atCoverage + stemCoverage + innerCoverage, 0, 1);

  // "ai.md" label at bottom
  const labelCoverage = drawLabel(x, y);

  // Indicator dot top-right (cyan accent)
  const dotCoverage = circle(x, y, 106, 18, 7);

  // Composite: white symbol on dark background
  const symbolCoverage = clamp(atTotal + labelCoverage, 0, 1);

  // Dot gets a cyan-ish tint
  const r = Math.round(mix(bgR, 255, symbolCoverage) * (1 - dotCoverage) + mix(bgR, 80, dotCoverage) * dotCoverage + 255 * symbolCoverage * (1 - dotCoverage));
  const g = Math.round(mix(bgG, 255, symbolCoverage) * (1 - dotCoverage) + mix(bgG, 200, dotCoverage) * dotCoverage + 255 * symbolCoverage * (1 - dotCoverage));
  const b = Math.round(mix(bgB, 255, symbolCoverage) * (1 - dotCoverage) + mix(bgB, 255, dotCoverage) * dotCoverage + 255 * symbolCoverage * (1 - dotCoverage));

  // Simplified: just mix the layers
  const fR = clamp(Math.round(mix(bgR, 255, symbolCoverage + dotCoverage * 0.3)), 0, 255);
  const fG = clamp(Math.round(mix(bgG, 255, symbolCoverage + dotCoverage * 0.8)), 0, 255);
  const fB = clamp(Math.round(mix(bgB, 255, symbolCoverage + dotCoverage * 1.0)), 0, 255);
  const fA = Math.round(bgA * 255);

  return [fR, fG, fB, fA];
}

// ─── Generate ────────────────────────────────────────────────────────────────

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const png = encodePNG(128, 128, getPixel128);
const outPath = path.join(OUT_DIR, 'icon.png');
fs.writeFileSync(outPath, png);
console.log(`  Generated: ${outPath} (${(png.length / 1024).toFixed(1)} KB)`);
