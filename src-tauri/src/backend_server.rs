//! Owns the standalone Servant backend process.
//!
//! The packaged app serves its UI from the Tauri asset protocol, which answers
//! any unknown path with `index.html`. A relative `/api/*` request therefore
//! returns HTML, `response.json()` throws `Unexpected token '<'`, and every
//! feature that talks to the backend dies at once. The fix is a real backend on
//! loopback, which is what this module starts and supervises.
//!
//! Development needs no sidecar: the Vite dev/preview server mounts the very
//! same route table on the page origin. That case reports itself as
//! [`BackendMode::External`] so the frontend keeps issuing relative URLs.
//!
//! Set `SERVANT_FORCE_SIDECAR=1` to exercise the packaged path during development.

use std::{
    env, fs,
    net::TcpListener,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::{Duration, Instant},
};

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::quiet_process::quiet;
use crate::realtime_gateway::kill_process_tree;

/// Generous: the backend bundle is ~3 MB and the packaged payload starts cold.
const READY_TIMEOUT: Duration = Duration::from_secs(30);
const PORT_POLL_INTERVAL: Duration = Duration::from_millis(120);
const BACKEND_BASENAME: &str = "servant-server";
/// Bundle produced by `npm run server:build`; the development fallback payload.
const BACKEND_BUNDLE: &str = "servant-server.cjs";
/// Prefix of the per-process announcement file, completed with our pid.
///
/// The portable build and the installed build share one app data directory on
/// purpose (so swapping between them keeps conversations and memory), which
/// means a single shared `backend-port.json` would have two running instances
/// overwriting each other's port and connecting to the wrong backend. The port
/// file is removed by the backend itself on clean exit; a crash leaves a few
/// bytes behind, which is cheaper than the alternative.
const PORT_FILE_PREFIX: &str = "backend-port-";
const LOG_FILE_NAME: &str = "backend.log";

fn port_file_name() -> String {
    format!("{PORT_FILE_PREFIX}{}.json", std::process::id())
}

/// How the frontend should reach `/api/*`.
#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum BackendMode {
    /// A backend process owned by this app, on a loopback port.
    Sidecar,
    /// The page origin itself serves the backend; keep URLs relative.
    External,
}

/// Mirror of `ServantServerInfo` in `src/app/network/apiBase.ts`.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendInfo {
    pub mode: BackendMode,
    pub port: u16,
    pub base_url: String,
}

impl BackendInfo {
    fn external() -> Self {
        Self {
            mode: BackendMode::External,
            port: 0,
            base_url: String::new(),
        }
    }
}

pub struct BackendProcess {
    child: Mutex<Option<Child>>,
    info: BackendInfo,
}

impl BackendProcess {
    /// Starts the backend when the app owns one, degrading to [`BackendMode::External`]
    /// on failure so a broken sidecar cannot stop the window from opening.
    pub fn start(app: &AppHandle) -> Self {
        if !should_own_sidecar() {
            return Self {
                child: Mutex::new(None),
                info: BackendInfo::external(),
            };
        }
        match launch(app) {
            Ok((child, port)) => Self {
                child: Mutex::new(Some(child)),
                info: BackendInfo {
                    mode: BackendMode::Sidecar,
                    port,
                    base_url: format!("http://127.0.0.1:{port}"),
                },
            },
            Err(error) => {
                eprintln!("[servant] backend sidecar unavailable: {error}");
                Self {
                    child: Mutex::new(None),
                    info: BackendInfo::external(),
                }
            }
        }
    }

    pub fn info(&self) -> BackendInfo {
        self.info.clone()
    }

    pub fn stop(&self) {
        let mut guard = self.child.lock().unwrap();
        if let Some(mut child) = guard.take() {
            kill_process_tree(child.id());
            let _ = child.wait();
        }
    }
}

impl Drop for BackendProcess {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Only the packaged app owns a backend; development already has one on 5173.
fn should_own_sidecar() -> bool {
    if env::var("SERVANT_FORCE_SIDECAR").is_ok_and(|value| value.trim() == "1") {
        return true;
    }
    !cfg!(debug_assertions)
}

fn launch(app: &AppHandle) -> Result<(Child, u16), String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("unable to resolve the app data directory: {error}"))?;
    fs::create_dir_all(&data_dir).map_err(|error| format!("unable to create {}: {error}", data_dir.display()))?;

    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| format!("unable to resolve the resource directory: {error}"))?;

    let port_file = data_dir.join(port_file_name());
    // A stale announcement from a previous run would be read as this run's port.
    let _ = fs::remove_file(&port_file);

    let project_root = project_root_for(&resource_dir);
    let mut command = backend_command(&resource_dir)?;
    command
        .env("SERVANT_PROJECT_ROOT", &project_root)
        .env("SERVANT_DATA_DIR", &data_dir)
        // Let the OS pick a port: two Servant instances must coexist.
        .env("SERVANT_SERVER_PORT", "0")
        .env("SERVANT_SERVER_PORT_FILE", &port_file)
        .stdin(Stdio::piped())
        .stdout(log_stdio(&data_dir)?)
        .stderr(log_stdio(&data_dir)?);

    let mut child = command.spawn().map_err(|error| {
        format!(
            "unable to spawn the backend ({:?}): {error}",
            command.get_program()
        )
    })?;

    match wait_for_port(&port_file, &mut child) {
        Ok(port) => Ok((child, port)),
        Err(error) => {
            kill_process_tree(child.id());
            let _ = child.wait();
            Err(format!("{error} (see {})", data_dir.join(LOG_FILE_NAME).display()))
        }
    }
}

/// The packaged payload is one self-contained executable; development runs the
/// bundle straight from the checkout through the system Node. Both are console
/// programs launched from a windowless app, so both go through [`quiet`] — a
/// bare spawn would put a black console window in front of every session.
fn backend_command(resource_dir: &Path) -> Result<Command, String> {
    let executable = resource_dir.join(format!("{BACKEND_BASENAME}{}", env::consts::EXE_SUFFIX));
    if executable.is_file() {
        return Ok(quiet(Command::new(executable)));
    }

    if cfg!(debug_assertions) {
        let bundle = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join(BACKEND_BUNDLE);
        if bundle.is_file() {
            let mut command = quiet(Command::new("node"));
            command.arg(bundle);
            return Ok(command);
        }
    }

    Err(format!(
        "no backend payload in {} — run `npm run server:package`",
        resource_dir.display()
    ))
}

/// Read-only assets come from the install directory when packaged, but from the
/// checkout while developing with `SERVANT_FORCE_SIDECAR=1`.
fn project_root_for(resource_dir: &Path) -> PathBuf {
    if cfg!(debug_assertions) {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| resource_dir.to_path_buf())
    } else {
        resource_dir.to_path_buf()
    }
}

/// Backend output goes to a file: a windowed build has no console to print to,
/// and this is the only way to see why a sidecar refused to start.
fn log_stdio(data_dir: &Path) -> Result<Stdio, String> {
    let path = data_dir.join(LOG_FILE_NAME);
    let file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|error| format!("unable to open {}: {error}", path.display()))?;
    Ok(Stdio::from(file))
}

/// The backend announces its port by writing a file — the only channel that
/// works when stdout is already captured for logging.
fn wait_for_port(port_file: &Path, child: &mut Child) -> Result<u16, String> {
    let deadline = Instant::now() + READY_TIMEOUT;
    while Instant::now() < deadline {
        if let Ok(text) = fs::read_to_string(port_file) {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) {
                if let Some(port) = value.get("port").and_then(serde_json::Value::as_u64) {
                    let port = u16::try_from(port)
                        .map_err(|_| format!("backend announced an invalid port: {port}"))?;
                    wait_until_listening(port)?;
                    return Ok(port);
                }
            }
        }
        if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
            return Err(format!("backend exited before it was ready: {status}"));
        }
        std::thread::sleep(PORT_POLL_INTERVAL);
    }
    Err("timed out waiting for the backend to announce its port".to_owned())
}

/// The port file is written just before `listen`, so give the socket a moment:
/// the window opens on this call and a refused first request is a bad start.
fn wait_until_listening(port: u16) -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        if TcpListener::bind(("127.0.0.1", port)).is_err() {
            return Ok(());
        }
        std::thread::sleep(PORT_POLL_INTERVAL);
    }
    Err(format!("backend never accepted connections on port {port}"))
}
