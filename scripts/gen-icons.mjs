// Generates Galaxy Terminal brand icons (PNG + ICO).
// Logo concept: Grok-style monochrome singularity / spiral-galaxy "G".
// Prefer regenerating from public/logo.png (master art) when present;
// otherwise draw a procedural black-hole mark.
//
// Run: node scripts/gen-icons.mjs
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "src-tauri", "icons");
const PUBLIC = join(ROOT, "public");
mkdirSync(OUT, { recursive: true });
mkdirSync(PUBLIC, { recursive: true });

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

function encodePngRGBA(size, rgba /* Buffer size*size*4 */) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0;
    rgba.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Procedural Grok-style singularity mark (fallback when no master PNG). */
function drawSingularity(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const R = size * 0.42;
  const hole = size * 0.14;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const r = Math.hypot(dx, dy);
      const ang = Math.atan2(dy, dx); // -PI..PI
      const o = (y * size + x) * 4;

      // deep space background
      let v = 0;

      // soft outer glow
      if (r < R * 1.35) {
        const g = Math.max(0, 1 - r / (R * 1.35));
        v = Math.max(v, Math.pow(g, 3) * 28);
      }

      // accretion disk ring with spiral modulation
      if (r > hole * 0.95 && r < R) {
        const t = (r - hole) / (R - hole); // 0..1 across ring
        // bright near inner edge, falloff outward
        let ring = Math.sin(Math.PI * Math.min(1, t * 1.15));
        ring = Math.pow(Math.max(0, ring), 0.65);
        // spiral arms (galaxy + G opening on the right)
        const spiral = 0.55 + 0.45 * Math.sin(ang * 2.2 - t * 5.5);
        // open gap / G-tail on lower-right
        let gap = 1;
        if (ang > 0.15 && ang < 1.35 && t > 0.35) {
          gap = Math.max(0.05, 1 - (ang - 0.15) / 1.2 * (t - 0.2));
        }
        // bright trailing arm
        let arm = 0;
        if (ang > 0.4 && ang < 2.2 && t > 0.45) {
          arm = Math.pow(Math.max(0, Math.sin((ang - 0.4) * 1.4)), 1.5) * (t - 0.4) * 1.4;
        }
        v = Math.max(v, (ring * spiral * gap + arm) * 255);
      }

      // event horizon core
      if (r < hole) {
        v = 0;
      } else if (r < hole * 1.15) {
        // sharp rim
        v = Math.max(v, 220);
      }

      const c = Math.min(255, Math.round(v));
      rgba[o] = c;
      rgba[o + 1] = c;
      rgba[o + 2] = Math.min(255, Math.round(c * 1.02));
      rgba[o + 3] = 255;
      // near-black background as deep space brand color
      if (c < 8) {
        rgba[o] = 5;
        rgba[o + 1] = 7;
        rgba[o + 2] = 15;
      }
    }
  }
  return rgba;
}

function makeIco(pngBlobs /* {size, buf}[] */) {
  const count = pngBlobs.length;
  let offset = 6 + 16 * count;
  const entries = [];
  const blobs = [];
  for (const { size, buf } of pngBlobs) {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(buf.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    blobs.push(buf);
    offset += buf.length;
  }
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);
  return Buffer.concat([header, ...entries, ...blobs]);
}

// Build sizes from procedural mark (reliable at 16–32px).
const sizes = [16, 32, 48, 128, 256];
const pngBySize = {};
for (const s of sizes) {
  pngBySize[s] = encodePngRGBA(s, drawSingularity(s));
}

writeFileSync(join(OUT, "32x32.png"), pngBySize[32]);
writeFileSync(join(OUT, "128x128.png"), pngBySize[128]);
writeFileSync(join(OUT, "128x128@2x.png"), pngBySize[256]);
writeFileSync(join(OUT, "icon.png"), pngBySize[256]);
writeFileSync(join(PUBLIC, "icon.png"), pngBySize[256]);
// Keep high-res art logo if present; otherwise write procedural 512
if (!existsSync(join(PUBLIC, "logo.png"))) {
  writeFileSync(join(PUBLIC, "logo.png"), encodePngRGBA(512, drawSingularity(512)));
}
writeFileSync(
  join(OUT, "icon.ico"),
  makeIco([
    { size: 16, buf: pngBySize[16] },
    { size: 32, buf: pngBySize[32] },
    { size: 48, buf: pngBySize[48] },
    { size: 256, buf: pngBySize[256] },
  ]),
);

console.log("Galaxy singularity icons written to", OUT);
console.log("UI icon:", join(PUBLIC, "icon.png"));
