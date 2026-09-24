use tauri::{
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder, Window,
    WindowEvent,
};

use crate::provisioning_gate;

pub fn setup(app: &tauri::App) -> tauri::Result<()> {
    let mut tray = TrayIconBuilder::with_id("servant")
        .tooltip("Servant 桌面伙伴")
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
        if let Err(error) = open_app_window(handle, first_window.to_owned(), None).await {
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
    use super::{sanitize_section, tray_menu_position};
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

    #[test]
    fn settings_section_accepts_panel_names_and_drops_everything_else() {
        assert_eq!(
            sanitize_section(Some("llm".to_owned())),
            Some("llm".to_owned())
        );
        assert_eq!(
            sanitize_section(Some("  character-settings  ".to_owned())),
            Some("character-settings".to_owned())
        );
        // Nothing that could rewrite the URL beyond its query, or smuggle a
        // second parameter in, survives.
        assert_eq!(sanitize_section(None), None);
        assert_eq!(sanitize_section(Some(String::new())), None);
        assert_eq!(sanitize_section(Some("   ".to_owned())), None);
        assert_eq!(sanitize_section(Some("llm&x=1".to_owned())), None);
        assert_eq!(sanitize_section(Some("llm?y=1".to_owned())), None);
        assert_eq!(sanitize_section(Some("../index".to_owned())), None);
        assert_eq!(sanitize_section(Some("llm panel".to_owned())), None);
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
    open_app_window(app, label, None).await
}

/**
 * Opens — or brings forward — one of the app windows.
 *
 * `section` picks the initial panel of the settings window: the setup wizard
 * ends by sending the user there to fill in their LLM provider, which the wizard
 * deliberately does not configure itself. The panel travels in the URL rather
 * than as an event, because an event can outrun a webview that is still booting
 * and would then be dropped; an already open window is re-navigated instead, so
 * a second request still lands on the requested panel.
 */
#[tauri::command]
pub async fn open_app_window(
    app: AppHandle,
    label: String,
    section: Option<String>,
) -> Result<(), String> {
    // Secondary pages live in `pages/`; the repository root keeps only the app
    // shell (`index.html`) and the navigation page (`pages.html`).
    let (title, url, width, height, maximize) = match label.as_str() {
        "pet" => ("Servant", "pages/desktop.html", 520.0, 760.0, false),
        "chat" => ("Servant 对话", "pages/chat.html", 460.0, 720.0, false),
        "setup" => ("Servant 初始化", "pages/setup.html", 760.0, 880.0, false),
        "settings" => ("Servant 设置", "pages/settings.html", 1280.0, 800.0, true),
        "debug" => ("Servant Debug", "pages/debug.html", 1280.0, 800.0, true),
        _ => return Err(format!("Unsupported app window: {label}")),
    };
    // Only the settings window has panels, so a value sent to any other label is
    // dropped rather than appended to a URL that has nothing to read it.
    let section = if label == "settings" {
        sanitize_section(section)
    } else {
        None
    };

    let window = if let Some(existing) = app.get_webview_window(&label) {
        if let Some(section) = section.as_deref() {
            navigate_to_section(&existing, section);
        }
        existing
    } else {
        if label == "pet" {
            return Err("Desktop pet window is missing".into());
        }
        let url = match section.as_deref() {
            Some(section) => format!("{url}?section={section}"),
            None => url.to_owned(),
        };
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

/**
 * Keeps the query string to a plain panel name.
 *
 * The value crosses a process boundary as an argument, so it is validated rather
 * than escaped: anything outside `[A-Za-z0-9_-]` cannot be a panel this app has,
 * and dropping it is cheaper than reasoning about what the encoded form means
 * inside a webview URL.
 */
fn sanitize_section(section: Option<String>) -> Option<String> {
    let value = section?;
    let value = value.trim();
    if value.is_empty()
        || !value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-' || character == '_')
    {
        return None;
    }
    Some(value.to_owned())
}

/**
 * Moves an open settings window onto the requested panel.
 *
 * Showing an existing window does not re-run the page's mount-time query reader,
 * so the only way to change panels from outside is a real navigation — which
 * changing the query is what triggers. A window already on that panel is left
 * alone, otherwise re-asking would throw away whatever the user was in the
 * middle of editing.
 */
fn navigate_to_section(window: &WebviewWindow, section: &str) {
    let Ok(mut url) = window.url() else {
        return;
    };
    if url
        .query_pairs()
        .any(|(key, value)| key == "section" && value == section)
    {
        return;
    }
    url.set_query(Some(&format!("section={section}")));
    if let Err(error) = window.navigate(url) {
        eprintln!("Failed to show settings panel {section}: {error}");
    }
}

#[tauri::command]
pub fn get_desktop_pet_visible(app: AppHandle) -> Result<bool, String> {
    app.get_webview_window("pet")
        .ok_or_else(|| "Desktop pet window is missing".to_owned())?
        .is_visible()
        .map_err(|error| error.to_string())
}
