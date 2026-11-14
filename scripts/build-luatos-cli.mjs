#!/usr/bin/env node
/**
 * 从源码编译打过补丁的 luatos-cli（wendal/luatos-cli，MIT），放到 src-tauri/binaries/ 供 Tauri 打包成 sidecar。
 *
 * 为什么不直接用官方发布的二进制：v1.11.0 解 EC718 日志时把 `7D 01` / `7D 02` 按标准 HDLC 还原成 '!' / '"'，
 * 而 EC718 固件实际把 '}'(0x7D) 转成 `7D 01`、'~'(0x7E) 转成 `7D 02`——设备日志里每个 JSON 的 '}' 都会显示成 '!'。
 * 补丁见 scripts/patches/。官方修复后可以改回 `pnpm fetch:cli` 下载官方版本。
 *
 *   node scripts/build-luatos-cli.mjs                       # 按当前 Rust 主机平台
 *   node scripts/build-luatos-cli.mjs x86_64-apple-darwin   # 交叉编译（需先 rustup target add）
 *   node scripts/build-luatos-cli.mjs --test                # 编译前先跑 luatos-log 的单元测试
 *
 * 源码放在 .cache/luatos-cli-src（不进 git），版本固定在下面的 TAG / COMMIT。
 * 网络经过代理的坑（git / cargo 连不上）见 README。
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_PATH = 'wendal/luatos-cli'
const REPO = `https://github.com/${REPO_PATH}`
const TAG = 'v1.11.0'
const COMMIT = '22a8f952395acd6b9fb8875db0aa66714207178a'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, '.cache', 'luatos-cli-src')
const patchDir = join(root, 'scripts', 'patches')
const outDir = join(root, 'src-tauri', 'binaries')

const args = process.argv.slice(2)
const runTests = args.includes('--test')
const target = args.find((a) => !a.startsWith('--')) ?? hostTarget()

function hostTarget() {
  return execFileSync('rustc', ['-vV'], { encoding: 'utf8' }).match(/^host: (\S+)/m)[1]
}
function run(cmd, argv, opts = {}) {
  console.log(`$ ${cmd} ${argv.join(' ')}`)
  execFileSync(cmd, argv, { stdio: 'inherit', ...opts })
}
function ok(cmd, argv, opts = {}) {
  try {
    execFileSync(cmd, argv, { stdio: 'ignore', ...opts })
    return true
  } catch {
    return false
  }
}

// 1. 源码：没有就克隆固定的 tag，并核对 commit
if (!existsSync(join(src, 'Cargo.toml'))) {
  mkdirSync(dirname(src), { recursive: true })
  run('git', ['clone', '--depth', '1', '--branch', TAG, REPO, src])
}
const head = execFileSync('git', ['-C', src, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
if (head !== COMMIT) {
  console.error(`✗ ${src} 的版本是 ${head}，应为 ${TAG}（${COMMIT}）。删掉这个目录重新运行。`)
  process.exit(1)
}

// 2. 打补丁（已经打过的跳过；打不上说明源码被改过）
const patches = readdirSync(patchDir).filter((f) => f.startsWith(`luatos-cli-${TAG}-`) && f.endsWith('.patch')).sort()
for (const p of patches) {
  const file = join(patchDir, p)
  if (ok('git', ['-C', src, 'apply', '--reverse', '--check', file])) {
    console.log(`· 补丁已打过：${p}`)
    continue
  }
  if (!ok('git', ['-C', src, 'apply', '--check', file])) {
    console.error(`✗ 补丁打不上：${p}。${src} 里可能有别的改动，用 git -C ${src} diff 查看，或删掉目录重新运行。`)
    process.exit(1)
  }
  run('git', ['-C', src, 'apply', file])
}

// 3. Git LFS：仓库把 *.bin 等放在 LFS 里，没装 git-lfs 时克隆下来的只是 130 字节左右的指针文本。
//    EC718/EC618 的 AgentBoot 是 include_bytes! 编进程序的，拿指针编译出来的 luatos-cli 刷机时会在写第一个分区时
//    报 “Broken pipe”（2026-11-14 踩过）。这里找出所有 include_bytes!("...") 引用的文件，是 LFS 指针就从 GitHub 下载真文件，
//    并按指针里的 SHA-256 和大小核对。
await fetchLfsObjects()

async function fetchLfsObjects() {
  const want = new Set()
  for (const f of rsFiles(join(src, 'crates'))) {
    for (const m of readFileSync(f, 'utf8').matchAll(/include_bytes!\(\s*"([^"]+)"\s*\)/g)) {
      want.add(relative(src, resolve(dirname(f), m[1])).split(sep).join('/'))
    }
  }
  let fetched = 0
  for (const path of [...want].sort()) {
    let blob
    try {
      blob = execFileSync('git', ['-C', src, 'show', `HEAD:${path}`], { stdio: ['ignore', 'pipe', 'ignore'] })
    } catch {
      continue // 不在仓库里（编译时生成的），不管
    }
    const m = blob.toString('latin1').match(/^version https:\/\/git-lfs\.github\.com\/spec\/v1\noid sha256:([0-9a-f]{64})\nsize (\d+)\n?$/)
    if (!m) continue
    const [, oid, size] = m
    const file = join(src, path)
    if (existsSync(file) && sha256(readFileSync(file)) === oid) continue
    const url = `https://media.githubusercontent.com/media/${REPO_PATH}/${COMMIT}/${path.split('/').map(encodeURIComponent).join('/')}`
    console.log(`↓ Git LFS：${path}（${size} 字节）`)
    const res = await fetch(url)
    if (!res.ok) {
      console.error(`✗ 下载失败（HTTP ${res.status}）：${url}\n  也可以装 git-lfs 后在 ${src} 里运行 git lfs pull`)
      process.exit(1)
    }
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length !== Number(size) || sha256(buf) !== oid) {
      console.error(`✗ ${path} 下载的内容和 LFS 指针对不上（${buf.length} 字节，sha256 ${sha256(buf)}）`)
      process.exit(1)
    }
    writeFileSync(file, buf)
    fetched++
  }
  console.log(`· Git LFS：核对了 include_bytes! 引用的 ${want.size} 个文件${fetched ? `，下载 ${fetched} 个` : ''}`)
}
function rsFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name)
    if (e.isDirectory()) return e.name === 'target' ? [] : rsFiles(p)
    return e.name.endsWith('.rs') ? [p] : []
  })
}
function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

// 4. 测试（可选）与编译
if (runTests) run('cargo', ['test', '--locked', '-p', 'luatos-log', '-p', 'luatos-flash', '--lib'], { cwd: src })
const host = hostTarget()
const buildArgs = ['build', '--release', '--locked', '-p', 'luatos-cli']
if (target !== host) buildArgs.push('--target', target)
run('cargo', buildArgs, { cwd: src })

// 5. 按 Tauri sidecar 的命名放好：binaries/luatos-cli-<target>[.exe]
const exe = target.includes('windows') ? '.exe' : ''
const built = join(src, 'target', target !== host ? target : '', 'release', `luatos-cli${exe}`)
mkdirSync(outDir, { recursive: true })
const dest = join(outDir, `luatos-cli-${target}${exe}`)
copyFileSync(built, dest)
if (!exe) chmodSync(dest, 0o755)
const ver = execFileSync(dest, ['--version'], { encoding: 'utf8' }).trim()
console.log(`✓ ${dest}\n  ${ver}（${TAG} + ${patches.length} 个补丁）`)
