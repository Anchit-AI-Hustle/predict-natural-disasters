#!/usr/bin/env node
'use strict';
/**
 * The app icons, drawn from the site's own mark (the ◎ in the header).
 *
 * A home-screen install needs PNGs - on iPhone and iPad it is the only way a
 * site can receive an alert while closed - and an Android notification wants
 * a one-colour badge. Drawn here with the standard library so the images can
 * be rebuilt from source rather than being unexplained binaries.
 *
 *   node tools/build-icons.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'icons');
const BG = [6, 38, 29];        // --panel
const MARK = [37, 226, 156];   // --green

function crcTable() {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
}
const CRC = crcTable();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/**
 * Coverage of the mark at a point, in units of the icon's size: an outer ring
 * and a centre disc. `pad` shrinks it into the safe zone a maskable icon
 * needs, where a launcher may crop to a circle.
 */
function mark(x, y, pad) {
  const r = Math.hypot(x - 0.5, y - 0.5) / (0.5 - pad);
  const ring = r >= 0.62 && r <= 0.8;
  const dot = r <= 0.3;
  return ring || dot;
}

function draw(size, opts) {
  const S = 4, buf = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let hit = 0;
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
        if (mark((px + (sx + 0.5) / S) / size, (py + (sy + 0.5) / S) / size, opts.pad)) hit++;
      }
      const a = hit / (S * S), i = (py * size + px) * 4;
      if (opts.badge) {
        buf[i] = 255; buf[i + 1] = 255; buf[i + 2] = 255; buf[i + 3] = Math.round(a * 255);
      } else {
        for (let c = 0; c < 3; c++) buf[i + c] = Math.round(BG[c] * (1 - a) + MARK[c] * a);
        buf[i + 3] = 255;
      }
    }
  }
  return png(size, buf);
}

fs.mkdirSync(OUT, { recursive: true });
const files = {
  'icon-192.png': draw(192, { pad: 0.12 }),
  'icon-512.png': draw(512, { pad: 0.12 }),
  'apple-touch-icon.png': draw(180, { pad: 0.1 }),
  'badge-72.png': draw(72, { pad: 0.02, badge: true })
};
for (const [name, data] of Object.entries(files)) {
  fs.writeFileSync(path.join(OUT, name), data);
  console.log('icons/' + name + ' ' + data.length + ' bytes');
}
