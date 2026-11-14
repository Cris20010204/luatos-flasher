#!/usr/bin/env node
/**
 * 生成 README 里的界面截图（docs/images/*.png）。
 *
 *   pnpm dev                       # 先在另一个终端启动前端（默认 http://localhost:1420）
 *   node scripts/screenshots.mjs   # 用本机 Chrome 的无界面模式按演示数据截图
 *
 * 环境变量：BASE（前端地址）、CHROME（Chrome 可执行文件路径）、SCALE（清晰度倍数，默认 1.5）。
 * 截图用的是演示模式（src/lib/demo.ts）的假数据，不需要接模组。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'docs', 'images')
const BASE = process.env.BASE ?? 'http://localhost:1420'
const SCALE = process.env.SCALE ?? '1.5'
const CHROME =
  process.env.CHROME ??
  [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].find((p) => existsSync(p))

if (!CHROME) {
  console.error('✗ 没找到 Chrome，用 CHROME=/path/to/chrome 指定')
  process.exit(1)
}

// [文件名, 网址参数, 等待毫秒（演示数据里的定时器按虚拟时间推进）]
const SHOTS = [
  ['projects', 'page=projects&project=demo-hello&theme=light', 1500],
  ['code', 'page=code&project=demo-hello&file=main.lua&dock=bottom&theme=light', 6000],
  ['flash', 'page=code&project=demo-hello&file=main.lua&flash=full&theme=light', 4200],
  ['devlog', 'page=logs&project=demo-hello&theme=light', 9000],
  ['mqtt', 'page=mqtt&project=demo-hello&mqtt=1&theme=light', 9000],
  ['firmware', 'page=firmware&project=demo-hello&theme=light', 2000],
  ['code-dark', 'page=code&project=demo-hello&file=main.lua&theme=dark', 2500],
]

mkdirSync(out, { recursive: true })
for (const [name, query, wait] of SHOTS) {
  const profile = mkdtempSync(join(tmpdir(), 'luatos-flasher-shot-'))
  const file = join(out, `${name}.png`)
  execFileSync(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      `--user-data-dir=${profile}`,
      '--window-size=1440,900',
      `--force-device-scale-factor=${SCALE}`,
      `--virtual-time-budget=${wait}`,
      `--screenshot=${file}`,
      `${BASE}/?demo&${query}`,
    ],
    { stdio: 'ignore' },
  )
  rmSync(profile, { recursive: true, force: true })
  console.log(`✓ ${name}.png  ${(statSync(file).size / 1024).toFixed(0)} KB`)
}
