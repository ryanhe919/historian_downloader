/**
 * Step 2 — Time & Sampling. Combines preset pills, custom DatePickers, a
 * SegmentedControl for sampling mode, a 1..30 day slider, and the preview
 * (chart + sample table).
 */
import { useEffect, useMemo } from 'react'
import {
  Card,
  CardBody,
  CardHeader,
  DatePicker,
  Empty,
  FormField,
  Grid,
  Skeleton,
  Tabs
} from '@/components/ui'
import { useRpcQuery } from '@/hooks/useRpc'
import { formatBytes, formatRows } from '@/lib/format'
import { presetToRange } from '@/lib/time'
import { useConnectionStore } from '@/stores/connection'
import { useTagsStore } from '@/stores/tags'
import { useTimeRangeStore } from '@/stores/timerange'
import type { SamplingMode, TimeRange } from '@shared/domain-types'
import { PresetPills } from './PresetPills'
import { SamplingTabs } from './SamplingTabs'
import { SegmentSlider } from './SegmentSlider'
import { PreviewChart } from './PreviewChart'
import { SampleTable } from './SampleTable'

/**
 * Build the effective TimeRange from the current store state. If the preset
 * is 'custom' and the user has not filled both dates yet, return null so we
 * can skip the preview RPC.
 */
function useEffectiveRange(): TimeRange | null {
  const activePreset = useTimeRangeStore((s) => s.activePreset)
  const customRange = useTimeRangeStore((s) => s.customRange)
  return useMemo(() => {
    if (activePreset === 'custom') return customRange ?? null
    return presetToRange(activePreset)
  }, [activePreset, customRange])
}

/** Points-per-day by sampling mode — used for the row/size estimates. */
function pointsPerDay(sampling: SamplingMode): number {
  switch (sampling) {
    case 'raw':
      return 86_400 // 1 Hz assumption
    case '1m':
      return 1_440
    case '5m':
      return 288
    case '1h':
      return 24
    default:
      return 1_440
  }
}

function daysBetween(range: TimeRange | null): number {
  if (!range) return 0
  const s = Date.parse(range.start)
  const e = Date.parse(range.end)
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return 0
  return (e - s) / 86_400_000
}

export function TimeRangeStep(): React.JSX.Element {
  const serverId = useConnectionStore((s) => s.selectedServerId)
  const selectedIds = useTagsStore((s) => s.selectedIds)

  const activePreset = useTimeRangeStore((s) => s.activePreset)
  const setPreset = useTimeRangeStore((s) => s.setPreset)
  const customRange = useTimeRangeStore((s) => s.customRange)
  const setCustomRange = useTimeRangeStore((s) => s.setCustomRange)
  const sampling = useTimeRangeStore((s) => s.sampling)
  const setSampling = useTimeRangeStore((s) => s.setSampling)
  const segmentDays = useTimeRangeStore((s) => s.segmentDays)
  const setSegmentDays = useTimeRangeStore((s) => s.setSegmentDays)

  const range = useEffectiveRange()
  const tagIds = useMemo(() => Array.from(selectedIds), [selectedIds])
  const days = daysBetween(range)
  const segments = Math.max(1, Math.ceil(days / Math.max(1, segmentDays)))
  const estRows = Math.round(tagIds.length * days * pointsPerDay(sampling))
  // Rough "20 bytes per cell" heuristic — matches the spec's simple formula.
  const estBytes = estRows * 20

  const previewEnabled = !!serverId && tagIds.length > 0 && !!range
  const previewQuery = useRpcQuery(
    'historian.preview.sample',
    {
      serverId: serverId ?? '',
      tagIds: tagIds.slice(0, 3), // 只预览前 3 条，减轻采样负担
      range: range ?? { start: new Date().toISOString(), end: new Date().toISOString() },
      sampling,
      maxPoints: 240
    },
    {
      enabled: previewEnabled,
      deps: [serverId, tagIds.slice(0, 3).join(','), range?.start, range?.end, sampling]
    }
  )

  // Custom preset bookkeeping: when the user first picks "custom" but has no
  // range stored yet, seed it with the current 30-day window so the date
  // pickers show something reasonable.
  useEffect(() => {
    if (activePreset === 'custom' && !customRange) {
      const end = new Date()
      const start = new Date(end.getTime() - 30 * 86_400_000)
      setCustomRange({ start: start.toISOString(), end: end.toISOString() })
    }
  }, [activePreset, customRange, setCustomRange])

  const startDate = customRange ? new Date(customRange.start) : null
  const endDate = customRange ? new Date(customRange.end) : null

  return (
    <div className="panel-inner">
      <h1 className="page-title">时间与采样</h1>
      <div className="page-sub">
        选择时间范围、采样方式，并设置分段大小以避免一次性导出过多数据。
      </div>

      {/* ---- Summary strip ---- */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 24,
          padding: '12px 16px',
          marginBottom: 16,
          background: 'var(--bg-sunken)',
          borderRadius: 10,
          border: '1px solid var(--border-subtle)'
        }}
      >
        <SummaryStat label="已选标签" value={`${tagIds.length}`} unit="个" />
        <SummaryStat label="时间跨度" value={days > 0 ? days.toFixed(1) : '—'} unit="天" />
        <SummaryStat label="分段数" value={`${segments}`} unit="段" />
        <SummaryStat label="预估行数" value={estRows > 0 ? formatRows(estRows) : '—'} unit="" />
        <SummaryStat label="预估体积" value={estBytes > 0 ? formatBytes(estBytes) : '—'} unit="" />
      </div>

      <Grid columns="1fr 360px" gap={14}>
        {/* ---- Left: controls ---- */}
        <Card>
          <CardBody>
            <div className="field-label" style={{ marginBottom: 10 }}>
              快速选择
            </div>
            <PresetPills value={activePreset} onChange={setPreset} />

            {activePreset === 'custom' ? (
              <div
                style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 18 }}
              >
                <FormField label="开始时间">
                  <DatePicker
                    value={startDate}
                    onChange={(d) => {
                      if (!d) return
                      setCustomRange({
                        start: d.toISOString(),
                        end: customRange?.end ?? new Date().toISOString()
                      })
                    }}
                    isClearable
                    aria-label="开始时间"
                  />
                </FormField>
                <FormField label="结束时间">
                  <DatePicker
                    value={endDate}
                    onChange={(d) => {
                      if (!d) return
                      setCustomRange({
                        start: customRange?.start ?? new Date(0).toISOString(),
                        end: d.toISOString()
                      })
                    }}
                    isClearable
                    aria-label="结束时间"
                  />
                </FormField>
              </div>
            ) : null}

            <div className="divider" />

            <div className="field-label" style={{ marginBottom: 8 }}>
              采样方式
            </div>
            <SamplingTabs value={sampling} onChange={setSampling} />

            <div className="divider" />

            <SegmentSlider value={segmentDays} onChange={setSegmentDays} />
          </CardBody>
        </Card>

        {/* ---- Right: context card ---- */}
        <Card>
          <CardHeader title="导出预估" subtitle="基于当前选择计算" />
          <CardBody>
            {tagIds.length === 0 ? (
              <Empty variant="inline" title="请先选择标签" />
            ) : (
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--fg2)', lineHeight: 1.75 }}>
                按 <strong style={{ color: 'var(--fg1)' }}>{tagIds.length}</strong> 个标签 ·{' '}
                <strong style={{ color: 'var(--fg1)' }}>{days.toFixed(1)}</strong> 天 ·{' '}
                <strong style={{ color: 'var(--fg1)' }}>
                  {sampling === 'raw' ? '原始' : sampling}
                </strong>{' '}
                采样计算。
                <br />
                分为 <strong style={{ color: 'var(--fg1)' }}>{segments}</strong> 段，每段{' '}
                <strong style={{ color: 'var(--fg1)' }}>{segmentDays}</strong> 天。
              </div>
            )}
          </CardBody>
        </Card>
      </Grid>

      {/* ---- Preview panel ---- */}
      <Card style={{ marginTop: 14 }}>
        <CardHeader
          title="数据预览"
          subtitle={
            previewEnabled
              ? `前 ${Math.min(3, tagIds.length)} 条标签 · ${sampling === 'raw' ? '原始' : sampling} 采样`
              : '选中标签并设置时间范围后自动预览'
          }
        />
        <CardBody>
          <Tabs
            variant="pills"
            items={[
              {
                key: 'chart',
                label: '图表',
                content: previewQuery.loading ? (
                  <Skeleton height={200} />
                ) : (
                  <PreviewChart data={previewQuery.data} />
                )
              },
              {
                key: 'table',
                label: '表格',
                content: previewQuery.loading ? (
                  <Skeleton height={180} />
                ) : (
                  <SampleTable data={previewQuery.data} />
                )
              }
            ]}
          />
          {previewQuery.error ? (
            <div style={{ marginTop: 10, color: 'var(--c-danger)', fontSize: 12 }}>
              预览失败：{previewQuery.error.message}
            </div>
          ) : null}
        </CardBody>
      </Card>
    </div>
  )
}

interface SummaryStatProps {
  label: string
  value: string
  unit: string
}
function SummaryStat({ label, value, unit }: SummaryStatProps): React.JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      <span style={{ fontSize: 11, color: 'var(--fg3)', letterSpacing: '0.02em' }}>{label}</span>
      <span
        style={{
          fontSize: 'var(--fs-lg)',
          fontWeight: 600,
          letterSpacing: '-0.01em',
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1.15
        }}
      >
        {value}
        {unit ? (
          <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--fg3)', marginLeft: 2 }}>
            {unit}
          </span>
        ) : null}
      </span>
    </div>
  )
}

export default TimeRangeStep
