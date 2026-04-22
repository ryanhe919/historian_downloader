/**
 * ServerCard — a single tile in the server grid. Pressable card with
 * brand-colored icon, name + type badge, mono subtitle, and a status footer.
 */
import type { MouseEvent } from 'react'
import { Card, CardBody, Icon, Tag, Tooltip } from '@/components/ui'
import type { Server } from '@shared/domain-types'
import { useConnectionStore, type RuntimeStatus } from '@/stores/connection'

export interface ServerCardProps {
  server: Server
  isActive: boolean
  onSelect: (id: string) => void
  onQuickTest: (server: Server) => void
  /** Request deletion — parent decides whether to confirm and invoke RPC. */
  onDelete?: (server: Server) => void
}

interface StatusVisual {
  label: string
  // Tag color keys supported by the TimeUI palette we use here.
  color: 'success' | 'neutral' | 'danger' | 'primary'
}

/**
 * Fallback mapping from the persisted `server.status` to a soft badge.
 * Intentionally collapses `offline` + `ready` into a neutral "未连接" — the
 * sidecar can't tell whether a fresh row has ever been tested, so showing a
 * red "离线" badge on a just-saved server was alarming noise.
 */
function statusVisual(s: Server['status']): StatusVisual {
  switch (s) {
    case 'connected':
      return { label: '已连接', color: 'success' }
    case 'ready':
    case 'offline':
    default:
      return { label: '未连接', color: 'neutral' }
  }
}

function runtimeVisual(r: RuntimeStatus): StatusVisual {
  switch (r) {
    case 'testing':
      return { label: '测试中…', color: 'primary' }
    case 'connected':
      return { label: '已连接', color: 'success' }
    case 'failed':
      return { label: '连接失败', color: 'danger' }
  }
}

function Dot(): React.JSX.Element {
  return (
    <span
      aria-hidden
      style={{
        width: 6,
        height: 6,
        borderRadius: '50%',
        background: 'currentColor',
        display: 'inline-block'
      }}
    />
  )
}

export function ServerCard({
  server,
  isActive,
  onSelect,
  onQuickTest,
  onDelete
}: ServerCardProps): React.JSX.Element {
  const isIFix = server.type === 'iFix'
  const runtime = useConnectionStore((s) => s.runtimeStatus.get(server.id))
  // Runtime overlay (session-scoped) beats the persisted `server.status`.
  const status: StatusVisual = runtime ? runtimeVisual(runtime) : statusVisual(server.status)

  return (
    <Card
      isPressable
      onPress={() => onSelect(server.id)}
      style={{
        borderColor: isActive ? 'var(--c-primary)' : undefined,
        boxShadow: isActive ? '0 0 0 3px rgba(0,111,238,0.15)' : undefined,
        transition: 'all 160ms'
      }}
      aria-label={`选择 ${server.name}`}
    >
      <CardBody>
        <div style={{ display: 'flex', gap: 14 }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: isIFix ? 'rgba(0,111,238,0.1)' : 'rgba(120,40,200,0.12)',
              color: isIFix ? '#0055b8' : '#5b1f9c'
            }}
          >
            <Icon name="database" size={22} />
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                style={{
                  fontSize: 'var(--fs-md)',
                  fontWeight: 600,
                  letterSpacing: '-0.01em'
                }}
              >
                {server.name}
              </span>
              <Tag size="sm" color={isIFix ? 'primary' : 'secondary'}>
                {server.type}
              </Tag>
            </div>
            <div className="mono" style={{ marginTop: 4, fontSize: 11 }}>
              {server.host}
              {server.version ? ` · ${server.version}` : ''}
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                marginTop: 10
              }}
            >
              <Tag size="sm" variant="soft" color={status.color} startContent={<Dot />}>
                {status.label}
              </Tag>
              <span
                style={{
                  fontSize: 11,
                  color: 'var(--fg3)',
                  fontVariantNumeric: 'tabular-nums'
                }}
              >
                {(server.tagCount ?? 0).toLocaleString()} 个标签
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            <Tooltip content="测试连接">
              <button
                type="button"
                className="icon-btn"
                onClick={(e: MouseEvent<HTMLButtonElement>) => {
                  e.stopPropagation()
                  onQuickTest(server)
                }}
                aria-label="测试连接"
              >
                <Icon name="zap" size={14} />
              </button>
            </Tooltip>
            {onDelete && (
              <Tooltip content="删除连接">
                <button
                  type="button"
                  className="icon-btn icon-btn--danger"
                  onClick={(e: MouseEvent<HTMLButtonElement>) => {
                    e.stopPropagation()
                    onDelete(server)
                  }}
                  aria-label={`删除 ${server.name}`}
                >
                  <Icon name="trash" size={14} />
                </button>
              </Tooltip>
            )}
          </div>
        </div>
      </CardBody>
    </Card>
  )
}

export default ServerCard
