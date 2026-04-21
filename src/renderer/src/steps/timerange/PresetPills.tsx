/**
 * PresetPills — horizontal row of time-range quick picks.
 *
 * Thin wrapper over the global `.preset-pill` class so the active/popular
 * decoration stays consistent with the design system tokens.
 */
import { PRESETS, type PresetId } from '@/lib/time'
import { Icon } from '@/components/ui'

export interface PresetPillsProps {
  value: PresetId
  onChange: (next: PresetId) => void
}

export function PresetPills({ value, onChange }: PresetPillsProps): React.JSX.Element {
  return (
    <div className="preset-pills" role="tablist" aria-label="时间范围预设">
      {PRESETS.map((p) => {
        const active = value === p.id
        return (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={`preset-pill${active ? ' active' : ''}`}
            onClick={() => onChange(p.id)}
          >
            {p.popular ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Icon name="zap" size={10} /> {p.label}
              </span>
            ) : (
              p.label
            )}
          </button>
        )
      })}
    </div>
  )
}

export default PresetPills
