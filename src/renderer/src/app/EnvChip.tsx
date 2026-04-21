/**
 * EnvChip — compact indicator showing the currently selected Historian
 * connection ("iFix · 192.168.10.21") or "未连接" when nothing is selected
 * or the server list is empty.
 *
 * Data flow:
 *   useConnectionStore.selectedServerId
 *     + useRpcQuery('historian.listServers')
 *     → find matching Server → render type + host
 */
import { useMemo } from 'react'
import { useConnectionStore } from '@/stores/connection'
import { useRpcQuery } from '@/hooks/useRpc'
import type { Server } from '@shared/domain-types'

export function EnvChip(): React.JSX.Element {
  const selectedId = useConnectionStore((s) => s.selectedServerId)
  const { data: servers } = useRpcQuery('historian.listServers', undefined)

  const current: Server | undefined = useMemo(() => {
    if (!selectedId || !servers || servers.length === 0) return undefined
    return servers.find((s) => s.id === selectedId)
  }, [selectedId, servers])

  return (
    <div className="env-chip" aria-live="polite">
      <span className="live-dot" />
      {current ? `${current.type} · ${current.host}` : '未连接'}
    </div>
  )
}

export default EnvChip
