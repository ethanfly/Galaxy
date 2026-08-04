// Generates all web and Tauri brand assets from one authored SVG master.
// Run: node scripts/gen-icons.mjs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

import pngjs from "pngjs";

const { PNG } = pngjs;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_MASTER = join(ROOT, "src-tauri", "icons", "logo-master.png");
const DEFAULT_PUBLIC = join(ROOT, "public");
const DEFAULT_TAURI = join(ROOT, "src-tauri", "icons");

export function generateIconAssets({
  masterPath = DEFAULT_MASTER,
  publicDir = DEFAULT_PUBLIC,
  tauriDir = DEFAULT_TAURI,
} = {}) {
  const master = PNG.sync.read(readFileSync(masterPath));
  validateMaster(master);
  mkdirSync(publicDir, { recursive: true });
  mkdirSync(tauriDir, { recursive: true });

  const pngBySize = new Map();
  const render = (size) => {
    if (!pngBySize.has(size)) {
      pngBySize.set(size, renderPng(master, size));
    }
    return pngBySize.get(size);
  };

  writeFileSync(join(publicDir, "icon.png"), render(256));
  writeFileSync(join(publicDir, "apple-touch-icon.png"), render(180));
  writeFileSync(join(tauriDir, "32x32.png"), render(32));
  writeFileSync(join(tauriDir, "128x128.png"), render(128));
  writeFileSync(join(tauriDir, "128x128@2x.png"), render(256));
  writeFileSync(join(tauriDir, "icon.png"), render(256));
  writeFileSync(
    join(tauriDir, "icon.ico"),
    makeIco([16, 32, 48, 256].map((size) => ({ size, buffer: render(size) }))),
  );

  return { publicDir, tauriDir };
}

function validateMaster(master) {
  if (master.width !== 1024 || master.height !== 1024) {
    throw new Error("Galaxy master PNG must be 1024x1024");
  }
}

function renderPng(source, size) {
  const image = resizeBilinear(source, size);
  applyRoundedMask(image);
  return PNG.sync.write(image);
}

function resizeBilinear(source, size) {
  const output = new PNG({ width: size, height: size });
  const scaleX = source.width / size;
  const scaleY = source.height / size;

  for (let y = 0; y < size; y += 1) {
    const sourceY = Math.max(0, Math.min(source.height - 1, (y + 0.5) * scaleY - 0.5));
    const y0 = Math.floor(sourceY);
    const y1 = Math.min(source.height - 1, y0 + 1);
    const weightY = sourceY - y0;

    for (let x = 0; x < size; x += 1) {
      const sourceX = Math.max(0, Math.min(source.width - 1, (x + 0.5) * scaleX - 0.5));
      const x0 = Math.floor(sourceX);
      const x1 = Math.min(source.width - 1, x0 + 1);
      const weightX = sourceX - x0;
      const outputOffset = (y * size + x) * 4;

      for (let channel = 0; channel < 4; channel += 1) {
        const topLeft = source.data[(y0 * source.width + x0) * 4 + channel];
        const topRight = source.data[(y0 * source.width + x1) * 4 + channel];
        const bottomLeft = source.data[(y1 * source.width + x0) * 4 + channel];
        const bottomRight = source.data[(y1 * source.width + x1) * 4 + channel];
        const top = topLeft + (topRight - topLeft) * weightX;
        const bottom = bottomLeft + (bottomRight - bottomLeft) * weightX;
        output.data[outputOffset + channel] = Math.round(top + (bottom - top) * weightY);
      }
    }
  }

  return output;
}

function applyRoundedMask(image, radiusRatio = 0.25) {
  const radius = image.width * radiusRatio;
  const farCenter = image.width - radius;

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const pixelX = x + 0.5;
      const pixelY = y + 0.5;
      const centerX = pixelX < radius ? radius : pixelX > farCenter ? farCenter : pixelX;
      const centerY = pixelY < radius ? radius : pixelY > farCenter ? farCenter : pixelY;
      if (Math.hypot(pixelX - centerX, pixelY - centerY) > radius) {
        image.data[(y * image.width + x) * 4 + 3] = 0;
      }
    }
  }
}

function makeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const entries = [];
  const buffers = [];
  for (const { size, buffer } of images) {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(buffer.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    buffers.push(buffer);
    offset += buffer.length;
  }
  return Buffer.concat([header, ...entries, ...buffers]);
}

function cliOptions() {
  const { values } = parseArgs({
    options: {
      master: { type: "string", default: DEFAULT_MASTER },
      "public-dir": { type: "string", default: DEFAULT_PUBLIC },
      "tauri-dir": { type: "string", default: DEFAULT_TAURI },
    },
  });
  return {
    masterPath: resolve(values.master),
    publicDir: resolve(values["public-dir"]),
    tauriDir: resolve(values["tauri-dir"]),
  };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const result = generateIconAssets(cliOptions());
  console.log("Galaxy brand icons written to", result.tauriDir);
  console.log("Web icons written to", result.publicDir);
}
