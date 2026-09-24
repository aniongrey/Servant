use tauri::{
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder, Window,
    WindowEvent,
};

use crate::provisioning_gate;

pub fn setup(app: &tauri::App) -> tauri::Result<()> {
    let mut tray = TrayIconBuilder::with_id("shiro")
        .tooltip("Shiro 桌面伙伴")
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left | MouseButton::Right,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                if let Err(error) = show_desktop_menu(tray.app_handle()) {
                    eprintln!("Unable to show tray menu: {error}");
                }
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    let handle = app.handle().clone();
    // First run opens the setup wizard; later runs go straight to the chat.
    let first_window = if first_run_setup_required(app) {
        "setup"
    } else {
        "chat"
    };
    tauri::async_runtime::spawn(async move {
        if let Err(error) = open_app_window(handle, first_window.to_owned()).await {
            eprintln!("Failed to open {first_window} window at startup: {error}");
        }
    });
    Ok(())
}

/**
 * Whether the wizard, not the chat, should be the first window.
 *
 * The backend decides, because it owns the resource manifest and can see the
 * disk: a machine whose models already sit in the chosen download directory, a
 * bundled mirror or a per-user shared root has nothing to prepare, and asking it
 * to download 1.4 GB again is a lie (`provisioningGate.ts`).
 *
 * Both launch flavours are asked: the packaged sidecar, and — since development
 * mounts the same route table on the page origin — the dev server named by
 * `build.devUrl` (`provisioning_gate.rs`). Only a backend that cannot be reached
 * at all falls through to the state-file flag, and that flag answers for *this*
 * build's data directory alone, so it is a poor substitute rather than the rule.
 */
fn first_run_setup_required(app: &tauri::App) -> bool {
    match provisioning_gate::setup_required(app.handle()) {
        Some(required) => required,
        None => !is_provisioned(app.handle()),
    }
}

/**
 * True once the setup wizard has completed at least once. The wizard writes
 * `provisioning-state.json` (with `setupComplete: true`) into the per-user data
 * directory; we gate the first launch on its presence so a fresh install always
 * lands in the wizard while subsequent launches skip it.
 *
 * The fallback for {@link first_run_setup_required}: it answers for *this* build's
 * data directory only, which is exactly why the backend's answer comes first.
 */
fn is_provisioned(app: &AppHandle) -> bool {
    let dir = match app.path().app_data_dir() {
        Ok(dir) => dir,
        Err(_) => return false,
    };
    let path = dir.join("provisioning-state.json");
    match std::fs::read_to_string(&path) {
        Ok(content) => {
            content.contains("\"setupComplete\":true") || content.contains("\"setupComplete\": true")
        }
        Err(_) => false,
    }
}

pub fn handle_window_event(window: &Window, event: &WindowEvent) {
    if window.label() == "desktop-menu" && matches!(event, WindowEvent::Focused(false)) {
        let _ = window.hide();
    }
    if window.label() == "pet" || window.label() == "desktop-menu" {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            if let Err(error) = window.hide() {
                eprintln!("Failed to hide {}: {error}", window.label());
            }
        }
    }
}

fn show_desktop_menu(app: &AppHandle) -> Result<(), String> {
    let menu = if let Some(existing) = app.get_webview_window("desktop-menu") {
        existing
    } else {
        WebviewWindowBuilder::new(
            app,
            "desktop-menu",
            WebviewUrl::App("index.html?view=desktop-menu".into()),
        )
        .title("Shiro 菜单")
        .inner_size(240.0, 320.0)
        .resizable(false)
        .decorations(false)
        .shadow(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .visible(false)
        .build()
        .map_err(|error| format!("Failed to create desktop menu: {error}"))?
    };
    let cursor = app.cursor_position().map_err(|error| error.to_string())?;
    let size = menu.outer_size().map_err(|error| error.to_string())?;
    let monitors = app
        .available_monitors()
        .map_err(|error| error.to_string())?;
    let mut point = PhysicalPosition::new(cursor.x as i32, cursor.y as i32);
    if let Some(monitor) = monitors.iter().find(|monitor| {
        let origin = monitor.position();
        let dimensions = monitor.size();
        cursor.x >= origin.x as f64
            && cursor.x < origin.x as f64 + dimensions.width as f64
            && cursor.y >= origin.y as f64
            && cursor.y < origin.y as f64 + dimensions.height as f64
    }) {
        point = tray_menu_position(cursor, size, monitor.position(), monitor.size());
    }
    menu.set_position(point)
        .map_err(|error| error.to_string())?;
    menu.show().map_err(|error| error.to_string())?;
    menu.set_focus().map_err(|error| error.to_string())
}

fn tray_menu_position(
    cursor: PhysicalPosition<f64>,
    menu_size: tauri::PhysicalSize<u32>,
    monitor_position: &PhysicalPosition<i32>,
    monitor_size: &tauri::PhysicalSize<u32>,
) -> PhysicalPosition<i32> {
    let max_x = monitor_position.x + monitor_size.width as i32 - menu_size.width as i32;
    let max_y = monitor_position.y + monitor_size.height as i32 - menu_size.height as i32;
    PhysicalPosition::new(
        (cursor.x as i32).clamp(monitor_position.x, max_x.max(monitor_position.x)),
        (cursor.y as i32 - menu_size.height as i32)
            .clamp(monitor_position.y, max_y.max(monitor_position.y)),
    )
}

#[cfg(test)]
mod tests {
    use super::tray_menu_position;
    use tauri::{PhysicalPosition, PhysicalSize};

    #[test]
    fn tray_menu_expands_upward_from_the_icon_across_the_taskbar() {
        let point = tray_menu_position(
            PhysicalPosition::new(1200.0, 1060.0),
            PhysicalSize::new(240, 320),
            &PhysicalPosition::new(0, 0),
            &PhysicalSize::new(1920, 1080),
        );

        assert_eq!(point, PhysicalPosition::new(1200, 740));
    }
}

#[tauri::command]
pub async fn open_pet_menu(window: WebviewWindow) -> Result<(), String> {
    if window.label() != "pet" {
        return Err("Character menu is only available in the pet window".into());
    }
    show_desktop_menu(window.app_handle())
}

#[tauri::command]
pub async fn run_desktop_menu_action(window: WebviewWindow, label: String) -> Result<(), String> {
    if !matches!(window.label(), "pet" | "desktop-menu") {
        return Err("Desktop menu actions are only available from the pet or menu".into());
    }
    if !matches!(
        label.as_str(),
        "toggle-pet" | "chat" | "settings" | "restart" | "quit"
    ) {
        return Err(format!("Unsupported desktop menu action: {label}"));
    }
    let app = window.app_handle().clone();
    if let Some(menu) = app.get_webview_window("desktop-menu") {
        menu.hide().map_err(|error| error.to_string())?;
    }
    if label == "quit" {
        app.exit(0);
        return Ok(());
    }
    if label == "restart" {
        app.request_restart();
        return Ok(());
    }
    if label == "toggle-pet" {
        let pet = app
            .get_webview_window("pet")
            .ok_or_else(|| "Desktop pet window is missing".to_owned())?;
        if pet.is_visible().map_err(|error| error.to_string())? {
            pet.hide().map_err(|error| error.to_string())?;
        } else {
            pet.unminimize().map_err(|error| error.to_string())?;
            pet.show().map_err(|error| error.to_string())?;
            pet.set_focus().map_err(|error| error.to_string())?;
        }
        return Ok(());
    }
    open_app_window(app, label).await
}

#[tauri::command]
pub async fn open_app_window(app: AppHandle, label: String) -> Result<(), String> {
    // Secondary pages live in `pages/`; the repository root keeps only the app
    // shell (`index.html`) and the navigation page (`pages.html`).
    let (title, url, width, height, maximize) = match label.as_str() {
        "pet" => ("Shiro", "pages/desktop.html", 520.0, 760.0, false),
        "chat" => ("Shiro 对话", "pages/chat-test.html", 460.0, 720.0, false),
        "setup" => ("Shiro 初始化", "pages/setup.html", 760.0, 880.0, false),
        "settings" => ("Shiro 设置", "pages/settings.html", 1280.0, 800.0, true),
        "debug" => ("Shiro Debug", "pages/debug.html", 1280.0, 800.0, true),
        _ => return Err(format!("Unsupported app window: {label}")),
    };

    let window = if let Some(existing) = app.get_webview_window(&label) {
        existing
    } else {
        if label == "pet" {
            return Err("Desktop pet window is missing".into());
        }
        WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(url.into()))
            .title(title)
            .inner_size(width, height)
        .min_inner_size(
            if label == "chat" {
                360.0
            } else if label == "setup" {
                640.0
            } else {
                900.0
            },
            if label == "chat" {
                480.0
            } else if label == "setup" {
                720.0
            } else {
                600.0
            },
        )
            .resizable(true)
            .decorations(!matches!(label.as_str(), "settings" | "chat"))
            .transparent(label == "chat")
            .shadow(label != "chat")
            .always_on_top(false)
            .build()
            .map_err(|error| format!("Failed to create {label} window: {error}"))?
    };

    window
        .unminimize()
        .map_err(|error| format!("Failed to restore {label} window: {error}"))?;
    if label == "settings" {
        window
            .set_decorations(false)
            .map_err(|error| format!("Failed to hide settings decorations: {error}"))?;
    }
    window
        .show()
        .map_err(|error| format!("Failed to show {label} window: {error}"))?;
    if maximize {
        window
            .maximize()
            .map_err(|error| format!("Failed to maximize {label} window: {error}"))?;
    }
    window
        .set_focus()
        .map_err(|error| format!("Failed to focus {label} window: {error}"))
}

#[tauri::command]
pub fn get_desktop_pet_visible(app: AppHandle) -> Result<bool, String> {
    app.get_webview_window("pet")
        .ok_or_else(|| "Desktop pet window is missing".to_owned())?
        .is_visible()
        .map_err(|error| error.to_string())
}
