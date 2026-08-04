// Generates all web and Tauri brand assets from one authored SVG master.
// Run: node scripts/gen-icons.mjs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

import { Resvg } from "@resvg/resvg-js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_MASTER = join(ROOT, "public", "brand", "galaxy-mark.svg");
const DEFAULT_PUBLIC = join(ROOT, "public");
const DEFAULT_TAURI = join(ROOT, "src-tauri", "icons");

export function generateIconAssets({
  masterPath = DEFAULT_MASTER,
  publicDir = DEFAULT_PUBLIC,
  tauriDir = DEFAULT_TAURI,
} = {}) {
  const svg = readFileSync(masterPath);
  validateMaster(svg.toString("utf8"));
  mkdirSync(publicDir, { recursive: true });
  mkdirSync(tauriDir, { recursive: true });

  const pngBySize = new Map();
  const render = (size) => {
    if (!pngBySize.has(size)) {
      const image = new Resvg(svg, {
        fitTo: { mode: "width", value: size },
      }).render();
      pngBySize.set(size, Buffer.from(image.asPng()));
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

function validateMaster(svg) {
  if (!/viewBox=["']0 0 64 64["']/.test(svg)) {
    throw new Error("Galaxy master SVG must use viewBox 0 0 64 64");
  }
  if (/<(?:linearGradient|radialGradient|filter|image)\b/i.test(svg)) {
    throw new Error("Galaxy master SVG must remain flat vector geometry");
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
