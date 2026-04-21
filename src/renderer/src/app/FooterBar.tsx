/**
 * FooterBar — the persistent action row at the bottom of every step.
 *
 * Left side shows a live summary pulled from the domain stores (selected
 * tag count, preset label, segment size, export format). Right side hosts
 * the wizard nav buttons; on Step 3 the "下一步" button is swapped for
 * "开始下载", which delegates to a handler registered by Frontend C's
 * DownloadStep via `useAppStore.setOnStartDownload`.
 */
import { Button } from '@/components/ui'
import { Icon } from '@/components/ui'
import { useAppStore } from '@/stores/app'
import { useTagsStore } from '@/stores/tags'
import { useTimeRangeStore } from '@/stores/timerange'
import { useDownloadStore } from '@/stores/download'
import { PRESETS } from '@/lib/time'

export function FooterBar(): React.JSX.Element {
  const step = useAppStore((s) => s.step)
  const goPrev = useAppStore((s) => s.goPrev)
  const goNext = useAppStore((s) => s.goNext)
  const onStartDownload = useAppStore((s) => s.onStartDownload)

  const selectedCount = useTagsStore((s) => s.selectedIds.size)
  const activePreset = useTimeRangeStore((s) => s.activePreset)
  const segmentDays = useTimeRangeStore((s) => s.segmentDays)
  const format = useDownloadStore((s) => s.format)

  const presetLabel = PRESETS.find((p) => p.id === activePreset)?.label ?? '—'

  return (
    <div className="footer-bar">
      <div className="footer-info">
        <span>
          <strong>{selectedCount}</strong> 个标签
        </span>
        <span style={{ color: 'var(--border-default)' }}>·</span>
        <span>
          时间范围 <strong>{presetLabel}</strong>
        </span>
        <span style={{ color: 'var(--border-default)' }}>·</span>
        <span>
          分段 <strong>{segmentDays} 天</strong>
        </span>
        <span style={{ color: 'var(--border-default)' }}>·</span>
        <span>
          格式 <strong>{format}</strong>
        </span>
      </div>
      <div className="footer-actions">
        <Button
          size="sm"
          variant="bordered"
          disabled={step === 0}
          startIcon={<Icon name="arrowLeft" size={12} />}
          onClick={() => goPrev()}
        >
          上一步
        </Button>
        {step < 3 ? (
          <Button
            size="sm"
            color="primary"
            endIcon={<Icon name="arrowRight" size={12} />}
            onClick={() => goNext()}
          >
            下一步
          </Button>
        ) : (
          <Button
            size="sm"
            color="primary"
            startIcon={<Icon name="download" size={14} />}
            onClick={() => onStartDownload()}
          >
            开始下载
          </Button>
        )}
      </div>
    </div>
  )
}

export default FooterBar
