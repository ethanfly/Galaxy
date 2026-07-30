# 商业发布指南

本文件覆盖 §9.3 要求的安装、升级、卸载、签名、许可、隐私、变更记录与可复现构建步骤。

## 0. 自动构建 / 版本 / 发布（GitHub Actions）

| 流程 | Workflow | 触发 | 作用 |
| --- | --- | --- | --- |
| 持续集成 | `test.yml` | push/PR → `main` | **只跑测试**，不发版 |
| **发版（推荐）** | `version.yml` | Actions **手动** Run | bump 版本 → 打标签 → **同一次流水线**构建 NSIS → 创建 GitHub Release |
| 发版（标签） | `release.yml` | 推送 `v*.*.*`（本地 `git push --tags`） | 构建 NSIS → GitHub Release |

> **重要：** 推送到 `main` 只会跑 **test**，不会自动出现在 Releases。  
> GitHub 规定：用默认 `GITHUB_TOKEN` 推送的 tag **不会**再触发别的 workflow，所以「Version & Tag」里已经把 **构建 + 发布** 串在同一条流水线里。

### 发一版（推荐）

1. 打开仓库 **Actions → Version & Tag → Run workflow**
2. 选择 `patch` / `minor` / `major`（不要勾 dry_run）
3. 等待 Windows job 结束
4. 打开 [Releases](https://github.com/ethanfly/Galaxy/releases) 下载 `*-setup.exe`

本地等价：

```bash
npm run version:patch   # 或 minor / major
git add package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json src-tauri/Cargo.lock
git commit -m "chore(release): v$(npm run -s version:show)"
git tag "v$(npm run -s version:show)"
git push origin main --tags
```

### 可选 Secrets（不配也能构建发布，只是不签名/不启用 updater）

| Secret | 用途 |
| --- | --- |
| `SM_CERTIFICATE_BASE64` | 代码签名 PFX（Base64） |
| `SM_CERTIFICATE_PASSWORD` | PFX 密码 |
| `TAURI_UPDATER_PUBKEY` | 更新公钥（写入 tauri.conf） |
| `TAURI_SIGNING_PRIVATE_KEY` | 更新包签名私钥 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 私钥密码 |

## 1. 构建环境（可复现）

| 组件 | 版本要求 | 获取方式 |
| --- | --- | --- |
| Windows | 10/11 x64 | — |
| Node.js | ≥ 20 (开发使用 26) | <https://nodejs.org> |
| Rust | stable ≥ 1.85, host `x86_64-pc-windows-msvc` | <https://rustup.rs> |
| MSVC Build Tools | Visual Studio 2022 Build Tools（VCTools + Windows 11 SDK 22621） | `winget install Microsoft.VisualStudio.2022.BuildTools --override "--quiet --add Microsoft.VisualStudio.Workload.VCTools --add Microsoft.VisualStudio.Component.Windows11SDK.22621"` |
| WebView2 Runtime | Windows 10/11 自带或常青版 | 随系统分发 |

锁定版本：`package-lock.json`（npm）与 `src-tauri/Cargo.lock`（cargo）均提交仓库；CI 使用 `--locked` 构建。

## 2. 可复现构建步骤

```powershell
git clone <repo> galaxy-terminal
cd galaxy-terminal

npm ci
npm run gen:icons           # 重新生成像素图标（幂等，纯 Node 脚本无外部依赖）
npm run tauri build -- -- --locked   # 第二个 `--` 把 --locked 交给 cargo
```

产物：

- `src-tauri/target/release/galaxy-terminal.exe`
- `src-tauri/target/release/bundle/nsis/Galaxy Terminal_0.1.0_x64-setup.exe`

干净容器中的验证脚本：`.github/workflows/release.yml` 即在干净 Windows runner 执行同样步骤。

## 3. NSIS 安装包与右键菜单

- 安装模式：`currentUser`（无需管理员）；支持中/英文语言选择。
- `src-tauri/installer-hooks.nsh` 自定义模板在 `postInstall` 写入 HKCU 资源管理器右键菜单（目录/目录背景/驱动器 → “在此处打开银河终端”，命令 `<exe> --open-here "%1"/"%V"`），卸载钩子全部清除。
- 应用内也可在 设置 → 通用 随时增删右键菜单（`context_menu_set` 命令，HKCU 不需要提权）。

## 4. 代码签名

- 证书从不入库。CI 密钥：`SM_CERTIFICATE_BASE64`（PFX Base64）与 `SM_CERTIFICATE_PASSWORD`。
- `release` workflow 使用 signtool：`signtool sign /fd SHA256 /td SHA256 /tr http://timestamp.digicert.com <exe>` 同时签署主二进制与 NSIS 安装包。
- 签名后自动执行 `signtool verify /pa` 校验。

## 5. 自动更新（签名清单 + 通道 + 回滚）

- Tauri updater 插件在 dev 构建关闭；发布时由 CI 将 `src-tauri/tauri.conf.json` 的 `plugins.updater` 改为 `active: true` 并注入 `TAURI_UPDATER_PUBKEY`（私钥存 CI 密钥 `TAURI_SIGNING_PRIVATE_KEY`）。
- `bundle.createUpdaterArtifacts: true` 只在 release workflow 设置，生成 `.sig` 与清单 JSON；上传至 `releases.galaxy-terminal.dev/{target}/{arch}/{version}`。
- 通道：端点域名下 `/stable/…` 与 `/preview/…` 两条路径；`updater_check` 命令在设置页提供手动检查，失败时静默回退（不影响运行）。
- 回滚：清单保留最近两个版本；安装失败时 NSIS 被动模式回退为上一目录备份（`installMode: passive` 由 updater 插件保证原子替换）。

## 6. 发布物清单（§9.3）

每个 GitHub Release 包含：

1. `galaxy-terminal_x.y.z_x64-setup.exe`（已签名 NSIS 安装包）+ `.sig`
2. `SHA256SUMS.txt`
3. `docs/THIRD_PARTY_LICENSES.md`（由 `npm run gen:licenses` 生成，含 `cargo tree` 与 `npm ls` 许可）
4. `docs/PRIVACY.md` 隐私说明
5. `docs/CHANGELOG.md` 变更记录
6. `docs/RELEASE.md` 本文件（含可复现构建步骤）
7. 诊断说明（设置中心 → 诊断可生成脱敏报告）

## 7. 干净虚拟机验收清单

- [ ] Windows 10 与 11 干净 VM 安装/升级（旧版数据保留）/卸载（注册表与安装目录清除）
- [ ] 右键菜单三项可用；`--open-here` 单例转发聚焦已有窗口
- [ ] 单例：双击第二次不新开进程
- [ ] WebView2 缺失机器给出去向提示（Tauri 内建引导）
- [ ] `CAPTURE_SCREEN=1` 启动后自动截图稳定（软件渲染）

## 8. 性能基线（§9.2）

`docs/PERFORMANCE.md` 记录每次发布的吞吐/批量/内存/启动基线。回归阈值：任意指标劣化 >15% 阻止发布。
