//! Shell profile detection (spec §5.7). Windows: Windows PowerShell, pwsh,
//! cmd, Git Bash, WSL. Unix fallback uses SHELL + common locations. Detection
//! never panics and never blocks on spawning shells — existence checks only.
use crate::core::models::{ProfileSource, ShellProfile};

fn profile(id: &str, name: &str, program: &str, args: Vec<&str>, icon: Option<&str>) -> ShellProfile {
    ShellProfile {
        id: id.to_string(),
        name: name.to_string(),
        program: program.to_string(),
        args: args.into_iter().map(String::from).collect(),
        icon: icon.map(String::from),
        env: Default::default(),
        source: ProfileSource::Detected,
    }
}

#[cfg(windows)]
fn where_on_path(exe: &str) -> Option<String> {
    let path = std::env::var_os("PATH")?;
    let pats = if exe.ends_with(".exe") { vec![exe.to_string()] } else { vec![format!("{exe}.exe"), exe.to_string()] };
    for dir in std::env::split_paths(&path) {
        for name in &pats {
            let cand = dir.join(name);
            if cand.is_file() {
                return Some(cand.to_string_lossy().to_string());
            }
        }
    }
    None
}

#[cfg(windows)]
pub fn detect_profiles() -> Vec<ShellProfile> {
    let mut out = Vec::new();

    // Windows PowerShell (always present on Win10/11)
    let sysroot = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
    let winps = format!(
        "{sysroot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
    );
    if std::path::Path::new(&winps).exists() {
        out.push(profile("windows-powershell", "Windows PowerShell", &winps, vec![], Some("󰨊")));
    }

    // PowerShell 7 (pwsh)
    let pwsh_candidates = [
        std::env::var("ProgramFiles")
            .map(|p| format!("{p}\\PowerShell\\7\\pwsh.exe"))
            .unwrap_or_default(),
        std::env::var("ProgramFiles(x86)")
            .map(|p| format!("{p}\\PowerShell\\7\\pwsh.exe"))
            .unwrap_or_default(),
    ];
    let mut pwsh = where_on_path("pwsh");
    if pwsh.is_none() {
        pwsh = pwsh_candidates.iter().find(|p| std::path::Path::new(p).is_file()).cloned();
    }
    if let Some(p) = pwsh {
        out.push(profile("pwsh", "PowerShell 7", &p, vec![], Some("󰨊")));
    }

    // cmd
    let cmd = format!("{sysroot}\\System32\\cmd.exe");
    if std::path::Path::new(&cmd).exists() {
        out.push(profile("cmd", "命令提示符", &cmd, vec![], Some("󰆍")));
    }

    // Git Bash
    let git_candidates = [
        std::env::var("ProgramFiles").map(|p| format!("{p}\\Git\\bin\\bash.exe")).unwrap_or_default(),
        std::env::var("ProgramFiles(x86)").map(|p| format!("{p}\\Git\\bin\\bash.exe")).unwrap_or_default(),
        std::env::var("LOCALAPPDATA").map(|p| format!("{p}\\Programs\\Git\\bin\\bash.exe")).unwrap_or_default(),
    ];
    let mut gitbash = git_candidates.iter().find(|p| std::path::Path::new(p).is_file()).cloned();
    if gitbash.is_none() {
        gitbash = where_on_path("bash.exe");
    }
    if let Some(p) = gitbash {
        out.push(profile("git-bash", "Git Bash", &p, vec!["--login", "-i"], Some("󰊢")));
    }

    // WSL (wsl.exe exists on Win10+; distros probed lazily by existence)
    let wsl = format!("{sysroot}\\System32\\wsl.exe");
    if std::path::Path::new(&wsl).exists() {
        out.push(profile("wsl", "WSL", &wsl, vec![], Some("󰻀")));
    }

    dedup(out)
}

#[cfg(not(windows))]
pub fn detect_profiles() -> Vec<ShellProfile> {
    let mut out = Vec::new();
    if let Ok(shell) = std::env::var("SHELL") {
        if std::path::Path::new(&shell).exists() {
            let name = std::path::Path::new(&shell)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| shell.clone());
            out.push(profile("default-shell", &name, &shell, vec!["-l"], None));
        }
    }
    for (id, name, path) in [
        ("bash", "Bash", "/bin/bash"),
        ("zsh", "Zsh", "/bin/zsh"),
        ("sh", "sh", "/bin/sh"),
    ] {
        if std::path::Path::new(path).exists() && out.iter().all(|p| p.program != path) {
            out.push(profile(id, name, path, vec!["-l"], None));
        }
    }
    dedup(out)
}

fn dedup(profiles: Vec<ShellProfile>) -> Vec<ShellProfile> {
    let mut seen = std::collections::HashSet::new();
    profiles
        .into_iter()
        .filter(|p| seen.insert(p.program.to_lowercase()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detection_returns_valid_profiles() {
        let profiles = detect_profiles();
        for p in &profiles {
            assert!(!p.id.is_empty() && !p.name.is_empty() && !p.program.is_empty());
            assert_eq!(p.source, ProfileSource::Detected);
        }
        #[cfg(windows)]
        {
            assert!(profiles.iter().any(|p| p.id == "cmd"), "cmd must be detected on Windows");
            assert!(profiles.iter().any(|p| p.id == "windows-powershell"));
        }
    }

    #[test]
    fn dedup_removes_duplicate_programs() {
        let p = profile("a", "A", "C:\\x\\bash.exe", vec![], None);
        let p2 = profile("b", "B", "c:\\X\\BASH.EXE", vec![], None);
        let out = dedup(vec![p, p2]);
        assert_eq!(out.len(), 1);
    }
}
