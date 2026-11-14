/** 界面使用的数据类型和默认值（取代 Figma Make 原型里的 mock.ts） */
import type { CoreRef } from '../lib/api'

export type { CoreRef }

export type DeviceStatus = 'running' | 'boot' | 'offline'

export interface Device {
  id: string
  /** 从开机日志里识别到的型号；未知时为空 */
  model: string
  port: string
  status: DeviceStatus
  imei: string
  logPort: string | null
  userPort: string | null
  bootPort: string | null
  ports: string[]
}

export const OFFLINE_DEVICE: Device = {
  id: 'none',
  model: '',
  port: '',
  status: 'offline',
  imei: '',
  logPort: null,
  userPort: null,
  bootPort: null,
  ports: [],
}

export interface ProjectFile {
  name: string
  type: 'script' | 'resource'
  size: number
  path: string
  exists: boolean
}

export interface DownloadOptions {
  logPort: 'usb' | 'uart1' | 'uart2'
  debugInfo: 'all' | 'line' | 'var' | 'none'
  ignoreDeps: boolean
  clearFs: boolean
  clearKv: boolean
  burnFs: boolean
  burnFsPath: string
  listenAfter: boolean
}

export const defaultOptions: DownloadOptions = {
  logPort: 'usb',
  debugInfo: 'all',
  ignoreDeps: true,
  clearFs: false,
  clearKv: false,
  burnFs: false,
  burnFsPath: '',
  listenAfter: true,
}

/** luatos-cli --luac-debug 取值 */
export const LUAC_DEBUG: Record<DownloadOptions['debugInfo'], number> = { all: 99, line: 1, var: 2, none: 0 }

export interface Project {
  id: string
  name: string
  version: string
  model: string
  core: CoreRef
  dir: string
  files: ProjectFile[]
  lastDownload: number | null
  options: DownloadOptions
}

/* ---------------------------------------------------------------- 新建项目模板 */

const header = (name: string) => `-- LuaTools 和远程升级需要 PROJECT 和 VERSION 两个变量
PROJECT = "${name}"
VERSION = "001.000.000"

log.info("main", PROJECT, VERSION)
`

const footer = `
-- 用户代码已结束 ---------------------------------------------
-- 结尾总是这一句
sys.run()
-- sys.run() 之后不要加任何语句
`

export const templates: Record<'empty' | 'hello' | 'mqtt', (name: string) => { name: string; content: string }[]> = {
  empty: (name) => [{ name: 'main.lua', content: `${header(name)}\n-- 在这里编写代码\n${footer}` }],
  hello: (name) => [
    {
      name: 'main.lua',
      content: `${header(name)}
-- 每 3 秒打印一次
sys.timerLoopStart(function()
    log.info("hello", "LuatOS", os.date())
end, 3000)
${footer}`,
    },
  ],
  mqtt: (name) => [
    {
      name: 'main.lua',
      content: `${header(name)}
-- 改成你自己的 MQTT 服务器。只想试试的话，可以用 EMQX 的公共测试服务器 broker.emqx.io（所有人共用，别发敏感数据）
local HOST, PORT = "your.mqtt.server", 1883

sys.taskInit(function()
    -- 等待联网
    while not socket.adapter(socket.dft()) do
        sys.waitUntil("IP_READY", 1000)
    end
    local imei = mobile.imei()
    local client = mqtt.create(nil, HOST, PORT)
    client:auth(imei, "", "", true)
    client:keepalive(120)
    client:on(function(c, event, topic, payload)
        if event == "conack" then
            c:subscribe("demo/" .. imei .. "/down", 1)
        elseif event == "recv" then
            log.info("mqtt", "recv", topic, payload)
        end
    end)
    client:connect()
    while true do
        sys.wait(5000)
        client:publish("demo/" .. imei .. "/up", json.encode({ t = os.time() }), 1)
    end
end)
${footer}`,
    },
  ],
}

/* ---------------------------------------------------------------- 串口 / MQTT 默认值 */

export interface QuickCmd {
  id: string
  name: string
  content: string
  hex?: boolean
}

export const defaultQuickCmds: QuickCmd[] = [
  { id: 'q1', name: 'AT 握手', content: 'AT' },
  { id: 'q2', name: '信号质量', content: 'AT+CSQ' },
  { id: 'q3', name: '查询 IMEI', content: 'AT+CGSN' },
  { id: 'q4', name: '固件版本', content: 'ATI' },
]

export interface MqttConn {
  id: string
  name: string
  protocol: 'mqtt://' | 'mqtts://'
  host: string
  port: number
  clientId: string
  username: string
  password: string
  keepAlive: number
  clean: boolean
  tls: boolean
  ca: string
}

export const defaultConns: MqttConn[] = [
  {
    id: 'c1',
    name: '新连接',
    protocol: 'mqtt://',
    host: '',
    port: 1883,
    clientId: `luatos_flasher_${Math.random().toString(16).slice(2, 8)}`,
    username: '',
    password: '',
    keepAlive: 60,
    clean: true,
    tls: false,
    ca: '',
  },
]

export const SUB_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777']

/* ---------------------------------------------------------------- localStorage */

export function loadLocal<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(`fw.${key}`)
    return v ? (JSON.parse(v) as T) : fallback
  } catch {
    return fallback
  }
}

export function saveLocal(key: string, value: unknown) {
  try {
    localStorage.setItem(`fw.${key}`, JSON.stringify(value))
  } catch {
    /* 存不了就算了，只是偏好设置 */
  }
}
