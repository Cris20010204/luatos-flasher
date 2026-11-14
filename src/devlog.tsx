/**
 * 设备日志的全局数据：日志行、暂停缓存、从日志里识别出的设备信息、停靠面板的位置和大小。
 * 「设备日志」页和停靠在其它页面（MQTT 调试、串口调试…）旁边的日志面板共用这一份。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useApp } from './store'
import { api, type DevlogEntry } from './lib/api'
import { loadLocal, saveLocal } from './data/types'
import { cx, fmtTime } from './lib/format'

export type LogLevel = 'D' | 'I' | 'W' | 'E'

export interface Line {
  id: number
  t: number
  lv: LogLevel | 'S'
  tag: string
  msg: string
}

export const LV_CLASS: Record<string, string> = {
  D: 'text-fg-3',
  I: 'text-accent',
  W: 'text-warn',
  E: 'text-err',
}
export const LV_BG: Record<string, string> = {
  D: 'bg-surface-3 text-fg-3',
  I: 'bg-primary-soft text-accent',
  W: 'bg-warn-soft text-warn',
  E: 'bg-err-soft text-err',
}

const MAX_LINES = 5000
let lineId = 1

function toLine(e: DevlogEntry): Line {
  const raw = String(e.level ?? '').trim()
  const c = raw.charAt(0).toUpperCase()
  const lv: LogLevel = c === 'D' || c === 'W' || c === 'E' ? c : 'I'
  let tag = e.module ?? ''
  let msg = e.message ?? e.raw ?? ''
  // luatos-cli 文本模式下模块名可能还留在消息里："I/user.main xxx"
  const m = !tag && msg.match(/^([DIWE])\/([\w.\-]+)\s+(.*)$/s)
  if (m) {
    tag = m[2]
    msg = m[3]
  }
  // 模块名里混进了正文：官方 luatos-cli 只按空格拆，老版本 EC618 固件的 log.info 用制表符分隔，
  // 整行都会落进模块名（Air780EG 跑 mpu6050 示例时，模块名显示成 “user.6050g…”、正文为空）
  const ws = tag.search(/\s/)
  if (ws > 0) {
    msg = tag.slice(ws + 1) + (msg ? ` ${msg}` : '')
    tag = tag.slice(0, ws)
  }
  return { id: lineId++, t: Date.now(), lv: m ? (m[1] as LogLevel) : lv, tag, msg }
}

export interface DevInfo {
  firmware?: string
  model?: string
  imei?: string
  ip?: string
  network?: string
  rsrp?: string
  rsrq?: string
  snr?: string
  csq?: number
  cell?: string
  script?: string
  boot?: string
}

/** 固件 pm 模块打印的开机原因（`pm poweron: Power/Reset`）→ 中文；不认识的原样显示 */
const BOOT_TEXT: Record<string, string> = {
  'power/reset': '上电 / 复位',
}

/** 从日志里尽量识别设备信息（固件、型号、IMEI、联网、信号、脚本、启动原因），识别不到就显示 — */
function sniff(info: DevInfo, text: string): DevInfo | null {
  let next = { ...info }
  let m: RegExpMatchArray | null
  // 新一次开机的第一行：清掉上一轮的联网、信号、脚本、启动原因，只留固件、型号、IMEI
  if (/\bmain_entry\b/.test(text)) next = { firmware: info.firmware, model: info.model, imei: info.imei }
  // +FW: LuatOS V2056 112 64bit —— 版本、编号、位数都有，优先用它
  if ((m = text.match(/\+FW:\s*LuatOS\s+(V\d+)\s+(\d+)\s+(\d+)\s*bit/i))) next.firmware = `${m[1]} · ${m[2]}号 · ${m[3]}位`
  if ((m = text.match(/LuatOS-SoC_(V\d+)_(Air[0-9A-Z]+)(?:_(\d+))?/))) {
    next.model = m[2]
    if (!next.firmware || next.firmware.startsWith('LuatOS-SoC_')) next.firmware = m[0]
  }
  if ((m = text.match(/\b(86\d{13})\b/))) next.imei = m[1]
  // 联网：mobile 打印 “NETIF_LINK_ON -> IP_READY”（不带 IP）；固件状态行 “+PDP: OK”
  if (/IP_READY|\+PDP:\s*OK/.test(text)) {
    next.network = '4G'
    if ((m = text.match(/IP_READY\s+(\d+\.\d+\.\d+\.\d+)/))) next.ip = m[1]
  }
  if (/IP_LOSE|NETIF_LINK_OFF/.test(text)) {
    next.network = undefined
    next.ip = undefined
  }
  if ((m = text.match(/rsrp[:=\s]+(-?\d+)/i))) next.rsrp = m[1]
  if ((m = text.match(/rsrq[:=\s]+(-?\d+)/i))) next.rsrq = m[1]
  if ((m = text.match(/snr[:=\s]+(-?\d+)/i))) next.snr = m[1]
  // 固件自带的信号上报：+SOCSQ: RSRP,RSRQ,SNR
  if ((m = text.match(/\+SOCSQ:\s*(-?\d+),\s*(-?\d+),\s*(-?\d+)/))) [next.rsrp, next.rsrq, next.snr] = [m[1], m[2], m[3]]
  if ((m = text.match(/\bcsq[:=\s]+(\d+)/i))) next.csq = Number(m[1])
  if ((m = text.match(/\beci[:=\s]+(0x[0-9a-f]+|\d+)/i))) next.cell = m[1]
  // 脚本打印的 “main 项目名 版本”，模块名可能是 user.main
  if ((m = text.match(/(?:^|[./])main\s+(\S+)\s+(\d{3}\.\d{3}\.\d{3})/))) next.script = `${m[1]} ${m[2]}`
  // 启动原因：优先用 pm 打印的文字；只有 “poweron reason: 0 0 0” 这种数字时才显示数字
  if ((m = text.match(/\bpm\s+poweron:\s*(.+?)\s*$/i))) next.boot = BOOT_TEXT[m[1].toLowerCase()] ?? m[1]
  else if (!next.boot && (m = text.match(/poweron reason[:\s]+([\d\s]+?)\s*$/i))) next.boot = `原因码 ${m[1].trim()}`
  return JSON.stringify(next) === JSON.stringify(info) ? null : next
}

export type DockSide = 'bottom' | 'right' | 'float'
/** 悬浮窗相对内容区左上角的位置和大小（px），显示时会夹回内容区内 */
export interface FloatRect {
  x: number
  y: number
  w: number
  h: number
}
export interface DockState {
  open: boolean
  side: DockSide
  /** 下方停靠时是高度，右侧停靠时是宽度（px） */
  size: number
  /** 悬浮模式的位置和大小；没有时放在内容区右下角 */
  float?: FloatRect
}

interface DevlogCtx {
  lines: Line[]
  clear: () => void
  printing: boolean
  /** 暂停期间收到、还没显示的行数 */
  heldCount: number
  togglePrinting: () => void
  info: DevInfo
  counts: Record<LogLevel, number>
  dock: DockState
  setDock: (patch: Partial<DockState>) => void
  toggleDock: () => void
}

const Ctx = createContext<DevlogCtx | null>(null)

type DockCtx = Pick<DevlogCtx, 'dock' | 'setDock' | 'toggleDock'>
/**
 * 日志面板的开关和位置单独一个 context。窗口外壳、状态栏、工具栏按钮只关心这个；
 * 如果它们订阅整个 useDevlog()，每来一批日志（最快 60 ms 一次）整个窗口连同所有页面都要重渲染，
 * 代码页滚动会一卡一卡（2026-11-14 用户反馈，MPU6050 每秒 10 行日志时明显）。
 */
const DockContext = createContext<DockCtx | null>(null)

export function useLogDock() {
  const c = useContext(DockContext)
  if (!c) throw new Error('useLogDock 必须在 DevlogProvider 里使用')
  return c
}

export function useDevlog() {
  const c = useContext(Ctx)
  if (!c) throw new Error('useDevlog 必须在 DevlogProvider 里使用')
  return c
}

export function DevlogProvider({ children }: { children: ReactNode }) {
  const { t, setDeviceMeta, rebootNonce } = useApp()
  const [lines, setLines] = useState<Line[]>([])
  const [printing, setPrinting] = useState(true)
  const held = useRef<Line[]>([])
  const [heldCount, setHeldCount] = useState(0)
  const [info, setInfo] = useState<DevInfo>({})
  const printingRef = useRef(printing)
  printingRef.current = printing

  const push = useCallback((ls: Line[]) => setLines((cur) => [...cur, ...ls].slice(-MAX_LINES)), [])

  // 接收 luatos-cli 推过来的日志（与页面无关，一直在收）
  useEffect(() => {
    let pending: Line[] = []
    let timer: ReturnType<typeof setTimeout> | null = null
    const flush = () => {
      timer = null
      const batch = pending
      pending = []
      if (printingRef.current) push(batch)
      else {
        held.current = [...held.current, ...batch].slice(-MAX_LINES)
        setHeldCount(held.current.length)
      }
    }
    const off = api.onDevlog((e) => {
      const line = toLine(e)
      pending.push(line)
      setInfo((cur) => sniff(cur, `${line.tag} ${line.msg}`.trim()) ?? sniff(cur, line.msg) ?? cur)
      if (!timer) timer = setTimeout(flush, 60)
    })
    return () => {
      off()
      if (timer) clearTimeout(timer)
    }
  }, [push])

  // 识别到的型号/IMEI 同步到顶部设备选择器
  useEffect(() => {
    if (info.model || info.imei) setDeviceMeta({ model: info.model, imei: info.imei })
  }, [info.model, info.imei, setDeviceMeta])

  // 模组重启/下载完成：画一条分隔线，并清空上一轮识别到的联网信息
  const firstReboot = useRef(rebootNonce)
  useEffect(() => {
    if (rebootNonce === firstReboot.current) return
    push([{ id: lineId++, t: Date.now(), lv: 'S', tag: '', msg: t('—— 模组重启 ——', '—— module rebooted ——') }])
    setInfo((i) => ({ firmware: i.firmware, model: i.model, imei: i.imei }))
  }, [rebootNonce]) // eslint-disable-line react-hooks/exhaustive-deps

  const togglePrinting = useCallback(() => {
    if (!printingRef.current && held.current.length) {
      push(held.current)
      held.current = []
      setHeldCount(0)
    }
    setPrinting((p) => !p)
  }, [push])

  const clear = useCallback(() => {
    setLines([])
    held.current = []
    setHeldCount(0)
  }, [])

  const counts = useMemo(() => {
    const c = { D: 0, I: 0, W: 0, E: 0 }
    lines.forEach((l) => l.lv !== 'S' && c[l.lv]++)
    return c
  }, [lines])

  const [dock, setDockRaw] = useState<DockState>(() => ({ open: false, side: 'bottom', size: 260, ...loadLocal<Partial<DockState>>('logDock', {}) }))
  const setDock = useCallback((patch: Partial<DockState>) => {
    setDockRaw((d) => {
      const next = { ...d, ...patch }
      saveLocal('logDock', next)
      return next
    })
  }, [])
  const toggleDock = useCallback(() => setDock({ open: !dock.open }), [dock.open, setDock])

  const value = useMemo<DevlogCtx>(
    () => ({ lines, clear, printing, heldCount, togglePrinting, info, counts, dock, setDock, toggleDock }),
    [lines, clear, printing, heldCount, togglePrinting, info, counts, dock, setDock, toggleDock],
  )
  const dockValue = useMemo<DockCtx>(() => ({ dock, setDock, toggleDock }), [dock, setDock, toggleDock])
  return (
    <DockContext.Provider value={dockValue}>
      <Ctx.Provider value={value}>{children}</Ctx.Provider>
    </DockContext.Provider>
  )
}

/** 按搜索词和级别过滤 */
export function filterLines(lines: Line[], q: string, levels: Record<LogLevel, boolean>) {
  const needle = q.trim().toLowerCase()
  return lines.filter((l) => (l.lv === 'S' || levels[l.lv]) && (!needle || `${l.tag} ${l.msg}`.toLowerCase().includes(needle)))
}

function highlight(s: string, k: string) {
  k = k.trim()
  if (!k) return s
  const parts = s.split(new RegExp(`(${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'))
  return parts.map((p, i) =>
    p.toLowerCase() === k.toLowerCase() ? (
      <mark key={i} className="rounded-sm bg-[#fde047]/70 px-0.5 text-[#111]">
        {p}
      </mark>
    ) : (
      p
    ),
  )
}

/** 日志行列表（设备日志页和停靠面板共用）。自动滚动时新行出现就滚到底。 */
export function LogLines({
  shown,
  hl = '',
  autoScroll,
  compact,
  before,
  empty,
}: {
  shown: Line[]
  hl?: string
  autoScroll: boolean
  /** 窄面板：模块名列更窄、左右留白更小 */
  compact?: boolean
  /** 列表最前面的提示（如打开失败） */
  before?: ReactNode
  /** 没有行时显示的文字 */
  empty: string
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (autoScroll && boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight
  }, [shown.length, autoScroll])
  const px = compact ? 'px-2.5' : 'px-4'
  return (
    <div ref={boxRef} className="scroll-thin absolute inset-0 overflow-auto py-1.5 font-mono text-[12px] leading-[20px] [tab-size:4]">
      {before}
      {shown.length === 0 && <div className="px-4 py-6 text-center text-xs text-fg-3">{empty}</div>}
      {shown.map((l) =>
        l.lv === 'S' ? (
          <div key={l.id} className={cx('my-1 flex items-center gap-3 text-2xs text-fg-3', px)}>
            <span className="h-px flex-1 bg-line" />
            {l.msg}
            <span className="h-px flex-1 bg-line" />
          </div>
        ) : (
          <div key={l.id} className={cx('flex hover:bg-hover', compact ? 'gap-2' : 'gap-3', px, l.lv === 'E' && 'bg-err-soft', l.lv === 'W' && 'bg-warn-soft/50')}>
            <span className="shrink-0 text-fg-3">{fmtTime(new Date(l.t))}</span>
            <span className={cx('w-3 shrink-0 font-semibold', LV_CLASS[l.lv])}>{l.lv}</span>
            <span className={cx('shrink-0 truncate text-syn-lib', compact ? 'w-[72px]' : 'w-[86px]')} title={l.tag}>
              {l.tag}
            </span>
            <span className={cx('min-w-0 break-all whitespace-pre-wrap', l.lv === 'E' ? 'text-err' : l.lv === 'W' ? 'text-warn' : 'text-fg')}>{highlight(l.msg, hl)}</span>
          </div>
        ),
      )}
    </div>
  )
}
