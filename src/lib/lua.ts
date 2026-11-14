export type TokType = 'kw' | 'str' | 'num' | 'com' | 'fn' | 'lib' | 'key' | 'id' | 'punc' | 'ws'

export interface Tok {
  t: TokType
  v: string
  line: number
  /** set on quoted strings that hit end of line before closing */
  open?: boolean
}

const KEYWORDS = new Set([
  'and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'goto', 'if', 'in',
  'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while',
])

const LIBS = new Set([
  'sys', 'sysplus', 'log', 'mqtt', 'json', 'gpio', 'pwm', 'mobile', 'socket', 'wdt', 'adc', 'uart',
  'fskv', 'rtos', 'pm', 'string', 'table', 'math', 'os', 'io', 'require', 'print', 'pairs', 'ipairs',
  'tostring', 'tonumber', 'type', 'pcall', 'crypto', 'libnet', 'http', 'audio', 'zbuff', 'i2c', 'spi',
  'fs', 'mcu', 'netdrv', 'ftp', 'lcd', 'lvgl', 'self', 'PROJECT', 'VERSION',
])

export function tokenize(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  let line = 1
  const n = src.length
  const push = (t: TokType, v: string, extra?: Partial<Tok>) => {
    out.push({ t, v, line, ...extra })
    for (let k = 0; k < v.length; k++) if (v.charCodeAt(k) === 10) line++
  }
  while (i < n) {
    const c = src[i]
    // whitespace
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      let j = i
      while (j < n && (src[j] === ' ' || src[j] === '\t' || src[j] === '\n' || src[j] === '\r')) j++
      push('ws', src.slice(i, j))
      i = j
      continue
    }
    // comments
    if (c === '-' && src[i + 1] === '-') {
      const long = /^--\[(=*)\[/.exec(src.slice(i, i + 12))
      if (long) {
        const close = ']' + long[1] + ']'
        const end = src.indexOf(close, i + long[0].length)
        const j = end === -1 ? n : end + close.length
        push('com', src.slice(i, j))
        i = j
        continue
      }
      let j = src.indexOf('\n', i)
      if (j === -1) j = n
      push('com', src.slice(i, j))
      i = j
      continue
    }
    // long strings
    if (c === '[' && (src[i + 1] === '[' || src[i + 1] === '=')) {
      const long = /^\[(=*)\[/.exec(src.slice(i, i + 10))
      if (long) {
        const close = ']' + long[1] + ']'
        const end = src.indexOf(close, i + long[0].length)
        const j = end === -1 ? n : end + close.length
        push('str', src.slice(i, j))
        i = j
        continue
      }
    }
    // quoted strings
    if (c === '"' || c === "'") {
      let j = i + 1
      let closed = false
      while (j < n) {
        if (src[j] === '\\') {
          j += 2
          continue
        }
        if (src[j] === '\n') break
        if (src[j] === c) {
          j++
          closed = true
          break
        }
        j++
      }
      push('str', src.slice(i, j), closed ? undefined : { open: true })
      i = j
      continue
    }
    // numbers
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^(0[xX][0-9a-fA-F]+|[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?)/.exec(src.slice(i))
      const v = m ? m[0] : c
      push('num', v)
      i += v.length
      continue
    }
    // identifiers
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1
      while (j < n && /[A-Za-z0-9_]/.test(src[j])) j++
      const v = src.slice(i, j)
      let t: TokType = 'id'
      if (KEYWORDS.has(v)) t = 'kw'
      else {
        let k = j
        while (k < n && (src[k] === ' ' || src[k] === '\t')) k++
        const prev = lastSignificant(out)
        const isField = prev && prev.t === 'punc' && (prev.v === '.' || prev.v === ':')
        if (src[k] === '(' || src[k] === '"' || (src[k] === '{' && isField)) t = 'fn'
        else if (!isField && LIBS.has(v)) t = 'lib'
        else if (src[k] === '=' && src[k + 1] !== '=' && isTableKey(out)) t = 'key'
      }
      push(t, v)
      i = j
      continue
    }
    // punctuation / operators
    const three = src.slice(i, i + 3)
    const two = src.slice(i, i + 2)
    if (three === '...') {
      push('punc', three)
      i += 3
    } else if (['==', '~=', '<=', '>=', '..', '::', '//'].includes(two)) {
      push('punc', two)
      i += 2
    } else {
      push('punc', c)
      i++
    }
  }
  return out
}

function lastSignificant(toks: Tok[]): Tok | undefined {
  for (let k = toks.length - 1; k >= 0; k--) {
    if (toks[k].t !== 'ws' && toks[k].t !== 'com') return toks[k]
  }
  return undefined
}

function isTableKey(toks: Tok[]): boolean {
  const prev = lastSignificant(toks)
  return !!prev && prev.t === 'punc' && (prev.v === '{' || prev.v === ',')
}

/** Split a token stream into per-line arrays, cutting multi-line tokens. */
export function toLines(src: string): { t: TokType; v: string }[][] {
  const toks = tokenize(src)
  const lines: { t: TokType; v: string }[][] = [[]]
  for (const tok of toks) {
    const parts = tok.v.split('\n')
    parts.forEach((p, idx) => {
      if (idx > 0) lines.push([])
      if (p) lines[lines.length - 1].push({ t: tok.t, v: p })
    })
  }
  return lines
}

export interface Diagnostic {
  file: string
  line: number
  severity: 'error' | 'warning'
  zh: string
  en: string
  raw: string
}

const CLOSERS: Record<string, string> = { ')': '(', ']': '[', '}': '{' }

export function checkLua(file: string, src: string): Diagnostic[] {
  const toks = tokenize(src).filter((t) => t.t !== 'ws' && t.t !== 'com')
  const diags: Diagnostic[] = []
  const err = (line: number, zh: string, en: string, raw: string) =>
    diags.push({ file, line, severity: 'error', zh, en, raw: `${file}:${line}: ${raw}` })

  const blocks: { kw: string; line: number }[] = []
  const brackets: { ch: string; line: number }[] = []
  let pendingLoop: { kw: string; line: number } | null = null

  for (const tk of toks) {
    if (tk.t === 'str' && tk.open) {
      err(tk.line, `字符串未闭合：${tk.v.slice(0, 16)}`, `unfinished string near '${tk.v.slice(0, 16)}'`, `unfinished string near '${tk.v.slice(0, 16)}'`)
      return diags
    }
    if (tk.t === 'kw') {
      if (tk.v === 'function' || tk.v === 'if' || tk.v === 'repeat') blocks.push({ kw: tk.v, line: tk.line })
      else if (tk.v === 'for' || tk.v === 'while') pendingLoop = { kw: tk.v, line: tk.line }
      else if (tk.v === 'do') {
        blocks.push(pendingLoop ?? { kw: 'do', line: tk.line })
        pendingLoop = null
      } else if (tk.v === 'end') {
        const top = blocks.pop()
        if (!top || top.kw === 'repeat') {
          err(tk.line, `多余的 'end'`, `'<eof>' expected near 'end'`, `'<eof>' expected near 'end'`)
          return diags
        }
      } else if (tk.v === 'until') {
        const top = blocks.pop()
        if (!top || top.kw !== 'repeat') {
          err(tk.line, `'until' 没有对应的 'repeat'`, `unexpected 'until'`, `'end' expected near 'until'`)
          return diags
        }
      }
    } else if (tk.t === 'punc') {
      if (tk.v === '(' || tk.v === '[' || tk.v === '{') brackets.push({ ch: tk.v, line: tk.line })
      else if (CLOSERS[tk.v]) {
        const top = brackets.pop()
        if (!top || top.ch !== CLOSERS[tk.v]) {
          err(tk.line, `意外的符号 '${tk.v}'`, `unexpected symbol near '${tk.v}'`, `unexpected symbol near '${tk.v}'`)
          return diags
        }
      }
    }
  }
  if (brackets.length) {
    const b = brackets[brackets.length - 1]
    const close = b.ch === '(' ? ')' : b.ch === '[' ? ']' : '}'
    err(b.line, `缺少 '${close}'（用于闭合第 ${b.line} 行的 '${b.ch}'）`, `'${close}' expected (to close '${b.ch}' at line ${b.line})`, `'${close}' expected (to close '${b.ch}' at line ${b.line}) near <eof>`)
  } else if (blocks.length) {
    const b = blocks[blocks.length - 1]
    const need = b.kw === 'repeat' ? 'until' : 'end'
    err(b.line, `缺少 '${need}'（用于闭合第 ${b.line} 行的 '${b.kw}'）`, `'${need}' expected (to close '${b.kw}' at line ${b.line})`, `'${need}' expected (to close '${b.kw}' at line ${b.line}) near <eof>`)
  }

  // unused locals (luacheck-style warning)
  const idCount = new Map<string, number>()
  toks.forEach((tk, idx) => {
    if (tk.t !== 'id' && tk.t !== 'lib' && tk.t !== 'fn' && tk.t !== 'key') return
    const prev = toks[idx - 1]
    if (prev && prev.t === 'punc' && (prev.v === '.' || prev.v === ':')) return
    idCount.set(tk.v, (idCount.get(tk.v) ?? 0) + 1)
  })
  toks.forEach((tk, idx) => {
    if (tk.t !== 'kw' || tk.v !== 'local') return
    let k = idx + 1
    while (k < toks.length) {
      const nm = toks[k]
      if (nm.t === 'kw') break
      if (nm.t === 'id' || nm.t === 'lib' || nm.t === 'fn') {
        if (nm.v !== '_' && (idCount.get(nm.v) ?? 0) <= 1) {
          diags.push({
            file,
            line: nm.line,
            severity: 'warning',
            zh: `未使用的局部变量 '${nm.v}'`,
            en: `unused variable '${nm.v}'`,
            raw: `${file}:${nm.line}: unused variable '${nm.v}'`,
          })
        }
        const sep = toks[k + 1]
        if (sep && sep.t === 'punc' && sep.v === ',') {
          k += 2
          continue
        }
      }
      break
    }
  })
  return diags
}
