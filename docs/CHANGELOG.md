# 变更记录

## [0.1.0] — 2026-07-30 首个商业版本候选

### 里程碑 1：基础平台
- Tauri 2 工程、全量领域模型（Project/Session/LayoutNode/Pane/ShellProfile/CommandBlock/AgentConversation/Workflow/Trigger/AppConfig）
- 原子持久化（临时文件 → fsync → 替换 + 最近有效备份；损坏文件改名保留；v1→v2→v3 逐步迁移）
- 崩溃检测（`run_state.json` 干净退出标记）与恢复/清洁启动选择
- 银河像素风设计系统（深空蓝黑、星云紫、青/琥珀/红状态色；星点仅限非终端区；尊重系统减少动态效果）

### 里程碑 2：终端工作区
- ConPTY（portable-pty，统一 `PtyBackend` 接口，Unix PTY 可替换）
- 调度窗口输出合并为单次 IPC；每 pane 独立环形缓冲（1MiB/2048 块）与序列号缺口重放 + 截断标记
- xterm.js WebGL，上下文丢失/初始化失败自动回退
- 全局标签（跨项目、拖拽排序、重命名、关闭其他、Ctrl+W）、OSC 0 动态标题、活动脉冲、Agent 徽章
- 递归分屏（向右/向下、拖动权重、Alt+方向键切 pane、Alt+Shift 调尺寸、Ctrl+Shift+W 关闭、同步输入、跨标签移动）
- Shell 自动探测（Windows PowerShell / pwsh / cmd / Git Bash / WSL）+ 自定义 Profile
- 重启恢复：重建布局与 PTY；带验证元数据的 pane 注入 resume 命令；单 pane 失败不阻塞其它

### 里程碑 3：生产力
- 命令块（OSC 133 优先、启发式兜底、解析失败退化为普通终端）；复制命令/输出/重跑/收藏；500 上限与收藏软上限提醒
- Ctrl+F 终端查找、Ctrl+Shift+F 命令块搜索、Ctrl+R 统一历史、Ctrl+P 命令面板
- 布局模板（保存/覆盖/删除/应用，layoutSnapshot 优先）
- Workflow 参数模板（类型校验、解析预览、运行确认）+ 触发器（限长 512 正则、冷却、通知/标记/响铃/停止滚动）
- 快捷键查看/改写/禁用/重置（冲突保存前阻止）与可配置状态栏（git·cwd·sessions·agent·notifications·clock）

### 里程碑 4：Agent 与 Git
- 六个 Agent 适配器（统一接口：扫描/项目匹配/元数据/消息/状态推断/恢复命令；只读访问、增量索引、取消令牌；不可用降级不致命）
- 历史面板（按项目列出会话、消息流查看、一键恢复注入）
- 状态启发式（idle/working/blocked，PTY 退出为 done）；完成/阻塞时系统通知 + 通知中心
- Git 面板与状态栏分支菜单 checkout（冲突原文展示，不自动 stash/reset/clean）；文件变化/焦点恢复/手动刷新三路更新；非仓库可操作空状态

### 里程碑 5：Windows 集成
- 强制深色 + 可拖拽自定义标题栏与原生窗口按钮
- 单例运行；二次启动聚焦并转发 `--open-here`
- 窗口位置/尺寸/最大化记忆并校正至可见显示器
- HKCU 右键菜单（目录/背景/驱动器），安装器与应用内双向注册/注销
- `CAPTURE_SCREEN=1` 软件渲染截图模式
- 诊断页（版本/OS/Shell/配置路径/PTY 后端/功能开关）与一键脱敏报告

### 里程碑 6：商业发布准备
- 50 项 Rust 测试（含真实 ConPTY 吞吐、Git 真实仓库）+ 17 项 TS 测试 + 3 项 UI 层 E2E + IPC 契约测试
- NSIS 安装包模板、更新配置（签名清单、稳定/预览通道说明、回滚策略）
- 第三方许可清单生成脚本、隐私说明、可复现构建文档、性能基线文档
