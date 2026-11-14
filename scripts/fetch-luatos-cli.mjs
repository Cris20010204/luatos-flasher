#!/usr/bin/env node
/**
 * 下载并校验 luatos-cli（wendal/luatos-cli，MIT），放到 src-tauri/binaries/ 供 Tauri 打包成 sidecar。
 *
 *   node scripts/fetch-luatos-cli.mjs                 # 按当前 Rust 主机平台
 *   node scripts/fetch-luatos-cli.mjs x86_64-pc-windows-msvc
 *   node scripts/fetch-luatos-cli.mjs all             # 所有平台
 *   node scripts/fetch-luatos-cli.mjs --from <已下载的压缩包> <target>   # 离线
 *
 * 版本和 SHA-256 固定在下面，升级 luatos-cli 时一起改（digest 来自 GitHub Release 页面）。
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { copyFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const VERSION = '1.11.0'
const ASSETS = {
  'aarch64-apple-darwin': ['luatos-cli-aarch64-apple-darwin.tar.gz', '115891d78052a2dccd2b574c12635b19dc4a794d66f6b4ed029e264c5af32026'],
  'x86_64-apple-darwin': ['luatos-cli-x86_64-apple-darwin.tar.gz', '21df5f7f63c2afafb5ceb377433b826b1a9f5f9fb8f9382cf3f5256ac634b399'],
  'universal-apple-darwin': ['luatos-cli-universal-apple-darwin.tar.gz', 'ecb568d848404b5bdd4328802345f1c57cb51b9ba7eca08d943f2e572ad3f21d'],
  'x86_64-pc-windows-msvc': ['luatos-cli-x86_64-pc-windows-msvc.zip', '9a1dfe126e4989871c8878dc22c417ceaa0721347b1127c316b54e8bd838b884'],
  'aarch64-pc-windows-msvc': ['luatos-cli-aarch64-pc-windows-msvc.zip', '77bfd1943582a5e979b488078892c38e0fec29a8f7943feccbe2291e52e089ca'],
  'x86_64-unknown-linux-gnu': ['luatos-cli-x86_64-unknown-linux-gnu.tar.gz', 'd3e675de6e44122a78edf21bdb67828cade8c515f3c7353472222fdfd0c39840'],
  'aarch64-unknown-linux-gnu': ['luatos-cli-aarch64-unknown-linux-gnu.tar.gz', '14f1cd3888e1e201b04afedd48166c9e0f5ebe7597ef19634a0f051a3a8cdaf6'],
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'src-tauri', 'binaries')

function hostTarget() {
  const out = execFileSync('rustc', ['-vV'], { encoding: 'utf8' })
  return out.match(/^host: (\S+)/m)[1]
}

function findBinary(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      const r = findBinary(p)
      if (r) return r
    } else if (name === 'luatos-cli' || name === 'luatos-cli.exe') return p
  }
  return null
}

async function fetchOne(target, localFile) {
  const asset = ASSETS[target]
  if (!asset) throw new Error(`不支持的平台：${target}（可选：${Object.keys(ASSETS).join(', ')}）`)
  const [file, sha] = asset
  const exe = target.includes('windows') ? '.exe' : ''
  const dest = join(outDir, `luatos-cli-${target}${exe}`)
  let data
  if (localFile) data = readFileSync(localFile)
  else {
    const url = `https://github.com/wendal/luatos-cli/releases/download/v${VERSION}/${file}`
    process.stdout.write(`下载 ${url}\n`)
    const r = await fetch(url)
    if (!r.ok) throw new Error(`下载失败：HTTP ${r.status}`)
    data = Buffer.from(await r.arrayBuffer())
  }
  const got = createHash('sha256').update(data).digest('hex')
  if (got !== sha) throw new Error(`SHA-256 不匹配：${file}\n  期望 ${sha}\n  实际 ${got}`)
  const work = mkdtempSync(join(tmpdir(), 'luatos-cli-'))
  try {
    const archive = join(work, file)
    writeFileSync(archive, data)
    // macOS / Windows 10+ / Linux 自带的 tar（bsdtar）都能解 .tar.gz 和 .zip
    execFileSync('tar', ['-xf', archive, '-C', work])
    const bin = findBinary(work)
    if (!bin) throw new Error(`压缩包里没有 luatos-cli：${file}`)
    mkdirSync(outDir, { recursive: true })
    copyFileSync(bin, dest)
    if (!exe) chmodSync(dest, 0o755)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
  process.stdout.write(`✓ ${dest}（luatos-cli v${VERSION}，SHA-256 已校验）\n`)
}

const args = process.argv.slice(2)
let localFile = null
const fromIdx = args.indexOf('--from')
if (fromIdx >= 0) {
  localFile = args[fromIdx + 1]
  args.splice(fromIdx, 2)
}
const want = args[0] ?? hostTarget()
const targets = want === 'all' ? Object.keys(ASSETS) : [want]
for (const t of targets) {
  if (!localFile && existsSync(join(outDir, `luatos-cli-${t}${t.includes('windows') ? '.exe' : ''}`)) && !args.includes('--force')) {
    process.stdout.write(`已存在，跳过：${t}（加 --force 重新下载）\n`)
    continue
  }
  await fetchOne(t, localFile)
}
