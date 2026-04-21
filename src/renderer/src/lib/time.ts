import type { TimeRange } from '@shared/domain-types'

export type PresetId =
  | 'last-1h'
  | 'last-24h'
  | 'last-7d'
  | 'last-30d'
  | 'last-90d'
  | 'last-y'
  | 'custom'

export const PRESETS: { id: PresetId; label: string; popular?: boolean }[] = [
  { id: 'last-1h', label: '最近 1 小时' },
  { id: 'last-24h', label: '最近 24 小时' },
  { id: 'last-7d', label: '最近 7 天' },
  { id: 'last-30d', label: '最近 30 天' },
  { id: 'last-90d', label: '最近 90 天' },
  { id: 'last-y', label: '最近 1 年', popular: true },
  { id: 'custom', label: '自定义…' }
]

const HOUR_MS = 3600_000
const DAY_MS = 86_400_000

export function presetToRange(id: PresetId, now: Date = new Date()): TimeRange | null {
  if (id === 'custom') return null
  const end = now.getTime()
  const offset: Record<Exclude<PresetId, 'custom'>, number> = {
    'last-1h': HOUR_MS,
    'last-24h': DAY_MS,
    'last-7d': 7 * DAY_MS,
    'last-30d': 30 * DAY_MS,
    'last-90d': 90 * DAY_MS,
    'last-y': 365 * DAY_MS
  }
  const start = end - offset[id]
  return { start: new Date(start).toISOString(), end: new Date(end).toISOString() }
}

export function formatRangeShort(range: TimeRange): string {
  const s = range.start.slice(0, 10)
  const e = range.end.slice(0, 10)
  return `${s} ~ ${e}`
}
