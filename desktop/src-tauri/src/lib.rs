use std::process::Stdio;
use tokio::io::AsyncBufReadExt;
use tokio::process::Command;

/// Find FreeClaude CLI binary
fn find_cli() -> String {
    if let Ok(path) = std::env::var("FREECLAUDE_PATH") {
        return path;
    }
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    let local = format!("{}/.freeclaude/bin/freeclaude", home);
    if std::path::Path::new(&local).exists() {
        return local;
    }
    "npx".to_string()
}

/// Get CLI command with args
fn cli_command() -> (String, Vec<String>) {
    let cli = find_cli();
    if cli == "npx" {
        ("npx".to_string(), vec!["freeclaude".to_string()])
    } else {
        (cli, vec![])
    }
}

#[tauri::command]
async fn chat(message: String) -> Result<String, String> {
    let (cmd, args) = cli_command();
    let mut full_args = args.clone();
    full_args.extend_from_slice(&[
        "--print".to_string(),
        message,
    ]);

    let mut child = Command::new(&cmd)
        .args(&full_args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e: std::io::Error| format!("Failed to start FreeClaude: {}", e))?;

    let stdout = child.stdout.take().ok_or("No stdout")?;
    let reader = tokio::io::BufReader::new(stdout);
    let mut output = String::new();

    let mut lines = reader.lines();
    while let Some(line) = lines.next_line().await.map_err(|e: std::io::Error| e.to_string())? {
        output.push_str(&line);
        output.push('\n');
    }

    let status = child.wait().await.map_err(|e: std::io::Error| e.to_string())?;

    if !status.success() {
        let code = status.code().unwrap_or(-1);
        return Err(format!("FreeClaude exited with code {}", code));
    }

    Ok(output.trim().to_string())
}

#[tauri::command]
async fn get_providers() -> Result<String, String> {
    let home = std::env::var("HOME").map_err(|_| "Cannot determine home".to_string())?;
    let config_path = format!("{}/.freeclaude.json", home);

    if !std::path::Path::new(&config_path).exists() {
        return Ok(r#"{"providers":[],"configured":false}"#.to_string());
    }

    let content = std::fs::read_to_string(&config_path)
        .map_err(|e: std::io::Error| format!("Failed to read config: {}", e))?;

    let mut config: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e: serde_json::Error| format!("Invalid JSON: {}", e))?;

    if let Some(providers) = config.get_mut("providers").and_then(|p| p.as_array_mut()) {
        for provider in providers.iter_mut() {
            if let Some(api_key) = provider.get_mut("apiKey").and_then(|k| k.as_str()) {
                if api_key.len() > 8 {
                    let masked = format!("{}....{}", &api_key[..4], &api_key[api_key.len()-4..]);
                    if let Some(k) = provider.get_mut("apiKey") {
                        *k = serde_json::Value::String(masked);
                    }
                }
            }
        }
    }

    serde_json::to_string_pretty(&config).map_err(|e: serde_json::Error| e.to_string())
}

#[tauri::command]
async fn get_costs() -> Result<String, String> {
    let home = std::env::var("HOME").map_err(|_| "Cannot determine home".to_string())?;
    let costs_path = format!("{}/.freeclaude/costs.jsonl", home);

    if !std::path::Path::new(&costs_path).exists() {
        return Ok(r#"{"totalCost":0.0,"totalRequests":0,"byProvider":{}}"#.to_string());
    }

    let content = std::fs::read_to_string(&costs_path)
        .map_err(|e: std::io::Error| format!("Failed: {}", e))?;

    let mut total_cost = 0.0_f64;
    let mut total_requests = 0_i64;
    let mut by_provider: std::collections::HashMap<String, serde_json::Value> = std::collections::HashMap::new();

    for line in content.lines() {
        if let Ok(entry) = serde_json::from_str::<serde_json::Value>(line) {
            let cost = entry.get("estimatedCost").and_then(|c| c.as_f64()).unwrap_or(0.0);
            let provider = entry.get("provider").and_then(|p| p.as_str()).unwrap_or("unknown").to_string();
            let req_count = entry.get("provider").and_then(|p| p.as_str()).is_some();
            total_cost += cost;
            if req_count { total_requests += 1; }
            let prev = by_provider.get(&provider).and_then(|v| v.as_f64()).unwrap_or(0.0);
            by_provider.insert(provider, serde_json::json!(prev + cost));
        }
    }

    let result = serde_json::json!({
        "totalCost": total_cost,
        "totalRequests": total_requests,
        "byProvider": by_provider,
    });

    serde_json::to_string_pretty(&result).map_err(|e: serde_json::Error| e.to_string())
}

#[tauri::command]
async fn get_version() -> Result<String, String> {
    let (cmd, args) = cli_command();
    let mut full_args = args.clone();
    full_args.push("--version".to_string());

    let output = Command::new(&cmd)
        .args(&full_args)
        .output()
        .await
        .map_err(|e: std::io::Error| format!("Failed: {}", e))?;

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![chat, get_providers, get_costs, get_version])
        .run(tauri::generate_context!())
        .expect("error while running FreeClaude Desktop");
}
