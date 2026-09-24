#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use tauri::{AppHandle, Emitter, Manager, RunEvent};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

mod autostart;
mod backend_server;
mod desktop_windows;
mod character_skill;
mod provisioning_gate;
mod realtime_gateway;

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            load_reminder_jobs,
            save_reminder_jobs,
            quarantine_reminder_jobs,
            realtime_gateway_port,
            shiro_server_info,
            desktop_windows::open_app_window,
            desktop_windows::open_pet_menu,
            desktop_windows::run_desktop_menu_action,
            desktop_windows::get_desktop_pet_visible,
            set_push_to_talk_shortcut
            ,character_skill_request,
            append_debug_log,
            autostart::set_autostart
        ])
        .setup(|app| {
            let pid_file = app
                .path()
                .app_data_dir()?
                .join("realtime-gateway.pid");
            let gateway = realtime_gateway::GatewayProcess::start(pid_file)
                .map_err(std::io::Error::other)?;
            app.manage(gateway);
            // Before the window loads: the first page script asks for the API
            // base through `shiro_server_info`, so the port must already exist.
            app.manage(backend_server::BackendProcess::start(app.handle()));
            desktop_windows::setup(app)?;
            use tauri_plugin_global_shortcut::{Builder, ShortcutState};

            app.handle().plugin(
                Builder::new()
                    .with_handler(|app, _shortcut, event| {
                        let payload = match event.state {
                            ShortcutState::Pressed => "pressed",
                            ShortcutState::Released => "released",
                        };
                        let _ = app.emit("shiro-global-ptt", payload);
                    })
                    .build(),
            )?;
            Ok(())
        })
        .on_window_event(desktop_windows::handle_window_event)
        .build(tauri::generate_context!())
        .expect("error while building Shiro desktop application");

    app.run(|app_handle, event| {
        if matches!(event, RunEvent::Exit) {
            if let Some(gateway) = app_handle.try_state::<realtime_gateway::GatewayProcess>() {
                gateway.stop();
            }
            if let Some(backend) = app_handle.try_state::<backend_server::BackendProcess>() {
                backend.stop();
            }
        }
    });
}

#[tauri::command]
fn character_skill_request(
    app: AppHandle,
    method: String,
    suffix: String,
    body: Option<String>,
) -> Result<serde_json::Value, String> {
    character_skill::request(&app, method, suffix, body)
}

#[tauri::command]
fn append_debug_log(app: AppHandle, line: String) -> Result<(), String> {
    // Never hardcode the data directory: it is derived from the bundle
    // identifier, so a hardcoded name silently writes to a directory the rest
    // of the app does not use.
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let path = directory.join("debug.log");
    use std::io::Write;
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| error.to_string())?;
    writeln!(file, "{line}").map_err(|error| error.to_string())
}

#[tauri::command]
fn set_push_to_talk_shortcut(
    app: AppHandle,
    enabled: bool,
    shortcut_code: String,
) -> Result<(), String> {
    let shortcut = shortcut_code
        .strip_prefix("Key")
        .or_else(|| shortcut_code.strip_prefix("Digit"))
        .unwrap_or(&shortcut_code);
    let shortcuts = app.global_shortcut();
    if enabled && !shortcuts.is_registered(shortcut) {
        shortcuts.register(shortcut).map_err(|error| error.to_string())?;
    } else if !enabled && shortcuts.is_registered(shortcut) {
        shortcuts.unregister(shortcut).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn realtime_gateway_port(
    gateway: tauri::State<'_, realtime_gateway::GatewayProcess>,
) -> u16 {
    gateway.port()
}

/// Where the frontend should send `/api/*`. Packaged builds get a loopback
/// sidecar; development gets `external`, meaning "keep URLs relative".
#[tauri::command]
fn shiro_server_info(
    backend: tauri::State<'_, backend_server::BackendProcess>,
) -> backend_server::BackendInfo {
    backend.info()
}

#[tauri::command]
fn load_reminder_jobs(app: AppHandle) -> Result<Option<String>, String> {
    let path = reminder_jobs_path(&app)?;
    match fs::read_to_string(path) {
        Ok(content) => Ok(Some(content)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("Failed to read reminder jobs: {error}")),
    }
}

#[tauri::command]
fn save_reminder_jobs(app: AppHandle, content: String) -> Result<(), String> {
    let path = reminder_jobs_path(&app)?;
    let directory = path
        .parent()
        .ok_or_else(|| "Reminder jobs path has no parent".to_owned())?;
    fs::create_dir_all(directory)
        .map_err(|error| format!("Failed to create reminder directory: {error}"))?;
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, content)
        .map_err(|error| format!("Failed to write reminder jobs: {error}"))?;
    fs::rename(temporary, path).map_err(|error| format!("Failed to commit reminder jobs: {error}"))
}

#[tauri::command]
fn quarantine_reminder_jobs(app: AppHandle) -> Result<(), String> {
    let path = reminder_jobs_path(&app)?;
    if !path.exists() {
        return Ok(());
    }
    let broken = path.with_extension(format!(
        "json.broken-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|error| format!("Failed to read system time: {error}"))?
            .as_millis()
    ));
    fs::rename(path, broken).map_err(|error| format!("Failed to quarantine reminder jobs: {error}"))
}

fn reminder_jobs_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join("reminders").join("jobs.json"))
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))
}
