import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { toLines, type Diagnostic, type TokType } from '../lib/lua'
import { cx } from '../lib/format'

const LH = 20
const PAD_T = 8
const PAD_L = 14
const MINI_LH = 3
/**
 * 只渲染可见区附近的行，按 CHUNK 行一段：滚动没跨段时不重渲染，只改 transform。
 * 以前每个 scroll 事件都 setState，整份文件的行号、高亮、缩略图全部重算：150 行约 4.5 ms、800 行约 196 ms（开发版实测），
 * 滚动一卡一卡。
 */
const CHUNK = 40

type Toks = { t: TokType; v: string }[]

// a jump request should be applied once, not again when the editor remounts
let lastJumpNonce = 0

const TOK_CLASS: Record<TokType, string> = {
  kw: 'text-syn-kw',
  str: 'text-syn-str',
  num: 'text-syn-num',
  com: 'text-syn-com italic',
  fn: 'text-syn-fn',
  lib: 'text-syn-lib',
  key: 'text-syn-key',
  id: 'text-fg',
  punc: 'text-syn-punc',
  ws: '',
}
const TOK_VAR: Record<TokType, string> = {
  kw: 'var(--syn-kw)',
  str: 'var(--syn-str)',
  num: 'var(--syn-num)',
  com: 'var(--syn-com)',
  fn: 'var(--syn-fn)',
  lib: 'var(--syn-lib)',
  key: 'var(--syn-key)',
  id: 'var(--fg-2)',
  punc: 'var(--syn-punc)',
  ws: 'transparent',
}

export function LuaEditor({
  value,
  onChange,
  onSave,
  diags,
  jump,
  onCursor,
}: {
  value: string
  onChange: (v: string) => void
  onSave: () => void
  diags: Diagnostic[]
  jump?: { line: number; nonce: number } | null
  onCursor?: (line: number, col: number) => void
}) {
  const taRef = useRef<HTMLTextAreaElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)
  const decoRef = useRef<HTMLDivElement>(null)
  const preRef = useRef<HTMLPreElement>(null)
  const miniViewRef = useRef<HTMLDivElement>(null)
  // 滚动位置不放进 state：scroll 事件里直接改几个图层的 transform，不触发 React 渲染
  const scroll = useRef({ top: 0, left: 0 })
  const [chunk, setChunk] = useState(0)
  const [viewH, setViewH] = useState(600)
  const [curLine, setCurLine] = useState(1)
  const [focused, setFocused] = useState(false)

  const lines = useMemo(() => toLines(value), [value])
  // 父组件每次渲染都会传一个新的 diags 数组，按内容比较，内容没变就不重算
  const diagKey = diags.map((d) => `${d.line}\u0000${d.severity}\u0000${d.raw}`).join('\u0001')
  const diagByLine = useMemo(() => {
    const m = new Map<number, Diagnostic>()
    diags.forEach((d) => {
      const prev = m.get(d.line)
      if (!prev || (prev.severity === 'warning' && d.severity === 'error')) m.set(d.line, d)
    })
    return m
  }, [diagKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const miniScale = MINI_LH / LH
  const rows = Math.ceil(viewH / LH) + 1
  const end = Math.min(lines.length, chunk * CHUNK + rows + 2 * CHUNK)
  const start = Math.min(Math.max(0, (chunk - 1) * CHUNK), end)

  const applyScroll = () => {
    const { top, left } = scroll.current
    if (gutterRef.current) gutterRef.current.style.transform = `translateY(${-top}px)`
    if (decoRef.current) decoRef.current.style.transform = `translateY(${-top}px)`
    if (preRef.current) preRef.current.style.transform = `translate(${-left}px, ${-top}px)`
    if (miniViewRef.current) miniViewRef.current.style.transform = `translateY(${top * miniScale}px)`
  }
  // 重新渲染（换段、改内容）后，新挂上的节点也要对齐到当前滚动位置
  useLayoutEffect(applyScroll)

  const onScroll = () => {
    const ta = taRef.current
    if (!ta) return
    scroll.current = { top: ta.scrollTop, left: ta.scrollLeft }
    applyScroll()
    setChunk(Math.floor(Math.max(0, ta.scrollTop - PAD_T) / LH / CHUNK)) // 值没变时 React 不会重渲染
  }

  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setViewH(el.clientHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (!jump || !taRef.current || jump.nonce === lastJumpNonce) return
    lastJumpNonce = jump.nonce
    const ta = taRef.current
    const all = value.split('\n')
    const ln = Math.min(Math.max(1, jump.line), all.length)
    let off = 0
    for (let i = 0; i < ln - 1; i++) off += all[i].length + 1
    const indent = all[ln - 1].match(/^\s*/)?.[0].length ?? 0
    ta.focus()
    ta.setSelectionRange(off + indent, off + all[ln - 1].length)
    ta.scrollTop = Math.max(0, (ln - 1) * LH - ta.clientHeight / 3)
    setCurLine(ln)
    onCursor?.(ln, indent + 1)
  }, [jump?.nonce]) // eslint-disable-line react-hooks/exhaustive-deps

  const reportCursor = () => {
    const ta = taRef.current
    if (!ta) return
    const before = ta.value.slice(0, ta.selectionStart)
    const ln = before.split('\n').length
    const col = ta.selectionStart - before.lastIndexOf('\n')
    setCurLine(ln)
    onCursor?.(ln, col)
  }

  const insert = (text: string) => {
    const ta = taRef.current!
    // execCommand keeps the native undo stack intact
    if (!document.execCommand('insertText', false, text)) {
      const { selectionStart: s, selectionEnd: e } = ta
      const next = ta.value.slice(0, s) + text + ta.value.slice(e)
      onChange(next)
      requestAnimationFrame(() => ta.setSelectionRange(s + text.length, s + text.length))
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault()
      onSave()
      return
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      insert('    ')
      return
    }
    if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
      const ta = e.currentTarget
      const before = ta.value.slice(0, ta.selectionStart)
      const lineText = before.slice(before.lastIndexOf('\n') + 1)
      const indent = lineText.match(/^\s*/)?.[0] ?? ''
      const opens = /(\bthen|\bdo|\belse|\bfunction\s*[\w.:]*\s*\([^)]*\)|\brepeat|[{(])\s*$/.test(lineText.replace(/--.*$/, ''))
      e.preventDefault()
      insert('\n' + indent + (opens ? '    ' : ''))
    }
  }

  const miniViewH = Math.max(14, viewH * miniScale)

  return (
    <div className="flex h-full min-h-0 bg-editor">
      {/* gutter */}
      <div className="relative w-[52px] shrink-0 overflow-hidden border-r border-line/60 select-none" aria-hidden>
        <div ref={gutterRef} className="will-change-transform" style={{ paddingTop: PAD_T }}>
          <Gutter start={start} end={end} diagByLine={diagByLine} curLine={curLine} />
        </div>
      </div>

      {/* code */}
      <div ref={boxRef} className="relative min-w-0 flex-1 overflow-hidden">
        {/* line decorations */}
        <div ref={decoRef} className="pointer-events-none absolute inset-0 will-change-transform">
          {focused && <div className="absolute right-0 left-0 bg-hover" style={{ top: PAD_T + (curLine - 1) * LH, height: LH }} />}
          {[...diagByLine.values()].map((d) => (
            <div key={d.line} className={cx('absolute right-0 left-0', d.severity === 'error' ? 'bg-err-soft' : 'bg-warn-soft/60')} style={{ top: PAD_T + (d.line - 1) * LH, height: LH }} />
          ))}
        </div>
        <pre
          ref={preRef}
          className="pointer-events-none absolute top-0 left-0 m-0 font-mono text-[12.5px] whitespace-pre will-change-transform"
          style={{ padding: `${PAD_T}px ${PAD_L}px`, tabSize: 4, lineHeight: `${LH}px`, fontVariantLigatures: 'none' }}
          aria-hidden
        >
          <CodeLines lines={lines} start={start} end={end} diagByLine={diagByLine} />
        </pre>
        <textarea
          ref={taRef}
          value={value}
          onChange={(e) => {
            onChange(e.target.value)
            reportCursor()
          }}
          onScroll={onScroll}
          onKeyDown={onKeyDown}
          onKeyUp={reportCursor}
          onClick={reportCursor}
          onSelect={reportCursor}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          wrap="off"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          aria-label="Lua editor"
          className="scroll-thin absolute inset-0 m-0 h-full w-full resize-none overflow-auto border-0 bg-transparent font-mono text-[12.5px] whitespace-pre text-transparent caret-[var(--fg)] outline-none selection:bg-primary/25"
          style={{ padding: `${PAD_T}px ${PAD_L}px`, lineHeight: `${LH}px`, tabSize: 4, fontVariantLigatures: 'none' }}
        />
      </div>

      {/* minimap */}
      <div
        className="relative w-[92px] shrink-0 cursor-default overflow-hidden border-l border-line/60 bg-editor"
        onMouseDown={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          const y = e.clientY - rect.top
          const ta = taRef.current
          if (ta) ta.scrollTop = Math.max(0, y / miniScale - viewH / 2)
        }}
        aria-hidden
      >
        <Minimap lines={lines} diagByLine={diagByLine} maxRows={Math.ceil(viewH / MINI_LH) + 1} />
        <div
          ref={miniViewRef}
          className="pointer-events-none absolute top-2 right-0 left-0 border-y border-line-strong/40 bg-fg/[0.06] will-change-transform"
          style={{ height: miniViewH }}
        />
      </div>
    </div>
  )
}

const wavy = (d: Diagnostic) => ({
  textDecorationLine: 'underline',
  textDecorationStyle: 'wavy' as const,
  textDecorationColor: d.severity === 'error' ? 'var(--err)' : 'var(--warn)',
  textUnderlineOffset: 4,
  textDecorationSkipInk: 'none' as const,
})

/** 行号：只画 start..end，上面用空白撑出位置 */
const Gutter = memo(function Gutter({ start, end, diagByLine, curLine }: { start: number; end: number; diagByLine: Map<number, Diagnostic>; curLine: number }) {
  const rows = []
  for (let i = start; i < end; i++) {
    const d = diagByLine.get(i + 1)
    rows.push(
      <div
        key={i}
        className={cx('relative flex items-center justify-end pr-3 font-mono text-[11.5px]', i + 1 === curLine ? 'text-fg' : 'text-fg-3/80')}
        style={{ height: LH }}
        title={d ? d.raw : undefined}
      >
        {d && <span className={cx('absolute left-1.5 size-1.5 rounded-full', d.severity === 'error' ? 'bg-err' : 'bg-warn')} />}
        {i + 1}
      </div>,
    )
  }
  return (
    <>
      {start > 0 && <div style={{ height: start * LH }} />}
      {rows}
    </>
  )
})

/** 高亮后的代码：只画 start..end */
const CodeLines = memo(function CodeLines({ lines, start, end, diagByLine }: { lines: Toks[]; start: number; end: number; diagByLine: Map<number, Diagnostic> }) {
  const rows = []
  for (let i = start; i < end; i++) rows.push(<CodeLine key={i} toks={lines[i]} d={diagByLine.get(i + 1)} />)
  return (
    <>
      {start > 0 && <div style={{ height: start * LH }} />}
      {rows}
    </>
  )
})

const sameToks = (a: Toks, b: Toks) => a === b || (a.length === b.length && a.every((tk, i) => tk.t === b[i].t && tk.v === b[i].v))

/**
 * 一行代码。每次输入都会重新分词、得到新数组，这里按内容比较，没变的行不重渲染：
 * 打字时只重画改动的那几行，滚动换段时只挂上新进入窗口的行。
 */
const CodeLine = memo(
  function CodeLine({ toks, d }: { toks: Toks; d?: Diagnostic }) {
    return (
      <div style={{ height: LH }}>
        <span style={d ? wavy(d) : undefined}>
          {toks.map((tk, j) => (
            <span key={j} className={TOK_CLASS[tk.t]}>
              {tk.v}
            </span>
          ))}
        </span>
        {toks.length === 0 && ' '}
      </div>
    )
  },
  (a, b) => a.d === b.d && sameToks(a.toks, b.toks),
)

/** 缩略图：只在内容变化时重画；超出面板高度的行本来就看不见，不画 */
const Minimap = memo(function Minimap({ lines, diagByLine, maxRows }: { lines: Toks[]; diagByLine: Map<number, Diagnostic>; maxRows: number }) {
  return (
    <div className="pt-2 pl-2" style={{ height: lines.length * MINI_LH + 8 }}>
      {lines.slice(0, maxRows).map((toks, i) => (
        <MiniLine key={i} toks={toks} d={diagByLine.get(i + 1)} />
      ))}
    </div>
  )
})

const MiniLine = memo(
  function MiniLine({ toks, d }: { toks: Toks; d?: Diagnostic }) {
    return (
      <div className="flex overflow-hidden" style={{ height: MINI_LH, background: d ? (d.severity === 'error' ? 'var(--err-soft)' : 'var(--warn-soft)') : undefined }}>
        {toks.map((tk, j) => (
          <span
            key={j}
            className="mt-px shrink-0"
            style={{
              width: Math.min(80, tk.v.replace(/\t/g, '    ').length * 1.1),
              height: 2,
              background: tk.t === 'ws' ? 'transparent' : TOK_VAR[tk.t],
              opacity: tk.t === 'com' ? 0.5 : 0.75,
            }}
          />
        ))}
      </div>
    )
  },
  (a, b) => a.d === b.d && sameToks(a.toks, b.toks),
)
