//! 公共工具：命令错误类型、路径、JSON 读写。

use std::fs;
use std::path::{Path, PathBuf};

use serde::{de::DeserializeOwned, Serialize};
use tauri::{AppHandle, Manager};

/// 前端拿到的错误就是一段中文提示，直接显示在 toast 里。
pub type CmdResult<T> = Result<T, String>;

pub trait ErrStr<T> {
    fn err_str(self) -> CmdResult<T>;
    fn err_ctx(self, ctx: &str) -> CmdResult<T>;
}

impl<T, E: std::fmt::Display> ErrStr<T> for Result<T, E> {
    fn err_str(self) -> CmdResult<T> {
        self.map_err(|e| e.to_string())
    }
    fn err_ctx(self, ctx: &str) -> CmdResult<T> {
        self.map_err(|e| format!("{ctx}：{e}"))
    }
}

/// 应用数据目录（macOS：~/Library/Application Support/<identifier>）。
pub fn app_dir(app: &AppHandle) -> CmdResult<PathBuf> {
    let dir = app.path().app_data_dir().err_ctx("无法定位应用数据目录")?;
    fs::create_dir_all(&dir).err_ctx("无法创建应用数据目录")?;
    Ok(dir)
}

pub fn sub_dir(app: &AppHandle, name: &str) -> CmdResult<PathBuf> {
    let dir = app_dir(app)?.join(name);
    fs::create_dir_all(&dir).err_ctx(&format!("无法创建目录 {}", dir.display()))?;
    Ok(dir)
}

/// 新建项目的默认根目录：~/LuatOS
pub fn default_projects_root() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")).join("LuatOS")
}

pub fn read_json<T: DeserializeOwned + Default>(path: &Path) -> T {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_default(),
        Err(_) => T::default(),
    }
}

/// 先写临时文件再改名，避免写到一半崩溃导致配置损坏。
pub fn write_json<T: Serialize>(path: &Path, value: &T) -> CmdResult<()> {
    let data = serde_json::to_vec_pretty(value).err_str()?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, data).err_ctx("写入配置失败")?;
    fs::rename(&tmp, path).err_ctx("保存配置失败")?;
    Ok(())
}

/// 把 `~/xxx` 展开成绝对路径（前端显示用 ~，传回来时要还原）。
pub fn expand_tilde(p: &str) -> PathBuf {
    if let Some(rest) = p.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(p)
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
