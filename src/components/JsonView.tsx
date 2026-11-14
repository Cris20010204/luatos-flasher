import { cx } from '../lib/format'

const RE = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}[\],:])/g

export function prettyJson(text: string): string | null {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return null
  }
}

/** Lightweight JSON syntax highlighter; falls back to plain text for non-JSON payloads. */
export function JsonView({ text, pretty = true, className }: { text: string; pretty?: boolean; className?: string }) {
  const p = pretty ? prettyJson(text) : text
  const src = p ?? text
  const isJson = p !== null || !pretty
  if (!isJson) return <pre className={cx('font-mono text-[11.5px] leading-[18px] break-all whitespace-pre-wrap text-fg', className)}>{text}</pre>
  const out: React.ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  RE.lastIndex = 0
  let k = 0
  while ((m = RE.exec(src))) {
    if (m.index > last) out.push(src.slice(last, m.index))
    if (m[1]) {
      out.push(
        <span key={k++} className={m[2] ? 'text-syn-key' : 'text-syn-str'}>
          {m[1]}
        </span>,
      )
      if (m[2]) out.push(<span key={k++} className="text-syn-punc">{m[2]}</span>)
    } else if (m[3]) out.push(<span key={k++} className="text-syn-kw">{m[3]}</span>)
    else if (m[4]) out.push(<span key={k++} className="text-syn-num">{m[4]}</span>)
    else if (m[5]) out.push(<span key={k++} className="text-syn-punc">{m[5]}</span>)
    last = RE.lastIndex
  }
  if (last < src.length) out.push(src.slice(last))
  return <pre className={cx('font-mono text-[11.5px] leading-[18px] break-all whitespace-pre-wrap text-fg', className)}>{out}</pre>
}
