/**
 * 浏览器演示模式：`pnpm dev` 后打开 http://localhost:1420/?demo
 *
 * 没有 Tauri 后端时，用这里的假数据把每个页面跑起来：一台假的 Air780EHM、两个示例项目、
 * 滚动的设备日志、能收发消息的 MQTT、会回 AT 的串口、走完全程的下载进度。
 * 用来截图、给新人看界面、改界面时不用接模组。数据全是编的，IMEI 等都不是真实设备。
 */
import type { BackendDevice, CachedFw, Check, DevlogEntry, FileStat, FwBuild, FwVersion, ProjectRec, SocInfo } from './api'

export const isDemo = typeof window !== 'undefined' && !('__TAURI_INTERNALS__' in window) && /[?&]demo\b/.test(window.location?.search ?? '')

/**
 * 演示模式的网址参数（截图脚本 scripts/screenshots.mjs 用）：
 *   page=code|logs|mqtt|…   打开哪一页        project=demo-hello   选中哪个项目
 *   file=main.lua           打开哪个文件      dock=bottom|right    日志面板停靠位置
 *   theme=dark|light        主题              mqtt=1               自动连接 MQTT
 *   flash=full|script       自动开始一次下载
 */
export function demoParam(name: string): string | null {
  return isDemo ? new URLSearchParams(window.location?.search ?? '').get(name) : null
}
if (isDemo) {
  try {
    const seed = (key: string, v: unknown) => localStorage.setItem(`fw.${key}`, JSON.stringify(v))
    const project = demoParam('project')
    const theme = demoParam('theme')
    const dock = demoParam('dock')
    if (project) seed('project', project)
    if (theme) seed('theme', theme)
    if (dock) seed('logDock', { open: true, side: dock, size: 230 })
  } catch {
    /* 没有 localStorage 就算了 */
  }
}

/* ---------------------------------------------------------------- 事件 */

type Fn = (payload: unknown) => void
const listeners = new Map<string, Set<Fn>>()

export function demoOn(event: string, fn: Fn): () => void {
  if (!listeners.has(event)) listeners.set(event, new Set())
  listeners.get(event)!.add(fn)
  return () => listeners.get(event)?.delete(fn)
}
function emit(event: string, payload: unknown) {
  listeners.get(event)?.forEach((fn) => fn(payload))
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const b64 = (s: string) => {
  const bytes = new TextEncoder().encode(s)
  let out = ''
  bytes.forEach((b) => (out += String.fromCharCode(b)))
  return btoa(out)
}

/* ---------------------------------------------------------------- 假数据 */

const HOME = '/Users/demo'
const ROOT = `${HOME}/LuatOS`
const DATA = `${HOME}/Library/Application Support/io.github.cris20010204.luatos-flasher`
const IMEI = '860000000000001'

const DEVICE: BackendDevice = {
  id: 'usb-demo-1',
  status: 'running',
  port: '/dev/cu.usbmodem1101',
  logPort: '/dev/cu.usbmodem1103',
  apPort: '/dev/cu.usbmodem1105',
  userPort: '/dev/cu.usbmodem1107',
  bootPort: null,
  ports: ['/dev/cu.usbmodem1101', '/dev/cu.usbmodem1103', '/dev/cu.usbmodem1105', '/dev/cu.usbmodem1107'],
  serial: null,
}

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
const FILES: Record<string, string> = {
  [`${ROOT}/hello_luatos/main.lua`]: `${header('hello_luatos')}
local sensor = require "sensor"

-- 每秒读一次传感器并打印
sys.taskInit(function()
    sensor.init()
    while true do
        local t, h = sensor.read()
        log.info("sensor", "temp", t, "humi", h)
        sys.wait(1000)
    end
end)

-- 每 3 秒打印一次
sys.timerLoopStart(function()
    log.info("hello", "LuatOS", os.date())
end, 3000)
${footer}`,
  [`${ROOT}/hello_luatos/sensor.lua`]: `-- 一个假的温湿度传感器模块，演示多文件项目
local sensor = {}

function sensor.init()
    log.info("sensor", "init ok")
end

function sensor.read()
    return 24 + math.random() * 3, 50 + math.random() * 10
end

return sensor
`,
  [`${ROOT}/mqtt_demo/main.lua`]: `${header('mqtt_demo')}
-- 改成你自己的 MQTT 服务器
local HOST, PORT = "your.mqtt.server", 1883

sys.taskInit(function()
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
        client:publish("demo/" .. imei .. "/up", json.encode({ t = os.time(), csq = mobile.csq() }), 1)
    end
end)
${footer}`,
}

const OPTIONS = { burnFs: false, burnFsPath: '', clearFs: false, clearKv: false, debugInfo: 'all', ignoreDeps: true, listenAfter: true, logPort: 'usb' }
let projects: ProjectRec[] = [
  {
    id: 'demo-hello',
    name: 'hello_luatos',
    version: '001.000.000',
    model: 'Air780EHM',
    core: { source: 'resource', version: 'V2056', build: 112, file: 'LuatOS-SoC_V2056_Air780EHM_112.soc', localPath: '' },
    dir: `${ROOT}/hello_luatos`,
    files: [`${ROOT}/hello_luatos/main.lua`, `${ROOT}/hello_luatos/sensor.lua`],
    options: OPTIONS,
    lastDownload: Date.now() - 42 * 60_000,
    createdAt: Date.now() - 3 * 86_400_000,
  },
  {
    id: 'demo-mqtt',
    name: 'mqtt_demo',
    version: '001.000.000',
    model: 'Air780EG',
    core: { source: 'resource', version: 'V1124', build: 0, file: 'LuatOS-SoC_V1124_EC618.soc', localPath: '' },
    dir: `${ROOT}/mqtt_demo`,
    files: [`${ROOT}/mqtt_demo/main.lua`],
    options: OPTIONS,
    lastDownload: null,
    createdAt: Date.now() - 86_400_000,
  },
]

const isEc618 = (model: string) => /^Air780EG?$/.test(model)
function versions(model: string): FwVersion[] {
  return isEc618(model)
    ? [{ version: 'V1124', date: '2025-11-26' }, { version: 'V1123', date: '2025-08-14' }, { version: 'V1122', date: '2025-05-20' }]
    : [{ version: 'V2056', date: '2026-11-05' }, { version: 'V2055', date: '2026-09-18' }, { version: 'V2054', date: '2026-07-02' }]
}
function builds(model: string, version: string): FwBuild[] {
  if (isEc618(model)) {
    return ['', '_FULL', '_TTS'].map((v) => ({ build: null, file: `LuatOS-SoC_${version}_EC618${v}.soc`, size: 3_100_000, date: '2025-11-26', url: '', zip: `core_${version}.zip` }))
  }
  return [101, 103, 105, 106, 108, 110, 112, 114, 115, 118, 121, 124].map((n) => ({
    build: n,
    file: `LuatOS-SoC_${version}_${model}_${n}.soc`,
    size: 2_900_000 + n * 1000,
    date: '2026-11-05',
    url: '',
    zip: null,
  }))
}
const cached: CachedFw[] = [
  { key: 'Air780EHM/V2056/LuatOS-SoC_V2056_Air780EHM_112.soc', model: 'Air780EHM', version: 'V2056', file: 'LuatOS-SoC_V2056_Air780EHM_112.soc', build: 112, path: `${DATA}/firmware/Air780EHM/V2056/LuatOS-SoC_V2056_Air780EHM_112.soc`, size: 3_012_000 },
  { key: 'Air780EG/V1124/LuatOS-SoC_V1124_EC618.soc', model: 'Air780EG', version: 'V1124', file: 'LuatOS-SoC_V1124_EC618.soc', build: null, path: `${DATA}/firmware/Air780EG/V1124/LuatOS-SoC_V1124_EC618.soc`, size: 3_100_000 },
]
function socInfo(path: string): SocInfo {
  const file = path.split('/').pop() ?? path
  return file.includes('EC618')
    ? { chip: 'EC618', chipType: 'ec618', bits: 32, scriptAddr: '2CC000', scriptKb: 128, fsKb: 288, fwNum: null, useLuac: true, size: 3_100_000, file }
    : { chip: 'EC718HM', chipType: 'ec7xx', bits: 64, scriptAddr: '2CE000', scriptKb: 512, fsKb: 1024, fwNum: 112, useLuac: true, size: 3_012_000, file }
}

/* ---------------------------------------------------------------- 设备日志 */

let logTimer: ReturnType<typeof setInterval> | null = null
let logSeq = 0
function logLine(level: string, module: string, message: string) {
  const e: DevlogEntry = { timestamp: new Date().toISOString(), device_time: null, level, module, message }
  emit('devlog', e)
}
function startLog() {
  stopLog(false)
  emit('devlog-state', { running: true })
  const boot: [string, string, string][] = [
    ['Info', 'pm', 'poweron: Power/Reset'],
    ['Info', 'main', 'LuatOS@EC718HM base 25.11 bsp V2056 64bit'],
    ['Info', 'main', 'firmware LuatOS-SoC_V2056_Air780EHM_112'],
    ['Info', '', '+FW: LuatOS V2056 112 64bit'],
    ['Info', 'user.main', 'hello_luatos 001.000.000'],
    ['Info', 'mobile', `imei ${IMEI}`],
    ['Debug', 'mobile', 'sim0 ready, apn auto'],
    ['Info', 'mobile', 'NETIF_LINK_ON -> IP_READY'],
    ['Info', 'mobile', 'csq 24 rsrp -86 rsrq -9 snr 12'],
    ['Info', 'user.sensor', 'init ok'],
  ]
  boot.forEach(([lv, m, msg], i) => setTimeout(() => logLine(lv, m, msg), 80 * i))
  logTimer = setInterval(() => {
    logSeq++
    const temp = (24 + Math.random() * 3).toFixed(2)
    const humi = (50 + Math.random() * 10).toFixed(1)
    logLine('Info', 'user.sensor', `temp ${temp} humi ${humi}`)
    if (logSeq % 3 === 0) logLine('Info', 'user.hello', `LuatOS ${new Date().toLocaleString('zh-CN', { hour12: false })}`)
    if (logSeq % 5 === 0) logLine('Info', 'user.mqtt', `pub demo/${IMEI}/up {"seq":${logSeq / 5},"csq":24}`)
    if (logSeq % 11 === 0) logLine('Warn', 'user.sensor', 'read timeout, retry')
  }, 1000)
}
function stopLog(notify = true) {
  if (logTimer) clearInterval(logTimer)
  logTimer = null
  if (notify) emit('devlog-state', { running: false })
}

/* ---------------------------------------------------------------- MQTT */

let mqttGen = 0
let mqttTimer: ReturnType<typeof setInterval> | null = null
const mqttSubs = new Set<string>()
const match = (filter: string, topic: string) => {
  const f = filter.split('/')
  const t = topic.split('/')
  for (let i = 0; i < f.length; i++) {
    if (f[i] === '#') return true
    if (i >= t.length || (f[i] !== '+' && f[i] !== t[i])) return false
  }
  return f.length === t.length
}
function mqttMessage(gen: number, topic: string, payload: string, qos = 1, retain = false) {
  if ([...mqttSubs].some((f) => match(f, topic))) emit('mqtt-event', { gen, kind: 'message', topic, payload: b64(payload), qos, retain })
}

// 演示用的连接和订阅（只在演示模式、且浏览器里还没有保存过时写入）
if (isDemo) {
  try {
    if (!localStorage.getItem('fw.mqttConns')) {
      localStorage.setItem(
        'fw.mqttConns',
        JSON.stringify([{ id: 'c1', name: '演示服务器', protocol: 'mqtt://', host: 'mqtt.example.com', port: 1883, clientId: 'luatos_flasher_demo', username: '', password: '', keepAlive: 60, clean: true, tls: false, ca: '' }]),
      )
      localStorage.setItem(
        'fw.mqttSubs',
        JSON.stringify([
          { id: 's1', topic: 'demo/+/up', qos: 1, color: '#2563eb', paused: false },
          { id: 's2', topic: 'demo/+/down', qos: 1, color: '#16a34a', paused: false },
        ]),
      )
    }
  } catch {
    /* 没有 localStorage 就算了 */
  }
}

/* ---------------------------------------------------------------- 命令 */

const doctor: Check[] = [
  { id: 'cli', status: 'ok', title: 'luatos-cli', detail: '1.11.0（演示模式）' },
  { id: 'usb', status: 'ok', title: 'USB 设备', detail: '发现 1 个合宙模组：Air780EHM（运行中）' },
  { id: 'fw', status: 'ok', title: '固件缓存', detail: '2 个固件，共 5.8 MB' },
  { id: 'net', status: 'ok', title: '合宙固件服务器', detail: 'cdn18.luatos.com 可以访问' },
  { id: 'driver', status: 'warn', title: 'USB 驱动', detail: 'Windows 上可能要装合宙 USB 驱动；macOS 不需要' },
]

export async function demoCall<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  await sleep(60)
  const r = (v: unknown) => v as T
  switch (cmd) {
    case 'app_info':
      return r({ version: '0.1.0', os: 'macos', arch: 'aarch64', dataDir: DATA, projectsRoot: ROOT })
    case 'cli_version':
      return r('1.11.0')
    case 'log_dir':
      return r(`${HOME}/Library/Logs/io.github.cris20010204.luatos-flasher`)
    case 'run_doctor':
      return r(doctor)
    case 'list_devices':
      return r([DEVICE])
    case 'list_serial_ports':
      return r([
        ...DEVICE.ports.map((name, i) => ({ name, desc: `Air780EHM 接口 ${i}`, vid: 0x19d1, pid: 0x0001 })),
        { name: '/dev/cu.usbserial-1410', desc: 'USB-SERIAL CH340', vid: 0x1a86, pid: 0x7523 },
      ])

    case 'project_list':
      return r(projects)
    case 'project_save': {
      const rec = args.rec as ProjectRec
      projects = projects.map((p) => (p.id === rec.id ? rec : p))
      return r(rec)
    }
    case 'project_remove':
      projects = projects.filter((p) => p.id !== args.id)
      return r(undefined)
    case 'files_stat':
      return r(
        (args.paths as string[]).map<FileStat>((path) => ({
          path,
          name: path.split('/').pop() ?? path,
          size: FILES[path]?.length ?? 0,
          exists: path in FILES,
          isScript: path.endsWith('.lua'),
        })),
      )
    case 'read_text':
      return r(FILES[args.path as string] ?? '')
    case 'write_text':
      FILES[args.path as string] = args.content as string
      return r(undefined)
    case 'dir_files':
      return r(Object.keys(FILES).filter((p) => p.startsWith(`${args.dir}/`)))
    case 'lua_check':
      return r([])

    case 'fw_versions':
      return r(versions(args.model as string))
    case 'fw_builds':
      return r(builds(args.model as string, args.version as string))
    case 'fw_cached':
      return r(cached)
    case 'fw_cache_dir':
      return r(`${DATA}/firmware`)
    case 'soc_info':
      return r(socInfo(args.path as string))
    case 'fw_download': {
      const key = `${args.model}/${args.version}/${args.file}`
      for (let i = 1; i <= 10; i++) {
        await sleep(120)
        emit('fw-progress', { key, received: i * 300_000, total: 3_000_000 })
      }
      const fw: CachedFw = { key, model: String(args.model), version: String(args.version), file: String(args.file), build: null, path: `${DATA}/firmware/${key}`, size: 3_000_000 }
      if (!cached.some((c) => c.key === key)) cached.push(fw)
      return r(fw.path)
    }

    case 'devlog_start':
      startLog()
      return r(undefined)
    case 'devlog_stop':
      stopLog()
      return r(undefined)
    case 'device_reboot':
      stopLog()
      setTimeout(startLog, 1500)
      return r('ok')

    case 'flash_start':
      void demoFlash(args.req as { taskId: string; kind: string; scriptFiles: string[] })
      return r(undefined)
    case 'flash_cancel':
      return r(undefined)

    case 'serial_open':
      setTimeout(() => emit('serial-data', { port: (args.req as { port: string }).port, data: b64('\r\nRDY\r\n') }), 300)
      return r(undefined)
    case 'serial_write': {
      const text = atob(args.data as string)
      const reply = /AT\+CSQ/i.test(text) ? '+CSQ: 24,99\r\n\r\nOK\r\n' : /AT\+CGSN/i.test(text) ? `${IMEI}\r\n\r\nOK\r\n` : /ATI/i.test(text) ? 'AirM2M_780EHM\r\nLuatOS V2056\r\n\r\nOK\r\n' : '\r\nOK\r\n'
      setTimeout(() => emit('serial-data', { port: DEVICE.userPort, data: b64(reply) }), 120)
      return r(text.length)
    }
    case 'serial_close':
      return r(undefined)

    case 'mqtt_connect': {
      const gen = ++mqttGen
      mqttSubs.clear()
      if (mqttTimer) clearInterval(mqttTimer)
      setTimeout(() => emit('mqtt-event', { gen, kind: 'connecting' }), 50)
      setTimeout(() => emit('mqtt-event', { gen, kind: 'connected' }), 400)
      let seq = 0
      mqttTimer = setInterval(() => {
        seq++
        mqttMessage(gen, `demo/${IMEI}/up`, JSON.stringify({ seq, t: Math.floor(Date.now() / 1000), csq: 22 + (seq % 4), temp: +(24 + Math.random() * 3).toFixed(2) }))
      }, 2000)
      return r(gen)
    }
    case 'mqtt_disconnect':
      if (mqttTimer) clearInterval(mqttTimer)
      mqttTimer = null
      setTimeout(() => emit('mqtt-event', { gen: mqttGen, kind: 'disconnected' }), 50)
      return r(undefined)
    case 'mqtt_subscribe':
      mqttSubs.add(args.topic as string)
      setTimeout(() => emit('mqtt-event', { gen: mqttGen, kind: 'suback', topic: args.topic }), 50)
      return r(undefined)
    case 'mqtt_unsubscribe':
      mqttSubs.delete(args.topic as string)
      return r(undefined)
    case 'mqtt_publish': {
      const payload = new TextDecoder().decode(Uint8Array.from(atob(args.payload as string), (c) => c.charCodeAt(0)))
      setTimeout(() => mqttMessage(mqttGen, args.topic as string, payload, Number(args.qosLevel ?? 0), !!args.retain), 150)
      return r(undefined)
    }
  }
  // 其它命令（导出量产包、FOTA、导入工程等）演示模式里只给个失败提示
  throw new Error(`演示模式不支持：${cmd}`)
}

async function demoFlash(req: { taskId: string; kind: string; scriptFiles: string[] }) {
  const ev = (kind: string, data: Record<string, unknown>) => emit('flash-event', { taskId: req.taskId, kind, data })
  const progress = (stage: string, percent: number, message: string, region?: string) => ev('progress', { stage, percent, message, region })
  stopLog()
  ev('phase', { name: req.kind })
  progress('Preparing', 0, 'Parsing SOC file...')
  await sleep(300)
  progress('Rebooting', 2, '让模组重启进下载模式（AT+ECRST=delay,799）')
  await sleep(700)
  progress('Connecting', 5, 'Bootloader connected')
  await sleep(300)
  progress('AgentBoot', 6, 'Downloading agentboot (40696 bytes, 内置 ec718m_usb)...')
  await sleep(500)
  progress('AgentBoot', 15, 'AgentBoot loaded')
  const regions: [string, number][] = req.kind === 'script' ? [['script', 64]] : [['ap_bootloader', 114], ['ap', 2292], ['cp-demo-flash', 400], ['script', 64]]
  for (const [i, [region, kb]] of regions.entries()) {
    const base = 15 + (i / regions.length) * 80
    for (let step = 1; step <= 8; step++) {
      await sleep(180)
      progress('Flashing', base + (step / 8) * (80 / regions.length), `${region}: ${Math.round((kb * step) / 8)}/${kb}KB`, region)
    }
  }
  progress('Resetting', 96, 'Resetting device...')
  await sleep(400)
  progress('Done', 100, 'Flash completed')
  ev('finished', { ok: true })
  setTimeout(startLog, 800)
}
