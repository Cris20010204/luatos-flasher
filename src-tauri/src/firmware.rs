//! 固件资源：从合宙 CDN 列出/下载 LuatOS 固件（.soc），本地缓存，解析 soc 信息。
//!
//! CDN 上 `/files/<型号>/LuatOS_<型号>/` 下的固件有三种存放方式（2026-11 逐个型号实测）：
//!   1. 每个版本一个目录：`LuatOS-SoC_V2056_Air780EHM/LuatOS-SoC_V2056_Air780EHM_112.soc`（EC718 系列、Air8000、Air1602……）
//!   2. 直接放 .soc：`LuatOS-SoC_V1002_AIR6208.soc`、`LuatOS-SoC_V2026_Air780EP_1.soc`
//!   3. 每个版本一个 .zip：`core_V1124.zip`（Air780E/EG，内含 标准/FULL/TTS 三个 .soc）、`LuatOS-SoC_V2010_Air780EPM.zip`
//! 同一个型号可能混用（Air780EPM 新版本是目录、老版本是 zip）。zip 不用下载就能列出里面的文件：
//! 用 HTTP Range 只读末尾的中央目录（CDN 支持 Range）。
//! 目录页每行形如：
//!   <tr class="entry-row entry-file" data-name=".." data-is-dir="0" data-size="12093329" data-mtime="2026-11-05 13:37"> .. href=".."
//! 这不是合宙公开承诺的接口，所以同时支持“导入本地 .soc”作为后备。
//! 本地缓存：<应用数据>/firmware/<型号>/<版本>/<.soc 文件名>

use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use futures_util::StreamExt;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};

use crate::util::{sub_dir, CmdResult, ErrStr};

const CDN: &str = "https://cdn18.luatos.com";

#[derive(Default)]
pub struct FirmwareState {
    soc_cache: Mutex<HashMap<String, SocInfo>>,
}
pub type SharedFirmware = Arc<FirmwareState>;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FwVersion {
    pub version: String,
    pub date: String,
}

/// 某个版本下的一个固件文件（.soc）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FwBuild {
    /// 文件名末尾的编号：EC718 的 101~124 号、Air780EP 的 `_1`；没有编号是 None（如 EC618 的标准/FULL/TTS）
    pub build: Option<u32>,
    /// .soc 文件名，同一型号同一版本里唯一，是选择固件的依据
    pub file: String,
    pub size: u64,
    pub date: String,
    /// .soc 的下载地址；固件在 zip 里时是 zip 的地址
    pub url: String,
    /// 固件在哪个 zip 里（下载时要整包下载再解压）
    pub zip: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SocInfo {
    /// 芯片（来自 binpkg 产品名，如 EC718HM）
    pub chip: String,
    /// info.json 里的 chip.type，如 ec7xx
    pub chip_type: String,
    pub bits: u32,
    pub script_addr: String,
    pub script_kb: u32,
    pub fs_kb: u32,
    pub fw_num: Option<u32>,
    pub use_luac: bool,
    pub size: u64,
    pub file: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedFw {
    /// `<型号>/<版本>/<文件名>`
    pub key: String,
    pub model: String,
    pub version: String,
    pub file: String,
    pub build: Option<u32>,
    pub path: String,
    pub size: u64,
}

fn client() -> CmdResult<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent("luatos-flasher")
        .connect_timeout(std::time::Duration::from_secs(15))
        .build()
        .err_str()
}

struct Row {
    name: String,
    is_dir: bool,
    size: u64,
    mtime: String,
    href: String,
}

impl Row {
    /// href 的最后一段（大小写和服务器上一致；data-name 是转成小写的）
    fn base(&self) -> &str {
        self.href.trim_end_matches('/').rsplit('/').next().unwrap_or(&self.name)
    }
}

fn parse_listing(html: &str) -> Vec<Row> {
    let re = Regex::new(
        r#"(?s)<tr class="entry-row[^"]*"\s+data-name="([^"]*)"\s+data-is-dir="(\d)"\s+data-size="(-?\d*)"\s+data-mtime="([^"]*)">.*?href="([^"]+)""#,
    )
    .expect("listing regex");
    re.captures_iter(html)
        .map(|c| Row {
            name: c[1].to_string(),
            is_dir: &c[2] == "1",
            // 目录行的 data-size 是 -1
            size: c[3].parse::<i64>().map(|n| n.max(0) as u64).unwrap_or(0),
            mtime: c[4].to_string(),
            href: c[5].to_string(),
        })
        .collect()
}

async fn fetch_listing(path: &str) -> CmdResult<Vec<Row>> {
    let url = format!("{CDN}{path}");
    let resp = client()?.get(&url).send().await.err_ctx("无法连接合宙固件服务器")?;
    if !resp.status().is_success() {
        return Err(format!("固件服务器返回 {}：{url}", resp.status()));
    }
    let html = resp.text().await.err_str()?;
    Ok(parse_listing(&html))
}

fn model_dir(model: &str) -> String {
    format!("/files/{model}/LuatOS_{model}/")
}

/// `LuatOS-SoC_V2056_xxx`、`core_V1124.zip` → `V2056`、`V1124`
fn version_of(name: &str) -> Option<String> {
    let re = Regex::new(r"(?i)^(?:LuatOS-SoC_|core_)V(\d+)").unwrap();
    re.captures(name).map(|c| format!("V{}", &c[1]))
}

/// 文件名末尾的编号：`..._112.soc` → 112，`..._1.soc` → 1
fn trailing_num(file: &str) -> Option<u32> {
    let re = Regex::new(r"(?i)_(\d+)\.soc$").unwrap();
    re.captures(file).and_then(|c| c[1].parse().ok())
}

fn version_num(v: &str) -> u32 {
    v.trim_start_matches(['V', 'v']).parse().unwrap_or(0)
}

enum Kind {
    Dir,
    Soc,
    Zip,
}

/// 型号目录下所有和固件版本有关的条目：(版本, 条目, 种类)
async fn sources(model: &str) -> CmdResult<Vec<(String, Row, Kind)>> {
    let mut out = Vec::new();
    for r in fetch_listing(&model_dir(model)).await? {
        let base = r.base().to_string();
        let Some(ver) = version_of(&base) else { continue };
        let lower = base.to_ascii_lowercase();
        let kind = if r.is_dir {
            if !lower.starts_with("luatos-soc_") {
                continue;
            }
            Kind::Dir
        } else if lower.ends_with(".soc") {
            Kind::Soc
        } else if lower.ends_with(".zip") {
            Kind::Zip
        } else {
            continue;
        };
        out.push((ver, r, kind));
    }
    Ok(out)
}

#[tauri::command]
pub async fn fw_versions(model: String) -> CmdResult<Vec<FwVersion>> {
    let mut out: Vec<FwVersion> = sources(&model)
        .await?
        .into_iter()
        .map(|(version, r, _)| FwVersion { version, date: r.mtime.split(' ').next().unwrap_or("").replace('-', ".") })
        .collect();
    out.sort_by(|a, b| version_num(&b.version).cmp(&version_num(&a.version)).then(b.date.cmp(&a.date)));
    out.dedup_by(|a, b| a.version == b.version);
    Ok(out)
}

/* ---- 远端 zip：只读中央目录 ---- */

async fn get_range(url: &str, range: &str) -> CmdResult<Vec<u8>> {
    let resp = client()?
        .get(url)
        .header("Range", format!("bytes={range}"))
        .send()
        .await
        .err_ctx("无法连接合宙固件服务器")?;
    if !resp.status().is_success() {
        return Err(format!("读取 zip 目录失败（HTTP {}）：{url}", resp.status()));
    }
    Ok(resp.bytes().await.err_str()?.to_vec())
}

/// 在 zip 末尾找“中央目录结束记录”，返回 (中央目录大小, 偏移)
fn find_eocd(tail: &[u8]) -> Option<(u32, u32)> {
    let i = tail.windows(4).rposition(|w| w == b"PK\x05\x06")?;
    let rd = |o: usize| tail.get(i + o..i + o + 4).map(|b| u32::from_le_bytes(b.try_into().unwrap()));
    Some((rd(12)?, rd(16)?))
}

/// 解析中央目录，返回 (文件名, 解压后大小)
fn parse_central_dir(cd: &[u8]) -> Vec<(String, u64)> {
    let mut out = Vec::new();
    let mut p = 0usize;
    while p + 46 <= cd.len() && &cd[p..p + 4] == b"PK\x01\x02" {
        let u16at = |o: usize| u16::from_le_bytes([cd[p + o], cd[p + o + 1]]) as usize;
        let usize_ = u32::from_le_bytes(cd[p + 24..p + 28].try_into().unwrap()) as u64;
        let (nl, el, cl) = (u16at(28), u16at(30), u16at(32));
        let Some(name) = cd.get(p + 46..p + 46 + nl) else { break };
        out.push((String::from_utf8_lossy(name).into_owned(), usize_));
        p += 46 + nl + el + cl;
    }
    out
}

async fn zip_entries(url: &str) -> CmdResult<Vec<(String, u64)>> {
    let tail = get_range(url, "-65536").await?;
    let (size, off) = find_eocd(&tail).ok_or("不是有效的 zip 文件")?;
    if size == 0 {
        return Ok(Vec::new());
    }
    let cd = get_range(url, &format!("{off}-{}", off as u64 + size as u64 - 1)).await?;
    Ok(parse_central_dir(&cd))
}

fn base_name(path: &str) -> &str {
    path.rsplit(['/', '\\']).next().unwrap_or(path)
}

#[tauri::command]
pub async fn fw_builds(model: String, version: String) -> CmdResult<Vec<FwBuild>> {
    let mut out: Vec<FwBuild> = Vec::new();
    for (ver, r, kind) in sources(&model).await? {
        if ver != version {
            continue;
        }
        match kind {
            Kind::Dir => {
                for f in fetch_listing(&r.href).await? {
                    let file = f.base().to_string();
                    if f.is_dir || !file.to_ascii_lowercase().ends_with(".soc") {
                        continue;
                    }
                    out.push(FwBuild { build: trailing_num(&file), file, size: f.size, date: f.mtime.clone(), url: format!("{CDN}{}", f.href), zip: None });
                }
            }
            Kind::Soc => {
                let file = r.base().to_string();
                out.push(FwBuild { build: trailing_num(&file), file, size: r.size, date: r.mtime.clone(), url: format!("{CDN}{}", r.href), zip: None });
            }
            Kind::Zip => {
                let url = format!("{CDN}{}", r.href);
                for (name, size) in zip_entries(&url).await? {
                    let file = base_name(&name).to_string();
                    if !file.to_ascii_lowercase().ends_with(".soc") {
                        continue;
                    }
                    out.push(FwBuild { build: trailing_num(&file), file, size, date: r.mtime.clone(), url: url.clone(), zip: Some(r.base().to_string()) });
                }
            }
        }
    }
    // 有编号的按编号排，没编号的（标准/FULL/TTS）按文件名长度、再按名字排，标准版排最前
    out.sort_by(|a, b| a.build.cmp(&b.build).then(a.file.len().cmp(&b.file.len())).then(a.file.cmp(&b.file)));
    out.dedup_by(|a, b| a.file == b.file);
    Ok(out)
}

/* ---- 本地缓存 ---- */

fn cache_root(app: &AppHandle) -> CmdResult<PathBuf> {
    sub_dir(app, "firmware")
}

/// 型号、版本、文件名都来自界面，拼路径前先检查，防止 `../` 之类
fn safe_name(s: &str, what: &str) -> CmdResult<()> {
    if s.is_empty() || s.contains(['/', '\\']) || s.starts_with('.') {
        return Err(format!("{what}名称无效：{s}"));
    }
    Ok(())
}

fn cached_path(app: &AppHandle, model: &str, version: &str, file: &str) -> CmdResult<PathBuf> {
    safe_name(model, "型号")?;
    safe_name(version, "版本")?;
    safe_name(file, "固件文件")?;
    Ok(cache_root(app)?.join(model).join(version).join(file))
}

#[tauri::command]
pub fn fw_cache_dir(app: AppHandle) -> CmdResult<String> {
    Ok(cache_root(&app)?.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn fw_cached(app: AppHandle) -> CmdResult<Vec<CachedFw>> {
    let root = cache_root(&app)?;
    let mut out = Vec::new();
    for model_entry in fs::read_dir(&root).into_iter().flatten().flatten() {
        let model = model_entry.file_name().to_string_lossy().into_owned();
        for ver_entry in fs::read_dir(model_entry.path()).into_iter().flatten().flatten() {
            let version = ver_entry.file_name().to_string_lossy().into_owned();
            for f in fs::read_dir(ver_entry.path()).into_iter().flatten().flatten() {
                let file = f.file_name().to_string_lossy().into_owned();
                if !file.to_ascii_lowercase().ends_with(".soc") {
                    continue;
                }
                out.push(CachedFw {
                    key: format!("{model}/{version}/{file}"),
                    model: model.clone(),
                    version: version.clone(),
                    build: trailing_num(&file),
                    file,
                    path: f.path().to_string_lossy().into_owned(),
                    size: f.metadata().map(|m| m.len()).unwrap_or(0),
                });
            }
        }
    }
    Ok(out)
}

/// 流式下载到 `part`，按 key 发 fw-progress 事件，返回下载的字节数
async fn download_to(url: &str, part: &Path, emit: &(dyn Fn(u64, u64) + Send + Sync)) -> CmdResult<u64> {
    let resp = client()?.get(url).send().await.err_ctx("无法连接合宙固件服务器")?;
    if !resp.status().is_success() {
        return Err(format!("下载失败（HTTP {}）：{url}", resp.status()));
    }
    let total = resp.content_length().unwrap_or(0);
    let mut file = fs::File::create(part).err_ctx("创建文件失败")?;
    let mut received = 0u64;
    let mut last_emit = 0u64;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.err_ctx("下载中断")?;
        file.write_all(&chunk).err_ctx("写入文件失败")?;
        received += chunk.len() as u64;
        if received - last_emit > 256 * 1024 || received == total {
            emit(received, total);
            last_emit = received;
        }
    }
    file.flush().err_str()?;
    drop(file);
    if total > 0 && received != total {
        let _ = fs::remove_file(part);
        return Err(format!("下载不完整：{received}/{total} 字节"));
    }
    emit(received, total);
    Ok(received)
}

/// 把 zip 里所有 .soc 解压到 `dir`（坏包不进缓存），返回解出的文件名
fn extract_socs(zip_path: &Path, dir: &Path) -> CmdResult<Vec<String>> {
    let f = fs::File::open(zip_path).err_ctx("打开 zip 失败")?;
    let mut z = zip::ZipArchive::new(f).err_ctx("不是有效的 zip 文件")?;
    let mut names = Vec::new();
    for i in 0..z.len() {
        let mut entry = z.by_index(i).err_ctx("读取 zip 失败")?;
        let raw = entry.name().err_ctx("读取 zip 失败")?.to_string();
        let name = base_name(&raw).to_string();
        if entry.is_dir() || !name.to_ascii_lowercase().ends_with(".soc") {
            continue;
        }
        let dest = dir.join(&name);
        let part = dir.join(format!("{name}.part"));
        let mut out = fs::File::create(&part).err_ctx("创建文件失败")?;
        std::io::copy(&mut entry, &mut out).err_ctx("解压失败")?;
        drop(out);
        match read_soc_info(&part) {
            Ok(_) => {
                fs::rename(&part, &dest).err_ctx("保存固件失败")?;
                names.push(name);
            }
            Err(e) => {
                let _ = fs::remove_file(&part);
                log::warn!("[固件] {name} 校验失败，已跳过：{e}");
            }
        }
    }
    Ok(names)
}

#[tauri::command]
pub async fn fw_download(app: AppHandle, model: String, version: String, file: String) -> CmdResult<String> {
    let root = cache_root(&app)?;
    let key = format!("{model}/{version}/{file}");
    let emit = move |received: u64, total: u64| {
        let _ = app.emit("fw-progress", json!({ "key": key, "received": received, "total": total }));
    };
    let dest = fetch_firmware(&root, &model, &version, &file, &emit).await?;
    Ok(dest.to_string_lossy().into_owned())
}

/// 把固件下载到 `<root>/<型号>/<版本>/<文件名>`（已有就直接返回）；固件在 zip 里时整包下载并解出全部 .soc
async fn fetch_firmware(root: &Path, model: &str, version: &str, file: &str, emit: &(dyn Fn(u64, u64) + Send + Sync)) -> CmdResult<PathBuf> {
    safe_name(model, "型号")?;
    safe_name(version, "版本")?;
    safe_name(file, "固件文件")?;
    let dir = root.join(model).join(version);
    let dest = dir.join(file);
    if dest.exists() {
        return Ok(dest);
    }
    fs::create_dir_all(&dir).err_ctx("创建缓存目录失败")?;
    let b = fw_builds(model.to_string(), version.to_string())
        .await?
        .into_iter()
        .find(|b| b.file == file)
        .ok_or_else(|| format!("合宙服务器上找不到 {file}"))?;
    if let Some(zip) = &b.zip {
        // 固件在 zip 里：整包下载，解压出全部 .soc（同一个包里的其他固件也一起进缓存）
        safe_name(zip, "压缩包")?;
        let part = dir.join(format!("{zip}.part"));
        if let Err(e) = download_to(&b.url, &part, emit).await {
            let _ = fs::remove_file(&part);
            return Err(e);
        }
        let (p, d) = (part.clone(), dir.clone());
        let names = tauri::async_runtime::spawn_blocking(move || extract_socs(&p, &d)).await.err_str()?;
        let _ = fs::remove_file(&part);
        let names = names?;
        log::info!("[固件] {zip} 解压出 {} 个固件：{}", names.len(), names.join("、"));
        if !dest.exists() {
            return Err(format!("{zip} 里没有可用的 {file}"));
        }
    } else {
        let part = dir.join(format!("{file}.part"));
        download_to(&b.url, &part, emit).await?;
        // 下载完先校验能否解析，坏包不进缓存
        if let Err(e) = read_soc_info(&part) {
            let _ = fs::remove_file(&part);
            return Err(format!("固件包校验失败：{e}"));
        }
        fs::rename(&part, &dest).err_ctx("保存固件失败")?;
    }
    Ok(dest)
}

#[tauri::command]
pub fn fw_delete(app: AppHandle, model: String, version: String, file: String) -> CmdResult<()> {
    let p = cached_path(&app, &model, &version, &file)?;
    if p.exists() {
        fs::remove_file(&p).err_ctx("删除失败")?;
    }
    // 版本目录空了就顺手删掉
    if let Some(dir) = p.parent() {
        let _ = fs::remove_dir(dir);
    }
    Ok(())
}

/* ------------------------------------------------------------------ soc 解析 */

fn read_entry(path: &Path, entry: &str) -> CmdResult<Vec<u8>> {
    let mut reader = sevenz_rust2::ArchiveReader::open(path, sevenz_rust2::Password::empty())
        .err_ctx("不是有效的 .soc（7z）文件")?;
    reader.read_file(entry).err_ctx(&format!("固件包里缺少 {entry}"))
}

fn hex_kb(v: &Value) -> Option<u32> {
    match v {
        Value::String(s) => u64::from_str_radix(s.trim_start_matches("0x"), 16).ok().map(|n| (n / 1024) as u32),
        Value::Number(n) => n.as_u64().map(|n| n as u32),
        _ => None,
    }
}

pub fn read_soc_info(path: &Path) -> CmdResult<SocInfo> {
    let info_bytes = read_entry(path, "info.json")?;
    let info: Value = serde_json::from_slice(&info_bytes).err_ctx("info.json 格式错误")?;
    let get = |p: &[&str]| -> Value {
        let mut v = &info;
        for k in p {
            v = match v.get(*k) {
                Some(x) => x,
                None => return Value::Null,
            };
        }
        v.clone()
    };
    let script_addr = get(&["download", "script_addr"]).as_str().unwrap_or("").to_uppercase();
    let script_kb = get(&["rom", "fs", "script", "size"]).as_u64().unwrap_or(0) as u32;
    let fs_kb = hex_kb(&get(&["rom", "fs", "filesystem", "size"])).unwrap_or(0);
    let bits = get(&["script", "bitw"]).as_u64().unwrap_or(32) as u32;
    let use_luac = get(&["script", "use-luac"]).as_bool().unwrap_or(true);
    let fw_num = get(&["fota", "fw_num"]).as_u64().map(|n| n as u32);
    let chip_type = get(&["chip", "type"]).as_str().unwrap_or("").to_string();
    let rom_file = get(&["rom", "file"]).as_str().unwrap_or("luatos.binpkg").to_string();

    // binpkg 头部 0x190 处是产品名，如 EC718HM_PRD
    let chip = read_entry(path, &rom_file)
        .ok()
        .and_then(|d| {
            if d.len() > 0x1A0 && &d[0x38..0x3F] == b"pkgmode" {
                let raw = &d[0x190..0x1A0];
                let s = raw.split(|b| *b == 0).next()?;
                Some(String::from_utf8_lossy(s).trim_end_matches("_PRD").to_string())
            } else {
                None
            }
        })
        .unwrap_or_else(|| chip_type.to_uppercase());

    Ok(SocInfo {
        chip,
        chip_type,
        bits,
        script_addr: if script_addr.is_empty() { String::new() } else { format!("0x{script_addr}") },
        script_kb,
        fs_kb,
        fw_num,
        use_luac,
        size: fs::metadata(path).map(|m| m.len()).unwrap_or(0),
        file: path.file_name().map(|f| f.to_string_lossy().into_owned()).unwrap_or_default(),
    })
}

#[tauri::command]
pub async fn soc_info(state: State<'_, SharedFirmware>, path: String) -> CmdResult<SocInfo> {
    let path = crate::util::expand_tilde(&path);
    let meta = fs::metadata(&path).err_ctx("找不到固件文件")?;
    let cache_key = format!(
        "{}|{}|{:?}",
        path.display(),
        meta.len(),
        meta.modified().ok()
    );
    if let Some(info) = state.soc_cache.lock().unwrap().get(&cache_key) {
        return Ok(info.clone());
    }
    let p = path.clone();
    let info = tauri::async_runtime::spawn_blocking(move || read_soc_info(&p)).await.err_str()??;
    state.soc_cache.lock().unwrap().insert(cache_key, info.clone());
    Ok(info)
}

/// 读出 soc 里某个文本文件（调试用，例如查看 info.json）
#[tauri::command]
pub fn soc_read_text(path: String, entry: String) -> CmdResult<String> {
    let mut s = String::new();
    read_entry(&crate::util::expand_tilde(&path), &entry)?.as_slice().read_to_string(&mut s).err_str()?;
    Ok(s)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_cdn_listing_rows() {
        let html = r#"
          <tr class="entry-row entry-file"
              data-name="luatos-soc_v2056_air780ehm_112.soc"
              data-is-dir="0"
              data-size="7786030"
              data-mtime="2026-11-05 13:37">
            <td>
              <a class="entry-link" href="/files/Air780EHM/LuatOS_Air780EHM/LuatOS-SoC_V2056_Air780EHM/LuatOS-SoC_V2056_Air780EHM_112.soc"
                 download title="x"><span class="entry-name">LuatOS-SoC_V2056_Air780EHM_112.soc</span></a>
          <tr class="entry-row entry-dir"
              data-name="luatos-soc_v2054_air780ehm"
              data-is-dir="1"
              data-size="-1"
              data-mtime="2026-10-01 09:00">
            <td><a class="entry-link" href="/files/Air780EHM/LuatOS_Air780EHM/LuatOS-SoC_V2054_Air780EHM/">"#;
        let rows = parse_listing(html);
        assert_eq!(rows.len(), 2);
        assert!(!rows[0].is_dir);
        assert_eq!(rows[0].size, 7786030);
        assert!(rows[0].href.ends_with("_112.soc"));
        assert!(rows[1].is_dir);
        assert_eq!(rows[1].mtime, "2026-10-01 09:00");
    }

    /// 联网测试：cargo test -- --ignored
    #[tokio::test]
    #[ignore]
    async fn lists_real_cdn_versions_and_builds() {
        let vs = fw_versions("Air780EHM".into()).await.unwrap();
        assert!(vs.iter().any(|v| v.version == "V2056"), "{vs:?}");
        assert!(version_num(&vs[0].version) >= 2056);
        let bs = fw_builds("Air780EHM".into(), "V2056".into()).await.unwrap();
        let b112 = bs.iter().find(|b| b.build == Some(112)).expect("112");
        assert_eq!(b112.size, 7786030);
        assert!(b112.url.ends_with("LuatOS-SoC_V2056_Air780EHM_112.soc"));
        assert!(bs.len() >= 40, "{}", bs.len());
    }

    /// 联网测试：其他三种存放方式（直接放 .soc、zip、目录 + zip 混用）
    #[tokio::test]
    #[ignore]
    async fn lists_other_cdn_layouts() {
        // zip：core_V1124.zip 里有 标准/FULL/TTS 三个 .soc，不下载整包也能列出来
        let bs = fw_builds("Air780EG".into(), "V1124".into()).await.unwrap();
        let files: Vec<_> = bs.iter().map(|b| b.file.as_str()).collect();
        assert_eq!(files, ["LuatOS-SoC_V1124_EC618.soc", "LuatOS-SoC_V1124_EC618_TTS.soc", "LuatOS-SoC_V1124_EC618_FULL.soc"], "{bs:?}");
        assert!(bs.iter().all(|b| b.zip.as_deref() == Some("core_V1124.zip") && b.build.is_none()));
        assert_eq!(bs[0].size, 5063626);
        // 直接放 .soc（文件名里型号是大写）
        let vs = fw_versions("Air6208".into()).await.unwrap();
        assert_eq!(vs[0].version, "V1002");
        let bs = fw_builds("Air6208".into(), "V1002".into()).await.unwrap();
        assert_eq!(bs.len(), 1);
        assert!(bs[0].zip.is_none() && bs[0].file.ends_with(".soc"));
        // 目录 + zip 混用
        let vs = fw_versions("Air780EPM".into()).await.unwrap();
        assert!(vs.iter().any(|v| v.version == "V2056") && vs.iter().any(|v| v.version == "V2010"), "{vs:?}");
        let old = fw_builds("Air780EPM".into(), "V2010".into()).await.unwrap();
        assert_eq!(old.len(), 1);
        assert_eq!(old[0].zip.as_deref(), Some("LuatOS-SoC_V2010_Air780EPM.zip"));
    }

    /// 联网测试：真的下载一次 zip 里的固件（约 16 MB），检查整包解压和校验
    #[tokio::test]
    #[ignore]
    async fn downloads_firmware_from_zip() {
        let root = std::env::temp_dir().join(format!("fw-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let p = fetch_firmware(&root, "Air780EG", "V1124", "LuatOS-SoC_V1124_EC618_TTS.soc", &|_, _| {}).await.unwrap();
        assert!(p.ends_with("Air780EG/V1124/LuatOS-SoC_V1124_EC618_TTS.soc"));
        let dir = p.parent().unwrap();
        let mut names: Vec<String> = fs::read_dir(dir).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        names.sort();
        // 包里另外两个固件也解出来了，临时文件都清掉了
        assert_eq!(names, ["LuatOS-SoC_V1124_EC618.soc", "LuatOS-SoC_V1124_EC618_FULL.soc", "LuatOS-SoC_V1124_EC618_TTS.soc"]);
        let info = read_soc_info(&p).unwrap();
        assert_eq!(info.chip_type, "ec618");
        assert_eq!(info.script_addr, "0x24D000");
        // 已在缓存里：不再下载
        let again = fetch_firmware(&root, "Air780EG", "V1124", "LuatOS-SoC_V1124_EC618.soc", &|_, _| panic!("不该再下载")).await.unwrap();
        assert!(again.exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn names_and_numbers() {
        assert_eq!(version_of("LuatOS-SoC_V2056_Air780EHM").as_deref(), Some("V2056"));
        assert_eq!(version_of("LuatOS-SoC_V1002_AIR6208.soc").as_deref(), Some("V1002"));
        assert_eq!(version_of("core_V1124.zip").as_deref(), Some("V1124"));
        assert_eq!(version_of("docs_air780e"), None);
        assert_eq!(trailing_num("LuatOS-SoC_V2056_Air780EHM_112.soc"), Some(112));
        assert_eq!(trailing_num("LuatOS-SoC_V2026_Air780EP_1.soc"), Some(1));
        assert_eq!(trailing_num("LuatOS-SoC_V1124_EC618_FULL.soc"), None);
        assert_eq!(trailing_num("LuatOS-SoC_V1124_EC618.soc"), None);
        assert!(safe_name("../x", "t").is_err() && safe_name("a/b", "t").is_err() && safe_name("V2056", "t").is_ok());
    }

    /// 用 zip crate 在内存里做一个 zip，验证中央目录解析
    #[test]
    fn parses_zip_central_directory() {
        let mut buf = std::io::Cursor::new(Vec::new());
        {
            let mut w = zip::ZipWriter::new(&mut buf);
            let opt = zip::write::SimpleFileOptions::default();
            w.start_file("LuatOS-SoC_V1124_EC618.soc", opt).unwrap();
            w.write_all(&[7u8; 1000]).unwrap();
            w.add_directory("CORE_V4035/", opt).unwrap();
            w.start_file("CORE_V4035/readme.txt", opt).unwrap();
            w.write_all(b"hi").unwrap();
            w.finish().unwrap();
        }
        let bytes = buf.into_inner();
        let (size, off) = find_eocd(&bytes).unwrap();
        let cd = &bytes[off as usize..(off + size) as usize];
        let entries = parse_central_dir(cd);
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0], ("LuatOS-SoC_V1124_EC618.soc".to_string(), 1000));
        assert_eq!(base_name(&entries[2].0), "readme.txt");
    }

    /// 用 refs/firmware 里下载好的真实固件验证（文件不在时跳过）
    #[test]
    fn reads_real_soc_info() {
        let p = Path::new(env!("CARGO_MANIFEST_DIR")).join("../refs/firmware/LuatOS-SoC_V2056_Air780EHM_112.soc");
        if !p.exists() {
            eprintln!("skip: {} not found", p.display());
            return;
        }
        let info = read_soc_info(&p).unwrap();
        assert_eq!(info.chip, "EC718HM");
        assert_eq!(info.chip_type, "ec7xx");
        assert_eq!(info.bits, 64);
        assert_eq!(info.script_addr, "0x2CE000");
        assert_eq!(info.script_kb, 1024);
        assert_eq!(info.fs_kb, 2304);
        assert_eq!(info.fw_num, Some(112));
    }
}
