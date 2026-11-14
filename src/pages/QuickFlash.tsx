import { useEffect, useState } from 'react'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { Check, CircleCheck, CircleX, CloudDownload, FileArchive, FolderOpen, HardDrive, Info, TriangleAlert, Upload, X, Zap, CircleDashed } from 'lucide-react'
import { useApp } from '../store'
import { Badge, Button, Dot, Segmented, Switch, Input } from '../components/ui'
import { ChipGlyph } from '../components/overlays'
import { BootHint } from '../components/boot'
import { TaskProgress } from '../components/shell'
import { CHIP_OF, EC718H_MODELS, FAMILIES, FEATURE_EN, RECOMMENDED_BUILD, buildSpec, buildSummary, canFlash, familyOf, fileBuild, pickSameVariant, variantLabel } from '../data/catalog'
import { ModelSelect } from '../components/ModelSelect'
import { api, baseName, dialogs, errText, hasBackend, type FileStat, type SocInfo } from '../lib/api'
import { cx, fmtKB } from '../lib/format'

const EC718 = [
  { model: 'Air780EHM', zh: 'Cat.1 · 中国频段', en: 'Cat.1 · China bands' },
  { model: 'Air780EHN', zh: 'Cat.1 · 北美频段', en: 'Cat.1 · North America' },
  { model: 'Air780EPM', zh: 'Cat.1 · 4MB 精简版', en: 'Cat.1 · 4MB lite' },
  { model: 'Air8000', zh: '4G + WiFi + GNSS', en: '4G + WiFi + GNSS' },
]

function StepCard({ n, title, done, summary, children, optional }: { n: number; title: string; done: boolean; summary?: React.ReactNode; children: React.ReactNode; optional?: string }) {
  return (
    <section className="rounded-lg border border-line bg-surface">
      <header className="flex h-11 items-center gap-2.5 border-b border-line px-4">
        <span className={cx('flex size-[22px] items-center justify-center rounded-full text-xs font-semibold', done ? 'bg-primary text-white' : 'bg-surface-3 text-fg-2')}>
          {done ? <Check size={12} strokeWidth={3} /> : n}
        </span>
        <h3 className="text-sm font-semibold text-fg">{title}</h3>
        {optional && <span className="text-xs text-fg-3">{optional}</span>}
        <div className="ml-auto min-w-0 truncate text-xs text-fg-2">{summary}</div>
      </header>
      <div className="p-4">{children}</div>
    </section>
  )
}

export default function QuickFlashPage() {
  const { t, device, fwStatus, requestDownload, task, setPage, page, toast, versionsOf, loadVersions, buildsOf, loadBuilds, cachedPath, loadSocInfo, socInfoOf, tildify } = useApp()
  const [model, setModel] = useState('Air780EHM')
  const [src, setSrc] = useState<'online' | 'local'>('online')
  const [version, setVersion] = useState('')
  const [file, setFile] = useState('')
  const [localFile, setLocalFile] = useState<string | null>(null)
  const [localInfo, setLocalInfo] = useState<SocInfo | null>(null)
  const [localErr, setLocalErr] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [withScript, setWithScript] = useState(false)
  const [scriptDir, setScriptDir] = useState<string | null>(null)
  const [scriptFiles, setScriptFiles] = useState<FileStat[]>([])
  const [netErr, setNetErr] = useState('')

  const versions = versionsOf(model)
  const builds = version ? buildsOf(model, version) : null
  useEffect(() => {
    if (src !== 'online') return
    setNetErr('')
    loadVersions(model)
      .then((vs) => {
        const v = vs.some((x) => x.version === version) ? version : (vs[0]?.version ?? '')
        setVersion(v)
        if (v) return loadBuilds(model, v)
      })
      .catch((e) => setNetErr(errText(e)))
  }, [model, src]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (builds?.length && !builds.some((b) => b.file === file)) setFile(pickSameVariant(model, file, builds)?.file ?? '')
  }, [builds]) // eslint-disable-line react-hooks/exhaustive-deps

  // 本地固件：解析 soc 校验
  const chooseLocal = async (path: string) => {
    if (!/\.(soc|binpkg)$/i.test(path)) return toast('error', t('不支持的文件类型', 'Unsupported file'), t('仅支持 .soc / .binpkg', 'Only .soc / .binpkg'))
    setLocalFile(path)
    setLocalInfo(null)
    setLocalErr('')
    if (path.toLowerCase().endsWith('.soc')) {
      try {
        setLocalInfo(await api.socInfo(path))
      } catch (e) {
        setLocalErr(errText(e))
      }
    }
  }
  // 拖放文件：Tauri 拦截了网页的拖放，从窗口事件里拿文件路径
  useEffect(() => {
    if (!hasBackend || page !== 'flash' || src !== 'local') return
    let un: (() => void) | undefined
    getCurrentWebview()
      .onDragDropEvent((ev) => {
        if (ev.payload.type === 'over' || ev.payload.type === 'enter') setDragOver(true)
        else if (ev.payload.type === 'leave') setDragOver(false)
        else if (ev.payload.type === 'drop') {
          setDragOver(false)
          const f = ev.payload.paths[0]
          if (f) chooseLocal(f)
        }
      })
      .then((u) => (un = u))
    return () => un?.()
  }, [page, src]) // eslint-disable-line react-hooks/exhaustive-deps

  const onlinePath = version ? cachedPath(model, version, file) : null
  useEffect(() => {
    if (onlinePath) loadSocInfo(onlinePath)
  }, [onlinePath]) // eslint-disable-line react-hooks/exhaustive-deps
  const info = src === 'local' ? localInfo : socInfoOf(onlinePath)
  const spec = buildSpec(model, fileBuild(file))
  const capKB = info?.scriptKb ?? (src === 'online' ? spec?.scriptKB : undefined) ?? 1024

  const fwName = src === 'online' ? (version && file ? file : null) : localFile ? baseName(localFile) : null
  const fwReady = src === 'online' ? !!version && !!file : !!localFile && !localErr
  const files = withScript ? scriptFiles : []
  const scriptBytes = files.reduce((s, f) => s + f.size, 0)
  const overCap = scriptBytes / 1024 > capKB
  const downloaded = fwStatus[`${model}/${version}/${file}`] === 'done'
  const hasMain = files.some((f) => f.name === 'main.lua' || f.name === 'main.luac')

  const pickScriptDir = async () => {
    const d = await dialogs.pickDir(t('选择包含 main.lua 的脚本文件夹', 'Choose the folder containing main.lua'))
    if (!d) return
    try {
      const list = await api.dirFiles(d)
      setScriptDir(d)
      setScriptFiles(await api.filesStat(list))
    } catch (e) {
      toast('error', t('读取文件夹失败', 'Cannot read folder'), errText(e))
    }
  }

  type C = { ok: 'ok' | 'warn' | 'err' | 'wait'; zh: string; en: string; dzh: string; den: string }
  const devName = device.model || t('合宙模组', 'module')
  const checks: C[] = [
    device.status === 'offline'
      ? { ok: 'err', zh: '设备已连接', en: 'Device connected', dzh: '未检测到模组；可手动按 BOOT 键进入刷机模式', den: 'No module detected — enter flash mode with BOOT' }
      : { ok: 'ok', zh: '设备已连接', en: 'Device connected', dzh: `${devName} · ${device.port} · ${device.status === 'boot' ? '下载模式' : '运行中'}`, den: `${devName} · ${device.port} · ${device.status === 'boot' ? 'download mode' : 'running'}` },
    !device.model || device.status === 'offline'
      ? { ok: 'wait', zh: '型号与固件匹配', en: 'Model matches firmware', dzh: '型号会在模组开机日志里识别；请确认选择正确', den: 'Model is detected from boot logs; double-check your selection' }
      : device.model === model || (info && EC718H_MODELS.includes(device.model) && EC718H_MODELS.includes(model))
        ? { ok: 'ok', zh: '型号与固件匹配', en: 'Model matches firmware', dzh: `${device.model} ↔ ${fwName ?? '—'}`, den: `${device.model} ↔ ${fwName ?? '—'}` }
        : { ok: 'err', zh: '型号与固件匹配', en: 'Model matches firmware', dzh: `设备为 ${device.model}，已选 ${model}`, den: `Device is ${device.model}, selected ${model}` },
    overCap
      ? { ok: 'err', zh: '脚本未超容量', en: 'Scripts fit script area', dzh: `${fmtKB(scriptBytes)} > ${capKB} KB`, den: `${fmtKB(scriptBytes)} > ${capKB} KB` }
      : withScript && scriptDir && !hasMain
        ? { ok: 'warn', zh: '脚本未超容量', en: 'Scripts fit script area', dzh: '文件夹里没有 main.lua，模组开机不会运行脚本', den: 'No main.lua in the folder' }
        : { ok: 'ok', zh: '脚本未超容量', en: 'Scripts fit script area', dzh: withScript && scriptDir ? `${(scriptBytes / 1024).toFixed(1)} / ${capKB} KB` : '未选择脚本，仅烧录底层', den: withScript && scriptDir ? `${(scriptBytes / 1024).toFixed(1)} / ${capKB} KB` : 'No scripts — CORE only' },
  ]
  const checkIcon = { ok: CircleCheck, warn: TriangleAlert, err: CircleX, wait: CircleDashed }
  const checkColor = { ok: 'text-ok', warn: 'text-warn', err: 'text-err', wait: 'text-fg-3' }
  const canStart = fwReady && canFlash(model) && !(withScript && !scriptDir) && !overCap && task?.status !== 'running'

  const start = () =>
    requestDownload('flash', {
      model,
      firmware: fwName ?? '',
      soc: src === 'online' ? { source: 'resource', model, version, file } : { source: 'local', path: localFile ?? '' },
      scriptFiles: files.map((f) => f.path),
      scriptsBytes: scriptBytes,
      scriptCount: files.length,
      projectName: undefined,
      luacDebug: 99,
      listenAfter: true,
    })

  return (
    <div className="flex h-full">
      <div className="scroll-thin min-w-0 flex-1 overflow-auto p-5">
        <div className="mb-4">
          <h1 className="text-lg font-semibold text-fg">{t('快速烧录', 'Quick Flash')}</h1>
          <p className="text-xs text-fg-3">{t('无需创建项目，选择开发板与固件后直接刷入模组。', 'Flash a board directly without creating a project.')}</p>
        </div>
        <div className="flex flex-col gap-4">
          <StepCard n={1} title={t('选开发板', 'Choose board')} done summary={<span className="font-medium text-fg">{model}</span>}>
            <div className="mb-2 text-2xs font-semibold text-fg-3">EC718 {t('系列', 'family')}</div>
            <div className="grid grid-cols-4 gap-2.5">
              {EC718.map((m) => {
                const on = model === m.model
                const detected = device.status !== 'offline' && device.model === m.model
                return (
                  <button
                    key={m.model}
                    type="button"
                    onClick={() => setModel(m.model)}
                    className={cx('relative flex items-center gap-3 rounded-lg border p-3 text-left transition-colors', on ? 'border-primary bg-primary-soft ring-1 ring-primary' : 'border-line hover:border-line-strong hover:bg-hover')}
                  >
                    <ChipGlyph active={on} />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-fg">{m.model}</div>
                      <div className="truncate text-2xs text-fg-3">{detected ? <span className="text-ok">{t('已连接 · ', 'Detected · ')}</span> : null}{t(m.zh, m.en)}</div>
                    </div>
                    {detected && (
                      <span className="absolute top-2 right-2 flex items-center gap-1 text-[10px] font-medium text-ok" title={t('已检测到该型号设备', 'Device of this model detected')}>
                        <Dot tone="ok" pulse />
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
            <div className="mt-4 flex items-center gap-3">
              <span className="text-2xs font-semibold text-fg-3">{t('其他型号', 'Other models')}</span>
              <ModelSelect value={model} onChange={setModel} className="w-56" size="sm" />
              <span className="text-2xs text-fg-3">
                {CHIP_OF[model] ?? ''}
                {familyOf(model) ? ` · ${t(FAMILIES[familyOf(model)!].zh, FAMILIES[familyOf(model)!].en)}` : ''}
              </span>
            </div>
            {!canFlash(model) && (
              <div className="mt-2 rounded-md border border-warn/30 bg-warn-soft px-2.5 py-2 text-xs text-fg">
                {t('这类芯片要经串口刷机，烧录器下一步再支持。现在可以先下载它的固件。', 'This chip family is flashed over a serial port, which comes in the next step. You can already download its firmware.')}
              </div>
            )}
          </StepCard>

          <StepCard n={2} title={t('选固件', 'Choose firmware')} done={fwReady} summary={fwName ? <span className="font-mono">{fwName}</span> : t('未选择', 'None')}>
            <Segmented
              value={src}
              onChange={setSrc}
              options={[
                { value: 'online', label: t('在线固件资源', 'Online resources'), icon: CloudDownload },
                { value: 'local', label: t('本地文件', 'Local file'), icon: HardDrive },
              ]}
            />
            {src === 'online' ? (
              <div className="mt-3">
                {netErr && <div className="mb-3 rounded-md border border-err/30 bg-err-soft px-2.5 py-2 text-xs text-fg">{t('无法读取合宙固件列表：', 'Cannot load firmware list: ')}{netErr}</div>}
                {!versions && !netErr && <div className="mb-3 text-xs text-fg-3">{t('正在读取合宙固件列表…', 'Loading firmware list…')}</div>}
                <div className="mb-3 flex flex-wrap gap-2">
                  {versions?.slice(0, 5).map((v, i) => (
                    <button
                      key={v.version}
                      type="button"
                      onClick={() => {
                        setVersion(v.version)
                        loadBuilds(model, v.version).catch((e) => setNetErr(errText(e)))
                      }}
                      className={cx('rounded-md border px-3 py-1.5 text-left transition-colors', version === v.version ? 'border-primary bg-primary-soft' : 'border-line hover:bg-hover')}
                    >
                      <div className="flex items-center gap-1.5 font-mono text-xs font-semibold text-fg">
                        {v.version}
                        {i === 0 && <Badge tone="ok">{t('最新', 'Latest')}</Badge>}
                      </div>
                      <div className="text-[10px] text-fg-3">
                        {t('发布于', 'Released')} {v.date}
                      </div>
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-3 gap-2.5">
                  {builds?.map((x) => {
                    const on = file === x.file
                    const st = fwStatus[`${model}/${version}/${x.file}`]
                    const sp = buildSpec(model, x.build)
                    return (
                      <button
                        key={x.file}
                        type="button"
                        title={x.file}
                        onClick={() => setFile(x.file)}
                        className={cx('relative overflow-hidden rounded-lg border p-3 text-left transition-colors', on ? 'border-primary bg-primary-soft ring-1 ring-primary' : 'border-line hover:bg-hover')}
                      >
                        {x.build === RECOMMENDED_BUILD && EC718H_MODELS.includes(model) && (
                          <span className="absolute top-0 right-0 rounded-bl-md bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-white">{t('推荐', 'Recommended')}</span>
                        )}
                        <div className="flex items-baseline gap-2">
                          <span className="font-mono text-sm font-semibold text-fg">{variantLabel(x.file, t)}</span>
                          <span className="truncate text-2xs text-fg-3">{sp ? buildSummary(sp.features, t) : `${(x.size / 1048576).toFixed(1)} MB`}</span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {sp?.features
                            .filter((f) => ['TTS', '语音通话', '音频', '摄像头', 'AirUI', 'LCD', '蓝牙'].includes(f))
                            .map((f) => (
                              <span key={f} className="rounded bg-surface-3 px-1.5 py-px text-[10px] text-fg-2">
                                {t(f, FEATURE_EN[f] ?? f)}
                              </span>
                            ))}
                          {sp && (
                            <span className="rounded bg-primary-soft px-1.5 py-px text-[10px] text-accent">
                              {t('脚本区', 'Script')} {sp.scriptKB}KB
                            </span>
                          )}
                        </div>
                        <div className="mt-2 flex items-center justify-between text-2xs text-fg-3">
                          <span className="font-mono">{Math.round(x.size / 1024)} KB</span>
                          {st === 'done' ? (
                            <span className="text-ok">{t('已下载', 'Downloaded')}</span>
                          ) : typeof st === 'object' ? (
                            <span className="text-accent">{Math.round(st.progress)}%</span>
                          ) : (
                            <span>{t('烧录时自动下载', 'Fetched on flash')}</span>
                          )}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : (
              <div className="mt-3">
                {localFile ? (
                  <div className="flex items-center gap-3 rounded-lg border border-line bg-surface-2 px-3 py-2.5">
                    <FileArchive size={20} className="text-accent" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono text-xs text-fg" title={localFile}>
                        {baseName(localFile)}
                      </div>
                      <div className={cx('truncate text-2xs', localErr ? 'text-err' : 'text-fg-3')}>
                        {localErr
                          ? localErr
                          : localInfo
                            ? `${localInfo.chip} · ${localInfo.bits}${t(' 位', '-bit')} · ${t('脚本区', 'script')} ${localInfo.scriptKb}KB · ${Math.round(localInfo.size / 1024)} KB · ${t('已校验', 'Verified')}`
                            : tildify(localFile)}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={X}
                      onClick={() => {
                        setLocalFile(null)
                        setLocalInfo(null)
                        setLocalErr('')
                      }}
                    >
                      {t('移除', 'Remove')}
                    </Button>
                  </div>
                ) : (
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={async () => {
                      const f = await dialogs.pickFile(t('选择固件', 'Choose firmware'), ['soc', 'binpkg'], 'LuatOS')
                      if (f) chooseLocal(f)
                    }}
                    className={cx(
                      'flex h-32 flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed text-center transition-colors',
                      dragOver ? 'border-primary bg-primary-soft' : 'border-line-strong hover:border-fg-3 hover:bg-hover',
                    )}
                  >
                    <Upload size={22} className="text-fg-3" />
                    <div className="text-sm text-fg">{t('拖入 .soc / .binpkg 文件，或点击选择', 'Drop a .soc / .binpkg file, or click to browse')}</div>
                    <div className="text-2xs text-fg-3">{t('支持合宙官方固件与自定义编译固件', 'Official and custom-built firmware supported')}</div>
                  </div>
                )}
              </div>
            )}
          </StepCard>

          <StepCard
            n={3}
            title={t('选脚本文件夹', 'Choose script folder')}
            optional={t('（可选）', '(optional)')}
            done={withScript && !!scriptDir}
            summary={withScript && scriptDir ? t(`${files.length} 个文件 · ${fmtKB(scriptBytes)}`, `${files.length} files · ${fmtKB(scriptBytes)}`) : t('仅烧录底层', 'CORE only')}
          >
            <div className="flex items-center gap-3">
              <Switch checked={withScript} onChange={setWithScript} />
              <span className="text-sm text-fg">{t('同时下载脚本', 'Also download scripts')}</span>
              <span className="text-xs text-fg-3">{t('选择包含 main.lua 的文件夹', 'Pick a folder containing main.lua')}</span>
            </div>
            {withScript && (
              <div className="mt-3 flex flex-col gap-2.5">
                <div className="flex gap-2">
                  <Input mono readOnly value={scriptDir ? tildify(scriptDir) : ''} placeholder={t('未选择文件夹', 'No folder selected')} className="flex-1" />
                  <Button icon={FolderOpen} onClick={pickScriptDir}>
                    {t('选择文件夹', 'Choose folder')}
                  </Button>
                </div>
                {scriptDir && (
                  <div className="rounded-md border border-line bg-surface-2 p-2.5">
                    <div className="mb-2 flex items-center gap-2 text-xs text-fg-2">
                      <span>{t('脚本区占用', 'Script area')}</span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                        <div className={cx('h-full rounded-full', overCap ? 'bg-err' : 'bg-primary')} style={{ width: `${Math.max(1, Math.min(100, (scriptBytes / 1024 / capKB) * 100))}%` }} />
                      </div>
                      <span className="font-mono">
                        {(scriptBytes / 1024).toFixed(1)} / {capKB} KB
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {files.map((f) => (
                        <span key={f.path} className="rounded bg-surface px-1.5 py-0.5 font-mono text-[10.5px] text-fg-2 ring-1 ring-line" title={f.path}>
                          {f.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </StepCard>
        </div>
      </div>

      <aside className="flex w-[324px] shrink-0 flex-col gap-4 border-l border-line bg-surface p-4">
        <div>
          <div className="mb-2 text-2xs font-semibold text-fg-3">{t('烧录摘要', 'Summary')}</div>
          <dl className="flex flex-col gap-1.5 text-xs">
            {[
              [t('开发板', 'Board'), model],
              [t('固件', 'Firmware'), fwName ?? '—'],
              [t('脚本', 'Scripts'), withScript && scriptDir ? `${files.length} · ${fmtKB(scriptBytes)}` : t('不下载', 'None')],
              [t('固件状态', 'Status'), src === 'local' ? t('本地文件', 'Local') : downloaded ? t('已下载', 'Downloaded') : t('将先下载固件', 'Will download first')],
            ].map(([k, v]) => (
              <div key={k} className="flex gap-3">
                <dt className="w-14 shrink-0 text-fg-3">{k}</dt>
                <dd className="min-w-0 flex-1 font-mono text-[11.5px] break-all text-fg">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div>
          <div className="mb-2 text-2xs font-semibold text-fg-3">{t('烧录前检查', 'Pre-flash checks')}</div>
          <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
            {checks.map((c) => {
              const I = checkIcon[c.ok]
              return (
                <li key={c.zh} className="flex items-start gap-2.5 px-3 py-2">
                  <I size={16} className={cx('mt-0.5 shrink-0', checkColor[c.ok])} />
                  <div className="min-w-0">
                    <div className="text-sm text-fg">{t(c.zh, c.en)}</div>
                    <div className="text-2xs break-all text-fg-3">{t(c.dzh, c.den)}</div>
                  </div>
                </li>
              )
            })}
          </ul>
          <button type="button" onClick={() => setPage('settings')} className="mt-1.5 flex items-center gap-1 text-2xs text-accent hover:underline">
            <Info size={11} />
            {t('检测不到设备？在设置中运行环境诊断（含虚拟机占用检查）', 'No device? Run diagnostics in Settings')}
          </button>
        </div>
        <BootHint />
        <div className="mt-auto flex flex-col gap-2.5">
          <TaskProgress wide />
          <Button size="lg" variant="primary" icon={Zap} className="h-12 w-full text-[15px]" onClick={start} disabled={!canStart}>
            {t('开始烧录', 'Start flashing')}
          </Button>
        </div>
      </aside>
    </div>
  )
}
