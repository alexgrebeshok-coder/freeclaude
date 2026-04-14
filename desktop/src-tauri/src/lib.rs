use std::path::{Path, PathBuf};
use std::process::{Command as StdCommand, Stdio};
use std::time::UNIX_EPOCH;

use serde_json::{json, Value};
use tokio::process::Command as TokioCommand;

fn command_exists(command: &str) -> bool {
    let lookup = if cfg!(target_os = "windows") {
        "where"
    } else {
        "which"
    };

    StdCommand::new(lookup)
        .arg(command)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn home_dir() -> Result<String, String> {
    std::env::var("HOME").map_err(|_| "Cannot determine home directory".to_string())
}

fn find_cli() -> String {
    if let Ok(path) = std::env::var("FREECLAUDE_PATH") {
        return path;
    }

    if let Ok(home) = home_dir() {
        let local = format!("{}/.freeclaude/bin/freeclaude", home);
        if Path::new(&local).exists() {
            return local;
        }
    }

    if command_exists("freeclaude") {
        return "freeclaude".to_string();
    }

    "npx".to_string()
}

fn cli_command() -> (String, Vec<String>) {
    let cli = find_cli();
    if cli == "npx" {
        ("npx".to_string(), vec!["freeclaude".to_string()])
    } else {
        (cli, vec![])
    }
}

async fn run_cli_text(extra_args: &[String]) -> Result<String, String> {
    let (cmd, mut args) = cli_command();
    args.extend_from_slice(extra_args);

    let output = TokioCommand::new(&cmd)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| format!("Failed to start FreeClaude: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if !output.status.success() {
        return Err(if stderr.is_empty() {
            format!(
                "FreeClaude exited with code {}",
                output.status.code().unwrap_or(-1)
            )
        } else {
            stderr
        });
    }

    Ok(stdout)
}

async fn run_cli_json(extra_args: &[String]) -> Result<Value, String> {
    let output = run_cli_text(extra_args).await?;
    serde_json::from_str(&output).map_err(|e| format!("Invalid JSON from CLI: {}", e))
}

fn read_json_file(path: &str) -> Result<Value, String> {
    let content = std::fs::read_to_string(path)
        .map_err(|e| format!("Failed to read {}: {}", path, e))?;
    serde_json::from_str(&content).map_err(|e| format!("Invalid JSON in {}: {}", path, e))
}

fn count_directories(path: &str) -> usize {
    if !Path::new(path).exists() {
        return 0;
    }

    std::fs::read_dir(path)
        .map(|entries| {
            entries
                .filter_map(Result::ok)
                .filter(|entry| entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false))
                .count()
        })
        .unwrap_or(0)
}

fn collect_markdown_files(dir: &Path, notes: &mut Vec<PathBuf>) -> Result<(), String> {
    if !dir.exists() {
        return Ok(());
    }

    for entry in std::fs::read_dir(dir).map_err(|e| format!("Failed to read {}: {}", dir.display(), e))? {
        let entry = entry.map_err(|e| format!("Failed to read {}: {}", dir.display(), e))?;
        let path = entry.path();
        if path.is_dir() {
            collect_markdown_files(&path, notes)?;
        } else if path.extension().and_then(|ext| ext.to_str()) == Some("md") {
            notes.push(path);
        }
    }

    Ok(())
}

#[tauri::command]
async fn chat(message: String) -> Result<String, String> {
    run_cli_text(&["--print".to_string(), message]).await
}

#[tauri::command]
async fn get_providers() -> Result<Value, String> {
    let home = home_dir()?;
    let config_path = format!("{}/.freeclaude.json", home);

    if !Path::new(&config_path).exists() {
        return Ok(json!({
            "configured": false,
            "providers": [],
            "activeProvider": null,
            "activeModel": null,
        }));
    }

    let mut config = read_json_file(&config_path)?;

    if let Some(providers) = config.get_mut("providers").and_then(|value| value.as_array_mut()) {
        for provider in providers.iter_mut() {
            let api_key = provider
                .get("apiKey")
                .and_then(|value| value.as_str())
                .map(str::to_string);

            if let Some(api_key) = api_key {
                if api_key.len() > 8 && !api_key.starts_with("env:") {
                    if let Some(slot) = provider.get_mut("apiKey") {
                        *slot = Value::String(format!(
                            "{}....{}",
                            &api_key[..4],
                            &api_key[api_key.len() - 4..]
                        ));
                    }
                }
            }
        }
    }

    let provider_count = config
        .get("providers")
        .and_then(|value| value.as_array())
        .map(|providers| providers.len())
        .unwrap_or(0);

    if let Some(obj) = config.as_object_mut() {
        obj.insert("configured".to_string(), Value::Bool(provider_count > 0));
    }

    Ok(config)
}

#[tauri::command]
async fn get_costs() -> Result<Value, String> {
    let home = home_dir()?;
    let costs_path = format!("{}/.freeclaude/costs.jsonl", home);

    if !Path::new(&costs_path).exists() {
        return Ok(json!({
            "totalCost": 0.0,
            "totalRequests": 0,
            "byProvider": {},
        }));
    }

    let content = std::fs::read_to_string(&costs_path)
        .map_err(|e| format!("Failed to read costs: {}", e))?;

    let mut total_cost = 0.0_f64;
    let mut total_requests = 0_i64;
    let mut by_provider = serde_json::Map::new();

    for line in content.lines() {
        if let Ok(entry) = serde_json::from_str::<Value>(line) {
            let cost = entry
                .get("estimatedCost")
                .and_then(|value| value.as_f64())
                .unwrap_or(0.0);
            let provider = entry
                .get("provider")
                .and_then(|value| value.as_str())
                .unwrap_or("unknown");

            total_cost += cost;
            total_requests += 1;

            let prev = by_provider
                .get(provider)
                .and_then(|value| value.as_f64())
                .unwrap_or(0.0);
            by_provider.insert(provider.to_string(), json!(prev + cost));
        }
    }

    Ok(json!({
        "totalCost": total_cost,
        "totalRequests": total_requests,
        "byProvider": by_provider,
    }))
}

#[tauri::command]
async fn get_version() -> Result<String, String> {
    run_cli_text(&["--version".to_string()]).await
}

#[tauri::command]
async fn list_task_templates() -> Result<Value, String> {
    run_cli_json(&[
        "task".to_string(),
        "template".to_string(),
        "list".to_string(),
        "--json".to_string(),
    ])
    .await
}

#[tauri::command]
async fn run_task_template(template_id: String) -> Result<Value, String> {
    run_cli_json(&[
        "task".to_string(),
        "template".to_string(),
        "run".to_string(),
        "--json".to_string(),
        template_id,
    ])
    .await
}

#[tauri::command]
async fn list_tasks() -> Result<Value, String> {
    run_cli_json(&[
        "task".to_string(),
        "list".to_string(),
        "--json".to_string(),
    ])
    .await
}

#[tauri::command]
async fn run_task(prompt: String) -> Result<Value, String> {
    run_cli_json(&[
        "task".to_string(),
        "run".to_string(),
        "--json".to_string(),
        prompt,
    ])
    .await
}

#[tauri::command]
async fn resume_task(task_id: String) -> Result<Value, String> {
    run_cli_json(&[
        "task".to_string(),
        "resume".to_string(),
        "--json".to_string(),
        task_id,
    ])
    .await
}

#[tauri::command]
async fn cancel_task(task_id: String) -> Result<Value, String> {
    run_cli_json(&[
        "task".to_string(),
        "cancel".to_string(),
        "--json".to_string(),
        task_id,
    ])
    .await
}

#[tauri::command]
async fn list_schedules() -> Result<Value, String> {
    run_cli_json(&[
        "task".to_string(),
        "schedule".to_string(),
        "list".to_string(),
        "--json".to_string(),
    ])
    .await
}

#[tauri::command]
async fn run_schedule(
    prompt: String,
    every_minutes: f64,
    template_id: Option<String>,
) -> Result<Value, String> {
    let mut args = vec![
        "task".to_string(),
        "schedule".to_string(),
        "run".to_string(),
        "--json".to_string(),
        "--every".to_string(),
        every_minutes.to_string(),
    ];

    if let Some(template_id) = template_id {
        if !template_id.trim().is_empty() {
            args.push("--template".to_string());
            args.push(template_id);
        }
    }

    if !prompt.trim().is_empty() {
        args.push(prompt);
    }

    run_cli_json(&args).await
}

#[tauri::command]
async fn cancel_schedule(schedule_id: String) -> Result<Value, String> {
    run_cli_json(&[
        "task".to_string(),
        "schedule".to_string(),
        "cancel".to_string(),
        "--json".to_string(),
        schedule_id,
    ])
    .await
}

#[tauri::command]
async fn load_task_events(task_id: String) -> Result<Value, String> {
    let home = home_dir()?;
    let events_path = format!("{}/.freeclaude/tasks/{}/events.jsonl", home, task_id);

    if !Path::new(&events_path).exists() {
        return Ok(json!({
            "taskId": task_id,
            "events": [],
        }));
    }

    let content = std::fs::read_to_string(&events_path)
        .map_err(|e| format!("Failed to read events: {}", e))?;

    let events = content
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .collect::<Vec<_>>();

    Ok(json!({
        "taskId": task_id,
        "events": events,
    }))
}

#[tauri::command]
async fn list_vault_notes() -> Result<Value, String> {
    let home = home_dir()?;
    let vault_tasks_path = PathBuf::from(format!("{}/.freeclaude/vault/tasks", home));
    let mut notes = Vec::new();
    collect_markdown_files(&vault_tasks_path, &mut notes)?;
    notes.sort();
    notes.reverse();

    let items = notes
        .into_iter()
        .take(12)
        .filter_map(|path| {
            let content = std::fs::read_to_string(&path).ok()?;
            let title = content
                .lines()
                .find(|line| line.starts_with("# "))
                .map(|line| line.trim_start_matches("# ").to_string())
                .or_else(|| path.file_stem().map(|name| name.to_string_lossy().to_string()))
                .unwrap_or_else(|| "Vault note".to_string());
            let preview = content
                .lines()
                .filter(|line| {
                    let trimmed = line.trim();
                    !trimmed.is_empty()
                        && !trimmed.starts_with("---")
                        && !trimmed.starts_with('#')
                        && !trimmed.starts_with("task_id:")
                        && !trimmed.starts_with("status:")
                        && !trimmed.starts_with("created_at:")
                })
                .take(3)
                .collect::<Vec<_>>()
                .join(" ");
            let updated_at = std::fs::metadata(&path)
                .ok()
                .and_then(|metadata| metadata.modified().ok())
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|duration| duration.as_secs().to_string());

            Some(json!({
                "path": path.display().to_string(),
                "title": title,
                "preview": preview,
                "updatedAt": updated_at,
            }))
        })
        .collect::<Vec<_>>();

    Ok(json!({ "notes": items }))
}

#[tauri::command]
async fn get_runtime_status() -> Result<Value, String> {
    let home = home_dir()?;
    let config_path = format!("{}/.freeclaude.json", home);
    let jobs_path = format!("{}/.freeclaude/jobs", home);
    let tasks_path = format!("{}/.freeclaude/tasks", home);
    let schedules_path = format!("{}/.freeclaude/schedules", home);
    let artifacts_path = format!("{}/.freeclaude/artifacts", home);
    let vault_path = format!("{}/.freeclaude/vault", home);
    let whisper_model_path = format!("{}/.openclaw/models/whisper/ggml-small.bin", home);
    let claude_settings_path = format!("{}/.claude/settings.json", home);

    let config = if Path::new(&config_path).exists() {
        Some(read_json_file(&config_path)?)
    } else {
        None
    };

    let provider_count = config
        .as_ref()
        .and_then(|value| value.get("providers"))
        .and_then(|value| value.as_array())
        .map(|providers| providers.len())
        .unwrap_or(0);

    let active_provider = config
        .as_ref()
        .and_then(|value| value.get("activeProvider"))
        .and_then(|value| value.as_str());

    let active_model = config
        .as_ref()
        .and_then(|value| value.get("activeModel"))
        .and_then(|value| value.as_str());

    let task_count = count_directories(&tasks_path);
    let schedule_count = count_directories(&schedules_path);

    let mut voice_missing = Vec::new();
    if !command_exists("rec") {
        voice_missing.push("SoX rec".to_string());
    }
    if !command_exists("whisper-cli") {
        voice_missing.push("whisper-cli".to_string());
    }
    if !command_exists("ffmpeg") {
        voice_missing.push("ffmpeg".to_string());
    }
    if !Path::new(&whisper_model_path).exists() {
        voice_missing.push("Whisper model".to_string());
    }

    let settings_voice_enabled = if Path::new(&claude_settings_path).exists() {
        read_json_file(&claude_settings_path)
            .ok()
            .and_then(|value| value.get("voiceEnabled").and_then(|flag| flag.as_bool()))
            .unwrap_or(false)
    } else {
        false
    };

    if !settings_voice_enabled {
        voice_missing.push("~/.claude/settings.json voiceEnabled=true".to_string());
    }

    Ok(json!({
        "cliPath": find_cli(),
        "configPath": config_path,
        "configExists": config.is_some(),
        "providerCount": provider_count,
        "activeProvider": active_provider,
        "activeModel": active_model,
        "jobsPath": jobs_path,
        "tasksPath": tasks_path,
        "schedulesPath": schedules_path,
        "artifactsPath": artifacts_path,
        "vaultPath": vault_path,
        "taskCount": task_count,
        "scheduleCount": schedule_count,
        "voiceReady": voice_missing.is_empty(),
        "voiceMissing": voice_missing,
    }))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            chat,
            get_providers,
            get_costs,
            get_version,
            list_task_templates,
            run_task_template,
            list_tasks,
            run_task,
            resume_task,
            cancel_task,
            list_schedules,
            run_schedule,
            cancel_schedule,
            load_task_events,
            list_vault_notes,
            get_runtime_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running FreeClaude Desktop");
}
