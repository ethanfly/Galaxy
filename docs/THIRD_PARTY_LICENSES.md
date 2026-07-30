# 第三方许可清单

本清单由 `npm run gen:licenses` 生成，列出随银河终端分发的第三方组件及其许可。完整许可文本见各依赖源码包。


## Rust (cargo) 依赖（顶层）

| 组件 | 许可 |
| --- | --- |
| directories v5.0.1 | MIT OR Apache-2.0 |
| notify v6.1.1 | CC0-1.0 |
| parking_lot v0.12.5 | MIT OR Apache-2.0 |
| portable-pty v0.8.1 | MIT |
| regex v1.13.1 | MIT OR Apache-2.0 |
| rusqlite v0.31.0 | MIT |
| serde v1.0.229 | MIT OR Apache-2.0 |
| serde_json v1.0.151 | MIT OR Apache-2.0 |
| tauri v2.11.5 | Apache-2.0 OR MIT |
| tauri-plugin-dialog v2.7.2 | Apache-2.0 OR MIT |
| tauri-plugin-global-shortcut v2.3.2 | Apache-2.0 OR MIT |
| tauri-plugin-notification v2.3.3 | Apache-2.0 OR MIT |
| tauri-plugin-opener v2.5.4 | Apache-2.0 OR MIT |
| tauri-plugin-process v2.3.1 | Apache-2.0 OR MIT |
| tauri-plugin-single-instance v2.4.3 | Apache-2.0 OR MIT |
| tauri-plugin-updater v2.10.1 | Apache-2.0 OR MIT |
| thiserror v2.0.19 | MIT OR Apache-2.0 |
| time v0.3.54 | MIT OR Apache-2.0 |
| tracing v0.1.44 | MIT |
| tracing-subscriber v0.3.23 | MIT |
| uuid v1.24.0 | Apache-2.0 OR MIT |
| winreg v0.52.0 | MIT |

## npm 依赖（生产）

| 组件 | 许可 |
| --- | --- |
| @tauri-apps/api@2.11.1 | Apache-2.0 OR MIT |
| @tauri-apps/plugin-dialog@2.7.2 | MIT OR Apache-2.0 |
| @xterm/addon-fit@0.10.0 | MIT |
| @xterm/addon-search@0.15.0 | MIT |
| @xterm/addon-web-links@0.11.0 | MIT |
| @xterm/addon-webgl@0.18.0 | MIT |
| @xterm/xterm@5.5.0 | MIT |
| react-dom@18.3.1 | MIT |
| react@18.3.1 | MIT |
| zustand@5.0.14 | MIT |

## 说明

- xterm.js、React、Tauri 等核心组件均为 MIT/Apache-2.0 许可。
- Windows 平台组件（WebView2 Runtime）随系统分发，不属于打包第三方组件。
- 商业分发时本清单随安装包提供（见 docs/RELEASE.md §6）。

