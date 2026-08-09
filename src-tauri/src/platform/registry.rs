//! Windows Explorer context-menu registration (spec §5.7), per-user (HKCU)
//! so no elevation is required. Mirrors what the NSIS installer writes;
//! also removable at runtime from settings.
use crate::error::AppError;
use winreg::enums::HKEY_CURRENT_USER;
use winreg::RegKey;

const MENU_TEXT: &str = "在此处打开银河终端";
const MENU_KEY: &str = "GalaxyTerminal";

const SCOPES: [&str; 3] = [
    "Software\\Classes\\Directory\\shell",
    "Software\\Classes\\Directory\\Background\\shell",
    "Software\\Classes\\Drive\\shell",
];

/// Value placeholder differs per scope: directory/drive use %1, the
/// background menu uses %V.
fn targets(exe: &str) -> Vec<(String, String)> {
    vec![
        (
            SCOPES[0].to_string(),
            format!("\"{exe}\" --open-here \"%1\""),
        ),
        (
            SCOPES[1].to_string(),
            format!("\"{exe}\" --open-here \"%V\""),
        ),
        (
            SCOPES[2].to_string(),
            format!("\"{exe}\" --open-here \"%1\""),
        ),
    ]
}

pub fn register_context_menu(exe_path: &str) -> Result<(), AppError> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    for (scope, command) in targets(exe_path) {
        let key_path = format!("{scope}\\{MENU_KEY}");
        let (key, _) = hkcu
            .create_subkey(&key_path)
            .map_err(|e| AppError::Platform(format!("注册右键菜单失败: {e}")))?;
        key.set_value("", &MENU_TEXT)
            .map_err(|e| AppError::Platform(format!("注册右键菜单失败: {e}")))?;
        key.set_value("Icon", &exe_path.to_string())
            .map_err(|e| AppError::Platform(format!("注册右键菜单失败: {e}")))?;
        let (cmd_key, _) = hkcu
            .create_subkey(format!("{key_path}\\command"))
            .map_err(|e| AppError::Platform(format!("注册右键菜单失败: {e}")))?;
        cmd_key
            .set_value("", &command)
            .map_err(|e| AppError::Platform(format!("注册右键菜单失败: {e}")))?;
    }
    Ok(())
}

pub fn unregister_context_menu() -> Result<(), AppError> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    for scope in SCOPES {
        let key_path = format!("{scope}\\{MENU_KEY}");
        if hkcu.open_subkey(&key_path).is_ok() {
            hkcu.delete_subkey_all(&key_path)
                .map_err(|e| AppError::Platform(format!("移除右键菜单失败: {e}")))?;
        }
    }
    Ok(())
}

pub fn is_registered() -> bool {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    hkcu.open_subkey(format!("{}\\{}", SCOPES[0], MENU_KEY))
        .is_ok()
}
