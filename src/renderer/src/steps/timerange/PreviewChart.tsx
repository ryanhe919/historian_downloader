/**
 * PreviewChart — plain canvas line chart for up to 3 tag series.
 *
 * Kept simple on purpose: DPR-scaled canvas, per-tag color, linear grid.
 * When data is empty we fall back to <Empty variant="inline"/>.
 */
import { useEffect, useRef } from 'react'
import { Empty } from '@/components/ui'
import type { PreviewSampleResult } from '@shared/rpc-types'

export interface PreviewChartProps {
  data?: PreviewSampleResult
  height?: number
}

const LINE_COLORS = ['var(--c-primary)', 'var(--c-success)', 'var(--c-warning)']

export function PreviewChart({ data, height = 200 }: PreviewChartProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap || !data) return
    const series = data.values.slice(0, 3)
    const points = data.times.length
    if (points === 0 || series.length === 0) return

    const dpr = window.devicePixelRatio || 1
    const cssW = wrap.clientWidth || 600
    const cssH = height
    canvas.width = cssW * dpr
    canvas.height = cssH * dpr
    canvas.style.width = `${cssW}px`
    canvas.style.height = `${cssH}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cssW, cssH)

    const css = getComputedStyle(document.documentElement)
    const lineColors = LINE_COLORS.map((token) => css.getPropertyValue(token).trim() || token)
    const gridColor = css.getPropertyValue('--border-default').trim() || 'rgba(128,128,128,0.15)'
    const axisColor = css.getPropertyValue('--fg3').trim() || 'rgba(128,128,128,0.8)'

    const padL = 40
    const padR = 10
    const padT = 12
    const padB = 22
    const plotW = Math.max(10, cssW - padL - padR)
    const plotH = Math.max(10, cssH - padT - padB)

    // Flatten only the values we will draw to compute global min/max.
    let min = Infinity
    let max = -Infinity
    for (const row of series) {
      for (const v of row) {
        if (v == null || !Number.isFinite(v)) continue
        if (v < min) min = v
        if (v > max) max = v
      }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      // All null — render an empty plot.
      min = 0
      max = 1
    }
    const range = max - min || 1

    // Grid lines.
    ctx.strokeStyle = gridColor
    ctx.lineWidth = 1
    ctx.font = '10px ui-monospace, monospace'
    ctx.fillStyle = axisColor
    for (let i = 0; i <= 4; i++) {
      const y = padT + (plotH * i) / 4
      ctx.beginPath()
      ctx.moveTo(padL, y)
      ctx.lineTo(cssW - padR, y)
      ctx.stroke()
      const v = max - (range * i) / 4
      ctx.fillText(v.toFixed(2), 4, y + 3)
    }

    // One polyline per series. Null values break the line.
    series.forEach((row, idx) => {
      ctx.strokeStyle = lineColors[idx % lineColors.length]
      ctx.lineWidth = 1.75
      ctx.lineJoin = 'round'
      ctx.beginPath()
      let moved = false
      for (let i = 0; i < row.length; i++) {
        const v = row[i]
        if (v == null || !Number.isFinite(v)) {
          moved = false
          continue
        }
        const x = padL + (plotW * i) / Math.max(1, points - 1)
        const y = padT + plotH - ((v - min) / range) * plotH
        if (!moved) {
          ctx.moveTo(x, y)
          moved = true
        } else {
          ctx.lineTo(x, y)
        }
      }
      ctx.stroke()
    })
  }, [data, height])

  const empty = !data || data.times.length === 0 || data.values.length === 0

  return (
    <div ref={wrapRef} className="chart-wrap" style={{ padding: 6 }}>
      {empty ? (
        <Empty
          variant="inline"
          image="no-data"
          title="选中标签后预览"
          description="最多展示前 3 条曲线"
        />
      ) : (
        <>
          <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height }} />
          <div
            style={{
              display: 'flex',
              gap: 12,
              marginTop: 6,
              flexWrap: 'wrap',
              padding: '0 6px 2px'
            }}
          >
            {data!.tags.slice(0, 3).map((t, i) => (
              <span
                key={t.id}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 11,
                  color: 'var(--fg2)'
                }}
              >
                <span
                  style={{
                    display: 'inline-block',
                    width: 10,
                    height: 2,
                    background:
                      getComputedStyle(document.documentElement)
                        .getPropertyValue(LINE_COLORS[i % LINE_COLORS.length])
                        .trim() || LINE_COLORS[i % LINE_COLORS.length],
                    borderRadius: 1
                  }}
                />
                <span className="mono">{t.label}</span>
                {t.unit ? <span style={{ color: 'var(--fg3)' }}>({t.unit})</span> : null}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export default PreviewChart
