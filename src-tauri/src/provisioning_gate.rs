//! Asks the backend whether first-run setup still has work to do.
//!
//! The rule itself lives in `src/app/network/server/provisioningGate.ts`, because
//! the resource manifest does. A machine whose models are already on disk — in the
//! directory the user chose, in a bundled mirror, or in a root another Servant build
//! downloaded to — must not be sent through setup again, and only the backend can
//! see all of that.
//!
//! So Rust only *asks*, once, before the first window exists: a blocking GET.
//!
//! *The ask has to reach whichever backend is actually serving.* A packaged run
//! owns a sidecar, so it asks that port — `main.rs` starts the sidecar and waits
//! for the port before `desktop_windows::setup()` runs, so nothing is cold-started
//! here. A development run owns no sidecar at all (`backend_server.rs`), because
//! Vite mounts the very same route table on the page origin; asking it at
//! `build.devUrl` reaches the exact same JS. Naming only the sidecar case was a
//! bug: `npm run tauri:fast` fell straight through to the state-file fallback and
//! opened the wizard on every launch.
//!
//! The fallback remains the last resort — a backend that cannot be reached at all
//! — and it keeps the behaviour from before this module existed.

use std::{
    io::{Read, Write},
    net::{TcpStream, ToSocketAddrs},
    time::Duration,
};

use serde_json::Value;
use tauri::{AppHandle, Manager, Url};

use crate::backend_server::{BackendMode, BackendProcess};

const GATE_PATH: &str = "/api/provisioning/gate";
/// Generous next to a loopback round trip, short enough not to hold up a window.
const TIMEOUT: Duration = Duration::from_millis(2_000);
/// "Nobody answered" opens the wizard, so a momentarily busy server gets retries
/// rather than a wrong answer.
const ATTEMPTS: usize = 3;
const RETRY_DELAY: Duration = Duration::from_millis(400);

/// `Some(true)` = open the setup wizard. `None` = the backend could not be asked.
pub fn setup_required(app: &AppHandle) -> Option<bool> {
    let endpoint = gate_endpoint(app)?;
    for attempt in 0..ATTEMPTS {
        if let Ok(gate) = get_json(&endpoint, GATE_PATH, TIMEOUT) {
            return gate.get("setupRequired").and_then(Value::as_bool);
        }
        if attempt + 1 < ATTEMPTS {
            std::thread::sleep(RETRY_DELAY);
        }
    }
    None
}

/// The backend that serves `/api/*` for the window about to be opened.
fn gate_endpoint(app: &AppHandle) -> Option<Endpoint> {
    let info = app.try_state::<BackendProcess>()?.info();
    if info.mode == BackendMode::Sidecar && info.port != 0 {
        return Some(Endpoint {
            host: "127.0.0.1".to_owned(),
            port: info.port,
        });
    }
    Endpoint::from_url(app.config().build.dev_url.as_ref()?)
}

struct Endpoint {
    host: String,
    port: u16,
}

impl Endpoint {
    fn from_url(url: &Url) -> Option<Self> {
        // `host_str()` hands back an IPv6 literal already bracketed, and
        // `authority()` brackets it again — so unwrap first and keep one rule.
        let host = url
            .host_str()?
            .trim_start_matches('[')
            .trim_end_matches(']')
            .to_owned();
        Some(Self {
            host,
            port: url.port_or_known_default()?,
        })
    }

    /// Host header form: an IPv6 literal has to be bracketed.
    fn authority(&self) -> String {
        if self.host.contains(':') {
            format!("[{}]:{}", self.host, self.port)
        } else {
            format!("{}:{}", self.host, self.port)
        }
    }
}

fn get_json(endpoint: &Endpoint, path: &str, timeout: Duration) -> Result<Value, String> {
    let address = (endpoint.host.as_str(), endpoint.port)
        .to_socket_addrs()
        .map_err(|error| error.to_string())?
        .next()
        .ok_or_else(|| format!("unable to resolve {}", endpoint.host))?;
    let mut stream =
        TcpStream::connect_timeout(&address, timeout).map_err(|error| error.to_string())?;
    stream
        .set_read_timeout(Some(timeout))
        .map_err(|error| error.to_string())?;
    stream
        .set_write_timeout(Some(timeout))
        .map_err(|error| error.to_string())?;

    // `Connection: close` is what makes the read side simple: the body ends when
    // the connection does, so no content-length or chunked decoding is needed.
    let request = format!(
        "GET {path} HTTP/1.1\r\nHost: {}\r\nAccept: application/json\r\nConnection: close\r\n\r\n",
        endpoint.authority()
    );
    stream
        .write_all(request.as_bytes())
        .map_err(|error| error.to_string())?;

    let mut raw = Vec::new();
    stream
        .read_to_end(&mut raw)
        .map_err(|error| error.to_string())?;
    parse_response(&raw)
}

/// Status code and JSON body of a plain HTTP response.
fn parse_response(raw: &[u8]) -> Result<Value, String> {
    let boundary = raw
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .ok_or_else(|| "malformed HTTP response: no header terminator".to_owned())?;
    let head = std::str::from_utf8(&raw[..boundary]).map_err(|error| error.to_string())?;
    let status = head
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|code| code.parse::<u16>().ok())
        .ok_or_else(|| "malformed HTTP response: no status line".to_owned())?;
    if !(200..300).contains(&status) {
        return Err(format!("backend answered HTTP {status}"));
    }
    serde_json::from_slice(&raw[boundary + 4..])
        .map_err(|error| format!("backend answered non-JSON: {error}"))
}

#[cfg(test)]
mod tests {
    use super::{get_json, parse_response, Endpoint};
    use std::{
        io::{Read, Write},
        net::TcpListener,
        thread,
        time::Duration,
    };
    use tauri::Url;

    #[test]
    fn reads_the_flag_out_of_a_well_formed_response() {
        // No content-length on purpose: the body is delimited by the connection.
        let response =
            b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"setupRequired\":true,\"reason\":\"\"}";
        let value = parse_response(response).expect("a 200 with JSON parses");
        assert_eq!(
            value.get("setupRequired").and_then(|flag| flag.as_bool()),
            Some(true)
        );
    }

    #[test]
    fn refuses_a_non_success_response_instead_of_parsing_its_body() {
        let response = b"HTTP/1.1 503 Service Unavailable\r\n\r\n{}";
        assert!(parse_response(response).is_err());
    }

    #[test]
    fn refuses_a_body_that_is_not_json() {
        // The packaged asset protocol answers unknown paths with HTML; a caller
        // that parsed that would read a page as a verdict.
        let response = b"HTTP/1.1 200 OK\r\n\r\n<!DOCTYPE html>";
        assert!(parse_response(response).is_err());
    }

    /// The development case: no sidecar, so the page origin has to be asked.
    #[test]
    fn a_dev_url_names_the_backend_that_serves_the_page() {
        let url = Url::parse("http://127.0.0.1:5173").expect("a dev url");
        let endpoint = Endpoint::from_url(&url).expect("a dev url yields an endpoint");
        assert_eq!(endpoint.host, "127.0.0.1");
        assert_eq!(endpoint.port, 5173);
        assert_eq!(endpoint.authority(), "127.0.0.1:5173");
    }

    #[test]
    fn a_dev_url_without_a_port_falls_back_to_the_scheme_default() {
        let url = Url::parse("http://localhost").expect("a dev url");
        let endpoint = Endpoint::from_url(&url).expect("a dev url yields an endpoint");
        assert_eq!(endpoint.port, 80);
    }

    #[test]
    fn an_ipv6_dev_url_gets_a_bracketed_host_header() {
        let url = Url::parse("http://[::1]:5173").expect("an ipv6 dev url");
        let endpoint = Endpoint::from_url(&url).expect("an ipv6 dev url yields an endpoint");
        assert_eq!(endpoint.port, 5173);
        assert_eq!(endpoint.authority(), "[::1]:5173");
    }

    #[test]
    fn a_url_without_a_host_has_nobody_to_ask() {
        assert!(Endpoint::from_url(&Url::parse("file:///index.html").expect("a file url")).is_none());
    }

    #[test]
    fn talks_to_a_socket_and_returns_the_json_body() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind a loopback port");
        let port = listener.local_addr().expect("local address").port();
        let server = thread::spawn(move || {
            let (mut socket, _) = listener.accept().expect("accept one request");
            let mut request = [0_u8; 512];
            let read = socket.read(&mut request).expect("read the request");
            let request = String::from_utf8_lossy(&request[..read]).to_string();
            socket
                .write_all(b"HTTP/1.1 200 OK\r\n\r\n{\"setupRequired\":false}")
                .expect("write the response");
            request
        });

        let endpoint = Endpoint {
            host: "127.0.0.1".to_owned(),
            port,
        };
        let value =
            get_json(&endpoint, "/api/provisioning/gate", Duration::from_secs(5)).expect("the gate answers");
        assert_eq!(
            value.get("setupRequired").and_then(|flag| flag.as_bool()),
            Some(false)
        );
        let request = server.join().expect("the listener thread finishes");
        assert!(request.starts_with("GET /api/provisioning/gate HTTP/1.1"));
        assert!(request.contains("Connection: close"));
    }
}
