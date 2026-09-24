//! Login-startup registration.
//!
//! Servant owns exactly one OS-level startup entry. The stored preference is the
//! single source of truth, and the settings window rewrites the entry whenever
//! it opens: writing is idempotent, and doing it every time is what repairs an
//! entry left pointing at a previous install path.
//!
//! Platform storage:
//! - Windows: `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`
//! - macOS: `~/Library/LaunchAgents/<bundle identifier>.plist`
//!
//! The write and its answer both come from the OS: the command returns what the
//! entry really looks like afterwards, so a rejected write cannot make the
//! settings toggle lie.
//!
//! An entry is only worth having if the process it launches can show a page on
//! its own, and that is a property of the build rather than of the write: a
//! development shell is handed every page by the dev server, so registering one
//! produces a startup item that opens an empty window at login. Asking for the
//! entry in that build therefore clears whatever an earlier development run
//! registered and says why, instead of recording something that cannot work.

use std::path::{Path, PathBuf};

use serde::Serialize;

/// Name of the Windows `Run` entry; also the user-visible label in the Task
/// Manager startup tab.
#[cfg(windows)]
const WINDOWS_ENTRY_NAME: &str = "Servant";

#[cfg(windows)]
const WINDOWS_RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";

/// Mirror of `AutoStartOutcome` in `src/desktop/tauri/autostart.ts`.
///
/// `enabled` is what the OS holds after the call, never an echo of the request;
/// `supported` describes the build, and is the one thing the caller cannot
/// discover by trying, which is why it travels with the answer.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoStartOutcome {
    /// False when this build cannot own a login entry at all.
    pub supported: bool,
    /// Why not, when `supported` is false; empty otherwise. Shown to the user.
    pub reason: String,
    /// Whether a login entry exists now.
    pub enabled: bool,
}

#[tauri::command]
pub fn set_autostart(app: tauri::AppHandle, enabled: bool) -> Result<AutoStartOutcome, String> {
    if is_development_shell() {
        // An entry registered by an earlier development run would still launch
        // a window with nothing in it, so drop it and tell the caller why
        // nothing was written. A removal failure would not be actionable next to
        // that, and `supported: false` already keeps the switch from claiming
        // the entry works.
        let _ = remove_entry(&app);
        return Ok(AutoStartOutcome {
            supported: false,
            reason: development_shell_reason(&app),
            enabled: current_entry(&app)?.is_some(),
        });
    }
    if enabled {
        write_entry(&app, &executable_path()?)?;
    } else {
        remove_entry(&app)?;
    }
    Ok(AutoStartOutcome {
        supported: true,
        reason: String::new(),
        enabled: current_entry(&app)?.is_some(),
    })
}

/// Whether this build is handed its pages by a dev server instead of carrying
/// them.
///
/// This is Tauri's own distinction — `#[cfg(dev)]` is the flag
/// `Manager::get_app_url` uses to choose between `devUrl` and the bundled
/// assets — so it answers exactly the question that matters here: launched at
/// login with nobody around, can this build show anything? `tauri build`
/// compiles the feature that turns it off, which is what makes the packaged
/// shell and the development shell disagree.
fn is_development_shell() -> bool {
    cfg!(dev)
}

/// The dev server a development shell points its windows at only exists while a
/// developer is running the command, which is the whole reason the entry above
/// is refused.
fn development_shell_reason(app: &tauri::AppHandle) -> String {
    development_shell_message(
        app.config()
            .build
            .dev_url
            .as_ref()
            .map(|url| url.as_str()),
    )
}

fn development_shell_message(dev_url: Option<&str>) -> String {
    match dev_url {
        Some(url) => format!(
            "开发版不能设置开机启动：它的页面由本地开发服务器（{url}）提供，登录时该服务不在运行，窗口打开也是白屏。请在安装版里开启。"
        ),
        None => "开发版不能设置开机启动：它的页面由本地开发服务器提供，登录时该服务不在运行，窗口打开也是白屏。请在安装版里开启。"
            .to_owned(),
    }
}

fn executable_path() -> Result<PathBuf, String> {
    std::env::current_exe().map_err(|error| format!("无法确定程序路径：{error}"))
}

#[cfg(windows)]
fn current_entry(_app: &tauri::AppHandle) -> Result<Option<String>, String> {
    windows_entry()
}

#[cfg(windows)]
fn write_entry(_app: &tauri::AppHandle, executable: &Path) -> Result<(), String> {
    // Quoted so a path containing spaces stays a single argument.
    windows_write_value(&format!("\"{}\"", executable.display()))
}

#[cfg(windows)]
fn remove_entry(_app: &tauri::AppHandle) -> Result<(), String> {
    windows_remove_value()
}

#[cfg(windows)]
fn windows_entry() -> Result<Option<String>, String> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let key = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(WINDOWS_RUN_KEY)
        .map_err(|error| format!("无法打开开机启动注册表项：{error}"))?;
    match key.get_value::<String, _>(WINDOWS_ENTRY_NAME) {
        Ok(value) => Ok(Some(value)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("无法读取开机启动注册表项：{error}")),
    }
}

#[cfg(windows)]
fn windows_write_value(value: &str) -> Result<(), String> {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_SET_VALUE};
    use winreg::RegKey;

    let key = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey_with_flags(WINDOWS_RUN_KEY, KEY_SET_VALUE)
        .map_err(|error| format!("无法写入开机启动注册表项：{error}"))?;
    key.set_value(WINDOWS_ENTRY_NAME, &value.to_owned())
        .map_err(|error| format!("无法写入开机启动注册表项：{error}"))
}

#[cfg(windows)]
fn windows_remove_value() -> Result<(), String> {
    use winreg::enums::{HKEY_CURRENT_USER, KEY_SET_VALUE};
    use winreg::RegKey;

    let key = RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey_with_flags(WINDOWS_RUN_KEY, KEY_SET_VALUE)
        .map_err(|error| format!("无法写入开机启动注册表项：{error}"))?;
    match key.delete_value(WINDOWS_ENTRY_NAME) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("无法删除开机启动注册表项：{error}")),
    }
}

/// LaunchAgent label: never hardcode the bundle identifier, `tauri.conf.json`
/// is its single source of truth (`docs/development-brief.md`).
#[cfg(target_os = "macos")]
fn launch_agent_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;

    let home = std::env::var_os("HOME").ok_or_else(|| "无法确定用户主目录".to_owned())?;
    Ok(PathBuf::from(home)
        .join("Library")
        .join("LaunchAgents")
        .join(format!("{}.plist", app.config().identifier)))
}

#[cfg(target_os = "macos")]
fn current_entry(app: &tauri::AppHandle) -> Result<Option<String>, String> {
    let path = launch_agent_path(app)?;
    match std::fs::read_to_string(&path) {
        Ok(content) => Ok(Some(content)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("无法读取开机启动配置：{error}")),
    }
}

#[cfg(target_os = "macos")]
fn write_entry(app: &tauri::AppHandle, executable: &Path) -> Result<(), String> {
    let path = launch_agent_path(app)?;
    let directory = path
        .parent()
        .ok_or_else(|| "开机启动配置路径缺少父目录".to_owned())?;
    std::fs::create_dir_all(directory)
        .map_err(|error| format!("无法创建 LaunchAgents 目录：{error}"))?;
    std::fs::write(&path, launch_agent_plist(app, executable))
        .map_err(|error| format!("无法写入开机启动配置：{error}"))
}

#[cfg(target_os = "macos")]
fn remove_entry(app: &tauri::AppHandle) -> Result<(), String> {
    let path = launch_agent_path(app)?;
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("无法删除开机启动配置：{error}")),
    }
}

#[cfg(target_os = "macos")]
fn launch_agent_plist(app: &tauri::AppHandle, executable: &Path) -> String {
    use tauri::Manager;

    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>{label}</string>
	<key>ProgramArguments</key>
	<array>
		<string>{executable}</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
</dict>
</plist>
"#,
        label = app.config().identifier,
        executable = executable.display()
    )
}

#[cfg(not(any(windows, target_os = "macos")))]
fn current_entry(_app: &tauri::AppHandle) -> Result<Option<String>, String> {
    Ok(None)
}

#[cfg(not(any(windows, target_os = "macos")))]
fn write_entry(_app: &tauri::AppHandle, _executable: &Path) -> Result<(), String> {
    Err("当前平台暂不支持开机启动".to_owned())
}

#[cfg(not(any(windows, target_os = "macos")))]
fn remove_entry(_app: &tauri::AppHandle) -> Result<(), String> {
    Err("当前平台暂不支持开机启动".to_owned())
}

#[cfg(test)]
mod build_guard_tests {
    use super::*;

    /// The reason is the only part of the refusal a person reads, so it has to
    /// name the thing that is missing: without the server there is no page.
    #[test]
    fn the_refusal_names_the_dev_server_it_depends_on() {
        let named = development_shell_message(Some("http://127.0.0.1:5173"));
        assert!(named.contains("http://127.0.0.1:5173"), "{named}");
        assert!(named.contains("安装版"), "{named}");

        // A config without `devUrl` still has to explain itself.
        let unnamed = development_shell_message(None);
        assert!(unnamed.contains("本地开发服务器"), "{unnamed}");
    }

    /// Pins the assumption the guard rests on. `cargo test` compiles the
    /// configuration `tauri dev` compiles, so the refusal has to be live right
    /// here; the packaged configuration (`custom-protocol`, added by
    /// `tauri build`) is the one that turns it off, and no bare `cargo`
    /// invocation produces that, which is why the other half is not asserted.
    #[test]
    fn a_development_build_is_refused_a_login_entry() {
        if !cfg!(debug_assertions) {
            return;
        }
        assert!(
            is_development_shell(),
            "a development build must not be allowed to own a login entry"
        );
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    /// Round-trips the real `Run` entry: a wrong key path, entry name, or value
    /// kind fails here instead of silently never launching the app at login.
    /// Whatever was registered before the test is put back afterwards.
    #[test]
    fn run_entry_round_trips() {
        let previous = windows_entry().expect("read Run entry");
        let executable = Path::new(r"C:\Program Files\Servant\Servant.exe");

        windows_write_value(&format!("\"{}\"", executable.display())).expect("write Run entry");
        assert_eq!(
            windows_entry().expect("read back"),
            Some(r#""C:\Program Files\Servant\Servant.exe""#.to_owned())
        );

        // A missing entry is a normal state, not an error.
        windows_remove_value().expect("remove Run entry");
        assert_eq!(windows_entry().expect("read after remove"), None);
        windows_remove_value().expect("remove stays idempotent");

        if let Some(value) = previous {
            windows_write_value(&value).expect("restore previous entry");
        }
    }
}
