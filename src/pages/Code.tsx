import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleX,
  CodeXml,
  Copy,
  ExternalLink,
  FileArchive,
  FileCode,
  FilePlus,
  FolderKanban,
  FolderOpen,
  FolderSearch,
  ListChecks,
  Plus,
  Save,
  Trash2,
  TriangleAlert,
  Upload,
  X,
} from 'lucide-react'
import { useApp } from '../store'
import { Badge, Button, ContextMenu, EmptyState, IconButton, Kbd, MenuItem, MenuSeparator } from '../components/ui'
import { LuaEditor } from '../components/LuaEditor'
import { cx, fmtKB } from '../lib/format'
import type { ProjectFile } from '../data/types'
import { api, dialogs, errText } from '../lib/api'

export default function CodePage() {
  const { project, t, setWizardOpen, setPage } = useApp()
  if (!project)
    return (
      <EmptyState icon={CodeXml} title={t('未打开项目', 'No project open')} desc={t('打开一个项目后即可编辑 Lua 脚本、检查语法并下载到模组。', 'Open a project to edit Lua scripts, check syntax and download to the module.')}>
        <Button variant="primary" icon={Plus} onClick={() => setWizardOpen(true)}>
          {t('新建项目', 'New project')}
        </Button>
        <Button icon={FolderKanban} onClick={() => setPage('projects')}>
          {t('打开项目', 'Open project')}
        </Button>
      </EmptyState>
    )
  return <CodeWorkspace />
}

function CodeWorkspace() {
  const { project, t, tabs, activeTab, setActiveTab, closeTab, isDirty, getContent, setDraft, saveFile, saveAll, toast, jump, liveDiags, runSyntaxCheck, checking, requestDownload, task, openFile, setWizardOpen, newFile: createFile, platform, contentLoaded, tildify, confirm, updateProject } = useApp()
  const mod = platform === 'mac' ? '⌘' : 'Ctrl+'
  const p = project!
  const [cursor, setCursor] = useState({ line: 1, col: 1 })
  const file = p.files.find((f) => f.name === activeTab)
  const scripts = p.files.filter((f) => f.type === 'script')
  const resources = p.files.filter((f) => f.type === 'resource')
  const dirtyCount = p.files.filter((f) => isDirty(f.name)).length

  const save = async () => {
    if (!file) return
    if (!isDirty(file.name)) return toast('info', t('没有需要保存的更改', 'No changes to save'), file.name)
    await saveFile(file.name)
    toast('success', t('已保存', 'Saved'), tildify(file.path))
  }
  const confirmClose = async (n: string) => {
    if (isDirty(n)) {
      await saveFile(n)
      toast('success', t('已保存', 'Saved'), n)
    }
    closeTab(n)
  }
  const newFile = async () => {
    let i = 1
    while (p.files.some((f) => f.name === `untitled${i}.lua`)) i++
    const name = `untitled${i}.lua`
    try {
      await createFile(name)
      openFile(name)
    } catch (e) {
      toast('error', t('新建文件失败', 'Failed to create file'), errText(e))
    }
  }

  // 右键菜单：f 为 null 时是项目根目录
  const [menu, setMenu] = useState<{ x: number; y: number; f: ProjectFile | null } | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])
  const openMenu = (f: ProjectFile | null) => (e: React.MouseEvent) => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, f })
  }
  const run = (fn: () => unknown) => {
    closeMenu()
    fn()
  }
  const revealLabel = platform === 'win' ? t('在资源管理器中显示', 'Show in Explorer') : t('在访达中显示', 'Reveal in Finder')
  const reveal = async (path: string) => {
    try {
      await dialogs.reveal(path)
    } catch (e) {
      toast('error', t('找不到这个位置，可能已被移动或删除', 'Not found — it may have been moved or deleted'), `${tildify(path)}\n${errText(e)}`)
    }
  }
  const openExternal = async (path: string) => {
    try {
      await dialogs.openPath(path)
    } catch (e) {
      toast('error', t('打开失败', 'Open failed'), errText(e))
    }
  }
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast('success', t('已复制', 'Copied'), text)
    } catch (e) {
      toast('error', t('复制失败', 'Copy failed'), errText(e))
    }
  }
  const removeFromProject = async (f: ProjectFile) => {
    const ok = await confirm({
      title: t(`从项目中移除「${f.name}」？`, `Remove “${f.name}” from the project?`),
      body: t(
        `只从项目的文件列表里移除，磁盘上的文件不会删除；之后下载脚本也不会再带上它。${isDirty(f.name) ? '这个文件有未保存的修改，会被丢弃。' : ''}`,
        `Only removed from the project list; the file on disk is kept and won't be downloaded any more.${isDirty(f.name) ? ' Unsaved changes will be discarded.' : ''}`,
      ),
      okText: t('移除', 'Remove'),
      danger: true,
    })
    if (!ok) return
    if (tabs.includes(f.name)) closeTab(f.name)
    updateProject(p.id, (cur) => ({ files: cur.files.filter((x) => x.path !== f.path) }))
    toast('success', t('已从项目中移除', 'Removed from project'), f.name)
  }

  return (
    <div className="flex h-full">
      {/* explorer */}
      <aside className="flex w-[228px] shrink-0 flex-col border-r border-line bg-surface-2">
        <div className="flex h-9 items-center gap-1 px-3">
          <span className="text-2xs font-semibold tracking-wide text-fg-3 uppercase">{t('资源管理器', 'Explorer')}</span>
          <div className="ml-auto flex">
            <IconButton size="sm" icon={FilePlus} label={t('新建脚本', 'New script')} onClick={newFile} />
            <IconButton size="sm" icon={Plus} label={t('新建项目', 'New project')} onClick={() => setWizardOpen(true)} />
          </div>
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-auto pb-2">
          <TreeFolder name={p.name} defaultOpen root onContextMenu={openMenu(null)}>
            {scripts.map((f) => (
              <TreeFile key={f.path} f={f} active={activeTab === f.name} dirty={isDirty(f.name)} errors={liveDiags.filter((d) => d.file === f.name)} onClick={() => openFile(f.name)} onContextMenu={openMenu(f)} />
            ))}
            {resources.length > 0 && (
              <TreeFolder name="res" defaultOpen>
                {resources.map((f) => (
                  <TreeFile key={f.path} f={f} active={activeTab === f.name} dirty={false} errors={[]} onClick={() => openFile(f.name)} onContextMenu={openMenu(f)} depth={2} />
                ))}
              </TreeFolder>
            )}
          </TreeFolder>
        </div>
        {dirtyCount > 0 && (
          <div className="flex items-center gap-2 border-t border-line px-3 py-2 text-2xs text-fg-2">
            <span className="size-1.5 rounded-full bg-warn" />
            {t(`${dirtyCount} 个文件未保存`, `${dirtyCount} unsaved`)}
            <button type="button" className="ml-auto font-medium text-accent hover:underline" onClick={() => saveAll().then(() => toast('success', t('已全部保存', 'All saved')))}>
              {t('全部保存', 'Save all')}
            </button>
          </div>
        )}
        {menu && (
          <ContextMenu x={menu.x} y={menu.y} onClose={closeMenu}>
            <div className="truncate px-2 pt-1 pb-1.5 font-mono text-2xs text-fg-3" title={menu.f ? menu.f.path : p.dir}>
              {tildify(menu.f ? menu.f.path : p.dir)}
            </div>
            {menu.f ? (
              (() => {
                const f = menu.f
                const missing = !f.exists
                return (
                  <>
                    {activeTab !== f.name && (
                      <MenuItem icon={FileCode} onClick={() => run(() => openFile(f.name))}>
                        {t('打开', 'Open')}
                      </MenuItem>
                    )}
                    {isDirty(f.name) && (
                      <MenuItem icon={Save} right={<Kbd>{mod}S</Kbd>} onClick={() => run(() => saveFile(f.name).then(() => toast('success', t('已保存', 'Saved'), tildify(f.path))))}>
                        {t('保存', 'Save')}
                      </MenuItem>
                    )}
                    <MenuItem icon={FolderSearch} disabled={missing} onClick={() => run(() => reveal(f.path))}>
                      {revealLabel}
                    </MenuItem>
                    <MenuItem icon={ExternalLink} disabled={missing} onClick={() => run(() => openExternal(f.path))}>
                      {t('用默认应用打开', 'Open with default app')}
                    </MenuItem>
                    <MenuSeparator />
                    <MenuItem icon={Copy} onClick={() => run(() => copy(f.path))}>
                      {t('复制完整路径', 'Copy full path')}
                    </MenuItem>
                    <MenuItem icon={Copy} onClick={() => run(() => copy(f.name))}>
                      {t('复制文件名', 'Copy file name')}
                    </MenuItem>
                    {tabs.includes(f.name) && (
                      <MenuItem icon={X} onClick={() => run(() => confirmClose(f.name))}>
                        {t('关闭标签', 'Close tab')}
                      </MenuItem>
                    )}
                    <MenuSeparator />
                    <MenuItem icon={Trash2} danger onClick={() => run(() => removeFromProject(f))}>
                      {t('从项目中移除', 'Remove from project')}
                    </MenuItem>
                  </>
                )
              })()
            ) : (
              <>
                <MenuItem icon={FolderSearch} onClick={() => run(() => reveal(p.dir))}>
                  {revealLabel}
                </MenuItem>
                <MenuItem icon={Copy} onClick={() => run(() => copy(p.dir))}>
                  {t('复制文件夹路径', 'Copy folder path')}
                </MenuItem>
                <MenuSeparator />
                <MenuItem icon={FilePlus} onClick={() => run(newFile)}>
                  {t('新建脚本', 'New script')}
                </MenuItem>
              </>
            )}
          </ContextMenu>
        )}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* tabs */}
        <div className="scroll-thin flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-line bg-surface-2">
          {tabs.map((n) => {
            const active = n === activeTab
            const dirty = isDirty(n)
            const hasErr = liveDiags.some((d) => d.file === n && d.severity === 'error')
            return (
              <div
                key={n}
                role="tab"
                tabIndex={0}
                onClick={() => setActiveTab(n)}
                onAuxClick={(e) => e.button === 1 && confirmClose(n)}
                className={cx(
                  'group relative flex shrink-0 items-center gap-2 border-r border-line pr-1.5 pl-3 text-xs',
                  active ? 'bg-editor text-fg' : 'text-fg-2 hover:bg-hover',
                )}
              >
                {active && <span className="absolute inset-x-0 top-0 h-0.5 bg-primary" />}
                <FileCode size={13} className={active ? 'text-accent' : 'text-fg-3'} />
                <span className={cx('font-mono', hasErr && 'text-err')}>{n}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    confirmClose(n)
                  }}
                  className="relative flex size-5 items-center justify-center rounded text-fg-3 hover:bg-hover hover:text-fg"
                  title={dirty ? t('保存并关闭', 'Save & close') : t('关闭', 'Close')}
                >
                  {dirty ? (
                    <>
                      <span className="size-2 rounded-full bg-fg-2 group-hover:hidden" />
                      <X size={13} className="hidden group-hover:block" />
                    </>
                  ) : (
                    <X size={13} className={active ? '' : 'opacity-0 group-hover:opacity-100'} />
                  )}
                </button>
              </div>
            )
          })}
        </div>

        {/* editor toolbar */}
        <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-line bg-surface px-3">
          <div className="flex min-w-0 items-center gap-1 font-mono text-xs text-fg-3">
            <span>{p.name}</span>
            {file && (
              <>
                <ChevronRight size={12} />
                {file.type === 'resource' && (
                  <>
                    <span>res</span>
                    <ChevronRight size={12} />
                  </>
                )}
                <span className="text-fg">{file.name}</span>
                {isDirty(file.name) && <Badge tone="warn" className="ml-1.5">{t('未保存', 'Unsaved')}</Badge>}
              </>
            )}
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <Button size="sm" variant="ghost" icon={Save} onClick={save} disabled={!file || file.type !== 'script'}>
              {t('保存', 'Save')}
              <Kbd>{mod}S</Kbd>
            </Button>
            <Button size="sm" icon={ListChecks} onClick={runSyntaxCheck} loading={checking}>
              {t('语法检查', 'Syntax Check')}
            </Button>
            <Button size="sm" icon={Upload} onClick={() => requestDownload('script')} disabled={task?.status === 'running'}>
              {t('下载脚本', 'Download Script')}
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1">
          {!file ? (
            <EmptyState icon={FileCode} title={t('没有打开的文件', 'No file open')} desc={t('从左侧资源管理器选择一个脚本开始编辑', 'Pick a script from the explorer to start editing')}>
              <div className="flex flex-col gap-1.5 text-xs text-fg-3">
                <span className="flex items-center gap-2">
                  <Kbd>{mod}S</Kbd> {t('保存', 'Save')}
                </span>
                <span className="flex items-center gap-2">
                  <Kbd>Tab</Kbd> {t('缩进 4 空格', 'Indent 4 spaces')}
                </span>
              </div>
            </EmptyState>
          ) : !file.exists ? (
            <EmptyState icon={FileCode} title={t('文件不存在', 'File not found')} desc={tildify(file.path)} />
          ) : file.type === 'resource' ? (
            <HexView f={file} />
          ) : !contentLoaded(file) ? (
            <div className="flex h-full items-center justify-center text-xs text-fg-3">{t('读取中…', 'Loading…')}</div>
          ) : (
            <LuaEditor
              key={`${p.id}:${file.name}`}
              value={getContent(file)}
              onChange={(v) => setDraft(file.name, v)}
              onSave={save}
              diags={liveDiags.filter((d) => d.file === file.name)}
              jump={jump && jump.file === file.name ? jump : null}
              onCursor={(line, col) => setCursor({ line, col })}
            />
          )}
        </div>

        <ProblemsPanel cursor={file?.type === 'script' ? cursor : null} />
      </div>
    </div>
  )
}

function TreeFolder({ name, children, defaultOpen, root, onContextMenu }: { name: string; children: React.ReactNode; defaultOpen?: boolean; root?: boolean; onContextMenu?: (e: React.MouseEvent) => void }) {
  const [open, setOpen] = useState(!!defaultOpen)
  return (
    <div>
      <button type="button" onClick={() => setOpen(!open)} onContextMenu={onContextMenu} className={cx('flex h-6 w-full items-center gap-1 pr-2 text-left text-xs hover:bg-hover', root ? 'pl-2 font-semibold text-fg' : 'pl-5 text-fg-2')}>
        {open ? <ChevronDown size={13} className="text-fg-3" /> : <ChevronRight size={13} className="text-fg-3" />}
        {!root && <FolderOpen size={13} className="text-fg-3" />}
        <span className={cx('truncate', root && 'font-mono uppercase tracking-wide text-2xs')}>{name}</span>
      </button>
      {open && children}
    </div>
  )
}

function TreeFile({
  f,
  active,
  dirty,
  errors,
  onClick,
  onContextMenu,
  depth = 1,
}: {
  f: ProjectFile
  active: boolean
  dirty: boolean
  errors: { severity: string }[]
  onClick: () => void
  onContextMenu?: (e: React.MouseEvent) => void
  depth?: number
}) {
  const hasErr = errors.some((e) => e.severity === 'error')
  const hasWarn = !hasErr && errors.length > 0
  const I = f.type === 'script' ? FileCode : FileArchive
  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={cx('flex h-6 w-full items-center gap-1.5 pr-3 text-left text-xs transition-colors', active ? 'bg-primary-soft text-fg' : 'text-fg-2 hover:bg-hover')}
      style={{ paddingLeft: depth === 1 ? 26 : 44 }}
    >
      <I size={13} className={f.type === 'script' ? 'text-accent' : 'text-fg-3'} />
      <span className={cx('min-w-0 flex-1 truncate font-mono', hasErr ? 'text-err' : hasWarn ? 'text-warn' : '')}>{f.name}</span>
      {errors.length > 0 && <span className={cx('font-mono text-[10px]', hasErr ? 'text-err' : 'text-warn')}>{errors.length}</span>}
      {dirty && <span className="size-2 shrink-0 rounded-full bg-fg-2" title="unsaved" />}
    </button>
  )
}

function HexView({ f }: { f: ProjectFile }) {
  const { t } = useApp()
  const [bytes, setBytes] = useState<Uint8Array | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    setBytes(null)
    setErr('')
    api.readBytes(f.path, 4096).then(setBytes).catch((e) => setErr(errText(e)))
  }, [f.path, f.size])
  const rows = useMemo(() => {
    if (!bytes) return []
    const out: { off: number; bytes: number[] }[] = []
    for (let off = 0; off < bytes.length; off += 16) out.push({ off, bytes: Array.from(bytes.subarray(off, off + 16)) })
    return out
  }, [bytes])
  return (
    <div className="flex h-full flex-col bg-editor">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2 text-xs text-fg-2">
        <FileArchive size={14} className="text-fg-3" />
        {t('二进制资源文件（只读预览）', 'Binary resource (read-only preview)')}
        <span className="font-mono text-fg-3">{fmtKB(f.size)}</span>
        {f.size > 4096 && <span className="text-fg-3">{t('仅显示前 4KB', 'First 4 KB shown')}</span>}
      </div>
      <div className="scroll-thin flex-1 overflow-auto px-4 py-2 font-mono text-[12px] leading-5">
        {err && <div className="text-err">{err}</div>}
        {rows.map((r) => (
          <div key={r.off} className="flex gap-6">
            <span className="text-fg-3">{r.off.toString(16).padStart(8, '0')}</span>
            <span className="w-[372px] text-fg-2">{r.bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ')}</span>
            <span className="text-fg-3">{r.bytes.map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('')}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function ProblemsPanel({ cursor }: { cursor: { line: number; col: number } | null }) {
  const { liveDiags, t, openFile, task, syntax } = useApp()
  const [tab, setTab] = useState<'problems' | 'output'>('problems')
  const [collapsed, setCollapsed] = useState(false)
  const errs = liveDiags.filter((d) => d.severity === 'error').length
  const warns = liveDiags.length - errs
  const grouped = useMemo(() => {
    const m = new Map<string, typeof liveDiags>()
    liveDiags.forEach((d) => m.set(d.file, [...(m.get(d.file) ?? []), d]))
    return [...m.entries()]
  }, [liveDiags])
  return (
    <div className={cx('flex shrink-0 flex-col border-t border-line bg-surface', collapsed ? 'h-8' : 'h-[172px]')}>
      <div className="flex h-8 shrink-0 items-center gap-4 px-3 text-2xs">
        {(['problems', 'output'] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => {
              setTab(k)
              setCollapsed(false)
            }}
            className={cx('relative flex h-full items-center gap-1.5 font-semibold tracking-wide uppercase', tab === k && !collapsed ? 'text-fg' : 'text-fg-3 hover:text-fg-2')}
          >
            {k === 'problems' ? t('问题', 'Problems') : t('输出', 'Output')}
            {k === 'problems' && liveDiags.length > 0 && <span className="rounded-full bg-surface-3 px-1.5 text-[10px] text-fg-2">{liveDiags.length}</span>}
            {tab === k && !collapsed && <span className="absolute inset-x-0 bottom-0 h-px bg-fg" />}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-3 font-mono text-fg-3">
          <span className="flex items-center gap-1">
            <CircleX size={11} className={errs ? 'text-err' : ''} />
            {errs}
          </span>
          <span className="flex items-center gap-1">
            <TriangleAlert size={11} className={warns ? 'text-warn' : ''} />
            {warns}
          </span>
          {cursor && (
            <span>
              {t('行', 'Ln')} {cursor.line}, {t('列', 'Col')} {cursor.col}
            </span>
          )}
          <span>Lua 5.3 · UTF-8</span>
          <IconButton size="xs" icon={collapsed ? ChevronRight : ChevronDown} label={collapsed ? t('展开', 'Expand') : t('收起', 'Collapse')} onClick={() => setCollapsed(!collapsed)} />
        </div>
      </div>
      {!collapsed && (
        <div className="scroll-thin min-h-0 flex-1 overflow-auto pb-2">
          {tab === 'problems' ? (
            liveDiags.length === 0 ? (
              <div className="flex items-center gap-2 px-4 py-2 text-xs text-fg-2">
                <CircleCheck size={14} className="text-ok" />
                {t('未发现问题', 'No problems detected')}
              </div>
            ) : (
              grouped.map(([fileName, ds]) => (
                <div key={fileName}>
                  <div className="flex items-center gap-1.5 px-3 py-0.5 text-xs text-fg">
                    <ChevronDown size={12} className="text-fg-3" />
                    <FileCode size={13} className="text-accent" />
                    <span className="font-mono">{fileName}</span>
                    <span className="rounded-full bg-surface-3 px-1.5 text-[10px] text-fg-3">{ds.length}</span>
                  </div>
                  {ds.map((d, i) => (
                    <button key={i} type="button" onClick={() => openFile(d.file, d.line)} className="flex w-full items-center gap-2 py-0.5 pr-3 pl-10 text-left text-xs hover:bg-hover">
                      {d.severity === 'error' ? <CircleX size={13} className="shrink-0 text-err" /> : <TriangleAlert size={13} className="shrink-0 text-warn" />}
                      <span className="truncate text-fg">{t(d.zh, d.en)}</span>
                      <span className="truncate font-mono text-2xs text-fg-3">{d.severity === 'error' ? 'luac' : t('提示', 'hint')}</span>
                      <span className="ml-auto shrink-0 font-mono text-2xs text-fg-3">[{t('行', 'Ln')} {d.line}]</span>
                    </button>
                  ))}
                </div>
              ))
            )
          ) : (
            <div className="px-4 py-1 font-mono text-[11.5px] leading-[18px] text-fg-2">
              {syntax && (
                <div className="text-fg-3">
                  {t('语法检查（Lua 5.3 编译器）', 'Syntax check (Lua 5.3 compiler)')} · {syntax.files} {t('个脚本', 'files')} · {syntax.diags.length} {t('个问题', 'issues')}
                </div>
              )}
              {syntax?.diags.map((d, i) => (
                <div key={i} className={d.severity === 'error' ? 'text-err' : 'text-warn'}>
                  {d.raw}
                </div>
              ))}
              {task?.logs.slice(-30).map((l, i) => (
                <div key={`t${i}`} className={l.level === 'err' ? 'text-err' : l.level === 'ok' ? 'text-ok' : l.level === 'dim' ? 'text-fg-3' : ''}>
                  {l.text}
                </div>
              ))}
              {!syntax && !task && <div className="text-fg-3">{t('暂无输出', 'No output yet')}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
