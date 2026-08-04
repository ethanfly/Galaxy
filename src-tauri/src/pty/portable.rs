//! portable-pty backed implementation. On Windows this drives ConPTY and on
//! Unix a forkpty, behind the same `PtyBackend` interface.
use std::io::Read;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use parking_lot::Mutex;
use portable_pty::{Child, CommandBuilder, MasterPty, PtySize, PtySystem};

use super::backend::{PtyBackend, PtyProcess, PtySpec};
use crate::error::AppError;

pub struct PortablePtyBackend {
    system: Mutex<Box<dyn PtySystem + Send>>,
}

impl Default for PortablePtyBackend {
    fn default() -> Self {
        Self {
            system: Mutex::new(portable_pty::native_pty_system()),
        }
    }
}

impl PtyBackend for PortablePtyBackend {
    fn name(&self) -> &'static str {
        #[cfg(windows)]
        {
            "ConPTY"
        }
        #[cfg(not(windows))]
        {
            "UnixPTY"
        }
    }

    fn spawn(&self, spec: &PtySpec) -> Result<Box<dyn PtyProcess>, AppError> {
        let system = self.system.lock();
        let pair = system
            .openpty(PtySize {
                rows: spec.rows.max(2),
                cols: spec.cols.max(2),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| AppError::Pty(format!("创建 PTY 失败: {e}")))?;

        let mut cmd = CommandBuilder::new(&spec.program);
        for arg in &spec.args {
            cmd.arg(arg);
        }
        if !spec.cwd.is_empty() {
            cmd.cwd(&spec.cwd);
        }
        // Prefer UTF-8 for child tools (Python/Node/etc.) so CJK is not emitted
        // as the system ANSI code page when the app is UTF-8 aware.
        #[cfg(windows)]
        {
            cmd.env("PYTHONIOENCODING", "utf-8");
            cmd.env("PYTHONUTF8", "1");
        }
        #[cfg(not(windows))]
        {
            if std::env::var_os("LANG").is_none() {
                cmd.env("LANG", "C.UTF-8");
            }
            if std::env::var_os("LC_ALL").is_none() {
                cmd.env("LC_ALL", "C.UTF-8");
            }
        }
        for (k, v) in &spec.env {
            cmd.env(k, v);
        }

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| AppError::Pty(format!("启动进程 {} 失败: {e}", spec.program)))?;

        Ok(Box::new(PortablePtyProcess {
            master: Mutex::new(Some(pair.master)),
            child: Arc::new(Mutex::new(child)),
            writer: Mutex::new(None),
            killed: Arc::new(AtomicBool::new(false)),
        }))
    }
}

struct PortablePtyProcess {
    master: Mutex<Option<Box<dyn MasterPty + Send>>>,
    child: Arc<Mutex<Box<dyn Child + Send + Sync>>>,
    writer: Mutex<Option<Box<dyn std::io::Write + Send>>>,
    killed: Arc<AtomicBool>,
}

impl PtyProcess for PortablePtyProcess {
    fn take_reader(&self) -> Result<Box<dyn Read + Send>, AppError> {
        let master = self.master.lock();
        master
            .as_ref()
            .ok_or_else(|| AppError::Pty("PTY transport 已关闭".into()))?
            .try_clone_reader()
            .map_err(|e| AppError::Pty(format!("克隆 PTY 读取端失败: {e}")))
    }

    fn write(&self, data: &[u8]) -> Result<(), AppError> {
        let mut guard = self.writer.lock();
        if guard.is_none() {
            let master = self.master.lock();
            let w = master
                .as_ref()
                .ok_or_else(|| AppError::Pty("PTY transport 已关闭".into()))?
                .take_writer()
                .map_err(|e| AppError::Pty(format!("获取 PTY 写入端失败: {e}")))?;
            *guard = Some(w);
        }
        let w = guard
            .as_mut()
            .ok_or_else(|| AppError::Pty("PTY 写入端未就绪".into()))?;
        w.write_all(data)
            .and_then(|_| w.flush())
            .map_err(|e| AppError::Pty(format!("PTY 写入失败: {e}")))
    }

    fn resize(&self, cols: u16, rows: u16) -> Result<(), AppError> {
        let master = self.master.lock();
        master
            .as_ref()
            .ok_or_else(|| AppError::Pty("PTY transport 已关闭".into()))?
            .resize(PtySize {
                rows: rows.max(2),
                cols: cols.max(2),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| AppError::Pty(format!("PTY 调整尺寸失败: {e}")))
    }

    fn kill(&self) -> Result<(), AppError> {
        self.killed.store(true, Ordering::SeqCst);
        let mut child = self.child.lock();
        child
            .kill()
            .map_err(|e| AppError::Pty(format!("结束进程失败: {e}")))
    }

    fn close_transport(&self) -> Result<(), AppError> {
        // Drop ClosePseudoConsole independently from any thread blocked while
        // holding the writer handle or an Arc to this process object.
        let master = self.master.lock().take();
        drop(master);
        Ok(())
    }

    fn try_wait(&self) -> Result<Option<i32>, AppError> {
        let mut child = self.child.lock();
        match child.try_wait() {
            Ok(Some(status)) => Ok(Some(status.exit_code() as i32)),
            Ok(None) => Ok(None),
            Err(e) => {
                if self.killed.load(Ordering::SeqCst) {
                    Ok(Some(-1))
                } else {
                    Err(AppError::Pty(format!("读取进程状态失败: {e}")))
                }
            }
        }
    }

    fn pid(&self) -> Option<u32> {
        self.child.lock().process_id()
    }
}
