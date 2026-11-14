export function fmtKB(bytes: number, digits = 1) {
  return `${(bytes / 1024).toFixed(digits)} KB`
}

export function fmtClock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export function pad(n: number, w = 2) {
  return String(n).padStart(w, '0')
}

export function fmtTime(d: Date, ms = true) {
  const base = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  return ms ? `${base}.${pad(d.getMilliseconds(), 3)}` : base
}

export function fmtRelative(ts: number | null, lang: 'zh' | 'en') {
  if (ts == null) return lang === 'zh' ? '从未下载' : 'Never'
  const d = new Date(ts)
  const now = new Date()
  const diff = Date.now() - ts
  if (diff < 60_000) return lang === 'zh' ? '刚刚' : 'Just now'
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const sameDay = d.toDateString() === now.toDateString()
  const y = new Date(now)
  y.setDate(now.getDate() - 1)
  if (sameDay) return lang === 'zh' ? `今天 ${hm}` : `Today ${hm}`
  if (d.toDateString() === y.toDateString()) return lang === 'zh' ? `昨天 ${hm}` : `Yesterday ${hm}`
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`
}

export function utf8Len(s: string) {
  return new TextEncoder().encode(s).length
}

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ')
}
