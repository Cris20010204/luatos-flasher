#!/usr/bin/env node
/**
 * 冒烟测试：在 Node 里用 React 服务端渲染把整个界面渲染一遍（8 个页面都会挂载），
 * 用来发现组件里的运行时错误。不需要浏览器，也不需要 Tauri 后端（isTauri=false 时接口直接报错，界面显示空状态）。
 *   node scripts/smoke-render.mjs
 * 另外把设备日志面板（下方 / 右侧 / 悬浮）各渲染一遍。
 */
import { createServer } from 'vite'
import React from 'react'
import { renderToString } from 'react-dom/server'

const store = new Map()
globalThis.window = globalThis
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' })
try {
  const App = (await vite.ssrLoadModule('/src/App.tsx')).default
  const html = renderToString(React.createElement(App))
  const must = ['项目管理', '未打开项目', '快速烧录', '4G 模块 USB 打印', '串口配置', '订阅', '开始下载（非刷机）', '环境诊断']
  const missing = must.filter((s) => !html.includes(s))
  if (missing.length) {
    console.error('渲染结果缺少：', missing)
    process.exitCode = 1
  } else console.log(`✓ 界面渲染成功（${(html.length / 1024).toFixed(0)} KB HTML，8 个页面都已挂载）`)
  // 设备日志面板：下方、右侧、悬浮各渲染一遍
  for (const side of ['bottom', 'right', 'float']) {
    store.set('fw.logDock', JSON.stringify({ open: true, side, size: 260 }))
    const h = renderToString(React.createElement(App))
    if (!h.includes('拖动调整大小')) {
      console.error(`✗ 日志面板（${side}）没有渲染出来`)
      process.exitCode = 1
    } else console.log(`✓ 日志面板${{ bottom: '停靠在下方', right: '停靠在右侧', float: '悬浮' }[side]}时渲染成功`)
  }
} catch (e) {
  console.error('✗ 渲染失败：', e)
  process.exitCode = 1
} finally {
  await vite.close()
}
