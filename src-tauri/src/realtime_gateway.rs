use std::{
    collections::HashMap,
    env, fs,
    net::TcpListener as StdTcpListener,
    path::PathBuf,
    process::{Command, Stdio},
    sync::{Arc, Mutex as StdMutex},
};

use futures_util::{SinkExt, StreamExt};
use regex::Regex;
use serde_json::{json, Value};
use tokio::{
    net::{TcpListener, TcpStream},
    sync::{mpsc, Mutex},
};
use tokio_tungstenite::{accept_async, tungstenite::Message};

use crate::quiet_process::quiet;

const PROTOCOL_VERSION: u8 = 1;
type ClientSender = mpsc::UnboundedSender<Message>;

#[derive(Default)]
struct GatewayState {
    next_connection_id: u64,
    clients: HashMap<String, ClientSender>,
}

pub struct GatewayProcess {
    task: StdMutex<Option<tauri::async_runtime::JoinHandle<()>>>,
    pid_file: PathBuf,
    port: u16,
}

impl GatewayProcess {
    pub fn start(pid_file: PathBuf) -> Result<Self, String> {
        cleanup_stale(&pid_file);
        let listener = bind_listener()?;
        let port = listener
            .local_addr()
            .map_err(|error| format!("Failed to read realtime gateway port: {error}"))?
            .port();
        listener
            .set_nonblocking(true)
            .map_err(|error| format!("Failed to configure realtime gateway: {error}"))?;
        if let Some(directory) = pid_file.parent() {
            fs::create_dir_all(directory)
                .map_err(|error| format!("Failed to create gateway data directory: {error}"))?;
        }
        fs::write(&pid_file, std::process::id().to_string())
            .map_err(|error| format!("Failed to write gateway PID: {error}"))?;
        let task = tauri::async_runtime::spawn(async move {
            let listener = match TcpListener::from_std(listener) {
                Ok(listener) => listener,
                Err(error) => {
                    eprintln!("Failed to start realtime gateway: {error}");
                    return;
                }
            };
            let state = Arc::new(Mutex::new(GatewayState::default()));
            loop {
                match listener.accept().await {
                    Ok((stream, _)) => {
                        let state = Arc::clone(&state);
                        tauri::async_runtime::spawn(async move {
                            accept_client(stream, state).await
                        });
                    }
                    Err(error) => eprintln!("Servant realtime gateway accept failed: {error}"),
                }
            }
        });
        Ok(Self {
            task: StdMutex::new(Some(task)),
            pid_file,
            port,
        })
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    pub fn stop(&self) {
        if let Some(task) = self.task.lock().unwrap().take() {
            task.abort();
        }
        let _ = fs::remove_file(&self.pid_file);
    }
}

fn bind_listener() -> Result<StdTcpListener, String> {
    StdTcpListener::bind(("127.0.0.1", 0))
        .map_err(|error| format!("Failed to reserve a realtime gateway port: {error}"))
}

fn cleanup_stale(pid_file: &PathBuf) {
    let Ok(pid_text) = fs::read_to_string(pid_file) else {
        return;
    };
    if let Ok(pid) = pid_text.trim().parse::<u32>() {
        if pid != std::process::id() {
            kill_process_tree(pid);
        }
    }
    let _ = fs::remove_file(pid_file);
}

#[cfg(target_os = "windows")]
pub(crate) fn kill_process_tree(pid: u32) {
    let _ = quiet(Command::new("taskkill"))
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn kill_process_tree(pid: u32) {
    let _ = Command::new("kill")
        .args(["-TERM", &pid.to_string()])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

async fn accept_client(stream: TcpStream, state: Arc<Mutex<GatewayState>>) {
    let socket = match accept_async(stream).await {
        Ok(socket) => socket,
        Err(error) => {
            eprintln!("Servant realtime websocket handshake failed: {error}");
            return;
        }
    };
    let connection_id = {
        let mut guard = state.lock().await;
        guard.next_connection_id += 1;
        format!("tauri-{}", guard.next_connection_id)
    };
    let (outgoing, mut incoming) = socket.split();
    let (sender, mut receiver) = mpsc::unbounded_channel::<Message>();
    {
        let mut guard = state.lock().await;
        guard.clients.insert(connection_id.clone(), sender.clone());
    }
    send_json(&sender, ready(&connection_id));
    let writer = tauri::async_runtime::spawn(async move {
        let mut outgoing = outgoing;
        while let Some(message) = receiver.recv().await {
            if outgoing.send(message).await.is_err() {
                break;
            }
        }
    });

    while let Some(result) = incoming.next().await {
        let Ok(message) = result else { break };
        if message.is_close() {
            break;
        }
        let Message::Text(raw) = message else {
            continue;
        };
        let command: Value = match serde_json::from_str(&raw) {
            Ok(value) => value,
            Err(_) => {
                send_json(
                    &sender,
                    error("invalid_message", "Invalid realtime command", None),
                );
                continue;
            }
        };
        handle_command(&connection_id, &sender, command, Arc::clone(&state)).await;
    }

    writer.abort();
    let mut guard = state.lock().await;
    guard.clients.remove(&connection_id);
}

async fn handle_command(
    _connection_id: &str,
    sender: &ClientSender,
    command: Value,
    state: Arc<Mutex<GatewayState>>,
) {
    let request_id = command.get("id").and_then(Value::as_str).map(str::to_owned);
    if command.get("version").and_then(Value::as_u64) != Some(PROTOCOL_VERSION.into())
        || command.get("type").and_then(Value::as_str) != Some("command")
    {
        send_json(
            sender,
            error(
                "invalid_message",
                "Invalid realtime command",
                request_id.as_deref(),
            ),
        );
        return;
    }
    let feature = command
        .get("feature")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let action = command
        .get("action")
        .and_then(Value::as_str)
        .unwrap_or_default();
    match (feature, action) {
        ("desktop.sync", "publish") => {
            let Some(payload) = command.get("payload") else {
                send_json(
                    sender,
                    error(
                        "invalid_payload",
                        "desktop sync payload is required",
                        request_id.as_deref(),
                    ),
                );
                return;
            };
            if payload.get("type").and_then(Value::as_str).is_none() {
                send_json(
                    sender,
                    error(
                        "invalid_payload",
                        "desktop sync event type is required",
                        request_id.as_deref(),
                    ),
                );
                return;
            }
            broadcast(&state, event("desktop.sync", payload.clone())).await;
            send_json(
                sender,
                ack(request_id.as_deref(), json!({ "published": true })),
            );
        }
        ("web.search", "run") => {
            web_search(sender, request_id.as_deref(), command.get("payload"), state).await
        }
        _ => send_json(
            sender,
            error(
                "unknown_feature",
                "Unknown realtime feature or action",
                request_id.as_deref(),
            ),
        ),
    }
}

async fn web_search(
    sender: &ClientSender,
    request_id: Option<&str>,
    payload: Option<&Value>,
    state: Arc<Mutex<GatewayState>>,
) {
    let Some(payload) = payload else {
        send_json(
            sender,
            error(
                "invalid_payload",
                "web search payload is required",
                request_id,
            ),
        );
        return;
    };
    let Some(job_id) = payload
        .get("jobId")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
    else {
        send_json(
            sender,
            error("invalid_payload", "jobId is required", request_id),
        );
        return;
    };
    let Some(query) = payload
        .get("query")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| value.len() >= 2)
    else {
        send_json(
            sender,
            error(
                "invalid_payload",
                "query must contain at least 2 characters",
                request_id,
            ),
        );
        return;
    };
    let max_results = payload
        .get("maxResults")
        .and_then(Value::as_u64)
        .unwrap_or(5)
        .clamp(1, 8) as usize;
    let url = format!("https://html.duckduckgo.com/html/?q={}", url_encode(query));
    let proxy_url = payload
        .get("proxyUrl")
        .and_then(Value::as_str)
        .filter(|value| value.starts_with("http://") || value.starts_with("https://"))
        .map(str::to_owned)
        .or_else(system_proxy_url);
    let mut client = reqwest::Client::builder();
    if let Some(proxy_url) = proxy_url {
        if let Ok(proxy) = reqwest::Proxy::all(proxy_url) {
            client = client.proxy(proxy);
        }
    }
    let client = match client.build() {
        Ok(client) => client,
        Err(cause) => {
            broadcast_web_search_failure(&state, job_id, &cause.to_string()).await;
            send_json(
                sender,
                error("search_failed", &cause.to_string(), request_id),
            );
            return;
        }
    };
    let response = client
        .get(url)
        .header(
            reqwest::header::USER_AGENT,
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Servant/0.1",
        )
        .header(reqwest::header::ACCEPT, "text/html,application/xhtml+xml")
        .send()
        .await;
    let html = match response {
        Ok(response) if response.status().is_success() => response.text().await.unwrap_or_default(),
        Ok(response) => {
            let message = format!("web search failed ({})", response.status());
            broadcast_web_search_failure(&state, job_id, &message).await;
            send_json(sender, error("search_failed", &message, request_id));
            return;
        }
        Err(cause) => {
            let message = format!("web search failed: {cause}");
            broadcast_web_search_failure(&state, job_id, &message).await;
            send_json(sender, error("search_failed", &message, request_id));
            return;
        }
    };
    let results = parse_duckduckgo_results(&html, max_results);
    if results.is_empty() {
        let message = "联网搜索没有返回可用结果。";
        broadcast_web_search_failure(&state, job_id, message).await;
        send_json(sender, error("search_failed", message, request_id));
        return;
    }
    broadcast(
        &state,
        event(
            "desktop.sync",
            json!({
                "type": "tool-result",
                "requestId": job_id,
                "tool": "web-search",
                "action": "run",
                "success": true,
                "speech": "",
                "content": { "query": query, "results": results }
            }),
        ),
    )
    .await;
    send_json(
        sender,
        ack(
            request_id,
            json!({ "jobId": job_id, "completed": true, "resultCount": results.len() }),
        ),
    );
}

async fn broadcast_web_search_failure(
    state: &Arc<Mutex<GatewayState>>,
    job_id: &str,
    message: &str,
) {
    broadcast(
        state,
        event(
            "desktop.sync",
            json!({
                "type": "tool-result",
                "requestId": job_id,
                "tool": "web-search",
                "action": "run",
                "success": false,
                "speech": "联网查询失败了。",
                "error": message
            }),
        ),
    )
    .await;
}

fn system_proxy_url() -> Option<String> {
    ["SERVANT_PROXY_URL", "HTTPS_PROXY", "HTTP_PROXY"]
        .iter()
        .find_map(|key| env::var(key).ok().filter(|value| !value.trim().is_empty()))
        .or_else(|| Some("http://127.0.0.1:7890".to_owned()))
}

fn parse_duckduckgo_results(html: &str, max_results: usize) -> Vec<Value> {
    let link = Regex::new(r#"(?s)<a[^>]+class=["'][^"']*\bresult__a\b[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>(.*?)</a>"#)
        .expect("valid search link regex");
    let snippet =
        Regex::new(r#"(?s)<a[^>]+class=["'][^"']*\bresult__snippet\b[^"']*["'][^>]*>(.*?)</a>"#)
            .expect("valid search snippet regex");
    let strip_tags = Regex::new(r"(?s)<[^>]+>").expect("valid tag regex");
    let snippets = snippet
        .captures_iter(html)
        .map(|capture| {
            html_decode(
                &strip_tags.replace_all(capture.get(1).map_or("", |item| item.as_str()), " "),
            )
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
        })
        .collect::<Vec<_>>();
    link.captures_iter(html)
        .enumerate()
        .filter_map(|(index, capture)| {
            let url = normalize_search_result_url(capture.get(1)?.as_str())?;
            let title = html_decode(&strip_tags.replace_all(capture.get(2)?.as_str(), " "))
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ");
            if title.is_empty() {
                return None;
            }
            Some(json!({
                "title": title,
                "url": url,
                "snippet": snippets.get(index).cloned().unwrap_or_default()
            }))
        })
        .take(max_results)
        .collect()
}

fn normalize_search_result_url(raw_href: &str) -> Option<String> {
    let decoded = html_decode(raw_href);
    let absolute = if decoded.starts_with("//") {
        format!("https:{decoded}")
    } else {
        decoded
    };
    if absolute.starts_with("https://duckduckgo.com/l/")
        || absolute.starts_with("http://duckduckgo.com/l/")
    {
        let encoded_destination = absolute
            .split_once('?')?
            .1
            .split('&')
            .find_map(|part| part.strip_prefix("uddg="))?;
        let destination = percent_decode(encoded_destination)?;
        return is_http_url(&destination).then_some(destination);
    }
    is_http_url(&absolute).then_some(absolute)
}

fn is_http_url(value: &str) -> bool {
    value.starts_with("http://") || value.starts_with("https://")
}

fn percent_decode(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let high = hex_value(*bytes.get(index + 1)?)?;
            let low = hex_value(*bytes.get(index + 2)?)?;
            decoded.push(high * 16 + low);
            index += 3;
        } else {
            decoded.push(if bytes[index] == b'+' {
                b' '
            } else {
                bytes[index]
            });
            index += 1;
        }
    }
    String::from_utf8(decoded).ok()
}

fn hex_value(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

fn html_decode(value: &str) -> String {
    value
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#x27;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
}

fn url_encode(value: &str) -> String {
    value
        .bytes()
        .flat_map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                vec![byte as char].into_iter().collect::<Vec<_>>()
            }
            b' ' => vec!['+'],
            _ => format!("%{byte:02X}").chars().collect(),
        })
        .collect()
}

async fn broadcast(state: &Arc<Mutex<GatewayState>>, body: Value) {
    let clients = state
        .lock()
        .await
        .clients
        .values()
        .cloned()
        .collect::<Vec<_>>();
    for client in clients {
        send_json(&client, body.clone());
    }
}

fn send_json(sender: &ClientSender, body: Value) {
    let _ = sender.send(Message::Text(body.to_string().into()));
}

fn ready(connection_id: &str) -> Value {
    json!({ "version": PROTOCOL_VERSION, "type": "ready", "connectionId": connection_id })
}
fn ack(request_id: Option<&str>, payload: Value) -> Value {
    json!({ "version": PROTOCOL_VERSION, "type": "ack", "requestId": request_id.unwrap_or(""), "payload": payload })
}
fn event(topic: &str, payload: Value) -> Value {
    json!({ "version": PROTOCOL_VERSION, "type": "event", "topic": topic, "payload": payload })
}
fn error(code: &str, message: &str, request_id: Option<&str>) -> Value {
    json!({ "version": PROTOCOL_VERSION, "type": "error", "code": code, "message": message, "requestId": request_id })
}

#[cfg(test)]
mod tests {
    use super::{bind_listener, normalize_search_result_url, parse_duckduckgo_results};

    #[test]
    fn reserves_an_available_dynamic_port() {
        let listener = bind_listener().unwrap();

        assert_ne!(listener.local_addr().unwrap().port(), 0);
    }

    #[test]
    fn unwraps_duckduckgo_redirect_urls() {
        let url = normalize_search_result_url(
            "//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fweather%3Fa%3D1&amp;rut=ignored",
        );
        assert_eq!(url.as_deref(), Some("https://example.com/weather?a=1"));
    }

    #[test]
    fn parses_titles_snippets_and_destination_urls() {
        let html = r#"
            <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fweather&amp;rut=x"><b>香港</b>天气</a>
            <a class="result__snippet" href="//duckduckgo.com/l/">今天晴朗 &amp; 温暖</a>
        "#;
        let results = parse_duckduckgo_results(html, 5);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0]["url"], "https://example.com/weather");
        assert_eq!(results[0]["title"], "香港 天气");
        assert_eq!(results[0]["snippet"], "今天晴朗 & 温暖");
    }
}
