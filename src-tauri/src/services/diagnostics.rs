//! Diagnostics info and the user-initiated, redacted diagnostic report
//! (spec §5.6, §8).
use serde::Serialize;

use super::logging::redact;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsInfo {
    pub app_version: String,
    pub os: String,
    pub arch: String,
    pub pty_backend: String,
    pub config_path: String,
    pub data_dir: String,
    pub log_dir: String,
    pub shells: Vec<String>,
    pub feature_flags: Vec<String>,
    pub captures_screen_mode: bool,
    pub git_available: bool,
    pub schema_version: u32,
    pub profile_count: usize,
    pub gpu_acceleration: bool,
}

pub struct Diagnostics {
    pub info: DiagnosticsInfo,
}

impl Diagnostics {
    /// Build a markdown report. Every included line passes through the
    /// redactor; terminal content and command-block contents are never part
    /// of the report.
    pub fn report(&self) -> String {
        let i = &self.info;
        let mut md = String::new();
        md.push_str("# 银河终端诊断报告\n\n");
        md.push_str(&format!("- 应用版本: {}\n", i.app_version));
        md.push_str(&format!("- 操作系统: {} ({})\n", i.os, i.arch));
        md.push_str(&format!("- PTY 后端: {}\n", i.pty_backend));
        md.push_str(&format!("- 存储 Schema 版本: {}\n", i.schema_version));
        md.push_str(&format!("- 配置文件: {}\n", redact(&i.config_path)));
        md.push_str(&format!("- 数据目录: {}\n", redact(&i.data_dir)));
        md.push_str(&format!("- 日志目录: {}\n", redact(&i.log_dir)));
        md.push_str(&format!("- 可用 Shell ({}):\n", i.shells.len()));
        for s in &i.shells {
            md.push_str(&format!("  - {}\n", redact(s)));
        }
        md.push_str(&format!("- Git 可用: {}\n", i.git_available));
        md.push_str(&format!("- GPU 加速: {}\n", i.gpu_acceleration));
        md.push_str(&format!("- 截图模式(CAPTURE_SCREEN): {}\n", i.captures_screen_mode));
        md.push_str(&format!("- Shell Profile 数量: {}\n", i.profile_count));
        md.push_str(&format!("- 功能开关: {}\n", i.feature_flags.join(", ")));
        md.push_str("\n> 报告已自动脱敏：用户路径以 ~ 代替，不包含终端内容、命令参数或命令块输出。\n");
        md
    }
}

pub fn os_description() -> String {
    let os = std::env::consts::OS;
    let family = std::env::consts::FAMILY;
    format!("{os} ({family})")
}
