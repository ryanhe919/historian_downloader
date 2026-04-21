/**
 * SegmentSlider — the "分段下载 N 天" control. 1..30 days, step 1.
 */
import { Icon, Slider } from '@/components/ui'

export interface SegmentSliderProps {
  value: number
  onChange: (next: number) => void
}

export function SegmentSlider({ value, onChange }: SegmentSliderProps): React.JSX.Element {
  const set = (n: number): void => {
    const clamped = Math.max(1, Math.min(30, Math.round(n)))
    if (clamped !== value) onChange(clamped)
  }

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          marginBottom: 10
        }}
      >
        <div>
          <div className="field-label" style={{ marginBottom: 2 }}>
            分段下载
          </div>
          <div style={{ fontSize: 11, color: 'var(--fg3)' }}>
            每批下载 N 天，避免数据库一次返回过多数据
          </div>
        </div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            className="icon-btn"
            onClick={() => set(value - 1)}
            aria-label="减少一天"
          >
            <Icon name="minus" size={14} />
          </button>
          <div
            style={{
              width: 72,
              textAlign: 'center',
              fontVariantNumeric: 'tabular-nums',
              fontSize: 'var(--fs-lg)',
              fontWeight: 600,
              letterSpacing: '-0.01em'
            }}
          >
            {value} 天
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={() => set(value + 1)}
            aria-label="增加一天"
          >
            <Icon name="plus" size={14} />
          </button>
        </div>
      </div>
      <Slider
        min={1}
        max={30}
        step={1}
        value={value}
        onChange={(v) => set(typeof v === 'number' ? v : v[0])}
        aria-label="每段天数"
      />
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 11,
          color: 'var(--fg3)',
          marginTop: 4,
          fontVariantNumeric: 'tabular-nums'
        }}
      >
        <span>1 天</span>
        <span>7 天</span>
        <span>15 天</span>
        <span>30 天</span>
      </div>
    </div>
  )
}

export default SegmentSlider
