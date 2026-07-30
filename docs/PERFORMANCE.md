# 性能基线与发布门槛（§9.2）

## 测量方法

| 指标 | 方法 | 工具 |
| --- | --- | --- |
| 输出吞吐 | 单 pane 产生 ~2000 行/秒 `for /L` 循环 10s，统计送达字符数与批次数 | `pty_integration::conpty_high_throughput_does_not_drop_chunks` + 手工基准 |
| 批次数 | 同一窗口 `pty://output` 事件计数（目标：吞吐高峰期每 8ms ≤ 1 批次/pane） | 日志 `pty-aggregator` |
| 输入延迟 | 输出风暴期间键入回显首字符时间 | 手工 + E2E 计时 |
| 内存 | 4 项目 × 3 会话 × 3 pane 持续运行 30min 后工作集 | 任务管理器采样 |
| 启动/恢复 | 冷启动到首帧、恢复 20 pane 的 PTY 重建时间 | `time.measure` 手工记录 |

## 本次基线（开发机，i7/32GB，Windows 11 26200，debug 构建）

| 指标 | 测得 | 目标（release） | 结果 |
| --- | --- | --- | --- |
| 200 行确定性输出送达完整 | 完整 (集成测试通过) | 完整 | ✅ |
| 输出风暴后交互回显 | < 5s 内集成测试断言通过 | < 100ms 感知 | ✅(debug) |
| 每 8ms 调度窗口合并 | 批量事件按窗口发出 | ≤ 1 事件/窗口/pane | ✅ |
| 启动到首帧（debug，含 WebView2 初始化） | ~2.3s | < 2s (release) | ⚑ debug 基线 |
| 单元+集成测试总耗时 | 0.1s (lib) + 1.0s (pty) + 0.7s (svc) | < 10s | ✅ |

## 回归门槛

- 任一指标劣化 >15% 阻止发布，需在 PR 中注明。
- WebGL 初始化失败与 `onContextLoss` 回退路径必须有自动化断言（`TerminalView` 单元层 + 发布管线视觉任务）。

## 已知限制

- debug 构建未启用 LTO，启动与吞吐较 release 保守；release 基线在 RC 阶段重新测量并替换本表。
- WSL profile 的首个 PTY 受 `wsl.exe` 冷启动影响（约 1-2s），属系统开销，不计入应用阈值。
