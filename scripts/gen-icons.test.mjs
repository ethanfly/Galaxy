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
const MASTER = join(ROOT, "src-tauri", "icons", "logo-master.png");

const outputs = [
  ["public", "icon.png", 256],
  ["public", "apple-touch-icon.png", 180],
  ["tauri", "32x32.png", 32],
  ["tauri", "128x128.png", 128],
  ["tauri", "128x128@2x.png", 256],
  ["tauri", "icon.png", 256],
  ["tauri", "icon.ico", null],
];

test("renders the original PNG brand with a 25 percent transparent corner radius", async (t) => {
  assert.ok(existsSync(MASTER), "authored master PNG must exist");
  const { default: pngjs } = await import("pngjs");
  const { PNG } = pngjs;
  const master = PNG.sync.read(readFileSync(MASTER));
  assert.deepEqual([master.width, master.height], [1024, 1024]);

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
  assert.equal(alphaAt(icon, 0, 0), 0, "top-left pixel must be transparent");
  assert.equal(alphaAt(icon, 255, 0), 0, "top-right pixel must be transparent");
  assert.equal(alphaAt(icon, 0, 255), 0, "bottom-left pixel must be transparent");
  assert.equal(alphaAt(icon, 255, 255), 0, "bottom-right pixel must be transparent");
  assert.ok(alphaAt(icon, 64, 8) > 0, "pixels inside the 25 percent radius must remain visible");
  assert.ok(alphaAt(icon, 128, 128) > 0, "the logo center must remain visible");

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
    maxChannelSpread <= 8,
    `brand raster contains chromatic pixels (channel spread ${maxChannelSpread})`,
  );
  assert.deepEqual(readIcoSizes(readFileSync(join(tauriDir, "icon.ico")), PNG), [16, 32, 48, 256]);

  for (const [area, name, expectedSize] of outputs) {
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
    if (expectedSize != null) {
      const decoded = PNG.sync.read(readFileSync(generated));
      assert.deepEqual(
        [decoded.width, decoded.height],
        [expectedSize, expectedSize],
        `${name} has the wrong dimensions`,
      );
    }
  }
});

function alphaAt(image, x, y) {
  return image.data[(y * image.width + x) * 4 + 3];
}

function readIcoSizes(buffer, PNG) {
  assert.equal(buffer.readUInt16LE(0), 0, "ICO reserved header must be zero");
  assert.equal(buffer.readUInt16LE(2), 1, "ICO type must be icon");
  const count = buffer.readUInt16LE(4);
  const sizes = [];
  for (let index = 0; index < count; index += 1) {
    const entryOffset = 6 + index * 16;
    const width = buffer[entryOffset] || 256;
    const height = buffer[entryOffset + 1] || 256;
    const byteLength = buffer.readUInt32LE(entryOffset + 8);
    const imageOffset = buffer.readUInt32LE(entryOffset + 12);
    assert.equal(width, height, "ICO entry must be square");
    assert.ok(imageOffset >= 6 + count * 16, "ICO payload overlaps its directory");
    assert.ok(imageOffset + byteLength <= buffer.length, "ICO payload exceeds file bounds");

    const payload = buffer.subarray(imageOffset, imageOffset + byteLength);
    assert.deepEqual(
      [...payload.subarray(0, 8)],
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      "ICO payload must be PNG",
    );
    const decoded = PNG.sync.read(payload);
    assert.deepEqual([decoded.width, decoded.height], [width, height]);
    sizes.push(width);
  }
  return sizes;
}
