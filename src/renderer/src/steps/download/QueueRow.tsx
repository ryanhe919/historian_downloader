/**
 * QueueRow — one live export task card. Pause/resume/cancel hook in through
 * the mutation props so DownloadStep can keep a single RPC pipeline.
 */
import { Button, Card, CardBody, Flex, Icon, Tag, Tooltip } from '@/components/ui'
import { Progress } from '@/components/ui'
import { formatBytes, formatPercent, formatSpeed } from '@/lib/format'
import { formatRangeShort } from '@/lib/time'
import type { ExportStatus, ExportTask } from '@shared/domain-types'

export interface QueueRowProps {
  task: ExportTask
  onPause: (id: string) => void
  onResume: (id: string) => void
  onCancel: (id: string) => void
  onRemove: (id: string) => void
  onShowInFolder: (path: string) => void
}

function statusTag(status: ExportStatus): {
  label: string
  className: string
  progressVariant: 'default' | 'success' | 'warning' | 'danger'
  striped: boolean
} {
  switch (status) {
    case 'done':
      return {
        label: '已完成',
        className: 'tag tag-success dot',
        progressVariant: 'success',
        striped: false
      }
    case 'running':
      return {
        label: '下载中',
        className: 'tag tag-primary dot',
        progressVariant: 'default',
        striped: true
      }
    case 'paused':
      return {
        label: '已暂停',
        className: 'tag tag-warning dot',
        progressVariant: 'warning',
        striped: false
      }
    case 'queued':
      return {
        label: '等待中',
        className: 'tag tag-default dot',
        progressVariant: 'default',
        striped: false
      }
    case 'failed':
      return {
        label: '失败',
        className: 'tag tag-danger dot',
        progressVariant: 'danger',
        striped: false
      }
    case 'cancelled':
    default:
      return {
        label: '已取消',
        className: 'tag tag-default dot',
        progressVariant: 'default',
        striped: false
      }
  }
}

export function QueueRow({
  task,
  onPause,
  onResume,
  onCancel,
  onRemove,
  onShowInFolder
}: QueueRowProps): React.JSX.Element {
  const v = statusTag(task.status)
  const done = task.status === 'done'
  const terminal = done || task.status === 'failed' || task.status === 'cancelled'

  return (
    <Card style={{ marginBottom: 10 }}>
      <CardBody>
        <Flex align="center" gap={8} style={{ marginBottom: 6 }}>
          <Icon name="file" size={14} />
          <strong style={{ fontSize: 'var(--fs-sm)', letterSpacing: '-0.005em' }}>
            {task.name}
          </strong>
          <span className={v.className}>{v.label}</span>
          <span style={{ flex: 1 }} className="sp-right" />
          {task.status === 'running' ? (
            <Tooltip content="暂停">
              <button
                type="button"
                className="icon-btn"
                onClick={() => onPause(task.id)}
                aria-label="暂停"
              >
                <Icon name="pause" size={14} />
              </button>
            </Tooltip>
          ) : null}
          {task.status === 'paused' ? (
            <Tooltip content="继续">
              <button
                type="button"
                className="icon-btn"
                onClick={() => onResume(task.id)}
                aria-label="继续"
              >
                <Icon name="play" size={14} />
              </button>
            </Tooltip>
          ) : null}
          {(task.status === 'running' || task.status === 'paused' || task.status === 'queued') && (
            <Tooltip content="取消">
              <button
                type="button"
                className="icon-btn"
                onClick={() => onCancel(task.id)}
                aria-label="取消"
              >
                <Icon name="x" size={14} />
              </button>
            </Tooltip>
          )}
          {terminal && task.outputPath ? (
            <Tooltip content="在文件夹中显示">
              <button
                type="button"
                className="icon-btn"
                onClick={() => onShowInFolder(task.outputPath as string)}
                aria-label="在文件夹中显示"
              >
                <Icon name="folderOpen" size={14} />
              </button>
            </Tooltip>
          ) : null}
          {terminal ? (
            <Tooltip content="从队列移除">
              <button
                type="button"
                className="icon-btn"
                onClick={() => onRemove(task.id)}
                aria-label="移除"
              >
                <Icon name="trash" size={14} />
              </button>
            </Tooltip>
          ) : null}
        </Flex>

        <div
          style={{
            fontSize: 11,
            color: 'var(--fg3)',
            marginBottom: 8,
            fontVariantNumeric: 'tabular-nums'
          }}
        >
          {task.tagCount} 个标签 · {formatRangeShort(task.range)} · 段 {task.doneSegments}/
          {task.totalSegments} · <Tag size="sm">{task.format}</Tag>
        </div>

        <Progress
          value={Math.round(task.progress * 100) / 100}
          variant={v.progressVariant}
          striped={v.striped}
          animated={v.striped}
        />

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginTop: 8,
            fontSize: 11,
            color: 'var(--fg2)',
            fontVariantNumeric: 'tabular-nums',
            flexWrap: 'wrap'
          }}
        >
          <span>
            {formatBytes(task.sizeBytes)}
            {task.estimatedSizeBytes ? ` / ~${formatBytes(task.estimatedSizeBytes)}` : ''}
          </span>
          <span>{formatSpeed(task.speedBytesPerSec)}</span>
          <span style={{ marginLeft: 'auto', fontWeight: 600, color: 'var(--fg1)' }}>
            {formatPercent(task.progress)}
          </span>
        </div>

        {task.status === 'failed' && task.error ? (
          <div
            style={{
              marginTop: 8,
              padding: '6px 8px',
              background: 'rgba(201,12,80,0.08)',
              borderRadius: 6,
              fontSize: 11,
              color: 'var(--c-danger)'
            }}
          >
            {task.error}
            <Button
              size="sm"
              variant="light"
              style={{ marginLeft: 8 }}
              onClick={() => onResume(task.id)}
            >
              重试
            </Button>
          </div>
        ) : null}
      </CardBody>
    </Card>
  )
}

export default QueueRow
