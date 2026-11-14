import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BookmarkPlus,
  Braces,
  CircleCheck,
  Dices,
  Download,
  Eraser,
  Eye,
  EyeOff,
  FileKey,
  History,
  Pause,
  Play,
  Plug,
  Plus,
  RadioTower,
  Search,
  Send,
  Trash2,
  Unplug,
  Wand2,
  Zap,
} from 'lucide-react'
import { useApp } from '../store'
import { LogDockToggle } from '../components/LogDock'
import { Badge, Button, Dot, EmptyState, Field, IconButton, Input, MenuItem, Popover, Segmented, Select, Switch } from '../components/ui'
import { JsonView, prettyJson } from '../components/JsonView'
import { SUB_COLORS, defaultConns, loadLocal, saveLocal, type MqttConn } from '../data/types'
import { api, b64, dialogs, errText } from '../lib/api'
import { demoParam } from '../lib/demo'
import { cx, fmtTime } from '../lib/format'

interface Sub {
  id: string
  topic: string
  qos: 0 | 1 | 2
  color: string
  paused: boolean
}
interface Msg {
  id: number
  dir: 'in' | 'out'
  topic: string
  qos: number
  retain: boolean
  payload: string
  /** 内容不是 UTF-8 文本时按 HEX 显示 */
  binary?: boolean
  t: number
  color?: string
  subId?: string
}
interface Tpl {
  id: string
  name: string
  payload: string
}

let mid = 1
/** 订阅输入框的快捷建议，和“新建项目 → MQTT 示例”模板里的主题对应 */
const PRESETS = ['demo/+/up', 'demo/+/down', '#']
const DEFAULT_SUBS: Sub[] = []
const utf8 = new TextDecoder('utf-8', { fatal: true })
function decodePayload(bytes: Uint8Array): { text: string; binary: boolean } {
  try {
    return { text: utf8.decode(bytes), binary: false }
  } catch {
    return { text: Array.from(bytes, (b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' '), binary: true }
  }
}
function usePersisted<T>(key: string, init: T): [T, (fn: T | ((v: T) => T)) => void] {
  // 小工具：useState + localStorage
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const [v, setV] = useState<T>(() => loadLocal(key, init))
  const set = (fn: T | ((v: T) => T)) =>
    setV((cur) => {
      const next = typeof fn === 'function' ? (fn as (v: T) => T)(cur) : fn
      saveLocal(key, next)
      return next
    })
  return [v, set]
}

export function topicMatch(filter: string, topic: string) {
  const f = filter.split('/')
  const tp = topic.split('/')
  for (let i = 0; i < f.length; i++) {
    if (f[i] === '#') return true
    if (i >= tp.length) return false
    if (f[i] !== '+' && f[i] !== tp[i]) return false
  }
  return f.length === tp.length
}

function randomId() {
  return Math.floor(Math.random() * 0xffffffff)
    .toString(16)
    .padStart(8, '0')
}

export default function MqttPage() {
  const { t, mqttStatus, setMqttStatus, toast, device, confirm } = useApp()
  const [conns, setConns] = usePersisted<MqttConn[]>('mqttConns', defaultConns)
  const [selId, setSelId] = usePersisted<string>('mqttSel', defaultConns[0].id)
  const [activeConnId, setActiveConnId] = useState<string | null>(null)
  const [showPwd, setShowPwd] = useState(false)
  const [subs, setSubs] = usePersisted<Sub[]>('mqttSubs', DEFAULT_SUBS)
  const [newTopic, setNewTopic] = useState('demo/+/up')
  const [newQos, setNewQos] = useState<0 | 1 | 2>(1)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [filter, setFilter] = useState('all')
  const [q, setQ] = useState('')
  const [paused, setPaused] = useState(false)
  const pausedBuf = useRef<Msg[]>([])
  const [bufCount, setBufCount] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const genRef = useRef(0)

  const conn = conns.find((c) => c.id === selId) ?? conns[0]
  const connected = mqttStatus === 'connected'
  const isActive = activeConnId === conn.id && mqttStatus !== 'disconnected'
  const setConn = (patch: Partial<MqttConn>) => setConns((cs) => cs.map((c) => (c.id === conn.id ? { ...c, ...patch } : c)))

  const subsRef = useRef(subs)
  subsRef.current = subs
  const pausedRef = useRef(paused)
  pausedRef.current = paused

  // 没识别到设备 IMEI 时，用最近收到消息主题里的 15 位 IMEI
  const [seenImei, setSeenImei] = useState('')
  const imei = device.imei || seenImei

  const deliver = (m: Omit<Msg, 'id' | 't'> & { t?: number }) => {
    const msg: Msg = { ...m, id: mid++, t: m.t ?? Date.now() }
    if (pausedRef.current && msg.dir === 'in') {
      pausedBuf.current.push(msg)
      setBufCount(pausedBuf.current.length)
      return
    }
    setMsgs((ms) => [...ms, msg].slice(-2000))
  }

  // 服务器推过来的事件
  useEffect(
    () =>
      api.onMqtt((e) => {
        if (e.gen !== genRef.current) return
        if (e.kind === 'connected') {
          setMqttStatus('connected')
          toast('success', t('已连接', 'Connected'))
          for (const s of subsRef.current) api.mqttSubscribe(s.topic, s.qos).catch((er) => toast('error', t('订阅失败', 'Subscribe failed'), `${s.topic}: ${errText(er)}`))
        } else if (e.kind === 'disconnected') {
          setMqttStatus('disconnected')
          setActiveConnId(null)
          if (e.error) toast('error', t('MQTT 连接已断开', 'MQTT disconnected'), e.error)
        } else if (e.kind === 'message' && e.topic != null) {
          const topic = e.topic
          const sub = subsRef.current.find((s) => topicMatch(s.topic, topic))
          if (sub?.paused) return
          const m = topic.match(/(?:^|\/)(\d{15})(?:\/|$)/)
          if (m) setSeenImei(m[1])
          const { text, binary } = decodePayload(b64.decode(e.payload ?? ''))
          deliver({ dir: 'in', topic, payload: text, binary, qos: e.qos ?? 0, retain: !!e.retain, color: sub?.color ?? 'var(--fg-3)', subId: sub?.id })
        }
      }),
    [], // eslint-disable-line react-hooks/exhaustive-deps
  )

  const connect = async () => {
    if (isActive) {
      genRef.current = -1
      await api.mqttDisconnect().catch(() => {})
      setMqttStatus('disconnected')
      setActiveConnId(null)
      toast('info', t('已断开连接', 'Disconnected'), `${conn.host}:${conn.port}`)
      return
    }
    if (!conn.host.trim()) return toast('error', t('请填写服务器地址', 'Host is required'))
    setActiveConnId(conn.id)
    setMqttStatus('connecting')
    try {
      genRef.current = await api.mqttConnect({
        host: conn.host,
        port: conn.port || (conn.tls ? 8883 : 1883),
        clientId: conn.clientId,
        username: conn.username,
        password: conn.password,
        keepAlive: conn.keepAlive || 60,
        clean: conn.clean,
        tls: conn.tls,
        ca: conn.ca,
      })
    } catch (e) {
      setMqttStatus('disconnected')
      setActiveConnId(null)
      toast('error', t('连接失败', 'Connection failed'), errText(e))
    }
  }
  // 演示模式：网址带 mqtt=1 时自动连接
  useEffect(() => {
    if (demoParam('mqtt')) setTimeout(() => void connect(), 300)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 删除连接：只删本机保存的这条配置；正在用的先断开；至少保留一条（页面总要有一条可编辑的连接）
  const removeConn = async (c: MqttConn) => {
    if (conns.length <= 1) return
    const ok = await confirm({
      title: t(`删除连接「${c.name}」？`, `Delete connection “${c.name}”?`),
      body: t(
        `${c.host ? `${c.host}:${c.port} 的地址、账号和证书设置` : '这条连接的设置'}会从本机删除，订阅列表和已收到的消息不受影响。`,
        `Its host, credentials and CA settings are removed from this computer. Subscriptions and received messages are kept.`,
      ),
      okText: t('删除', 'Delete'),
      danger: true,
    })
    if (!ok) return
    if (activeConnId === c.id && mqttStatus !== 'disconnected') {
      genRef.current = -1
      await api.mqttDisconnect().catch(() => {})
      setMqttStatus('disconnected')
      setActiveConnId(null)
    }
    const idx = conns.findIndex((x) => x.id === c.id)
    const rest = conns.filter((x) => x.id !== c.id)
    setConns(rest)
    if (selId === c.id) setSelId(rest[Math.min(idx, rest.length - 1)].id)
    toast('success', t('已删除连接', 'Connection deleted'), c.name)
  }

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [msgs.length])

  const addSub = (topic: string, qos: 0 | 1 | 2 = newQos) => {
    const tp = topic.trim()
    if (!tp) return
    if (subs.some((s) => s.topic === tp)) return toast('warning', t('已订阅该主题', 'Already subscribed'), tp)
    const color = SUB_COLORS[subs.length % SUB_COLORS.length]
    setSubs((s) => [...s, { id: `s${Date.now()}`, topic: tp, qos, color, paused: false }])
    if (connected)
      api
        .mqttSubscribe(tp, qos)
        .then(() => toast('success', t('订阅成功', 'Subscribed'), `${tp} · QoS ${qos}`))
        .catch((e) => toast('error', t('订阅失败', 'Subscribe failed'), errText(e)))
    else toast('success', t('已添加订阅', 'Subscription added'), t('连接后自动订阅', 'Subscribed on connect'))
  }

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return msgs.filter((m) => (filter === 'all' || (filter === 'out' ? m.dir === 'out' : m.subId === filter)) && (!needle || `${m.topic} ${m.payload}`.toLowerCase().includes(needle)))
  }, [msgs, filter, q])


  const publish = async (topic: string, payload: string, qos: number, retain: boolean, hex = false) => {
    if (!connected) {
      toast('error', t('未连接 MQTT 服务器', 'Not connected'), t('请先连接服务器', 'Connect to a broker first'))
      return false
    }
    const bytes = hex ? new Uint8Array((payload.replace(/\s+/g, '').match(/../g) ?? []).map((h) => parseInt(h, 16))) : new TextEncoder().encode(payload)
    try {
      await api.mqttPublish(topic, bytes, qos, retain)
    } catch (e) {
      toast('error', t('发布失败', 'Publish failed'), errText(e))
      return false
    }
    deliver({ dir: 'out', topic, payload, qos, retain, binary: hex })
    toast('success', t('已发布', 'Published'), topic)
    return true
  }

  return (
    <div className="flex h-full">
      {/* left: connections + subscriptions */}
      <aside className="flex w-[292px] shrink-0 flex-col border-r border-line bg-surface-2">
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex h-10 shrink-0 items-center gap-2 px-3">
            <span className="text-sm font-semibold text-fg">{t('连接', 'Connections')}</span>
            <Button
              size="xs"
              variant="ghost"
              icon={Plus}
              className="ml-auto"
              onClick={() => {
                const id = `c${Date.now()}`
                setConns((cs) => [...cs, { ...defaultConns[0], id, name: t('新连接', 'New connection'), host: '', username: '', password: '', clientId: `luatos_flasher_${randomId().slice(0, 6)}` }])
                setSelId(id)
              }}
            >
              {t('新建', 'New')}
            </Button>
          </div>
          <div className="flex shrink-0 flex-col gap-0.5 px-2 pb-2">
            {conns.map((c) => {
              const st = activeConnId === c.id ? mqttStatus : 'disconnected'
              return (
                <div key={c.id} className="group relative">
                  <button
                    type="button"
                    onClick={() => setSelId(c.id)}
                    className={cx('flex w-full items-center gap-2.5 rounded-md py-1.5 pr-9 pl-2.5 text-left', c.id === selId ? 'bg-surface shadow-[0_0_0_1px_var(--line)]' : 'hover:bg-hover')}
                  >
                    <Dot tone={st === 'connected' ? 'ok' : st === 'connecting' ? 'warn' : 'neutral'} pulse={st === 'connecting'} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-medium text-fg">{c.name}</div>
                      <div className="truncate font-mono text-2xs text-fg-3">{c.host ? `${c.host}:${c.port}` : t('未配置主机', 'No host')}</div>
                    </div>
                  </button>
                  {/* 删除：鼠标移到这一行或选中时出现 */}
                  <IconButton
                    size="sm"
                    icon={Trash2}
                    tone="danger"
                    label={conns.length <= 1 ? t('至少保留一个连接', 'Keep at least one connection') : t('删除连接', 'Delete connection')}
                    disabled={conns.length <= 1}
                    onClick={() => removeConn(c)}
                    className={cx('absolute top-1/2 right-1.5 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100', c.id === selId && 'opacity-100')}
                  />
                </div>
              )
            })}
          </div>
          <div className="scroll-thin min-h-0 flex-1 overflow-auto border-t border-line px-3 py-3">
            <fieldset disabled={isActive} className="flex flex-col gap-2.5 disabled:opacity-60">
              <Field label={t('名称', 'Name')}>
                <Input size="sm" value={conn.name} onChange={(e) => setConn({ name: e.target.value })} />
              </Field>
              <Field label={t('主机', 'Host')}>
                <div className="flex gap-1.5">
                  <Select size="sm" value={conn.protocol} onChange={(e) => setConn({ protocol: e.target.value as MqttConn['protocol'], tls: e.target.value === 'mqtts://', port: e.target.value === 'mqtts://' ? 8883 : 1883 })} className="w-[86px]" mono>
                    <option>mqtt://</option>
                    <option>mqtts://</option>
                  </Select>
                  <Input size="sm" mono value={conn.host} onChange={(e) => setConn({ host: e.target.value })} className="flex-1" placeholder="broker.example.com" />
                </div>
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label={t('端口', 'Port')}>
                  <Input size="sm" mono value={conn.port} onChange={(e) => setConn({ port: Number(e.target.value.replace(/\D/g, '')) || 0 })} />
                </Field>
                <Field label="Keep Alive">
                  <Input size="sm" mono value={conn.keepAlive} onChange={(e) => setConn({ keepAlive: Number(e.target.value.replace(/\D/g, '')) || 0 })} suffix={<span className="text-2xs text-fg-3">s</span>} />
                </Field>
              </div>
              <Field label="Client ID">
                <Input
                  size="sm"
                  mono
                  value={conn.clientId}
                  onChange={(e) => setConn({ clientId: e.target.value })}
                  suffix={
                    <button type="button" title={t('随机生成', 'Randomize')} onClick={() => setConn({ clientId: `luatos_flasher_${randomId().slice(0, 6)}` })} className="text-fg-3 hover:text-fg">
                      <Dices size={14} />
                    </button>
                  }
                />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label={t('用户名', 'Username')}>
                  <Input size="sm" mono value={conn.username} onChange={(e) => setConn({ username: e.target.value })} />
                </Field>
                <Field label={t('密码', 'Password')}>
                  <Input
                    size="sm"
                    mono
                    type={showPwd ? 'text' : 'password'}
                    value={conn.password}
                    onChange={(e) => setConn({ password: e.target.value })}
                    suffix={
                      <button type="button" onClick={() => setShowPwd(!showPwd)} className="text-fg-3 hover:text-fg">
                        {showPwd ? <EyeOff size={13} /> : <Eye size={13} />}
                      </button>
                    }
                  />
                </Field>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-fg-2">Clean Session</span>
                <Switch size="sm" checked={conn.clean} onChange={(v) => setConn({ clean: v })} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-fg-2">TLS / SSL</span>
                <Switch size="sm" checked={conn.tls} onChange={(v) => setConn({ tls: v, protocol: v ? 'mqtts://' : 'mqtt://', port: v ? 8883 : 1883 })} />
              </div>
              {conn.tls && (
                <Field label={t('CA 证书', 'CA certificate')}>
                  <div className="flex gap-1.5">
                    <Input size="sm" mono readOnly value={conn.ca} placeholder={t('未选择（使用系统证书）', 'System CA')} className="flex-1" />
                    <IconButton
                      icon={FileKey}
                      label={t('选择证书', 'Choose')}
                      onClick={async () => {
                        const f = await dialogs.pickFile(t('选择 CA 证书（PEM）', 'Choose CA certificate (PEM)'), ['crt', 'pem', 'cer'], 'CA')
                        if (f) setConn({ ca: f })
                      }}
                    />
                    {conn.ca && <IconButton icon={Trash2} label={t('使用系统证书', 'Use system CA')} onClick={() => setConn({ ca: '' })} />}
                  </div>
                </Field>
              )}
            </fieldset>
          </div>
          <div className="shrink-0 border-t border-line p-3">
            <Button
              variant={isActive ? 'danger' : 'primary'}
              icon={isActive ? Unplug : Plug}
              loading={isActive && mqttStatus === 'connecting'}
              onClick={connect}
              className="w-full"
            >
              {isActive ? (mqttStatus === 'connecting' ? t('连接中…', 'Connecting…') : t('断开', 'Disconnect')) : t('连接', 'Connect')}
            </Button>
          </div>
        </div>

        {/* subscriptions */}
        <div className="flex h-[272px] shrink-0 flex-col border-t border-line">
          <div className="flex h-9 shrink-0 items-center gap-2 px-3">
            <span className="text-sm font-semibold text-fg">{t('订阅', 'Subscriptions')}</span>
            <span className="text-2xs text-fg-3">{subs.length}</span>
          </div>
          <div className="flex shrink-0 gap-1.5 px-3">
            <Input size="sm" mono value={newTopic} onChange={(e) => setNewTopic(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addSub(newTopic)} className="flex-1" placeholder="topic/#" />
            <Select size="sm" value={newQos} onChange={(e) => setNewQos(Number(e.target.value) as 0 | 1 | 2)} className="w-[62px]">
              <option value={0}>Q0</option>
              <option value={1}>Q1</option>
              <option value={2}>Q2</option>
            </Select>
            <IconButton icon={Plus} label={t('添加订阅', 'Add')} onClick={() => addSub(newTopic)} className="border border-line-strong bg-surface" />
          </div>
          <div className="flex shrink-0 flex-wrap gap-1 px-3 pt-2">
            {PRESETS.map((p) => {
              const has = subs.some((s) => s.topic === p)
              return (
                <button
                  key={p}
                  type="button"
                  disabled={has}
                  onClick={() => addSub(p, 1)}
                  className="rounded border border-dashed border-line-strong px-1.5 py-px font-mono text-[10.5px] text-fg-2 hover:border-primary hover:text-accent disabled:border-solid disabled:border-line disabled:text-fg-3 disabled:opacity-60"
                >
                  {has ? '✓ ' : '+ '}
                  {p.split('/').pop()}
                </button>
              )
            })}
          </div>
          <div className="scroll-thin mt-2 min-h-0 flex-1 overflow-auto px-2 pb-2">
            {subs.map((s) => (
              <div key={s.id} className={cx('group flex items-center gap-2 rounded-md py-1 pr-1 pl-2 hover:bg-hover', s.paused && 'opacity-55')}>
                <span className="h-5 w-1 shrink-0 rounded-full" style={{ background: s.color }} />
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg">{s.topic}</span>
                <span className="font-mono text-[10px] text-fg-3">Q{s.qos}</span>
                <IconButton size="xs" icon={s.paused ? Play : Pause} label={s.paused ? t('继续', 'Resume') : t('暂停', 'Pause')} onClick={() => setSubs((x) => x.map((y) => (y.id === s.id ? { ...y, paused: !y.paused } : y)))} />
                <IconButton
                  size="xs"
                  icon={Trash2}
                  tone="danger"
                  label={t('取消订阅', 'Unsubscribe')}
                  onClick={() => {
                    setSubs((x) => x.filter((y) => y.id !== s.id))
                    if (filter === s.id) setFilter('all')
                    if (connected) api.mqttUnsubscribe(s.topic).catch(() => {})
                    toast('info', t('已取消订阅', 'Unsubscribed'), s.topic)
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      </aside>

      {/* center: messages */}
      <div className="flex min-w-0 flex-1 flex-col bg-bg">
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-surface px-3">
          <span className="text-sm font-semibold text-fg">{t('消息', 'Messages')}</span>
          <span className="font-mono text-2xs text-fg-3">{shown.length}</span>
          <Select size="sm" value={filter} onChange={(e) => setFilter(e.target.value)} className="ml-2 w-[170px]">
            <option value="all">{t('全部主题', 'All topics')}</option>
            <option value="out">{t('仅已发送', 'Sent only')}</option>
            {subs.map((s) => (
              <option key={s.id} value={s.id}>
                {s.topic}
              </option>
            ))}
          </Select>
          <Input size="sm" icon={Search} placeholder={t('搜索内容', 'Search')} value={q} onChange={(e) => setQ(e.target.value)} className="w-[160px]" />
          <div className="ml-auto flex items-center gap-1">
            {paused && bufCount > 0 && <Badge tone="warn">{t(`暂停中 · ${bufCount} 条新消息`, `Paused · ${bufCount} new`)}</Badge>}
            <LogDockToggle />
            <IconButton
              size="sm"
              icon={paused ? Play : Pause}
              label={paused ? t('继续', 'Resume') : t('暂停', 'Pause')}
              active={paused}
              onClick={() => {
                if (paused) {
                  const buf = pausedBuf.current
                  pausedBuf.current = []
                  setBufCount(0)
                  setMsgs((ms) => [...ms, ...buf].slice(-400))
                }
                setPaused(!paused)
              }}
            />
            <IconButton size="sm" icon={Eraser} label={t('清空', 'Clear')} onClick={() => setMsgs([])} />
            <IconButton
              size="sm"
              icon={Download}
              label={t('导出', 'Export')}
              disabled={!msgs.length}
              onClick={async () => {
                const dest = await dialogs.saveFile(t('导出消息', 'Export messages'), `mqtt_${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}.json`, ['json'])
                if (!dest) return
                const data = msgs.map((m) => ({ time: new Date(m.t).toISOString(), dir: m.dir, topic: m.topic, qos: m.qos, retain: m.retain, payload: m.payload, binary: !!m.binary }))
                try {
                  await api.writeText(dest, JSON.stringify(data, null, 2))
                  toast('success', t('消息已导出', 'Messages exported'), dest)
                } catch (e) {
                  toast('error', t('导出失败', 'Export failed'), errText(e))
                }
              }}
            />
          </div>
        </div>
        <div ref={listRef} className="scroll-thin min-h-0 flex-1 overflow-auto px-4 py-3">
          {!connected && msgs.length === 0 ? (
            <EmptyState icon={RadioTower} title={mqttStatus === 'connecting' ? t('正在连接…', 'Connecting…') : t('未连接 MQTT 服务器', 'Not connected to a broker')} desc={t(`连接 ${conn.host || '服务器'} 后，订阅主题的消息会显示在这里。`, `Messages on subscribed topics appear here once connected to ${conn.host || 'a broker'}.`)}>
              <Button variant="primary" icon={Plug} onClick={connect} loading={mqttStatus === 'connecting'} disabled={mqttStatus === 'connecting'}>
                {t('连接', 'Connect')} {conn.name}
              </Button>
            </EmptyState>
          ) : shown.length === 0 ? (
            <EmptyState compact icon={RadioTower} title={t('等待消息…', 'Waiting for messages…')} desc={t('订阅的主题有新消息时会显示在这里', 'New messages on subscribed topics show up here')} />
          ) : (
            <div className="flex flex-col gap-2.5">
              {shown.map((m) => (
                <div key={m.id} className={cx('flex', m.dir === 'out' ? 'justify-end' : 'justify-start')}>
                  <div
                    className={cx('max-w-[82%] min-w-[240px] rounded-lg border px-3 py-2', m.dir === 'out' ? 'border-primary/25 bg-primary-soft' : 'border-line bg-surface')}
                    style={m.dir === 'in' ? { borderLeft: `3px solid ${m.color}` } : undefined}
                  >
                    <div className="mb-1 flex items-center gap-1.5 text-2xs">
                      <span className="truncate font-mono font-medium" style={{ color: m.dir === 'in' ? m.color : 'var(--accent)' }}>
                        {m.topic}
                      </span>
                      <span className="shrink-0 rounded bg-surface-3 px-1 font-mono text-[10px] text-fg-2">QoS {m.qos}</span>
                      {m.retain && <span className="shrink-0 rounded bg-warn-soft px-1 text-[10px] font-medium text-warn">Retained</span>}
                      <span className="ml-auto shrink-0 pl-2 font-mono text-[10px] text-fg-3">{fmtTime(new Date(m.t))}</span>
                    </div>
                    {m.binary ? <div className="font-mono text-[11.5px] break-all text-fg-2">{m.payload}</div> : <JsonView text={m.payload} />}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* right: publish */}
      <PublishPanel imei={imei} connected={connected} publish={publish} />
    </div>
  )
}

function PublishPanel({
  imei,
  connected,
  publish,
}: {
  imei: string
  connected: boolean
  publish: (topic: string, payload: string, qos: number, retain: boolean, hex?: boolean) => Promise<boolean>
}) {
  const { t, toast, device } = useApp()
  const [topic, setTopic] = useState('demo/<IMEI>/down')
  const [topicHist, setTopicHist] = usePersisted<string[]>('mqttTopicHist', ['demo/<IMEI>/down'])
  const [manualImei, setManualImei] = useState('')
  const [qos, setQos] = useState<'0' | '1' | '2'>('1')
  const [retain, setRetain] = useState(false)
  const [fmt, setFmt] = useState<'json' | 'text' | 'hex'>('json')
  const [payload, setPayload] = useState('{"msg":"hello"}')
  const [custom, setCustom] = usePersisted<Tpl[]>('mqttTemplates', [{ id: 't1', name: t('示例：打个招呼', 'Example: hello'), payload: '{"msg":"hello"}' }])
  const [savingName, setSavingName] = useState<string | null>(null)

  const useImei = imei || manualImei.trim()
  const resolved = topic.replace(/<IMEI>/g, useImei || '<IMEI>')
  const unresolved = resolved.includes('<IMEI>')

  const doPublish = async (body = payload, asJson = fmt === 'json') => {
    if (unresolved) return toast('error', t('无法填充 <IMEI>', 'Cannot fill <IMEI>'), t('在下方输入设备 IMEI，或等设备日志识别到 IMEI', 'Type the IMEI below or wait for the device log'))
    if (asJson && prettyJson(body) === null) return toast('error', t('JSON 格式错误', 'Invalid JSON'), t('可点击“校验 JSON”查看详情', 'Use “Validate JSON” for details'))
    if (fmt === 'hex' && !asJson && !/^([0-9a-fA-F]{2}\s*)+$/.test(body.trim())) return toast('error', t('HEX 格式错误', 'Invalid HEX'))
    if (await publish(resolved, body, Number(qos), retain, fmt === 'hex' && !asJson)) setTopicHist((h) => [topic, ...h.filter((x) => x !== topic)].slice(0, 8))
  }
  const validate = () => {
    try {
      JSON.parse(payload)
      toast('success', t('JSON 格式正确', 'Valid JSON'))
    } catch (e) {
      toast('error', t('JSON 校验失败', 'Invalid JSON'), (e as Error).message)
    }
  }
  const format = () => {
    const p = prettyJson(payload)
    if (p) setPayload(p)
    else toast('error', t('无法格式化', 'Cannot format'), t('内容不是合法 JSON', 'Content is not valid JSON'))
  }

  return (
    <aside className="scroll-thin flex w-[364px] shrink-0 flex-col overflow-auto border-l border-line bg-surface">
      <div className="flex flex-col gap-2.5 border-b border-line p-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-fg">{t('发布', 'Publish')}</span>
          {!connected && <Badge tone="neutral">{t('未连接', 'Offline')}</Badge>}
        </div>
        <Field label={t('主题', 'Topic')}>
          <div className="flex gap-1.5">
            <Input size="sm" mono value={topic} onChange={(e) => setTopic(e.target.value)} className="flex-1" />
            <Popover
              align="right"
              width={280}
              trigger={(_, toggle) => <IconButton icon={History} label={t('主题历史', 'History')} onClick={toggle} className="border border-line-strong" />}
            >
              {(close) =>
                topicHist.map((h) => (
                  <MenuItem
                    key={h}
                    onClick={() => {
                      setTopic(h)
                      close()
                    }}
                  >
                    <span className="font-mono text-xs">{h}</span>
                  </MenuItem>
                ))
              }
            </Popover>
          </div>
          {topic.includes('<IMEI>') && (
            <div className={cx('flex items-center gap-1.5 rounded-md px-2 py-1 text-2xs', unresolved ? 'bg-warn-soft text-warn' : 'bg-surface-2 text-fg-3')}>
              <Zap size={11} />
              {unresolved ? (
                <span className="flex flex-1 items-center gap-1.5">
                  {t('IMEI 未知，手动输入：', 'IMEI unknown:')}
                  <input value={manualImei} onChange={(e) => setManualImei(e.target.value.replace(/\D/g, '').slice(0, 15))} placeholder="86xxxxxxxxxxxxx" className="min-w-0 flex-1 rounded border border-warn/40 bg-surface px-1 font-mono text-[11px] text-fg outline-none" />
                </span>
              ) : (
                <span className="truncate">
                  <span className="font-mono text-fg-2">{resolved}</span>
                  <span className="ml-1">← {device.imei ? `${device.model || t('设备', 'device')} IMEI` : imei ? t('最近消息', 'recent message') : t('手动输入', 'manual')}</span>
                </span>
              )}
            </div>
          )}
          <p className="text-2xs text-fg-3">{t('主题里的 <IMEI> 会自动换成当前设备的 IMEI。', '<IMEI> in the topic is replaced with the device IMEI.')}</p>
        </Field>
        <div className="flex items-center gap-3">
          <span className="text-xs text-fg-2">QoS</span>
          <Segmented size="xs" value={qos} onChange={setQos} options={[{ value: '0', label: '0' }, { value: '1', label: '1' }, { value: '2', label: '2' }]} />
          <span className="ml-auto text-xs text-fg-2">Retain</span>
          <Switch size="sm" checked={retain} onChange={setRetain} />
        </div>
        <div className="flex items-center gap-1.5">
          <Segmented size="xs" value={fmt} onChange={setFmt} options={[{ value: 'json', label: 'JSON' }, { value: 'text', label: t('文本', 'Text') }, { value: 'hex', label: 'HEX' }]} />
          <div className="ml-auto flex gap-1">
            <Button size="xs" variant="ghost" icon={Wand2} onClick={format} disabled={fmt !== 'json'}>
              {t('格式化', 'Format')}
            </Button>
            <Button size="xs" variant="ghost" icon={CircleCheck} onClick={validate} disabled={fmt !== 'json'}>
              {t('校验 JSON', 'Validate')}
            </Button>
          </div>
        </div>
        <textarea
          value={payload}
          onChange={(e) => setPayload(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              doPublish()
            }
          }}
          spellCheck={false}
          className="h-[104px] resize-none rounded-md border border-line-strong bg-editor px-2.5 py-2 font-mono text-[11.5px] leading-[18px] text-fg outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
        />
        <Button variant="primary" icon={Send} onClick={() => doPublish()} className="w-full">
          {t('发布', 'Publish')}
        </Button>
      </div>

      <div className="flex flex-col gap-2 p-3">
        <div className="flex items-center gap-2">
          <Braces size={14} className="text-fg-3" />
          <span className="text-sm font-semibold text-fg">{t('消息模板', 'Message templates')}</span>
          <span className="text-xs text-fg-3">{custom.length}</span>
        </div>
        {custom.length === 0 && <div className="py-3 text-center text-xs text-fg-3">{t('还没有模板，可以把上面编辑器里的内容存成模板', 'No templates yet. Save the editor content as one.')}</div>}
        {custom.map((c) => (
          <div key={c.id} className="group flex items-center gap-2 rounded-md border border-line px-2.5 py-1.5">
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium text-fg">{c.name}</div>
              <div className="truncate font-mono text-[10.5px] text-fg-3">{c.payload}</div>
            </div>
            <Button size="xs" variant="ghost" onClick={() => setPayload(c.payload)}>
              {t('使用', 'Use')}
            </Button>
            <IconButton size="xs" icon={Trash2} tone="danger" label={t('删除', 'Delete')} onClick={() => setCustom((x) => x.filter((y) => y.id !== c.id))} />
          </div>
        ))}
        {savingName === null ? (
          <Button size="sm" variant="ghost" icon={BookmarkPlus} onClick={() => setSavingName('')} className="self-start">
            {t('把编辑器内容存为模板', 'Save editor content as template')}
          </Button>
        ) : (
          <div className="flex gap-1.5">
            <Input size="sm" autoFocus placeholder={t('模板名称', 'Template name')} value={savingName} onChange={(e) => setSavingName(e.target.value)} className="flex-1" />
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                setCustom((c) => [...c, { id: `t${Date.now()}`, name: savingName || t('未命名模板', 'Untitled'), payload }])
                setSavingName(null)
                toast('success', t('已保存为模板', 'Template saved'))
              }}
            >
              {t('保存', 'Save')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSavingName(null)}>
              {t('取消', 'Cancel')}
            </Button>
          </div>
        )}
      </div>
    </aside>
  )
}
