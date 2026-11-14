//! 项目管理：项目清单持久化、文件读写、LuaTools .ini 导入、.luatos 项目包导入导出、Lua 语法检查。
//!
//! 和 LuaTools 一样，项目本质是“底层固件 + 一组脚本/资源文件的路径”，文件留在原处不搬动。
//! 新建项目时会在 ~/LuatOS/<项目名>/ 下创建目录和模板文件。

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;

use crate::util::{app_dir, default_projects_root, expand_tilde, now_ms, read_json, write_json, CmdResult, ErrStr};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CoreRef {
    /// resource = 固件资源里的版本 + 固件文件，local = 本地文件
    pub source: String,
    pub version: String,
    /// 文件名末尾的编号（EC718 的 112 号等），没有编号为 0；旧项目只存了它
    pub build: u32,
    /// 固件文件名（如 LuatOS-SoC_V1124_EC618_TTS.soc）。旧项目没有这个字段，由版本 + 编号推出
    #[serde(default)]
    pub file: String,
    pub local_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRec {
    pub id: String,
    pub name: String,
    pub version: String,
    pub model: String,
    pub core: CoreRef,
    /// 项目目录（新建/导入时确定，用于新建文件和克隆）
    pub dir: String,
    /// 脚本和资源文件的绝对路径
    pub files: Vec<String>,
    /// 下载选项（结构由前端定义，后端原样保存）
    #[serde(default)]
    pub options: Value,
    pub last_download: Option<u64>,
    #[serde(default)]
    pub created_at: u64,
}

fn store_path(app: &AppHandle) -> CmdResult<PathBuf> {
    Ok(app_dir(app)?.join("projects.json"))
}

fn load(app: &AppHandle) -> CmdResult<Vec<ProjectRec>> {
    Ok(read_json(&store_path(app)?))
}

fn save_all(app: &AppHandle, list: &[ProjectRec]) -> CmdResult<()> {
    write_json(&store_path(app)?, &list)
}

fn new_id() -> String {
    format!("p{}", now_ms())
}

#[tauri::command]
pub fn project_list(app: AppHandle) -> CmdResult<Vec<ProjectRec>> {
    load(&app)
}

#[tauri::command]
pub fn project_save(app: AppHandle, rec: ProjectRec) -> CmdResult<ProjectRec> {
    let mut list = load(&app)?;
    if list.iter().any(|p| p.id != rec.id && p.name == rec.name) {
        return Err(format!("已存在同名项目：{}", rec.name));
    }
    match list.iter_mut().find(|p| p.id == rec.id) {
        Some(p) => *p = rec.clone(),
        None => list.insert(0, rec.clone()),
    }
    save_all(&app, &list)?;
    Ok(rec)
}

#[tauri::command]
pub fn project_remove(app: AppHandle, id: String) -> CmdResult<()> {
    let mut list = load(&app)?;
    list.retain(|p| p.id != id);
    save_all(&app, &list)
}

#[derive(Debug, Deserialize)]
pub struct NewFile {
    pub name: String,
    pub content: String,
}

fn check_name(name: &str) -> CmdResult<()> {
    let re = Regex::new(r"^[A-Za-z0-9_\-]{1,32}$").unwrap();
    if re.is_match(name) {
        Ok(())
    } else {
        Err("项目名只能包含字母、数字、下划线和短横线，最多 32 个字符".into())
    }
}

fn unique_dir(root: &Path, name: &str) -> PathBuf {
    let mut dir = root.join(name);
    let mut i = 2;
    while dir.exists() && fs::read_dir(&dir).map(|mut d| d.next().is_some()).unwrap_or(false) {
        dir = root.join(format!("{name}_{i}"));
        i += 1;
    }
    dir
}

#[tauri::command]
pub fn project_create(
    app: AppHandle,
    name: String,
    model: String,
    core: CoreRef,
    files: Vec<NewFile>,
    options: Value,
    root: Option<String>,
) -> CmdResult<ProjectRec> {
    check_name(&name)?;
    let mut list = load(&app)?;
    if list.iter().any(|p| p.name == name) {
        return Err(format!("已存在同名项目：{name}"));
    }
    let root = root.map(|r| expand_tilde(&r)).unwrap_or_else(default_projects_root);
    let dir = unique_dir(&root, &name);
    fs::create_dir_all(&dir).err_ctx("创建项目目录失败")?;
    let mut paths = Vec::new();
    for f in &files {
        let p = dir.join(&f.name);
        fs::write(&p, &f.content).err_ctx(&format!("写入 {} 失败", f.name))?;
        paths.push(p.to_string_lossy().into_owned());
    }
    let rec = ProjectRec {
        id: new_id(),
        name,
        version: "001.000.000".into(),
        model,
        core,
        dir: dir.to_string_lossy().into_owned(),
        files: paths,
        options,
        last_download: None,
        created_at: now_ms(),
    };
    list.insert(0, rec.clone());
    save_all(&app, &list)?;
    Ok(rec)
}

/// 打开已有文件夹作为项目（文件留在原处，只记路径）
#[tauri::command]
pub fn project_open_dir(app: AppHandle, dir: String, model: String, core: CoreRef, options: Value) -> CmdResult<ProjectRec> {
    let dirp = expand_tilde(&dir);
    if !dirp.is_dir() {
        return Err("请选择一个文件夹".into());
    }
    let mut name: String = dirp
        .file_name()
        .map(|n| n.to_string_lossy().chars().filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-').collect())
        .unwrap_or_default();
    if name.is_empty() {
        name = "project".into();
    }
    let mut list = load(&app)?;
    let base = name.clone();
    let mut i = 2;
    while list.iter().any(|p| p.name == name) {
        name = format!("{base}_{i}");
        i += 1;
    }
    let files = list_dir_files(&dirp, false)?;
    let rec = ProjectRec {
        id: new_id(),
        name,
        version: "001.000.000".into(),
        model,
        core,
        dir: dirp.to_string_lossy().into_owned(),
        files,
        options,
        last_download: None,
        created_at: now_ms(),
    };
    list.insert(0, rec.clone());
    save_all(&app, &list)?;
    Ok(rec)
}

#[tauri::command]
pub fn project_clone(app: AppHandle, id: String, new_name: String) -> CmdResult<ProjectRec> {
    check_name(&new_name)?;
    let mut list = load(&app)?;
    let src = list.iter().find(|p| p.id == id).cloned().ok_or("项目不存在")?;
    if list.iter().any(|p| p.name == new_name) {
        return Err(format!("已存在同名项目：{new_name}"));
    }
    let src_dir = PathBuf::from(&src.dir);
    let root = src_dir.parent().map(Path::to_path_buf).unwrap_or_else(default_projects_root);
    let new_dir = unique_dir(&root, &new_name);
    fs::create_dir_all(&new_dir).err_ctx("创建项目目录失败")?;
    // 项目目录里的文件复制一份，目录外引用的文件保持引用
    let files = src
        .files
        .iter()
        .map(|f| {
            let fp = PathBuf::from(f);
            if let Ok(rel) = fp.strip_prefix(&src_dir) {
                let dst = new_dir.join(rel);
                if let Some(parent) = dst.parent() {
                    let _ = fs::create_dir_all(parent);
                }
                fs::copy(&fp, &dst).err_ctx(&format!("复制 {f} 失败"))?;
                Ok(dst.to_string_lossy().into_owned())
            } else {
                Ok(f.clone())
            }
        })
        .collect::<CmdResult<Vec<_>>>()?;
    let rec = ProjectRec {
        id: new_id(),
        name: new_name,
        dir: new_dir.to_string_lossy().into_owned(),
        files,
        last_download: None,
        created_at: now_ms(),
        ..src
    };
    list.insert(0, rec.clone());
    save_all(&app, &list)?;
    Ok(rec)
}

/* ------------------------------------------------------------------ 文件 */

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStat {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub exists: bool,
    pub is_script: bool,
}

#[tauri::command]
pub fn files_stat(paths: Vec<String>) -> Vec<FileStat> {
    paths
        .into_iter()
        .map(|p| {
            let path = PathBuf::from(&p);
            let meta = fs::metadata(&path).ok();
            let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| p.clone());
            FileStat {
                is_script: name.ends_with(".lua"),
                path: p,
                name,
                size: meta.as_ref().map(|m| m.len()).unwrap_or(0),
                exists: meta.is_some(),
            }
        })
        .collect()
}

#[tauri::command]
pub fn read_text(path: String) -> CmdResult<String> {
    let bytes = fs::read(expand_tilde(&path)).err_ctx("读取文件失败")?;
    Ok(decode_text(&bytes))
}

#[tauri::command]
pub fn write_text(path: String, content: String) -> CmdResult<()> {
    let p = expand_tilde(&path);
    if let Some(dir) = p.parent() {
        fs::create_dir_all(dir).err_ctx("创建目录失败")?;
    }
    fs::write(&p, content).err_ctx("保存文件失败")
}

/// 读取文件开头若干字节（资源文件的十六进制预览），返回 base64
#[tauri::command]
pub fn read_bytes(path: String, max: usize) -> CmdResult<String> {
    use base64::Engine;
    let mut f = fs::File::open(expand_tilde(&path)).err_ctx("读取文件失败")?;
    let mut buf = vec![0u8; max.min(64 * 1024)];
    let n = f.read(&mut buf).err_str()?;
    buf.truncate(n);
    Ok(base64::engine::general_purpose::STANDARD.encode(buf))
}

/// 文本解码：先按 UTF-8，失败再按 GBK（LuaTools 在中文 Windows 上保存的文件常是 GBK）
fn decode_text(bytes: &[u8]) -> String {
    let bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
    match std::str::from_utf8(bytes) {
        Ok(s) => s.to_string(),
        Err(_) => encoding_rs::GBK.decode(bytes).0.into_owned(),
    }
}

fn skip_name(name: &str) -> bool {
    name.starts_with('.') || matches!(name, "node_modules" | "target" | "build" | "dist" | "__pycache__")
}

fn list_dir_files(dir: &Path, recursive: bool) -> CmdResult<Vec<String>> {
    let mut out = Vec::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        let mut entries: Vec<_> = fs::read_dir(&d).err_ctx("读取目录失败")?.flatten().collect();
        entries.sort_by_key(|e| e.file_name());
        for e in entries {
            let name = e.file_name().to_string_lossy().into_owned();
            if skip_name(&name) {
                continue;
            }
            let p = e.path();
            if p.is_dir() {
                if recursive {
                    stack.push(p);
                }
            } else {
                out.push(p.to_string_lossy().into_owned());
                if out.len() > 1024 {
                    return Err("目录里的文件超过 1024 个，脚本区放不下，请选择更具体的目录".into());
                }
            }
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn dir_files(dir: String) -> CmdResult<Vec<String>> {
    list_dir_files(&expand_tilde(&dir), true)
}

/* ------------------------------------------------------------------ LuaTools .ini 导入 */

fn model_from_soc_path(p: &str) -> Option<(String, String, u32)> {
    let re = Regex::new(r"LuatOS-SoC_(V\d+)_([A-Za-z0-9]+)_(\d+)").unwrap();
    let c = re.captures(p)?;
    Some((c[2].to_string(), c[1].to_string(), c[3].parse().ok()?))
}

#[tauri::command]
pub fn project_import_ini(app: AppHandle, path: String, options: Value) -> CmdResult<ProjectRec> {
    let ini_path = expand_tilde(&path);
    let text = decode_text(&fs::read(&ini_path).err_ctx("读取 .ini 失败")?);
    let mut info = std::collections::BTreeMap::new();
    let mut files = Vec::new();
    let mut section: Option<String> = None;
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with(';') || line.starts_with('#') {
            continue;
        }
        if line.starts_with('[') && line.ends_with(']') {
            section = Some(line[1..line.len() - 1].to_string());
            continue;
        }
        let Some(eq) = line.find('=') else { continue };
        let key = line[..eq].trim().to_string();
        let value = line[eq + 1..].trim().to_string();
        match section.as_deref() {
            Some("info") => {
                info.insert(key, value);
            }
            Some(dir) if !key.is_empty() => {
                let p = Path::new(dir).join(&key);
                files.push(p.to_string_lossy().into_owned());
            }
            _ => {}
        }
    }
    if files.is_empty() {
        return Err("这个 .ini 里没有脚本列表，可能不是 LuaTools 项目文件".into());
    }
    let core_path = info.get("core_path").cloned().unwrap_or_default();
    let (model, version, build) = model_from_soc_path(&core_path).unwrap_or(("Air780EHM".into(), "".into(), 0));
    let mut name: String = ini_path
        .file_stem()
        .map(|s| s.to_string_lossy().chars().filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-').collect())
        .unwrap_or_default();
    if name.is_empty() {
        name = "luatools_project".into();
    }
    let mut list = load(&app)?;
    let base = name.clone();
    let mut i = 2;
    while list.iter().any(|p| p.name == name) {
        name = format!("{base}_{i}");
        i += 1;
    }
    let dir = files
        .first()
        .and_then(|f| Path::new(f).parent().map(|p| p.to_string_lossy().into_owned()))
        .unwrap_or_default();
    let mut options = options;
    if let Some(obj) = options.as_object_mut() {
        if info.get("luac_debug").map(|v| v.eq_ignore_ascii_case("true")) == Some(true) {
            obj.insert("debugInfo".into(), Value::String("all".into()));
        }
    }
    let rec = ProjectRec {
        id: new_id(),
        name,
        version: "001.000.000".into(),
        model,
        core: CoreRef { source: "local".into(), version, build, file: String::new(), local_path: core_path },
        dir,
        files,
        options,
        last_download: None,
        created_at: now_ms(),
    };
    list.insert(0, rec.clone());
    save_all(&app, &list)?;
    Ok(rec)
}

/* ------------------------------------------------------------------ .luatos 项目包 */

#[tauri::command]
pub fn project_export(app: AppHandle, id: String, dest: String, include_core: bool) -> CmdResult<String> {
    let list = load(&app)?;
    let p = list.iter().find(|p| p.id == id).ok_or("项目不存在")?;
    let dest = expand_tilde(&dest);
    let file = fs::File::create(&dest).err_ctx("创建项目包失败")?;
    let mut zip = zip::ZipWriter::new(file);
    let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let mut manifest = p.clone();
    manifest.files = Vec::new();
    for f in &p.files {
        let fp = PathBuf::from(f);
        let name = fp.file_name().map(|n| n.to_string_lossy().into_owned()).ok_or("文件名无效")?;
        let mut data = Vec::new();
        fs::File::open(&fp).and_then(|mut h| h.read_to_end(&mut data)).err_ctx(&format!("读取 {f} 失败"))?;
        zip.start_file(format!("files/{name}"), opts).err_str()?;
        zip.write_all(&data).err_str()?;
        manifest.files.push(name);
    }
    if include_core && p.core.source == "local" && Path::new(&p.core.local_path).exists() {
        let core = PathBuf::from(&p.core.local_path);
        let name = core.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or("core.soc".into());
        let data = fs::read(&core).err_ctx("读取底层固件失败")?;
        zip.start_file(format!("core/{name}"), zip::write::SimpleFileOptions::default()).err_str()?;
        zip.write_all(&data).err_str()?;
        manifest.core.local_path = format!("core/{name}");
    }
    zip.start_file("project.json", opts).err_str()?;
    zip.write_all(&serde_json::to_vec_pretty(&manifest).err_str()?).err_str()?;
    zip.finish().err_ctx("写入项目包失败")?;
    Ok(dest.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn project_import_pkg(app: AppHandle, path: String, root: Option<String>) -> CmdResult<ProjectRec> {
    let file = fs::File::open(expand_tilde(&path)).err_ctx("打开项目包失败")?;
    let mut zip = zip::ZipArchive::new(file).err_ctx("不是有效的 .luatos 项目包")?;
    let mut manifest: ProjectRec = {
        let mut f = zip.by_name("project.json").err_ctx("项目包里缺少 project.json")?;
        let mut s = String::new();
        f.read_to_string(&mut s).err_str()?;
        serde_json::from_str(&s).err_ctx("project.json 格式错误")?
    };
    let mut list = load(&app)?;
    let base = manifest.name.clone();
    let mut i = 2;
    while list.iter().any(|p| p.name == manifest.name) {
        manifest.name = format!("{base}_{i}");
        i += 1;
    }
    let root = root.map(|r| expand_tilde(&r)).unwrap_or_else(default_projects_root);
    let dir = unique_dir(&root, &manifest.name);
    fs::create_dir_all(&dir).err_ctx("创建项目目录失败")?;
    let mut files = Vec::new();
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).err_str()?;
        let Some(name) = entry.enclosed_name() else { continue };
        let name = name.to_path_buf();
        let rel = if let Ok(r) = name.strip_prefix("files") {
            r.to_path_buf()
        } else if name.starts_with("core") {
            name.clone()
        } else {
            continue;
        };
        let out = dir.join(&rel);
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent).err_str()?;
        }
        let mut data = Vec::new();
        entry.read_to_end(&mut data).err_str()?;
        fs::write(&out, data).err_str()?;
        if name.starts_with("files") {
            files.push(out.to_string_lossy().into_owned());
        } else {
            manifest.core.local_path = out.to_string_lossy().into_owned();
        }
    }
    manifest.id = new_id();
    manifest.dir = dir.to_string_lossy().into_owned();
    manifest.files = files;
    manifest.last_download = None;
    manifest.created_at = now_ms();
    list.insert(0, manifest.clone());
    save_all(&app, &list)?;
    Ok(manifest)
}

/* ------------------------------------------------------------------ 语法检查 */

#[derive(Debug, Deserialize)]
pub struct Source {
    pub name: String,
    pub content: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diag {
    pub file: String,
    pub line: u32,
    pub message: String,
    pub severity: String,
}

/// 用真正的 Lua 5.3 解析器（LuatOS 同版本）编译每个脚本，只编译不运行。
#[tauri::command]
pub fn lua_check(sources: Vec<Source>) -> Vec<Diag> {
    let lua = mlua::Lua::new();
    let re = Regex::new(r":(\d+):\s*(.*)$").unwrap();
    let mut out = Vec::new();
    for s in sources {
        if let Err(e) = lua.load(&s.content).set_name(format!("@{}", s.name)).into_function() {
            let msg = match &e {
                mlua::Error::SyntaxError { message, .. } => message.clone(),
                other => other.to_string(),
            };
            let first = msg.lines().next().unwrap_or(&msg).to_string();
            let (line, text) = match re.captures(&first) {
                Some(c) => (c[1].parse().unwrap_or(0), c[2].to_string()),
                None => (0, first.clone()),
            };
            out.push(Diag { file: s.name, line, message: text, severity: "error".into() });
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lua_check_reports_line_and_message() {
        let diags = lua_check(vec![
            Source { name: "ok.lua".into(), content: "local a = 1\nreturn a\n".into() },
            Source { name: "bad.lua".into(), content: "local a = 1\nif a then\n  print(a)\n".into() },
            Source { name: "bad2.lua".into(), content: "x = = 2\n".into() },
        ]);
        assert_eq!(diags.len(), 2);
        assert_eq!(diags[0].file, "bad.lua");
        assert!(diags[0].message.contains("'end' expected"), "{}", diags[0].message);
        assert_eq!(diags[1].file, "bad2.lua");
        assert_eq!(diags[1].line, 1);
    }

    #[test]
    fn decodes_gbk_text() {
        let (gbk, _, _) = encoding_rs::GBK.encode("-- 中文注释\n");
        assert_eq!(decode_text(&gbk), "-- 中文注释\n");
        assert_eq!(decode_text("abc".as_bytes()), "abc");
    }

    #[test]
    fn soc_path_parses_model_version_build() {
        let (m, v, b) = model_from_soc_path(r"D:\fw\LuatOS-SoC_V2056_Air780EHM_112.soc").unwrap();
        assert_eq!((m.as_str(), v.as_str(), b), ("Air780EHM", "V2056", 112));
    }
}
