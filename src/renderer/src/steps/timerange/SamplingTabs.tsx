/**
 * SamplingTabs — SegmentedControl wrapper for the 4 sampling modes.
 */
import { SegmentedControl } from '@/components/ui'
import type { SamplingMode } from '@shared/domain-types'

const OPTIONS: { value: SamplingMode; label: string }[] = [
  { value: 'raw', label: '原始' },
  { value: '1m', label: '1 分钟' },
  { value: '5m', label: '5 分钟' },
  { value: '1h', label: '1 小时' }
]

export interface SamplingTabsProps {
  value: SamplingMode
  onChange: (next: SamplingMode) => void
}

export function SamplingTabs({ value, onChange }: SamplingTabsProps): React.JSX.Element {
  return (
    <SegmentedControl<SamplingMode>
      options={OPTIONS}
      value={value}
      onChange={onChange}
      aria-label="采样方式"
    />
  )
}

export default SamplingTabs
