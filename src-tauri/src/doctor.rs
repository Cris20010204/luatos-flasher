//! 环境诊断：luatos-cli、串口、模组、USB 是否被虚拟机占用、固件服务器连通性。

use serde::Serialize;
use tauri::AppHandle;

use crate::devices::{scan, BOOT_VID, RUN_VID};
use crate::util::CmdResult;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Check {
    pub id: String,
    /// ok / warn / err
    pub status: String,
    pub title: String,
    pub detail: String,
}

fn check(id: &str, status: &str, title: &str, detail: impl Into<String>) -> Check {
    Check { id: id.into(), status: status.into(), title: title.into(), detail: detail.into() }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
    pub os: String,
    pub arch: String,
    pub data_dir: String,
    pub projects_root: String,
}

#[tauri::command]
pub fn app_info(app: AppHandle) -> CmdResult<AppInfo> {
    Ok(AppInfo {
        version: app.package_info().version.to_string(),
        os: std::env::consts::OS.into(),
        arch: std::env::consts::ARCH.into(),
        data_dir: crate::util::app_dir(&app)?.to_string_lossy().into_owned(),
        projects_root: crate::util::default_projects_root().to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub fn log_dir(app: AppHandle) -> CmdResult<String> {
    use tauri::Manager;
    let dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().into_owned())
}

/// macOS：用 ioreg 看合宙模组是否被其它进程（比如 VMware）独占
#[cfg(target_os = "macos")]
fn usb_exclusive_owner() -> Option<String> {
    let out = std::process::Command::new("ioreg").args(["-p", "IOUSB", "-l", "-w0"]).output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let mut owner: Option<String> = None;
    let mut vendor_hit = false;
    for line in text.lines() {
        let l = line.trim();
        if l.starts_with("+-o ") {
            if vendor_hit {
                if let Some(o) = owner.take() {
                    return Some(o);
                }
            }
            vendor_hit = false;
            owner = None;
        }
        if l.contains("\"idVendor\" = ") {
            let v: u32 = l.rsplit('=').next().and_then(|s| s.trim().parse().ok()).unwrap_or(0);
            vendor_hit = v == RUN_VID as u32 || v == BOOT_VID as u32;
        }
        if l.contains("\"UsbExclusiveOwner\"") {
            owner = l.split('=').nth(1).map(|s| s.trim().trim_matches('"').to_string());
        }
    }
    if vendor_hit {
        owner
    } else {
        None
    }
}

#[cfg(not(target_os = "macos"))]
fn usb_exclusive_owner() -> Option<String> {
    None
}

#[tauri::command]
pub async fn run_doctor(app: AppHandle) -> CmdResult<Vec<Check>> {
    let mut out = Vec::new();

    match crate::cli::cli_version(app.clone()).await {
        Ok(v) if !v.is_empty() => out.push(check("cli", "ok", "luatos-cli 可用", v)),
        Ok(_) => out.push(check("cli", "warn", "luatos-cli 没有输出版本号", "")),
        Err(e) => out.push(check("cli", "err", "luatos-cli 不可用", e)),
    }

    let (devices, ports) = scan();
    out.push(check(
        "ports",
        if ports.is_empty() { "warn" } else { "ok" },
        "串口",
        if ports.is_empty() {
            "没有发现任何串口".to_string()
        } else {
            format!("发现 {} 个串口", ports.len())
        },
    ));

    let owner = usb_exclusive_owner();
    if let Some(o) = &owner {
        let vm = o.to_lowercase().contains("vmware") || o.to_lowercase().contains("parallels") || o.to_lowercase().contains("virtualbox");
        out.push(check(
            "vm",
            "err",
            if vm { "模组被虚拟机占用" } else { "模组被其他程序独占" },
            format!("占用者：{o}。请在虚拟机菜单里把 USB 设备断开，或关闭虚拟机后重新插拔模组"),
        ));
    }

    if devices.is_empty() {
        let hint = if cfg!(target_os = "windows") {
            "没有发现合宙模组。若设备管理器里有带黄色感叹号的设备，请安装合宙 USB 驱动；也可能是数据线只能充电"
        } else if owner.is_some() {
            "模组被占用，见上一条"
        } else {
            "没有发现合宙模组（VID 0x19D1 / 0x17D1）。请检查数据线和模组供电"
        };
        out.push(check("module", "warn", "合宙模组", hint));
    } else {
        for d in &devices {
            out.push(check(
                "module",
                "ok",
                if d.status == "boot" { "合宙模组（下载模式）" } else { "合宙模组（运行中）" },
                format!("端口：{}", d.ports.join("、")),
            ));
        }
    }

    let reach = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(8))
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .ok();
    let net_ok = match reach {
        Some(c) => c.head("https://cdn18.luatos.com/files/").send().await.map(|r| r.status().is_success() || r.status().is_redirection()).unwrap_or(false),
        None => false,
    };
    out.push(check(
        "cdn",
        if net_ok { "ok" } else { "warn" },
        "合宙固件服务器",
        if net_ok { "cdn18.luatos.com 可访问" } else { "无法访问 cdn18.luatos.com，在线固件资源不可用，可导入本地 .soc" },
    ));

    Ok(out)
}
