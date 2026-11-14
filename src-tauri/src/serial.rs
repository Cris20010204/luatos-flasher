//! 串口调试助手：打开任意串口，后台线程读数据推给前端，前端发数据写入串口。

use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use base64::Engine;
use serde::Deserialize;
use serde_json::json;
use serialport::{DataBits, Parity, SerialPort, StopBits};
use tauri::{AppHandle, Emitter, State};

use crate::util::{CmdResult, ErrStr};

struct OpenPort {
    name: String,
    writer: Box<dyn SerialPort>,
    stop: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct SerialState {
    port: Mutex<Option<OpenPort>>,
}
pub type SharedSerial = Arc<SerialState>;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SerialOpenRequest {
    pub port: String,
    pub baud: u32,
    pub data_bits: u8,
    /// none / odd / even
    pub parity: String,
    pub stop_bits: u8,
}

fn b64() -> base64::engine::GeneralPurpose {
    base64::engine::general_purpose::STANDARD
}

#[tauri::command]
pub fn serial_open(app: AppHandle, state: State<'_, SharedSerial>, req: SerialOpenRequest) -> CmdResult<()> {
    let mut guard = state.port.lock().unwrap();
    if let Some(old) = guard.take() {
        old.stop.store(true, Ordering::Relaxed);
    }
    let data_bits = match req.data_bits {
        5 => DataBits::Five,
        6 => DataBits::Six,
        7 => DataBits::Seven,
        _ => DataBits::Eight,
    };
    let parity = match req.parity.as_str() {
        "odd" => Parity::Odd,
        "even" => Parity::Even,
        _ => Parity::None,
    };
    let stop_bits = if req.stop_bits == 2 { StopBits::Two } else { StopBits::One };
    let port = serialport::new(&req.port, req.baud)
        .data_bits(data_bits)
        .parity(parity)
        .stop_bits(stop_bits)
        .timeout(Duration::from_millis(30))
        .open()
        .map_err(|e| match e.kind() {
            serialport::ErrorKind::NoDevice => format!("找不到串口 {}（设备可能已拔出）", req.port),
            serialport::ErrorKind::Io(std::io::ErrorKind::PermissionDenied) => {
                format!("串口 {} 被占用或没有权限（是否被其他程序或虚拟机占用？）", req.port)
            }
            _ => format!("打开串口 {} 失败：{e}", req.port),
        })?;
    let mut reader = port.try_clone().err_ctx("串口复制句柄失败")?;
    let stop = Arc::new(AtomicBool::new(false));
    let stop2 = stop.clone();
    let name = req.port.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        let mut pending: Vec<u8> = Vec::new();
        let mut last_flush = Instant::now();
        let mut error: Option<String> = None;
        while !stop2.load(Ordering::Relaxed) {
            match reader.read(&mut buf) {
                Ok(n) if n > 0 => pending.extend_from_slice(&buf[..n]),
                Ok(_) => {}
                Err(e) if e.kind() == std::io::ErrorKind::TimedOut => {}
                Err(e) => {
                    error = Some(format!("串口读取出错：{e}"));
                    break;
                }
            }
            // 合并 20ms 内的数据再推送，避免事件过多卡界面
            if !pending.is_empty() && (last_flush.elapsed() >= Duration::from_millis(20) || pending.len() > 8192) {
                let _ = app.emit("serial-data", json!({ "port": name, "data": b64().encode(&pending) }));
                pending.clear();
                last_flush = Instant::now();
            }
        }
        if !pending.is_empty() {
            let _ = app.emit("serial-data", json!({ "port": name, "data": b64().encode(&pending) }));
        }
        if !stop2.load(Ordering::Relaxed) {
            let _ = app.emit("serial-closed", json!({ "port": name, "error": error }));
        }
    });
    *guard = Some(OpenPort { name: req.port, writer: port, stop });
    Ok(())
}

#[tauri::command]
pub fn serial_write(state: State<'_, SharedSerial>, data: String) -> CmdResult<usize> {
    let bytes = b64().decode(data).err_ctx("数据格式错误")?;
    let mut guard = state.port.lock().unwrap();
    let port = guard.as_mut().ok_or("串口未打开")?;
    port.writer.write_all(&bytes).err_ctx("发送失败")?;
    port.writer.flush().ok();
    Ok(bytes.len())
}

#[tauri::command]
pub fn serial_close(state: State<'_, SharedSerial>) -> CmdResult<()> {
    if let Some(p) = state.port.lock().unwrap().take() {
        p.stop.store(true, Ordering::Relaxed);
        log::info!("关闭串口 {}", p.name);
    }
    Ok(())
}

#[tauri::command]
pub fn serial_set_signals(state: State<'_, SharedSerial>, dtr: Option<bool>, rts: Option<bool>) -> CmdResult<()> {
    let mut guard = state.port.lock().unwrap();
    let port = guard.as_mut().ok_or("串口未打开")?;
    if let Some(v) = dtr {
        port.writer.write_data_terminal_ready(v).err_str()?;
    }
    if let Some(v) = rts {
        port.writer.write_request_to_send(v).err_str()?;
    }
    Ok(())
}
