//! MQTT 调试客户端（rumqttc）：连接、订阅、发布，收到的消息推给前端。

use std::sync::Arc;
use std::time::Duration;

use base64::Engine;
use rumqttc::{AsyncClient, Event, MqttOptions, Packet, QoS, TlsConfiguration, Transport};
use serde::Deserialize;
use serde_json::json;
use tauri::async_runtime::JoinHandle;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Mutex;

use crate::util::{expand_tilde, now_ms, CmdResult, ErrStr};

#[derive(Default)]
pub struct MqttState {
    client: Mutex<Option<AsyncClient>>,
    task: Mutex<Option<JoinHandle<()>>>,
    /// 每次连接递增，旧连接的事件带旧编号，前端据此丢弃
    generation: Mutex<u64>,
}
pub type SharedMqtt = Arc<MqttState>;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MqttConnectRequest {
    pub host: String,
    pub port: u16,
    pub client_id: String,
    pub username: String,
    pub password: String,
    pub keep_alive: u64,
    pub clean: bool,
    pub tls: bool,
    /// CA 证书文件路径（PEM）；为空时使用系统根证书
    pub ca: String,
}

fn qos(q: u8) -> QoS {
    match q {
        0 => QoS::AtMostOnce,
        2 => QoS::ExactlyOnce,
        _ => QoS::AtLeastOnce,
    }
}

fn b64() -> base64::engine::GeneralPurpose {
    base64::engine::general_purpose::STANDARD
}

#[tauri::command]
pub async fn mqtt_connect(app: AppHandle, state: State<'_, SharedMqtt>, req: MqttConnectRequest) -> CmdResult<u64> {
    disconnect_inner(&state).await;
    let gen = {
        let mut g = state.generation.lock().await;
        *g += 1;
        *g
    };
    let host = req.host.trim().trim_start_matches("mqtt://").trim_start_matches("mqtts://").to_string();
    if host.is_empty() {
        return Err("请填写服务器地址".into());
    }
    let client_id = if req.client_id.trim().is_empty() { format!("luatos_flasher_{}", now_ms() % 1_000_000) } else { req.client_id.clone() };
    let mut opts = MqttOptions::new(client_id, host, req.port);
    opts.set_keep_alive(Duration::from_secs(req.keep_alive.clamp(5, 3600)));
    opts.set_clean_session(req.clean);
    opts.set_max_packet_size(1024 * 1024, 1024 * 1024);
    if !req.username.is_empty() {
        opts.set_credentials(req.username.clone(), req.password.clone());
    }
    if req.tls {
        let tls = if req.ca.trim().is_empty() {
            TlsConfiguration::Native
        } else {
            let ca = std::fs::read(expand_tilde(&req.ca)).err_ctx("读取 CA 证书失败")?;
            TlsConfiguration::SimpleNative { ca, client_auth: None }
        };
        opts.set_transport(Transport::tls_with_config(tls));
    }

    let (client, mut eventloop) = AsyncClient::new(opts, 256);
    let _ = app.emit("mqtt-event", json!({ "gen": gen, "kind": "connecting" }));
    let app2 = app.clone();
    let task = tauri::async_runtime::spawn(async move {
        let mut connected = false;
        loop {
            match eventloop.poll().await {
                Ok(Event::Incoming(Packet::ConnAck(ack))) => {
                    connected = true;
                    let _ = app2.emit("mqtt-event", json!({ "gen": gen, "kind": "connected", "code": format!("{:?}", ack.code) }));
                }
                Ok(Event::Incoming(Packet::Publish(p))) => {
                    let _ = app2.emit(
                        "mqtt-event",
                        json!({
                            "gen": gen,
                            "kind": "message",
                            "topic": p.topic,
                            "payload": b64().encode(&p.payload),
                            "qos": p.qos as u8,
                            "retain": p.retain,
                        }),
                    );
                }
                Ok(Event::Incoming(Packet::SubAck(s))) => {
                    let _ = app2.emit("mqtt-event", json!({ "gen": gen, "kind": "suback", "pkid": s.pkid, "codes": format!("{:?}", s.return_codes) }));
                }
                Ok(Event::Incoming(Packet::Disconnect)) => {
                    let _ = app2.emit("mqtt-event", json!({ "gen": gen, "kind": "disconnected", "error": "服务器断开了连接" }));
                    break;
                }
                Ok(_) => {}
                Err(e) => {
                    let msg = match &e {
                        rumqttc::ConnectionError::ConnectionRefused(code) => format!("服务器拒绝连接：{code:?}（检查用户名/密码/Client ID）"),
                        rumqttc::ConnectionError::Io(io) => format!("网络错误：{io}"),
                        other => other.to_string(),
                    };
                    let _ = app2.emit(
                        "mqtt-event",
                        json!({ "gen": gen, "kind": "disconnected", "error": msg, "wasConnected": connected }),
                    );
                    break;
                }
            }
        }
    });
    *state.client.lock().await = Some(client);
    *state.task.lock().await = Some(task);
    Ok(gen)
}

async fn disconnect_inner(state: &SharedMqtt) {
    if let Some(c) = state.client.lock().await.take() {
        let _ = tokio::time::timeout(Duration::from_millis(500), c.disconnect()).await;
    }
    if let Some(t) = state.task.lock().await.take() {
        t.abort();
    }
}

#[tauri::command]
pub async fn mqtt_disconnect(state: State<'_, SharedMqtt>) -> CmdResult<()> {
    disconnect_inner(&state).await;
    Ok(())
}

async fn client(state: &SharedMqtt) -> CmdResult<AsyncClient> {
    state.client.lock().await.clone().ok_or_else(|| "MQTT 未连接".to_string())
}

#[tauri::command]
pub async fn mqtt_subscribe(state: State<'_, SharedMqtt>, topic: String, qos_level: u8) -> CmdResult<()> {
    client(&state).await?.subscribe(topic, qos(qos_level)).await.err_ctx("订阅失败")
}

#[tauri::command]
pub async fn mqtt_unsubscribe(state: State<'_, SharedMqtt>, topic: String) -> CmdResult<()> {
    client(&state).await?.unsubscribe(topic).await.err_ctx("取消订阅失败")
}

#[tauri::command]
pub async fn mqtt_publish(state: State<'_, SharedMqtt>, topic: String, payload: String, qos_level: u8, retain: bool) -> CmdResult<()> {
    if topic.is_empty() || topic.contains('+') || topic.contains('#') {
        return Err("发布主题不能为空，也不能包含通配符 + 或 #".into());
    }
    let bytes = b64().decode(payload).err_ctx("内容格式错误")?;
    client(&state).await?.publish(topic, qos(qos_level), retain, bytes).await.err_ctx("发布失败")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 联网测试：连接环境变量 MQTT_TEST_HOST 指定的服务器（明文 1883），订阅随机测试主题，自己发一条（不保留）再收回来。
    /// MQTT_TEST_HOST=broker.emqx.io cargo test mqtt -- --ignored
    #[tokio::test]
    #[ignore]
    async fn loopback_on_test_broker() {
        let Ok(host) = std::env::var("MQTT_TEST_HOST") else {
            eprintln!("skip: 没有设置 MQTT_TEST_HOST");
            return;
        };
        let topic = format!("luatos-flasher/selftest/{}", now_ms());
        let mut opts = MqttOptions::new(format!("luatos_flasher_test_{}", now_ms() % 100000), host, 1883);
        opts.set_keep_alive(Duration::from_secs(10));
        let (client, mut el) = AsyncClient::new(opts, 16);
        let deadline = tokio::time::Instant::now() + Duration::from_secs(15);
        let mut got = false;
        while tokio::time::Instant::now() < deadline {
            match tokio::time::timeout(Duration::from_secs(5), el.poll()).await {
                Ok(Ok(Event::Incoming(Packet::ConnAck(_)))) => {
                    client.subscribe(topic.clone(), QoS::AtLeastOnce).await.unwrap();
                }
                Ok(Ok(Event::Incoming(Packet::SubAck(_)))) => {
                    client.publish(topic.clone(), QoS::AtLeastOnce, false, b"ping".to_vec()).await.unwrap();
                }
                Ok(Ok(Event::Incoming(Packet::Publish(p)))) if p.topic == topic => {
                    assert_eq!(&p.payload[..], b"ping");
                    got = true;
                    break;
                }
                Ok(Ok(_)) => {}
                Ok(Err(e)) => panic!("MQTT 错误：{e}"),
                Err(_) => {}
            }
        }
        let _ = client.disconnect().await;
        assert!(got, "没有收到自己发出的消息");
    }
}
