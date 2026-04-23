// Domain model types shared between main, preload and renderer.
// Field names are camelCase to match the JSON-RPC contract.

export type HistorianType = 'iFix' | 'InTouch'

export type ConnStatus = 'connected' | 'ready' | 'offline'

export type SamplingMode = `${number}m` | 'raw' | '1h'

export type ExportFormat = 'CSV' | 'Excel' | 'JSON'

export type ExportStatus = 'queued' | 'running' | 'paused' | 'done' | 'cancelled' | 'failed'

export type TagKind = 'folder' | 'leaf'

export type TagValueType = 'Analog' | 'Digital'

export type Quality = 'Good' | 'Uncertain' | 'Bad'

export type Aggregation = 'avg' | 'min' | 'max' | 'last'

export interface TimeRange {
  start: string
  end: string
}

export interface Server {
  id: string
  name: string
  type: HistorianType
  host: string
  port?: number
  username?: string
  hasPassword: boolean
  timeoutS: number
  tls: boolean
  windowsAuth: boolean
  version?: string
  status: ConnStatus
  tagCount?: number
  createdAt: string
  updatedAt: string
}

export interface ServerInput {
  type: HistorianType
  host: string
  port?: number
  username?: string
  password?: string
  timeoutS?: number
  tls?: boolean
  windowsAuth?: boolean
}

export interface TagNode {
  id: string
  label: string
  kind: TagKind
  count?: number
  hasChildren?: boolean
  desc?: string
  unit?: string
  type?: TagValueType
  dataType?: string
  /**
   * Dot-joined path from tree root to this node (folder labels + own label),
   * e.g. "生产线A.水泵.FIC-1001". Populated by the renderer when walking the
   * tag tree; omitted for manually-added tags (paste flow) that have no
   * tree position. Display only — the tag id is still the wire identifier.
   */
  path?: string
}

export interface TagMeta extends TagNode {
  min?: number
  max?: number
  precision?: number
  description?: string
  sampleIntervalMs?: number
  firstTimestamp?: string
  lastTimestamp?: string
}

export interface ExportTask {
  id: string
  serverId: string
  name: string
  tagCount: number
  range: TimeRange
  sampling: string
  segmentDays: number
  totalSegments: number
  doneSegments: number
  progress: number
  status: ExportStatus
  speedBytesPerSec?: number
  sizeBytes?: number
  estimatedSizeBytes?: number
  outputPath?: string
  format: ExportFormat
  error?: string
  createdAt: string
  updatedAt: string
}

export interface ExportHistoryItem {
  id: string
  name: string
  path: string
  serverId?: string
  tagCount: number
  rows: number
  sizeBytes: number
  range: TimeRange
  format: ExportFormat
  createdAt: string
  exists: boolean
}

export interface ExportProgressEvent {
  taskId: string
  progress: number
  doneSegments: number
  totalSegments: number
  currentSegment?: { index: number; start: string; end: string }
  speedBytesPerSec: number
  sizeBytes: number
  estimatedSizeBytes?: number
  rowsWritten: number
}

export interface ExportStatusChangedEvent {
  task: ExportTask
}

export interface ConnectionStatusChangedEvent {
  serverId: string
  status: ConnStatus
  latencyMs?: number
  error?: string
}

export interface SystemReadyEvent {
  version: string
  pythonVersion: string
  platform: 'darwin' | 'win32' | 'linux'
  adapters: { proficy: boolean; sqlserver: boolean; mock: true }
  userDataDir: string
}

export type SidecarState = 'starting' | 'ready' | 'crashed' | 'fatal' | 'stopped'

export interface SidecarStatusEvent {
  state: SidecarState
  error?: string
}

// ---- Auto-update (Windows only) ----

export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface UpdateStatusPayload {
  phase: UpdatePhase
  version?: string
  releaseDate?: string
  releaseNotes?: string | null
  progress?: {
    percent: number
    bytesPerSecond: number
    transferred: number
    total: number
  }
  error?: string
}

export interface UpdateCheckResult {
  updateAvailable: boolean
  version?: string
  releaseDate?: string
  releaseNotes?: string | null
}
