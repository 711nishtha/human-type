#!/usr/bin/env node
/*!
 * Human Type - Granular, human-like text insertion for VS Code.
 * Copyright (c) 2026 Nishtha Sharma. All rights reserved.
 * Licensed under the terms in LICENSE. Redistribution is not permitted.
 */
/**
 * Generates icon.png from code - no binary assets, no third-party artwork, nothing to
 * license. Run with `npm run icon` after changing the design below.
 *
 * The mark: a dark rounded tile holding three "lines of text" of decreasing length and a
 * bright caret at the end of the last one - text arriving incrementally, with the cursor
 * still mid-line. That is exactly what the extension does.
 *
 * Uses only Node built-ins (zlib) to write a standard 8-bit RGBA PNG.
 */
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const SIZE = 256;

const BG = [0x1b, 0x21, 0x2b, 0xff]; // deep slate tile
const LINE = [0x8b, 0x9a, 0xb1, 0xff]; // muted grey "text"
const LINE_DIM = [0x55, 0x62, 0x75, 0xff]; // text not yet typed
const CARET = [0x4f, 0xc3, 0xf7, 0xff]; // bright cyan caret
const TRANSPARENT = [0, 0, 0, 0];

/** Rounded-rectangle coverage test. */
function insideRoundedRect(x, y, left, top, right, bottom, radius) {
  if (x < left || x > right || y < top || y > bottom) {
    return false;
  }
  const cx = Math.min(Math.max(x, left + radius), right - radius);
  const cy = Math.min(Math.max(y, top + radius), bottom - radius);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

function build() {
  const px = Buffer.alloc(SIZE * SIZE * 4);
  const put = (x, y, rgba) => {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) {
      return;
    }
    const o = (y * SIZE + x) * 4;
    px[o] = rgba[0];
    px[o + 1] = rgba[1];
    px[o + 2] = rgba[2];
    px[o + 3] = rgba[3];
  };

  // Tile
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      put(x, y, insideRoundedRect(x, y, 8, 8, SIZE - 9, SIZE - 9, 48) ? BG : TRANSPARENT);
    }
  }

  // Text lines: [x, y, width, colour]
  const barHeight = 22;
  const radius = 11;
  const bars = [
    [52, 66, 152, LINE],
    [52, 110, 112, LINE],
    [52, 154, 72, LINE],
    [52, 198, 96, LINE_DIM]
  ];
  for (const [bx, by, bw, colour] of bars) {
    for (let y = by; y < by + barHeight; y++) {
      for (let x = bx; x < bx + bw; x++) {
        if (insideRoundedRect(x, y, bx, by, bx + bw - 1, by + barHeight - 1, radius)) {
          put(x, y, colour);
        }
      }
    }
  }

  // Caret at the end of the third line - the line currently being typed.
  const caretX = 52 + 72 + 14;
  for (let y = 144; y < 144 + 42; y++) {
    for (let x = caretX; x < caretX + 10; x++) {
      if (insideRoundedRect(x, y, caretX, 144, caretX + 9, 144 + 41, 5)) {
        put(x, y, CARET);
      }
    }
  }

  return px;
}

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  // One filter byte (0 = None) per scanline.
  const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
  for (let y = 0; y < SIZE; y++) {
    raw[y * (SIZE * 4 + 1)] = 0;
    pixels.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const out = path.join(__dirname, '..', 'icon.png');
fs.writeFileSync(out, encodePng(build()));
console.log(`Wrote ${out} (${SIZE}x${SIZE} RGBA PNG)`);
