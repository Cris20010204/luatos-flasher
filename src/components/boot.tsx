import { CircleCheck, Info, TriangleAlert } from 'lucide-react'
import { useApp } from '../store'
import { cx } from '../lib/format'
import type { DeviceStatus } from '../data/types'

export const BOOT_TEXT_ZH = '按住 BOOT 键，然后按复位键，松开 BOOT 键，即可进入刷机模式'
export const BOOT_TEXT_EN = 'Hold BOOT, press RESET, then release BOOT to enter flash mode'

/** Inline hint shown near every download action; tone follows device state. */
export function BootHint({ className, compact, status }: { className?: string; compact?: boolean; status?: DeviceStatus }) {
  const { t, device } = useApp()
  const s = status ?? device.status
  const tone = s === 'offline' ? 'warn' : s === 'boot' ? 'ok' : 'neutral'
  const Icon = s === 'offline' ? TriangleAlert : s === 'boot' ? CircleCheck : Info
  const lead =
    s === 'offline'
      ? t('未检测到设备。', 'No device detected. ')
      : s === 'boot'
        ? t('设备已处于下载模式。', 'Device is in download mode. ')
        : t('将自动重启进入下载模式；若失败，', 'The tool reboots into download mode automatically. If that fails, ')
  return (
    <div
      className={cx(
        'flex items-start gap-2 rounded-md border px-2.5 text-xs leading-[18px]',
        compact ? 'py-1.5' : 'py-2',
        tone === 'warn' && 'border-warn/30 bg-warn-soft text-fg',
        tone === 'ok' && 'border-ok/30 bg-ok-soft text-fg',
        tone === 'neutral' && 'border-line bg-surface-2 text-fg-2',
        className,
      )}
    >
      <Icon size={14} className={cx('mt-0.5 shrink-0', tone === 'warn' ? 'text-warn' : tone === 'ok' ? 'text-ok' : 'text-fg-3')} />
      <span>
        <span className="font-medium text-fg">{lead}</span>
        {/* 已经在下载模式就不用再教怎么进下载模式 */}
        {s === 'boot' ? t('可以直接下载。', 'Ready to download.') : t(BOOT_TEXT_ZH, BOOT_TEXT_EN)}
      </span>
    </div>
  )
}

/** Board diagram with numbered BOOT / RESET steps. */
export function BootIllustration({ className }: { className?: string }) {
  const { t } = useApp()
  const steps = [
    t('按住 BOOT 键', 'Hold BOOT'),
    t('按一下复位键', 'Press RESET'),
    t('松开 BOOT 键', 'Release BOOT'),
  ]
  return (
    <div className={cx('flex items-center gap-5 rounded-lg border border-line bg-surface-2 p-4', className)}>
      <svg viewBox="0 0 240 132" className="h-[118px] w-[214px] shrink-0" aria-hidden>
        {/* USB cable */}
        <path d="M0 66 H26" stroke="var(--fg-3)" strokeWidth="5" strokeLinecap="round" />
        <rect x="22" y="56" width="16" height="20" rx="2" fill="var(--line-strong)" />
        {/* PCB */}
        <rect x="36" y="14" width="196" height="104" rx="10" fill="#1f6f4a" />
        <rect x="36" y="14" width="196" height="104" rx="10" fill="none" stroke="#155a3b" strokeWidth="2" />
        {[52, 216].map((x) => [28, 104].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r="4" fill="#0f3f2a" stroke="#d6b45a" strokeWidth="1.5" />))}
        {/* module */}
        <rect x="98" y="30" width="72" height="62" rx="4" fill="#c9ced6" stroke="#9aa1ab" strokeWidth="1.5" />
        <text x="134" y="58" textAnchor="middle" fontSize="9" fontFamily="JetBrains Mono, monospace" fill="#3b4250" fontWeight="600">
          Air780EHM
        </text>
        <text x="134" y="72" textAnchor="middle" fontSize="7" fontFamily="JetBrains Mono, monospace" fill="#5b6472">
          LuatOS
        </text>
        {/* USB connector on board */}
        <rect x="36" y="54" width="14" height="24" rx="2" fill="#aeb4bd" />
        {/* BOOT button */}
        <g>
          <rect x="182" y="30" width="34" height="26" rx="4" fill="#e5e7eb" stroke="#9aa1ab" />
          <circle cx="199" cy="43" r="7" fill="var(--primary)" />
          <text x="199" y="68" textAnchor="middle" fontSize="8" fill="#fff" fontWeight="700" fontFamily="system-ui">
            BOOT
          </text>
          <circle cx="222" cy="28" r="7" fill="#fff" stroke="var(--primary)" strokeWidth="1.5" />
          <text x="222" y="31" textAnchor="middle" fontSize="8" fontWeight="700" fill="var(--primary)">
            1
          </text>
        </g>
        {/* RESET button */}
        <g>
          <rect x="182" y="78" width="34" height="26" rx="4" fill="#e5e7eb" stroke="#9aa1ab" />
          <circle cx="199" cy="91" r="7" fill="#f59e0b" />
          <text x="199" y="116" textAnchor="middle" fontSize="8" fill="#fff" fontWeight="700" fontFamily="system-ui">
            RST
          </text>
          <circle cx="222" cy="76" r="7" fill="#fff" stroke="#f59e0b" strokeWidth="1.5" />
          <text x="222" y="79" textAnchor="middle" fontSize="8" fontWeight="700" fill="#d97706">
            2
          </text>
        </g>
        {/* LED */}
        <circle cx="70" cy="34" r="3.5" fill="#22c55e" />
        <circle cx="70" cy="46" r="3.5" fill="#f59e0b" opacity="0.55" />
      </svg>
      <ol className="flex flex-col gap-2.5">
        {steps.map((s, i) => (
          <li key={s} className="flex items-center gap-2.5 text-sm text-fg">
            <span
              className={cx(
                'flex size-5 items-center justify-center rounded-full text-2xs font-bold text-white',
                i === 1 ? 'bg-warn' : 'bg-primary',
              )}
            >
              {i === 2 ? '3' : i + 1}
            </span>
            {s}
          </li>
        ))}
        <li className="pl-[30px] text-2xs text-fg-3">{t('设备将以“下载模式”重新出现', 'The device re-appears in download mode')}</li>
      </ol>
    </div>
  )
}
