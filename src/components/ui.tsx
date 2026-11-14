import { useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'
import { Check, ChevronDown, Minus, X, type LucideIcon } from 'lucide-react'
import { cx } from '../lib/format'

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle' | 'success'
type BtnSize = 'xs' | 'sm' | 'md' | 'lg'

export function Button({
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  iconRight: IconRight,
  loading,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: BtnVariant
  size?: BtnSize
  icon?: LucideIcon
  iconRight?: LucideIcon
  loading?: boolean
}) {
  const sizes: Record<BtnSize, string> = {
    xs: 'h-6 px-2 text-2xs gap-1 rounded-[5px]',
    sm: 'h-7 px-2.5 text-xs gap-1.5 rounded-md',
    md: 'h-8 px-3 text-sm gap-1.5 rounded-md',
    lg: 'h-10 px-4 text-base gap-2 rounded-lg',
  }
  const variants: Record<BtnVariant, string> = {
    primary: 'bg-primary text-white hover:bg-primary-hover border border-transparent shadow-[0_1px_0_rgba(0,0,0,0.06)]',
    secondary: 'bg-surface text-fg border border-line-strong hover:bg-surface-3',
    ghost: 'text-fg-2 hover:bg-hover hover:text-fg border border-transparent',
    subtle: 'bg-surface-3 text-fg hover:bg-hover border border-transparent',
    danger: 'bg-surface text-err border border-line-strong hover:bg-err-soft hover:border-err/40',
    success: 'bg-ok text-white border border-transparent hover:opacity-90',
  }
  const iconSize = size === 'lg' ? 17 : size === 'xs' ? 12 : 14
  return (
    <button
      type="button"
      className={cx(
        'inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-colors select-none outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:pointer-events-none disabled:opacity-45',
        sizes[size],
        variants[variant],
        className,
      )}
      {...rest}
    >
      {loading ? (
        <span className="inline-block size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : (
        Icon && <Icon size={iconSize} strokeWidth={1.9} className="shrink-0" />
      )}
      {children}
      {IconRight && <IconRight size={iconSize} strokeWidth={1.9} className="shrink-0 opacity-70" />}
    </button>
  )
}

export function IconButton({
  icon: Icon,
  label,
  active,
  size = 'md',
  className,
  tone,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string; active?: boolean; size?: 'xs' | 'sm' | 'md'; tone?: 'danger' }) {
  const s = size === 'xs' ? 'size-5' : size === 'sm' ? 'size-6' : 'size-7'
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-md transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-40 disabled:pointer-events-none',
        s,
        active ? 'bg-primary-soft text-accent' : tone === 'danger' ? 'text-fg-3 hover:bg-err-soft hover:text-err' : 'text-fg-3 hover:bg-hover hover:text-fg',
        className,
      )}
      {...rest}
    >
      <Icon size={size === 'xs' ? 12 : size === 'sm' ? 14 : 15} strokeWidth={1.9} />
    </button>
  )
}

export function Input({
  mono,
  icon: Icon,
  suffix,
  className,
  inputClassName,
  size = 'md',
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  mono?: boolean
  icon?: LucideIcon
  suffix?: ReactNode
  inputClassName?: string
  size?: 'sm' | 'md'
}) {
  return (
    <div
      className={cx(
        'flex min-w-0 items-center gap-1.5 rounded-md border border-line-strong bg-surface px-2 transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15',
        size === 'sm' ? 'h-7' : 'h-8',
        rest.disabled && 'opacity-55',
        className,
      )}
    >
      {Icon && <Icon size={14} className="shrink-0 text-fg-3" />}
      <input
        className={cx(
          'h-full w-full min-w-0 bg-transparent text-fg outline-none placeholder:text-fg-3',
          mono ? 'font-mono text-xs' : 'text-sm',
          inputClassName,
        )}
        spellCheck={false}
        {...rest}
      />
      {suffix}
    </div>
  )
}

export function Select({
  className,
  children,
  size = 'md',
  mono,
  ...rest
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> & { size?: 'sm' | 'md'; mono?: boolean }) {
  return (
    <div className={cx('relative min-w-0', className)}>
      <select
        className={cx(
          'w-full appearance-none rounded-md border border-line-strong bg-surface pr-7 pl-2 text-fg outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:opacity-50',
          size === 'sm' ? 'h-7 text-xs' : 'h-8 text-sm',
          mono && 'font-mono text-xs',
        )}
        {...rest}
      >
        {children}
      </select>
      <ChevronDown size={14} className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-fg-3" />
    </div>
  )
}

export function Checkbox({
  checked,
  indeterminate,
  onChange,
  label,
  desc,
  disabled,
  className,
}: {
  checked: boolean
  indeterminate?: boolean
  onChange?: (v: boolean) => void
  label?: ReactNode
  desc?: ReactNode
  disabled?: boolean
  className?: string
}) {
  const box = (
    <span
      className={cx(
        'mt-px inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors',
        checked || indeterminate ? 'border-primary bg-primary text-white' : 'border-line-strong bg-surface',
      )}
    >
      {indeterminate ? <Minus size={11} strokeWidth={3} /> : checked ? <Check size={11} strokeWidth={3} /> : null}
    </span>
  )
  return (
    <label
      className={cx('inline-flex items-start gap-2 select-none', disabled ? 'opacity-45' : 'cursor-default', className)}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (!disabled) onChange?.(!checked)
      }}
    >
      <input type="checkbox" className="sr-only" checked={checked} readOnly disabled={disabled} />
      {box}
      {(label || desc) && (
        <span className="min-w-0">
          {label && <span className="block text-sm text-fg">{label}</span>}
          {desc && <span className="block text-2xs text-fg-3">{desc}</span>}
        </span>
      )}
    </label>
  )
}

export function Switch({ checked, onChange, disabled, size = 'md' }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; size?: 'sm' | 'md' }) {
  const w = size === 'sm' ? 'w-7 h-4' : 'w-8 h-[18px]'
  const k = size === 'sm' ? 'size-3' : 'size-3.5'
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative inline-flex shrink-0 items-center rounded-full transition-colors outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-45',
        w,
        checked ? 'bg-primary' : 'bg-line-strong',
      )}
    >
      <span
        className={cx(
          'absolute rounded-full bg-white shadow-sm transition-transform',
          k,
          checked ? (size === 'sm' ? 'translate-x-3.5' : 'translate-x-4') : 'translate-x-0.5',
        )}
      />
    </button>
  )
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = 'md',
  className,
  full,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: ReactNode; icon?: LucideIcon; disabled?: boolean }[]
  size?: 'xs' | 'sm' | 'md'
  className?: string
  full?: boolean
}) {
  return (
    <div className={cx('inline-flex rounded-md bg-surface-3 p-0.5', full && 'flex w-full', className)}>
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={cx(
              'inline-flex items-center justify-center gap-1.5 rounded-[5px] font-medium whitespace-nowrap transition-colors disabled:opacity-40',
              size === 'xs' ? 'h-5 px-2 text-2xs' : size === 'sm' ? 'h-6 px-2.5 text-xs' : 'h-7 px-3 text-sm',
              full && 'flex-1',
              active ? 'bg-surface text-fg shadow-[0_1px_2px_rgba(0,0,0,0.08),0_0_0_1px_var(--line)]' : 'text-fg-2 hover:text-fg',
            )}
          >
            {o.icon && <o.icon size={size === 'md' ? 14 : 12} />}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

export type Tone = 'ok' | 'warn' | 'err' | 'neutral' | 'primary'
export const toneText: Record<Tone, string> = {
  ok: 'text-ok',
  warn: 'text-warn',
  err: 'text-err',
  neutral: 'text-fg-3',
  primary: 'text-accent',
}
export const toneBg: Record<Tone, string> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  err: 'bg-err',
  neutral: 'bg-fg-3',
  primary: 'bg-primary',
}

export function Badge({ tone = 'neutral', children, dot, className, mono }: { tone?: Tone; children: ReactNode; dot?: boolean; className?: string; mono?: boolean }) {
  const tones: Record<Tone, string> = {
    ok: 'bg-ok-soft text-ok',
    warn: 'bg-warn-soft text-warn',
    err: 'bg-err-soft text-err',
    neutral: 'bg-surface-3 text-fg-2',
    primary: 'bg-primary-soft text-accent',
  }
  return (
    <span className={cx('inline-flex h-5 shrink-0 items-center gap-1 rounded-[5px] px-1.5 text-2xs font-medium whitespace-nowrap', tones[tone], mono && 'font-mono', className)}>
      {dot && <span className={cx('size-1.5 rounded-full', toneBg[tone])} />}
      {children}
    </span>
  )
}

export function Dot({ tone, pulse, className }: { tone: Tone; pulse?: boolean; className?: string }) {
  return (
    <span className={cx('relative inline-flex size-2 shrink-0', className)}>
      {pulse && <span className={cx('absolute inset-0 rounded-full opacity-50 anim-pulse', toneBg[tone])} />}
      <span className={cx('relative size-2 rounded-full', toneBg[tone])} />
    </span>
  )
}

export function Panel({
  title,
  icon: Icon,
  actions,
  children,
  className,
  bodyClassName,
  subtitle,
}: {
  title?: ReactNode
  icon?: LucideIcon
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  subtitle?: ReactNode
}) {
  return (
    <section className={cx('flex min-h-0 flex-col rounded-lg border border-line bg-surface', className)}>
      {title && (
        <header className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3.5">
          {Icon && <Icon size={15} className="text-fg-3" strokeWidth={1.9} />}
          <h3 className="text-sm font-semibold text-fg">{title}</h3>
          {subtitle && <span className="truncate text-xs text-fg-3">{subtitle}</span>}
          <div className="ml-auto flex items-center gap-1.5">{actions}</div>
        </header>
      )}
      <div className={cx('min-h-0 flex-1', bodyClassName ?? 'p-3.5')}>{children}</div>
    </section>
  )
}

export function Field({ label, hint, children, className, inline }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string; inline?: boolean }) {
  if (inline)
    return (
      <div className={cx('flex items-center gap-3', className)}>
        <span className="w-24 shrink-0 text-xs text-fg-2">{label}</span>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    )
  return (
    <div className={cx('flex min-w-0 flex-col gap-1.5', className)}>
      <span className="text-xs font-medium text-fg-2">{label}</span>
      {children}
      {hint && <span className="text-2xs text-fg-3">{hint}</span>}
    </div>
  )
}

export function Progress({ value, tone = 'primary', striped, className, height = 'h-1.5' }: { value: number; tone?: Tone; striped?: boolean; className?: string; height?: string }) {
  return (
    <div className={cx('w-full overflow-hidden rounded-full bg-surface-3', height, className)}>
      <div
        className={cx('h-full rounded-full transition-[width] duration-150 ease-linear', toneBg[tone], striped && 'progress-stripe')}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  )
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = 520,
  icon,
  closable = true,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  footer?: ReactNode
  width?: number
  icon?: ReactNode
  closable?: boolean
}) {
  useEffect(() => {
    if (!open) return
    const fn = (e: KeyboardEvent) => e.key === 'Escape' && closable && onClose()
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [open, onClose, closable])
  if (!open) return null
  return (
    <div className="anim-fade absolute inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[1px]" onMouseDown={() => closable && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        className="anim-pop flex max-h-[86%] flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-[0_24px_64px_-12px_rgba(0,0,0,0.35)]"
        style={{ width }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex shrink-0 items-center gap-2.5 px-5 pt-4 pb-3">
          {icon}
          <h2 className="text-base font-semibold text-fg">{title}</h2>
          {closable && <IconButton icon={X} label="关闭" className="ml-auto -mr-1.5" onClick={onClose} />}
        </header>
        <div className="scroll-thin min-h-0 flex-1 overflow-auto px-5 pb-4">{children}</div>
        {footer && <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-line bg-surface-2 px-5 py-3">{footer}</footer>}
      </div>
    </div>
  )
}

export function Popover({
  trigger,
  children,
  align = 'left',
  width = 320,
  open: openProp,
  onOpenChange,
  className,
}: {
  trigger: (open: boolean, toggle: () => void) => ReactNode
  children: (close: () => void) => ReactNode
  align?: 'left' | 'right'
  width?: number
  open?: boolean
  onOpenChange?: (v: boolean) => void
  className?: string
}) {
  const [openState, setOpenState] = useState(false)
  const open = openProp ?? openState
  const setOpen = (v: boolean) => {
    setOpenState(v)
    onOpenChange?.(v)
  }
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const fn = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', fn)
    window.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', fn)
      window.removeEventListener('keydown', key)
    }
  })
  return (
    <div ref={ref} className={cx('relative', className)}>
      {trigger(open, () => setOpen(!open))}
      {open && (
        <div
          className={cx(
            'anim-pop absolute top-[calc(100%+6px)] z-40 overflow-hidden rounded-lg border border-line bg-surface p-1 shadow-[0_12px_32px_-8px_rgba(0,0,0,0.25)]',
            align === 'right' ? 'right-0' : 'left-0',
          )}
          style={{ width }}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

export function MenuItem({
  children,
  onClick,
  active,
  icon: Icon,
  right,
  disabled,
  danger,
}: {
  children: ReactNode
  onClick?: () => void
  active?: boolean
  icon?: LucideIcon
  right?: ReactNode
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors disabled:opacity-40',
        active ? 'bg-primary-soft text-fg' : 'hover:bg-hover',
        danger ? 'text-err' : 'text-fg',
      )}
    >
      {Icon && <Icon size={15} className={danger ? '' : 'text-fg-3'} strokeWidth={1.9} />}
      <span className="min-w-0 flex-1">{children}</span>
      {right}
    </button>
  )
}

/**
 * 右键菜单：在鼠标位置弹出，靠近窗口边缘时往里收。
 * 点菜单外、按 Esc、滚动、缩放窗口、窗口失焦都会关闭；菜单项里的 MenuItem 点完由调用方关闭。
 */
export function ContextMenu({ x, y, onClose, children, width = 220 }: { x: number; y: number; onClose: () => void; children: ReactNode; width?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    setPos({ left: Math.max(4, Math.min(x, window.innerWidth - r.width - 8)), top: Math.max(4, Math.min(y, window.innerHeight - r.height - 8)) })
  }, [x, y])
  useEffect(() => {
    const outside = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('mousedown', outside)
    document.addEventListener('scroll', outside, true)
    window.addEventListener('keydown', key)
    window.addEventListener('blur', onClose)
    window.addEventListener('resize', onClose)
    return () => {
      document.removeEventListener('mousedown', outside)
      document.removeEventListener('scroll', outside, true)
      window.removeEventListener('keydown', key)
      window.removeEventListener('blur', onClose)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])
  return (
    <div
      ref={ref}
      role="menu"
      onContextMenu={(e) => e.preventDefault()}
      className="anim-pop fixed z-50 overflow-hidden rounded-lg border border-line bg-surface p-1 shadow-[0_12px_32px_-8px_rgba(0,0,0,0.25)]"
      style={{ ...pos, width }}
    >
      {children}
    </div>
  )
}

export function MenuSeparator() {
  return <div className="mx-1 my-1 h-px bg-line" />
}

export function EmptyState({
  icon: Icon,
  title,
  desc,
  children,
  tone = 'neutral',
  className,
  compact,
}: {
  icon: LucideIcon
  title: ReactNode
  desc?: ReactNode
  children?: ReactNode
  tone?: Tone
  className?: string
  compact?: boolean
}) {
  const ring: Record<Tone, string> = {
    neutral: 'bg-surface-3 text-fg-3',
    ok: 'bg-ok-soft text-ok',
    warn: 'bg-warn-soft text-warn',
    err: 'bg-err-soft text-err',
    primary: 'bg-primary-soft text-accent',
  }
  return (
    <div className={cx('flex h-full flex-col items-center justify-center text-center', compact ? 'gap-2 p-4' : 'gap-3 p-8', className)}>
      <div className={cx('flex items-center justify-center rounded-xl', compact ? 'size-10' : 'size-12', ring[tone])}>
        <Icon size={compact ? 20 : 22} strokeWidth={1.7} />
      </div>
      <div className="max-w-[340px]">
        <div className="text-base font-semibold text-fg">{title}</div>
        {desc && <div className="mt-1 text-xs leading-relaxed text-fg-3">{desc}</div>}
      </div>
      {children && <div className="mt-1 flex flex-wrap items-center justify-center gap-2">{children}</div>}
    </div>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex h-[18px] items-center rounded border border-line-strong bg-surface-2 px-1 font-mono text-[10px] text-fg-3">{children}</kbd>
}

export function Divider({ vertical, className }: { vertical?: boolean; className?: string }) {
  return <div className={cx(vertical ? 'h-5 w-px' : 'h-px w-full', 'shrink-0 bg-line', className)} />
}

export function SectionLabel({ children, className, right }: { children: ReactNode; className?: string; right?: ReactNode }) {
  return (
    <div className={cx('flex items-center gap-2 text-2xs font-semibold tracking-wide text-fg-3 uppercase', className)}>
      <span>{children}</span>
      {right && <div className="ml-auto flex items-center gap-1 normal-case">{right}</div>}
    </div>
  )
}
