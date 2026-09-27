use tauri::{
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder, Window,
    WindowEvent,
};
use std::sync::Mutex;

use crate::provisioning_gate;

#[derive(Default)]
pub struct StageWindowRestore(Mutex<Option<(PhysicalPosition<i32>, tauri::PhysicalSize<u32>)>>);

pub fn setup(app: &tauri::App) -> tauri::Result<()> {
    app.manage(StageWindowRestore::default());
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
    // Meeting creates the pet after its UI and command bridge have mounted.
    let first_window = if first_run_setup_required(app) {
        "setup"
    } else {
        "meeting"
    };
    tauri::async_runtime::spawn(async move {
        if let Err(error) = open_app_window(handle, first_window.to_owned(), None).await {
            eprintln!("Failed to open {first_window} window at startup: {error}");
        }
    });
    Ok(())
}

#[tauri::command]
pub async fn meeting_ready(window: WebviewWindow) -> Result<(), String> {
    if window.label() != "meeting" {
        return Err("Only the meeting window can finish desktop startup".into());
    }
    let app = window.app_handle();
    if app.get_webview_window("pet").is_none() {
        let config = app.config().app.windows.iter().find(|config| config.label == "pet")
            .ok_or_else(|| "Desktop pet configuration is missing".to_owned())?;
        WebviewWindowBuilder::from_config(app, config)
            .map_err(|error| error.to_string())?
            .focused(false)
            .build()
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn set_desktop_stage_mode(window: WebviewWindow, enabled: bool, restore: tauri::State<'_, StageWindowRestore>) -> Result<(), String> {
    if window.label() != "pet" { return Err("Desktop stage mode is only available in the pet window".into()); }
    if enabled {
        let mut saved = restore.0.lock().map_err(|error| error.to_string())?;
        if saved.is_none() {
            *saved = Some((window.outer_position().map_err(|error| error.to_string())?, window.outer_size().map_err(|error| error.to_string())?));
        }
        let monitor = window.current_monitor().map_err(|error| error.to_string())?
            .or(window.primary_monitor().map_err(|error| error.to_string())?)
            .ok_or_else(|| "No desktop monitors found".to_owned())?;
        let area = monitor.work_area();
        let width = (960.0 * monitor.scale_factor()).min(area.size.width as f64 * 0.9) as u32;
        let height = (width as f64 * 9.0 / 16.0).min(area.size.height as f64 * 0.9) as u32;
        window.set_size(tauri::PhysicalSize::new(width, height)).map_err(|error| error.to_string())?;
        window.set_position(PhysicalPosition::new(area.position.x + (area.size.width - width) as i32 / 2,
            area.position.y + (area.size.height - height) as i32 / 2)).map_err(|error| error.to_string())?;
        window.set_decorations(false).map_err(|error| error.to_string())?;
        window.set_resizable(true).map_err(|error| error.to_string())?;
        window.set_always_on_top(false).map_err(|error| error.to_string())?;
        window.set_skip_taskbar(false).map_err(|error| error.to_string())?;
        window.set_ignore_cursor_events(false).map_err(|error| error.to_string())?;
        window.set_fullscreen(true).map_err(|error| error.to_string())?;
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
    } else if let Some((position, size)) = restore.0.lock().map_err(|error| error.to_string())?.take() {
        window.set_fullscreen(false).map_err(|error| error.to_string())?;
        window.set_resizable(false).map_err(|error| error.to_string())?;
        window.set_always_on_top(true).map_err(|error| error.to_string())?;
        window.set_size(size).map_err(|error| error.to_string())?;
        window.set_position(position).map_err(|error| error.to_string())?;
        window.set_skip_taskbar(false).map_err(|error| error.to_string())?;
    }
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
    if matches!(window.label(), "pet" | "desktop-menu" | "meeting") {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            if let Err(error) = window.hide() {
                eprintln!("Failed to hide {}: {error}", window.label());
            }
        }
    }
}

/// 菜单窗口的内宽；高度由前端量出的内容高决定（`fit_desktop_menu`）。
const DESKTOP_MENU_WIDTH: f64 = 240.0;
/// 前端报出真实高度之前的临时内高。宁可高一点：多出来的部分在顶部、透明，
/// 而矮一点就会把最后一项（退出）裁掉。
const DESKTOP_MENU_INITIAL_HEIGHT: f64 = 380.0;
const DESKTOP_MENU_MIN_HEIGHT: f64 = 120.0;
const DESKTOP_MENU_MAX_HEIGHT: f64 = 640.0;

/// 前端报的内容高 → 窗口内高。越界或非有限值一律退回初始内高，
/// 免得一个坏值把窗口压成一条缝、再也点不到。
fn menu_height_for_content(reported: f64) -> f64 {
    if reported.is_finite() && (DESKTOP_MENU_MIN_HEIGHT..=DESKTOP_MENU_MAX_HEIGHT).contains(&reported) {
        reported.ceil()
    } else {
        DESKTOP_MENU_INITIAL_HEIGHT
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
        .inner_size(DESKTOP_MENU_WIDTH, DESKTOP_MENU_INITIAL_HEIGHT)
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
    anchor_desktop_menu(&menu)?;
    menu.show().map_err(|error| error.to_string())?;
    menu.set_focus().map_err(|error| error.to_string())
}

/**
 * 把菜单窗口摆到光标上方：底边贴住光标，越出显示器就夹回可见范围。
 *
 * 位置依赖窗口尺寸（`tray_menu_position` 按底边对齐），所以改过尺寸之后必须重新摆一次，
 * 否则窗口会朝下长出去、把内容顶到屏幕外。
 */
fn anchor_desktop_menu(menu: &WebviewWindow) -> Result<(), String> {
    let app = menu.app_handle();
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
        .map_err(|error| error.to_string())
}

/// 前端量出菜单内容的高度后把窗口贴上去。
///
/// 高度不能写死：菜单项、字号、系统字体都会让它变，矮了就把最后一项裁一半。
#[tauri::command]
pub async fn fit_desktop_menu(window: WebviewWindow, height: f64) -> Result<(), String> {
    if window.label() != "desktop-menu" {
        return Err("Only the character menu sizes itself".into());
    }
    let height = menu_height_for_content(height);
    window
        .set_size(tauri::LogicalSize::new(DESKTOP_MENU_WIDTH, height))
        .map_err(|error| error.to_string())?;
    anchor_desktop_menu(&window)
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
    use super::{
        menu_height_for_content, recovered_pet_geometry, sanitize_section, tray_menu_position,
        DESKTOP_MENU_INITIAL_HEIGHT,
    };
    use tauri::{PhysicalPosition, PhysicalSize};

    #[test]
    fn menu_height_follows_the_content_and_survives_bad_reports() {
        // 内容高 340.8（标题 + 7 项）曾被写死的 320 裁掉最后一项，现在向上取整跟随内容。
        assert_eq!(menu_height_for_content(340.8), 341.0);
        assert_eq!(menu_height_for_content(200.0), 200.0);
        // 坏值（未加载完量出的 0、非有限值、离谱的大值）退回初始高，而不是压成一条缝。
        assert_eq!(menu_height_for_content(0.0), DESKTOP_MENU_INITIAL_HEIGHT);
        assert_eq!(menu_height_for_content(-10.0), DESKTOP_MENU_INITIAL_HEIGHT);
        assert_eq!(menu_height_for_content(f64::NAN), DESKTOP_MENU_INITIAL_HEIGHT);
        assert_eq!(menu_height_for_content(5000.0), DESKTOP_MENU_INITIAL_HEIGHT);
    }

    #[test]
    fn recovery_fits_the_work_area_including_negative_monitor_coordinates() {
        assert_eq!(
            recovered_pet_geometry(PhysicalSize::new(1620, 1620), PhysicalPosition::new(-1920, 40), PhysicalSize::new(1920, 1040)),
            (PhysicalPosition::new(-1770, 40), PhysicalSize::new(1620, 1040)),
        );
        assert_eq!(
            recovered_pet_geometry(PhysicalSize::new(1080, 1080), PhysicalPosition::new(0, 0), PhysicalSize::new(2560, 1400)),
            (PhysicalPosition::new(740, 160), PhysicalSize::new(1080, 1080)),
        );
    }

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
        "toggle-pet" | "recover-pet" | "chat" | "meeting" | "settings" | "restart" | "quit"
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
    if label == "recover-pet" {
        let pet = app.get_webview_window("pet").ok_or_else(|| "Desktop pet window is missing".to_owned())?;
        let monitors = pet.available_monitors().map_err(|error| error.to_string())?;
        let cursor = app.cursor_position().map_err(|error| error.to_string())?;
        let monitor = app.monitor_from_point(cursor.x, cursor.y).map_err(|error| error.to_string())?
            .or(pet.primary_monitor().map_err(|error| error.to_string())?)
            .or_else(|| monitors.first().cloned())
            .ok_or_else(|| "No desktop monitors found".to_owned())?;
        let config = app.config().app.windows.iter().find(|window| window.label == "pet")
            .ok_or_else(|| "Desktop pet configuration is missing".to_owned())?;
        let desired = tauri::LogicalSize::new(config.width, config.height).to_physical(monitor.scale_factor());
        let area = monitor.work_area();
        let (position, size) = recovered_pet_geometry(desired, area.position, area.size);
        // Discard stale stage geometry instead of briefly restoring an off-screen position.
        app.state::<StageWindowRestore>().0.lock().map_err(|error| error.to_string())?.take();
        pet.unminimize().map_err(|error| error.to_string())?;
        pet.set_fullscreen(false).map_err(|error| error.to_string())?;
        pet.set_resizable(false).map_err(|error| error.to_string())?;
        pet.set_position(position).map_err(|error| error.to_string())?;
        pet.set_size(size).map_err(|error| error.to_string())?;
        pet.set_skip_taskbar(false).map_err(|error| error.to_string())?;
        pet.set_always_on_top(true).map_err(|error| error.to_string())?;
        pet.show().map_err(|error| error.to_string())?;
        pet.set_focus().map_err(|error| error.to_string())?;
        pet.emit("servant-pet-recovered", position).map_err(|error| error.to_string())?;
        return Ok(());
    }
    open_app_window(app, label, None).await
}

fn recovered_pet_geometry(
    desired: tauri::PhysicalSize<u32>,
    origin: PhysicalPosition<i32>,
    bounds: tauri::PhysicalSize<u32>,
) -> (PhysicalPosition<i32>, tauri::PhysicalSize<u32>) {
    let size = tauri::PhysicalSize::new(desired.width.min(bounds.width), desired.height.min(bounds.height));
    let position = PhysicalPosition::new(
        origin.x + ((bounds.width - size.width) / 2) as i32,
        origin.y + ((bounds.height - size.height) / 2) as i32,
    );
    (position, size)
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
        "meeting" => ("Servant 多人聊天", "pages/meeting.html", 1440.0, 900.0, true),
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
            } else if label == "meeting" {
                900.0
            } else if label == "setup" {
                640.0
            } else {
                900.0
            },
            if label == "chat" {
                480.0
            } else if label == "meeting" {
                620.0
            } else if label == "setup" {
                720.0
            } else {
                600.0
            },
        )
            .resizable(true)
            .decorations(!matches!(label.as_str(), "settings" | "chat" | "meeting"))
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
