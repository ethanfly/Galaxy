import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const GENERATOR = join(ROOT, "scripts", "gen-icons.mjs");
const MASTER = join(ROOT, "public", "brand", "galaxy-mark.svg");

const outputs = [
  ["public", "icon.png"],
  ["public", "apple-touch-icon.png"],
  ["tauri", "32x32.png"],
  ["tauri", "128x128.png"],
  ["tauri", "128x128@2x.png"],
  ["tauri", "icon.png"],
  ["tauri", "icon.ico"],
];

test("renders neutral package icons with transparent outside corners", async (t) => {
  assert.ok(existsSync(MASTER), "authored master SVG must exist");
  const { default: pngjs } = await import("pngjs");
  const { PNG } = pngjs;

  const root = mkdtempSync(join(tmpdir(), "galaxy-icons-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const publicDir = join(root, "public");
  const tauriDir = join(root, "tauri");

  execFileSync(
    process.execPath,
    [
      GENERATOR,
      "--master",
      MASTER,
      "--public-dir",
      publicDir,
      "--tauri-dir",
      tauriDir,
    ],
    { cwd: ROOT, stdio: "pipe" },
  );

  const icon = PNG.sync.read(readFileSync(join(tauriDir, "icon.png")));
  assert.deepEqual([icon.width, icon.height], [256, 256]);
  assert.equal(icon.data[3], 0, "top-left pixel must remain transparent");

  let visiblePixels = 0;
  let maxChannelSpread = 0;
  for (let index = 0; index < icon.data.length; index += 4) {
    if (icon.data[index + 3] === 0) continue;
    visiblePixels += 1;
    const channels = [icon.data[index], icon.data[index + 1], icon.data[index + 2]];
    maxChannelSpread = Math.max(
      maxChannelSpread,
      Math.max(...channels) - Math.min(...channels),
    );
  }
  assert.ok(visiblePixels > 0, "brand raster must contain visible pixels");
  assert.ok(
    maxChannelSpread <= 2,
    `brand raster contains chromatic pixels (channel spread ${maxChannelSpread})`,
  );
  assert.deepEqual(readIcoSizes(readFileSync(join(tauriDir, "icon.ico"))), [16, 32, 48, 256]);

  for (const [area, name] of outputs) {
    const generated = join(area === "public" ? publicDir : tauriDir, name);
    const committed = join(
      area === "public" ? join(ROOT, "public") : join(ROOT, "src-tauri", "icons"),
      name,
    );
    assert.deepEqual(
      readFileSync(generated),
      readFileSync(committed),
      `${name} is stale; run npm run gen:icons`,
    );
  }
});

function readIcoSizes(buffer) {
  const count = buffer.readUInt16LE(4);
  const sizes = [];
  for (let index = 0; index < count; index += 1) {
    const size = buffer[6 + index * 16];
    sizes.push(size === 0 ? 256 : size);
  }
  return sizes;
}
