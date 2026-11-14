import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronRight, CircleCheck, CloudDownload, Cpu, Eraser, FileArchive, FolderOpen, Package, RefreshCw, Search, Trash2, Zap, LoaderCircle } from 'lucide-react'
import { useApp, type FwStatus } from '../store'
import { Badge, Button, Checkbox, Input, Progress } from '../components/ui'
import { CHIP_OF, EC718H_BUILDS, EC718H_MODELS, FAMILIES, FEATURE_EN, FW_MODELS, RECOMMENDED_BUILD, buildSpec, buildSummary, canFlash, defaultBuild, familyOf, fileBuild, variantLabel } from '../data/catalog'
import { api, dialogs, errText } from '../lib/api'
import { cx, fmtTime } from '../lib/format'

interface LogLine {
  t: number
  text: string
  tone?: 'ok' | 'err' | 'dim'
}

/** 与后端缓存的 key 一致：`<型号>/<版本>/<文件名>` */
const keyOf = (m: string, v: string, f: string) => `${m}/${v}/${f}`
const splitKey = (k: string) => {
  const [m, v, ...rest] = k.split('/')
  return [m, v, rest.join('/')] as const
}
const MATRIX_FEATURES = ['TTS', '语音通话', '音频', '摄像头', 'LCD', 'AirUI', '蓝牙', '对讲', '中文字库']

export default function FirmwarePage() {
  const { t, fwStatus, toast, project, updateProject, versionsOf, loadVersions, buildsOf, loadBuilds, downloadFw, deleteFw, cachedPath, loadSocInfo, socInfoOf, tildify, confirm } = useApp()
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['Air780EHM']))
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [focus, setFocus] = useState({ model: 'Air780EHM', version: '', file: '' })
  const [q, setQ] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [loadErr, setLoadErr] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState<LogLine[]>([])
  const logRef = useRef<HTMLDivElement>(null)
  const fwStatusRef = useRef(fwStatus)
  fwStatusRef.current = fwStatus
  const addLog = (text: string, tone?: LogLine['tone']) => setLog((l) => [...l, { t: Date.now(), text, tone }].slice(-300))

  // 展开型号时读取版本列表，展开版本时读取编号列表
  const ensureVersions = (m: string, force = false) =>
    loadVersions(m, force)
      .then((vs) => {
        setLoadErr((e) => ({ ...e, [m]: '' }))
        return vs
      })
      .catch((er) => {
        setLoadErr((e) => ({ ...e, [m]: errText(er) }))
        return []
      })
  const ensureBuilds = (m: string, v: string) =>
    loadBuilds(m, v)
      .then((bs) => {
        setLoadErr((e) => ({ ...e, [`${m}/${v}`]: '' }))
        return bs
      })
      .catch((er) => {
        setLoadErr((e) => ({ ...e, [`${m}/${v}`]: errText(er) }))
        return []
      })
  useEffect(() => {
    ensureVersions('Air780EHM').then((vs) => {
      if (vs[0]) {
        setExpanded((s) => new Set([...s, `Air780EHM/${vs[0].version}`]))
        ensureBuilds('Air780EHM', vs[0].version).then((bs) =>
          setFocus((f) => (f.version ? f : { ...f, version: vs[0].version, file: defaultBuild('Air780EHM', bs)?.file ?? '' })),
        )
      }
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [log.length])

  const loadedKeys = (m: string, v?: string) =>
    (v ? [v] : (versionsOf(m) ?? []).map((x) => x.version)).flatMap((ver) => (buildsOf(m, ver) ?? []).map((b) => keyOf(m, ver, b.file)))
  const sizeOfKey = (k: string) => {
    const [m, v, f] = splitKey(k)
    return buildsOf(m, v)?.find((x) => x.file === f)?.size ?? 0
  }
  const triState = (keys: string[]) => {
    const n = keys.filter((k) => checked.has(k)).length
    return { all: n === keys.length && n > 0, some: n > 0 && n < keys.length }
  }
  const setMany = (keys: string[], on: boolean) =>
    setChecked((s) => {
      const x = new Set(s)
      keys.forEach((k) => (on ? x.add(k) : x.delete(k)))
      return x
    })
  const toggleExp = (k: string) => {
    const opening = !expanded.has(k)
    setExpanded((s) => {
      const x = new Set(s)
      if (x.has(k)) x.delete(k)
      else x.add(k)
      return x
    })
    if (opening) {
      const [m, v] = k.split('/')
      if (v) ensureBuilds(m, v)
      else ensureVersions(m)
    }
  }

  const startDownload = async () => {
    const todo = [...checked].filter((k) => fwStatus[k] !== 'done' && typeof fwStatus[k] !== 'object')
    if (!todo.length) return toast('info', t('所选固件均已下载', 'Selected firmware already downloaded'))
    setBusy(true)
    setChecked(new Set())
    const start = Date.now()
    addLog(t(`开始下载 ${todo.length} 个固件（并发 2）…`, `Downloading ${todo.length} files (2 concurrent)…`), 'dim')
    let ok = 0
    let fail = 0
    const queue = [...todo]
    const worker = async () => {
      while (queue.length) {
        const k = queue.shift()!
        const [m, v, f] = splitKey(k)
        // 同一个 zip 里的固件：前一个下载时已经整包解出来了
        if (fwStatusRef.current[k] === 'done') {
          ok++
          addLog(`${f}  ✓`, 'ok')
          continue
        }
        const path = await downloadFw(m, v, f)
        if (path) {
          ok++
          addLog(`${f}  ${Math.round(sizeOfKey(k) / 1024)} KB  ✓`, 'ok')
        } else {
          fail++
          addLog(`${f}  ✗`, 'err')
        }
      }
    }
    await Promise.all([worker(), worker()])
    const secs = Math.round((Date.now() - start) / 1000)
    addLog(t(`下载结果：成功 ${ok} 个，失败 ${fail} 个，耗时 ${secs} 秒`, `Result: ${ok} succeeded, ${fail} failed, ${secs}s`))
    if (ok) toast('success', t('固件下载完成', 'Firmware downloaded'), t(`成功 ${ok} 个，耗时 ${secs} 秒`, `${ok} files in ${secs}s`))
    setBusy(false)
  }

  const selectedSizeMB = [...checked].reduce((s, k) => s + sizeOfKey(k), 0) / 1048576
  const statusCell = (st: FwStatus | undefined) =>
    st === 'done' ? (
      <Badge tone="ok" dot>
        {t('已下载', 'Downloaded')}
      </Badge>
    ) : typeof st === 'object' ? (
      <span className="flex w-full items-center gap-2">
        <LoaderCircle size={12} className="animate-spin text-accent" />
        <Progress value={st.progress} striped className="flex-1" height="h-1" />
        <span className="w-8 text-right font-mono text-2xs text-accent">{Math.floor(st.progress)}%</span>
      </span>
    ) : (
      <span className="text-2xs text-fg-3">{t('未下载', 'Not downloaded')}</span>
    )

  // 右侧详情
  const fKey = keyOf(focus.model, focus.version, focus.file)
  const fBuild = focus.version ? buildsOf(focus.model, focus.version)?.find((b) => b.file === focus.file) : undefined
  const fVer = versionsOf(focus.model)?.find((v) => v.version === focus.version)
  const fPath = focus.version ? cachedPath(focus.model, focus.version, focus.file) : null
  const fNum = fBuild?.build ?? fileBuild(focus.file)
  useEffect(() => {
    if (fPath) loadSocInfo(fPath)
  }, [fPath]) // eslint-disable-line react-hooks/exhaustive-deps
  const fInfo = socInfoOf(fPath)
  const fSpec = buildSpec(focus.model, fNum)
  const latest = (m: string) => versionsOf(m)?.[0]?.version
  const models = FW_MODELS.filter((m) => !q || m.toLowerCase().includes(q.toLowerCase()))
  const wide = (fNum ?? RECOMMENDED_BUILD) > 100
  const matrixBuilds = useMemo(() => EC718H_BUILDS.map((b) => ({ ...b, build: wide ? b.n + 100 : b.n })), [wide])

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-surface px-3">
          <Button
            size="sm"
            icon={RefreshCw}
            loading={refreshing}
            onClick={async () => {
              setRefreshing(true)
              const ms = [...expanded].filter((k) => !k.includes('/'))
              const res = await Promise.all(ms.map((m) => ensureVersions(m, true)))
              setRefreshing(false)
              const newest = res[0]?.[0]
              toast('success', t('固件列表已刷新', 'Firmware list refreshed'), newest ? t(`最新版本 ${newest.version} · ${newest.date}`, `Latest ${newest.version} · ${newest.date}`) : undefined)
            }}
          >
            {t('刷新列表', 'Refresh')}
          </Button>
          <Button size="sm" icon={Eraser} onClick={() => setChecked(new Set())} disabled={!checked.size}>
            {t('清除全部已选', 'Clear selection')}
          </Button>
          <Button size="sm" variant="primary" icon={CloudDownload} onClick={startDownload} disabled={!checked.size || busy} loading={busy}>
            {t('开始下载（非刷机）', 'Download (no flashing)')}
          </Button>
          <Button size="sm" variant="ghost" icon={FolderOpen} onClick={async () => dialogs.openPath(await api.fwCacheDir())}>
            {t('打开本地资源目录', 'Open resource folder')}
          </Button>
          <div className="ml-auto flex items-center gap-2">
            {checked.size > 0 && (
              <span className="text-2xs text-fg-2">
                {t(`已选 ${checked.size} 项 · ${selectedSizeMB.toFixed(1)} MB`, `${checked.size} selected · ${selectedSizeMB.toFixed(1)} MB`)}
              </span>
            )}
            <Input size="sm" icon={Search} placeholder={t('型号', 'Model')} value={q} onChange={(e) => setQ(e.target.value)} className="w-[140px]" />
          </div>
        </div>
        <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_170px_92px] border-b border-line bg-surface-2 px-3 py-1.5 text-2xs font-medium text-fg-3">
          <span className="pl-6">{t('名称', 'Name')}</span>
          <span>{t('状态', 'Status')}</span>
          <span className="text-right">{t('大小', 'Size')}</span>
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-auto bg-surface py-1">
          {models.map((m) => {
            const mk = loadedKeys(m)
            const mt = triState(mk)
            const doneN = mk.filter((k) => fwStatus[k] === 'done').length
            const open = expanded.has(m)
            const versions = versionsOf(m)
            return (
              <div key={m}>
                <div className="grid grid-cols-[minmax(0,1fr)_170px_92px] items-center px-3 py-1 hover:bg-hover">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <button type="button" onClick={() => toggleExp(m)} className="text-fg-3 hover:text-fg">
                      {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                    <Checkbox checked={mt.all} indeterminate={mt.some} onChange={(v) => setMany(mk, v)} disabled={!mk.length} />
                    <Cpu size={14} className="ml-1 text-fg-3" />
                    <span className="cursor-pointer text-sm font-semibold text-fg" onClick={() => toggleExp(m)}>
                      {m}
                    </span>
                    <span className="text-2xs text-fg-3">
                      {CHIP_OF[m]}
                      {versions && ` · ${t(`${versions.length} 个版本`, `${versions.length} versions`)}`}
                    </span>
                    {!canFlash(m) && (
                      <span title={t(FAMILIES[familyOf(m)!].zh, FAMILIES[familyOf(m)!].en)}>
                        <Badge>{t('暂只能下载', 'Download only')}</Badge>
                      </span>
                    )}
                  </span>
                  <span className="text-2xs text-fg-3">{mk.length > 0 && `${t('已下载', 'Downloaded')} ${doneN}/${mk.length}`}</span>
                  <span />
                </div>
                {open && !versions && (
                  <div className="py-1 pl-14 text-2xs text-fg-3">
                    {loadErr[m] ? <span className="text-err">{loadErr[m]}</span> : t('正在读取版本列表…', 'Loading versions…')}
                  </div>
                )}
                {open &&
                  versions?.map((v) => {
                    const vkKey = `${m}/${v.version}`
                    const builds = buildsOf(m, v.version)
                    const vk = loadedKeys(m, v.version)
                    const vt = triState(vk)
                    const vopen = expanded.has(vkKey)
                    const vdone = vk.filter((k) => fwStatus[k] === 'done').length
                    return (
                      <div key={vkKey}>
                        <div className="grid grid-cols-[minmax(0,1fr)_170px_92px] items-center py-1 pr-3 pl-8 hover:bg-hover">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <button type="button" onClick={() => toggleExp(vkKey)} className="text-fg-3 hover:text-fg">
                              {vopen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </button>
                            <Checkbox
                              checked={vt.all}
                              indeterminate={vt.some}
                              onChange={async (x) => {
                                const bs = builds ?? (await ensureBuilds(m, v.version))
                                setMany(
                                  bs.map((b) => keyOf(m, v.version, b.file)),
                                  x,
                                )
                              }}
                            />
                            <Package size={14} className="ml-1 text-fg-3" />
                            <span className="cursor-pointer truncate text-xs text-fg" onClick={() => toggleExp(vkKey)}>
                              {t(`${m} ${v.version} 版本固件，发布于 ${v.date}`, `${m} ${v.version} firmware, released ${v.date}`)}
                            </span>
                            {v.version === latest(m) && <Badge tone="ok">{t('最新', 'Latest')}</Badge>}
                          </span>
                          <span className="text-2xs text-fg-3">{builds && `${vdone}/${vk.length}`}</span>
                          <span />
                        </div>
                        {vopen && !builds && (
                          <div className="py-1 pl-[66px] text-2xs text-fg-3">
                            {loadErr[vkKey] ? <span className="text-err">{loadErr[vkKey]}</span> : t('正在读取固件列表…', 'Loading builds…')}
                          </div>
                        )}
                        {vopen &&
                          builds?.map((b) => {
                            const k = keyOf(m, v.version, b.file)
                            const sel = focus.model === m && focus.version === v.version && focus.file === b.file
                            return (
                              <div
                                key={k}
                                onClick={() => setFocus({ model: m, version: v.version, file: b.file })}
                                className={cx('grid cursor-default grid-cols-[minmax(0,1fr)_170px_92px] items-center py-1 pr-3 pl-[66px]', sel ? 'bg-primary-soft' : 'hover:bg-hover')}
                              >
                                <span className="flex min-w-0 items-center gap-1.5">
                                  <Checkbox checked={checked.has(k)} onChange={(x) => setMany([k], x)} />
                                  <FileArchive size={13} className="ml-1 shrink-0 text-fg-3" />
                                  <span className="truncate text-xs text-fg">
                                    {variantLabel(b.file, t)} <span className="text-fg-3">-</span> <span className="font-mono text-[11.5px] text-fg-2">{b.file}</span>
                                  </span>
                                  {b.zip && (
                                    <span className="shrink-0 rounded bg-surface-3 px-1 text-[10px] text-fg-3" title={t(`在 ${b.zip} 里，下载时整包下载再解压`, `Inside ${b.zip}; downloaded and extracted`)}>
                                      zip
                                    </span>
                                  )}
                                  {b.build === RECOMMENDED_BUILD && EC718H_MODELS.includes(m) && <Badge tone="primary">{t('推荐', 'Rec.')}</Badge>}
                                </span>
                                <span className="pr-4">{statusCell(fwStatus[k])}</span>
                                <span className="text-right font-mono text-xs text-fg-2">{Math.round(b.size / 1024)} KB</span>
                              </div>
                            )
                          })}
                      </div>
                    )
                  })}
              </div>
            )
          })}
        </div>
        <div className="flex h-[150px] shrink-0 flex-col border-t border-line bg-surface-2">
          <div className="flex h-8 shrink-0 items-center gap-2 px-3 text-2xs font-semibold tracking-wide text-fg-3 uppercase">
            {t('下载日志', 'Download log')}
            {busy && <LoaderCircle size={12} className="animate-spin text-accent" />}
          </div>
          <div ref={logRef} className="scroll-thin min-h-0 flex-1 overflow-auto px-3 pb-2 font-mono text-[11.5px] leading-[18px]">
            {log.length === 0 && <div className="text-fg-3">{t('勾选固件后点“开始下载”，文件保存在本地资源目录，烧录时直接使用。', 'Tick firmware and click Download; files are cached for flashing.')}</div>}
            {log.map((l, i) => (
              <div key={i} className={cx('flex gap-3', l.tone === 'ok' ? 'text-fg-2' : l.tone === 'dim' ? 'text-fg-3' : l.tone === 'err' ? 'text-err' : 'font-semibold text-fg')}>
                <span className="text-fg-3">{fmtTime(new Date(l.t), false)}</span>
                <span>
                  {l.text.endsWith('✓') ? (
                    <>
                      {l.text.slice(0, -1)}
                      <span className="text-ok">✓</span>
                    </>
                  ) : (
                    l.text
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* details */}
      <aside className="scroll-thin flex w-[380px] min-[1400px]:w-[420px] shrink-0 flex-col gap-4 overflow-auto border-l border-line bg-surface p-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-fg">{focus.file ? variantLabel(focus.file, t) : t('选择一个固件', 'Pick a firmware')}</h2>
            {fSpec && <span className="text-xs text-fg-3">{buildSummary(fSpec.features, t)}</span>}
            {fNum === RECOMMENDED_BUILD && EC718H_MODELS.includes(focus.model) && <Badge tone="primary">{t('推荐', 'Recommended')}</Badge>}
          </div>
          <div className="mt-1 font-mono text-[11.5px] break-all text-fg-2">{focus.file || '—'}</div>
          {fBuild?.zip && fwStatus[fKey] !== 'done' && (
            <div className="mt-1.5 text-2xs text-fg-3">
              {t(
                `这个固件放在 ${fBuild.zip} 里：下载时会整包下载，再把包里的 ${buildsOf(focus.model, focus.version)?.filter((b) => b.zip === fBuild.zip).length ?? 1} 个固件一起解出来。`,
                `It is inside ${fBuild.zip}; the whole archive is downloaded and all its firmware files are extracted.`,
              )}
            </div>
          )}
          {!canFlash(focus.model) && (
            <div className="mt-1.5 rounded-md border border-warn/30 bg-warn-soft px-2 py-1.5 text-2xs text-fg">
              {t(`${focus.model} 要经串口刷机，烧录器下一步再支持；现在可以先下载固件。`, `${focus.model} is flashed over a serial port (coming next); you can already download firmware.`)}
            </div>
          )}
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-lg border border-line p-3 text-xs">
          {[
            [t('型号', 'Model'), focus.model],
            [t('芯片', 'Chip'), fInfo?.chip ?? CHIP_OF[focus.model] ?? '—'],
            [t('版本', 'Version'), focus.version || '—'],
            [t('发布日期', 'Released'), fVer?.date ?? '—'],
            [t('位数', 'Arch'), (fInfo?.bits ?? fSpec?.bits) ? t(`${fInfo?.bits ?? fSpec?.bits} 位`, `${fInfo?.bits ?? fSpec?.bits}-bit`) : '—'],
            [t('大小', 'Size'), fBuild ? `${Math.round(fBuild.size / 1024)} KB` : '—'],
            [t('脚本区', 'Script area'), fInfo ? `${fInfo.scriptAddr} / ${fInfo.scriptKb}KB` : fSpec ? `${fSpec.scriptKB}KB` : '—'],
            [t('文件系统', 'File system'), fInfo ? `${fInfo.fsKb}KB` : fSpec ? `${fSpec.fsKB}KB` : '—'],
          ].map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-2xs text-fg-3">{k}</dt>
              <dd className="truncate font-mono text-fg">{v}</dd>
            </div>
          ))}
          <div className="col-span-2 min-w-0">
            <dt className="text-2xs text-fg-3">{t('状态', 'Status')}</dt>
            <dd className="mt-0.5">{statusCell(fwStatus[fKey])}</dd>
          </div>
          {fPath && (
            <div className="col-span-2 min-w-0">
              <dt className="text-2xs text-fg-3">{t('本地路径', 'Local path')}</dt>
              <dd className="font-mono text-[11px] break-all text-fg-2">
                <button type="button" className="text-left hover:text-accent" onClick={() => dialogs.reveal(fPath)}>
                  {tildify(fPath)}
                </button>
              </dd>
            </div>
          )}
        </dl>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="primary"
            icon={Zap}
            disabled={!project || !focus.version || !focus.file}
            onClick={() => {
              if (!project) return
              updateProject(project.id, { model: focus.model, core: { ...project.core, source: 'resource', version: focus.version, file: focus.file, build: fNum ?? 0 } })
              toast('success', t('已设为当前项目底层', 'Set as project CORE'), `${project.name} ← ${focus.version} · ${variantLabel(focus.file, t)}`)
            }}
          >
            {t('设为当前项目底层', 'Use for current project')}
          </Button>
          {fwStatus[fKey] !== 'done' && typeof fwStatus[fKey] !== 'object' && focus.version && focus.file && (
            <Button
              size="sm"
              icon={CloudDownload}
              onClick={async () => {
                addLog(t('开始下载 1 个固件…', 'Downloading 1 file…'), 'dim')
                const p = await downloadFw(focus.model, focus.version, focus.file)
                addLog(`${focus.file}  ${p ? '✓' : '✗'}`, p ? 'ok' : 'err')
              }}
            >
              {t('下载此固件', 'Download')}
            </Button>
          )}
          {fwStatus[fKey] === 'done' && (
            <Button
              size="sm"
              variant="danger"
              icon={Trash2}
              onClick={async () => {
                const ok = await confirm({ title: t('删除本地固件', 'Delete local firmware'), body: focus.file, okText: t('删除', 'Delete'), danger: true })
                if (!ok) return
                try {
                  await deleteFw(focus.model, focus.version, focus.file)
                  toast('success', t('已删除', 'Deleted'))
                } catch (e) {
                  toast('error', t('删除失败', 'Delete failed'), errText(e))
                }
              }}
            >
              {t('删除本地文件', 'Delete local file')}
            </Button>
          )}
        </div>

        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="text-sm font-semibold text-fg">{t('编号功能对照表', 'Build feature matrix')}</span>
            <span className="text-2xs text-fg-3">{EC718H_MODELS.includes(focus.model) ? `${focus.model} · ${wide ? t('64 位', '64-bit') : t('32 位', '32-bit')}` : focus.model}</span>
          </div>
          {EC718H_MODELS.includes(focus.model) ? (
            <>
              <div className="overflow-hidden rounded-lg border border-line">
                <table className="w-full border-collapse text-[11px]">
                  <thead>
                    <tr className="bg-surface-2">
                      <th className="px-1.5 py-1.5 text-left font-medium text-fg-3">{t('编号', '#')}</th>
                      {MATRIX_FEATURES.map((f) => (
                        <th key={f} className="px-0.5 py-1.5 text-center font-medium text-fg-3" title={t(f, FEATURE_EN[f] ?? f)}>
                          <span className="inline-block max-w-[34px] truncate align-bottom">{t(f, FEATURE_EN[f] ?? f)}</span>
                        </th>
                      ))}
                      <th className="px-1 py-1.5 text-right font-medium text-fg-3">{t('脚本', 'Script')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {matrixBuilds.map((b) => (
                      <tr
                        key={b.build}
                        onClick={() => {
                          // 对照表的一行对应当前版本里编号相同的那个固件
                          const hit = focus.version ? buildsOf(focus.model, focus.version)?.find((x) => x.build === b.build) : undefined
                          if (hit) setFocus({ ...focus, file: hit.file })
                        }}
                        className={cx('cursor-default border-t border-line', b.build === fNum ? 'bg-primary-soft' : 'hover:bg-hover')}
                      >
                        <td className={cx('px-1.5 py-0.5 font-mono', b.build === fNum ? 'font-semibold text-accent' : 'text-fg-2')}>{b.build}</td>
                        {MATRIX_FEATURES.map((f) => (
                          <td key={f} className="py-0.5 text-center">
                            {b.features.includes(f) ? <Check size={12} strokeWidth={2.6} className="mx-auto text-ok" /> : <span className="text-fg-3/50">·</span>}
                          </td>
                        ))}
                        <td className="px-1 py-0.5 text-right font-mono text-[10.5px] text-fg-2">{b.scriptKB}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 flex items-start gap-1.5 text-2xs text-fg-3">
                <CircleCheck size={11} className="mt-0.5 shrink-0 text-ok" />
                {t('来自合宙官方固件支持列表（2026-11）。点击行切换编号；32/64 位编号功能相同；脚本区单位 KB。', 'From the official firmware list (2026-11). Click a row to switch; 32/64-bit builds share features; script area in KB.')}
              </p>
            </>
          ) : (
            <p className="rounded-lg border border-dashed border-line px-3 py-4 text-xs text-fg-3">
              {t('这个型号没有离线的固件功能表。下载固件后，详情里会显示真实的脚本区和文件系统大小。', 'No offline feature table for this model. Download a firmware to see its real partitions.')}
            </p>
          )}
        </div>
      </aside>
    </div>
  )
}
