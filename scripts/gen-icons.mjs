// Generates galaxy pixel-art icons (PNG + ICO) without any native deps.
// Run: node scripts/gen-icons.mjs
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = new URL("../src-tauri/icons/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
mkdirSync(OUT, { recursive: true });

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

// 16x16 pixel-art galaxy swirl scaled up, deep-space palette.
const PALETTE = {
  " ": [7, 9, 22, 255],       // deep space blue-black
  ".": [18, 16, 42, 255],     // nebula base
  p: [105, 77, 201, 255],     // nebula purple
  P: [154, 123, 245, 255],    // light purple
  c: [72, 222, 209, 255],     // cyan star
  a: [245, 183, 84, 255],     // amber star
  w: [235, 240, 255, 255],    // white star
};
const SPRITE = [
  "       c        ",
  "    .ppPp.      ",
  " w .ppPPPp.  a  ",
  "  .pPPwwwPPp.   ",
  " .pPwwwwwPPp.   ",
  " .pPwwwwwwPp.   ",
  "p pPPwwwwPPp. p ",
  "Pp .pPPPPPp.  pP",
  "pPp  .ppPp.   pP",
  " Pp.   c     .pP",
  "  .Pp.     .pP. ",
  "   .pPp. .pPp.  ",
  "  a  .pPPPp.  w ",
  "      .pp.      ",
  "   c        P   ",
  "                ",
];

function makePng(size) {
  const scale = size / 16;
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0; // filter: none
    const sy = Math.min(15, Math.floor(y / scale));
    for (let x = 0; x < size; x++) {
      const sx = Math.min(15, Math.floor(x / scale));
      const rgba = PALETTE[SPRITE[sy][sx]] ?? PALETTE[" "];
      const o = y * stride + 1 + x * 4;
      raw[o] = rgba[0]; raw[o + 1] = rgba[1]; raw[o + 2] = rgba[2]; raw[o + 3] = rgba[3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function makeIco(png, size) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 2);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry[0] = size >= 256 ? 0 : size; entry[1] = size >= 256 ? 0 : size;
  entry[2] = 0; entry[3] = 0;
  entry.writeUInt16LE(1, 4); entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(6 + 16, 12);
  return Buffer.concat([header, entry, png]);
}

const png32 = makePng(32);
const png128 = makePng(128);
const png256 = makePng(256);
writeFileSync(join(OUT, "32x32.png"), png32);
writeFileSync(join(OUT, "128x128.png"), png128);
writeFileSync(join(OUT, "128x128@2x.png"), png256);
writeFileSync(join(OUT, "icon.ico"), makeIco(png256, 256));
writeFileSync(join(OUT, "icon.png"), png256);
console.log("icons generated in", OUT);
