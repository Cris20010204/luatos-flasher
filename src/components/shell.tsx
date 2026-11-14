import {
  Cable,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  CircleX,
  CodeXml,
  Cpu,
  FolderKanban,
  FolderOpen,
  FolderPlus,
  ListChecks,
  LoaderCircle,
  Moon,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RadioTower,
  RefreshCw,
  ScrollText,
  Settings,
  Sun,
  TriangleAlert,
  Upload,
  Usb,
  X,
  Zap,
  Check,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useApp, STEP_LABEL, type Page } from '../store'
import { useLogDock } from '../devlog'
import { Badge, Button, Dot, MenuItem, Popover, Progress, Divider, Kbd } from './ui'
import { statusLabel, statusTone } from '../lib/device'
import { cx, fmtClock } from '../lib/format'
import { EC718H_MODELS, RECOMMENDED_BUILD, buildSpec, buildSummary, coreFile, pickSameVariant, variantLabel } from '../data/catalog'

/** 应用标志：与应用图标同一幅图（public/app-mark.svg，USB 插头 + 闪电 + LuatOS 字样） */
export function AppMark({ size = 18 }: { size?: number }) {
  return <img src="/app-mark.svg" alt="" draggable={false} className="shrink-0 select-none" style={{ width: size, height: size }} />
}

export function TitleBar() {
  const { platform, project, t } = useApp()
  const title = `${t('LuatOS 烧录器', 'LuatOS Flasher')}${project ? ` — ${project.name}` : ''}`
  // Windows 使用系统标题栏，这里不再重复绘制
  if (platform === 'win') return null
  return (
    <div data-tauri-drag-region className="relative flex h-[38px] shrink-0 items-center border-b border-line bg-titlebar px-3.5 select-none">
      <div data-tauri-drag-region className="pointer-events-none absolute left-1/2 flex -translate-x-1/2 items-center gap-2">
        <AppMark size={16} />
        <span className="text-[13px] font-semibold text-fg-2">{title}</span>
      </div>
    </div>
  )
}

const NAV: { id: Page; icon: LucideIcon; zh: string; en: string }[] = [
  { id: 'projects', icon: FolderKanban, zh: '项目', en: 'Projects' },
  { id: 'code', icon: CodeXml, zh: '代码', en: 'Code' },
  { id: 'flash', icon: Zap, zh: '快速烧录', en: 'Quick Flash' },
  { id: 'logs', icon: ScrollText, zh: '设备日志', en: 'Device Log' },
  { id: 'serial', icon: Cable, zh: '串口调试', en: 'Serial' },
  { id: 'mqtt', icon: RadioTower, zh: 'MQTT 调试', en: 'MQTT' },
  { id: 'firmware', icon: Package, zh: '固件资源', en: 'Firmware' },
]

export function Sidebar() {
  const { page, setPage, navCollapsed, setNavCollapsed, t, liveDiags, mqttStatus, device, logPortOpen, dark, setThemePref } = useApp()
  const errs = liveDiags.filter((d) => d.severity === 'error').length
  const item = (n: (typeof NAV)[number] | { id: Page; icon: LucideIcon; zh: string; en: string }) => {
    const active = page === n.id
    let indicator: React.ReactNode = null
    if (n.id === 'code' && errs > 0) indicator = <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-err px-1 text-[10px] font-semibold text-white">{errs}</span>
    if (n.id === 'mqtt' && mqttStatus === 'connected') indicator = <Dot tone="ok" />
    if (n.id === 'logs' && device.status === 'running' && logPortOpen) indicator = <Dot tone="ok" pulse />
    return (
      <button
        key={n.id}
        type="button"
        onClick={() => setPage(n.id)}
        title={navCollapsed ? t(n.zh, n.en) : undefined}
        className={cx(
          'relative flex h-9 w-full items-center gap-2.5 rounded-md text-sm transition-colors',
          navCollapsed ? 'justify-center px-0' : 'px-2.5',
          active ? 'bg-primary-soft font-medium text-fg' : 'text-fg-2 hover:bg-hover hover:text-fg',
        )}
      >
        {active && <span className="absolute top-2 bottom-2 left-0 w-[3px] rounded-r bg-primary" />}
        <n.icon size={17} strokeWidth={active ? 2.1 : 1.8} className={active ? 'text-accent' : ''} />
        {!navCollapsed && <span className="flex-1 truncate text-left">{t(n.zh, n.en)}</span>}
        {indicator && (navCollapsed ? <span className="absolute top-1.5 right-1.5">{indicator}</span> : indicator)}
      </button>
    )
  }
  return (
    <nav className={cx('flex shrink-0 flex-col border-r border-line bg-surface-2 py-2 transition-[width] duration-200', navCollapsed ? 'w-[52px] px-1.5' : 'w-[176px] px-2')}>
      <div className="flex flex-col gap-0.5">{NAV.map(item)}</div>
      <div className="mt-auto flex flex-col gap-0.5">
        {item({ id: 'settings', icon: Settings, zh: '设置', en: 'Settings' })}
        <Divider className="my-1.5" />
        <div className={cx('flex items-center', navCollapsed ? 'flex-col gap-0.5' : 'gap-0.5 px-0.5')}>
          <button
            type="button"
            onClick={() => setNavCollapsed(!navCollapsed)}
            className="flex size-8 items-center justify-center rounded-md text-fg-3 hover:bg-hover hover:text-fg"
            title={navCollapsed ? t('展开导航', 'Expand') : t('折叠导航', 'Collapse')}
          >
            {navCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
          <button
            type="button"
            onClick={() => setThemePref(dark ? 'light' : 'dark')}
            className="flex size-8 items-center justify-center rounded-md text-fg-3 hover:bg-hover hover:text-fg"
            title={t('切换主题', 'Toggle theme')}
          >
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </div>
    </nav>
  )
}

function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!active) return
    const iv = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(iv)
  }, [active])
  return now
}

export function TaskProgress({ wide }: { wide?: boolean }) {
  const { task, t, setTaskDialog } = useApp()
  const running = task?.status === 'running'
  const now = useNow(running)
  const elapsed = task ? (task.endedAt ?? now) - task.startedAt : 0
  const tone = task?.status === 'failed' ? 'err' : task?.status === 'success' ? 'ok' : 'primary'
  const step = task ? task.steps[task.stepIdx] : null
  const label = !task
    ? t('空闲', 'Idle')
    : task.status === 'running'
      ? t(STEP_LABEL[step!][0], STEP_LABEL[step!][1])
      : task.status === 'success'
        ? t('下载完成', 'Completed')
        : t('下载失败', 'Failed')
  return (
    <button
      type="button"
      onClick={() => task && setTaskDialog(true)}
      className={cx('group flex shrink-0 items-center gap-2.5 rounded-md px-2 py-1', task ? 'hover:bg-hover' : 'cursor-default')}
      title={task ? t('查看下载详情', 'Show download details') : undefined}
    >
      <div className={cx('flex flex-col gap-1', wide ? 'w-44' : 'w-[104px]')}>
        <div className="flex items-center gap-1 text-2xs leading-none">
          {running && <LoaderCircle size={11} className="animate-spin text-accent" />}
          {task?.status === 'success' && <CircleCheck size={11} className="text-ok" />}
          {task?.status === 'failed' && <CircleX size={11} className="text-err" />}
          <span className={cx('truncate', task ? 'text-fg-2' : 'text-fg-3')}>{label}</span>
          {task && <span className="ml-auto font-mono text-fg-3">{Math.round(task.progress)}%</span>}
        </div>
        <Progress value={task?.progress ?? 0} tone={tone} striped={running} height="h-1" />
      </div>
      <span className={cx('font-mono text-xs tabular-nums', task ? 'text-fg' : 'text-fg-3')}>{fmtClock(elapsed)}</span>
    </button>
  )
}

export function DownloadButtons({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const { t, runSyntaxCheck, checking, requestDownload, project, task } = useApp()
  const busy = task?.status === 'running'
  return (
    <>
      <Button size={size} icon={ListChecks} onClick={runSyntaxCheck} loading={checking} disabled={!project}>
        {t('语法检查', 'Syntax Check')}
      </Button>
      <Button size={size} icon={Upload} onClick={() => requestDownload('script')} disabled={!project || busy}>
        {t('下载脚本', 'Download Script')}
      </Button>
      <Button size={size} variant="primary" icon={Zap} onClick={() => requestDownload('full')} disabled={!project || busy}>
        {t('下载底层和脚本', 'Download CORE + Script')}
      </Button>
    </>
  )
}

export function DeviceSelector() {
  const { devices, device, setDeviceId, t, portOf, refreshDevices } = useApp()
  const label = (d: typeof device) =>
    d.status === 'offline' ? t('未连接', 'Not connected') : `${d.model || t('合宙模组', 'Module')} · ${portOf(d)}`
  return (
    <Popover
      width={400}
      className="w-[364px] min-w-[200px] shrink-[3]"
      trigger={(open, toggle) => (
        <button
          type="button"
          onClick={toggle}
          className={cx(
            'flex h-8 w-full items-center gap-2 rounded-md border bg-surface px-2.5 text-left transition-colors',
            open ? 'border-primary ring-2 ring-primary/15' : 'border-line-strong hover:border-fg-3/50',
          )}
        >
          <Usb size={15} className="shrink-0 text-fg-3" />
          <span className={cx('min-w-0 flex-1 truncate text-sm', device.status === 'offline' ? 'text-fg-3' : 'text-fg')}>
            {device.status === 'offline' ? (
              t('未连接设备', 'No device')
            ) : (
              <>
                <span className="font-medium">{device.model || t('合宙模组', 'Module')}</span>
                <span className="text-fg-3"> · </span>
                <span className="font-mono text-xs text-fg-2">{portOf(device)}</span>
              </>
            )}
          </span>
          <Badge tone={statusTone[device.status]} dot>
            {t(...statusLabel[device.status])}
          </Badge>
          <ChevronDown size={14} className="shrink-0 text-fg-3" />
        </button>
      )}
    >
      {(close) => (
        <>
          <div className="px-2 pt-1.5 pb-1 text-2xs font-semibold text-fg-3">{t('选择设备', 'Select device')}</div>
          {devices.map((d) => (
            <MenuItem
              key={d.id}
              active={d.id === device.id}
              onClick={() => {
                setDeviceId(d.id)
                close()
              }}
              right={
                <Badge tone={statusTone[d.status]} dot>
                  {t(...statusLabel[d.status])}
                </Badge>
              }
            >
              <span className="flex items-center gap-2">
                <Usb size={14} className={d.status === 'offline' ? 'text-fg-3' : 'text-fg-2'} />
                <span className={cx('truncate', d.status === 'offline' && 'text-fg-3')}>
                  {d.status === 'offline' ? (
                    label(d)
                  ) : (
                    <>
                      {d.model || t('合宙模组', 'Module')} <span className="text-fg-3">·</span> <span className="font-mono text-xs">{portOf(d)}</span>
                    </>
                  )}
                </span>
              </span>
              {d.imei && <span className="mt-0.5 block pl-[22px] font-mono text-2xs text-fg-3">IMEI {d.imei}</span>}
            </MenuItem>
          ))}
          <div className="my-1 h-px bg-line" />
          <MenuItem
            icon={RefreshCw}
            onClick={() => {
              refreshDevices()
              close()
            }}
          >
            {t('刷新设备列表', 'Refresh devices')}
          </MenuItem>
        </>
      )}
    </Popover>
  )
}

function ProjectSelector() {
  const { projects, project, setProjectId, t, setPage, setWizardOpen } = useApp()
  return (
    <Popover
      width={280}
      className="min-w-0 shrink-[0.3]"
      trigger={(open, toggle) => (
        <button
          type="button"
          onClick={toggle}
          className={cx(
            'flex h-8 w-full max-w-[220px] items-center gap-2 rounded-md px-2 text-sm transition-colors',
            open ? 'bg-surface-3' : 'hover:bg-hover',
          )}
          title={t('当前项目', 'Current project')}
        >
          <FolderOpen size={15} className="shrink-0 text-fg-3" />
          <span className={cx('truncate font-mono text-xs', project ? 'font-medium text-fg' : 'text-fg-3')}>{project?.name ?? t('未打开项目', 'No project')}</span>
          <ChevronDown size={13} className="shrink-0 text-fg-3" />
        </button>
      )}
    >
      {(close) => (
        <>
          <div className="px-2 pt-1.5 pb-1 text-2xs font-semibold text-fg-3">{t('切换项目', 'Switch project')}</div>
          {projects.map((p) => (
            <MenuItem
              key={p.id}
              active={p.id === project?.id}
              onClick={() => {
                setProjectId(p.id)
                close()
              }}
              right={<span className="text-2xs text-fg-3">{p.model}</span>}
              icon={p.id === project?.id ? Check : FolderKanban}
            >
              <span className="font-mono text-xs">{p.name}</span>
            </MenuItem>
          ))}
          <div className="my-1 h-px bg-line" />
          <MenuItem
            icon={Plus}
            onClick={() => {
              setWizardOpen(true)
              close()
            }}
          >
            {t('新建项目…', 'New project…')}
          </MenuItem>
          <MenuItem
            icon={FolderPlus}
            onClick={() => {
              setPage('projects')
              close()
            }}
          >
            {t('管理项目', 'Manage projects')}
          </MenuItem>
          {project && (
            <MenuItem
              icon={X}
              onClick={() => {
                setProjectId(null)
                close()
              }}
            >
              {t('关闭项目', 'Close project')}
            </MenuItem>
          )}
        </>
      )}
    </Popover>
  )
}

function CoreSelector() {
  const { project, coreLabel, t, updateProject, setPage, toast, versionsOf, loadVersions, buildsOf, loadBuilds, fwStatus } = useApp()
  const model = project?.model ?? ''
  const versions = model ? versionsOf(model) : null
  const version = project?.core.version || versions?.[0]?.version || ''
  const builds = model && version ? buildsOf(model, version) : null
  const [err, setErr] = useState('')
  const load = () => {
    if (!model) return
    setErr('')
    loadVersions(model)
      .then((vs) => {
        const v = project?.core.version || vs[0]?.version
        if (v) return loadBuilds(model, v)
      })
      .catch((e) => setErr(String(e)))
  }
  return (
    <Popover
      width={340}
      className="min-w-[120px] shrink"
      trigger={(open, toggle) => (
        <button
          type="button"
          disabled={!project}
          onClick={() => {
            if (!open) load()
            toggle()
          }}
          className={cx('flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm transition-colors disabled:opacity-50', open ? 'bg-surface-3' : 'hover:bg-hover')}
          title={t('当前底层 CORE', 'Current CORE')}
        >
          <Cpu size={15} className="shrink-0 text-fg-3" />
          <span className="min-w-0 max-w-[200px] truncate text-xs text-fg">{coreLabel(project)}</span>
          <ChevronDown size={13} className="shrink-0 text-fg-3" />
        </button>
      )}
    >
      {(close) =>
        project && (
          <div className="p-1.5">
            <div className="pb-1.5 text-2xs font-semibold text-fg-3">{t('版本', 'Version')}</div>
            {!versions && !err && (
              <div className="flex items-center gap-2 py-2 text-xs text-fg-3">
                <LoaderCircle size={13} className="animate-spin" />
                {t('正在读取合宙固件列表…', 'Loading firmware list…')}
              </div>
            )}
            {err && <div className="py-2 text-xs text-err">{err}</div>}
            {versions && (
              <div className="mb-3 grid grid-cols-3 gap-1">
                {versions.slice(0, 6).map((v) => (
                  <button
                    key={v.version}
                    type="button"
                    onClick={async () => {
                      // 换版本：在新版本里选同一种固件（同编号 / 同后缀），找不到用默认的
                      const bs = await loadBuilds(model, v.version).catch(() => null)
                      const pick = bs ? pickSameVariant(model, coreFile(model, project.core), bs) : undefined
                      updateProject(project.id, { core: { ...project.core, source: 'resource', version: v.version, file: pick?.file ?? '', build: pick?.build ?? 0 } })
                    }}
                    className={cx(
                      'rounded-md border px-2 py-1 text-left transition-colors',
                      project.core.source === 'resource' && project.core.version === v.version ? 'border-primary bg-primary-soft' : 'border-line hover:bg-hover',
                    )}
                  >
                    <div className="font-mono text-xs font-medium text-fg">{v.version}</div>
                    <div className="text-[10px] text-fg-3">{v.date}</div>
                  </button>
                ))}
              </div>
            )}
            <div className="pb-1.5 text-2xs font-semibold text-fg-3">{t('固件', 'Firmware')}</div>
            <div className="scroll-thin flex max-h-[300px] flex-col gap-0.5 overflow-auto">
              {builds?.map((b) => {
                const spec = buildSpec(model, b.build)
                const done = fwStatus[`${model}/${version}/${b.file}`] === 'done'
                return (
                  <MenuItem
                    key={b.file}
                    active={project.core.source === 'resource' && project.core.version === version && coreFile(model, project.core) === b.file}
                    onClick={() => {
                      updateProject(project.id, { core: { ...project.core, source: 'resource', version, file: b.file, build: b.build ?? 0 } })
                      toast('success', t('已切换底层', 'CORE switched'), `${version} · ${variantLabel(b.file, t)}`)
                      close()
                    }}
                    right={
                      b.build === RECOMMENDED_BUILD && EC718H_MODELS.includes(model) ? (
                        <Badge tone="primary">{t('推荐', 'Rec.')}</Badge>
                      ) : done ? (
                        <Badge tone="ok">{t('已下载', 'Local')}</Badge>
                      ) : spec ? (
                        <span className="text-2xs text-fg-3">{spec.bits}{t('位', '-bit')}</span>
                      ) : null
                    }
                  >
                    <span className="font-mono text-xs">{variantLabel(b.file, t)}</span>
                    <span className="ml-2 text-2xs text-fg-3">{spec ? buildSummary(spec.features, t) : `${(b.size / 1024 / 1024).toFixed(1)} MB`}</span>
                  </MenuItem>
                )
              })}
            </div>
            <div className="my-1.5 h-px bg-line" />
            <MenuItem
              icon={Package}
              onClick={() => {
                setPage('firmware')
                close()
              }}
            >
              {t('打开固件资源…', 'Open firmware resources…')}
            </MenuItem>
          </div>
        )
      }
    </Popover>
  )
}

export function Toolbar() {
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-surface px-3">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <DeviceSelector />
        <Divider vertical className="mx-1" />
        <ProjectSelector />
        <CoreSelector />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <TaskProgress />
        <Divider vertical className="mx-0.5" />
        <DownloadButtons />
      </div>
    </div>
  )
}

export function StatusBar() {
  const { t, device, logPortOpen, mqttStatus, project, scriptBytes, liveDiags, page, setPage, lang, setLang, platform, portOf, cliVersion, coreSpec } = useApp()
  const { dock, toggleDock } = useLogDock()
  const logOk = logPortOpen
  const used = scriptBytes(project) / 1024
  const cap = coreSpec(project).scriptKB || 1024
  const errs = liveDiags.filter((d) => d.severity === 'error').length
  const warns = liveDiags.length - errs
  const Item = ({ children, onClick, title }: { children: React.ReactNode; onClick?: () => void; title?: string }) => (
    <button type="button" onClick={onClick} title={title} className={cx('flex h-full items-center gap-1.5 px-2', onClick ? 'hover:bg-hover' : 'cursor-default')}>
      {children}
    </button>
  )
  return (
    <div className="flex h-6 shrink-0 items-center border-t border-line bg-surface-2 text-2xs text-fg-2 select-none">
      <Item title="luatos-cli">
        <Zap size={11} className="text-accent" />
        <span className="font-mono">{cliVersion || 'luatos-cli'}</span>
      </Item>
      <Item onClick={() => setPage('logs')}>
        <Dot tone={logOk ? 'ok' : device.status === 'boot' ? 'warn' : 'err'} className="scale-75" />
        {logOk ? t('日志口已连接', 'Log port connected') : device.status === 'boot' ? t('日志口 · 下载模式', 'Log port · download mode') : t('日志口未连接', 'Log port disconnected')}
        {logOk && device.status === 'running' && <span className="font-mono text-fg-3">{portOf(device)}</span>}
      </Item>
      {page !== 'logs' && (
        <Item onClick={toggleDock} title={dock.open ? t('收起设备日志面板', 'Hide device log panel') : t('在当前页显示设备日志', 'Show device log on this page')}>
          <ScrollText size={11} className={dock.open ? 'text-accent' : 'text-fg-3'} />
          {t('日志面板', 'Log panel')}
        </Item>
      )}
      <Item onClick={() => setPage('mqtt')}>
        <Dot tone={mqttStatus === 'connected' ? 'ok' : mqttStatus === 'connecting' ? 'warn' : 'neutral'} className="scale-75" />
        {mqttStatus === 'connected' ? t('MQTT 已连接', 'MQTT connected') : mqttStatus === 'connecting' ? t('MQTT 连接中…', 'MQTT connecting…') : t('MQTT 未连接', 'MQTT disconnected')}
      </Item>
      <div className="ml-auto flex h-full items-center">
        <Item onClick={() => setPage('code')} title={t('问题', 'Problems')}>
          <CircleAlert size={11} className={errs ? 'text-err' : 'text-fg-3'} />
          {errs}
          <TriangleAlert size={11} className={cx('ml-1', warns ? 'text-warn' : 'text-fg-3')} />
          {warns}
        </Item>
        <Item onClick={() => setPage('projects')} title={t('脚本区占用', 'Script area usage')}>
          <span>{t('脚本区占用', 'Script area')}</span>
          <span className="h-1 w-14 overflow-hidden rounded-full bg-surface-3">
            <span className={cx('block h-full rounded-full', used / cap > 0.9 ? 'bg-err' : 'bg-primary')} style={{ width: `${Math.min(100, (used / cap) * 100)}%` }} />
          </span>
          <span className="font-mono">
            {project ? (used < 10 ? used.toFixed(1) : Math.round(used)) : 0} / {cap} KB
          </span>
        </Item>
        <Item onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')} title={t('切换语言', 'Switch language')}>
          {lang === 'zh' ? '中文' : 'English'}
        </Item>
        <Item title={t('平台', 'Platform')}>
          <span>{platform === 'mac' ? 'macOS' : 'Windows'}</span>
          <Kbd>{platform === 'mac' ? '⌘' : 'Ctrl'}</Kbd>
        </Item>
      </div>
    </div>
  )
}
