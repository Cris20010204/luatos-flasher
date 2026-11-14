import { useEffect, useState } from 'react'
import { CircleCheck, CircleX, ExternalLink, FolderOpen, Info, Languages, LoaderCircle, Monitor, Moon, Palette, RefreshCw, ShieldCheck, Stethoscope, Sun, TerminalSquare, TriangleAlert, Download } from 'lucide-react'
import { useApp, type ThemePref } from '../store'
import { Badge, Button, Input, Segmented } from '../components/ui'
import { AppMark } from '../components/shell'
import { cx } from '../lib/format'
import { api, dialogs, errText, type Check } from '../lib/api'
import { openUrl } from '@tauri-apps/plugin-opener'

type CheckState = 'ok' | 'warn' | 'err'
interface Diag {
  id: string
  zh: string
  en: string
  state?: CheckState
  dzh?: string
  den?: string
}

const SECTIONS = [
  { id: 'general', zh: '通用', en: 'General', icon: Palette },
  { id: 'cli', zh: 'luatos-cli', en: 'luatos-cli', icon: TerminalSquare },
  { id: 'diag', zh: '环境诊断', en: 'Diagnostics', icon: Stethoscope },
  { id: 'about', zh: '关于', en: 'About', icon: Info },
]

function Row({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-6 border-b border-line py-3.5 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="text-sm text-fg">{label}</div>
        {desc && <div className="mt-0.5 text-xs text-fg-3">{desc}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function Card({ id, title, icon: I, children, right }: { id: string; title: string; icon: typeof Info; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section id={`set-${id}`} className="rounded-lg border border-line bg-surface">
      <header className="flex h-11 items-center gap-2 border-b border-line px-4">
        <I size={15} className="text-fg-3" />
        <h2 className="text-sm font-semibold text-fg">{title}</h2>
        <div className="ml-auto">{right}</div>
      </header>
      <div className="px-4 py-1">{children}</div>
    </section>
  )
}

function ThemeCard({ value, label, icon: I, active, onClick }: { value: ThemePref; label: string; icon: typeof Sun; active: boolean; onClick: () => void }) {
  const preview = (dark: boolean) => (
    <div className={cx('flex h-full w-full overflow-hidden', dark ? 'bg-[#1c1e23]' : 'bg-white')}>
      <div className={cx('w-4', dark ? 'bg-[#18191d]' : 'bg-[#f3f4f6]')} />
      <div className="flex flex-1 flex-col gap-1 p-1.5">
        <div className={cx('h-1.5 w-10 rounded-sm', dark ? 'bg-[#383c45]' : 'bg-[#e5e7eb]')} />
        <div className={cx('h-1.5 w-14 rounded-sm', dark ? 'bg-[#2a2d34]' : 'bg-[#eef0f3]')} />
        <div className="mt-auto h-2 w-8 rounded-sm bg-[#2563eb]" />
      </div>
    </div>
  )
  return (
    <button type="button" onClick={onClick} className="flex flex-col items-center gap-1.5">
      <div className={cx('h-[58px] w-[92px] overflow-hidden rounded-md border-2', active ? 'border-primary' : 'border-line hover:border-line-strong')}>
        {value === 'system' ? (
          <div className="flex h-full">
            <div className="w-1/2 overflow-hidden">{preview(false)}</div>
            <div className="w-1/2 overflow-hidden">{preview(true)}</div>
          </div>
        ) : (
          preview(value === 'dark')
        )}
      </div>
      <span className={cx('flex items-center gap-1 text-xs', active ? 'font-medium text-fg' : 'text-fg-2')}>
        <I size={12} />
        {label}
      </span>
    </button>
  )
}

export default function SettingsPage() {
  const { t, lang, setLang, themePref, setThemePref, platform, toast, appInfo, cliVersion, cachedFw, tildify } = useApp()
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [updateMsg, setUpdateMsg] = useState<string | null>(null)
  const [fwDir, setFwDir] = useState('')
  const [diags, setDiags] = useState<Check[]>([])
  const [running, setRunning] = useState(false)
  const [section, setSection] = useState('general')
  useEffect(() => {
    api.fwCacheDir().then(setFwDir).catch(() => {})
  }, [])
  const cacheMB = cachedFw.reduce((s, c) => s + c.size, 0) / 1048576

  const runDiag = async () => {
    setRunning(true)
    setDiags([])
    try {
      const res = await api.doctor()
      setDiags(res)
      const errs = res.filter((d) => d.status === 'err').length
      const warns = res.filter((d) => d.status === 'warn').length
      if (errs) toast('error', t(`环境诊断发现 ${errs} 个问题`, `Diagnostics found ${errs} issue(s)`))
      else toast('success', t('环境诊断完成', 'Diagnostics complete'), warns ? t(`${warns} 项需要注意`, `${warns} warning(s)`) : t('全部正常', 'All good'))
    } catch (e) {
      toast('error', t('环境诊断失败', 'Diagnostics failed'), errText(e))
    } finally {
      setRunning(false)
    }
  }
  const checkUpdate = async () => {
    setCheckingUpdate(true)
    try {
      const r = await fetch('https://api.github.com/repos/wendal/luatos-cli/releases/latest', { headers: { Accept: 'application/vnd.github+json' } })
      const j = (await r.json()) as { tag_name?: string }
      const latest = (j.tag_name ?? '').replace(/^v/, '')
      const cur = (cliVersion.match(/(\d+\.\d+\.\d+)/) ?? [])[1] ?? ''
      if (!latest) throw new Error(t('没有拿到版本号', 'No version returned'))
      if (latest === cur) {
        setUpdateMsg(t(`已是最新版本 v${latest}`, `Up to date (v${latest})`))
        toast('success', t('已是最新版本', 'Up to date'), `luatos-cli v${latest}`)
      } else {
        setUpdateMsg(t(`发现新版本 v${latest}（当前 v${cur || '?'}）。重新打包应用时运行 pnpm fetch:cli 即可更新。`, `v${latest} is available (current v${cur || '?'}). Re-run pnpm fetch:cli when rebuilding.`))
        toast('info', t('发现 luatos-cli 新版本', 'New luatos-cli version'), `v${latest}`)
      }
    } catch (e) {
      toast('error', t('检查更新失败', 'Update check failed'), errText(e))
    } finally {
      setCheckingUpdate(false)
    }
  }
  const moduleWarn = diags.some((d) => d.id === 'module' && d.status !== 'ok')
  const icon = { ok: CircleCheck, warn: TriangleAlert, err: CircleX }
  const color = { ok: 'text-ok', warn: 'text-warn', err: 'text-err' }

  return (
    <div className="flex h-full">
      <nav className="flex w-[188px] shrink-0 flex-col gap-0.5 border-r border-line bg-surface-2 p-2">
        <div className="px-2.5 pt-1 pb-2 text-sm font-semibold text-fg">{t('设置', 'Settings')}</div>
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => {
              setSection(s.id)
              document.getElementById(`set-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }}
            className={cx('flex h-8 items-center gap-2 rounded-md px-2.5 text-sm', section === s.id ? 'bg-primary-soft font-medium text-fg' : 'text-fg-2 hover:bg-hover')}
          >
            <s.icon size={15} className={section === s.id ? 'text-accent' : 'text-fg-3'} />
            {t(s.zh, s.en)}
          </button>
        ))}
      </nav>
      <div className="scroll-thin min-w-0 flex-1 overflow-auto p-5">
        <div className="mx-auto flex max-w-[780px] flex-col gap-4 pb-10">
          <Card id="general" title={t('通用', 'General')} icon={Palette}>
            <Row label={t('语言', 'Language')} desc={t('界面语言，切换后立即生效', 'Applies immediately')}>
              <Segmented
                value={lang}
                onChange={setLang}
                options={[
                  { value: 'zh', label: '简体中文', icon: Languages },
                  { value: 'en', label: 'English' },
                ]}
              />
            </Row>
            <Row label={t('主题', 'Theme')} desc={t('浅色 / 深色 / 跟随系统外观', 'Light, dark, or follow the system')}>
              <div className="flex gap-3">
                <ThemeCard value="light" label={t('浅色', 'Light')} icon={Sun} active={themePref === 'light'} onClick={() => setThemePref('light')} />
                <ThemeCard value="dark" label={t('深色', 'Dark')} icon={Moon} active={themePref === 'dark'} onClick={() => setThemePref('dark')} />
                <ThemeCard value="system" label={t('跟随系统', 'System')} icon={Monitor} active={themePref === 'system'} onClick={() => setThemePref('system')} />
              </div>
            </Row>
          </Card>

          <Card
            id="cli"
            title="luatos-cli"
            icon={TerminalSquare}
            right={
              cliVersion ? (
                <Badge tone="ok" dot>
                  {t('可用', 'Available')}
                </Badge>
              ) : (
                <Badge tone="err" dot>
                  {t('不可用', 'Unavailable')}
                </Badge>
              )
            }
          >
            <Row label={t('当前版本', 'Version')} desc={updateMsg ?? t('刷机、日志解码、量产和升级包由内置的 luatos-cli 完成（wendal/luatos-cli，MIT）', 'Flashing, log decoding and packaging run on the bundled luatos-cli (MIT)')}>
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm text-fg">{cliVersion || '—'}</span>
                <Button size="sm" icon={RefreshCw} loading={checkingUpdate} onClick={checkUpdate}>
                  {t('检查更新', 'Check for updates')}
                </Button>
              </div>
            </Row>
            <Row label={t('运行日志', 'App log')} desc={t('luatos-cli 的输出、设备插拔、界面错误都会记在这里，遇到问题时把它发给开发者', 'luatos-cli output, device events and UI errors; attach it when reporting issues')}>
              <Button size="sm" icon={FolderOpen} onClick={async () => dialogs.openPath(await api.logDir())}>
                {t('打开日志目录', 'Open log folder')}
              </Button>
            </Row>
            <Row label={t('固件缓存目录', 'Firmware cache')} desc={t(`下载的固件存放位置 · ${cachedFw.length} 个文件，${cacheMB.toFixed(1)} MB`, `${cachedFw.length} files, ${cacheMB.toFixed(1)} MB`)}>
              <div className="flex items-center gap-1.5">
                <Input size="sm" mono value={tildify(fwDir)} readOnly className="w-[300px]" />
                <Button size="sm" icon={FolderOpen} onClick={() => fwDir && dialogs.openPath(fwDir)} disabled={!fwDir}>
                  {t('打开', 'Open')}
                </Button>
              </div>
            </Row>
          </Card>

          <Card
            id="diag"
            title={t('环境诊断', 'Environment diagnostics')}
            icon={Stethoscope}
            right={
              <Button size="sm" variant="primary" icon={ShieldCheck} onClick={runDiag} loading={running}>
                {t('一键检查', 'Run checks')}
              </Button>
            }
          >
            {diags.length === 0 ? (
              <div className="flex items-center gap-3 py-5 text-sm text-fg-3">
                <Stethoscope size={18} />
                {t('检查 luatos-cli、串口、合宙模组、USB 是否被虚拟机占用，以及合宙固件服务器能否访问。', 'Checks luatos-cli, serial ports, the module, VM capture and the firmware server.')}
              </div>
            ) : (
              <ul className="py-1.5">
                {diags.map((d, i) => {
                  const I = icon[d.status] ?? LoaderCircle
                  return (
                    <li key={`${d.id}-${i}`} className="flex items-start gap-3 border-b border-line py-2.5 last:border-b-0">
                      <I size={17} className={cx('mt-0.5 shrink-0', color[d.status])} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-fg">{d.title}</div>
                        <div className="font-mono text-2xs break-all text-fg-3">{d.detail}</div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
            {running && diags.length === 0 && (
              <div className="flex items-center gap-2 pb-3 text-xs text-fg-3">
                <LoaderCircle size={14} className="animate-spin" />
                {t('检查中…', 'Checking…')}
              </div>
            )}
            {platform === 'win' && moduleWarn && (
              <div className="mb-3 rounded-lg border border-primary/25 bg-primary-soft p-3.5">
                <div className="flex items-center gap-2 text-sm font-semibold text-fg">
                  <Download size={15} className="text-accent" />
                  {t('安装 USB 驱动', 'Install USB driver')}
                </div>
                <ol className="mt-2 flex flex-col gap-1.5 text-xs text-fg-2">
                  {[
                    t('下载并运行“合宙 USB 驱动安装程序”（需要管理员权限）', 'Download and run the Luat USB driver installer (admin required)'),
                    t('重新插拔模组 USB 线，设备管理器中应出现 “LUAT USB Device” 端口', 'Re-plug the module; “LUAT USB Device” ports should appear in Device Manager'),
                    t('回到本页再次点击“一键检查”', 'Return here and run the checks again'),
                  ].map((s, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-white">{i + 1}</span>
                      {s}
                    </li>
                  ))}
                </ol>
                <Button size="sm" variant="primary" icon={ExternalLink} className="mt-3" onClick={() => openUrl('https://docs.openluat.com/').catch(() => {})}>
                  {t('打开合宙资料中心（搜索“USB 驱动”）', 'Open Openluat docs (search “USB driver”)')}
                </Button>
              </div>
            )}
          </Card>

          <Card id="about" title={t('关于', 'About')} icon={Info}>
            <div className="flex items-center gap-4 py-4">
              <AppMark size={48} />
              <div>
                <div className="text-base font-semibold text-fg">{t('LuatOS 烧录器', 'LuatOS Flasher')}</div>
                <div className="text-xs text-fg-3">
                  {t('版本', 'Version')} {appInfo?.version ?? '—'} · {appInfo ? `${appInfo.os === 'macos' ? 'macOS' : appInfo.os === 'windows' ? 'Windows' : appInfo.os} · ${appInfo.arch}` : ''}
                </div>
                <div className="mt-1 text-xs text-fg-2">{t('合宙 LuaTools 的现代化替代品，为 LuatOS 模组提供项目管理、烧录与调试。', 'A modern alternative to LuaTools for LuatOS modules.')}</div>
              </div>
            </div>
            <div className="border-t border-line py-3">
              <div className="mb-2 text-xs font-semibold text-fg">{t('开源许可', 'Open-source licenses')}</div>
              <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
                {[
                  ['luatos-cli', 'MIT', t('烧录与打包引擎', 'Flash & packaging engine')],
                  ['Tauri', 'MIT / Apache-2.0', t('桌面应用框架', 'Desktop framework')],
                  ['Lua 5.3（mlua）', 'MIT', t('语法检查', 'Syntax check')],
                  ['rumqttc', 'Apache-2.0', 'MQTT'],
                  ['serialport-rs', 'MPL-2.0', t('串口', 'Serial')],
                  ['React', 'MIT', ''],
                  ['Lucide Icons', 'ISC', ''],
                  ['JetBrains Mono', 'OFL-1.1', ''],
                  ['Tailwind CSS', 'MIT', ''],
                ].map(([n, l, d]) => (
                  <li key={n} className="flex items-center gap-3 px-3 py-2 text-xs">
                    <span className="font-medium text-fg">{n}</span>
                    {d && <span className="text-fg-3">{d}</span>}
                    <Badge className="ml-auto" mono>
                      {l}
                    </Badge>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-2xs text-fg-3">{t('本工具使用 luatos-cli（MIT 协议）。LuatOS、LuaTools 为合宙通信的商标。', 'This tool uses luatos-cli (MIT). LuatOS and LuaTools are trademarks of Openluat.')}</p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
