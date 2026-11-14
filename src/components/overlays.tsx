import { useEffect, useRef, useState } from 'react'
import {
  Check,
  CircleCheck,
  CircleX,
  Info,
  LoaderCircle,
  RotateCcw,
  ScrollText,
  TriangleAlert,
  X,
  FileCode,
  Sparkles,
  RadioTower,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { useApp, STEP_LABEL, type TaskKind } from '../store'
import { Badge, Button, Input, Modal, Progress, Select } from './ui'
import { BootHint, BootIllustration } from './boot'
import { cx, fmtClock, fmtKB } from '../lib/format'
import { statusLabel, statusTone } from '../lib/device'
import { CHIP_OF, EC718H_MODELS, FAMILIES, FEATURE_EN, RECOMMENDED_BUILD, buildSpec, buildSummary, canFlash, defaultBuild, familyOf, fileBuild, variantLabel } from '../data/catalog'
import { ModelSelect } from './ModelSelect'
import { defaultOptions, templates } from '../data/types'
import { api, errText } from '../lib/api'

export function Toasts() {
  const { toasts, dismissToast } = useApp()
  const icon = { success: CircleCheck, error: CircleX, info: Info, warning: TriangleAlert }
  const color = { success: 'text-ok', error: 'text-err', info: 'text-accent', warning: 'text-warn' }
  return (
    <div className="pointer-events-none absolute top-[96px] left-1/2 z-[60] flex w-[360px] -translate-x-1/2 flex-col items-stretch gap-2">
      {toasts.map((ts) => {
        const I = icon[ts.kind]
        return (
          <div key={ts.id} className="anim-toast pointer-events-auto flex items-start gap-2.5 rounded-lg border border-line bg-surface px-3 py-2.5 shadow-[0_10px_30px_-8px_rgba(0,0,0,0.25)]">
            <I size={17} className={cx('mt-px shrink-0', color[ts.kind])} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-fg">{ts.title}</div>
              {ts.desc && <div className="mt-0.5 font-mono text-2xs break-all text-fg-3">{ts.desc}</div>}
              {ts.action && (
                <button
                  type="button"
                  className="mt-1 text-xs font-medium text-accent hover:underline"
                  onClick={() => {
                    ts.action!.run()
                    dismissToast(ts.id)
                  }}
                >
                  {ts.action.label}
                </button>
              )}
            </div>
            <button type="button" onClick={() => dismissToast(ts.id)} className="text-fg-3 hover:text-fg">
              <X size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}

export function ConfirmDialog() {
  const { confirmState, resolveConfirm, t } = useApp()
  if (!confirmState) return null
  return (
    <Modal
      open
      width={420}
      onClose={() => resolveConfirm(false)}
      title={confirmState.title}
      icon={<TriangleAlert size={18} className={confirmState.danger ? 'text-err' : 'text-warn'} />}
      footer={
        <>
          <Button onClick={() => resolveConfirm(false)}>{t('取消', 'Cancel')}</Button>
          <Button variant={confirmState.danger ? 'danger' : 'primary'} className={confirmState.danger ? '!bg-err !text-white !border-transparent' : ''} onClick={() => resolveConfirm(true)}>
            {confirmState.okText ?? t('确定', 'OK')}
          </Button>
        </>
      }
    >
      <div className="text-sm text-fg-2">{confirmState.body}</div>
    </Modal>
  )
}

const KIND_LABEL: Record<TaskKind, [string, string]> = {
  script: ['下载脚本', 'Download Script'],
  full: ['下载底层和脚本', 'Download CORE + Script'],
  flash: ['快速烧录', 'Quick Flash'],
  erase: ['清除数据', 'Erase data'],
}

export function DownloadConfirm() {
  const { pending, cancelPending, confirmPending, t, device, portOf, liveDiags, openFile, cachedPath, project, isDirty } = useApp()
  if (!pending) return null
  const errors = pending.kind !== 'flash' ? liveDiags.filter((d) => d.severity === 'error') : []
  const mismatch = device.status !== 'offline' && !!device.model && device.model !== pending.model
  const needFetch = pending.soc.source === 'resource' && !cachedPath(pending.soc.model, pending.soc.version, pending.soc.file)
  const dirty = pending.kind !== 'flash' && !!project?.files.some((f) => isDirty(f.name))
  const rows: [string, React.ReactNode][] = [
    [t('下载内容', 'Content'), <span className="font-medium text-fg">{t(...KIND_LABEL[pending.kind])}</span>],
    [
      t('目标设备', 'Device'),
      device.status === 'offline' ? (
        <span className="text-err">{t('未连接', 'Not connected')}</span>
      ) : (
        // 端口名很长（/dev/cu.usbmodem0000000000011），放不下时省略中间部分，状态标签始终完整显示
        <span className="flex min-w-0 items-center gap-2">
          <span className="shrink-0">{device.model || t('合宙模组', 'Module')}</span>
          <span className="min-w-0 truncate font-mono text-xs text-fg-3" title={portOf(device)}>
            {portOf(device).replace(/^\/dev\//, '')}
          </span>
          <Badge tone={statusTone[device.status]} dot className="ml-auto shrink-0">
            {t(...statusLabel[device.status])}
          </Badge>
        </span>
      ),
    ],
  ]
  if (pending.projectName && pending.kind !== 'flash') rows.push([t('项目', 'Project'), <span className="font-mono text-xs">{pending.projectName}</span>])
  rows.push([
      t('底层 CORE', 'CORE'),
      <span className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs break-all">{pending.firmware}</span>
        {needFetch && <Badge tone="warn">{t('将先从合宙服务器下载', 'Will be downloaded first')}</Badge>}
        {pending.kind === 'script' && <span className="text-2xs text-fg-3">{t('（仅用于读取脚本区地址）', '(used for the script partition layout)')}</span>}
      </span>,
    ])
  if (pending.scriptCount > 0) rows.push([t('脚本', 'Scripts'), t(`${pending.scriptCount} 个文件 · ${fmtKB(pending.scriptsBytes)}`, `${pending.scriptCount} files · ${fmtKB(pending.scriptsBytes)}`)])
  return (
    <Modal
      open
      onClose={cancelPending}
      width={500}
      title={t('确认下载', 'Confirm download')}
      icon={<TriangleAlert size={18} className="text-warn" />}
      footer={
        <>
          <Button onClick={cancelPending}>{t('取消', 'Cancel')}</Button>
          <Button variant="primary" onClick={confirmPending} autoFocus>
            {t('继续下载', 'Continue')}
          </Button>
        </>
      }
    >
      <p className="text-base font-medium text-fg">
        {pending.kind === 'erase'
          ? t('将擦除模组上保存的数据，不能恢复，是否继续？', 'Data on the module will be erased permanently. Continue?')
          : t('将覆盖模组上现有的程序，是否继续？', 'This will overwrite the program on the module. Continue?')}
      </p>
      <dl className="mt-3 divide-y divide-line rounded-lg border border-line">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center gap-3 px-3 py-2 text-sm">
            <dt className="w-20 shrink-0 text-xs text-fg-3">{k}</dt>
            <dd className="min-w-0 flex-1 text-fg-2">{v}</dd>
          </div>
        ))}
      </dl>
      {errors.length > 0 && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-err/30 bg-err-soft px-2.5 py-2 text-xs text-fg">
          <CircleX size={14} className="mt-0.5 shrink-0 text-err" />
          <span className="flex-1">
            {t(`脚本存在 ${errors.length} 个语法错误，下载后可能无法运行：`, `${errors.length} syntax error(s) — the script may not run:`)}
            <button
              type="button"
              className="ml-1 font-mono text-accent hover:underline"
              onClick={() => {
                cancelPending()
                openFile(errors[0].file, errors[0].line)
              }}
            >
              {errors[0].file}:{errors[0].line}
            </button>
          </span>
        </div>
      )}
      {dirty && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-line bg-surface-2 px-2.5 py-2 text-xs text-fg-2">
          <Info size={14} className="mt-0.5 shrink-0 text-accent" />
          {t('有未保存的修改，下载前会自动保存。', 'Unsaved changes will be saved before downloading.')}
        </div>
      )}
      {(pending.clearFs || pending.clearKv) && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-warn/30 bg-warn-soft px-2.5 py-2 text-xs text-fg">
          <TriangleAlert size={14} className="mt-0.5 shrink-0 text-warn" />
          {t(
            `下载前会清除${[pending.clearFs && '文件系统', pending.clearKv && 'KV 存储'].filter(Boolean).join('和')}，模组上保存的数据会丢失。`,
            `The ${[pending.clearFs && 'file system', pending.clearKv && 'KV store'].filter(Boolean).join(' and ')} will be erased first.`,
          )}
        </div>
      )}
      {mismatch && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-warn/30 bg-warn-soft px-2.5 py-2 text-xs text-fg">
          <TriangleAlert size={14} className="mt-0.5 shrink-0 text-warn" />
          {t(`设备型号 ${device.model} 与固件型号 ${pending.model} 不一致`, `Device ${device.model} does not match firmware model ${pending.model}`)}
        </div>
      )}
      <BootHint className="mt-3" />
    </Modal>
  )
}

export function TaskDialog() {
  const { task, t, setTaskDialog, cancelTask, retryTask, dismissTask, setPage } = useApp()
  const [now, setNow] = useState(Date.now())
  const logRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (task?.status !== 'running') return
    const iv = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(iv)
  }, [task?.status])
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [task?.logs.length])
  if (!task || !task.dialogOpen) return null
  const elapsed = (task.endedAt ?? now) - task.startedAt
  const running = task.status === 'running'
  const failed = task.status === 'failed'
  const ok = task.status === 'success'
  const logColor = { info: 'text-fg-2', ok: 'text-ok', warn: 'text-warn', err: 'text-err', dim: 'text-fg-3' }
  return (
    <Modal
      open
      width={680}
      onClose={() => setTaskDialog(false)}
      title={
        <span className="flex items-center gap-2">
          {t(...KIND_LABEL[task.req.kind])}
          <span className="font-mono text-xs font-normal text-fg-3">{task.req.model}</span>
        </span>
      }
      icon={
        running ? <LoaderCircle size={18} className="animate-spin text-accent" /> : ok ? <CircleCheck size={18} className="text-ok" /> : <CircleX size={18} className="text-err" />
      }
      footer={
        running ? (
          <>
            <span className="mr-auto text-xs text-fg-3">{t('关闭窗口后下载将在后台继续，进度显示在顶部工具栏', 'Closing keeps the download running; progress stays in the toolbar')}</span>
            <Button onClick={cancelTask}>{t('取消下载', 'Cancel')}</Button>
            <Button variant="subtle" onClick={() => setTaskDialog(false)}>
              {t('后台运行', 'Run in background')}
            </Button>
          </>
        ) : failed ? (
          <>
            <Button onClick={dismissTask}>{t('关闭', 'Close')}</Button>
            <Button variant="primary" icon={RotateCcw} onClick={retryTask}>
              {t('重试', 'Retry')}
            </Button>
          </>
        ) : (
          <>
            <Button
              icon={ScrollText}
              onClick={() => {
                dismissTask()
                setPage('logs')
              }}
            >
              {t('查看日志', 'View log')}
            </Button>
            <Button variant="primary" onClick={dismissTask}>
              {t('完成', 'Done')}
            </Button>
          </>
        )
      }
    >
      {/* step bar */}
      <ol className="mb-4 flex items-start">
        {task.steps.map((s, i) => {
          const done = i < task.stepIdx || ok
          const cur = i === task.stepIdx && !ok
          const bad = cur && failed
          return (
            <li key={s} className="relative flex flex-1 flex-col items-center gap-1.5">
              {i > 0 && <span className={cx('absolute top-[11px] right-1/2 left-[-50%] h-0.5', i <= task.stepIdx || ok ? 'bg-primary' : 'bg-line')} />}
              <span
                className={cx(
                  'relative z-10 flex size-6 items-center justify-center rounded-full border-2 text-2xs font-semibold transition-colors',
                  done && 'border-primary bg-primary text-white',
                  cur && !bad && 'border-primary bg-surface text-accent',
                  bad && 'border-err bg-err text-white',
                  !done && !cur && 'border-line-strong bg-surface text-fg-3',
                )}
              >
                {done ? <Check size={12} strokeWidth={3} /> : bad ? <X size={12} strokeWidth={3} /> : cur ? <LoaderCircle size={12} className="animate-spin" /> : i + 1}
              </span>
              <span className={cx('text-center text-2xs leading-tight', cur ? (bad ? 'font-medium text-err' : 'font-medium text-fg') : done ? 'text-fg-2' : 'text-fg-3')}>
                {t(...STEP_LABEL[s])}
              </span>
            </li>
          )
        })}
      </ol>
      <div className="mb-3 flex items-center gap-3">
        <Progress value={task.progress} tone={failed ? 'err' : ok ? 'ok' : 'primary'} striped={running} height="h-2" className="flex-1" />
        <span className="w-10 text-right font-mono text-xs text-fg-2">{Math.round(task.progress)}%</span>
        <span className="font-mono text-sm text-fg tabular-nums">{fmtClock(elapsed)}</span>
      </div>

      {ok && (
        <div className="mb-3 flex items-center gap-3 rounded-lg border border-ok/30 bg-ok-soft px-3 py-2.5">
          <CircleCheck size={20} className="text-ok" />
          <div>
            <div className="text-sm font-semibold text-fg">{t('下载完成', 'Download complete')}</div>
            <div className="text-xs text-fg-2">
              {t(`耗时 ${(elapsed / 1000).toFixed(1)} 秒，模组已重启并开始运行`, `Took ${(elapsed / 1000).toFixed(1)}s. The module rebooted and is running.`)}
            </div>
          </div>
        </div>
      )}
      {failed && task.error && (
        <div className="mb-3 flex flex-col gap-3">
          <div className="flex items-start gap-2.5 rounded-lg border border-err/30 bg-err-soft px-3 py-2.5">
            <CircleX size={18} className="mt-0.5 shrink-0 text-err" />
            <div>
              <div className="text-sm font-semibold text-fg">{t('下载失败', 'Download failed')}</div>
              <div className="text-xs leading-relaxed text-fg-2">{t(...task.error)}</div>
            </div>
          </div>
          <BootIllustration />
        </div>
      )}

      <div className="mb-1.5 text-2xs font-semibold text-fg-3">{t('实时输出', 'Output')}</div>
      <div ref={logRef} className="scroll-thin h-44 overflow-auto rounded-md border border-line bg-editor px-3 py-2 font-mono text-[11.5px] leading-[19px]">
        {task.logs.map((l, i) => (
          <div key={i} className={cx('whitespace-pre-wrap', logColor[l.level])}>
            {l.text}
          </div>
        ))}
        {running && <span className="anim-pulse inline-block h-3.5 w-1.5 translate-y-0.5 bg-fg-3" />}
      </div>
    </Modal>
  )
}

const WIZ_MODELS = [
  { model: 'Air780EHM', zh: '4G Cat.1 · 中国频段 · 8MB', en: '4G Cat.1 · China bands · 8MB' },
  { model: 'Air780EHN', zh: '4G Cat.1 · 北美频段 · 8MB', en: '4G Cat.1 · North America · 8MB' },
  { model: 'Air780EPM', zh: '4G Cat.1 · 4MB 精简版', en: '4G Cat.1 · 4MB lite' },
  { model: 'Air8000', zh: '4G + WiFi + GNSS', en: '4G + WiFi + GNSS' },
]

export function NewProjectWizard() {
  const { wizardOpen, setWizardOpen, t, addProject, toast, openFile, projects, loadVersions, versionsOf, loadBuilds, buildsOf, appInfo, tildify } = useApp()
  const [step, setStep] = useState(0)
  const [model, setModel] = useState('Air780EHM')
  const [version, setVersion] = useState('')
  const [file, setFile] = useState('')
  const [tpl, setTpl] = useState<'empty' | 'hello' | 'mqtt'>('hello')
  const [name, setName] = useState('my_project')
  const [busy, setBusy] = useState(false)
  const [netErr, setNetErr] = useState('')
  useEffect(() => {
    if (wizardOpen) {
      setStep(0)
      let n = projects.length + 1
      while (projects.some((p) => p.name === `project_${n}`)) n++
      setName(`project_${n}`)
    }
  }, [wizardOpen]) // eslint-disable-line react-hooks/exhaustive-deps
  const versions = versionsOf(model)
  const builds = version ? buildsOf(model, version) : null
  useEffect(() => {
    if (!wizardOpen || step !== 1) return
    setNetErr('')
    loadVersions(model)
      .then((vs) => {
        const v = vs.find((x) => x.version === version) ? version : (vs[0]?.version ?? '')
        setVersion(v)
        if (v) return loadBuilds(model, v)
      })
      .catch((e) => setNetErr(errText(e)))
  }, [wizardOpen, step, model]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (builds && builds.length && !builds.some((b) => b.file === file)) setFile(defaultBuild(model, builds)?.file ?? '')
  }, [builds]) // eslint-disable-line react-hooks/exhaustive-deps
  const close = () => setWizardOpen(false)
  const validName = /^[A-Za-z0-9_\-]{1,32}$/.test(name) && !projects.some((p) => p.name === name)
  const create = async () => {
    setBusy(true)
    try {
      const rec = await api.projectCreate({
        name,
        model,
        core: { source: 'resource', version, file, build: fileBuild(file) ?? 0, localPath: '' },
        files: templates[tpl](name),
        options: { ...defaultOptions },
      })
      addProject(rec)
      close()
      toast('success', t('项目已创建', 'Project created'), tildify(rec.dir))
      setTimeout(() => openFile('main.lua'), 50)
    } catch (e) {
      toast('error', t('创建项目失败', 'Failed to create project'), errText(e))
    } finally {
      setBusy(false)
    }
  }
  const steps = [t('选型号', 'Model'), t('选底层', 'CORE'), t('选模板', 'Template')]
  return (
    <Modal
      open={wizardOpen}
      onClose={close}
      width={660}
      title={t('新建项目', 'New Project')}
      footer={
        <>
          <span className="mr-auto font-mono text-2xs text-fg-3">
            {model} · {version || '—'} · {file ? variantLabel(file, t) : '—'}
          </span>
          {step > 0 && (
            <Button icon={ChevronLeft} onClick={() => setStep(step - 1)}>
              {t('上一步', 'Back')}
            </Button>
          )}
          {step < 2 ? (
            <Button variant="primary" iconRight={ChevronRight} onClick={() => setStep(step + 1)} disabled={step === 1 && (!version || !file)}>
              {t('下一步', 'Next')}
            </Button>
          ) : (
            <Button variant="primary" onClick={create} disabled={!validName || !version || !file} loading={busy}>
              {t('创建项目', 'Create')}
            </Button>
          )}
        </>
      }
    >
      <div className="mb-4 flex items-center gap-2">
        {steps.map((s, i) => (
          <div key={s} className="flex flex-1 items-center gap-2">
            <span className={cx('flex size-5 items-center justify-center rounded-full text-2xs font-semibold', i <= step ? 'bg-primary text-white' : 'bg-surface-3 text-fg-3')}>
              {i < step ? <Check size={11} strokeWidth={3} /> : i + 1}
            </span>
            <span className={cx('text-sm', i === step ? 'font-medium text-fg' : 'text-fg-3')}>{s}</span>
            {i < 2 && <span className={cx('h-px flex-1', i < step ? 'bg-primary' : 'bg-line')} />}
          </div>
        ))}
      </div>

      {step === 0 && (
        <div className="grid grid-cols-2 gap-2.5">
          {WIZ_MODELS.map((m) => (
            <button
              key={m.model}
              type="button"
              onClick={() => setModel(m.model)}
              className={cx('flex items-center gap-3 rounded-lg border p-3 text-left transition-colors', model === m.model ? 'border-primary bg-primary-soft ring-1 ring-primary' : 'border-line hover:border-line-strong hover:bg-hover')}
            >
              <ChipGlyph active={model === m.model} />
              <div className="min-w-0">
                <div className="text-sm font-semibold text-fg">{m.model}</div>
                <div className="text-2xs text-fg-3">
                  {CHIP_OF[m.model]} · {t(m.zh, m.en)}
                </div>
              </div>
            </button>
          ))}
          <div className="col-span-2 mt-1 flex items-center gap-3 border-t border-line pt-3">
            <span className="text-xs text-fg-2">{t('其他型号', 'Other models')}</span>
            <ModelSelect value={model} onChange={setModel} className="w-56" />
            <span className="text-2xs text-fg-3">
              {CHIP_OF[model] ?? ''}
              {familyOf(model) ? ` · ${t(FAMILIES[familyOf(model)!].zh, FAMILIES[familyOf(model)!].en)}` : ''}
            </span>
          </div>
          {!canFlash(model) && (
            <div className="col-span-2 rounded-md border border-warn/30 bg-warn-soft px-2.5 py-2 text-xs text-fg">
              {t('这类芯片要经串口刷机，烧录器下一步再支持。现在可以先建项目、写代码、下载固件。', 'This chip family is flashed over a serial port, which comes in the next step. You can still create the project, write code and download firmware.')}
            </div>
          )}
        </div>
      )}

      {step === 1 && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <span className="w-16 text-xs text-fg-2">{t('版本', 'Version')}</span>
            <Select
              value={version}
              onChange={(e) => {
                setVersion(e.target.value)
                loadBuilds(model, e.target.value).catch((er) => setNetErr(errText(er)))
              }}
              className="w-64"
              disabled={!versions}
            >
              {!versions && <option>{t('读取中…', 'Loading…')}</option>}
              {versions?.map((v) => (
                <option key={v.version} value={v.version}>
                  {v.version} · {t('发布于', 'released')} {v.date}
                </option>
              ))}
            </Select>
            {!versions && !netErr && <LoaderCircle size={14} className="animate-spin text-fg-3" />}
          </div>
          {netErr && <div className="rounded-md border border-err/30 bg-err-soft px-2.5 py-2 text-xs text-fg">{t('无法读取合宙固件列表：', 'Cannot load firmware list: ')}{netErr}</div>}
          {!EC718H_MODELS.includes(model) && builds && (
            <div className="text-2xs text-fg-3">{t('这个型号的固件功能说明（脚本区大小等）要下载固件后才能看到。', 'Details (script area etc.) for this model are shown after download.')}</div>
          )}
          <div className="scroll-thin grid max-h-[300px] grid-cols-2 gap-2 overflow-auto pr-1">
            {builds?.map((b) => {
              const spec = buildSpec(model, b.build)
              return (
                <button
                  key={b.file}
                  type="button"
                  onClick={() => setFile(b.file)}
                  title={b.file}
                  className={cx('relative rounded-lg border p-2.5 text-left transition-colors', file === b.file ? 'border-primary bg-primary-soft ring-1 ring-primary' : 'border-line hover:bg-hover')}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-fg">{variantLabel(b.file, t)}</span>
                    <span className="truncate text-2xs text-fg-3">{spec ? buildSummary(spec.features, t) : `${(b.size / 1024 / 1024).toFixed(1)} MB`}</span>
                    {b.build === RECOMMENDED_BUILD && EC718H_MODELS.includes(model) && <Badge tone="primary" className="ml-auto">{t('推荐', 'Recommended')}</Badge>}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {spec && <span className="rounded bg-surface-3 px-1 text-[10px] text-fg-2">{spec.bits}{t('位', '-bit')}</span>}
                    {b.zip && <span className="rounded bg-surface-3 px-1 text-[10px] text-fg-2" title={b.zip}>{t('在压缩包里', 'In zip')}</span>}
                    {spec && <span className="rounded bg-surface-3 px-1 text-[10px] text-fg-2">{t('脚本区', 'Script')} {spec.scriptKB}KB</span>}
                    {spec?.features.slice(0, 4).map((f) => (
                      <span key={f} className="rounded bg-surface-3 px-1 text-[10px] text-fg-2">
                        {t(f, FEATURE_EN[f] ?? f)}
                      </span>
                    ))}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-2.5">
            {(
              [
                ['empty', FileCode, t('空项目', 'Empty'), t('仅包含 main.lua 骨架', 'Bare main.lua')],
                ['hello', Sparkles, 'Hello World', t('每 3 秒打印一条日志', 'Logs every 3 seconds')],
                ['mqtt', RadioTower, 'MQTT', t('连接服务器并收发消息', 'Connect & pub/sub')],
              ] as const
            ).map(([id, I, title, desc]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTpl(id)}
                className={cx('flex flex-col gap-2 rounded-lg border p-3 text-left transition-colors', tpl === id ? 'border-primary bg-primary-soft ring-1 ring-primary' : 'border-line hover:bg-hover')}
              >
                <I size={18} className={tpl === id ? 'text-accent' : 'text-fg-3'} />
                <div>
                  <div className="text-sm font-semibold text-fg">{title}</div>
                  <div className="text-2xs text-fg-3">{desc}</div>
                </div>
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-fg-2">{t('项目名称', 'Project name')}</span>
            <Input mono value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            <span className={cx('text-2xs', validName ? 'text-fg-3' : 'text-err')}>
              {validName ? `${tildify(appInfo?.projectsRoot ?? '~/LuatOS')}/${name}` : t('仅支持字母、数字、下划线和短横线，且不能与已有项目重名', 'Letters, digits, _ and - only; must be unique')}
            </span>
          </div>
        </div>
      )}
    </Modal>
  )
}

export function ChipGlyph({ active, disabled, size = 36 }: { active?: boolean; disabled?: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" className="shrink-0" aria-hidden>
      <rect x="1" y="1" width="34" height="34" rx="7" fill={active ? 'var(--primary)' : 'var(--surface-3)'} opacity={disabled ? 0.6 : 1} />
      <rect x="9" y="9" width="18" height="18" rx="2.5" fill="none" stroke={active ? '#fff' : 'var(--fg-3)'} strokeWidth="1.6" />
      <rect x="13" y="13" width="10" height="10" rx="1.5" fill={active ? '#fff' : 'var(--fg-3)'} opacity={active ? 0.9 : 0.5} />
      {[13, 18, 23].map((p) => (
        <g key={p} stroke={active ? '#fff' : 'var(--fg-3)'} strokeWidth="1.6" strokeLinecap="round">
          <path d={`M${p} 5.5V9`} />
          <path d={`M${p} 27v3.5`} />
          <path d={`M5.5 ${p}H9`} />
          <path d={`M27 ${p}h3.5`} />
        </g>
      ))}
    </svg>
  )
}
