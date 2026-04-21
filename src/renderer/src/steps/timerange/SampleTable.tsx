/**
 * SampleTable — tabular view of the preview samples (up to 12 rows by
 * default, with a "show more" toggle). Kept plain HTML `table.t` because we
 * want fixed column widths + mono cells + sticky header and TimeUI's Table
 * adds unneeded selection/sort UI for this read-only sample.
 */
import { useState } from 'react'
import { Button, Empty } from '@/components/ui'
import type { Quality } from '@shared/domain-types'
import type { PreviewSampleResult } from '@shared/rpc-types'

export interface SampleTableProps {
  data?: PreviewSampleResult
}

const INITIAL_ROWS = 12

function qualityClass(q: Quality | undefined): string {
  switch (q) {
    case 'Good':
      return 'tag tag-success dot'
    case 'Uncertain':
      return 'tag tag-warning dot'
    case 'Bad':
      return 'tag tag-danger dot'
    default:
      return 'tag tag-default'
  }
}

export function SampleTable({ data }: SampleTableProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)

  if (!data || data.times.length === 0 || data.tags.length === 0) {
    return <Empty variant="inline" title="暂无样本" description="选中标签后查看预览数据" />
  }

  const totalRows = data.times.length
  const visibleRows = expanded ? totalRows : Math.min(INITIAL_ROWS, totalRows)

  // Worst-quality-per-row across all tag columns, to drive the summary pill.
  const rowQuality = (i: number): Quality | undefined => {
    let worst: Quality | undefined
    for (let c = 0; c < data.quality.length; c++) {
      const q = data.quality[c]?.[i]
      if (q === 'Bad') return 'Bad'
      if (q === 'Uncertain') worst = 'Uncertain'
      else if (q === 'Good' && worst == null) worst = 'Good'
    }
    return worst
  }

  return (
    <div>
      <div style={{ maxHeight: expanded ? 420 : 260, overflow: 'auto' }}>
        <table className="t">
          <thead>
            <tr>
              <th style={{ width: 180 }}>时间戳</th>
              {data.tags.map((t) => (
                <th key={t.id}>
                  <span className="mono" style={{ fontSize: 11 }}>
                    {t.label}
                  </span>
                  {t.unit ? (
                    <span style={{ color: 'var(--fg3)', marginLeft: 4 }}>({t.unit})</span>
                  ) : null}
                </th>
              ))}
              <th style={{ width: 96 }}>质量</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: visibleRows }).map((_, i) => (
              <tr key={data.times[i]}>
                <td>
                  <span className="mono" style={{ fontSize: 12 }}>
                    {data.times[i]}
                  </span>
                </td>
                {data.values.map((col, c) => {
                  const v = col[i]
                  return (
                    <td key={c} className="mono">
                      {v == null ? <span style={{ color: 'var(--fg3)' }}>—</span> : v.toFixed(2)}
                    </td>
                  )
                })}
                <td>
                  <span className={qualityClass(rowQuality(i))}>{rowQuality(i) ?? '—'}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalRows > INITIAL_ROWS ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0' }}>
          <Button size="sm" variant="light" onClick={() => setExpanded((v) => !v)}>
            {expanded
              ? '收起'
              : `显示更多（共 ${totalRows} 行${data.truncated ? ' · 已截断' : ''}）`}
          </Button>
        </div>
      ) : data.truncated ? (
        <div
          style={{
            textAlign: 'center',
            fontSize: 11,
            color: 'var(--fg3)',
            padding: '6px 0'
          }}
        >
          已截断 · 仅显示前 {totalRows} 行
        </div>
      ) : null}
    </div>
  )
}

export default SampleTable
