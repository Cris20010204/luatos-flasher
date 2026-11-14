import { AppProvider, useApp, type Page } from './store'
import { Sidebar, StatusBar, TitleBar, Toolbar } from './components/shell'
import { ConfirmDialog, DownloadConfirm, NewProjectWizard, TaskDialog, Toasts } from './components/overlays'
import ProjectsPage from './pages/Projects'
import CodePage from './pages/Code'
import QuickFlashPage from './pages/QuickFlash'
import DeviceLogPage from './pages/DeviceLog'
import SerialPage from './pages/Serial'
import MqttPage from './pages/Mqtt'
import FirmwarePage from './pages/Firmware'
import SettingsPage from './pages/Settings'
import { cx } from './lib/format'
import { DevlogProvider, useLogDock } from './devlog'
import { DemoDriver } from './components/DemoDriver'
import { isDemo } from './lib/demo'
import { LogDock } from './components/LogDock'

const PAGES: Record<Page, () => React.ReactElement> = {
  projects: ProjectsPage,
  code: CodePage,
  flash: QuickFlashPage,
  logs: DeviceLogPage,
  serial: SerialPage,
  mqtt: MqttPage,
  firmware: FirmwarePage,
  settings: SettingsPage,
}

function Window() {
  const { page } = useApp()
  const { dock } = useLogDock()
  // 设备日志页本身就是日志，不再叠一个面板
  const showDock = dock.open && page !== 'logs'
  return (
    <div className="h-full w-full">
      <div className="app-window relative flex flex-col overflow-hidden bg-bg text-fg">
        <TitleBar />
        <Toolbar />
        <div className="flex min-h-0 flex-1">
          <Sidebar />
          <main className={cx('relative flex min-w-0 flex-1', dock.side === 'bottom' ? 'flex-col' : 'flex-row')}>
            <div className="relative min-h-0 min-w-0 flex-1">
              {/* Pages stay mounted so streams, buffers and form state survive navigation */}
              {(Object.keys(PAGES) as Page[]).map((id) => {
                const P = PAGES[id]
                return (
                  <div key={id} className={cx('absolute inset-0', page === id ? 'block' : 'hidden')}>
                    <P />
                  </div>
                )
              })}
            </div>
            {showDock && <LogDock />}
          </main>
        </div>
        <StatusBar />
        <Toasts />
        <DownloadConfirm />
        <TaskDialog />
        <NewProjectWizard />
        <ConfirmDialog />
        {isDemo && <DemoDriver />}
      </div>
    </div>
  )
}

export default function App() {
  return (
    <AppProvider>
      <DevlogProvider>
        <Window />
      </DevlogProvider>
    </AppProvider>
  )
}
