import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleX,
  Copy,
  Download,
  ExternalLink,
  FileArchive,
  FileCode,
  FileImage,
  FilePlus,
  FolderInput,
  FolderKanban,
  FolderOpen,
  FolderPlus,
  FolderSearch,
  Info,
  ListChecks,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Trash2,
  TriangleAlert,
  Upload,
  X,
  Factory,
} from 'lucide-react'
import { useApp } from '../store'
import { Badge, Button, Checkbox, ContextMenu, EmptyState, Field, IconButton, Input, MenuItem, MenuSeparator, Modal, Panel, Segmented, Select } from '../components/ui'
import { BootHint } from '../components/boot'
import { ModelSelect } from '../components/ModelSelect'
import { DownloadButtons, TaskProgress } from '../components/shell'
import { EC718H_MODELS, RECOMMENDED_BUILD, buildSpec, buildSummary, coreFile, pickSameVariant, variantLabel } from '../data/catalog'
import { defaultOptions, type Project, type ProjectFile } from '../data/types'
import { api, dialogs, errText } from '../lib/api'
import { cx, fmtKB, fmtRelative, fmtTime } from '../lib/format'

export default function ProjectsPage() {
  const { project, t, setWizardOpen } = useApp()
  return (
    <div className="flex h-full">
      <ProjectList />
      <div className="flex min-w-0 flex-1 flex-col">
        {project ? (
          <>
            <div className="scroll-thin min-h-0 flex-1 overflow-auto p-4">
              <div className="grid grid-cols-[minmax(0,1fr)_296px] gap-4 max-[1400px]:grid-cols-[minmax(0,1fr)_256px]">
                <div className="flex min-w-0 flex-col gap-4">
                  <ProjectInfo p={project} />
                  <ScriptTable p={project} />
                  <MassProduction p={project} />
                </div>
                <div className="flex flex-col gap-4">
                  <DownloadOptionsPanel p={project} />
                </div>
              </div>
            </div>
            <BottomActions />
          </>
        ) : (
          <EmptyState
            icon={FolderKanban}
            title={t('未打开项目', 'No project open')}
            desc={t('从左侧列表选择一个项目，或创建 / 导入 LuaTools 项目（.ini）与 .luatos 项目包。', 'Pick a project on the left, or create / import a LuaTools project (.ini) or .luatos package.')}
          >
            <Button variant="primary" icon={Plus} onClick={() => setWizardOpen(true)}>
              {t('创建项目', 'Create project')}
            </Button>
          </EmptyState>
        )}
      </div>
    </div>
  )
}

function ProjectList() {
  const { projects, project, setProjectId, t, lang, toast, confirm, removeProject, addProject, updateProject, setWizardOpen, reloadProjects, tildify, platform } = useApp()
  const [q, setQ] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameVal, setRenameVal] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const list = projects.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()))
  // 右键菜单：针对右击的那个项目（不一定是当前打开的）
  const [menu, setMenu] = useState<{ x: number; y: number; p: Project } | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])
  const revealLabel = platform === 'win' ? t('在资源管理器中显示', 'Show in Explorer') : t('在访达中显示', 'Reveal in Finder')

  const removeOne = async (p: Project) => {
    const ok = await confirm({
      title: t('删除项目', 'Delete project'),
      body: t(`确定从列表中删除「${p.name}」？项目目录中的文件不会被删除。`, `Remove "${p.name}" from the list? Files on disk are kept.`),
      okText: t('删除', 'Delete'),
      danger: true,
    })
    if (!ok) return
    try {
      await removeProject(p.id)
      toast('success', t('项目已删除', 'Project removed'), p.name)
    } catch (e) {
      toast('error', t('删除失败', 'Delete failed'), errText(e))
    }
  }
  const startRename = (p: Project) => {
    setRenaming(p.id)
    setRenameVal(p.name)
  }
  const reveal = async (p: Project) => {
    try {
      await dialogs.reveal(p.dir)
    } catch (e) {
      toast('error', t('找不到项目文件夹，可能已被移动或删除', 'Project folder not found — it may have been moved or deleted'), `${tildify(p.dir)}\n${errText(e)}`)
    }
  }
  const copyPath = async (p: Project) => {
    try {
      await navigator.clipboard.writeText(p.dir)
      toast('success', t('已复制路径', 'Path copied'), tildify(p.dir))
    } catch (e) {
      toast('error', t('复制失败', 'Copy failed'), errText(e))
    }
  }

  const commitRename = () => {
    if (renaming && projects.some((p) => p.id !== renaming && p.name === renameVal)) toast('error', t('名称重复', 'Duplicate name'), renameVal)
    else if (renaming && /^[A-Za-z0-9_\-]{1,32}$/.test(renameVal)) {
      updateProject(renaming, { name: renameVal })
      toast('success', t('已重命名', 'Renamed'), renameVal)
    } else if (renaming) toast('error', t('名称无效', 'Invalid name'), t('仅支持字母、数字、下划线和短横线', 'Letters, digits, _ and - only'))
    setRenaming(null)
  }
  const actions: [string, string, React.ComponentType<{ size?: number }>, () => void, boolean?][] = [
    ['创建', 'New', Plus, () => setWizardOpen(true)],
    [
      '删除',
      'Delete',
      Trash2,
      () => project && removeOne(project),
      !project,
    ],
    ['重命名', 'Rename', Pencil, () => project && startRename(project), !project],
    ['导入', 'Import', FolderInput, () => setImportOpen(true)],
    [
      '导出',
      'Export',
      Upload,
      async () => {
        if (!project) return
        const dest = await dialogs.saveFile(t('导出项目包', 'Export project'), `${project.name}.luatos`, ['luatos'])
        if (!dest) return
        try {
          const out = await api.projectExport(project.id, dest, project.core.source === 'local')
          toast('success', t('项目已导出', 'Project exported'), tildify(out), { label: t('在访达中显示', 'Reveal'), run: () => dialogs.reveal(out) })
        } catch (e) {
          toast('error', t('导出失败', 'Export failed'), errText(e))
        }
      },
      !project,
    ],
    [
      '克隆',
      'Clone',
      Copy,
      async () => {
        if (!project) return
        let name = `${project.name}_copy`
        let i = 2
        while (projects.some((p) => p.name === name)) name = `${project.name}_copy${i++}`
        try {
          const rec = await api.projectClone(project.id, name)
          addProject(rec)
          toast('success', t('已克隆项目', 'Project cloned'), tildify(rec.dir))
        } catch (e) {
          toast('error', t('克隆失败', 'Clone failed'), errText(e))
        }
      },
      !project,
    ],
  ]

  return (
    <aside className="flex w-[252px] shrink-0 flex-col border-r border-line bg-surface-2">
      <div className="flex flex-col gap-2 p-3 pb-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-fg">{t('项目管理', 'Projects')}</h2>
          <span className="text-2xs text-fg-3">{projects.length}</span>
        </div>
        <div className="flex gap-1.5">
          <Input size="sm" icon={Search} placeholder={t('按名称过滤', 'Filter by name')} value={q} onChange={(e) => setQ(e.target.value)} className="flex-1" />
          <IconButton
            icon={RefreshCw}
            label={t('刷新', 'Refresh')}
            onClick={() =>
              reloadProjects()
                .then(() => toast('info', t('已刷新项目列表', 'Project list refreshed')))
                .catch((e) => toast('error', t('刷新失败', 'Refresh failed'), errText(e)))
            }
          />
        </div>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-auto px-2">
        {list.length === 0 && <div className="px-2 py-6 text-center text-xs text-fg-3">{t('没有匹配的项目', 'No matching projects')}</div>}
        {list.map((p) => {
          const active = p.id === project?.id
          return (
            <div
              key={p.id}
              role="button"
              tabIndex={0}
              onClick={() => !active && setProjectId(p.id)}
              onDoubleClick={() => startRename(p)}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({ x: e.clientX, y: e.clientY, p })
              }}
              className={cx(
                'relative mb-0.5 flex flex-col gap-1 rounded-md px-2.5 py-2 transition-colors',
                active ? 'bg-surface shadow-[0_0_0_1px_var(--line)]' : 'hover:bg-hover',
              )}
            >
              {active && <span className="absolute top-2 bottom-2 left-0 w-[3px] rounded-r bg-primary" />}
              {renaming === p.id ? (
                <input
                  autoFocus
                  value={renameVal}
                  onChange={(e) => setRenameVal(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename()
                    if (e.key === 'Escape') setRenaming(null)
                  }}
                  className="h-6 rounded border border-primary bg-surface px-1.5 font-mono text-xs text-fg outline-none"
                />
              ) : (
                <span className={cx('truncate font-mono text-[12.5px]', active ? 'font-semibold text-fg' : 'text-fg')}>{p.name}</span>
              )}
              <span className="flex items-center gap-1.5 text-2xs text-fg-3">
                <span className="rounded bg-surface-3 px-1 text-fg-2">{p.model}</span>
                <span className="truncate">
                  {t('最近下载', 'Last')} {fmtRelative(p.lastDownload, lang)}
                </span>
              </span>
            </div>
          )
        })}
      </div>
      <div className="grid grid-cols-3 gap-1 border-t border-line p-2">
        {actions.map(([zh, en, I, run, disabled]) => (
          <button
            key={zh}
            type="button"
            onClick={run}
            disabled={disabled}
            className="flex h-12 flex-col items-center justify-center gap-1 rounded-md text-2xs text-fg-2 transition-colors hover:bg-hover hover:text-fg disabled:opacity-40"
          >
            <I size={15} />
            {t(zh, en)}
          </button>
        ))}
      </div>
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} />
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} onClose={closeMenu}>
          <div className="truncate px-2 pt-1 pb-1.5 font-mono text-2xs text-fg-3" title={menu.p.dir}>
            {tildify(menu.p.dir)}
          </div>
          {menu.p.id !== project?.id && (
            <MenuItem
              icon={FolderKanban}
              onClick={() => {
                setProjectId(menu.p.id)
                closeMenu()
              }}
            >
              {t('打开项目', 'Open project')}
            </MenuItem>
          )}
          <MenuItem
            icon={FolderSearch}
            onClick={() => {
              reveal(menu.p)
              closeMenu()
            }}
          >
            {revealLabel}
          </MenuItem>
          <MenuItem
            icon={Copy}
            onClick={() => {
              copyPath(menu.p)
              closeMenu()
            }}
          >
            {t('复制文件夹路径', 'Copy folder path')}
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            icon={Pencil}
            onClick={() => {
              startRename(menu.p)
              closeMenu()
            }}
          >
            {t('重命名', 'Rename')}
          </MenuItem>
          <MenuItem
            icon={Trash2}
            danger
            onClick={() => {
              removeOne(menu.p)
              closeMenu()
            }}
          >
            {t('从列表中删除', 'Remove from list')}
          </MenuItem>
        </ContextMenu>
      )}
    </aside>
  )
}

function ImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, addProject, toast, tildify } = useApp()
  const [kind, setKind] = useState<'ini' | 'luatos' | 'dir'>('ini')
  const [path, setPath] = useState('')
  const [model, setModel] = useState('Air780EHM')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) setPath('')
  }, [open, kind])
  const browse = async () => {
    const r =
      kind === 'ini'
        ? await dialogs.pickFile(t('选择 LuaTools 项目文件', 'Choose a LuaTools project'), ['ini'], 'LuaTools')
        : kind === 'luatos'
          ? await dialogs.pickFile(t('选择项目包', 'Choose a project package'), ['luatos', 'zip'], '.luatos')
          : await dialogs.pickDir(t('选择脚本所在文件夹', 'Choose the scripts folder'))
    if (r) setPath(r)
  }
  const doImport = async () => {
    if (!path) return
    setBusy(true)
    try {
      const rec =
        kind === 'ini'
          ? await api.projectImportIni(path, { ...defaultOptions })
          : kind === 'luatos'
            ? await api.projectImportPkg(path)
            : await api.projectOpenDir(path, model, { source: 'resource', version: '', build: 0, file: '', localPath: '' }, { ...defaultOptions })
      addProject(rec)
      toast('success', t('导入成功', 'Imported'), `${rec.name} · ${rec.files.length} ${t('个文件', 'files')}`)
      onClose()
    } catch (e) {
      toast('error', t('导入失败', 'Import failed'), errText(e))
    } finally {
      setBusy(false)
    }
  }
  const hint = {
    ini: t('读取 LuaTools 的 project/*.ini：保留脚本列表和底层固件路径。', 'Reads LuaTools project/*.ini: scripts and CORE path are kept.'),
    luatos: t('.luatos 是本工具导出的单文件项目包，会解压到 ~/LuatOS/ 下。', '.luatos is a package exported by this tool; it is extracted to ~/LuatOS/.'),
    dir: t('把已有的脚本文件夹直接作为项目打开，文件保留在原处。', 'Open an existing scripts folder as a project; files stay where they are.'),
  }[kind]
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('导入项目', 'Import project')}
      width={540}
      footer={
        <>
          <Button onClick={onClose}>{t('取消', 'Cancel')}</Button>
          <Button variant="primary" onClick={doImport} disabled={!path} loading={busy}>
            {t('导入', 'Import')}
          </Button>
        </>
      }
    >
      <Segmented
        full
        value={kind}
        onChange={setKind}
        options={[
          { value: 'ini', label: t('LuaTools 项目 (.ini)', 'LuaTools (.ini)') },
          { value: 'luatos', label: t('项目包 (.luatos)', 'Package (.luatos)') },
          { value: 'dir', label: t('打开文件夹', 'Open folder') },
        ]}
      />
      <p className="mt-3 mb-2 text-xs text-fg-3">{hint}</p>
      <div className="flex gap-1.5">
        <Input mono readOnly value={path ? tildify(path) : ''} placeholder={t('点击右侧按钮选择…', 'Click Browse…')} className="flex-1" />
        <Button icon={kind === 'dir' ? FolderOpen : kind === 'ini' ? FileCode : FileArchive} onClick={browse}>
          {t('浏览…', 'Browse…')}
        </Button>
      </div>
      {kind === 'dir' && (
        <div className="mt-3 flex items-center gap-3">
          <span className="text-xs text-fg-2">{t('模组型号', 'Module')}</span>
          <ModelSelect value={model} onChange={setModel} className="w-56" />
        </div>
      )}
    </Modal>
  )
}

function InfoTile({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-md bg-surface-2 px-3 py-2 ring-1 ring-line">
      <div className="text-2xs text-fg-3">{label}</div>
      <div className="mt-0.5 truncate font-mono text-[13px] font-medium text-fg">{value}</div>
      {sub && <div className="truncate text-2xs text-fg-3">{sub}</div>}
    </div>
  )
}

function ProjectInfo({ p }: { p: Project }) {
  const { t, updateProject, fwStatus, setPage, toast, coreSpec, versionsOf, loadVersions, buildsOf, loadBuilds, downloadFw, tildify } = useApp()
  const core = p.core
  const spec = coreSpec(p)
  const versions = versionsOf(p.model)
  const builds = core.version ? buildsOf(p.model, core.version) : null
  const curFile = coreFile(p.model, core)
  const [netErr, setNetErr] = useState('')
  const [fetching, setFetching] = useState(false)
  useEffect(() => {
    if (core.source !== 'resource') return
    setNetErr('')
    loadVersions(p.model)
      .then(async (vs) => {
        const v = core.version || vs[0]?.version
        if (!v) return
        const bs = await loadBuilds(p.model, v)
        // 换了版本 / 型号后，原来选的固件文件不在新列表里：优先选同一种（同编号或同后缀，如 TTS），否则用默认的
        if (core.version === v && bs.some((b) => b.file === curFile)) return
        const pick = pickSameVariant(p.model, curFile, bs)
        updateProject(p.id, { core: { ...core, version: v, file: pick?.file ?? '', build: pick?.build ?? 0 } })
      })
      .catch((e) => setNetErr(errText(e)))
  }, [p.model, core.source, core.version]) // eslint-disable-line react-hooks/exhaustive-deps
  const fwKey = `${p.model}/${core.version}/${curFile}`
  const st = fwStatus[fwKey]
  const downloaded = st === 'done'
  const browse = async () => {
    const r = await dialogs.pickFile(t('选择底层固件', 'Choose CORE firmware'), ['soc', 'binpkg'], 'LuatOS')
    if (r) {
      updateProject(p.id, { core: { ...core, source: 'local', localPath: r } })
      toast('success', t('已选择本地底层', 'Local CORE selected'), tildify(r))
    }
  }
  return (
    <Panel
      title={t('项目信息', 'Project')}
      icon={Info}
      actions={
        <button type="button" onClick={() => dialogs.openPath(p.dir)} className="flex items-center gap-1 font-mono text-2xs text-fg-3 hover:text-accent" title={t('在访达中打开', 'Open folder')}>
          {tildify(p.dir)}
          <ExternalLink size={11} />
        </button>
      }
    >
      <div className="grid grid-cols-3 gap-3">
        <Field label={t('项目名', 'Name')}>
          <Input mono value={p.name} onChange={(e) => updateProject(p.id, { name: e.target.value.replace(/[^\w\-]/g, '') })} />
        </Field>
        <Field label={t('版本号', 'Version')}>
          <Input mono value={p.version} onChange={(e) => updateProject(p.id, { version: e.target.value })} />
        </Field>
        <Field label={t('模组型号', 'Module')}>
          <ModelSelect value={p.model} onChange={(m) => updateProject(p.id, { model: m, core: core.source === 'resource' ? { ...core, version: '', file: '', build: 0 } : core })} />
        </Field>
      </div>
      <div className="mt-3 flex flex-col gap-1.5">
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium text-fg-2">{t('底层 CORE', 'CORE firmware')}</span>
          <Segmented
            size="sm"
            value={core.source}
            onChange={(v) => updateProject(p.id, { core: { ...core, source: v } })}
            options={[
              { value: 'resource', label: t('从固件资源选择', 'From resources') },
              { value: 'local', label: t('选择本地文件', 'Local file') },
            ]}
          />
        </div>
        {core.source === 'resource' ? (
          <div className="flex items-center gap-2">
            <Select
              value={core.version}
              onChange={(e) => updateProject(p.id, { core: { ...core, version: e.target.value } })}
              className="w-[200px]"
              disabled={!versions}
            >
              {!versions && <option value={core.version}>{netErr ? t('无法读取版本', 'Unavailable') : t('读取中…', 'Loading…')}</option>}
              {versions?.map((v) => (
                <option key={v.version} value={v.version}>
                  {v.version} · {v.date}
                </option>
              ))}
            </Select>
            <Select
              value={curFile}
              onChange={(e) => {
                const x = builds?.find((b) => b.file === e.target.value)
                if (x) updateProject(p.id, { core: { ...core, file: x.file, build: x.build ?? 0 } })
              }}
              className="w-[240px]"
              disabled={!builds}
            >
              {!builds && <option value={curFile}>{curFile ? variantLabel(curFile, t) : t('读取中…', 'Loading…')}</option>}
              {builds?.map((x) => {
                const sp = buildSpec(p.model, x.build)
                return (
                  <option key={x.file} value={x.file}>
                    {variantLabel(x.file, t)} · {sp ? buildSummary(sp.features, t) : `${(x.size / 1048576).toFixed(1)} MB`}
                    {x.build === RECOMMENDED_BUILD && EC718H_MODELS.includes(p.model) ? t('（推荐）', ' (rec.)') : ''}
                  </option>
                )
              })}
            </Select>
            <span className="ml-1 min-w-0 truncate font-mono text-2xs text-fg-3" title={curFile}>
              {core.version ? curFile : ''}
            </span>
            {downloaded ? (
              <Badge tone="ok" dot className="ml-auto">
                {t('已下载', 'Downloaded')}
              </Badge>
            ) : typeof st === 'object' ? (
              <Badge tone="primary" className="ml-auto">
                {t('下载中', 'Downloading')} {Math.round(st.progress)}%
              </Badge>
            ) : (
              <Button
                size="xs"
                variant="ghost"
                icon={Download}
                className="ml-auto"
                loading={fetching}
                disabled={!core.version || !curFile}
                onClick={async () => {
                  setFetching(true)
                  const r = await downloadFw(p.model, core.version, curFile)
                  setFetching(false)
                  if (r) toast('success', t('固件已下载', 'Firmware downloaded'), curFile)
                }}
              >
                {t('未下载 · 立即下载', 'Download now')}
              </Button>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Input mono value={core.localPath ? tildify(core.localPath) : ''} placeholder={t('选择 .soc / .binpkg 文件', 'Choose a .soc / .binpkg file')} readOnly className="flex-1" />
            <Button icon={FolderOpen} onClick={browse}>
              {t('浏览…', 'Browse…')}
            </Button>
          </div>
        )}
        {netErr && core.source === 'resource' && (
          <div className="flex items-center gap-2 text-2xs text-err">
            {t('读取合宙固件列表失败：', 'Cannot load firmware list: ')}
            {netErr}
            <button type="button" className="text-accent hover:underline" onClick={() => setPage('firmware')}>
              {t('去固件资源页', 'Open firmware page')}
            </button>
          </div>
        )}
      </div>
      <div className="mt-3 grid grid-cols-[1fr_0.8fr_1.7fr_1fr] gap-2">
        <InfoTile label={t('芯片', 'Chip')} value={spec.chip} />
        <InfoTile label={t('位数', 'Arch')} value={spec.bits ? t(`${spec.bits} 位`, `${spec.bits}-bit`) : '—'} />
        <InfoTile label={t('脚本区', 'Script area')} value={`${spec.scriptAddr} / ${spec.scriptKB}KB`} sub={spec.exact ? undefined : t('下载固件后显示准确地址', 'Exact after download')} />
        <InfoTile label={t('文件系统', 'File system')} value={spec.fsKB ? `${spec.fsKB}KB` : '—'} />
      </div>
    </Panel>
  )
}

function ScriptTable({ p }: { p: Project }) {
  const { t, updateProject, toast, confirm, openFile, isDirty, scriptBytes, coreSpec, tildify, refreshFiles } = useApp()
  const [sel, setSel] = useState<Set<string>>(new Set())
  const cap = coreSpec(p).scriptKB || 1024
  const used = scriptBytes(p)
  const scriptsB = p.files.filter((f) => f.type === 'script').reduce((s, f) => s + f.size, 0)
  const pct = (used / 1024 / cap) * 100
  const toggle = (n: string) =>
    setSel((s) => {
      const x = new Set(s)
      if (x.has(n)) x.delete(n)
      else x.add(n)
      return x
    })
  const allSel = sel.size > 0 && sel.size === p.files.length
  const addPaths = (paths: string[]) => {
    const have = new Set(p.files.map((f) => f.path))
    const names = new Set(p.files.map((f) => f.name))
    const fresh = paths.filter((x) => !have.has(x))
    const dup = fresh.filter((x) => names.has(x.split(/[\\/]/).pop() ?? x))
    if (!fresh.length) return toast('info', t('这些文件已在列表中', 'Already in the list'))
    updateProject(p.id, (cur) => ({
      files: [...cur.files, ...fresh.map((path) => ({ name: path.split(/[\\/]/).pop() ?? path, path, type: path.endsWith('.lua') ? ('script' as const) : ('resource' as const), size: 0, exists: true }))],
    }))
    setTimeout(() => refreshFiles(), 100)
    toast('success', t(`已添加 ${fresh.length} 个文件`, `Added ${fresh.length} files`))
    if (dup.length) toast('warning', t('有同名文件', 'Duplicate file names'), t('脚本区不区分目录，同名文件下载时会报错：', 'The script area is flat; duplicates fail at download: ') + dup.map((x) => x.split(/[\\/]/).pop()).join(', '))
  }
  const addFile = async () => addPaths(await dialogs.pickFiles(t('选择脚本或资源文件', 'Choose scripts or resources')))
  const addDir = async () => {
    const dir = await dialogs.pickDir(t('选择要递归添加的目录', 'Choose a folder to add'), p.dir)
    if (!dir) return
    try {
      addPaths(await api.dirFiles(dir))
    } catch (e) {
      toast('error', t('读取目录失败', 'Cannot read folder'), errText(e))
    }
  }
  const delSel = async () => {
    if (!sel.size) return
    const ok = await confirm({ title: t('删除选中文件', 'Remove selected'), body: t(`从项目中移除 ${sel.size} 个文件（不会删除磁盘文件）？`, `Remove ${sel.size} files from the project (disk files are kept)?`), okText: t('移除', 'Remove'), danger: true })
    if (!ok) return
    updateProject(p.id, { files: p.files.filter((f) => !sel.has(f.path)) })
    toast('success', t(`已移除 ${sel.size} 个文件`, `Removed ${sel.size} files`))
    setSel(new Set())
  }
  const delAll = async () => {
    const ok = await confirm({ title: t('删除全部文件', 'Remove all files'), body: t('将清空脚本和资源列表（不会删除磁盘文件），是否继续？', 'This clears the list (disk files are kept). Continue?'), okText: t('全部删除', 'Remove all'), danger: true })
    if (!ok) return
    updateProject(p.id, { files: [] })
    setSel(new Set())
    toast('success', t('已清空列表', 'List cleared'))
  }
  const openSel = () => {
    const f = p.files.find((x) => sel.has(x.path) && x.type === 'script') ?? p.files.find((x) => x.type === 'script')
    if (f) openFile(f.name)
  }
  const iconOf = (f: ProjectFile) => (f.type === 'script' ? FileCode : f.name.endsWith('.bin') ? FileArchive : FileImage)
  return (
    <Panel title={t('脚本和资源列表', 'Scripts & Resources')} icon={FileCode} subtitle={t(`${p.files.length} 个文件`, `${p.files.length} files`)} bodyClassName="p-0">
      <div className="flex">
        <div className="min-w-0 flex-1 border-r border-line">
          <div className="grid grid-cols-[32px_minmax(116px,1.3fr)_60px_72px_minmax(0,2fr)] items-center border-b border-line bg-surface-2 px-2 text-2xs font-medium text-fg-3">
            <span className="flex h-8 items-center justify-center">
              <Checkbox checked={allSel} indeterminate={sel.size > 0 && !allSel} onChange={(v) => setSel(v ? new Set(p.files.map((f) => f.path)) : new Set())} />
            </span>
            <span>{t('文件名', 'Name')}</span>
            <span>{t('类型', 'Type')}</span>
            <span className="pr-3 text-right">{t('大小', 'Size')}</span>
            <span>{t('路径', 'Path')}</span>
          </div>
          <div className="scroll-thin max-h-[264px] min-h-[120px] overflow-auto">
            {p.files.length === 0 && <div className="py-10 text-center text-xs text-fg-3">{t('列表为空，点击右侧“增加脚本或资源文件”', 'Empty — use “Add file” on the right')}</div>}
            {p.files.map((f) => {
              const I = iconOf(f)
              const on = sel.has(f.path)
              return (
                <div
                  key={f.path}
                  onClick={() => toggle(f.path)}
                  onDoubleClick={() => f.type === 'script' && openFile(f.name)}
                  className={cx(
                    'grid grid-cols-[32px_minmax(116px,1.3fr)_60px_72px_minmax(0,2fr)] items-center border-b border-line/60 px-2 text-sm last:border-b-0',
                    on ? 'bg-primary-soft' : 'hover:bg-hover',
                  )}
                >
                  <span className="flex h-8 items-center justify-center">
                    <Checkbox checked={on} onChange={() => toggle(f.path)} />
                  </span>
                  <span className="flex min-w-0 items-center gap-2">
                    <I size={14} className={f.type === 'script' ? 'text-accent' : 'text-fg-3'} />
                    <span className={cx('truncate font-mono text-xs', f.exists ? 'text-fg' : 'text-err line-through')} title={f.exists ? undefined : t('文件不存在', 'File missing')}>
                      {f.name}
                    </span>
                    {isDirty(f.name) && <span className="size-1.5 shrink-0 rounded-full bg-warn" title={t('未保存', 'Unsaved')} />}
                  </span>
                  <span>
                    <Badge tone={f.type === 'script' ? 'primary' : 'neutral'}>{f.type === 'script' ? t('脚本', 'Script') : t('资源', 'Resource')}</Badge>
                  </span>
                  <span className="pr-3 text-right font-mono text-xs text-fg-2">{fmtKB(f.size)}</span>
                  <span className="truncate font-mono text-2xs text-fg-3" title={f.path}>
                    {tildify(f.path)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
        <div className="flex w-[164px] shrink-0 flex-col gap-1.5 p-2.5">
          <Button size="sm" icon={FilePlus} className="justify-start" onClick={addFile}>
            {t('增加脚本或资源文件', 'Add file')}
          </Button>
          <Button size="sm" icon={FolderPlus} className="justify-start" onClick={addDir} title={t('递归添加目录中的全部文件', 'Recursively add every file in a folder')}>
            {t('增加目录（递归）', 'Add folder')}
          </Button>
          <Button size="sm" icon={X} className="justify-start" variant="danger" onClick={delSel} disabled={!sel.size}>
            {t('删除选中', 'Remove selected')}
            {sel.size > 0 && ` (${sel.size})`}
          </Button>
          <Button size="sm" icon={Trash2} className="justify-start" variant="danger" onClick={delAll} disabled={!p.files.length}>
            {t('删除全部', 'Remove all')}
          </Button>
          <div className="my-0.5 h-px bg-line" />
          <Button size="sm" icon={ExternalLink} className="justify-start" onClick={openSel} disabled={!p.files.some((f) => f.type === 'script')}>
            {t('在编辑器中打开', 'Open in editor')}
          </Button>
        </div>
      </div>
      <div className="flex items-center gap-3 border-t border-line px-3.5 py-2.5">
        <span className="text-xs text-fg-2">{t('脚本区容量', 'Script area')}</span>
        <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-surface-3">
          <div className={cx('absolute inset-y-0 left-0 rounded-full', pct > 90 ? 'bg-err' : pct > 70 ? 'bg-warn' : 'bg-primary')} style={{ width: `${Math.max(0.8, Math.min(100, pct))}%` }} />
        </div>
        <span className="font-mono text-xs text-fg">
          {(used / 1024).toFixed(used < 10240 ? 1 : 0)} / {cap} KB
        </span>
        <span className="text-2xs text-fg-3">
          {t('脚本', 'Scripts')} {fmtKB(scriptsB)} · {t('资源', 'Res')} {fmtKB(used - scriptsB)}
        </span>
      </div>
    </Panel>
  )
}

function DownloadOptionsPanel({ p }: { p: Project }) {
  const { t, updateProject, setLogMode, tildify } = useApp()
  const o = p.options
  const set = (patch: Partial<typeof o>) => updateProject(p.id, { options: { ...o, ...patch } })
  return (
    <Panel title={t('下载选项', 'Download options')} icon={SlidersHorizontal}>
      <div className="flex flex-col gap-3">
        <Field label={t('日志口', 'Log port')}>
          <Segmented
            full
            size="sm"
            value={o.logPort}
            onChange={(v) => {
              set({ logPort: v })
              setLogMode(v === 'usb' ? 'usb' : 'uart')
            }}
            options={[
              { value: 'usb', label: t('USB 打印', 'USB') },
              { value: 'uart1', label: t('串口1', 'UART1') },
              { value: 'uart2', label: t('串口2', 'UART2') },
            ]}
          />
        </Field>
        <Field label={t('Lua 调试信息', 'Lua debug info')} hint={t('去掉调试信息可减小脚本体积，但报错时无法显示行号', 'Stripping reduces size but errors lose line numbers')}>
          <Select value={o.debugInfo} onChange={(e) => set({ debugInfo: e.target.value as typeof o.debugInfo })}>
            <option value="all">{t('全部', 'All')}</option>
            <option value="line">{t('仅行号', 'Line numbers only')}</option>
            <option value="var">{t('仅变量名', 'Variable names only')}</option>
            <option value="none">{t('无', 'None')}</option>
          </Select>
        </Field>
        <div className="flex flex-col gap-2.5 pt-1">
          <Checkbox
            checked={o.ignoreDeps}
            onChange={(v) => set({ ignoreDeps: v })}
            label={t('忽略脚本依赖性', 'Ignore script dependencies')}
            desc={o.ignoreDeps ? t('下载列表中的全部文件', 'Download every listed file') : t('只下载 main.lua 通过 require 用到的脚本（资源文件全部下载）', 'Only scripts reachable from main.lua via require')}
          />
          <Checkbox checked={o.clearFs} onChange={(v) => set({ clearFs: v })} label={t('下载前清除文件系统', 'Erase file system first')} />
          <Checkbox checked={o.clearKv} onChange={(v) => set({ clearKv: v })} label={t('下载前清除 KV', 'Erase KV first')} />
          <div>
            <Checkbox checked={o.burnFs} onChange={(v) => set({ burnFs: v })} label={t('启用烧录文件系统', 'Flash file system image')} desc={t('把选择的文件夹打包成文件系统镜像一起下载', 'Pack a folder into the file system')} />
            {o.burnFs && (
              <div className="mt-1.5 ml-6 flex gap-1.5">
                <Input size="sm" mono value={o.burnFsPath ? tildify(o.burnFsPath) : ''} placeholder={t('未选择', 'Not set')} readOnly className="flex-1" />
                <Button
                  size="sm"
                  icon={FolderOpen}
                  onClick={async () => {
                    const d = await dialogs.pickDir(t('选择文件系统内容所在文件夹', 'Choose the file system folder'), p.dir)
                    if (d) set({ burnFsPath: d })
                  }}
                >
                  {t('选择', 'Choose')}
                </Button>
              </div>
            )}
          </div>
          <Checkbox checked={o.listenAfter} onChange={(v) => set({ listenAfter: v })} label={t('下载后监听日志 30 秒', 'Watch log for 30s after download')} />
        </div>
      </div>
    </Panel>
  )
}

function MassProduction({ p }: { p: Project }) {
  const { t, toast, coreSpec, downloadFw, tildify, saveAll } = useApp()
  const [open, setOpen] = useState(false)
  const [path, setPath] = useState(`${p.dir}/release`)
  const [suffix, setSuffix] = useState(true)
  const [incCore, setIncCore] = useState(false)
  const [incScript, setIncScript] = useState(true)
  const [busy, setBusy] = useState<'mp' | 'ota' | null>(null)
  useEffect(() => setPath(`${p.dir}/release`), [p.dir])
  const date = useMemo(() => {
    const d = new Date()
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  }, [])
  const base = `${p.name}_${p.version}${suffix ? `_${date}` : ''}`
  const resolveSoc = async () => {
    const spec = coreSpec(p)
    if (spec.socPath) return spec.socPath
    if (p.core.source === 'resource' && p.core.version && coreFile(p.model, p.core)) return downloadFw(p.model, p.core.version, coreFile(p.model, p.core))
    toast('error', t('项目还没有选择底层固件', 'No CORE selected'))
    return null
  }
  const run = async (k: 'mp' | 'ota') => {
    setBusy(k)
    try {
      await saveAll()
      const soc = await resolveSoc()
      if (!soc) return
      const scriptFiles = p.files.filter((f) => f.exists).map((f) => f.path)
      const luacDebug = { all: 99, line: 1, var: 2, none: 0 }[p.options.debugInfo]
      const out =
        k === 'mp'
          ? await api.makeProduction({ soc, scriptFiles, luacDebug, output: `${path}/${base}.soc` })
          : await api.makeFota({ soc, scriptFiles, luacDebug, output: `${path}/${base}${incScript && !incCore ? '_script' : incCore && !incScript ? '_core' : ''}.sota`, includeCore: incCore, includeScript: incScript })
      toast('success', k === 'mp' ? t('量产文件已生成', 'Production file generated') : t('升级文件已生成', 'Upgrade file generated'), tildify(out), {
        label: t('在访达中显示', 'Reveal'),
        run: () => dialogs.reveal(out),
      })
    } catch (e) {
      toast('error', k === 'mp' ? t('生成量产文件失败', 'Production build failed') : t('生成升级文件失败', 'FOTA build failed'), errText(e))
    } finally {
      setBusy(null)
    }
  }
  return (
    <section className="rounded-lg border border-line bg-surface">
      <button type="button" onClick={() => setOpen(!open)} className="flex h-10 w-full items-center gap-2 px-3.5 text-left">
        {open ? <ChevronDown size={15} className="text-fg-3" /> : <ChevronRight size={15} className="text-fg-3" />}
        <Factory size={15} className="text-fg-3" />
        <span className="text-sm font-semibold text-fg">{t('量产与升级', 'Production & Upgrade')}</span>
        <span className="text-xs text-fg-3">{t('生成量产文件 / 远程升级文件', 'Generate production / FOTA files')}</span>
      </button>
      {open && (
        <div className="grid grid-cols-2 gap-4 border-t border-line p-3.5">
          <div className="col-span-2">
            <Field label={t('保存路径', 'Save to')}>
              <div className="flex gap-1.5">
                <Input mono value={tildify(path)} onChange={(e) => setPath(e.target.value)} className="flex-1" />
                <IconButton
                  icon={FolderOpen}
                  label={t('浏览', 'Browse')}
                  onClick={async () => {
                    const d = await dialogs.pickDir(t('选择保存位置', 'Choose output folder'), p.dir)
                    if (d) setPath(d)
                  }}
                />
              </div>
            </Field>
          </div>
          <div className="flex flex-col gap-2.5">
            <div className="text-xs font-semibold text-fg">{t('量产文件', 'Production file')}</div>
            <p className="text-2xs text-fg-3">{t('把脚本编译后合进底层固件，得到一个 .soc，量产时一次刷入底层和脚本。', 'Compiles scripts into the CORE so a single .soc flashes everything.')}</p>
            <Checkbox checked={suffix} onChange={setSuffix} label={t('文件名增加日期后缀', 'Add date suffix')} desc={`${base}.soc`} />
            <Button icon={Factory} onClick={() => run('mp')} loading={busy === 'mp'} disabled={!!busy} className="self-start">
              {t('生成量产文件', 'Generate production file')}
            </Button>
          </div>
          <div className="flex flex-col gap-2.5 border-l border-line pl-4">
            <div className="text-xs font-semibold text-fg">{t('升级文件（FOTA）', 'Upgrade file (FOTA)')}</div>
            <div className="flex flex-col gap-2">
              <Checkbox checked={incCore} onChange={setIncCore} label={t('包含底层', 'Include CORE')} />
              <Checkbox checked={incScript} onChange={setIncScript} label={t('包含脚本', 'Include scripts')} />
            </div>
            <p className="text-2xs text-fg-3">{t('只含脚本的升级包体积小，适合日常推送；包含底层的是整包升级。', 'Script-only packages are small; including CORE makes a full upgrade.')}</p>
            <Button icon={Upload} onClick={() => run('ota')} loading={busy === 'ota'} disabled={(!incCore && !incScript) || !!busy} className="self-start">
              {t('生成升级文件', 'Generate upgrade file')}
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}

function BottomActions() {
  const { t, syntax, openFile } = useApp()
  const [collapsed, setCollapsed] = useState(false)
  const [hidden, setHidden] = useState<number | null>(null)
  const show = syntax && hidden !== syntax.at
  const errs = syntax?.diags.filter((d) => d.severity === 'error').length ?? 0
  const warns = (syntax?.diags.length ?? 0) - errs
  return (
    <div className="shrink-0 border-t border-line bg-surface">
      {show && syntax && (
        <div className="border-b border-line">
          <div className="flex h-8 items-center gap-2 px-4 text-xs">
            <button type="button" onClick={() => setCollapsed(!collapsed)} className="flex items-center gap-1.5 font-medium text-fg">
              {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              <ListChecks size={14} className="text-fg-3" />
              {t('语法检查结果', 'Syntax check results')}
            </button>
            <span className="font-mono text-2xs text-fg-3">{fmtTime(new Date(syntax.at), false)}</span>
            {errs > 0 && (
              <Badge tone="err">
                {errs} {t('错误', 'errors')}
              </Badge>
            )}
            {warns > 0 && (
              <Badge tone="warn">
                {warns} {t('警告', 'warnings')}
              </Badge>
            )}
            <IconButton icon={X} size="sm" label={t('关闭', 'Close')} className="ml-auto" onClick={() => setHidden(syntax.at)} />
          </div>
          {!collapsed && (
            <div className="scroll-thin max-h-[132px] overflow-auto pb-1.5">
              {syntax.diags.length === 0 ? (
                <div className="flex items-center gap-2 px-4 py-1.5 text-xs text-fg-2">
                  <CircleCheck size={14} className="text-ok" />
                  {t(`全部 ${syntax.files} 个脚本通过语法检查`, `All ${syntax.files} scripts passed`)}
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-[24px_120px_60px_1fr] px-4 pb-1 text-2xs text-fg-3">
                    <span />
                    <span>{t('文件', 'File')}</span>
                    <span>{t('行号', 'Line')}</span>
                    <span>{t('错误信息', 'Message')}</span>
                  </div>
                  {syntax.diags.map((d, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => openFile(d.file, d.line)}
                      className="grid w-full grid-cols-[24px_120px_60px_1fr] items-center px-4 py-1 text-left text-xs hover:bg-hover"
                      title={t('跳转到代码', 'Go to code')}
                    >
                      {d.severity === 'error' ? <CircleX size={13} className="text-err" /> : <TriangleAlert size={13} className="text-warn" />}
                      <span className="truncate font-mono text-accent">{d.file}</span>
                      <span className="font-mono text-fg-2">{d.line}</span>
                      <span className="truncate text-fg">
                        {t(d.zh, d.en)} <span className="ml-1 font-mono text-2xs text-fg-3">{d.raw}</span>
                      </span>
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
        <BootHint compact className="min-w-0 flex-1 basis-[340px]" />
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <TaskProgress wide />
          <DownloadButtons />
        </div>
      </div>
    </div>
  )
}

