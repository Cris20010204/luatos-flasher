import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownToLine, Binary, Check, Clock, Copy, Eraser, History, Pencil, Plug, PlugZap, Plus, RefreshCw, Repeat, Save, Send, TextCursorInput, Trash2, Unplug, WrapText, X } from 'lucide-react'
import { useApp } from '../store'
import { LogDockToggle } from '../components/LogDock'
import { Badge, Button, Checkbox, ContextMenu, EmptyState, Field, IconButton, Input, Popover, MenuItem, MenuSeparator, Segmented, Select, Dot } from '../components/ui'
import { defaultQuickCmds, loadLocal, saveLocal, type QuickCmd } from '../data/types'
import { api, b64, dialogs, errText, type SerialPortItem } from '../lib/api'
import { cx, fmtTime } from '../lib/format'

interface Entry {
  id: number
  t: number
  dir: 'rx' | 'tx' | 'sys'
  data: Uint8Array | string
}
let eid = 1

const enc = new TextEncoder()
const dec = new TextDecoder('utf-8', { fatal: false })
const toHex = (b: Uint8Array) =>
  Array.from(b)
    .map((x) => x.toString(16).toUpperCase().padStart(2, '0'))
    .join(' ')
const EOL = { none: '', cr: '\r', lf: '\n', crlf: '\r\n' } as const
const parseHex = (s: string): Uint8Array | null => {
  const clean = s.replace(/0x/gi, '').replace(/[\s,]+/g, '')
  if (!/^([0-9a-fA-F]{2})+$/.test(clean)) return null
  return new Uint8Array(clean.match(/../g)!.map((h) => parseInt(h, 16)))
}

export default function SerialPage() {
  const { t, toast } = useApp()
  const [ports, setPorts] = useState<SerialPortItem[]>([])
  const [port, setPort] = useState<string>(() => loadLocal('serialPort', ''))
  const [baudSel, setBaudSel] = useState<string>(() => loadLocal('serialBaud', '115200'))
  const [customBaud, setCustomBaud] = useState('460800')
  const [dataBits, setDataBits] = useState('8')
  const [parity, setParity] = useState('none')
  const [stopBits, setStopBits] = useState('1')
  const [open, setOpen] = useState(false)
  const [opening, setOpening] = useState(false)

  const [entries, setEntries] = useState<Entry[]>([])
  const [rxHex, setRxHex] = useState(false)
  const [showTs, setShowTs] = useState(true)
  const [autoScroll, setAutoScroll] = useState(true)
  const [wrap, setWrap] = useState(true)
  const [rxBytes, setRxBytes] = useState(0)
  const [txBytes, setTxBytes] = useState(0)

  const [text, setText] = useState('')
  const [txHex, setTxHex] = useState(false)
  const [eol, setEol] = useState<keyof typeof EOL>('crlf')
  const [timer, setTimer] = useState(false)
  const [interval, setIntervalMs] = useState('1000')
  const [history, setHistory] = useState<string[]>(() => loadLocal('serialHistory', []))
  const [cmds, setCmdsRaw] = useState<QuickCmd[]>(() => loadLocal('quickCmds', defaultQuickCmds))
  const setCmds = (fn: (c: QuickCmd[]) => QuickCmd[]) =>
    setCmdsRaw((c) => {
      const next = fn(c)
      saveLocal('quickCmds', next)
      return next
    })
  const [editing, setEditing] = useState<QuickCmd | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  const baud = baudSel === 'custom' ? customBaud : baudSel
  const cur = ports.find((p) => p.name === port)
  const add = (dir: Entry['dir'], data: Uint8Array | string) => {
    setEntries((e) => [...e, { id: eid++, t: Date.now(), dir, data }].slice(-3000))
    if (dir === 'rx' && typeof data !== 'string') setRxBytes((n) => n + data.length)
    if (dir === 'tx' && typeof data !== 'string') setTxBytes((n) => n + data.length)
  }
  const refreshPorts = (notify = false) =>
    api
      .listSerialPorts()
      .then((ps) => {
        setPorts(ps)
        if (!ps.some((p) => p.name === port) && ps.length && !open) setPort(ps[0].name)
        if (notify) toast('info', t('已刷新端口列表', 'Ports refreshed'), t(`发现 ${ps.length} 个端口`, `${ps.length} ports`))
      })
      .catch((e) => notify && toast('error', t('读取串口失败', 'Cannot list ports'), errText(e)))
  useEffect(() => {
    refreshPorts()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 后台推过来的串口数据
  useEffect(() => {
    const offData = api.onSerialData((p) => add('rx', b64.decode(p.data)))
    const offClosed = api.onSerialClosed((p) => {
      setOpen(false)
      setTimer(false)
      add('sys', p.error ? t(`串口已断开：${p.error}`, `Port lost: ${p.error}`) : t('串口已断开', 'Port closed'))
      toast('warning', t('串口已断开', 'Port disconnected'), p.port)
    })
    return () => {
      offData()
      offClosed()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const doOpen = async () => {
    if (open) {
      await api.serialClose().catch(() => {})
      setOpen(false)
      setTimer(false)
      add('sys', t(`已关闭 ${port}`, `Closed ${port}`))
      return
    }
    if (!port) return toast('error', t('请选择端口', 'Choose a port'))
    setOpening(true)
    try {
      await api.serialOpen({ port, baud: Number(baud) || 115200, dataBits: Number(dataBits), parity, stopBits: Number(stopBits) })
      setOpen(true)
      saveLocal('serialPort', port)
      saveLocal('serialBaud', baudSel)
      add('sys', t(`已打开 ${port} · ${baud} ${dataBits}${parity[0].toUpperCase()}${stopBits}`, `Opened ${port} · ${baud} ${dataBits}${parity[0].toUpperCase()}${stopBits}`))
      toast('success', t('串口已打开', 'Port opened'), `${port} @ ${baud}`)
    } catch (e) {
      toast('error', t('打开串口失败', 'Failed to open port'), errText(e))
    } finally {
      setOpening(false)
    }
  }

  useEffect(() => {
    if (autoScroll && boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight
  }, [entries.length, autoScroll])

  const send = async (raw?: string, rawHex?: boolean) => {
    const payload = raw ?? text
    if (!open) return toast('error', t('串口未打开', 'Port is closed'), t('请先打开串口', 'Open the port first'))
    if (!payload.trim()) return
    const asHex = raw === undefined ? txHex : !!rawHex
    let bytes: Uint8Array
    if (asHex) {
      const b = parseHex(payload)
      if (!b) return toast('error', t('HEX 格式错误', 'Invalid HEX'), t('示例：41 54 0D 0A', 'e.g. 41 54 0D 0A'))
      bytes = b
    } else bytes = enc.encode(payload + EOL[eol])
    try {
      await api.serialWrite(bytes)
      add('tx', bytes)
    } catch (e) {
      toast('error', t('发送失败', 'Send failed'), errText(e))
      setTimer(false)
      return
    }
    if (raw === undefined)
      setHistory((h) => {
        const next = [payload, ...h.filter((x) => x !== payload)].slice(0, 20)
        saveLocal('serialHistory', next)
        return next
      })
  }

  const sendRef = useRef(send)
  sendRef.current = send
  useEffect(() => {
    if (!timer || !open) return
    const ms = Math.max(20, Number(interval) || 1000)
    const iv = setInterval(() => sendRef.current(), ms)
    return () => clearInterval(iv)
  }, [timer, open, interval])

  const saveToFile = async () => {
    const dest = await dialogs.saveFile(t('保存接收数据', 'Save received data'), `serial_${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}.txt`, ['txt', 'log'])
    if (!dest) return
    const body = entries.map((e) => `[${fmtTime(new Date(e.t))}] ${e.dir.toUpperCase()} ${render(e)}`).join('\n')
    try {
      await api.writeText(dest, body + '\n')
      toast('success', t('已保存到文件', 'Saved to file'), dest)
    } catch (e) {
      toast('error', t('保存失败', 'Save failed'), errText(e))
    }
  }

  const render = (e: Entry) => {
    if (typeof e.data === 'string') return e.data
    if (rxHex) return toHex(e.data)
    return dec.decode(e.data).replace(/\r\n$/, '').replace(/\r?\n$/, '').replace(/\r/g, '')
  }
  const rows = useMemo(() => entries, [entries])

  const clearAll = () => {
    setEntries([])
    setRxBytes(0)
    setTxBytes(0)
  }
  const allText = () => entries.map((e) => `${showTs ? `[${fmtTime(new Date(e.t))}] ` : ''}${e.dir === 'sys' ? '' : `${e.dir.toUpperCase()} `}${render(e)}`).join('\n')

  // 接收区右键菜单：e 是右击的那一行（右击空白处为 null）；sel 是右击时选中的文字（点菜单时选区可能会丢）
  const [menu, setMenu] = useState<{ x: number; y: number; e: Entry | null; sel: string } | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])
  const onRxContextMenu = (ev: React.MouseEvent) => {
    ev.preventDefault()
    const id = Number((ev.target as HTMLElement).closest<HTMLElement>('[data-eid]')?.dataset.eid)
    setMenu({ x: ev.clientX, y: ev.clientY, e: entries.find((x) => x.id === id) ?? null, sel: window.getSelection()?.toString() ?? '' })
  }
  const run = (fn: () => unknown) => {
    closeMenu()
    fn()
  }
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast('success', t(`已复制${what}`, 'Copied'), text.length > 120 ? `${text.slice(0, 120)}…` : text)
    } catch (e) {
      toast('error', t('复制失败', 'Copy failed'), errText(e))
    }
  }
  // 原样再发一次（不再加行尾，发出去的字节和当时完全一样）
  const resend = async (bytes: Uint8Array) => {
    if (!open) return toast('error', t('串口未打开', 'Port is closed'), t('请先打开串口', 'Open the port first'))
    try {
      await api.serialWrite(bytes)
      add('tx', bytes)
    } catch (e) {
      toast('error', t('发送失败', 'Send failed'), errText(e))
    }
  }
  // 填进发送框：按发送区当前的文本 / HEX 模式；文本模式去掉末尾换行（发送时会按“行尾”设置再加）
  const fillInput = (bytes: Uint8Array) => setText(txHex ? toHex(bytes) : dec.decode(bytes).replace(/(\r\n|\r|\n)$/, ''))

  return (
    <div className="flex h-full">
      {/* config */}
      <aside className="flex w-[236px] shrink-0 flex-col gap-3 border-r border-line bg-surface-2 p-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-fg">{t('串口配置', 'Port settings')}</h2>
          <IconButton icon={RefreshCw} size="sm" label={t('刷新端口', 'Refresh ports')} className="ml-auto" onClick={() => refreshPorts(true)} />
        </div>
        <Field label={t('端口', 'Port')}>
          <Select mono value={port} onChange={(e) => setPort(e.target.value)} disabled={open} onFocus={() => refreshPorts()}>
            {!ports.length && <option value="">{t('没有发现串口', 'No ports')}</option>}
            {port && !cur && <option value={port}>{port}</option>}
            {ports.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </Select>
          <span className="text-2xs text-fg-3">{cur?.desc ?? (port ? t('端口不存在', 'Not present') : '')}</span>
        </Field>
        <Field label={t('波特率', 'Baud rate')}>
          <Select value={baudSel} onChange={(e) => setBaudSel(e.target.value)} disabled={open}>
            {['9600', '19200', '38400', '57600', '115200', '230400', '460800', '921600', '2000000'].map((b) => (
              <option key={b}>{b}</option>
            ))}
            <option value="custom">{t('自定义…', 'Custom…')}</option>
          </Select>
          {baudSel === 'custom' && <Input mono value={customBaud} onChange={(e) => setCustomBaud(e.target.value.replace(/\D/g, ''))} disabled={open} />}
        </Field>
        <div className="grid grid-cols-3 gap-2">
          <Field label={t('数据位', 'Data')}>
            <Select value={dataBits} onChange={(e) => setDataBits(e.target.value)} disabled={open}>
              {['5', '6', '7', '8'].map((b) => (
                <option key={b}>{b}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('校验位', 'Parity')}>
            <Select value={parity} onChange={(e) => setParity(e.target.value)} disabled={open}>
              <option value="none">{t('无', 'None')}</option>
              <option value="odd">{t('奇', 'Odd')}</option>
              <option value="even">{t('偶', 'Even')}</option>
            </Select>
          </Field>
          <Field label={t('停止位', 'Stop')}>
            <Select value={stopBits} onChange={(e) => setStopBits(e.target.value)} disabled={open}>
              {['1', '2'].map((b) => (
                <option key={b}>{b}</option>
              ))}
            </Select>
          </Field>
        </div>
        <Button variant={open ? 'danger' : 'primary'} icon={open ? Unplug : PlugZap} onClick={doOpen} loading={opening} className="mt-1 w-full">
          {open ? t('关闭串口', 'Close port') : t('打开串口', 'Open port')}
        </Button>
        <div className="flex items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-2 text-xs">
          <Dot tone={open ? 'ok' : 'neutral'} pulse={open} />
          <span className="text-fg-2">{open ? t('已打开', 'Open') : t('未打开', 'Closed')}</span>
          <span className="ml-auto font-mono text-2xs text-fg-3">
            {baud} · {dataBits}
            {parity[0].toUpperCase()}
            {stopBits}
          </span>
        </div>
        <div className="mt-auto grid grid-cols-2 gap-2">
          <div className="rounded-md border border-line bg-surface px-2.5 py-2">
            <div className="text-2xs text-fg-3">RX</div>
            <div className="font-mono text-sm text-ok">{rxBytes.toLocaleString()} B</div>
          </div>
          <div className="rounded-md border border-line bg-surface px-2.5 py-2">
            <div className="text-2xs text-fg-3">TX</div>
            <div className="font-mono text-sm text-accent">{txBytes.toLocaleString()} B</div>
          </div>
        </div>
      </aside>

      {/* receive + send */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line bg-surface px-3">
          <span className="text-sm font-semibold text-fg">{t('接收区', 'Receive')}</span>
          <Segmented size="xs" value={rxHex ? 'hex' : 'text'} onChange={(v) => setRxHex(v === 'hex')} options={[{ value: 'text', label: t('文本', 'Text') }, { value: 'hex', label: 'HEX' }]} />
          <div className="ml-2 flex items-center gap-3">
            <Checkbox checked={showTs} onChange={setShowTs} label={<span className="text-xs">{t('时间戳', 'Timestamp')}</span>} />
          </div>
          <div className="ml-auto flex items-center gap-1">
            <LogDockToggle />
            <span className="mr-2 font-mono text-2xs text-fg-3">
              RX {rxBytes} · TX {txBytes}
            </span>
            <IconButton size="sm" icon={ArrowDownToLine} label={t('自动滚动', 'Auto scroll')} active={autoScroll} onClick={() => setAutoScroll(!autoScroll)} />
            <IconButton size="sm" icon={WrapText} label={t('自动换行', 'Word wrap')} active={wrap} onClick={() => setWrap(!wrap)} />
            <IconButton
              size="sm"
              icon={Eraser}
              label={t('清空', 'Clear')}
              onClick={clearAll}
            />
            <IconButton size="sm" icon={Save} label={t('保存到文件', 'Save to file')} onClick={saveToFile} disabled={!entries.length} />
          </div>
        </div>
        <div className="relative min-h-0 flex-1 bg-editor">
          {!open && entries.length === 0 ? (
            <EmptyState
              icon={Plug}
              title={t('串口未打开', 'Port is closed')}
              desc={t('在左侧选择端口与波特率后打开串口。可以接 USB 转串口看 ESP32 的打印，也可以打开模组的“用户虚拟串口”。', 'Choose a port and baud rate on the left — e.g. a USB-UART adapter for the ESP32, or the module user port.')}
            >
              <Button variant="primary" icon={PlugZap} onClick={doOpen} loading={opening} disabled={!port}>
                {t('打开串口', 'Open port')} {port && <span className="font-mono">· {port.split('/').pop()}</span>}
              </Button>
            </EmptyState>
          ) : (
            <div ref={boxRef} onContextMenu={onRxContextMenu} className={cx('scroll-thin absolute inset-0 overflow-auto py-1.5 font-mono text-[12px] leading-[20px]', !wrap && 'whitespace-pre')}>
              {rows.map((e) => (
                <div key={e.id} data-eid={e.id} className={cx('flex gap-2.5 px-4', e.dir === 'sys' && 'text-fg-3', menu?.e?.id === e.id && 'bg-hover')}>
                  {showTs && <span className="shrink-0 text-fg-3">[{fmtTime(new Date(e.t))}]</span>}
                  {e.dir !== 'sys' && <span className={cx('w-6 shrink-0 font-semibold', e.dir === 'rx' ? 'text-ok' : 'text-accent')}>{e.dir === 'rx' ? 'RX' : 'TX'}</span>}
                  <span className={cx('min-w-0', wrap ? 'break-all whitespace-pre-wrap' : 'whitespace-pre', e.dir === 'tx' ? 'text-accent' : e.dir === 'sys' ? 'italic' : 'text-fg')}>{render(e)}</span>
                </div>
              ))}
              {!open && <div className="px-4 pt-1 text-2xs text-fg-3">— {t('串口已关闭', 'port closed')} —</div>}
            </div>
          )}
          {menu && (
            <ContextMenu x={menu.x} y={menu.y} onClose={closeMenu} width={232}>
              {menu.sel && (
                <MenuItem icon={Copy} onClick={() => run(() => copy(menu.sel, '选中内容'))}>
                  {t('复制选中内容', 'Copy selection')}
                </MenuItem>
              )}
              {menu.e && menu.e.dir !== 'sys' && typeof menu.e.data !== 'string' && (() => {
                const e = menu.e
                const bytes = e.data as Uint8Array
                return (
                  <>
                    <div className="px-2 pt-1 pb-0.5 text-2xs text-fg-3">
                      {e.dir === 'rx' ? t('这一行（收到）', 'This line (RX)') : t('这一行（发出）', 'This line (TX)')} · {bytes.length} B
                    </div>
                    <MenuItem icon={Copy} onClick={() => run(() => copy(dec.decode(bytes).replace(/(\r\n|\r|\n)$/, ''), '这一行'))}>
                      {t('复制为文本', 'Copy as text')}
                    </MenuItem>
                    <MenuItem icon={Binary} onClick={() => run(() => copy(toHex(bytes), 'HEX'))}>
                      {t('复制为 HEX', 'Copy as HEX')}
                    </MenuItem>
                    <MenuItem icon={TextCursorInput} onClick={() => run(() => fillInput(bytes))}>
                      {t('填入发送区', 'Put in send box')}
                    </MenuItem>
                    {e.dir === 'tx' && (
                      <MenuItem icon={Repeat} disabled={!open} onClick={() => run(() => resend(bytes))}>
                        {t('再发送一次', 'Send again')}
                      </MenuItem>
                    )}
                    <MenuSeparator />
                  </>
                )
              })()}
              {menu.e?.dir === 'sys' && (
                <>
                  <MenuItem icon={Copy} onClick={() => run(() => copy(render(menu.e!), '这一行'))}>
                    {t('复制这一行', 'Copy line')}
                  </MenuItem>
                  <MenuSeparator />
                </>
              )}
              <MenuItem icon={Copy} disabled={!entries.length} onClick={() => run(() => copy(allText(), `全部 ${entries.length} 行`))}>
                {t(`复制全部（${entries.length} 行）`, `Copy all (${entries.length} lines)`)}
              </MenuItem>
              <MenuItem icon={Save} disabled={!entries.length} onClick={() => run(saveToFile)}>
                {t('保存到文件…', 'Save to file…')}
              </MenuItem>
              <MenuItem icon={Eraser} disabled={!entries.length} onClick={() => run(clearAll)}>
                {t('清空接收区', 'Clear')}
              </MenuItem>
              <MenuSeparator />
              <MenuItem icon={Binary} right={rxHex ? <Check size={14} className="text-accent" /> : null} onClick={() => run(() => setRxHex(!rxHex))}>
                {t('按 HEX 显示', 'Show as HEX')}
              </MenuItem>
              <MenuItem icon={Clock} right={showTs ? <Check size={14} className="text-accent" /> : null} onClick={() => run(() => setShowTs(!showTs))}>
                {t('显示时间戳', 'Timestamps')}
              </MenuItem>
              <MenuItem icon={ArrowDownToLine} right={autoScroll ? <Check size={14} className="text-accent" /> : null} onClick={() => run(() => setAutoScroll(!autoScroll))}>
                {t('自动滚动', 'Auto scroll')}
              </MenuItem>
              <MenuItem icon={WrapText} right={wrap ? <Check size={14} className="text-accent" /> : null} onClick={() => run(() => setWrap(!wrap))}>
                {t('自动换行', 'Word wrap')}
              </MenuItem>
            </ContextMenu>
          )}
        </div>

        {/* send area */}
        <div className="shrink-0 border-t border-line bg-surface p-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-sm font-semibold text-fg">{t('发送区', 'Send')}</span>
            <Segmented size="xs" value={txHex ? 'hex' : 'text'} onChange={(v) => setTxHex(v === 'hex')} options={[{ value: 'text', label: t('文本', 'Text') }, { value: 'hex', label: 'HEX' }]} />
            <span className="ml-2 text-2xs text-fg-3">{t('行尾', 'EOL')}</span>
            <Segmented
              size="xs"
              value={eol}
              onChange={setEol}
              options={[
                { value: 'none', label: t('无', 'None'), disabled: txHex },
                { value: 'cr', label: 'CR', disabled: txHex },
                { value: 'lf', label: 'LF', disabled: txHex },
                { value: 'crlf', label: 'CRLF', disabled: txHex },
              ]}
            />
            <div className="ml-auto flex items-center gap-2">
              <Checkbox checked={timer} onChange={(v) => (v && !open ? toast('error', t('串口未打开', 'Port is closed')) : setTimer(v))} label={<span className="text-xs">{t('定时发送', 'Timed send')}</span>} />
              <Input size="sm" mono value={interval} onChange={(e) => setIntervalMs(e.target.value.replace(/\D/g, ''))} className="w-[92px]" suffix={<span className="text-2xs text-fg-3">ms</span>} />
              {timer && (
                <Badge tone="primary">
                  <Clock size={10} />
                  {t('运行中', 'Running')}
                </Badge>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  send()
                }
              }}
              spellCheck={false}
              placeholder={txHex ? '41 54 0D 0A' : 'AT'}
              className="h-[68px] min-w-0 flex-1 resize-none rounded-md border border-line-strong bg-surface px-2.5 py-2 font-mono text-xs text-fg outline-none placeholder:text-fg-3 focus:border-primary focus:ring-2 focus:ring-primary/15"
            />
            <div className="flex w-[108px] flex-col gap-1.5">
              <Button variant="primary" icon={Send} onClick={() => send()} className="flex-1">
                {t('发送', 'Send')}
              </Button>
              <Popover
                width={240}
                align="right"
                trigger={(_, toggle) => (
                  <Button size="sm" variant="ghost" icon={History} onClick={toggle} className="w-full">
                    {t('发送历史', 'History')}
                  </Button>
                )}
              >
                {(close) => (
                  <>
                    <div className="px-2 pt-1 pb-1 text-2xs font-semibold text-fg-3">{t('发送历史', 'History')}</div>
                    {history.length === 0 && <div className="px-2 py-2 text-xs text-fg-3">{t('暂无', 'Empty')}</div>}
                    {history.map((h) => (
                      <MenuItem
                        key={h}
                        onClick={() => {
                          setText(h)
                          close()
                        }}
                      >
                        <span className="font-mono text-xs">{h}</span>
                      </MenuItem>
                    ))}
                  </>
                )}
              </Popover>
            </div>
          </div>
        </div>
      </div>

      {/* quick commands */}
      <aside className="flex w-[244px] shrink-0 flex-col border-l border-line bg-surface-2">
        <div className="flex h-10 items-center gap-2 border-b border-line px-3">
          <span className="text-sm font-semibold text-fg">{t('快捷指令', 'Quick commands')}</span>
          <span className="text-2xs text-fg-3">{cmds.length}</span>
          <Button size="xs" variant="ghost" icon={Plus} className="ml-auto" onClick={() => setEditing({ id: '', name: '', content: '' })}>
            {t('新增', 'Add')}
          </Button>
        </div>
        {editing && (
          <div className="flex flex-col gap-1.5 border-b border-line bg-surface p-2.5">
            <Input size="sm" placeholder={t('名称', 'Name')} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} autoFocus />
            <Input size="sm" mono placeholder={editing.hex ? 'A5 5A 00 00 …' : 'AT+...'} value={editing.content} onChange={(e) => setEditing({ ...editing, content: e.target.value })} />
            <Checkbox checked={!!editing.hex} onChange={(v) => setEditing({ ...editing, hex: v })} label={<span className="text-xs">{t('按 HEX 发送', 'Send as HEX')}</span>} />
            <div className="flex justify-end gap-1.5">
              <Button size="xs" variant="ghost" icon={X} onClick={() => setEditing(null)}>
                {t('取消', 'Cancel')}
              </Button>
              <Button
                size="xs"
                variant="primary"
                icon={Check}
                disabled={!editing.content.trim()}
                onClick={() => {
                  const item = { ...editing, name: editing.name || editing.content }
                  if (editing.id) setCmds((c) => c.map((x) => (x.id === editing.id ? item : x)))
                  else setCmds((c) => [...c, { ...item, id: `q${Date.now()}` }])
                  setEditing(null)
                  toast('success', editing.id ? t('已更新快捷指令', 'Command updated') : t('已新增快捷指令', 'Command added'))
                }}
              >
                {t('保存', 'Save')}
              </Button>
            </div>
          </div>
        )}
        <div className="scroll-thin min-h-0 flex-1 overflow-auto p-1.5">
          {cmds.map((c) => (
            <div key={c.id} className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-hover">
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs text-fg">{c.name}</div>
                <div className="truncate font-mono text-2xs text-fg-3">
                  {c.hex && <span className="mr-1 rounded bg-surface-3 px-1 text-[9px]">HEX</span>}
                  {c.content}
                </div>
              </div>
              <div className="hidden items-center group-hover:flex">
                <IconButton size="xs" icon={Pencil} label={t('编辑', 'Edit')} onClick={() => setEditing(c)} />
                <IconButton size="xs" icon={Trash2} label={t('删除', 'Delete')} tone="danger" onClick={() => setCmds((x) => x.filter((y) => y.id !== c.id))} />
              </div>
              <button
                type="button"
                onClick={() => send(c.content, c.hex)}
                className={cx('flex h-6 items-center gap-1 rounded-md px-2 text-2xs font-medium transition-colors', open ? 'bg-primary-soft text-accent hover:bg-primary hover:text-white' : 'bg-surface-3 text-fg-3')}
                title={t('一键发送', 'Send')}
              >
                <Send size={11} />
                {t('发送', 'Send')}
              </button>
            </div>
          ))}
        </div>
        <div className="border-t border-line px-3 py-2 text-2xs text-fg-3">{t('文本指令按当前行尾设置发送；HEX 指令原样发送', 'Text commands use the EOL setting; HEX ones are sent as-is')}</div>
      </aside>
    </div>
  )
}
