//! LuatOS 烧录器 —— Tauri 后端入口。
//!
//! 模块：
//!   devices  串口扫描与合宙模组识别（运行态 / 下载态）
//!   cli      调用内置 luatos-cli 刷机、看日志、量产、FOTA
//!   firmware 合宙 CDN 固件资源列表/下载/缓存，.soc 解析
//!   projects 项目清单、文件读写、LuaTools .ini 导入、.luatos 包、Lua 语法检查
//!   serial   串口调试助手
//!   mqtt     MQTT 调试客户端
//!   doctor   环境诊断

mod cli;
mod devices;
mod doctor;
mod firmware;
mod mqtt;
mod projects;
mod serial;
mod util;

use std::sync::Arc;

pub fn run() {
    let device_state: devices::SharedDevices = Arc::new(devices::DeviceState::default());
    use tauri_plugin_log::{Target, TargetKind};
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .max_file_size(5_000_000)
                .targets([
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::LogDir { file_name: Some("luatos-flasher".into()) }),
                    Target::new(TargetKind::Webview),
                ])
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .manage(device_state.clone())
        .manage::<cli::SharedCli>(Arc::new(cli::CliState::default()))
        .manage::<firmware::SharedFirmware>(Arc::new(firmware::FirmwareState::default()))
        .manage::<serial::SharedSerial>(Arc::new(serial::SerialState::default()))
        .manage::<mqtt::SharedMqtt>(Arc::new(mqtt::MqttState::default()))
        .setup(move |app| {
            log::info!("LuatOS 烧录器 {} 启动，{} {}", app.package_info().version, std::env::consts::OS, std::env::consts::ARCH);
            devices::start_watcher(app.handle().clone(), device_state.clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            devices::list_devices,
            devices::list_serial_ports,
            cli::cli_version,
            cli::flash_start,
            cli::flash_cancel,
            cli::devlog_start,
            cli::devlog_stop,
            cli::device_reboot,
            cli::make_production,
            cli::make_fota,
            firmware::fw_versions,
            firmware::fw_builds,
            firmware::fw_cache_dir,
            firmware::fw_cached,
            firmware::fw_download,
            firmware::fw_delete,
            firmware::soc_info,
            firmware::soc_read_text,
            projects::project_list,
            projects::project_save,
            projects::project_remove,
            projects::project_create,
            projects::project_open_dir,
            projects::project_clone,
            projects::project_import_ini,
            projects::project_export,
            projects::project_import_pkg,
            projects::files_stat,
            projects::read_text,
            projects::read_bytes,
            projects::write_text,
            projects::dir_files,
            projects::lua_check,
            serial::serial_open,
            serial::serial_write,
            serial::serial_close,
            serial::serial_set_signals,
            mqtt::mqtt_connect,
            mqtt::mqtt_disconnect,
            mqtt::mqtt_subscribe,
            mqtt::mqtt_unsubscribe,
            mqtt::mqtt_publish,
            doctor::app_info,
            doctor::log_dir,
            doctor::run_doctor,
        ])
        .build(tauri::generate_context!())
        .expect("LuatOS 烧录器启动失败")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                use tauri::Manager;
                cli::kill_log_on_exit(&app.state::<cli::SharedCli>());
            }
        });
}
