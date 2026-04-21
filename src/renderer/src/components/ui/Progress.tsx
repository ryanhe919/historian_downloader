/**
 * Progress — linear progress bar.
 * TimeUI does not ship a progress component; this patch fills the gap.
 * Styles live in styles/globals.css (.progress-track / .progress-fill).
 */
import type { HTMLAttributes } from 'react'

export type ProgressVariant = 'default' | 'success' | 'warning' | 'danger'
export type ProgressSize = 'sm' | 'md'

export interface ProgressProps extends Omit<HTMLAttributes<HTMLDivElement>, 'role'> {
  value: number
  variant?: ProgressVariant
  striped?: boolean
  animated?: boolean
  size?: ProgressSize
}

function clamp(v: number): number {
  if (!Number.isFinite(v)) return 0
  if (v < 0) return 0
  if (v > 100) return 100
  return v
}

export function Progress({
  value,
  variant = 'default',
  striped = false,
  animated = false,
  size = 'md',
  className,
  style,
  ...rest
}: ProgressProps): React.JSX.Element {
  const pct = clamp(value)
  const trackClass = ['progress-track', size, className].filter(Boolean).join(' ')
  const fillClasses = [
    'progress-fill',
    variant !== 'default' ? variant : '',
    striped ? 'striped' : '',
    striped && animated ? 'animated' : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      className={trackClass}
      style={style}
      {...rest}
    >
      <div className={fillClasses} style={{ width: `${pct}%` }} />
    </div>
  )
}
