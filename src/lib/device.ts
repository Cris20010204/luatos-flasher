import type { DeviceStatus } from '../data/types'
import type { Tone } from '../components/ui'

export const statusTone: Record<DeviceStatus, Tone> = { running: 'ok', boot: 'warn', offline: 'err' }
export const statusLabel: Record<DeviceStatus, [string, string]> = {
  running: ['运行中', 'Running'],
  boot: ['下载模式', 'Download mode'],
  offline: ['未连接', 'Disconnected'],
}
