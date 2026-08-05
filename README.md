<p align="center">
  <img src="public/icon.png" alt="Galaxy Terminal" width="128" height="128" />
</p>

<h1 align="center">银河终端 · Galaxy Terminal</h1>

<p align="center">
  <strong>面向开发者与多 Agent 工作流的商业级多终端工作区</strong><br />
  Windows 10/11 · Tauri 2 · Rust · React · xterm.js
</p>

<p align="center">
  <a href="https://github.com/ethanfly/Galaxy/actions/workflows/test.yml"><img src="https://github.com/ethanfly/Galaxy/actions/workflows/test.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/ethanfly/Galaxy/actions/workflows/release.yml"><img src="https://github.com/ethanfly/Galaxy/actions/workflows/release.yml/badge.svg" alt="Release" /></a>
  <a href="https://github.com/ethanfly/Galaxy/releases/latest"><img src="https://img.shields.io/github/v/release/ethanfly/Galaxy?display_name=tag&label=release" alt="Latest release" /></a>
  <img src="https://img.shields.io/badge/platform-Windows%2010%2F11-0078D6?logo=windows&logoColor=white" alt="Platform" />
  <img src="https://img.shields.io/badge/license-Proprietary-6B7280" alt="License" />
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

在终端里同时跑多个 **AI 编程 Agent**、多项目、多分屏，已经成为日常。Galaxy 把「终端工作区 + 项目侧栏 + Agent 历史 + Git + 命令块」收成一款 **桌面原生应用**，而不是再套一层 Electron 浏览器。

品牌标识是原创的 **几何轨道 G**：深黑圆角场上的灿白连续轨道，小尺寸下仍清晰。现代 AI 产品式的大胆单色几何，但不是任何现有标志的复制。

<p align="center">
  <img src="public/icon.png" alt="Galaxy mark" width="64" height="64" />
</p>

---

## 技术栈

| 层 | 技术 |
| --- | --- |
| 壳 / 后端 | **Tauri 2** · **Rust** · ConPTY (`portable-pty`) |
| 前端 | **React 18** · **TypeScript** · **Zustand** · **Vite 6** |
| 终端 | **xterm.js**（CJK 优先 Canvas；WebGL 可选） |
| 安装包 | **NSIS**（当前用户安装，中/英） |
| CI | GitHub Actions · 测试 · 版本 · Release |

---

## 功能

### 终端与布局

- **全局多标签**：跨项目、拖拽排序、重命名、关闭其他、`Ctrl+W`
- **动态标题**：OSC 0 会话标题（basename 简化）
- **递归分屏**：向右 / 向下、拖动比例、方向键切 pane、`Alt+Shift+方向` 调尺寸
- **同步输入**：一键向会话内所有 pane 广播
- **跨标签移动 pane**
- **高吞吐通路**：PTY 输出按窗口合并 IPC；序列号缺口环形缓冲重放
- **中文显示**：UTF-8 + GBK/GB18030 回退；CJK 字体栈；Canvas 避免方框字
- **Shell 探测**：Windows PowerShell / pwsh / cmd / Git Bash / WSL
- **右键菜单**：复制 / 粘贴 · 向右分屏 · 向下分屏 · 移到其他标签 · 同步输入 · 关闭

### 命令块与搜索

- **命令块**：OSC 133 优先，启发式静默结算兜底
- 复制命令 / 输出、重跑、收藏；`blocks.jsonl` 上限 500（收藏不淘汰）
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
- 资源管理器右键「在此处打开银河终端」
- Workflow 参数模板与输出触发器（正则 + 冷却 + 通知 / 标记 / 响铃 / 停滚）

### 界面与品牌

- 深黑 / 灿白单色工作台（成功、阻塞、错误保留语义色）
- 统一圆角描边图标集（非系统 Emoji）
- 品牌母版为 `src-tauri/icons/logo-master.png`，经 `npm run gen:icons` 生成 Web / 安装包图标

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
| Pi | `~/.pi/agent/sessions` | `pi` |
| Hermes | `~/.hermes/state.db` | `hermes` |
| OpenClaw | `~/.openclaw` / `~/.clawdbot` | `openclaw` |
| Antigravity | `~/.gemini/antigravity` | `antigravity` |
| Amp / Factory | `~/.factory` / `~/.amp` | `amp` / `factory` |

Agent 面板**只展示扫到会话的条目**。所有历史文件均为**只读**，绝不修改 Agent 自有数据。

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

## 界面入口

| 位置 | 作用 |
| --- | --- |
| 标题栏工具 | 侧栏 · Agent / Git / 历史 / 通知 · 设置 |
| 左侧项目栏 | 添加项目、新建终端、Agent 徽章 |
| 标签栏 | 会话切换、状态灯、新建 `+` |
| 右侧面板 | 由标题栏打开；关闭后不占位 |
| 状态栏 | Git / 路径 / 会话 · 通知与时钟 |
| 终端右键 | 复制粘贴与分屏 / 移动 / 同步 |

---

## 开发

### 环境要求

| 组件 | 要求 |
| --- | --- |
| OS | Windows 10/11 x64 |
| Node.js | ≥ 20（推荐 22+） |
| Rust | stable · `x86_64-pc-windows-msvc` |
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
npm test                 # 前端单元测试
npm run build            # 仅前端生产构建
npm run tauri build      # 完整桌面安装包
npm run gen:icons        # 从 logo-master.png 生成 Web / Tauri 图标
npm run gen:licenses     # 第三方许可清单
npm run version:show     # 当前版本
npm run version:patch    # 补丁版本 +1（同步 package / Cargo / tauri.conf）
```

### 测试矩阵

| 层 | 命令 | 覆盖 |
| --- | --- | --- |
| Rust 单元 | `cargo test --lib`（在 `src-tauri/`） | 布局 / 迁移 / Shell / Agent / 命令块 / 解码 |
| Rust 集成 | `cargo test --test pty_integration --test services_integration` | ConPTY、Git、IPC |
| TS 单元 | `npm test` | Store / 快捷键 / 工具函数 |
| UI E2E | `npx playwright test --project=ui` | 外壳、命令面板、快捷键 |
| 视觉回归 | `GALAXY_APP_E2E=1 npx playwright test --project=app` | 完整应用截图 |

---

## 构建与发布

### 本地打包

```bash
npm run tauri build
# 产物：src-tauri/target/release/bundle/nsis/*-setup.exe
```

### GitHub 流水线

| 流程 | Workflow | 触发 |
| --- | --- | --- |
| CI | [test.yml](.github/workflows/test.yml) | push / PR → `main` |
| 版本号 | [version.yml](.github/workflows/version.yml) | Actions 手动：patch / minor / major |
| 发布 | [release.yml](.github/workflows/release.yml) | 推送标签 `v*.*.*` |

**发一版：**

1. GitHub → **Actions → Version & Tag → Run workflow**
2. 选择 `patch` / `minor` / `major`
3. 自动提交版本并打标签 → Release 构建 NSIS 并上传到 [Releases](https://github.com/ethanfly/Galaxy/releases)

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

用户侧数据（示意）：

- `store.json` — 项目 / 会话 / 布局 / 配置
- `blocks.jsonl` — 命令块
- 各 Agent 历史仍在其原始路径，Galaxy **只读扫描**

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
- **下载安装包:** [Releases](https://github.com/ethanfly/Galaxy/releases/latest)
- **问题反馈:** [Issues](https://github.com/ethanfly/Galaxy/issues)

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
  <img src="public/icon.png" width="40" height="40" alt="Galaxy" /><br />
  <sub>Galaxy Terminal — multi-terminal workspace for the multi-agent era</sub>
</p>
