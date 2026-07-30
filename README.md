# 银河终端 Galaxy Terminal

面向开发者与多 Agent 工作流的商业级多终端管理软件（Windows 10/11 优先）。

技术栈：**Tauri 2 + Rust + React + TypeScript + xterm.js (WebGL)**，银河像素风视觉主题。

## 功能总览

- **全局多标签**（跨项目、拖拽排序、重命名、关闭其他、Ctrl+W）与动态 OSC 0 标题
- **递归分屏**（向右/向下、拖动权重、方向键切 pane、Alt+Shift+方向键调尺寸、同步输入、跨标签移动）
- **高吞吐数据通路**：PTY 输出按调度窗口合并为单次 IPC；序列号缺口自动环形缓冲重放；单 pane 独立配额
- **xterm.js WebGL** 渲染，初始化失败/上下文丢失自动回退，不中断 PTY
- **命令块**（OSC 133 Shell Integration 优先 + 启发式兜底）：复制命令/输出/重跑/收藏，`blocks.jsonl` 限量 500（收藏不淘汰）
- **三类搜索**：Ctrl+F 终端查找 · Ctrl+Shift+F 命令块 · Ctrl+R 统一历史/收藏 · Ctrl+P 命令面板
- **六个 Agent 适配器**（Claude Code / Codex CLI / OpenCode / OMP / Grok Build / Crush）：历史扫描、消息查看、一键恢复注入、idle/working/blocked/done 状态与通知
- **Git 面板与状态栏**（分支、ahead/behind、变更、checkout — 冲突原文显示，绝不自动 stash/reset）
- **Workflow** 参数化模板（类型校验 + 解析预览 + 运行确认）与**触发器**（限长正则 + 冷却 + 通知/标记/响铃/停滚）
- **设置中心**：通用/Workflows/布局模板/触发器/快捷键（冲突阻止）/诊断（脱敏报告）
- **Windows 集成**：自定义标题栏、强制深色、单例 + `--open-here` 转发、窗口状态记忆、资源管理器右键菜单、Shell 自动探测（PowerShell/pwsh/cmd/Git Bash/WSL）、CAPTURE_SCREEN 软件渲染截图模式

## 开发

```bash
npm install            # 前端依赖 + Tauri CLI
cargo test             # 后端正需要 MSVC Build Tools (x86_64-pc-windows-msvc)
npm run tauri dev      # 启动开发模式 (vite + 后端)
```

### 测试

| 层 | 命令 | 覆盖 |
| --- | --- | --- |
| Rust 单元 | `cargo test --lib` | 布局树/不变量/迁移/Shell 探测/6 类 Agent 解析/命令块/触发器 |
| Rust 集成 | `cargo test --test pty_integration --test services_integration` | 真实 ConPTY/PowerShell/cmd 吞吐、Git 真实仓库、IPC 契约面 |
| TS 单元 | `npm test` | UI 状态/快捷键/标签/格式化/序列号跟踪 |
| UI 层 E2E | `npx playwright test --project=ui` | 应用外壳、命令面板、快捷键路由 |
| 视觉回归 | `GALAXY_APP_E2E=1 npx playwright test --project=app` | 发布管线内执行（CAPTURE_SCREEN 模式） |

## 构建与发布

```bash
npm run tauri build    # 产出 NSIS 安装包 (src-tauri/target/release/bundle/nsis)
```

发布流程（签名、更新清单、许可清单、可复现步骤）见 [docs/RELEASE.md](docs/RELEASE.md)。
第三方许可清单见 [docs/THIRD_PARTY_LICENSES.md](docs/THIRD_PARTY_LICENSES.md)，隐私说明见 [docs/PRIVACY.md](docs/PRIVACY.md)。
