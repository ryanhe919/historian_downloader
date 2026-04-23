/**
 * SamplingTabs — quick preset buttons plus a custom-minutes input.
 */
import { Input, SegmentedControl } from '@/components/ui'
import { QUICK_SAMPLING_OPTIONS, normalizeSamplingMode } from '@/lib/time'
import type { SamplingMode } from '@shared/domain-types'
import { useMemo } from 'react'

type SamplingControlValue = SamplingMode | 'custom'

export interface SamplingTabsProps {
  value: SamplingMode
  onChange: (next: SamplingMode) => void
}

export function SamplingTabs({ value, onChange }: SamplingTabsProps): React.JSX.Element {
  const normalized = normalizeSamplingMode(value)
  const quickValues = useMemo(
    () => new Set(QUICK_SAMPLING_OPTIONS.map((option) => option.value)),
    []
  )
  const isCustom = !quickValues.has(normalized)

  const options: { value: SamplingControlValue; label: string }[] = [
    ...QUICK_SAMPLING_OPTIONS,
    { value: 'custom', label: '自定义' }
  ]

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <SegmentedControl<SamplingControlValue>
        options={options}
        value={isCustom ? 'custom' : normalized}
        onChange={(next) => {
          if (next === 'custom') {
            onChange('10m')
            return
          }
          onChange(next)
        }}
        aria-label="采样方式"
      />
      {isCustom ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 160px) auto',
            gap: 8,
            alignItems: 'center'
          }}
        >
          <Input
            key={normalized}
            type="number"
            min={1}
            step={1}
            defaultValue={normalized.slice(0, -1)}
            onChange={(next) => {
              if (!/^[1-9]\d*$/.test(next)) return
              onChange(`${next}m` as SamplingMode)
            }}
            aria-label="自定义采样分钟数"
            placeholder="输入分钟数"
          />
          <span style={{ fontSize: 12, color: 'var(--fg3)' }}>分钟</span>
        </div>
      ) : null}
    </div>
  )
}

export default SamplingTabs
