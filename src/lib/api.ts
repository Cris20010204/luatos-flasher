/**
 * 前端与 Tauri 后端的接口层。所有 invoke / 事件名都集中在这里，类型与 src-tauri 里的结构体一一对应。
 */
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { openPath, revealItemInDir } from '@tauri-apps/plugin-opener'
import { demoCall, demoOn, isDemo } from './demo'

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
/** 有没有后端可调：桌面应用里是 Tauri，浏览器里加 ?demo 是演示模式的假数据（src/lib/demo.ts） */
export const hasBackend = isTauri || isDemo
export { isDemo }

/* ---------------------------------------------------------------- types */

export interface BackendDevice {
  id: string
  status: 'running' | 'boot'
  port: string
  logPort: string | null
  apPort: string | null
  userPort: string | null
  bootPort: string | null
  ports: string[]
  serial: string | null
}

export interface SerialPortItem {
  name: string
  desc: string
  vid: number | null
  pid: number | null
}

export interface SocInfo {
  chip: string
  chipType: string
  bits: number
  scriptAddr: string
  scriptKb: number
  fsKb: number
  fwNum: number | null
  useLuac: boolean
  size: number
  file: string
}

export interface FwVersion {
  version: string
  date: string
}

export interface FwBuild {
  /** 文件名末尾的编号（EC718 的 112 号、Air780EP 的 _1）；没有编号为 null（如 EC618 的标准/FULL/TTS） */
  build: number | null
  /** .soc 文件名，同一型号同一版本里唯一，选固件就靠它 */
  file: string
  size: number
  date: string
  url: string
  /** 固件在哪个 zip 里（下载时整包下载再解压） */
  zip: string | null
}

export interface CachedFw {
  /** `<型号>/<版本>/<文件名>` */
  key: string
  model: string
  version: string
  file: string
  build: number | null
  path: string
  size: number
}

export interface CoreRef {
  source: 'resource' | 'local'
  version: string
  /** 文件名末尾的编号，没有为 0；旧项目只存了它（用 coreFile() 取文件名） */
  build: number
  /** 固件文件名；旧项目没有，由版本 + 编号推出 */
  file?: string
  localPath: string
}

export interface ProjectRec {
  id: string
  name: string
  version: string
  model: string
  core: CoreRef
  dir: string
  files: string[]
  options: Record<string, unknown>
  lastDownload: number | null
  createdAt: number
}

export interface FileStat {
  path: string
  name: string
  size: number
  exists: boolean
  isScript: boolean
}

export interface BackendDiag {
  file: string
  line: number
  message: string
  severity: 'error' | 'warning'
}

export interface Check {
  id: string
  status: 'ok' | 'warn' | 'err'
  title: string
  detail: string
}

export interface AppInfo {
  version: string
  os: string
  arch: string
  dataDir: string
  projectsRoot: string
}

export interface FlashRequest {
  taskId: string
  kind: 'full' | 'script' | 'core' | 'erase'
  soc: string
  port: string | null
  scriptFiles: string[]
  luacDebug: number
  clearFs: boolean
  clearKv: boolean
  fsDir: string | null
}

export interface FlashEvent {
  taskId: string
  kind: 'progress' | 'message' | 'log' | 'phase' | 'finished'
  data: Record<string, unknown>
}

export interface DevlogEntry {
  timestamp?: string
  device_time?: string | null
  level: string
  module?: string | null
  message: string
  raw?: string
}

export interface MqttEvent {
  gen: number
  kind: 'connecting' | 'connected' | 'disconnected' | 'message' | 'suback'
  topic?: string
  payload?: string
  qos?: number
  retain?: boolean
  error?: string
}

/* ---------------------------------------------------------------- helpers */

function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isDemo) return demoCall<T>(cmd, args)
  if (!isTauri) return Promise.reject(new Error('请在桌面应用中运行（浏览器里可以加 ?demo 看演示数据）'))
  return invoke<T>(cmd, args)
}

export function on<T>(event: string, fn: (payload: T) => void): () => void {
  if (isDemo) return demoOn(event, fn as (payload: unknown) => void)
  if (!isTauri) return () => {}
  let un: UnlistenFn | null = null
  let dead = false
  listen<T>(event, (e) => fn(e.payload)).then((u) => {
    if (dead) u()
    else un = u
  })
  return () => {
    dead = true
    un?.()
  }
}

export function errText(e: unknown): string {
  if (typeof e === 'string') return e
  if (e instanceof Error) return e.message
  return String(e)
}

export const b64 = {
  encode(bytes: Uint8Array): string {
    let s = ''
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return btoa(s)
  },
  decode(text: string): Uint8Array {
    const s = atob(text)
    const out = new Uint8Array(s.length)
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
    return out
  },
}

/* ---------------------------------------------------------------- api */

export const api = {
  // 设备
  listDevices: () => call<BackendDevice[]>('list_devices'),
  listSerialPorts: () => call<SerialPortItem[]>('list_serial_ports'),
  onDevices: (fn: (d: BackendDevice[]) => void) => on('devices-changed', fn),

  // luatos-cli
  cliVersion: () => call<string>('cli_version'),
  flashStart: (req: FlashRequest) => call<void>('flash_start', { req }),
  flashCancel: () => call<void>('flash_cancel'),
  onFlash: (fn: (e: FlashEvent) => void) => on('flash-event', fn),
  devlogStart: (mode: 'usb' | 'uart', port: string | null, baud: number) => call<void>('devlog_start', { req: { mode, port, baud } }),
  devlogStop: () => call<void>('devlog_stop'),
  onDevlog: (fn: (e: DevlogEntry) => void) => on('devlog', fn),
  onDevlogState: (fn: (s: { running: boolean; error?: string; reason?: string }) => void) => on('devlog-state', fn),
  deviceReboot: (port: string | null, boot = false) => call<string>('device_reboot', { port, boot }),
  makeProduction: (req: { soc: string; scriptFiles: string[]; luacDebug: number; output: string }) =>
    call<string>('make_production', { req: { ...req, includeCore: true, includeScript: true } }),
  makeFota: (req: { soc: string; scriptFiles: string[]; luacDebug: number; output: string; includeCore: boolean; includeScript: boolean }) =>
    call<string>('make_fota', { req }),

  // 固件资源
  fwVersions: (model: string) => call<FwVersion[]>('fw_versions', { model }),
  fwBuilds: (model: string, version: string) => call<FwBuild[]>('fw_builds', { model, version }),
  fwCacheDir: () => call<string>('fw_cache_dir'),
  fwCached: () => call<CachedFw[]>('fw_cached'),
  fwDownload: (model: string, version: string, file: string) => call<string>('fw_download', { model, version, file }),
  fwDelete: (model: string, version: string, file: string) => call<void>('fw_delete', { model, version, file }),
  onFwProgress: (fn: (p: { key: string; received: number; total: number }) => void) => on('fw-progress', fn),
  socInfo: (path: string) => call<SocInfo>('soc_info', { path }),

  // 项目
  projectList: () => call<ProjectRec[]>('project_list'),
  projectSave: (rec: ProjectRec) => call<ProjectRec>('project_save', { rec }),
  projectRemove: (id: string) => call<void>('project_remove', { id }),
  projectCreate: (a: { name: string; model: string; core: CoreRef; files: { name: string; content: string }[]; options: Record<string, unknown>; root?: string | null }) =>
    call<ProjectRec>('project_create', { ...a, root: a.root ?? null }),
  projectOpenDir: (dir: string, model: string, core: CoreRef, options: Record<string, unknown>) => call<ProjectRec>('project_open_dir', { dir, model, core, options }),
  projectClone: (id: string, newName: string) => call<ProjectRec>('project_clone', { id, newName }),
  projectImportIni: (path: string, options: Record<string, unknown>) => call<ProjectRec>('project_import_ini', { path, options }),
  projectExport: (id: string, dest: string, includeCore: boolean) => call<string>('project_export', { id, dest, includeCore }),
  projectImportPkg: (path: string) => call<ProjectRec>('project_import_pkg', { path, root: null }),
  filesStat: (paths: string[]) => call<FileStat[]>('files_stat', { paths }),
  readText: (path: string) => call<string>('read_text', { path }),
  readBytes: (path: string, max: number) => call<string>('read_bytes', { path, max }).then(b64.decode),
  writeText: (path: string, content: string) => call<void>('write_text', { path, content }),
  dirFiles: (dir: string) => call<string[]>('dir_files', { dir }),
  luaCheck: (sources: { name: string; content: string }[]) => call<BackendDiag[]>('lua_check', { sources }),

  // 串口
  serialOpen: (req: { port: string; baud: number; dataBits: number; parity: string; stopBits: number }) => call<void>('serial_open', { req }),
  serialWrite: (bytes: Uint8Array) => call<number>('serial_write', { data: b64.encode(bytes) }),
  serialClose: () => call<void>('serial_close'),
  onSerialData: (fn: (p: { port: string; data: string }) => void) => on('serial-data', fn),
  onSerialClosed: (fn: (p: { port: string; error: string | null }) => void) => on('serial-closed', fn),

  // MQTT
  mqttConnect: (req: { host: string; port: number; clientId: string; username: string; password: string; keepAlive: number; clean: boolean; tls: boolean; ca: string }) =>
    call<number>('mqtt_connect', { req }),
  mqttDisconnect: () => call<void>('mqtt_disconnect'),
  mqttSubscribe: (topic: string, qos: number) => call<void>('mqtt_subscribe', { topic, qosLevel: qos }),
  mqttUnsubscribe: (topic: string) => call<void>('mqtt_unsubscribe', { topic }),
  mqttPublish: (topic: string, payload: Uint8Array, qos: number, retain: boolean) =>
    call<void>('mqtt_publish', { topic, payload: b64.encode(payload), qosLevel: qos, retain }),
  onMqtt: (fn: (e: MqttEvent) => void) => on('mqtt-event', fn),

  // 诊断
  appInfo: () => call<AppInfo>('app_info'),
  logDir: () => call<string>('log_dir'),
  doctor: () => call<Check[]>('run_doctor'),
}

/* ---------------------------------------------------------------- 系统对话框 */

export const dialogs = {
  async pickFile(title: string, extensions?: string[], name = '文件'): Promise<string | null> {
    if (!isTauri) return null
    const r = await openDialog({ title, multiple: false, directory: false, filters: extensions ? [{ name, extensions }] : undefined })
    return typeof r === 'string' ? r : null
  },
  async pickFiles(title: string): Promise<string[]> {
    if (!isTauri) return []
    const r = await openDialog({ title, multiple: true, directory: false })
    return Array.isArray(r) ? r : r ? [r] : []
  },
  async pickDir(title: string, defaultPath?: string): Promise<string | null> {
    if (!isTauri) return null
    const r = await openDialog({ title, directory: true, multiple: false, defaultPath })
    return typeof r === 'string' ? r : null
  },
  async saveFile(title: string, defaultPath: string, extensions?: string[]): Promise<string | null> {
    if (!isTauri) return null
    return saveDialog({ title, defaultPath, filters: extensions ? [{ name: extensions.join('/'), extensions }] : undefined })
  },
  async openPath(path: string) {
    if (isTauri) await openPath(path)
  },
  async reveal(path: string) {
    if (isTauri) await revealItemInDir(path)
  },
}

/** 把家目录显示成 ~ */
export function tildify(p: string, home?: string) {
  if (!p) return p
  const h = home ?? cachedHome
  if (h && p.startsWith(h)) return '~' + p.slice(h.length)
  return p
}
let cachedHome = ''
export function setHome(h: string) {
  cachedHome = h
}

export function baseName(p: string) {
  return p.split(/[\\/]/).pop() ?? p
}
