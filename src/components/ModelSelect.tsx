/** 模组型号下拉框：按芯片家族分组，组名里说明能不能自动识别 / 刷机 */
import { useApp } from '../store'
import { FAMILIES, MODELS, type ChipFamily } from '../data/catalog'
import { Select } from './ui'

export function ModelSelect({ value, onChange, className, size }: { value: string; onChange: (model: string) => void; className?: string; size?: 'sm' | 'md' }) {
  const { t } = useApp()
  const known = MODELS.some((m) => m.model === value)
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} className={className} size={size}>
      {/* 旧项目里可能有列表外的型号，保留它 */}
      {!known && value && <option value={value}>{value}</option>}
      {(Object.keys(FAMILIES) as ChipFamily[]).map((f) => (
        <optgroup key={f} label={`${FAMILIES[f].name} · ${t(FAMILIES[f].zh, FAMILIES[f].en)}`}>
          {MODELS.filter((m) => m.family === f).map((m) => (
            <option key={m.model} value={m.model}>
              {m.model}
            </option>
          ))}
        </optgroup>
      ))}
    </Select>
  )
}
