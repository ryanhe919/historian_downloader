/**
 * Cascading cleanup helpers — invoked when a piece of state upstream is
 * removed and everything downstream is no longer meaningful.
 *
 * The wizard is strictly sequential:
 *   Step 0 Connection → Step 1 Tags → Step 2 TimeRange → Step 3 Download
 *
 * So deleting the selected server invalidates all tag selections (tag IDs
 * are server-scoped); clearing tags leaves TimeRange/Download settings
 * technically usable but the "开始下载" prereq guard will block them.
 * TimeRange has no direct downstream state (Step 3's output-dir / format
 * are format-specific, not server-specific).
 *
 * The in-memory `tasks` map in the download store is NOT cleared here —
 * running/finished tasks survive server deletion by design (the sidecar
 * stores the original serverId, and history records keep pointing at the
 * old export files even after the source server goes away). The task
 * list simply renders "server deleted" fallback copy for orphaned rows.
 */
import { useConnectionStore } from '@/stores/connection'
import { useTagsStore } from '@/stores/tags'
import { useTimeRangeStore } from '@/stores/timerange'

/**
 * Called when a server is deleted or deselected in a way that should
 * discard all downstream selections (tag picks, custom time range).
 */
export function clearDownstreamFromConnection(): void {
  useTagsStore.getState().clearSelection()
  useTimeRangeStore.getState().reset()
}

/**
 * Called after `clearSelection` in Step 1 if the caller wants to also
 * reset Step 2 (so the user can start a fresh selection without
 * carrying over a custom date range that may no longer make sense).
 */
export function clearDownstreamFromTags(): void {
  useTimeRangeStore.getState().reset()
}

/**
 * Called when the user picks a _different_ server — tag IDs don't
 * transfer across servers, so drop them. Time range settings survive
 * intentionally (they're generic "last 24h" etc. presets).
 */
export function onConnectionChanged(nextServerId: string | null): void {
  const prev = useConnectionStore.getState().selectedServerId
  if (prev === nextServerId) return
  // Tag IDs are server-specific; they must not leak across servers.
  useTagsStore.getState().clearSelection()
}
