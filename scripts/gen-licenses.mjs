// Generates docs/THIRD_PARTY_LICENSES.md from npm + cargo metadata.
// Run: node scripts/gen-licenses.mjs
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const out = [];
out.push("# 第三方许可清单\n");
out.push("本清单由 `npm run gen:licenses` 生成，列出随银河终端分发的第三方组件及其许可。完整许可文本见各依赖源码包。\n");

out.push("\n## Rust (cargo) 依赖（顶层）\n");
try {
  const tree = execSync("cargo tree --locked --edges normal --depth 1 --format {p},{l}", {
    cwd: new URL("../src-tauri", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
    encoding: "utf8",
  });
  out.push("| 组件 | 许可 |\n| --- | --- |");
  for (const line of tree.trim().split("\n").slice(1)) {
    const cleaned = line.replace(/^[│\s├└─]+/, "");
    const [pkg, license] = splitLast(cleaned, ",");
    if (!pkg?.trim()) continue;
    out.push(`| ${pkg.trim()} | ${(license ?? "").trim() || "见 crates.io"} |`);
  }
} catch (e) {
  out.push(`（当前环境无法运行 cargo tree：${e.message.split("\n")[0]}）`);
}

out.push("\n## npm 依赖（生产）\n");
try {
  const npmList = execSync("npm ls --omit=dev --json --long", { encoding: "utf8" });
  const data = JSON.parse(npmList);
  out.push("| 组件 | 许可 |\n| --- | --- |");
  const seen = new Set();
  const walk = (deps) => {
    for (const [name, info] of Object.entries(deps ?? {})) {
      if (seen.has(name) || info.extraneous) continue;
      seen.add(name);
      const lic = typeof info.license === "string" ? info.license : info.licenses;
      out.push(`| ${name}@${info.version ?? "?"} | ${lic ?? "见 npmjs.com"} |`);
      walk(info.dependencies);
    }
  };
  walk(data.dependencies);
} catch (e) {
  out.push(`（当前环境无法运行 npm ls：${e.message.split("\n")[0]}）`);
}

out.push("\n## 说明\n");
out.push("- xterm.js、React、Tauri 等核心组件均为 MIT/Apache-2.0 许可。");
out.push("- Windows 平台组件（WebView2 Runtime）随系统分发，不属于打包第三方组件。");
out.push("- 商业分发时本清单随安装包提供（见 docs/RELEASE.md §6）。\n");

function splitLast(s, sep) {
  const idx = s.lastIndexOf(sep);
  return idx === -1 ? [s, ""] : [s.slice(0, idx), s.slice(idx + 1)];
}

const path = new URL("../docs/THIRD_PARTY_LICENSES.md", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
writeFileSync(path, out.join("\n") + "\n");
console.log("licenses written to", path);
