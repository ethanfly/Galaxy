<p align="center">
  <img src="public/brand/galaxy-mark.svg" alt="Galaxy Terminal" width="160" height="160" />
</p>

<h1 align="center">银河终端 Galaxy Terminal</h1>

<p align="center">
  <strong>面向开发者与多 Agent 工作流的商业级多终端工作区</strong><br/>
  Windows 10/11 · Tauri 2 · Rust · React · xterm.js
</p>

<p align="center">
  <a href="https://github.com/ethanfly/Galaxy/actions/workflows/test.yml"><img src="https://github.com/ethanfly/Galaxy/actions/workflows/test.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/ethanfly/Galaxy/actions/workflows/release.yml"><img src="https://github.com/ethanfly/Galaxy/actions/workflows/release.yml/badge.svg" alt="Release" /></a>
  <a href="https://github.com/ethanfly/Galaxy/releases"><img src="https://img.shields.io/github/v/release/ethanfly/Galaxy?include_prereleases&label=release" alt="Release version" /></a>
  <img src="https://img.shields.io/badge/platform-Windows%2010%2F11-0078D6" alt="Platform" />
  <img src="https://img.shields.io/badge/license-Proprietary-8B5CF6" alt="License" />
</p>

<p align="center">
  <a href="#功能">功能</a> ·
  <a href="#agent-适配">Agent</a> ·
  <a href="#快捷键">快捷键</a> ·
  <a href="#开发">开发</a> ·
  <a href="#构建与发布">发布</a> ·
  <a href="#文档">文档</a>
</p>

---

## 为什么是 Galaxy？

在终端里同时跑多个 **AI 编程 Agent**、多项目、多分屏，已经成为日常。Galaxy 把「终端工作区 + 项目侧栏 + Agent 历史 + Git + 命令块」收成一款**桌面原生应用**，而不是再套一层 Electron 浏览器。

品牌标识采用原创的 **几何轨道 G**：深黑圆角场承载一条灿白连续轨道，在小尺寸下仍保持清晰。设计借鉴现代 AI 产品的大胆单色几何感，但不复制任何现有标志。

<p align="center">
  <img src="public/brand/galaxy-mark.svg" alt="Galaxy mark" width="72" height="72" />
</p>

---

## 技术栈

| 层 | 技术 |
| --- | --- |
| 壳 / 后端 | **Tauri 2** · **Rust** · ConPTY (portable-pty) |
| 前端 | **React 18** · **TypeScript** · **Zustand** · **Vite 6** |
| 终端 | **xterm.js**（CJK 优先 Canvas 渲染；WebGL 可选） |
| 安装包 | **NSIS**（当前用户安装，中/英语言） |
| CI | GitHub Actions · 自动测试 · 自动版本 · 自动 Release |

---

## 功能

### 终端与布局

- **全局多标签**：跨项目浏览、拖拽排序、重命名、关闭其他、`Ctrl+W`
- **动态标题**：OSC 0 会话标题（basename 简化）
- **递归分屏**：向右 / 向下、拖动比例、方向键切 pane、`Alt+Shift+方向` 调尺寸
- **同步输入**：一键向会话内所有 pane 广播键入
- **跨标签移动 pane**
- **高吞吐通路**：PTY 输出按调度窗口合并 IPC；序列号缺口环形缓冲重放；单 pane 独立配额
- **中文显示**：流式 UTF-8 + GBK/GB18030 回退；CJK 字体栈；Canvas 渲染避免方框字
- **Shell 探测**：Windows PowerShell / pwsh / cmd / Git Bash / WSL

### 命令块与搜索

- **命令块**：OSC 133 Shell Integration 优先，启发式兜底（静默结算）
- 复制命令 / 输出、重跑、收藏；`blocks.jsonl` 限量 500（收藏不淘汰）
- **搜索**
  - `Ctrl+F` — 终端内查找
  - `Ctrl+Shift+F` — 命令块搜索
  - `Ctrl+R` — 统一历史 / 收藏
  - `Ctrl+P` — 命令面板

### Git

- 状态栏与 Git 面板：分支、ahead/behind、变更列表
- 面板内切换分支；冲突原文展示
- **绝不**自动 `stash` / `reset`

### 设置与 Windows 集成

- 设置中心：通用 · Workflows · 布局模板 · 触发器 · 快捷键 · 诊断
- 自定义标题栏、强制深色、窗口状态记忆
- **单例** + `--open-here` 转发
- 资源管理器右键菜单「在此处打开银河终端」
- Workflow 参数模板与输出触发器（正则 + 冷却 + 通知 / 标记 / 响铃 / 停滚）

### 界面与品牌

- 深黑 / 灿白单色工作台（成功、阻塞、错误保留语义色）
- 统一圆角描边 SVG 图标集（非系统 Emoji）
- 项目列表 / 标签 / 设置导航统一选中态
- 原创几何轨道 G 由同一 SVG 母版生成标题栏、favicon 与安装包图标

---

## Agent 适配

支持 **21** 个常见 AI 编程 Agent：只读扫描本地历史、查看消息、生成恢复命令、识别运行状态（idle / working / blocked / done）。

| Agent | 典型路径 / 存储 | 命令识别示例 |
| --- | --- | --- |
| Claude Code | `~/.claude/projects` | `claude` |
| Codex CLI | `~/.codex/sessions` | `codex` |
| OpenCode | SQLite (`opencode.db`) | `opencode` |
| OMP | 既有适配 | `omp` |
| Grok Build | 既有适配 | `grok` |
| Crush | 项目 `.crush/` | `crush` |
| Gemini CLI | `~/.gemini/` | `gemini` |
| GitHub Copilot CLI | `~/.copilot/session-state` | `copilot` / `gh copilot` |
| Aider | 项目 `.aider.chat.history.md` | `aider` |
| Goose | `~/.config/goose` | `goose` |
| Qwen Code | `~/.qwen/projects` | `qwen` |
| Kimi CLI | `~/.kimi/sessions` | `kimi` |
| Cline | VS Code / Cursor globalStorage | `cline` |
| Roo Code | 同上（Roo 目录） | `roo` |
| Continue | `~/.continue` | `continue` / `cn` |
| Cursor Agent | `~/.cursor` / 项目 `.cursor` | `cursor-agent` |
| **Pi** | `~/.pi/agent/sessions` | `pi` |
| **Hermes** | `~/.hermes/state.db` | `hermes` |
| OpenClaw | `~/.openclaw` / `~/.clawdbot` | `openclaw` |
| Antigravity | `~/.gemini/antigravity` | `antigravity` |
| Amp / Factory | `~/.factory` / `~/.amp` | `amp` / `factory` |

Agent 面板**只展示扫到会话的条目**；未安装或无历史的适配器不刷屏。所有历史文件均为**只读**，绝不修改 Agent 自有数据。

---

## 快捷键

| 操作 | 默认 |
| --- | --- |
| 新建终端 | `Ctrl+Shift+T` |
| 关闭标签 | `Ctrl+W` |
| 命令面板 | `Ctrl+P` |
| 终端查找 | `Ctrl+F` |
| 命令块搜索 | `Ctrl+Shift+F` |
| 历史 / 收藏 | `Ctrl+R` |
| 设置 | `Ctrl+,` |
| Agent 面板 | `Ctrl+Shift+A` |
| Git 面板 | `Ctrl+Shift+G` |
| 通知面板 | `Ctrl+Shift+N` |
| 向右 / 向下分屏 | `Ctrl+Shift+D` / `Ctrl+Shift+E` |
| 关闭 pane | `Ctrl+Shift+W` |
| 同步输入 | `Ctrl+Shift+I` |
| 切换 pane | `Alt+方向键` |
| 调整 pane 尺寸 | `Alt+Shift+方向键` |

可在 **设置 → 快捷键** 中查看、修改、禁用（冲突会阻止保存）。

---

## 截图与界面入口

| 位置 | 作用 |
| --- | --- |
| 标题栏工具 | 侧栏开关 · Agent / Git / 历史 / 通知 · 设置 |
| 左侧项目栏 | 添加项目、新建终端、Agent 徽章 |
| 标签栏 | 会话切换、状态灯、新建 `+` |
| 右侧面板 | 由标题栏按钮打开；关闭后不占位 |
| 状态栏 | Git / 路径 / 会话 · 右侧 🔔 与时钟 |

---

## 开发

### 环境要求

| 组件 | 要求 |
| --- | --- |
| OS | Windows 10/11 x64 |
| Node.js | ≥ 20（推荐 22+） |
| Rust | stable，`x86_64-pc-windows-msvc` |
| MSVC | Visual Studio 2022 Build Tools + Windows SDK |

### 启动

```bash
git clone https://github.com/ethanfly/Galaxy.git
cd Galaxy

npm install
npm run tauri dev      # Vite + Rust 热重载
```

### 常用脚本

```bash
npm test                 # Vitest 前端单元测试
npm run build            # 仅前端生产构建
npm run tauri build      # 完整桌面安装包
npm run gen:icons        # 从唯一 SVG 母版重新生成 Web / Tauri 图标
npm run gen:licenses     # 第三方许可清单
npm run version:show     # 当前版本
npm run version:patch    # 补丁版本 +1（同步三处清单）
```

### 测试矩阵

| 层 | 命令 | 覆盖 |
| --- | --- | --- |
| Rust 单元 | `cargo test --lib` | 布局 / 迁移 / Shell / Agent 探测 / 命令块 / 解码 |
| Rust 集成 | `cargo test --test pty_integration --test services_integration` | ConPTY、Git、IPC 契约 |
| TS 单元 | `npm test` | Store / 快捷键 / 工具函数 |
| UI E2E | `npx playwright test --project=ui` | 外壳、命令面板、快捷键 |
| 视觉回归 | `GALAXY_APP_E2E=1 npx playwright test --project=app` | 发布管线（CAPTURE_SCREEN） |

---

## 构建与发布

### 本地打包

```bash
npm run tauri build
# 产物：src-tauri/target/release/bundle/nsis/*-setup.exe
```

### GitHub 自动流水线

| 流程 | Workflow | 触发 |
| --- | --- | --- |
| CI | [test.yml](.github/workflows/test.yml) | push / PR → `main` |
| 版本号 | [version.yml](.github/workflows/version.yml) | Actions 手动：patch / minor / major |
| 发布 | [release.yml](.github/workflows/release.yml) | 推送标签 `v*.*.*` |

**发一版：**

1. GitHub → **Actions → Version & Tag → Run workflow**
2. 选择 `patch` / `minor` / `major`
3. 自动提交版本并打标签 → **Release** 构建 NSIS 并上传到 [Releases](https://github.com/ethanfly/Galaxy/releases)

可选 Secrets（不配也能构建，只是不签名 / 不启用 updater）：

- `SM_CERTIFICATE_BASE64` / `SM_CERTIFICATE_PASSWORD`
- `TAURI_UPDATER_PUBKEY` / `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

完整说明见 [docs/RELEASE.md](docs/RELEASE.md)。

---

## 架构一览

```
┌─────────────────────────────────────────────────────────┐
│  React UI (Vite)                                        │
│  TitleBar · Tabs · Sidebar · xterm panes · Panels · SB  │
└───────────────────────────┬─────────────────────────────┘
                            │ Tauri IPC / Events
┌───────────────────────────▼─────────────────────────────┐
│  Rust core                                              │
│  PTY manager (batch + ring) · layout · config · store   │
│  Agent adapters (21) · Git · blocks · triggers · shell  │
└───────────────────────────┬─────────────────────────────┘
                            │ ConPTY / portable-pty
┌───────────────────────────▼─────────────────────────────┐
│  Shells: PowerShell · pwsh · cmd · Git Bash · WSL       │
└─────────────────────────────────────────────────────────┘
```

数据目录（用户侧，示意）：

- `store.json` — 项目 / 会话 / 布局 / 配置
- `blocks.jsonl` — 命令块
- 各 Agent 自有历史仍在其原始路径，Galaxy **只读扫描**

---

## 文档

| 文档 | 内容 |
| --- | --- |
| [docs/RELEASE.md](docs/RELEASE.md) | 可复现构建、签名、更新、CI 发布 |
| [docs/CHANGELOG.md](docs/CHANGELOG.md) | 变更记录 |
| [docs/PRIVACY.md](docs/PRIVACY.md) | 隐私说明 |
| [docs/THIRD_PARTY_LICENSES.md](docs/THIRD_PARTY_LICENSES.md) | 第三方许可 |
| [docs/PERFORMANCE.md](docs/PERFORMANCE.md) | 性能基线 |
| [docs/superpowers/specs/](docs/superpowers/specs/) | 设计规格 |

---

## 仓库

- **GitHub:** [ethanfly/Galaxy](https://github.com/ethanfly/Galaxy)
- **Issues / Releases:** 使用 GitHub 标准流程

```bash
git clone https://github.com/ethanfly/Galaxy.git
cd Galaxy
npm install && npm run tauri dev
```

---

## 许可

Proprietary — 见仓库声明与 [docs/THIRD_PARTY_LICENSES.md](docs/THIRD_PARTY_LICENSES.md) 中的第三方组件许可。

---

<p align="center">
  <img src="public/brand/galaxy-mark.svg" width="48" height="48" alt="Galaxy" /><br/>
  <sub>Galaxy Terminal — multi-terminal workspace for the multi-agent era</sub>
</p>
