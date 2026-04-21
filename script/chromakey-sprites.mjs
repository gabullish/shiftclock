#!/usr/bin/env node
/**
 * chromakey-sprites.mjs
 *
 * One-time processor: strips the baked-in "Photoshop transparency checkerboard"
 * background from sprite PNGs, replacing those pixels with real alpha = 0.
 *
 * The source assets were generated with an opaque grey/blue checkerboard
 * (RGB ≈ 139/148/157 light and 106/115/124 dark) which shows up as ugly
 * boxes behind every sprite at runtime. This rewrites each file in place
 * with proper transparency.
 *
 * Run:  node script/chromakey-sprites.mjs
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

// ── Sprite files to process ──────────────────────────────────────────────────
const ROOT = "client/public/sprites";
const FILES = [
  "characters/character_base.png",
  "characters/character_states.png",
  "furniture/office/office_furniture.png",
  "furniture/bedroom/bedroom_furniture.png",
  "furniture/breakroom/breakroom_furniture.png",
  "furniture/clinic/clinic_furniture.png",
  "furniture/beach/beach_furniture.png",
];

// ── Background colors (observed) ─────────────────────────────────────────────
// Two tones of the checkerboard, plus a small tolerance to catch anti-aliased
// edges. Characteristic: R ≈ G-9, B ≈ G+6..9 (neutral bluish grey).
// Different sheets use slightly different checkerboard tone pairs.
// Character sheets: light (139,148,157) + dark (106,115,124)
// Furniture sheets: light (120,128,136) + dark (88,96,104)
// Some cells mix both pairs at boundaries. We key all four with tolerance.
const KEY_COLORS = [
  [139, 148, 157], // character light
  [106, 115, 124], // character dark
  [120, 128, 136], // furniture light
  [ 88,  96, 104], // furniture dark
];
const TOLERANCE = 10;

function isBackground(r, g, b) {
  for (const [kr, kg, kb] of KEY_COLORS) {
    if (
      Math.abs(r - kr) <= TOLERANCE &&
      Math.abs(g - kg) <= TOLERANCE &&
      Math.abs(b - kb) <= TOLERANCE
    ) return true;
  }
  return false;
}

// ── Minimal PNG decoder (RGBA only) ──────────────────────────────────────────
function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  const bitDepth  = buf[24];
  const colorType = buf[25];
  if (bitDepth !== 8 || colorType !== 6) throw new Error(`unsupported PNG ${bitDepth}/${colorType}`);

  const idats = [];
  let i = 8;
  while (i < buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.slice(i + 4, i + 8).toString("ascii");
    if (type === "IDAT") idats.push(buf.slice(i + 8, i + 8 + len));
    if (type === "IEND") break;
    i += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idats));

  const bpp = 4;
  const stride = w * bpp;
  const out = Buffer.alloc(w * h * bpp);
  let src = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[src++];
    for (let x = 0; x < stride; x++) {
      const up     = y > 0              ? out[(y - 1) * stride + x]        : 0;
      const left   = x >= bpp           ? out[y * stride + x - bpp]        : 0;
      const upLeft = (x >= bpp && y > 0) ? out[(y - 1) * stride + x - bpp] : 0;
      let v = raw[src++];
      switch (filter) {
        case 0: break;
        case 1: v = (v + left) & 0xff; break;
        case 2: v = (v + up) & 0xff; break;
        case 3: v = (v + ((left + up) >> 1)) & 0xff; break;
        case 4: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upLeft);
          const pred = (pa <= pb && pa <= pc) ? left : (pb <= pc ? up : upLeft);
          v = (v + pred) & 0xff; break;
        }
      }
      out[y * stride + x] = v;
    }
  }
  return { w, h, pixels: out };
}

// ── Minimal PNG encoder (RGBA, filter 0) ─────────────────────────────────────
function crc32(buf) {
  // Reuse zlib's crc32 (Node 18+)
  return zlib.crc32(buf) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(w, h, pixels) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Prepend filter byte (0) to each scanline
  const stride = w * 4;
  const filtered = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    filtered[y * (stride + 1)] = 0;
    pixels.copy(filtered, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(filtered, { level: 9 });

  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── Process ──────────────────────────────────────────────────────────────────
let totalKeyed = 0;
for (const rel of FILES) {
  const p = path.join(ROOT, rel);
  const buf = fs.readFileSync(p);
  const { w, h, pixels } = decodePNG(buf);

  let keyed = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (isBackground(pixels[i], pixels[i + 1], pixels[i + 2])) {
      pixels[i + 3] = 0;
      keyed++;
    }
  }

  const outBuf = encodePNG(w, h, pixels);
  fs.writeFileSync(p, outBuf);
  totalKeyed += keyed;
  const pct = ((keyed / (w * h)) * 100).toFixed(1);
  console.log(`${rel.padEnd(50)}  ${w}x${h}  keyed ${pct}%  size ${buf.length} → ${outBuf.length}`);
}
console.log(`Done. ${totalKeyed.toLocaleString()} pixels keyed to transparent.`);
