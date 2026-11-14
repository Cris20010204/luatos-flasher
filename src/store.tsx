import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { demoParam } from './lib/demo'
import { api, baseName, errText, hasBackend, setHome, type AppInfo, type BackendDevice, type CachedFw, type FwBuild, type FwVersion, type ProjectRec, type SocInfo, type FileStat } from './lib/api'
import { checkLua, type Diagnostic } from './lib/lua'
import { utf8Len } from './lib/format'
import { CHIP_OF, FAMILIES, buildSpec, canFlash, coreFile, familyOf, fileBuild, variantLabel } from './data/catalog'
import {
  OFFLINE_DEVICE,
  defaultOptions,
  loadLocal,
  saveLocal,
  LUAC_DEBUG,
  type Device,
  type DeviceStatus,
  type DownloadOptions,
  type Project,
  type ProjectFile,
} from './data/types'

export type Page = 'projects' | 'code' | 'flash' | 'logs' | 'serial' | 'mqtt' | 'firmware' | 'settings'
export type Lang = 'zh' | 'en'
export type ThemePref = 'light' | 'dark' | 'system'
export type Platform = 'mac' | 'win'
export type MqttStatus = 'disconnected' | 'connecting' | 'connected'

export interface Toast {
  id: number
  kind: 'success' | 'error' | 'info' | 'warning'
  title: string
  desc?: string
  action?: { label: string; run: () => void }
}

export type StepKey = 'fetch' | 'enter' | 'erase' | 'loader' | 'boot' | 'app' | 'cp' | 'script' | 'reboot'
export const STEP_LABEL: Record<StepKey, [string, string]> = {
  fetch: ['下载固件', 'Fetch firmware'],
  enter: ['进入下载模式', 'Enter download mode'],
  erase: ['清除数据', 'Erase data'],
  loader: ['加载引导程序', 'Load bootloader'],
  boot: ['写引导区', 'Write boot area'],
  app: ['写应用区', 'Write app area'],
  cp: ['写通信区', 'Write CP area'],
  script: ['写脚本', 'Write scripts'],
  reboot: ['重启', 'Reboot'],
}

export type TaskKind = 'script' | 'full' | 'flash' | 'erase'

/** 底层固件来源：固件资源（会自动下载）或本地文件 */
/** 资源固件按 型号 + 版本 + 文件名 定位（同一版本可能有多个固件：编号、标准/FULL/TTS） */
export type SocRef = { source: 'resource'; model: string; version: string; file: string } | { source: 'local'; path: string }

export interface DownloadRequest {
  kind: TaskKind
  model: string
  /** 显示用的固件文件名 */
  firmware: string
  soc: SocRef
  scriptFiles: string[]
  scriptsBytes: number
  scriptCount: number
  projectName?: string
  projectId?: string
  luacDebug: number
  clearFs: boolean
  clearKv: boolean
  fsDir: string | null
  listenAfter: boolean
}

export interface TaskLog {
  t: number
  text: string
  level: 'info' | 'ok' | 'warn' | 'err' | 'dim'
  key?: string
}

export interface Task {
  id: string
  req: DownloadRequest
  status: 'running' | 'success' | 'failed'
  steps: StepKey[]
  stepIdx: number
  progress: number
  startedAt: number
  endedAt?: number
  logs: TaskLog[]
  error?: [string, string]
  dialogOpen: boolean
  deviceId: string
  phases: string[]
  phase: string
}

export interface SyntaxResult {
  at: number
  diags: Diagnostic[]
  files: number
}

interface ConfirmOpts {
  title: string
  body?: ReactNode
  okText?: string
  danger?: boolean
}

export interface CoreSpec {
  chip: string
  bits: number | null
  scriptAddr: string
  scriptKB: number
  fsKB: number
  /** 来自真实 soc 文件（否则来自官方编号表或未知） */
  exact: boolean
  socPath: string | null
}

export type FwStatus = 'done' | 'none' | { progress: number }

interface Ctx {
  t: (zh: string, en: string) => string
  lang: Lang
  setLang: (l: Lang) => void
  themePref: ThemePref
  setThemePref: (t: ThemePref) => void
  dark: boolean
  platform: Platform
  page: Page
  setPage: (p: Page) => void
  navCollapsed: boolean
  setNavCollapsed: (v: boolean) => void
  appInfo: AppInfo | null
  cliVersion: string
  tildify: (p: string) => string

  devices: Device[]
  device: Device
  deviceId: string
  setDeviceId: (id: string) => void
  setDeviceMeta: (patch: { model?: string; imei?: string }) => void
  portOf: (d: Device) => string
  refreshDevices: () => void

  projects: Project[]
  project: Project | null
  projectsLoaded: boolean
  setProjectId: (id: string | null) => void
  updateProject: (id: string, patch: Partial<Project> | ((p: Project) => Partial<Project>)) => void
  addProject: (rec: ProjectRec) => void
  removeProject: (id: string) => Promise<void>
  reloadProjects: () => Promise<void>
  refreshFiles: () => Promise<void>
  coreLabel: (p: Project | null) => string
  coreSpec: (p: Project | null) => CoreSpec

  // editor
  getContent: (f: ProjectFile) => string
  setDraft: (name: string, v: string) => void
  isDirty: (name: string) => boolean
  saveFile: (name: string) => Promise<void>
  saveAll: () => Promise<void>
  newFile: (name: string) => Promise<void>
  tabs: string[]
  activeTab: string | null
  setActiveTab: (n: string | null) => void
  closeTab: (n: string) => void
  openFile: (name: string, line?: number) => void
  jump: { file: string; line: number; nonce: number } | null
  scriptBytes: (p: Project | null) => number
  liveDiags: Diagnostic[]
  contentLoaded: (f: ProjectFile) => boolean

  syntax: SyntaxResult | null
  checking: boolean
  runSyntaxCheck: () => Promise<Diagnostic[]>

  // download
  task: Task | null
  pending: DownloadRequest | null
  requestDownload: (kind: TaskKind, overrides?: Partial<DownloadRequest>) => void
  /** 清除模组文件系统 / KV（需要项目的底层固件来确定分区位置） */
  requestErase: (what: 'fs' | 'kv') => void
  confirmPending: () => void
  cancelPending: () => void
  setTaskDialog: (open: boolean) => void
  cancelTask: () => void
  retryTask: () => void
  dismissTask: () => void

  // firmware
  fwStatus: Record<string, FwStatus>
  cachedFw: CachedFw[]
  refreshCachedFw: () => Promise<void>
  versionsOf: (model: string) => FwVersion[] | null
  loadVersions: (model: string, force?: boolean) => Promise<FwVersion[]>
  buildsOf: (model: string, version: string) => FwBuild[] | null
  loadBuilds: (model: string, version: string) => Promise<FwBuild[]>
  downloadFw: (model: string, version: string, file: string) => Promise<string | null>
  deleteFw: (model: string, version: string, file: string) => Promise<void>
  socInfoOf: (path: string | null) => SocInfo | null
  loadSocInfo: (path: string) => Promise<SocInfo | null>
  cachedPath: (model: string, version: string, file: string) => string | null

  mqttStatus: MqttStatus
  setMqttStatus: (s: MqttStatus) => void

  // 设备日志
  logPortOpen: boolean
  logWanted: boolean
  setLogPortOpen: (v: boolean) => void
  logMode: 'usb' | 'uart'
  setLogMode: (m: 'usb' | 'uart') => void
  logUartPort: string
  setLogUartPort: (p: string) => void
  logBaud: number
  setLogBaud: (b: number) => void
  logError: string
  rebootNonce: number
  rebootDevice: () => Promise<void>

  toasts: Toast[]
  toast: (kind: Toast['kind'], title: string, desc?: string, action?: Toast['action']) => void
  dismissToast: (id: number) => void
  confirm: (o: ConfirmOpts) => Promise<boolean>
  confirmState: ConfirmOpts | null
  resolveConfirm: (v: boolean) => void
  wizardOpen: boolean
  setWizardOpen: (v: boolean) => void
}

const AppCtx = createContext<Ctx | null>(null)

export function useApp() {
  const c = useContext(AppCtx)
  if (!c) throw new Error('useApp outside provider')
  return c
}

const isWin = typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent)

/* Lua 编译器的英文报错翻成中文（只翻常见的几种，其余保留原文） */
function zhLuaMessage(msg: string): string {
  let m: RegExpMatchArray | null
  if ((m = msg.match(/^'(\w+)' expected \(to close '(\w+)' at line (\d+)\) near (.+)$/))) return `缺少 '${m[1]}'（用于闭合第 ${m[3]} 行的 '${m[2]}'），位置 ${m[4]}`
  if ((m = msg.match(/^'(.+?)' expected near (.+)$/))) return `这里需要 '${m[1]}'，位置 ${m[2]}`
  if ((m = msg.match(/^unexpected symbol near (.+)$/))) return `意外的符号 ${m[1]}`
  if ((m = msg.match(/^unfinished string near (.+)$/))) return `字符串没有闭合 ${m[1]}`
  if ((m = msg.match(/^unfinished long (string|comment)/))) return `长${m[1] === 'string' ? '字符串' : '注释'}没有闭合`
  if ((m = msg.match(/^malformed number near (.+)$/))) return `数字格式错误 ${m[1]}`
  if ((m = msg.match(/^'=' expected near (.+)$/))) return `这里需要 '='，位置 ${m[1]}`
  return `语法错误：${msg}`
}

function toDiag(d: { file: string; line: number; message: string; severity: 'error' | 'warning' }): Diagnostic {
  return { file: d.file, line: d.line, severity: d.severity, zh: zhLuaMessage(d.message), en: d.message, raw: `${d.file}:${d.line}: ${d.message}` }
}

/** 从 main.lua 出发沿 require 找到用到的脚本（LuaTools“不忽略脚本依赖性”的行为） */
function reachableModules(files: ProjectFile[], contentOf: (f: ProjectFile) => string): Set<string> | null {
  const byMod = new Map(files.filter((f) => f.type === 'script').map((f) => [f.name.replace(/\.lua$/, ''), f]))
  if (!byMod.has('main')) return null
  const seen = new Set<string>()
  const stack = ['main']
  while (stack.length) {
    const m = stack.pop()!
    if (seen.has(m)) continue
    seen.add(m)
    const f = byMod.get(m)
    if (!f) continue
    for (const mm of contentOf(f).matchAll(/require\s*\(?\s*["']([\w.\-]+)["']/g)) stack.push(mm[1].split('.').pop()!)
  }
  return seen
}

function recToProject(r: ProjectRec, stats: Record<string, FileStat>): Project {
  const files: ProjectFile[] = r.files.map((path) => {
    const s = stats[path]
    const name = baseName(path)
    return { name, path, type: name.endsWith('.lua') ? 'script' : 'resource', size: s?.size ?? 0, exists: s?.exists ?? true }
  })
  return {
    id: r.id,
    name: r.name,
    version: r.version,
    model: r.model,
    core: r.core,
    dir: r.dir,
    files,
    lastDownload: r.lastDownload,
    options: { ...defaultOptions, ...(r.options as Partial<DownloadOptions>) },
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [lang, setLangRaw] = useState<Lang>(() => loadLocal('lang', 'zh'))
  const [themePref, setThemePrefRaw] = useState<ThemePref>(() => loadLocal('theme', 'system'))
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false)
  const [page, setPage] = useState<Page>(() => (demoParam('page') as Page | null) ?? 'projects')
  const [navCollapsed, setNavCollapsedRaw] = useState<boolean>(() => loadLocal('nav', false))
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [cliVersion, setCliVersion] = useState('')

  const [backendDevices, setBackendDevices] = useState<BackendDevice[]>([])
  const [deviceMeta, setDeviceMetaRaw] = useState<{ model: string; imei: string }>(() => loadLocal('deviceMeta', { model: '', imei: '' }))
  const [deviceId, setDeviceId] = useState('none')

  const [recs, setRecs] = useState<ProjectRec[]>([])
  const [projectsLoaded, setProjectsLoaded] = useState(false)
  const [stats, setStats] = useState<Record<string, FileStat>>({})
  const [contents, setContents] = useState<Record<string, string>>({})
  const [projectId, setProjectIdRaw] = useState<string | null>(() => loadLocal('project', null))
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [tabs, setTabs] = useState<string[]>([])
  const [activeTab, setActiveTab] = useState<string | null>(null)
  const [jump, setJump] = useState<Ctx['jump']>(null)
  const [syntax, setSyntax] = useState<SyntaxResult | null>(null)
  const [checking, setChecking] = useState(false)
  const [backendDiags, setBackendDiags] = useState<Diagnostic[]>([])

  const [task, setTask] = useState<Task | null>(null)
  const [pending, setPending] = useState<DownloadRequest | null>(null)

  const [cachedFw, setCachedFw] = useState<CachedFw[]>([])
  const [fwProgress, setFwProgress] = useState<Record<string, number>>({})
  const [versions, setVersions] = useState<Record<string, FwVersion[]>>({})
  const [builds, setBuilds] = useState<Record<string, FwBuild[]>>({})
  const [socInfos, setSocInfos] = useState<Record<string, SocInfo | null>>({})

  const [mqttStatus, setMqttStatus] = useState<MqttStatus>('disconnected')
  const [logRunning, setLogRunning] = useState(false)
  const [logWanted, setLogWanted] = useState<boolean>(() => loadLocal('logWanted', true))
  const [logMode, setLogModeRaw] = useState<'usb' | 'uart'>(() => loadLocal('logMode', 'usb'))
  const [logUartPort, setLogUartPortRaw] = useState<string>(() => loadLocal('logUartPort', ''))
  const [logBaud, setLogBaudRaw] = useState<number>(() => loadLocal('logBaud', 921600))
  const [logError, setLogError] = useState('')
  const [rebootNonce, setRebootNonce] = useState(0)

  const [toasts, setToasts] = useState<Toast[]>([])
  const [confirmState, setConfirmState] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null)
  const [wizardOpen, setWizardOpen] = useState(false)

  const t = useCallback((zh: string, en: string) => (lang === 'zh' ? zh : en), [lang])
  const setLang = useCallback((l: Lang) => (setLangRaw(l), saveLocal('lang', l)), [])
  const setThemePref = useCallback((v: ThemePref) => (setThemePrefRaw(v), saveLocal('theme', v)), [])
  const setNavCollapsed = useCallback((v: boolean) => (setNavCollapsedRaw(v), saveLocal('nav', v)), [])
  const setLogMode = useCallback((v: 'usb' | 'uart') => (setLogModeRaw(v), saveLocal('logMode', v)), [])
  const setLogUartPort = useCallback((v: string) => (setLogUartPortRaw(v), saveLocal('logUartPort', v)), [])
  const setLogBaud = useCallback((v: number) => (setLogBaudRaw(v), saveLocal('logBaud', v)), [])
  const platform: Platform = isWin ? 'win' : 'mac'

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!mq) return
    const fn = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
  }, [])
  const dark = themePref === 'dark' || (themePref === 'system' && systemDark)
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
  }, [dark, lang])

  /* ---------- toasts / confirm ---------- */
  const toastId = useRef(1)
  const dismissToast = useCallback((id: number) => setToasts((ts) => ts.filter((x) => x.id !== id)), [])
  const toast = useCallback<Ctx['toast']>(
    (kind, title, desc, action) => {
      const id = toastId.current++
      setToasts((ts) => [...ts.slice(-3), { id, kind, title, desc, action }])
      setTimeout(() => dismissToast(id), kind === 'error' ? 7000 : 3600)
    },
    [dismissToast],
  )
  const confirm = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setConfirmState({ ...o, resolve })), [])
  const resolveConfirm = useCallback(
    (v: boolean) => {
      confirmState?.resolve(v)
      setConfirmState(null)
    },
    [confirmState],
  )

  /* ---------- 启动：应用信息、luatos-cli 版本、项目、固件缓存、设备 ---------- */
  const tildify = useCallback(
    (p: string) => {
      const h = appInfo?.projectsRoot ? appInfo.projectsRoot.replace(/[\\/]LuatOS$/, '') : ''
      return h && p.startsWith(h) ? '~' + p.slice(h.length) : p
    },
    [appInfo],
  )

  const refreshCachedFw = useCallback(async () => {
    try {
      setCachedFw(await api.fwCached())
    } catch {
      /* 浏览器预览时没有后端 */
    }
  }, [])

  useEffect(() => {
    if (!hasBackend) {
      setProjectsLoaded(true)
      return
    }
    api.appInfo().then((i) => {
      setAppInfo(i)
      setHome(i.projectsRoot.replace(/[\\/]LuatOS$/, ''))
    })
    api.cliVersion().then(setCliVersion).catch(() => setCliVersion(''))
    refreshCachedFw()
    api.listDevices().then(setBackendDevices)
    api
      .projectList()
      .then((list) => {
        setRecs(list)
        setProjectsLoaded(true)
      })
      .catch((e) => {
        setProjectsLoaded(true)
        toast('error', '读取项目列表失败', errText(e))
      })
    const offDev = api.onDevices(setBackendDevices)
    const offFw = api.onFwProgress((p) => setFwProgress((m) => ({ ...m, [p.key]: p.total ? Math.min(99, (p.received / p.total) * 100) : 50 })))
    return () => {
      offDev()
      offFw()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- 设备 ---------- */
  const devices = useMemo<Device[]>(() => {
    if (!backendDevices.length) return [OFFLINE_DEVICE]
    return backendDevices.map((d) => ({
      id: d.id,
      model: deviceMeta.model,
      port: d.port,
      status: d.status as DeviceStatus,
      imei: deviceMeta.imei,
      logPort: d.logPort,
      userPort: d.userPort,
      bootPort: d.bootPort,
      ports: d.ports,
    }))
  }, [backendDevices, deviceMeta])
  const device = devices.find((d) => d.id === deviceId) ?? devices[0]
  useEffect(() => {
    if (!devices.some((d) => d.id === deviceId)) setDeviceId(devices[0].id)
  }, [devices, deviceId])
  const setDeviceMeta = useCallback((patch: { model?: string; imei?: string }) => {
    setDeviceMetaRaw((m) => {
      const next = { ...m, ...patch }
      if (next.model === m.model && next.imei === m.imei) return m
      saveLocal('deviceMeta', next)
      return next
    })
  }, [])
  const portOf = useCallback((d: Device) => d.port, [])
  const refreshDevices = useCallback(() => {
    api
      .listDevices()
      .then((list) => {
        setBackendDevices(list)
        toast('info', t('已刷新设备列表', 'Device list refreshed'), t(`发现 ${list.length} 个模组`, `${list.length} module(s) found`))
      })
      .catch((e) => toast('error', t('刷新失败', 'Refresh failed'), errText(e)))
  }, [t, toast])

  /* ---------- 项目 ---------- */
  const projects = useMemo(() => recs.map((r) => recToProject(r, stats)), [recs, stats])
  const project = projects.find((p) => p.id === projectId) ?? null

  const statPaths = useCallback(async (paths: string[]) => {
    if (!paths.length || !hasBackend) return
    const list = await api.filesStat(paths)
    setStats((s) => {
      const next = { ...s }
      for (const f of list) next[f.path] = f
      return next
    })
  }, [])

  const loadContents = useCallback(async (paths: string[], force = false) => {
    const need = force ? paths : paths.filter((p) => !(p in contentsRef.current))
    if (!need.length || !hasBackend) return
    const loaded = await Promise.all(need.map((p) => api.readText(p).then((c) => [p, c] as const).catch(() => [p, ''] as const)))
    setContents((c) => {
      const next = { ...c }
      for (const [p, v] of loaded) next[p] = v
      return next
    })
  }, [])
  const contentsRef = useRef(contents)
  contentsRef.current = contents

  // 打开项目时：读取文件大小，加载全部脚本内容（脚本都很小，实时语法检查需要）
  const projectFilesKey = project ? project.id + '|' + recs.find((r) => r.id === project.id)?.files.join('|') : ''
  useEffect(() => {
    const rec = recs.find((r) => r.id === projectId)
    if (!rec) return
    statPaths(rec.files)
    loadContents(rec.files.filter((f) => f.endsWith('.lua')))
  }, [projectFilesKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const refreshFiles = useCallback(async () => {
    const rec = recs.find((r) => r.id === projectId)
    if (!rec) return
    await statPaths(rec.files)
    // 未修改的脚本重新从磁盘读，外部编辑器改过的也能同步
    const clean = rec.files.filter((f) => f.endsWith('.lua') && !(`${rec.id}:${baseName(f)}` in draftsRef.current))
    await loadContents(clean, true)
  }, [recs, projectId, statPaths, loadContents])
  const draftsRef = useRef(drafts)
  draftsRef.current = drafts

  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const persist = useCallback(
    (rec: ProjectRec) => {
      clearTimeout(saveTimers.current[rec.id])
      saveTimers.current[rec.id] = setTimeout(() => {
        api.projectSave(rec).catch((e) => toast('error', t('保存项目失败', 'Failed to save project'), errText(e)))
      }, 300)
    },
    [t, toast],
  )

  const setProjectId = useCallback((id: string | null) => {
    setProjectIdRaw(id)
    saveLocal('project', id)
    setSyntax(null)
    setBackendDiags([])
    if (id) {
      setTabs(['main.lua'])
      setActiveTab('main.lua')
    } else {
      setTabs([])
      setActiveTab(null)
    }
  }, [])

  // 第一次加载完，如果记住的项目不存在了，选第一个
  useEffect(() => {
    if (!projectsLoaded) return
    if (projectId && !recs.some((r) => r.id === projectId)) setProjectId(recs[0]?.id ?? null)
    else if (projectId && !tabs.length) setProjectId(projectId)
  }, [projectsLoaded]) // eslint-disable-line react-hooks/exhaustive-deps

  const updateProject = useCallback<Ctx['updateProject']>(
    (id, patch) => {
      setRecs((rs) =>
        rs.map((r) => {
          if (r.id !== id) return r
          const cur = recToProject(r, stats)
          const p = typeof patch === 'function' ? patch(cur) : patch
          const next: ProjectRec = {
            ...r,
            name: p.name ?? r.name,
            version: p.version ?? r.version,
            model: p.model ?? r.model,
            core: p.core ?? r.core,
            options: (p.options as unknown as Record<string, unknown>) ?? r.options,
            lastDownload: p.lastDownload !== undefined ? p.lastDownload : r.lastDownload,
            files: p.files ? p.files.map((f) => f.path) : r.files,
          }
          persist(next)
          return next
        }),
      )
    },
    [persist, stats],
  )

  const addProject = useCallback(
    (rec: ProjectRec) => {
      setRecs((rs) => [rec, ...rs.filter((r) => r.id !== rec.id)])
      setProjectId(rec.id)
    },
    [setProjectId],
  )
  const removeProject = useCallback(
    async (id: string) => {
      await api.projectRemove(id)
      setRecs((rs) => rs.filter((r) => r.id !== id))
      if (id === projectId) setProjectId(null)
    },
    [projectId, setProjectId],
  )
  const reloadProjects = useCallback(async () => {
    setRecs(await api.projectList())
    await refreshFiles()
  }, [refreshFiles])

  /* ---------- 固件 ---------- */
  const cachedPath = useCallback(
    (model: string, version: string, file: string) => (file ? (cachedFw.find((c) => c.key === `${model}/${version}/${file}`)?.path ?? null) : null),
    [cachedFw],
  )
  const fwStatus = useMemo(() => {
    const m: Record<string, FwStatus> = {}
    for (const c of cachedFw) m[c.key] = 'done'
    for (const [k, v] of Object.entries(fwProgress)) if (m[k] !== 'done') m[k] = { progress: v }
    return m
  }, [cachedFw, fwProgress])

  const versionsOf = useCallback((model: string) => versions[model] ?? null, [versions])
  const inflight = useRef<Record<string, Promise<unknown> | undefined>>({})
  const loadVersions = useCallback(
    async (model: string, force = false) => {
      if (!force && versions[model]) return versions[model]
      const key = `v:${model}`
      if (!force && inflight.current[key]) return inflight.current[key] as Promise<FwVersion[]>
      const p = api.fwVersions(model).then((v) => {
        setVersions((m) => ({ ...m, [model]: v }))
        return v
      })
      inflight.current[key] = p
      try {
        return await p
      } finally {
        delete inflight.current[key]
      }
    },
    [versions],
  )
  const buildsOf = useCallback((model: string, version: string) => builds[`${model}/${version}`] ?? null, [builds])
  const loadBuilds = useCallback(
    async (model: string, version: string) => {
      const key = `${model}/${version}`
      if (builds[key]) return builds[key]
      const list = await api.fwBuilds(model, version)
      setBuilds((m) => ({ ...m, [key]: list }))
      return list
    },
    [builds],
  )
  const downloadFw = useCallback(
    async (model: string, version: string, file: string) => {
      const key = `${model}/${version}/${file}`
      setFwProgress((m) => ({ ...m, [key]: 0 }))
      try {
        const path = await api.fwDownload(model, version, file)
        await refreshCachedFw()
        return path
      } catch (e) {
        toast('error', t('固件下载失败', 'Firmware download failed'), errText(e))
        return null
      } finally {
        setFwProgress((m) => {
          const n = { ...m }
          delete n[key]
          return n
        })
      }
    },
    [refreshCachedFw, t, toast],
  )
  const deleteFw = useCallback(
    async (model: string, version: string, file: string) => {
      await api.fwDelete(model, version, file)
      await refreshCachedFw()
    },
    [refreshCachedFw],
  )
  const socInfoOf = useCallback((path: string | null) => (path ? (socInfos[path] ?? null) : null), [socInfos])
  const loadSocInfo = useCallback(async (path: string) => {
    try {
      const info = await api.socInfo(path)
      setSocInfos((m) => ({ ...m, [path]: info }))
      return info
    } catch {
      setSocInfos((m) => ({ ...m, [path]: null }))
      return null
    }
  }, [])

  const socPathOf = useCallback(
    (p: Project | null) => {
      if (!p) return null
      if (p.core.source === 'local') return p.core.localPath || null
      return cachedPath(p.model, p.core.version, coreFile(p.model, p.core))
    },
    [cachedPath],
  )
  const curSoc = socPathOf(project)
  useEffect(() => {
    if (curSoc && !(curSoc in socInfos)) loadSocInfo(curSoc)
  }, [curSoc]) // eslint-disable-line react-hooks/exhaustive-deps

  const coreSpec = useCallback(
    (p: Project | null): CoreSpec => {
      const path = socPathOf(p)
      const info = path ? socInfos[path] : null
      if (info) return { chip: info.chip, bits: info.bits, scriptAddr: info.scriptAddr, scriptKB: info.scriptKb, fsKB: info.fsKb, exact: true, socPath: path }
      const spec = p && p.core.source === 'resource' ? buildSpec(p.model, fileBuild(coreFile(p.model, p.core))) : null
      return {
        chip: p ? (CHIP_OF[p.model] ?? '—') : '—',
        bits: spec?.bits ?? null,
        scriptAddr: '—',
        scriptKB: spec?.scriptKB ?? 1024,
        fsKB: spec?.fsKB ?? 0,
        exact: false,
        socPath: path,
      }
    },
    [socInfos, socPathOf],
  )

  const coreLabel = useCallback(
    (p: Project | null) => {
      if (!p) return '—'
      if (p.core.source === 'local') return p.core.localPath ? t('本地 · ', 'Local · ') + baseName(p.core.localPath) : t('未选择底层', 'No CORE')
      const file = coreFile(p.model, p.core)
      if (!p.core.version || !file) return t('未选择底层', 'No CORE')
      // 位数以固件包里读出来的为准；还没下载时 EC718 按编号推（>100 是 64 位）
      const path = cachedPath(p.model, p.core.version, file)
      const n = fileBuild(file)
      const bits = (path && socInfos[path]?.bits) || (n ? (n > 100 ? 64 : 32) : null)
      return [p.core.version, variantLabel(file, t), bits ? t(`${bits}位`, `${bits}-bit`) : null].filter(Boolean).join(' · ')
    },
    [t, cachedPath, socInfos],
  )

  /* ---------- 编辑器 ---------- */
  const fileOf = useCallback((name: string) => project?.files.find((f) => f.name === name), [project])
  const getContent = useCallback((f: ProjectFile) => drafts[`${projectId}:${f.name}`] ?? contents[f.path] ?? '', [drafts, contents, projectId])
  const contentLoaded = useCallback((f: ProjectFile) => f.path in contents, [contents])
  const setDraft = useCallback(
    (name: string, v: string) => {
      const file = fileOf(name)
      setDrafts((d) => {
        const next = { ...d }
        if (file && contentsRef.current[file.path] === v) delete next[`${projectId}:${name}`]
        else next[`${projectId}:${name}`] = v
        return next
      })
    },
    [fileOf, projectId],
  )
  const isDirty = useCallback((name: string) => `${projectId}:${name}` in drafts, [drafts, projectId])
  const saveFile = useCallback(
    async (name: string) => {
      const file = fileOf(name)
      const k = `${projectId}:${name}`
      const draft = draftsRef.current[k]
      if (!file || draft === undefined) return
      try {
        await api.writeText(file.path, draft)
      } catch (e) {
        toast('error', t('保存失败', 'Save failed'), errText(e))
        return
      }
      setContents((c) => ({ ...c, [file.path]: draft }))
      setDrafts((d) => {
        const n = { ...d }
        delete n[k]
        return n
      })
      statPaths([file.path])
    },
    [fileOf, projectId, statPaths, t, toast],
  )
  const saveAll = useCallback(async () => {
    const names = Object.keys(draftsRef.current)
      .filter((k) => k.startsWith(`${projectId}:`))
      .map((k) => k.slice(String(projectId).length + 1))
    for (const n of names) await saveFile(n)
  }, [projectId, saveFile])
  const newFile = useCallback(
    async (name: string) => {
      if (!project) return
      const path = `${project.dir}/${name}`.replace(/\\/g, '/')
      if (project.files.some((f) => f.name === name)) throw new Error(t('已有同名文件', 'A file with this name exists'))
      await api.writeText(path, name.endsWith('.lua') ? `-- ${name}\n` : '')
      setContents((c) => ({ ...c, [path]: name.endsWith('.lua') ? `-- ${name}\n` : '' }))
      updateProject(project.id, (p) => ({ files: [...p.files, { name, path, type: name.endsWith('.lua') ? 'script' : 'resource', size: 0, exists: true }] }))
      await statPaths([path])
    },
    [project, statPaths, t, updateProject],
  )
  const closeTab = useCallback(
    (n: string) => {
      setTabs((ts) => {
        const idx = ts.indexOf(n)
        const next = ts.filter((x) => x !== n)
        if (activeTab === n) setActiveTab(next[Math.max(0, idx - 1)] ?? null)
        return next
      })
    },
    [activeTab],
  )
  const openFile = useCallback(
    (name: string, line?: number) => {
      setTabs((ts) => (ts.includes(name) ? ts : [...ts, name]))
      setActiveTab(name)
      setPage('code')
      const f = fileOf(name)
      if (f) loadContents([f.path])
      if (line) setJump({ file: name, line, nonce: Date.now() })
    },
    [fileOf, loadContents],
  )
  const scriptBytes = useCallback(
    (p: Project | null) => {
      if (!p) return 0
      return p.files.reduce((sum, f) => {
        const d = drafts[`${p.id}:${f.name}`]
        return sum + (d !== undefined ? utf8Len(d) : f.size)
      }, 0)
    },
    [drafts],
  )

  // 实时诊断：错误用后端真正的 Lua 5.3 编译器（防抖 450ms），"未使用的局部变量"警告用前端的轻量检查
  const scriptSources = useMemo(() => {
    if (!project) return []
    return project.files
      .filter((f) => f.type === 'script' && f.path in contents)
      .map((f) => ({ name: f.name, content: drafts[`${project.id}:${f.name}`] ?? contents[f.path] ?? '' }))
  }, [project, drafts, contents])
  useEffect(() => {
    if (!hasBackend || !scriptSources.length) {
      setBackendDiags([])
      return
    }
    const h = setTimeout(() => {
      api
        .luaCheck(scriptSources)
        .then((ds) => setBackendDiags(ds.map(toDiag)))
        .catch(() => {})
    }, 450)
    return () => clearTimeout(h)
  }, [scriptSources])
  const liveDiags = useMemo(() => {
    const warns = scriptSources.flatMap((s) => checkLua(s.name, s.content).filter((d) => d.severity === 'warning'))
    return [...backendDiags, ...warns]
  }, [backendDiags, scriptSources])

  const runSyntaxCheck = useCallback(async () => {
    if (!project) {
      toast('error', t('未打开项目', 'No project open'), t('请先在“项目”页选择或创建项目', 'Select or create a project first'))
      return []
    }
    setChecking(true)
    try {
      await refreshFiles()
      const scripts = project.files.filter((f) => f.type === 'script')
      const missing = project.files.filter((f) => !f.exists)
      const srcs = await Promise.all(
        scripts
          .filter((f) => f.exists)
          .map(async (f) => ({ name: f.name, content: draftsRef.current[`${project.id}:${f.name}`] ?? (await api.readText(f.path).catch(() => '')) })),
      )
      const errs = (await api.luaCheck(srcs)).map(toDiag)
      const warns = srcs.flatMap((s) => checkLua(s.name, s.content).filter((d) => d.severity === 'warning'))
      const missingDiags: Diagnostic[] = missing.map((f) => ({
        file: f.name,
        line: 0,
        severity: 'error',
        zh: `文件不存在：${f.path}`,
        en: `File not found: ${f.path}`,
        raw: f.path,
      }))
      const diags = [...missingDiags, ...errs, ...warns]
      setSyntax({ at: Date.now(), diags, files: scripts.length })
      const errors = diags.filter((d) => d.severity === 'error').length
      const warnsN = diags.length - errors
      if (errors === 0)
        toast(
          'success',
          t('语法检查通过', 'Syntax check passed'),
          t(`${scripts.length} 个脚本${warnsN ? `，${warnsN} 个警告` : '，未发现问题'}`, `${scripts.length} scripts${warnsN ? `, ${warnsN} warnings` : ', no issues'}`),
        )
      else toast('error', t(`语法检查发现 ${errors} 个错误`, `Syntax check: ${errors} error(s)`), diags.find((d) => d.severity === 'error')?.raw)
      return diags
    } catch (e) {
      toast('error', t('语法检查失败', 'Syntax check failed'), errText(e))
      return []
    } finally {
      setChecking(false)
    }
  }, [project, refreshFiles, t, toast])

  /* ---------- 设备日志（全局管理：下载时要让出日志口） ---------- */
  const setLogPortOpen = useCallback((v: boolean) => {
    setLogWanted(v)
    saveLocal('logWanted', v)
    if (!v) api.devlogStop().catch(() => {})
  }, [])
  const logStartingRef = useRef(false)
  const logFailAt = useRef(0)
  const logFails = useRef(0)
  useEffect(
    () =>
      api.onDevlogState((s) => {
        setLogRunning(s.running)
        if (!s.running && s.error) {
          setLogError(s.error)
          logFailAt.current = Date.now()
          logFails.current++
        }
        if (s.running) setLogError('')
      }),
    [],
  )
  // 日志口连续失败时逐步拉长重试间隔：5s、10s、20s … 最长 60s；模组重新插拔后从头计
  useEffect(() => {
    logFails.current = 0
  }, [device.id])
  useEffect(() => {
    if (!hasBackend || !logWanted || logRunning || task?.status === 'running') return
    const canUsb = logMode === 'usb' && device.status === 'running'
    const canUart = logMode === 'uart' && !!logUartPort
    // 4G 模组的 USB 日志口输出的是二进制帧，还要先发探测帧；用文本模式打开只会一片空白或乱码
    if (logMode === 'uart' && logUartPort && logUartPort === device.logPort) {
      setLogError(
        t(
          '这是 4G 模组的 USB 日志口，输出的是二进制日志，文本模式看不到内容。请切到「4G 模块 USB 打印」。',
          'This is the 4G module’s binary USB log port; text mode shows nothing. Switch to “4G module USB log”.',
        ),
      )
      return
    }
    if (!canUsb && !canUart) return
    const backoff = logFails.current ? Math.min(60000, 5000 * 2 ** (logFails.current - 1)) : 0
    const wait = Math.max(1200, backoff - (Date.now() - logFailAt.current))
    const h = setTimeout(async () => {
      if (logStartingRef.current) return
      logStartingRef.current = true
      try {
        await api.devlogStart(logMode, logMode === 'usb' ? device.logPort : logUartPort, logMode === 'usb' ? 921600 : logBaud)
      } catch (e) {
        logFailAt.current = Date.now()
        logFails.current++
        setLogError(errText(e))
      } finally {
        logStartingRef.current = false
      }
    }, wait)
    return () => clearTimeout(h)
  }, [logWanted, logRunning, task?.status, device.status, device.logPort, logMode, logUartPort, logBaud, t])

  const rebootDevice = useCallback(async () => {
    try {
      await api.deviceReboot(device.status === 'running' ? device.logPort : null)
      setRebootNonce((n) => n + 1)
      toast('success', t('已发送重启指令', 'Reboot command sent'))
    } catch (e) {
      toast('error', t('重启模块失败', 'Reboot failed'), errText(e))
    }
  }, [device, t, toast])

  /* ---------- 下载任务 ---------- */
  // 第一步只支持 USB 直连的 EC718 / EC618；经串口刷机的芯片家族先拦下，免得跑到一半报一堆看不懂的错
  const flashBlocked = useCallback(
    (model: string) => {
      if (canFlash(model)) return false
      const f = familyOf(model)
      toast(
        'warning',
        t(`暂时还不能刷 ${model}（${f ? FAMILIES[f].name : ''}）`, `Flashing ${model} is not supported yet`),
        t('这类芯片要经串口刷机，下一步再支持。现在可以在“固件资源”页下载它的固件。', 'This chip family is flashed over a serial port, which comes in the next step. You can already download its firmware.'),
      )
      return true
    },
    [t, toast],
  )
  const requestDownload = useCallback<Ctx['requestDownload']>(
    (kind, overrides) => {
      if (task?.status === 'running') {
        toast('warning', t('已有下载任务正在进行', 'A download is already running'))
        setTask((tk) => (tk ? { ...tk, dialogOpen: true } : tk))
        return
      }
      const p = project
      if (kind !== 'flash' && !p) {
        toast('error', t('未打开项目', 'No project open'), t('请先在“项目”页选择或创建项目', 'Select or create a project first'))
        return
      }
      let base: DownloadRequest
      if (p && kind !== 'flash') {
        if (p.core.source === 'local' ? !p.core.localPath : !p.core.version || !coreFile(p.model, p.core)) {
          toast('error', t('项目还没有选择底层固件', 'No CORE selected'), t('在“项目信息”里选择固件资源或本地 .soc 文件', 'Choose a firmware in Project info'))
          setPage('projects')
          return
        }
        let files = p.files.filter((f) => f.exists)
        if (!p.options.ignoreDeps) {
          const reach = reachableModules(files, (f) => draftsRef.current[`${p.id}:${f.name}`] ?? contentsRef.current[f.path] ?? '')
          if (reach) files = files.filter((f) => f.type === 'resource' || reach.has(f.name.replace(/\.lua$/, '')))
        }
        base = {
          kind,
          model: p.model,
          firmware: p.core.source === 'local' ? baseName(p.core.localPath) : coreFile(p.model, p.core),
          soc: p.core.source === 'local' ? { source: 'local', path: p.core.localPath } : { source: 'resource', model: p.model, version: p.core.version, file: coreFile(p.model, p.core) },
          scriptFiles: files.map((f) => f.path),
          scriptsBytes: scriptBytes(p),
          scriptCount: files.length,
          projectName: p.name,
          projectId: p.id,
          luacDebug: LUAC_DEBUG[p.options.debugInfo],
          clearFs: p.options.clearFs,
          clearKv: p.options.clearKv,
          fsDir: p.options.burnFs && p.options.burnFsPath ? p.options.burnFsPath : null,
          listenAfter: p.options.listenAfter,
        }
      } else {
        base = {
          kind: 'flash',
          model: 'Air780EHM',
          firmware: '',
          soc: { source: 'local', path: '' },
          scriptFiles: [],
          scriptsBytes: 0,
          scriptCount: 0,
          luacDebug: 99,
          clearFs: false,
          clearKv: false,
          fsDir: null,
          listenAfter: true,
        }
      }
      const req = { ...base, ...overrides }
      if (!flashBlocked(req.model)) setPending(req)
    },
    [project, scriptBytes, t, task, toast, flashBlocked],
  )
  const cancelPending = useCallback(() => setPending(null), [])
  const requestErase = useCallback(
    (what: 'fs' | 'kv') => {
      const p = project
      if (task?.status === 'running') return toast('warning', t('已有下载任务正在进行', 'A download is already running'))
      if (!p || (p.core.source === 'local' ? !p.core.localPath : !p.core.version)) {
        toast('error', t('需要先打开一个选好底层固件的项目', 'Open a project with a CORE first'), t('清除分区要用底层固件里的分区表', 'The partition table comes from the CORE'))
        return
      }
      if (flashBlocked(p.model)) return
      setPending({
        kind: 'erase',
        model: p.model,
        firmware: p.core.source === 'local' ? baseName(p.core.localPath) : coreFile(p.model, p.core),
        soc: p.core.source === 'local' ? { source: 'local', path: p.core.localPath } : { source: 'resource', model: p.model, version: p.core.version, file: coreFile(p.model, p.core) },
        scriptFiles: [],
        scriptsBytes: 0,
        scriptCount: 0,
        projectName: p.name,
        luacDebug: 99,
        clearFs: what === 'fs',
        clearKv: what === 'kv',
        fsDir: null,
        listenAfter: true,
      })
    },
    [project, t, task, toast, flashBlocked],
  )

  const startTask = useCallback(
    async (req: DownloadRequest) => {
      const needFetch = req.soc.source === 'resource' && !cachedPath(req.soc.model, req.soc.version, req.soc.file)
      const erase = req.kind === 'erase'
      const hasScripts = !erase && (req.kind !== 'flash' || req.scriptFiles.length > 0)
      const steps: StepKey[] = []
      if (needFetch) steps.push('fetch')
      steps.push('enter')
      if (req.clearFs || req.clearKv) steps.push('erase')
      if (!erase) {
        steps.push('loader')
        if (req.kind !== 'script') steps.push('boot', 'app', 'cp')
        if (hasScripts) steps.push('script')
      }
      steps.push('reboot')
      const phases: string[] = []
      if (needFetch) phases.push('fetch')
      if (req.clearFs) phases.push('clear-fs')
      if (req.clearKv) phases.push('clear-kv')
      if (!erase) phases.push(req.kind === 'script' ? 'script' : req.kind === 'flash' && !hasScripts ? 'core' : 'full')
      if (req.fsDir && !erase) phases.push('flash-fs')
      const id = `t${Date.now()}`
      const now = Date.now()
      setTask({
        id,
        req,
        status: 'running',
        steps,
        stepIdx: 0,
        progress: 0,
        startedAt: now,
        dialogOpen: true,
        deviceId: device.id,
        phases,
        phase: phases[0],
        logs: [{ t: now, level: 'info', text: `luatos-cli ${cliVersion || ''} · ${req.firmware}`.trim() }],
      })
      const fail = (msg: string) =>
        setTask((tk) =>
          tk && tk.id === id ? { ...tk, status: 'failed', endedAt: Date.now(), error: [msg, msg], logs: [...tk.logs, { t: Date.now(), level: 'err', text: msg }] } : tk,
        )

      try {
        // 下载前先保存编辑器里未保存的修改
        if (req.projectId && Object.keys(draftsRef.current).some((k) => k.startsWith(`${req.projectId}:`))) {
          await saveAll()
          setTask((tk) => (tk && tk.id === id ? { ...tk, logs: [...tk.logs, { t: Date.now(), level: 'info', text: t('已自动保存未保存的脚本', 'Unsaved scripts were saved') }] } : tk))
        }
        let soc = req.soc.source === 'local' ? req.soc.path : cachedPath(req.soc.model, req.soc.version, req.soc.file)
        if (!soc && req.soc.source === 'resource') {
          setTask((tk) => (tk && tk.id === id ? { ...tk, logs: [...tk.logs, { t: Date.now(), level: 'info', text: t(`从合宙服务器下载 ${req.firmware}…`, `Downloading ${req.firmware}…`) }] } : tk))
          soc = await downloadFw(req.soc.model, req.soc.version, req.soc.file)
          if (!soc) return fail(t('底层固件下载失败，请检查网络或在固件资源页手动下载', 'Firmware download failed'))
          setTask((tk) =>
            tk && tk.id === id
              ? { ...tk, stepIdx: Math.max(tk.stepIdx, tk.steps.indexOf('enter')), phase: tk.phases[1], logs: [...tk.logs, { t: Date.now(), level: 'ok', text: t('固件已下载', 'Firmware downloaded') }] }
              : tk,
          )
        }
        if (!soc) return fail(t('没有选择底层固件', 'No firmware selected'))
        const port = device.status === 'boot' ? device.bootPort : null
        await api.flashStart({
          taskId: id,
          kind: erase ? 'erase' : req.kind === 'script' ? 'script' : req.kind === 'flash' && !hasScripts ? 'core' : 'full',
          soc,
          port,
          scriptFiles: hasScripts ? req.scriptFiles : [],
          luacDebug: req.luacDebug,
          clearFs: req.clearFs,
          clearKv: req.clearKv,
          fsDir: req.fsDir,
        })
      } catch (e) {
        fail(errText(e))
      }
    },
    [cachedPath, cliVersion, device, downloadFw, saveAll, t],
  )

  const confirmPending = useCallback(() => {
    if (!pending) return
    startTask(pending)
    setPending(null)
  }, [pending, startTask])

  // 处理 luatos-cli 推过来的进度
  useEffect(
    () =>
      api.onFlash((e) => {
        setTask((tk) => {
          if (!tk || tk.id !== e.taskId) return tk
          const now = Date.now()
          const logs = [...tk.logs]
          const push = (level: TaskLog['level'], text: string, key?: string) => {
            if (!text) return
            const last = logs[logs.length - 1]
            if (key && last?.key === key) logs[logs.length - 1] = { t: now, level, text, key }
            else if (last?.text !== text) logs.push({ t: now, level, text, key })
          }
          const d = e.data as Record<string, unknown>
          let { stepIdx, phase, progress } = tk
          const phaseIdx = Math.max(0, tk.phases.indexOf(phase))
          const weight = (ph: string) => (ph === 'full' || ph === 'core' ? 6 : ph === 'script' ? 4 : 1)
          const total = tk.phases.reduce((s, ph) => s + weight(ph), 0)
          const before = tk.phases.slice(0, phaseIdx).reduce((s, ph) => s + weight(ph), 0)
          const setStep = (s: StepKey) => {
            const i = tk.steps.indexOf(s)
            if (i > stepIdx) stepIdx = i
          }
          switch (e.kind) {
            case 'phase': {
              phase = String(d.name)
              if (phase === 'clear-fs' || phase === 'clear-kv') {
                setStep('erase')
                push('info', phase === 'clear-fs' ? t('清除文件系统…', 'Erasing file system…') : t('清除 KV 存储…', 'Erasing KV…'))
              }
              if (phase === 'flash-fs') push('info', t('烧录文件系统镜像…', 'Flashing file system image…'))
              const pi = tk.phases.indexOf(phase)
              if (pi >= 0) progress = Math.max(progress, (tk.phases.slice(0, pi).reduce((s, ph) => s + weight(ph), 0) / total) * 100)
              break
            }
            case 'progress': {
              const stage = String(d.stage ?? '')
              const region = String(d.region ?? '').toLowerCase()
              const msg = String(d.message ?? '')
              const pct = Number(d.percent ?? -1)
              const mainPhase = phase === 'full' || phase === 'script' || phase === 'core'
              if (mainPhase) {
                if (['Preparing', 'Detecting', 'Connecting', 'Waiting', 'Rebooting', 'Fallback'].includes(stage)) setStep('enter')
                else if (stage === 'AgentBoot') setStep('loader')
                else if (stage === 'Flashing') {
                  if (region.includes('script')) setStep('script')
                  else if (region.includes('boot') || region === 'bl') setStep('boot')
                  else if (region.includes('cp')) setStep('cp')
                  else if (region.includes('ap')) setStep('app')
                } else if (stage === 'Resetting' || stage === 'Done') setStep('reboot')
              } else if (phase === 'flash-fs' && stage === 'Flashing') setStep('script')
              else if (phase.startsWith('clear-') && (stage === 'Resetting' || stage === 'Done') && tk.req.kind === 'erase') setStep('reboot')
              if (pct >= 0) progress = Math.max(progress, ((before + (Math.min(100, pct) / 100) * weight(phase)) / total) * 100)
              if (d.error) push('err', msg)
              else push(stage === 'Done' ? 'ok' : 'info', msg, stage === 'Flashing' ? `flash:${region}` : undefined)
              break
            }
            case 'message': {
              const type = String(d.type ?? '')
              const level = String(d.level ?? (type === 'error' ? 'error' : 'info'))
              const msg = String(d.message ?? (type === 'result' ? JSON.stringify(d.data ?? '') : ''))
              push(level === 'error' || type === 'error' ? 'err' : level === 'warn' ? 'warn' : type === 'result' ? 'ok' : 'info', msg)
              break
            }
            case 'log':
              push((d.level as TaskLog['level']) ?? 'dim', String(d.text ?? ''))
              break
            case 'finished': {
              if (d.ok) {
                push('ok', t(`下载完成，耗时 ${((now - tk.startedAt) / 1000).toFixed(1)} 秒`, `Done in ${((now - tk.startedAt) / 1000).toFixed(1)}s`))
                return { ...tk, logs, status: 'success', progress: 100, stepIdx: tk.steps.length - 1, endedAt: now }
              }
              const err = String(d.error ?? t('下载失败', 'Download failed'))
              push('err', err)
              return { ...tk, logs, status: 'failed', endedAt: now, error: [err, err] }
            }
          }
          return { ...tk, logs: logs.slice(-600), stepIdx, phase, progress: Math.min(99, progress) }
        })
      }),
    [t],
  )

  // 任务结束后的收尾：提示、记录下载时间、重新打开日志
  const lastStatus = useRef<string | null>(null)
  useEffect(() => {
    const st = task?.status ?? null
    if (st === lastStatus.current) return
    lastStatus.current = st
    if (!task || st === 'running') return
    const secs = (((task.endedAt ?? Date.now()) - task.startedAt) / 1000).toFixed(1)
    if (st === 'success') {
      if (task.req.projectId && task.req.kind !== 'erase') updateProject(task.req.projectId, { lastDownload: Date.now() })
      if (task.req.listenAfter) setLogPortOpen(true)
      setRebootNonce((n) => n + 1)
      toast('success', t('下载成功', 'Download complete'), t(`耗时 ${secs} 秒`, `Took ${secs}s`), task.dialogOpen ? undefined : { label: t('查看日志', 'View log'), run: () => setPage('logs') })
    } else if (st === 'failed') {
      toast('error', t('下载失败', 'Download failed'), task.error?.[0])
    }
  }, [task, setLogPortOpen, t, toast, updateProject])

  const setTaskDialog = useCallback((open: boolean) => setTask((tk) => (tk ? { ...tk, dialogOpen: open } : tk)), [])
  const cancelTask = useCallback(() => {
    api.flashCancel().catch(() => {})
    setTask((tk) =>
      tk && tk.status === 'running'
        ? {
            ...tk,
            status: 'failed',
            endedAt: Date.now(),
            error: ['下载已被用户取消，模组可能停在下载模式，请重新下载或按复位键重启。', 'Cancelled. The module may still be in download mode — retry or press reset.'],
            logs: [...tk.logs, { t: Date.now(), level: 'warn', text: t('用户取消', 'Cancelled by user') }],
          }
        : tk,
    )
  }, [t])
  const retryTask = useCallback(() => {
    if (task) startTask({ ...task.req })
  }, [startTask, task])
  const dismissTask = useCallback(() => setTask((tk) => (tk ? { ...tk, dialogOpen: false } : tk)), [])

  const value: Ctx = {
    t,
    lang,
    setLang,
    themePref,
    setThemePref,
    dark,
    platform,
    page,
    setPage,
    navCollapsed,
    setNavCollapsed,
    appInfo,
    cliVersion,
    tildify,
    devices,
    device,
    deviceId,
    setDeviceId,
    setDeviceMeta,
    portOf,
    refreshDevices,
    projects,
    project,
    projectsLoaded,
    setProjectId,
    updateProject,
    addProject,
    removeProject,
    reloadProjects,
    refreshFiles,
    coreLabel,
    coreSpec,
    getContent,
    setDraft,
    isDirty,
    saveFile,
    saveAll,
    newFile,
    tabs,
    activeTab,
    setActiveTab,
    closeTab,
    openFile,
    jump,
    scriptBytes,
    liveDiags,
    contentLoaded,
    syntax,
    checking,
    runSyntaxCheck,
    task,
    pending,
    requestDownload,
    requestErase,
    confirmPending,
    cancelPending,
    setTaskDialog,
    cancelTask,
    retryTask,
    dismissTask,
    fwStatus,
    cachedFw,
    refreshCachedFw,
    versionsOf,
    loadVersions,
    buildsOf,
    loadBuilds,
    downloadFw,
    deleteFw,
    socInfoOf,
    loadSocInfo,
    cachedPath,
    mqttStatus,
    setMqttStatus,
    logPortOpen: logRunning,
    logWanted,
    setLogPortOpen,
    logMode,
    setLogMode,
    logUartPort,
    setLogUartPort,
    logBaud,
    setLogBaud,
    logError,
    rebootNonce,
    rebootDevice,
    toasts,
    toast,
    dismissToast,
    confirm,
    confirmState,
    resolveConfirm,
    wizardOpen,
    setWizardOpen,
  }
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>
}
