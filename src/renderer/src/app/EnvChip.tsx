/**
 * EnvChip — compact indicator showing the currently selected Historian
 * connection ("iFix · 192.168.10.21") or "未连接" when nothing is selected
 * or the server list is empty.
 *
 * When disconnected, the chip is a focusable button that jumps back to
 * Step 0 so the user always has a one-click path to fix the state.
 *
 * Data flow:
 *   useConnectionStore.selectedServerId
 *     + useRpcQuery('historian.listServers')
 *     → find matching Server → render type + host
 */
import { useMemo } from 'react'
import { useConnectionStore } from '@/stores/connection'
import { useAppStore } from '@/stores/app'
import { useRpcQuery } from '@/hooks/useRpc'
import type { Server } from '@shared/domain-types'

export function EnvChip(): React.JSX.Element {
  const selectedId = useConnectionStore((s) => s.selectedServerId)
  const { data: servers } = useRpcQuery('historian.listServers', undefined)
  const setStep = useAppStore((s) => s.setStep)

  const current: Server | undefined = useMemo(() => {
    if (!selectedId || !servers || servers.length === 0) return undefined
    return servers.find((s) => s.id === selectedId)
  }, [selectedId, servers])

  if (current) {
    return (
      <div className="env-chip" data-state="connected" aria-live="polite">
        <span className="live-dot" />
        {current.type} · {current.host}
      </div>
    )
  }

  return (
    <button
      type="button"
      className="env-chip env-chip--button"
      data-state="disconnected"
      aria-live="polite"
      title="跳转到连接步骤"
      onClick={() => setStep(0)}
    >
      <span className="live-dot" />
      未连接
    </button>
  )
}

export default EnvChip
