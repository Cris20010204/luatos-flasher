import { useEffect, useMemo, useState } from 'react'
import {
  ArrowDownToLine,
  Ban,
  Download,
  Eraser,
  Highlighter,
  Pause,
  Play,
  Plug,
  PlugZap,
  Power,
  RefreshCw,
  RotateCcw,
  Search,
  Unplug,
  Upload,
  Usb,
  Zap,
} from 'lucide-react'
import { useApp } from '../store'
import { Badge, Button, EmptyState, IconButton, Input, Segmented, Select, Divider } from '../components/ui'
import { api, dialogs, errText, type SerialPortItem } from '../lib/api'
import { cx, fmtTime } from '../lib/format'
import { filterLines, LogLines, LV_BG, useDevlog, type LogLevel } from '../devlog'

export default function DeviceLogPage() {
  const { t, device, logPortOpen, logWanted, setLogPortOpen, rebootDevice, requestDownload, requestErase, toast, refreshDevices, logMode, setLogMode, logUartPort, setLogUartPort, logBaud, setLogBaud, logError, task } = useApp()
  const { lines, clear, printing, heldCount, togglePrinting, info, counts } = useDevlog()
  const source = logMode
  const [ports, setPorts] = useState<SerialPortItem[]>([])
  const [baud, setBaud] = useState(String(logBaud))
  const [q, setQ] = useState('')
  const [hl, setHl] = useState('')
  const [levels, setLevels] = useState<Record<LogLevel, boolean>>({ D: true, I: true, W: true, E: true })
  const [autoScroll, setAutoScroll] = useState(true)

  useEffect(() => {
    if (source === 'uart') api.listSerialPorts().then(setPorts).catch(() => setPorts([]))
  }, [source])

  const shown = useMemo(() => filterLines(lines, q, levels), [lines, q, levels])

  const exportLog = async () => {
    const name = `${info.model || device.model || 'device'}_${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}.log`
    const dest = await dialogs.saveFile(t('导出日志', 'Export log'), name, ['log', 'txt'])
    if (!dest) return
    const text = lines.map((l) => (l.lv === 'S' ? l.msg : `${fmtTime(new Date(l.t))} ${l.lv}/${l.tag} ${l.msg}`)).join('\n')
    try {
      await api.writeText(dest, text + '\n')
      toast('success', t('日志已导出', 'Log exported'), dest, { label: t('在访达中显示', 'Reveal'), run: () => dialogs.reveal(dest) })
    } catch (e) {
      toast('error', t('导出失败', 'Export failed'), errText(e))
    }
  }

  const portName = source === 'usb' ? device.logPort || device.port || '—' : logUartPort || '—'
  const running = device.status === 'running'
  const live = logPortOpen
  const na = '—'
  const infoRows: [string, string, React.ReactNode][] = [
    ['启动原因', 'Boot reason', info.boot ?? na],
    [
      '系统状态',
      'System',
      device.status === 'boot' ? (
        <Badge tone="warn" dot>
          {t('下载模式', 'Download')}
        </Badge>
      ) : info.network && running ? (
        <Badge tone="ok" dot>
          {t('已联网', 'Online')} {info.ip}
        </Badge>
      ) : running ? (
        <Badge dot>{t('运行中', 'Running')}</Badge>
      ) : (
        na
      ),
    ],
    ['固件版本', 'Firmware', info.firmware ?? na],
    ['模块型号', 'Module', info.model ?? (device.model || na)],
    ['信号强度', 'Signal', info.csq !== undefined ? <SignalBars v={info.csq} /> : na],
    ['IMEI', 'IMEI', info.imei ?? (device.imei || na)],
    ['小区信号', 'Cell signal', info.rsrp ? `RSRP ${info.rsrp}${info.rsrq ? ` / RSRQ ${info.rsrq}` : ''}${info.snr ? ` / SNR ${info.snr}` : ''}` : na],
    ['脚本', 'Script', info.script ?? (info.cell ? `ECI ${info.cell}` : na)],
  ]

  return (
    <div className="flex h-full flex-col">
      {/* device info grid */}
      <div className="grid shrink-0 grid-cols-4 border-b border-line bg-surface">
        {infoRows.map(([zh, en, v], i) => (
          <div key={zh} className={cx('flex min-w-0 items-center gap-3 px-4 py-2.5', i % 4 !== 3 && 'border-r border-line', i < 4 && 'border-b border-line')}>
            <span className="w-16 shrink-0 text-2xs text-fg-3">{t(zh, en)}</span>
            <span className="min-w-0 truncate font-mono text-xs text-fg">{v}</span>
          </div>
        ))}
      </div>

      {/* controls */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-surface px-3 py-2">
        <Segmented
          size="sm"
          value={source}
          onChange={(v) => {
            setLogMode(v)
            if (logPortOpen) {
              setLogPortOpen(false)
              setTimeout(() => setLogPortOpen(true), 400)
            }
          }}
          options={[
            { value: 'usb', label: t('4G 模块 USB 打印', '4G module USB log'), icon: Usb },
            { value: 'uart', label: t('通用串口打印', 'Generic UART log'), icon: Plug },
          ]}
        />
        {source === 'uart' && (
          <>
            <Select size="sm" mono value={logUartPort} onChange={(e) => setLogUartPort(e.target.value)} className="w-[220px]" onFocus={() => api.listSerialPorts().then(setPorts).catch(() => {})}>
              <option value="">{t('选择串口…', 'Choose port…')}</option>
              {ports.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name} · {p.desc}
                </option>
              ))}
            </Select>
            <Input
              size="sm"
              mono
              value={baud}
              onChange={(e) => setBaud(e.target.value.replace(/\D/g, ''))}
              onBlur={() => Number(baud) > 0 && setLogBaud(Number(baud))}
              className="w-[92px]"
              suffix={<span className="text-2xs text-fg-3">bps</span>}
            />
          </>
        )}
        <Divider vertical className="mx-1" />
        <Button size="sm" icon={printing ? Pause : Play} onClick={togglePrinting} disabled={!live}>
          {printing ? t('停止打印', 'Stop') : t('开始打印', 'Resume')}
        </Button>
        <Button size="sm" icon={Eraser} onClick={clear}>
          {t('清除打印', 'Clear')}
        </Button>
        <Button size="sm" icon={Power} onClick={rebootDevice} disabled={device.status !== 'running' || task?.status === 'running'}>
          {t('重启模块', 'Reboot module')}
        </Button>
        <Button
          size="sm"
          icon={logWanted ? Unplug : PlugZap}
          onClick={() => {
            setLogPortOpen(!logWanted)
            toast('info', logWanted ? t('已关闭串口', 'Port closed') : t('正在打开串口', 'Opening port'), portName)
          }}
          disabled={source === 'usb' ? device.status === 'offline' : !logUartPort}
        >
          {logWanted ? t('关闭串口', 'Close port') : t('打开串口', 'Open port')}
        </Button>
        <Button
          size="sm"
          icon={RotateCcw}
          disabled={!logWanted}
          onClick={() => {
            setLogPortOpen(false)
            setTimeout(() => setLogPortOpen(true), 600)
            toast('success', t('正在重启串口', 'Restarting port'), portName)
          }}
        >
          {t('重启串口', 'Restart port')}
        </Button>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="text-2xs text-fg-3">{t('快捷操作', 'Quick')}</span>
          <Button size="sm" variant="subtle" icon={Upload} onClick={() => requestDownload('script')}>
            {t('下载脚本', 'Download Script')}
          </Button>
          <Button size="sm" variant="subtle" icon={Ban} onClick={() => requestErase('fs')} disabled={device.status === 'offline'}>
            {t('清除 fs', 'Erase fs')}
          </Button>
          <Button size="sm" variant="subtle" icon={Ban} onClick={() => requestErase('kv')} disabled={device.status === 'offline'}>
            {t('清除 kv', 'Erase kv')}
          </Button>
        </div>
      </div>

      {/* log toolbar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-line bg-surface-2 px-3 py-1.5">
        <Input size="sm" icon={Search} placeholder={t('搜索日志', 'Search log')} value={q} onChange={(e) => setQ(e.target.value)} className="w-[220px]" />
        <div className="flex items-center gap-1">
          {(['D', 'I', 'W', 'E'] as LogLevel[]).map((lv) => (
            <button
              key={lv}
              type="button"
              onClick={() => setLevels((s) => ({ ...s, [lv]: !s[lv] }))}
              className={cx('flex h-6 items-center gap-1 rounded-md px-1.5 font-mono text-2xs font-semibold transition-colors', levels[lv] ? LV_BG[lv] : 'text-fg-3 line-through opacity-60 hover:bg-hover')}
              title={t('切换级别', 'Toggle level')}
            >
              {lv}
              <span className="font-normal opacity-70">{counts[lv]}</span>
            </button>
          ))}
        </div>
        <Input size="sm" icon={Highlighter} placeholder={t('高亮关键字', 'Highlight')} value={hl} onChange={(e) => setHl(e.target.value)} className="w-[150px]" />
        <div className="ml-auto flex items-center gap-2">
          {live && printing && (
            <span className="flex items-center gap-1.5 text-2xs text-ok">
              <span className="anim-pulse size-1.5 rounded-full bg-ok" />
              {t('实时', 'Live')} · <span className="font-mono">{portName}</span>
            </span>
          )}
          {live && !printing && <Badge tone="warn">{t(`已暂停打印（缓存 ${heldCount} 行）`, `Paused (${heldCount} held)`)}</Badge>}
          <span className="font-mono text-2xs text-fg-3">
            {shown.length.toLocaleString()} / {lines.length.toLocaleString()} {t('行', 'lines')}
          </span>
          <IconButton icon={ArrowDownToLine} label={t('自动滚动', 'Auto scroll')} active={autoScroll} onClick={() => setAutoScroll(!autoScroll)} size="sm" />
          <Button size="xs" variant="ghost" icon={Download} onClick={exportLog} disabled={!lines.length}>
            {t('导出', 'Export')}
          </Button>
        </div>
      </div>

      {/* log body */}
      <div className="relative min-h-0 flex-1 bg-editor">
        {source === 'usb' && device.status === 'offline' && !lines.length ? (
          <EmptyState icon={Usb} tone="err" title={t('未连接设备', 'No device connected')} desc={t('请用 USB 数据线连接模组。插上后会自动打开日志口。', 'Connect a module over USB. The log port opens automatically.')}>
            <Button icon={RefreshCw} onClick={refreshDevices}>
              {t('刷新设备', 'Refresh')}
            </Button>
          </EmptyState>
        ) : source === 'usb' && device.status === 'boot' && !lines.length ? (
          <EmptyState icon={Zap} tone="warn" title={t('设备处于下载模式', 'Device in download mode')} desc={t('下载模式下模组不输出日志。下载完成后会自动重启；手动按 BOOT 进入的，等十几秒会自己退出，或按一下复位键。', 'No logs in download mode. It reboots after flashing, or press RESET.')} />
        ) : !logWanted && !lines.length ? (
          <EmptyState icon={Unplug} title={t('串口未打开', 'Port closed')} desc={t('日志口已关闭，打开后继续接收模组打印。', 'The log port is closed. Open it to resume receiving logs.')}>
            <Button variant="primary" icon={PlugZap} onClick={() => setLogPortOpen(true)} disabled={source === 'uart' && !logUartPort}>
              {t('打开串口', 'Open port')}
            </Button>
          </EmptyState>
        ) : (
          <LogLines
            shown={shown}
            hl={hl}
            autoScroll={autoScroll}
            before={
              logError && !live ? (
                <div className="mx-4 my-1.5 rounded-md border border-err/30 bg-err-soft px-2.5 py-1.5 font-sans text-xs text-fg">
                  {t('日志口打开失败：', 'Log port failed: ')}
                  {logError}
                </div>
              ) : null
            }
            empty={lines.length ? t('没有符合筛选条件的日志', 'No lines match the filter') : live ? t('等待日志输出…', 'Waiting for output…') : t('正在打开日志口…', 'Opening log port…')}
          />
        )}
      </div>
    </div>
  )
}

function SignalBars({ v }: { v: number }) {
  const lvl = Math.min(4, Math.ceil(v / 7.75))
  return (
    <span className="inline-flex items-center gap-2">
      <span className="inline-flex items-end gap-[2px]">
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className={cx('w-[3px] rounded-[1px]', i <= lvl ? 'bg-ok' : 'bg-line-strong')} style={{ height: 3 + i * 2.5 }} />
        ))}
      </span>
      {/* CSQ 换算的是 RSSI（总接收功率），和右边小区信号的 RSRP 不是一回事，数值本来就不同 */}
      {v > 0 && v < 99 ? `CSQ ${v} · RSSI ${-113 + v * 2} dBm` : `CSQ ${v} · 无信号`}
    </span>
  )
}
