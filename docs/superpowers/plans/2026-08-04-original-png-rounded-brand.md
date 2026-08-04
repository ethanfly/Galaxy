# Original PNG Rounded Brand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the confirmed 1024×1024 historical PNG logo, apply a 25% transparent corner radius, and use its generated assets everywhere Galaxy Terminal displays application branding.

**Architecture:** Keep `src-tauri/icons/logo-master.png` as the single authored raster source. `scripts/gen-icons.mjs` decodes it with `pngjs`, bilinearly resizes it, applies an alpha mask with radius `size * 0.25`, and writes deterministic Web/Tauri PNG and multi-resolution ICO outputs. The React title bar consumes the generated Web PNG while Tauri and NSIS continue consuming the generated package assets declared in `tauri.conf.json`.

**Tech Stack:** Node.js 22, ESM, `pngjs`, React/TypeScript, Vitest, Tauri 2, Rust, NSIS

## Global Constraints

- Use the exact 1024×1024 `logo-master.png` from commit `56ee171`; do not redraw or substitute the logo.
- Preserve the white brush-stroke G, black background, composition, and glow.
- Apply a corner radius equal to 25% of each square output width; pixels outside the rounded rectangle must be transparent.
- Generate 16, 32, 48, 128, 180, and 256 pixel raster sizes as required by Web, Tauri, and ICO consumers.
- Keep the current monochrome UI theme and Lucide functional icon system unchanged.
- Do not bump version `0.1.8`.
- Do not add the user-provided `AGENTS.md` or `.superpowers/` brainstorming artifacts to Git.

---

### Task 1: Restore the authored PNG and specify deterministic rounded output

**Files:**
- Restore: `src-tauri/icons/logo-master.png`
- Modify: `scripts/gen-icons.test.mjs`
- Modify: `scripts/gen-icons.mjs`

**Interfaces:**
- Consumes: `src-tauri/icons/logo-master.png`, exactly 1024×1024 RGBA-compatible PNG.
- Produces: `generateIconAssets({ masterPath, publicDir, tauriDir })`; PNG outputs and `icon.ico` at the existing paths.

- [ ] **Step 1: Restore the exact historical master PNG**

Run:

```powershell
git restore --source 56ee171 -- src-tauri/icons/logo-master.png
Get-FileHash src-tauri/icons/logo-master.png -Algorithm SHA256
```

Expected SHA-256: `4166350AB89FF0C0456D5ADB79AD005708523CDE1D039A59AAB4E2CAA3D023D6`.

- [ ] **Step 2: Write failing tests for the PNG master and 25% rounded alpha mask**

Update `scripts/gen-icons.test.mjs` so its master constant targets `src-tauri/icons/logo-master.png`. Decode the master and assert `[width, height]` equals `[1024, 1024]`. For generated `icon.png`, assert the four corner alpha bytes are zero, the center alpha is nonzero, and pixels immediately inside the 25% rounded boundary are visible. Retain the existing ICO size and byte-for-byte committed-output assertions.

Use this boundary helper in the test:

```js
function alphaAt(image, x, y) {
  return image.data[(y * image.width + x) * 4 + 3];
}

assert.equal(alphaAt(icon, 0, 0), 0);
assert.equal(alphaAt(icon, 255, 0), 0);
assert.equal(alphaAt(icon, 0, 255), 0);
assert.equal(alphaAt(icon, 255, 255), 0);
assert.ok(alphaAt(icon, 64, 8) > 0);
assert.ok(alphaAt(icon, 128, 128) > 0);
```

- [ ] **Step 3: Run the icon test and verify the new contract fails**

Run: `npm run test:icons`

Expected: FAIL because the current master is an SVG and the generated icon does not derive from the restored historical PNG.

- [ ] **Step 4: Replace SVG rendering with PNG resize and rounded alpha masking**

In `scripts/gen-icons.mjs`, import `PNG` from `pngjs`. Decode and validate the master dimensions. Implement focused helpers with these interfaces:

```js
function resizeBilinear(source, size) // returns PNG
function applyRoundedMask(image, radiusRatio = 0.25) // mutates alpha outside rounded rect
function renderPng(source, size) // returns Buffer from PNG.sync.write
```

For each destination pixel, bilinearly sample the source RGBA values. For the mask, measure each pixel center against the nearest corner center `(radius, radius)` and set alpha to zero when it falls outside the quarter circle. Cache each rendered size as the existing generator does. Keep `makeIco()` and the output paths intact.

- [ ] **Step 5: Generate assets and make the icon test pass**

Run:

```powershell
npm run gen:icons
npm run test:icons
```

Expected: the generator writes all Web/Tauri assets and the icon test passes, including `[16, 32, 48, 256]` ICO entries.

- [ ] **Step 6: Commit the source, generator, tests, and generated assets**

```powershell
git add -- scripts/gen-icons.mjs scripts/gen-icons.test.mjs src-tauri/icons/logo-master.png src-tauri/icons/32x32.png src-tauri/icons/128x128.png src-tauri/icons/128x128@2x.png src-tauri/icons/icon.png src-tauri/icons/icon.ico public/icon.png public/apple-touch-icon.png
git commit -m "feat: restore rounded original PNG brand assets"
```

---

### Task 2: Apply the generated PNG to the in-app title bar

**Files:**
- Modify: `src/features/titlebar/TitleBar.tsx`
- Modify: `src/features/titlebar/TitleBar.test.tsx`
- Modify: `src/index.css`
- Delete: `public/brand/galaxy-mark.svg`

**Interfaces:**
- Consumes: generated `public/icon.png` served by Vite as `./icon.png`.
- Produces: exactly one `<img className="icon-logo" src="./icon.png">` in the title bar.

- [ ] **Step 1: Change the title-bar test first**

In `TitleBar.test.tsx`, change the brand source assertion to:

```ts
expect(mark?.getAttribute("src")).toBe("./icon.png");
expect(container.querySelectorAll("img.icon-logo")).toHaveLength(1);
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npx vitest run src/features/titlebar/TitleBar.test.tsx`

Expected: FAIL because `TitleBar.tsx` still references `./brand/galaxy-mark.svg`.

- [ ] **Step 3: Switch the title bar to the generated PNG**

Change only the image source in `TitleBar.tsx`:

```tsx
<img className="icon-logo" src="./icon.png" alt="" aria-hidden="true" />
```

Keep a single title-bar brand instance. Update the `.icon-logo` comment in `src/index.css` to describe the generated rounded PNG and retain its existing layout dimensions. Delete the obsolete SVG so a stale second brand master cannot survive.

- [ ] **Step 4: Run focused and full frontend tests**

Run:

```powershell
npx vitest run src/features/titlebar/TitleBar.test.tsx
npm test
npx tsc --noEmit
```

Expected: all commands exit zero.

- [ ] **Step 5: Commit the title-bar integration**

```powershell
git add -- src/features/titlebar/TitleBar.tsx src/features/titlebar/TitleBar.test.tsx src/index.css public/brand/galaxy-mark.svg
git commit -m "feat: apply restored brand logo to title bar"
```

---

### Task 3: Verify hotkey fix, brand assets, and package the Windows installer

**Files:**
- Existing uncommitted fix: `src-tauri/src/lib.rs`
- Existing uncommitted fix: `src-tauri/src/commands/system.rs`
- Generated installer: `src-tauri/target/release/bundle/nsis/Galaxy Terminal_0.1.8_x64-setup.exe`

**Interfaces:**
- Consumes: all committed Web/Tauri brand assets and the runtime global-hotkey reconciliation fix.
- Produces: tested NSIS installer and two focused implementation commits pushed on the current feature branch.

- [ ] **Step 1: Re-run complete verification on the final tree**

Run:

```powershell
git diff --check
npm test
npx tsc --noEmit
Push-Location src-tauri
cargo test --locked
Pop-Location
```

Expected: 46 frontend tests and 95 Rust tests pass with no failures; whitespace check and typecheck exit zero.

- [ ] **Step 2: Commit the already-tested global hotkey fix separately**

```powershell
git add -- src-tauri/src/lib.rs src-tauri/src/commands/system.rs
git diff --cached --check
git commit -m "fix: apply global hotkey changes immediately"
```

- [ ] **Step 3: Build the release installer**

Run: `npm run tauri build`

Expected: exit zero and create `src-tauri/target/release/bundle/nsis/Galaxy Terminal_0.1.8_x64-setup.exe`.

- [ ] **Step 4: Verify the installer artifact**

Run:

```powershell
$installer = Resolve-Path 'src-tauri/target/release/bundle/nsis/Galaxy Terminal_0.1.8_x64-setup.exe'
Get-Item $installer | Select-Object FullName,Length,LastWriteTime
Get-FileHash $installer -Algorithm SHA256
```

Expected: nonzero current build size and a reported SHA-256 digest.

- [ ] **Step 5: Audit scope and push**

Run:

```powershell
git status --short
git log -5 --oneline
git push
git rev-parse HEAD
git rev-parse '@{u}'
```

Expected: `AGENTS.md` and `.superpowers/` remain untracked, no intended source edits remain unstaged, push succeeds, and local/upstream hashes match.
