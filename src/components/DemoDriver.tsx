import { useEffect, useRef } from 'react'
import { useApp, type TaskKind } from '../store'
import { demoParam } from '../lib/demo'

/** 演示模式：按网址参数打开文件、自动开始下载（见 src/lib/demo.ts 顶部的参数说明） */
export function DemoDriver() {
  const { project, openFile, requestDownload, pending, confirmPending } = useApp()
  const opened = useRef(false)
  const flashed = useRef(false)

  useEffect(() => {
    if (!project || opened.current) return
    opened.current = true
    const file = demoParam('file')
    if (file) openFile(file)
    const flash = demoParam('flash')
    if (flash) setTimeout(() => requestDownload(flash as TaskKind), 500)
  }, [project]) // eslint-disable-line react-hooks/exhaustive-deps

  // 下载前的确认框直接确认
  useEffect(() => {
    if (pending && demoParam('flash') && !flashed.current) {
      flashed.current = true
      setTimeout(confirmPending, 300)
    }
  }, [pending, confirmPending])

  return null
}
