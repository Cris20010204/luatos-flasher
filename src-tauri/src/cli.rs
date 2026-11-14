//! 调用随包内置的 luatos-cli（wendal/luatos-cli，MIT）完成刷机、日志、量产与 FOTA。
//!
//! 统一加 `--format jsonl`，每行一个 JSON 事件：
//!   {"type":"progress","stage":"Flashing","region":"ap","percent":42.0,"message":"...","done":false,"error":false}
//!   {"type":"message","level":"info","message":"..."}
//!   {"type":"log_entry","entry":{...}}
//!   {"type":"result","status":"ok","data":{...}} / {"type":"error","message":"..."}

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::async_runtime::Receiver;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tokio::sync::Mutex;

use crate::util::{sub_dir, CmdResult, ErrStr};

#[derive(Default)]
pub struct CliState {
    /// 正在执行的烧录子进程（同一时间只允许一个下载任务）
    flash_child: Mutex<Option<CommandChild>>,
    flash_cancelled: Mutex<bool>,
    flash_running: Mutex<bool>,
    /// 设备日志子进程
    log_child: Mutex<Option<CommandChild>>,
    /// 日志会话代号：每次开/停日志都加一，旧会话的读取任务据此判断自己是否已被替换
    log_gen: AtomicU64,
    /// 重启模块期间持有：日志口也是命令口，这期间打开日志会让重启指令报 “Device or resource busy”
    port_busy: Mutex<()>,
    /// 参数支持情况缓存："flash run --luac-debug" -> true/false
    caps: Mutex<HashMap<String, bool>>,
}

pub type SharedCli = Arc<CliState>;

fn command(app: &AppHandle) -> CmdResult<tauri_plugin_shell::process::Command> {
    // 开发时可用环境变量指定 luatos-cli 路径
    if let Ok(path) = std::env::var("LUATOS_CLI") {
        if !path.is_empty() {
            return Ok(app.shell().command(path));
        }
    }
    app.shell()
        .sidecar("luatos-cli")
        .err_ctx("找不到内置的 luatos-cli，请先运行 pnpm fetch:cli")
}

fn spawn(app: &AppHandle, args: &[String]) -> CmdResult<(Receiver<CommandEvent>, CommandChild)> {
    log::info!("luatos-cli {}", args.join(" "));
    spawn_unlogged(app, args)
}

fn spawn_unlogged(app: &AppHandle, args: &[String]) -> CmdResult<(Receiver<CommandEvent>, CommandChild)> {
    command(app)?.args(args).spawn().err_ctx("启动 luatos-cli 失败")
}

/// CommandChild::kill 发完信号还会阻塞等进程退出，放到阻塞线程里，别卡住异步任务
async fn kill_child(child: CommandChild) {
    let _ = tauri::async_runtime::spawn_blocking(move || child.kill()).await;
}

fn line_of(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).trim_end_matches(['\r', '\n']).to_string()
}

/// 一次性执行，收集所有输出；返回 (退出码是否为 0, JSON 事件, 非 JSON 文本)。
pub async fn run_once(app: &AppHandle, args: Vec<String>) -> CmdResult<(bool, Vec<Value>, Vec<String>)> {
    let (mut rx, _child) = spawn(app, &args)?;
    let mut events = Vec::new();
    let mut text = Vec::new();
    let mut ok = false;
    while let Some(ev) = rx.recv().await {
        match ev {
            CommandEvent::Stdout(b) | CommandEvent::Stderr(b) => {
                let line = line_of(&b);
                if line.is_empty() {
                    continue;
                }
                log::info!("[cli] {line}");
                match serde_json::from_str::<Value>(&line) {
                    Ok(v) if v.is_object() => events.push(v),
                    _ => text.push(line),
                }
            }
            CommandEvent::Terminated(t) => {
                log::info!("[cli] 退出码 {:?}", t.code);
                ok = t.code == Some(0)
            }
            CommandEvent::Error(e) => text.push(e),
            _ => {}
        }
    }
    Ok((ok, events, text))
}

fn error_of(events: &[Value], text: &[String]) -> String {
    events
        .iter()
        .rev()
        .find_map(|e| match e.get("type").and_then(Value::as_str) {
            Some("error") => e.get("message").and_then(Value::as_str).map(str::to_string),
            Some("progress") if e.get("error").and_then(Value::as_bool) == Some(true) => {
                e.get("message").and_then(Value::as_str).map(str::to_string)
            }
            _ => None,
        })
        .or_else(|| text.iter().rev().find(|l| !l.trim().is_empty()).cloned())
        .unwrap_or_else(|| "luatos-cli 执行失败".into())
}

/// 不同版本的 luatos-cli 参数不完全一样（例如 v1.11.0 的 flash run/script 还没有 --luac-debug），
/// 先看子命令的 --help 里有没有这个参数，结果缓存起来。
async fn supports(app: &AppHandle, cli: &SharedCli, sub: &[&str], flag: &str) -> bool {
    let key = format!("{} {flag}", sub.join(" "));
    if let Some(v) = cli.caps.lock().await.get(&key) {
        return *v;
    }
    let mut args: Vec<String> = sub.iter().map(|s| s.to_string()).collect();
    args.push("--help".into());
    let ok = match run_once(app, args).await {
        Ok((_, _, text)) => text.iter().any(|l| l.contains(flag)),
        Err(_) => false,
    };
    log::info!("[cli] {key} 支持：{ok}");
    cli.caps.lock().await.insert(key, ok);
    ok
}

#[tauri::command]
pub async fn cli_version(app: AppHandle) -> CmdResult<String> {
    let (_, events, text) = run_once(&app, vec!["version".into()]).await?;
    let line = text
        .iter()
        .find(|l| l.to_lowercase().contains("luatos-cli") || l.contains('.'))
        .cloned()
        .or_else(|| events.first().map(|e| e.to_string()))
        .unwrap_or_default();
    Ok(line.trim().to_string())
}

/* ------------------------------------------------------------------ 脚本暂存 */

/// LuaDB 脚本区是扁平的（不能带子目录），把项目里登记的文件拷到一个临时目录交给 luatos-cli。
pub fn stage_files(app: &AppHandle, tag: &str, files: &[String]) -> CmdResult<PathBuf> {
    let dir = sub_dir(app, "staging")?.join(tag);
    if dir.exists() {
        fs::remove_dir_all(&dir).err_ctx("清理暂存目录失败")?;
    }
    fs::create_dir_all(&dir).err_ctx("创建暂存目录失败")?;
    let mut seen = HashSet::new();
    for f in files {
        let src = Path::new(f);
        let name = src
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or_else(|| format!("无效的文件路径：{f}"))?;
        if !seen.insert(name.to_string()) {
            return Err(format!("脚本区不能有同名文件：{name}（脚本区不区分目录）"));
        }
        if name.len() > 31 {
            return Err(format!("文件名过长（脚本区最多 31 个字符）：{name}"));
        }
        fs::copy(src, dir.join(name)).err_ctx(&format!("复制 {f} 失败"))?;
    }
    Ok(dir)
}

/* ------------------------------------------------------------------ 烧录任务 */

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlashRequest {
    pub task_id: String,
    /// full = 底层+脚本，script = 仅脚本，core = 仅底层，erase = 只清除 fs/kv
    pub kind: String,
    pub soc: String,
    /// 指定端口；为空时用 auto（luatos-cli 会自动让运行中的模组重启进下载模式）
    pub port: Option<String>,
    pub script_files: Vec<String>,
    pub luac_debug: u8,
    pub clear_fs: bool,
    pub clear_kv: bool,
    pub fs_dir: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct FlashEvent {
    task_id: String,
    /// progress / message / log / phase / finished
    kind: String,
    data: Value,
}

fn emit_flash(app: &AppHandle, task_id: &str, kind: &str, data: Value) {
    let _ = app.emit(
        "flash-event",
        FlashEvent { task_id: task_id.into(), kind: kind.into(), data },
    );
}

/// 跑一个 luatos-cli 子命令，把事件实时转发给前端；返回成功与否和错误信息。
async fn run_streaming(app: &AppHandle, cli: &SharedCli, task_id: &str, args: Vec<String>) -> Result<(), String> {
    emit_flash(app, task_id, "log", json!({ "level": "dim", "text": format!("$ luatos-cli {}", args.join(" ")) }));
    let (mut rx, child) = spawn(app, &args)?;
    *cli.flash_child.lock().await = Some(child);
    let mut events: Vec<Value> = Vec::new();
    let mut text: Vec<String> = Vec::new();
    let mut code = None;
    while let Some(ev) = rx.recv().await {
        match ev {
            CommandEvent::Stdout(b) | CommandEvent::Stderr(b) => {
                let line = line_of(&b);
                if line.trim().is_empty() {
                    continue;
                }
                log::info!("[flash] {line}");
                match serde_json::from_str::<Value>(&line) {
                    Ok(v) if v.is_object() => {
                        let t = v.get("type").and_then(Value::as_str).unwrap_or("");
                        match t {
                            "progress" => emit_flash(app, task_id, "progress", v.clone()),
                            "message" | "error" | "result" => emit_flash(app, task_id, "message", v.clone()),
                            _ => emit_flash(app, task_id, "log", json!({ "level": "dim", "text": line })),
                        }
                        events.push(v);
                    }
                    _ => {
                        emit_flash(app, task_id, "log", json!({ "level": "dim", "text": line }));
                        text.push(line);
                    }
                }
            }
            CommandEvent::Terminated(t) => {
                log::info!("[flash] 退出码 {:?}", t.code);
                code = t.code
            }
            CommandEvent::Error(e) => {
                log::warn!("[flash] {e}");
                text.push(e)
            }
            _ => {}
        }
    }
    *cli.flash_child.lock().await = None;
    if *cli.flash_cancelled.lock().await {
        return Err("下载已被用户取消".into());
    }
    if code == Some(0) {
        Ok(())
    } else {
        Err(error_of(&events, &text))
    }
}

#[tauri::command]
pub async fn flash_start(app: AppHandle, cli: State<'_, SharedCli>, req: FlashRequest) -> CmdResult<()> {
    {
        let mut running = cli.flash_running.lock().await;
        if *running {
            return Err("已有下载任务正在进行".into());
        }
        *running = true;
    }
    *cli.flash_cancelled.lock().await = false;
    let cli = cli.inner().clone();

    // 下载要用到日志口（重启进下载模式），先停掉设备日志
    if let Some(child) = take_log(&cli).await {
        kill_child(child).await;
        let _ = app.emit("devlog-state", json!({ "running": false, "reason": "flash" }));
    }

    tauri::async_runtime::spawn(async move {
        let result = flash_sequence(&app, &cli, &req).await;
        *cli.flash_running.lock().await = false;
        match result {
            Ok(()) => emit_flash(&app, &req.task_id, "finished", json!({ "ok": true })),
            Err(e) => emit_flash(&app, &req.task_id, "finished", json!({ "ok": false, "error": e })),
        }
    });
    Ok(())
}

async fn flash_sequence(app: &AppHandle, cli: &SharedCli, req: &FlashRequest) -> Result<(), String> {
    if !Path::new(&req.soc).exists() {
        return Err(format!("找不到底层固件：{}", req.soc));
    }
    let port = req.port.clone().filter(|p| !p.is_empty()).unwrap_or_else(|| "auto".into());
    let base = |sub: &str| -> Vec<String> {
        vec!["flash".into(), sub.into(), "--soc".into(), req.soc.clone(), "--port".into(), port.clone()]
    };
    let with_fmt = |mut v: Vec<String>| {
        v.push("--format".into());
        v.push("jsonl".into());
        v
    };

    if req.clear_fs {
        emit_flash(app, &req.task_id, "phase", json!({ "name": "clear-fs" }));
        run_streaming(app, cli, &req.task_id, with_fmt(base("clear-fs"))).await?;
    }
    if req.clear_kv {
        emit_flash(app, &req.task_id, "phase", json!({ "name": "clear-kv" }));
        run_streaming(app, cli, &req.task_id, with_fmt(base("clear-kv"))).await?;
    }

    // 只清除数据（设备日志页的“清除 fs / 清除 kv”）
    if req.kind == "erase" {
        return Ok(());
    }

    let script_dir = if req.kind != "core" && !req.script_files.is_empty() {
        let dir = stage_files(app, &req.task_id, &req.script_files)?;
        emit_flash(
            app,
            &req.task_id,
            "log",
            json!({ "level": "info", "text": format!("已暂存 {} 个脚本/资源文件到 {}", req.script_files.len(), dir.display()) }),
        );
        Some(dir)
    } else {
        None
    };

    emit_flash(app, &req.task_id, "phase", json!({ "name": req.kind }));
    let mut args = match req.kind.as_str() {
        "script" => base("script"),
        _ => base("run"),
    };
    if let Some(dir) = &script_dir {
        args.push("--script".into());
        args.push(dir.to_string_lossy().into_owned());
    } else if req.kind == "script" {
        return Err("项目里没有可下载的脚本".into());
    }
    if script_dir.is_some() {
        let sub = if req.kind == "script" { "script" } else { "run" };
        if supports(app, cli, &["flash", sub], "--luac-debug").await {
            args.push("--luac-debug".into());
            args.push(req.luac_debug.to_string());
        } else if req.luac_debug != 99 {
            emit_flash(
                app,
                &req.task_id,
                "log",
                json!({ "level": "warn", "text": "当前内置的 luatos-cli 不支持调整 Lua 调试信息级别，按“全部保留”下载" }),
            );
        }
    }
    run_streaming(app, cli, &req.task_id, with_fmt(args)).await?;

    if let Some(fs_dir) = req.fs_dir.as_ref().filter(|d| !d.is_empty()) {
        emit_flash(app, &req.task_id, "phase", json!({ "name": "flash-fs" }));
        let mut a = base("flash-fs");
        a.push("--script".into());
        a.push(fs_dir.clone());
        run_streaming(app, cli, &req.task_id, with_fmt(a)).await?;
    }

    // 暂存目录用完即删
    let _ = fs::remove_dir_all(sub_dir(app, "staging").map_err(|e| e)?.join(&req.task_id));
    Ok(())
}

#[tauri::command]
pub async fn flash_cancel(cli: State<'_, SharedCli>) -> CmdResult<()> {
    *cli.flash_cancelled.lock().await = true;
    if let Some(child) = cli.flash_child.lock().await.take() {
        child.kill().err_ctx("停止 luatos-cli 失败")?;
    }
    Ok(())
}

/* ------------------------------------------------------------------ 设备日志 */

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DevlogRequest {
    /// usb = 4G 模组 USB 打印（二进制日志解码），uart = 通用串口打印（文本）
    pub mode: String,
    pub port: Option<String>,
    pub baud: u32,
}

/// EC718 的 USB 日志口有时会把日志攒在模组里不发，直到主机往这个口写点东西（探测帧、甚至一个 AT）才吐出来。
/// 实测（2026-11-13，Air780EHM + LuatOS V2056 112，macOS）：这种状态下读取字节数几分钟不变、下行消息的 recv
/// 日志也不出来，写一次探测帧后攒着的几条立刻输出；状态正常时只发一次探测帧就能连续输出几分钟。
/// 什么时候会进入这种状态没查清（重启后、用文本模式打开过日志口后都出现过，但都没能稳定复现）。
/// luatos-cli 只在打开时发一次探测帧，所以 USB 日志静默超过 SILENCE_REOPEN 就悄悄重开一次（重开会再发探测帧），
/// 攒着的日志最多晚这么久出来。模组本来就没日志可打时，代价是每隔这么久重开一次 luatos-cli。
const SILENCE_REOPEN: Duration = Duration::from_secs(10);

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// 取走当前日志进程，同时让它的读取任务失效（不再发 devlog-state，也不会误取新会话的子进程）
async fn take_log(cli: &CliState) -> Option<CommandChild> {
    cli.log_gen.fetch_add(1, Ordering::SeqCst);
    cli.log_child.lock().await.take()
}

#[tauri::command]
pub async fn devlog_start(app: AppHandle, cli: State<'_, SharedCli>, req: DevlogRequest) -> CmdResult<()> {
    start_devlog(app, cli.inner().clone(), req, false).await
}

/// `quiet` = 静默重开：不再发 running 状态，不把 luatos-cli 的提示行（Sending probe…）塞进日志界面。
/// 返回装箱的 Future：静默重开是在本函数派生的任务里再调用自己。
fn start_devlog(
    app: AppHandle,
    cli: SharedCli,
    req: DevlogRequest,
    quiet: bool,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = CmdResult<()>> + Send>> {
    Box::pin(async move {
        if *cli.flash_running.lock().await {
            return Err("正在下载，下载完成后再打开日志".into());
        }
        if let Some(child) = take_log(&cli).await {
            kill_child(child).await;
        }
        // 正在重启模块就等它发完指令
        drop(cli.port_busy.lock().await);
        let usb = req.mode != "uart";
        let port = req.port.clone().filter(|p| !p.is_empty()).unwrap_or_else(|| "auto".into());
        let mut args: Vec<String> = if !usb {
            vec!["log".into(), "view".into(), "--port".into(), port, "--baud".into(), req.baud.to_string()]
        } else {
            vec![
                "log".into(),
                "view-binary".into(),
                "--port".into(),
                port,
                "--baud".into(),
                req.baud.to_string(),
                "--probe".into(),
            ]
        };
        args.push("--format".into());
        args.push("jsonl".into());

        let (mut rx, child) = if quiet { spawn_unlogged(&app, &args)? } else { spawn(&app, &args)? };
        let gen = cli.log_gen.fetch_add(1, Ordering::SeqCst) + 1;
        *cli.log_child.lock().await = Some(child);
        if !quiet {
            let _ = app.emit("devlog-state", json!({ "running": true }));
        }
        let last_rx = Arc::new(AtomicU64::new(now_ms()));
        if usb {
            spawn_silence_watch(app.clone(), cli.clone(), req.clone(), gen, last_rx.clone());
        }
        tauri::async_runtime::spawn(async move {
            let mut last_err = String::new();
            let mut first_entry_logged = quiet;
            while let Some(ev) = rx.recv().await {
                match ev {
                    CommandEvent::Stdout(b) | CommandEvent::Stderr(b) => {
                        let line = line_of(&b);
                        if line.trim().is_empty() {
                            continue;
                        }
                        match serde_json::from_str::<Value>(&line) {
                            Ok(v) if v.get("type").and_then(Value::as_str) == Some("log_entry") => {
                                last_rx.store(now_ms(), Ordering::SeqCst);
                                if !first_entry_logged {
                                    first_entry_logged = true;
                                    log::info!("[devlog] 第一条日志：{line}");
                                }
                                let _ = app.emit("devlog", v.get("entry").cloned().unwrap_or(Value::Null));
                            }
                            Ok(v) if v.get("type").and_then(Value::as_str) == Some("error") => {
                                last_err = v.get("message").and_then(Value::as_str).unwrap_or("").to_string();
                                log::warn!("[devlog] {line}");
                            }
                            Ok(v) if v.get("type").and_then(Value::as_str) == Some("message") => {
                                if !quiet {
                                    let msg = v.get("message").and_then(Value::as_str).unwrap_or("").to_string();
                                    let _ = app.emit("devlog", json!({ "level": "I", "module": "luatos-cli", "message": msg, "raw": msg }));
                                }
                            }
                            _ => {
                                if !quiet {
                                    log::info!("[devlog] {line}");
                                    let _ = app.emit("devlog", json!({ "level": "raw", "message": line, "raw": line }));
                                }
                            }
                        }
                    }
                    CommandEvent::Error(e) => last_err = e,
                    _ => {}
                }
            }
            // 已被新会话替换或被主动停止：不发状态，也不碰新会话的子进程
            if cli.log_gen.load(Ordering::SeqCst) != gen {
                return;
            }
            // 自己结束的（模组断开等）：让静默检测也停下，交给前端按设备状态重开
            take_log(&cli).await;
            log::info!("[devlog] 日志进程结束 {last_err}");
            let _ = app.emit("devlog-state", json!({ "running": false, "error": last_err }));
        });
        Ok(())
    })
}

/// USB 日志静默超过 SILENCE_REOPEN 就静默重开；会话被停止、替换或开始下载（会话代号变了）就退出
fn spawn_silence_watch(app: AppHandle, cli: SharedCli, req: DevlogRequest, gen: u64, last_rx: Arc<AtomicU64>) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(1)).await;
            if cli.log_gen.load(Ordering::SeqCst) != gen {
                return;
            }
            if now_ms().saturating_sub(last_rx.load(Ordering::SeqCst)) < SILENCE_REOPEN.as_millis() as u64 {
                continue;
            }
            log::debug!("[devlog] 日志静默 {} 秒，重开日志口", SILENCE_REOPEN.as_secs());
            if let Err(e) = start_devlog(app.clone(), cli.clone(), req, true).await {
                log::warn!("[devlog] 重开日志口失败：{e}");
                let _ = app.emit("devlog-state", json!({ "running": false, "error": e }));
            }
            return;
        }
    });
}

/// 应用退出时结束日志进程。sidecar 不会随应用退出，留下的 luatos-cli 会一直占着日志口，
/// 下次启动打开日志口会报 “Device or resource busy”。下载进程不杀，让它自己跑完，免得模组停在下载模式。
pub fn kill_log_on_exit(cli: &CliState) {
    if let Ok(mut guard) = cli.log_child.try_lock() {
        if let Some(child) = guard.take() {
            let _ = child.kill();
        }
    }
}

#[tauri::command]
pub async fn devlog_stop(app: AppHandle, cli: State<'_, SharedCli>) -> CmdResult<()> {
    if let Some(child) = take_log(&cli).await {
        kill_child(child).await;
    }
    let _ = app.emit("devlog-state", json!({ "running": false, "reason": "user" }));
    Ok(())
}

/* ------------------------------------------------------------------ 设备控制 */

#[tauri::command]
pub async fn device_reboot(app: AppHandle, cli: State<'_, SharedCli>, port: Option<String>, boot: bool) -> CmdResult<String> {
    if *cli.flash_running.lock().await {
        return Err("正在下载，不能重启模块".into());
    }
    // 日志口和命令口是同一个口，先释放；指令发完之前不让日志重新占用
    let _busy = cli.port_busy.lock().await;
    let had_log = take_log(&cli).await;
    if let Some(child) = had_log {
        kill_child(child).await;
        let _ = app.emit("devlog-state", json!({ "running": false, "reason": "reboot" }));
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    }
    let mut args: Vec<String> = vec!["device".into(), if boot { "boot".into() } else { "reboot".into() }];
    args.push("--chip".into());
    args.push("ec7xx".into());
    if let Some(p) = port.filter(|p| !p.is_empty()) {
        args.push("--port".into());
        args.push(p);
    }
    args.push("--format".into());
    args.push("jsonl".into());
    let (ok, events, text) = run_once(&app, args).await?;
    if ok {
        Ok(text.join("\n"))
    } else {
        Err(error_of(&events, &text))
    }
}

/* ------------------------------------------------------------------ 量产 / FOTA */

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackRequest {
    pub soc: String,
    pub script_files: Vec<String>,
    pub luac_debug: u8,
    /// 输出文件的完整路径
    pub output: String,
    /// 仅 FOTA 用
    pub include_core: bool,
    pub include_script: bool,
}

/// 编译脚本并打成 LuaDB 镜像，再合进底层 soc，得到可直接量产烧录的 soc。
async fn build_combined_soc(app: &AppHandle, req: &PackRequest, out: &Path, tag: &str) -> CmdResult<()> {
    let info = crate::firmware::read_soc_info(Path::new(&req.soc))?;
    let stage = stage_files(app, tag, &req.script_files)?;
    let work = sub_dir(app, "staging")?.join(format!("{tag}-out"));
    fs::create_dir_all(&work).err_str()?;
    let script_bin = work.join("script.bin");
    let mut args: Vec<String> = vec![
        "build".into(),
        "filesystem".into(),
        "--src".into(),
        stage.to_string_lossy().into_owned(),
        "--output".into(),
        script_bin.to_string_lossy().into_owned(),
        "--bitw".into(),
        info.bits.to_string(),
        "--luac-debug".into(),
        req.luac_debug.to_string(),
        "--max-size-kb".into(),
        info.script_kb.to_string(),
        "--format".into(),
        "jsonl".into(),
    ];
    if info.use_luac {
        args.insert(6, "--luac".into());
    }
    let (ok, events, text) = run_once(app, args).await?;
    if !ok {
        return Err(format!("编译脚本失败：{}", error_of(&events, &text)));
    }
    let args = vec![
        "soc".into(),
        "combine".into(),
        "--soc".into(),
        req.soc.clone(),
        "--bin".into(),
        script_bin.to_string_lossy().into_owned(),
        "--addr".into(),
        format!("0x{}", info.script_addr.trim_start_matches("0x")),
        "--output".into(),
        out.to_string_lossy().into_owned(),
        "--format".into(),
        "jsonl".into(),
    ];
    let (ok, events, text) = run_once(app, args).await?;
    let _ = fs::remove_dir_all(&stage);
    let _ = fs::remove_dir_all(&work);
    if !ok {
        return Err(format!("合成固件失败：{}", error_of(&events, &text)));
    }
    Ok(())
}

#[tauri::command]
pub async fn make_production(app: AppHandle, req: PackRequest) -> CmdResult<String> {
    let out = PathBuf::from(crate::util::expand_tilde(&req.output));
    if let Some(dir) = out.parent() {
        fs::create_dir_all(dir).err_ctx("创建输出目录失败")?;
    }
    build_combined_soc(&app, &req, &out, &format!("mp-{}", crate::util::now_ms())).await?;
    Ok(out.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn make_fota(app: AppHandle, req: PackRequest) -> CmdResult<String> {
    if !req.include_core && !req.include_script {
        return Err("升级文件至少要包含底层或脚本".into());
    }
    let out = PathBuf::from(crate::util::expand_tilde(&req.output));
    if let Some(dir) = out.parent() {
        fs::create_dir_all(dir).err_ctx("创建输出目录失败")?;
    }
    let tag = format!("fota-{}", crate::util::now_ms());
    let new_soc = if req.include_script {
        let combined = sub_dir(&app, "staging")?.join(format!("{tag}.soc"));
        build_combined_soc(&app, &req, &combined, &tag).await?;
        combined
    } else {
        PathBuf::from(&req.soc)
    };
    let mut args: Vec<String> = vec![
        "fota".into(),
        "build".into(),
        "--new".into(),
        new_soc.to_string_lossy().into_owned(),
        "--output".into(),
        out.to_string_lossy().into_owned(),
    ];
    if !req.include_core {
        args.push("--script-only".into());
    }
    args.push("--format".into());
    args.push("jsonl".into());
    let (ok, events, text) = run_once(&app, args).await?;
    if req.include_script {
        let _ = fs::remove_file(&new_soc);
    }
    if !ok {
        return Err(format!("生成升级文件失败：{}", error_of(&events, &text)));
    }
    Ok(out.to_string_lossy().into_owned())
}
