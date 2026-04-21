/**
 * ServerCard — a single tile in the server grid. Pressable card with
 * brand-colored icon, name + type badge, mono subtitle, and a status footer.
 */
import type { MouseEvent } from 'react'
import { Card, CardBody, Icon, Tag, Tooltip } from '@/components/ui'
import type { Server } from '@shared/domain-types'

export interface ServerCardProps {
  server: Server
  isActive: boolean
  onSelect: (id: string) => void
  onQuickTest: (server: Server) => void
}

interface StatusVisual {
  label: string
  color: 'success' | 'neutral' | 'danger'
}

function statusVisual(s: Server['status']): StatusVisual {
  switch (s) {
    case 'connected':
      return { label: '已连接', color: 'success' }
    case 'offline':
      return { label: '离线', color: 'danger' }
    case 'ready':
    default:
      return { label: '未连接', color: 'neutral' }
  }
}

export function ServerCard({
  server,
  isActive,
  onSelect,
  onQuickTest
}: ServerCardProps): React.JSX.Element {
  const isIFix = server.type === 'iFix'
  const status = statusVisual(server.status)

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
              <span
                className={`tag tag-${status.color === 'neutral' ? 'default' : status.color} dot`}
              >
                {status.label}
              </span>
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
        </div>
      </CardBody>
    </Card>
  )
}

export default ServerCard
