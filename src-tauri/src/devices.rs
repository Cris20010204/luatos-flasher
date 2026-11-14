//! USB 设备发现：后台线程每 800ms 扫描串口，识别合宙 EC7xx 模组的运行态与下载态。
//!
//! EC718 运行时是 USB 复合设备（VID 0x19D1 / PID 0x0001），有 3 个 CDC 口：
//!   接口 2/3 = SOC 日志 + 命令口，接口 4/5 = AP 日志口，接口 6/7 = 用户虚拟串口。
//! Windows 报的是通信接口号（2/4/6），macOS/Linux 报的是数据接口号（3/5/7）。
//! 进入下载模式后会重新枚举为 VID 0x17D1 / PID 0x0001。

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use serialport::{SerialPortInfo, SerialPortType};
use tauri::{AppHandle, Emitter, State};

pub const RUN_VID: u16 = 0x19D1;
pub const BOOT_VID: u16 = 0x17D1;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub id: String,
    /// running = 正常运行，boot = 下载模式
    pub status: String,
    /// 界面上显示的主端口：运行态为日志口，下载态为下载口
    pub port: String,
    pub log_port: Option<String>,
    pub ap_port: Option<String>,
    pub user_port: Option<String>,
    pub boot_port: Option<String>,
    pub ports: Vec<String>,
    pub serial: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SerialPortItem {
    pub name: String,
    pub desc: String,
    pub vid: Option<u16>,
    pub pid: Option<u16>,
}

#[derive(Default)]
pub struct DeviceState {
    pub devices: Mutex<Vec<Device>>,
}

pub type SharedDevices = Arc<DeviceState>;

fn list_ports() -> Vec<SerialPortInfo> {
    let mut ports = serialport::available_ports().unwrap_or_default();
    // macOS 同时有 /dev/cu.* 与 /dev/tty.*，只保留 cu（打开时不等载波）
    if cfg!(target_os = "macos") {
        ports.retain(|p| !p.port_name.starts_with("/dev/tty."));
    }
    ports.sort_by(|a, b| a.port_name.cmp(&b.port_name));
    ports
}

/// 运行态的多个 CDC 口要归到同一台设备。macOS 端口名形如
/// /dev/cu.usbmodem1101、1103、1105，去掉最后一位数字后相同即为同一台。
fn group_key(info: &SerialPortInfo, serial: &Option<String>) -> String {
    if cfg!(any(target_os = "macos", target_os = "linux")) {
        let name = info.port_name.trim_end_matches(|c: char| c.is_ascii_digit());
        let digits: String = info.port_name[name.len()..].chars().collect();
        if digits.len() >= 2 {
            return format!("{}{}", name, &digits[..digits.len() - 1]);
        }
        return info.port_name.clone();
    }
    // Windows 拿不到位置信息，只能按序列号归组
    serial.clone().unwrap_or_else(|| "ec718".to_string())
}

fn iface_is(reported: Option<u8>, target: u8) -> bool {
    matches!(reported, Some(i) if i == target || i == target + 1)
}

pub fn scan() -> (Vec<Device>, Vec<SerialPortItem>) {
    let ports = list_ports();
    let mut groups: BTreeMap<String, Device> = BTreeMap::new();
    let mut boot: Vec<Device> = Vec::new();
    let mut serial_items = Vec::new();

    for p in &ports {
        let (vid, pid, desc) = match &p.port_type {
            SerialPortType::UsbPort(u) => (
                Some(u.vid),
                Some(u.pid),
                u.product.clone().or(u.manufacturer.clone()).unwrap_or_else(|| "USB 串口".into()),
            ),
            SerialPortType::PciPort => (None, None, "PCI 串口".into()),
            SerialPortType::BluetoothPort => (None, None, "蓝牙串口".into()),
            SerialPortType::Unknown => (None, None, "串口".into()),
        };
        let mut desc = desc;
        if let SerialPortType::UsbPort(u) = &p.port_type {
            if u.vid == RUN_VID {
                desc = match u.interface {
                    i if iface_is(i, 2) => "合宙模组 · SOC 日志/命令口".into(),
                    i if iface_is(i, 4) => "合宙模组 · AP 日志口".into(),
                    i if iface_is(i, 6) => "合宙模组 · 用户虚拟串口".into(),
                    _ => "合宙模组 · USB 串口".into(),
                };
            } else if u.vid == BOOT_VID {
                desc = "合宙模组 · 下载口".into();
            }
        }
        serial_items.push(SerialPortItem { name: p.port_name.clone(), desc, vid, pid });

        let SerialPortType::UsbPort(u) = &p.port_type else { continue };
        if u.vid == RUN_VID {
            let key = group_key(p, &u.serial_number);
            let d = groups.entry(key.clone()).or_insert_with(|| Device {
                id: format!("run:{key}"),
                status: "running".into(),
                port: String::new(),
                log_port: None,
                ap_port: None,
                user_port: None,
                boot_port: None,
                ports: vec![],
                serial: u.serial_number.clone(),
            });
            d.ports.push(p.port_name.clone());
            if iface_is(u.interface, 2) {
                d.log_port = Some(p.port_name.clone());
            } else if iface_is(u.interface, 4) {
                d.ap_port = Some(p.port_name.clone());
            } else if iface_is(u.interface, 6) {
                d.user_port = Some(p.port_name.clone());
            }
        } else if u.vid == BOOT_VID {
            boot.push(Device {
                id: format!("boot:{}", p.port_name),
                status: "boot".into(),
                port: p.port_name.clone(),
                log_port: None,
                ap_port: None,
                user_port: None,
                boot_port: Some(p.port_name.clone()),
                ports: vec![p.port_name.clone()],
                serial: u.serial_number.clone(),
            });
        }
    }

    let mut devices: Vec<Device> = groups
        .into_values()
        .map(|mut d| {
            // 接口号拿不到时（老驱动），按端口顺序兜底：第一个当日志口
            if d.log_port.is_none() {
                d.log_port = d.ports.first().cloned();
            }
            d.port = d.log_port.clone().unwrap_or_default();
            d
        })
        .collect();
    devices.extend(boot);
    (devices, serial_items)
}

/// 后台扫描线程，设备列表变化时推送 `devices-changed` 事件。
pub fn start_watcher(app: AppHandle, state: SharedDevices) {
    std::thread::spawn(move || loop {
        let (devices, _) = scan();
        let changed = {
            let mut cur = state.devices.lock().unwrap();
            if *cur != devices {
                *cur = devices.clone();
                true
            } else {
                false
            }
        };
        if changed {
            if devices.is_empty() {
                log::info!("设备：没有合宙模组");
            }
            for d in &devices {
                log::info!("设备：{} {} 日志口={:?} 用户口={:?} 全部={:?}", d.status, d.id, d.log_port, d.user_port, d.ports);
            }
            let _ = app.emit("devices-changed", &devices);
        }
        std::thread::sleep(Duration::from_millis(800));
    });
}

#[tauri::command]
pub fn list_devices(state: State<'_, SharedDevices>) -> Vec<Device> {
    state.devices.lock().unwrap().clone()
}

#[tauri::command]
pub fn list_serial_ports() -> Vec<SerialPortItem> {
    scan().1
}
