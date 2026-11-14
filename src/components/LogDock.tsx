/**
 * 设备日志面板：停靠在页面下方、右侧，或作为悬浮窗浮在页面上。
 * 在 MQTT 调试、串口调试等页面里边发消息边看模组日志，不用来回切页面。
 * 停靠时拖面板边缘调大小；悬浮时拖标题栏移动、拖右下角调大小。模式、位置、大小、开关状态记在本机。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownToLine, Eraser, Maximize2, PanelBottom, PanelRight, Pause, PictureInPicture2, Play, ScrollText, Search, X } from 'lucide-react'
import { useApp } from '../store'
import { filterLines, LogLines, LV_BG, useDevlog, useLogDock, type DockSide, type FloatRect, type LogLevel } from '../devlog'
import { Badge, Button, IconButton, Input } from './ui'
import { cx } from '../lib/format'

/** 停靠时面板最小高 / 宽 */
const MIN = 140
/** 悬浮窗最小宽高、离内容区边缘的默认间距 */
const FLOAT_MIN_W = 340
const FLOAT_MIN_H = 160
const FLOAT_GAP = 16

/** 把悬浮窗夹回内容区内；没有记录时放在右下角 */
function fitFloat(r: FloatRect | undefined, pw: number, ph: number): FloatRect {
  const w = Math.min(Math.max(r?.w ?? 600, FLOAT_MIN_W), Math.max(FLOAT_MIN_W, pw))
  const h = Math.min(Math.max(r?.h ?? 320, FLOAT_MIN_H), Math.max(FLOAT_MIN_H, ph))
  const x = r ? r.x : pw - w - FLOAT_GAP
  const y = r ? r.y : ph - h - FLOAT_GAP
  return { x: Math.round(Math.max(0, Math.min(x, pw - w))), y: Math.round(Math.max(0, Math.min(y, ph - h))), w: Math.round(w), h: Math.round(h) }
}

/** 拖动期间的通用处理：跟随指针，松开后收尾 */
function dragWith(cursor: string, move: (ev: PointerEvent) => void, done: () => void) {
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    done()
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  document.body.style.cursor = cursor
  document.body.style.userSelect = 'none'
}

export function LogDock() {
  const { t, device, logPortOpen, logMode, logUartPort, logError, setPage } = useApp()
  const { lines, clear, printing, heldCount, togglePrinting, counts, dock, setDock } = useDevlog()
  const [q, setQ] = useState('')
  const [levels, setLevels] = useState<Record<LogLevel, boolean>>({ D: true, I: true, W: true, E: true })
  const [autoScroll, setAutoScroll] = useState(true)
  const shown = useMemo(() => filterLines(lines, q, levels), [lines, q, levels])
  const rootRef = useRef<HTMLDivElement>(null)
  const bottom = dock.side === 'bottom'
  const float = dock.side === 'float'
  const portName = logMode === 'usb' ? device.logPort || device.port || '' : logUartPort

  // 悬浮窗要知道内容区多大，窗口缩放时把它夹回可见范围
  const [area, setArea] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const parent = rootRef.current?.parentElement
    if (!float || !parent) return
    const measure = () => setArea({ w: parent.clientWidth, h: parent.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(parent)
    return () => ro.disconnect()
  }, [float])
  // 拖动中的位置只放在本地，松手再记下来，免得每一帧都写本机存储
  const [dragRect, setDragRect] = useState<FloatRect | null>(null)
  const rect = float && area.w > 0 ? (dragRect ?? fitFloat(dock.float, area.w, area.h)) : null

  // 停靠时拖边缘调整大小：下方停靠拖上边缘，右侧停靠拖左边缘
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault()
    const parent = rootRef.current?.parentElement?.getBoundingClientRect()
    const total = parent ? (bottom ? parent.height : parent.width) : 800
    const start = bottom ? e.clientY : e.clientX
    const from = dock.size
    dragWith(
      bottom ? 'row-resize' : 'col-resize',
      (ev) => {
        const d = start - (bottom ? ev.clientY : ev.clientX)
        setDock({ size: Math.round(Math.max(MIN, Math.min(total - MIN, from + d))) })
      },
      () => {},
    )
  }

  // 悬浮时拖标题栏移动（点在按钮、输入框上不算）、拖右下角调大小
  const startFloat = (e: React.PointerEvent, mode: 'move' | 'resize') => {
    if (!rect) return
    if (mode === 'move' && (e.target as HTMLElement).closest('button, input, label, a')) return
    e.preventDefault()
    const sx = e.clientX
    const sy = e.clientY
    const from = rect
    let last = from
    dragWith(
      mode === 'move' ? 'grabbing' : 'nwse-resize',
      (ev) => {
        const dx = ev.clientX - sx
        const dy = ev.clientY - sy
        last =
          mode === 'move'
            ? fitFloat({ ...from, x: from.x + dx, y: from.y + dy }, area.w, area.h)
            : fitFloat({ ...from, w: Math.min(from.w + dx, area.w - from.x), h: Math.min(from.h + dy, area.h - from.y) }, area.w, area.h)
        setDragRect(last)
      },
      () => {
        setDock({ float: last })
        setDragRect(null)
      },
    )
  }

  const switchTo = (side: DockSide) => {
    if (side === dock.side) return
    setDock(side === 'float' ? { side } : { side, size: side === 'right' ? 460 : 260 })
  }

  const modes: { side: DockSide; icon: typeof PanelBottom; label: string }[] = [
    { side: 'bottom', icon: PanelBottom, label: t('停靠在下方', 'Dock bottom') },
    { side: 'right', icon: PanelRight, label: t('停靠在右侧', 'Dock right') },
    { side: 'float', icon: PictureInPicture2, label: t('悬浮窗', 'Floating') },
  ]

  return (
    <div
      ref={rootRef}
      className={cx(
        'flex flex-col bg-surface',
        float
          ? 'absolute z-30 overflow-hidden rounded-lg border border-line shadow-[0_16px_40px_-12px_rgba(0,0,0,0.35)]'
          : cx('relative shrink-0', bottom ? 'border-t border-line' : 'border-l border-line'),
        float && !rect && 'invisible',
      )}
      style={float ? (rect ? { left: rect.x, top: rect.y, width: rect.w, height: rect.h } : { right: FLOAT_GAP, bottom: FLOAT_GAP, width: 600, height: 320 }) : bottom ? { height: dock.size } : { width: dock.size }}
    >
      {/* 停靠时的拖动条 */}
      {!float && (
        <div
          onPointerDown={startResize}
          title={t('拖动调整大小', 'Drag to resize')}
          className={cx('absolute z-10 hover:bg-primary/40', bottom ? 'inset-x-0 -top-[3px] h-[6px] cursor-row-resize' : 'inset-y-0 -left-[3px] w-[6px] cursor-col-resize')}
        />
      )}
      <div
        onPointerDown={float ? (e) => startFloat(e, 'move') : undefined}
        title={float ? t('拖动标题栏移动', 'Drag to move') : undefined}
        className={cx('flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line bg-surface-2 px-2.5 py-1', float && 'cursor-grab active:cursor-grabbing')}
      >
        <ScrollText size={14} className="text-accent" />
        <span className="text-xs font-semibold text-fg">{t('设备日志', 'Device log')}</span>
        {logPortOpen ? (
          <span className="flex items-center gap-1 text-2xs text-ok" title={portName}>
            <span className={cx('size-1.5 rounded-full bg-ok', printing && 'anim-pulse')} />
            {printing ? t('实时', 'Live') : t('已暂停', 'Paused')}
          </span>
        ) : (
          <span className="text-2xs text-fg-3">{device.status === 'boot' ? t('下载模式', 'Download mode') : t('日志口未连接', 'Not connected')}</span>
        )}
        {!printing && heldCount > 0 && <Badge tone="warn">{t(`缓存 ${heldCount} 行`, `${heldCount} held`)}</Badge>}
        <Input size="sm" icon={Search} placeholder={t('搜索', 'Search')} value={q} onChange={(e) => setQ(e.target.value)} className="ml-1 w-[140px]" />
        <div className="flex items-center gap-0.5">
          {(['D', 'I', 'W', 'E'] as LogLevel[]).map((lv) => (
            <button
              key={lv}
              type="button"
              onClick={() => setLevels((s) => ({ ...s, [lv]: !s[lv] }))}
              className={cx('flex h-5 items-center gap-1 rounded px-1 font-mono text-2xs font-semibold transition-colors', levels[lv] ? LV_BG[lv] : 'text-fg-3 line-through opacity-60 hover:bg-hover')}
              title={t('切换级别', 'Toggle level')}
            >
              {lv}
              <span className="font-normal opacity-70">{counts[lv]}</span>
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-0.5">
          <IconButton size="sm" icon={printing ? Pause : Play} label={printing ? t('停止打印', 'Pause') : t('开始打印', 'Resume')} active={!printing} onClick={togglePrinting} />
          <IconButton size="sm" icon={Eraser} label={t('清除打印', 'Clear')} onClick={clear} />
          <IconButton size="sm" icon={ArrowDownToLine} label={t('自动滚动', 'Auto scroll')} active={autoScroll} onClick={() => setAutoScroll(!autoScroll)} />
          <span className="mx-0.5 h-4 w-px bg-line" />
          {modes.map((m) => (
            <IconButton key={m.side} size="sm" icon={m.icon} label={m.label} active={dock.side === m.side} onClick={() => switchTo(m.side)} />
          ))}
          <span className="mx-0.5 h-4 w-px bg-line" />
          <IconButton size="sm" icon={Maximize2} label={t('打开设备日志页', 'Open log page')} onClick={() => setPage('logs')} />
          <IconButton size="sm" icon={X} label={t('关闭面板', 'Close panel')} onClick={() => setDock({ open: false })} />
        </div>
      </div>
      <div className="relative min-h-0 flex-1 bg-editor">
        <LogLines
          shown={shown}
          autoScroll={autoScroll}
          compact
          before={
            logError && !logPortOpen ? (
              <div className="mx-2.5 my-1.5 rounded-md border border-err/30 bg-err-soft px-2.5 py-1.5 font-sans text-xs text-fg">
                {t('日志口打开失败：', 'Log port failed: ')}
                {logError}
              </div>
            ) : null
          }
          empty={
            lines.length
              ? t('没有符合筛选条件的日志', 'No lines match the filter')
              : logPortOpen
                ? t('等待日志输出…', 'Waiting for output…')
                : device.status === 'offline'
                  ? t('未连接设备', 'No device connected')
                  : t('正在打开日志口…', 'Opening log port…')
          }
        />
      </div>
      {/* 悬浮时右下角调大小 */}
      {float && (
        <div
          onPointerDown={(e) => startFloat(e, 'resize')}
          title={t('拖动调整大小', 'Drag to resize')}
          className="absolute right-0 bottom-0 z-10 size-3.5 cursor-nwse-resize"
          style={{ background: 'linear-gradient(135deg, transparent 50%, var(--fg-3) 50%)', opacity: 0.45 }}
        />
      )}
    </div>
  )
}

/** 各页面工具栏里的开关按钮（带文字，只放图标用户找不到） */
export function LogDockToggle() {
  const { t } = useApp()
  const { dock, toggleDock } = useLogDock()
  return (
    <Button
      size="xs"
      variant={dock.open ? 'subtle' : 'secondary'}
      icon={ScrollText}
      onClick={toggleDock}
      title={dock.open ? t('收起设备日志面板', 'Hide device log panel') : t('在此页显示设备日志（可停靠在下方、右侧或悬浮）', 'Show device log here (dock bottom, right or float)')}
      className={cx('mr-1', dock.open && 'text-accent')}
    >
      {dock.open ? t('收起日志', 'Hide log') : t('设备日志', 'Device log')}
    </Button>
  )
}
