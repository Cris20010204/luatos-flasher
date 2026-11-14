import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { error as logError } from '@tauri-apps/plugin-log'
import { isTauri } from './lib/api'

// 界面里没捕获的错误也写进日志文件，方便排查
if (isTauri) {
  window.addEventListener('error', (e) => logError(`[ui] ${e.message} @ ${e.filename}:${e.lineno}`).catch(() => {}))
  window.addEventListener('unhandledrejection', (e) => logError(`[ui] unhandled: ${String(e.reason)}`).catch(() => {}))
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
