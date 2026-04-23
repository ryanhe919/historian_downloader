// Per-method params/result types and the RpcMethodMap / RpcEventMap
// used by the main-process RpcClient and the renderer-side wrapper.

import type {
  Aggregation,
  ConnectionStatusChangedEvent,
  ExportFormat,
  ExportHistoryItem,
  ExportProgressEvent,
  ExportStatusChangedEvent,
  ExportTask,
  Quality,
  SamplingMode,
  Server,
  ServerInput,
  SystemReadyEvent,
  TagMeta,
  TagNode,
  TagValueType,
  TimeRange
} from './domain-types'

// ---------- historian.listServers ----------

export type ListServersParams = void
export type ListServersResult = Server[]

// ---------- historian.testConnection ----------

export interface TestConnectionParams {
  server: ServerInput & { id?: string }
}

export interface TestConnectionResult {
  ok: boolean
  latencyMs: number
  tagCount?: number
  version?: string
  detail?: string
}

// ---------- historian.saveServer ----------

export interface SaveServerParams {
  id?: string
  server: ServerInput & { name: string }
}

export interface SaveServerResult {
  id: string
  server: Server
}

// ---------- historian.deleteServer ----------

export interface DeleteServerParams {
  id: string
}

export interface DeleteServerResult {
  ok: true
}

// ---------- historian.listTagTree ----------

export interface ListTagTreeParams {
  serverId: string
  path?: string
  depth?: number
}

export type ListTagTreeResult = TagNode[]

// ---------- historian.searchTags ----------

export interface SearchTagsParams {
  serverId: string
  query: string
  limit?: number
  offset?: number
  filter?: {
    type?: TagValueType | 'All'
    onlySelected?: boolean
  }
}

export interface SearchTagsResult {
  items: TagNode[]
  total: number
}

// ---------- historian.getTagMeta ----------

export interface GetTagMetaParams {
  serverId: string
  tagId: string
}

export type GetTagMetaResult = TagMeta

// ---------- historian.preview.sample ----------

export interface PreviewSampleParams {
  serverId: string
  tagIds: string[]
  range: TimeRange
  sampling: SamplingMode
  maxPoints?: number
}

export interface PreviewSampleResult {
  times: string[]
  values: (number | null)[][]
  quality: Quality[][]
  tags: { id: string; label: string; unit?: string }[]
  truncated: boolean
}

// ---------- historian.export.start ----------

export interface ExportStartParams {
  serverId: string
  name?: string
  tagIds: string[]
  range: TimeRange
  sampling: SamplingMode
  aggregations?: Aggregation[]
  segmentDays: number
  format: ExportFormat
  outputDir: string
  fileNameTemplate?: string
  options?: {
    splitByTag?: boolean
    includeQuality?: boolean
    utf8Bom?: boolean
    openFolderWhenDone?: boolean
  }
}

export interface ExportStartResult {
  taskId: string
  task: ExportTask
}

// ---------- historian.export.pause / resume / cancel ----------

export interface ExportTaskIdParams {
  taskId: string
}

export interface ExportTaskOkResult {
  ok: true
  task: ExportTask
}

// ---------- historian.export.list ----------

export type ExportListParams = void

export interface ExportListResult {
  items: ExportTask[]
}

// ---------- historian.export.history ----------

export interface ExportHistoryParams {
  limit?: number
  offset?: number
  query?: string
  rangeWithinDays?: number
}

export interface ExportHistoryResult {
  items: ExportHistoryItem[]
  total: number
}

// ---------- historian.export.remove ----------

export interface ExportRemoveParams {
  historyId: string
  deleteFile?: boolean
}

export interface ExportRemoveResult {
  ok: true
}

// ---------- historian.export.openInFolder ----------

export interface ExportOpenInFolderParams {
  historyId: string
}

export interface ExportOpenInFolderResult {
  ok: true
  path: string
}

// ---------- method name constants ----------

export const RpcMethod = {
  ListServers: 'historian.listServers',
  TestConnection: 'historian.testConnection',
  SaveServer: 'historian.saveServer',
  DeleteServer: 'historian.deleteServer',
  ListTagTree: 'historian.listTagTree',
  SearchTags: 'historian.searchTags',
  GetTagMeta: 'historian.getTagMeta',
  PreviewSample: 'historian.preview.sample',
  ExportStart: 'historian.export.start',
  ExportPause: 'historian.export.pause',
  ExportResume: 'historian.export.resume',
  ExportCancel: 'historian.export.cancel',
  ExportList: 'historian.export.list',
  ExportHistory: 'historian.export.history',
  ExportRemove: 'historian.export.remove',
  ExportOpenInFolder: 'historian.export.openInFolder'
} as const

export type RpcMethodConstant = (typeof RpcMethod)[keyof typeof RpcMethod]

export interface RpcMethodMap {
  'historian.listServers': { params: ListServersParams; result: ListServersResult }
  'historian.testConnection': { params: TestConnectionParams; result: TestConnectionResult }
  'historian.saveServer': { params: SaveServerParams; result: SaveServerResult }
  'historian.deleteServer': { params: DeleteServerParams; result: DeleteServerResult }
  'historian.listTagTree': { params: ListTagTreeParams; result: ListTagTreeResult }
  'historian.searchTags': { params: SearchTagsParams; result: SearchTagsResult }
  'historian.getTagMeta': { params: GetTagMetaParams; result: GetTagMetaResult }
  'historian.preview.sample': { params: PreviewSampleParams; result: PreviewSampleResult }
  'historian.export.start': { params: ExportStartParams; result: ExportStartResult }
  'historian.export.pause': { params: ExportTaskIdParams; result: ExportTaskOkResult }
  'historian.export.resume': { params: ExportTaskIdParams; result: ExportTaskOkResult }
  'historian.export.cancel': { params: ExportTaskIdParams; result: ExportTaskOkResult }
  'historian.export.list': { params: ExportListParams; result: ExportListResult }
  'historian.export.history': { params: ExportHistoryParams; result: ExportHistoryResult }
  'historian.export.remove': { params: ExportRemoveParams; result: ExportRemoveResult }
  'historian.export.openInFolder': {
    params: ExportOpenInFolderParams
    result: ExportOpenInFolderResult
  }
}

export type RpcMethodName = keyof RpcMethodMap
export type RpcParamsOf<K extends RpcMethodName> = RpcMethodMap[K]['params']
export type RpcResultOf<K extends RpcMethodName> = RpcMethodMap[K]['result']

// ---------- event map ----------

export const RpcEvent = {
  SystemReady: 'system.ready',
  ExportProgress: 'historian.export.progress',
  ExportStatusChanged: 'historian.export.statusChanged',
  ConnectionStatusChanged: 'historian.connection.statusChanged',
  SidecarStatusChanged: 'sidecar.statusChanged'
} as const

export type RpcEventConstant = (typeof RpcEvent)[keyof typeof RpcEvent]

export interface RpcEventMap {
  'system.ready': SystemReadyEvent
  'historian.export.progress': ExportProgressEvent
  'historian.export.statusChanged': ExportStatusChangedEvent
  'historian.connection.statusChanged': ConnectionStatusChangedEvent
  'sidecar.statusChanged': import('./domain-types').SidecarStatusEvent
}

export type RpcEventName = keyof RpcEventMap

export interface RpcCallOptions {
  timeoutMs?: number
}

// ---------- JSON-RPC 2.0 wire types ----------

export interface JsonRpcRequest<P = unknown> {
  jsonrpc: '2.0'
  id: number
  method: string
  params?: P
}

export interface JsonRpcNotification<P = unknown> {
  jsonrpc: '2.0'
  method: string
  params?: P
}

export interface JsonRpcSuccess<R = unknown> {
  jsonrpc: '2.0'
  id: number
  result: R
}

export interface JsonRpcErrorPayload {
  code: number
  message: string
  data?: unknown
}

export interface JsonRpcFailure {
  jsonrpc: '2.0'
  id: number | null
  error: JsonRpcErrorPayload
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure
export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcSuccess | JsonRpcFailure
