use std::{fs, path::PathBuf, time::{SystemTime, UNIX_EPOCH}};

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

pub fn request(app: &AppHandle, method: String, suffix: String, body: Option<String>) -> Result<Value, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("character-skill")
        .join("library.json");
    let mut library = read_library(&path)?;
    match (method.as_str(), suffix.as_str()) {
        ("GET", "") => Ok(library["cards"]
            .as_array()
            .and_then(|cards| cards.iter().find(|card| card["id"] == library["activeId"]))
            .cloned()
            .unwrap_or(Value::Null)),
        ("GET", "/library") => Ok(library),
        ("POST", "/library") => {
            let mut card = body_value(body)?;
            let id = format!("local-{}", SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e| e.to_string())?.as_nanos());
            card["id"] = Value::String(id.clone());
            library["cards"].as_array_mut().ok_or("角色卡列表无效。")?.push(card);
            library["activeId"] = Value::String(id);
            write_library(&path, &library)?;
            Ok(library)
        }
        ("PUT", "/library") => {
            let id = body_value(body)?["id"].as_str().unwrap_or_default().to_owned();
            if !id.is_empty() && !has_card(&library, &id) { return Err("角色卡不存在。".into()); }
            library["activeId"] = Value::String(id);
            write_library(&path, &library)?;
            Ok(library)
        }
        ("DELETE", route) if route.starts_with("/library/") => {
            let id = &route["/library/".len()..];
            if id == "builtin" || !has_card(&library, id) { return Err("角色卡不存在。".into()); }
            library["cards"].as_array_mut().ok_or("角色卡列表无效。")?.retain(|card| card["id"] != id);
            if library["activeId"] == id { library["activeId"] = Value::String("builtin".into()); }
            write_library(&path, &library)?;
            Ok(library)
        }
        _ => Err("不支持的角色卡操作。".into()),
    }
}

fn read_library(path: &PathBuf) -> Result<Value, String> {
    if let Ok(content) = fs::read_to_string(path) { return serde_json::from_str(&content).map_err(|_| "角色卡列表无效。".into()); }
    let default = include_str!("../../src/character/state/assets/data/shiro/skills.md");
    let library = json!({ "activeId": "builtin", "cards": [{ "id": "builtin", "fileName": "skills.md", "markdown": default }] });
    write_library(path, &library)?;
    Ok(library)
}

fn write_library(path: &PathBuf, library: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() { fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
    fs::write(path, serde_json::to_vec(library).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

fn body_value(body: Option<String>) -> Result<Value, String> {
    serde_json::from_str(body.as_deref().unwrap_or("{}"))
        .map_err(|_| "角色卡请求无效。".into())
}

fn has_card(library: &Value, id: &str) -> bool {
    library["cards"].as_array().is_some_and(|cards| cards.iter().any(|card| card["id"] == id))
}
