// Sync version across package.json, src-tauri/Cargo.toml, tauri.conf.json.
// Usage:
//   node scripts/bump-version.mjs              # print current
//   node scripts/bump-version.mjs 1.2.3        # set exact
//   node scripts/bump-version.mjs patch|minor|major
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function readJson(p) {
  return JSON.parse(readFileSync(p, "utf8"));
}
function writeJson(p, obj) {
  writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

function parseSemver(v) {
  const m = String(v).trim().replace(/^v/, "").match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!m) throw new Error(`Invalid semver: ${v}`);
  return { major: +m[1], minor: +m[2], patch: +m[3] };
}

function fmt({ major, minor, patch }) {
  return `${major}.${minor}.${patch}`;
}

function bump(cur, kind) {
  const s = parseSemver(cur);
  if (kind === "major") return fmt({ major: s.major + 1, minor: 0, patch: 0 });
  if (kind === "minor") return fmt({ major: s.major, minor: s.minor + 1, patch: 0 });
  if (kind === "patch") return fmt({ major: s.major, minor: s.minor, patch: s.patch + 1 });
  throw new Error(`Unknown bump kind: ${kind}`);
}

const pkgPath = join(root, "package.json");
const cargoPath = join(root, "src-tauri", "Cargo.toml");
const tauriPath = join(root, "src-tauri", "tauri.conf.json");

const pkg = readJson(pkgPath);
const arg = process.argv[2];
let next = pkg.version;

if (!arg) {
  console.log(pkg.version);
  process.exit(0);
}

if (arg === "patch" || arg === "minor" || arg === "major") {
  next = bump(pkg.version, arg);
} else {
  next = fmt(parseSemver(arg));
}

// package.json
pkg.version = next;
writeJson(pkgPath, pkg);

// tauri.conf.json
const tauri = readJson(tauriPath);
tauri.version = next;
writeJson(tauriPath, tauri);

// Cargo.toml package.version only (first occurrence under [package])
let cargo = readFileSync(cargoPath, "utf8");
let seenPackage = false;
cargo = cargo
  .split("\n")
  .map((line) => {
    if (line.trim() === "[package]") seenPackage = true;
    if (seenPackage && /^version\s*=\s*".*"/.test(line)) {
      seenPackage = false;
      return `version = "${next}"`;
    }
    if (line.startsWith("[")) seenPackage = false;
    return line;
  })
  .join("\n");
writeFileSync(cargoPath, cargo, "utf8");

console.log(`version -> ${next}`);
console.log(`  package.json`);
console.log(`  src-tauri/tauri.conf.json`);
console.log(`  src-tauri/Cargo.toml`);
