# Historian Downloader — JSON-RPC 契约

> 版本：v1.0 · 日期：2026-04-21 · 协议：JSON-RPC 2.0 over stdio

---

## 0. 通用约定

### 0.1 消息编码

- UTF-8、一行一条 JSON（`\n` 分隔）、不允许换行；单条最大 1 MiB。
- 所有时间字段统一为 ISO 8601（`YYYY-MM-DDTHH:mm:ss.sssZ`，UTC）。
- 时长单位：毫秒（除非显式标注）。

### 0.2 命名空间

| 前缀                 | 用途             |
| -------------------- | ---------------- |
| `system.*`           | 心跳、就绪、版本 |
| `historian.*`        | 连接、标签、预览 |
| `historian.export.*` | 导出队列与历史   |

### 0.3 应用错误码（-32000..-32099）

| code   | 常量                   | message 示例                     | 建议前端展示                               |
| ------ | ---------------------- | -------------------------------- | ------------------------------------------ |
| -32000 | INTERNAL               | "internal error"                 | "sidecar 内部错误，请查看日志"             |
| -32001 | CONNECTION_TIMEOUT     | "connection timeout after 15s"   | "连接超时，检查网络或超时配置"             |
| -32002 | OLE_COM_UNAVAILABLE    | "OLE/COM provider not available" | "当前系统不支持 iFix 驱动（需要 Windows）" |
| -32003 | CONNECTION_REFUSED     | "connection refused"             | "无法连接到主机"                           |
| -32004 | AUTH_FAILED            | "authentication failed"          | "用户名或密码错误"                         |
| -32010 | TAG_NOT_FOUND          | "tag '{id}' not found"           | "未找到标签"                               |
| -32011 | TAG_TREE_FAIL          | "failed to list tag tree"        | "读取标签树失败"                           |
| -32020 | INVALID_RANGE          | "start >= end"                   | "时间范围无效"                             |
| -32021 | INVALID_SAMPLING       | "unknown sampling: {value}"      | "采样模式无效"                             |
| -32022 | INVALID_FORMAT         | "unsupported format: {value}"    | "不支持的导出格式"                         |
| -32023 | OUTPUT_DIR_UNWRITABLE  | "cannot write to {path}"         | "输出目录不可写"                           |
| -32030 | EXPORT_CANCELLED       | "export cancelled by user"       | "任务已取消"                               |
| -32031 | EXPORT_NOT_FOUND       | "task '{id}' not found"          | "任务不存在"                               |
| -32032 | EXPORT_ALREADY_RUNNING | "task already running"           | "任务已在运行"                             |
| -32040 | ADAPTER_DRIVER         | "driver error: {detail}"         | "数据源驱动异常"                           |
| -32050 | SIDECAR_RESTARTED      | "sidecar restarted"              | "后端刚刚重启，请重试"（由 main 注入）     |

### 0.4 Request / Notification 约定

| 方法                                               | 类型                             | 超时                            |
| -------------------------------------------------- | -------------------------------- | ------------------------------- |
| 所有 `historian.*`（除 export.start 的长任务触发） | Request                          | 30s                             |
| `historian.export.start`                           | Request                          | 5s（只是入队，立即返回 taskId） |
| `system.ping`                                      | Notification                     | n/a                             |
| `historian.export.progress`                        | Notification（sidecar → main）   | n/a                             |
| `historian.export.statusChanged`                   | Notification                     | n/a                             |
| `historian.connection.statusChanged`               | Notification                     | n/a                             |
| `system.ready`                                     | Notification（sidecar 启动完成） | n/a                             |

---

## 1. 连接管理

### 1.1 `historian.listServers`

**描述**：列出已保存的服务器配置。

**params**: `void`

**result**: `Server[]`

```ts
// shared/domain-types.ts
type HistorianType = 'iFix' | 'InTouch'
type ConnStatus = 'connected' | 'ready' | 'offline'

interface Server {
  id: string
  name: string
  type: HistorianType
  host: string
  port?: number
  username?: string
  hasPassword: boolean // 不回传密码本体
  timeoutS: number
  tls: boolean
  windowsAuth: boolean
  version?: string
  status: ConnStatus
  tagCount?: number
  createdAt: string
  updatedAt: string
}
```

```python
# python 对应 TypedDict
class ServerTD(TypedDict):
    id: str
    name: str
    type: Literal['iFix', 'InTouch']
    host: str
    port: NotRequired[int]
    username: NotRequired[str]
    hasPassword: bool
    timeoutS: int
    tls: bool
    windowsAuth: bool
    version: NotRequired[str]
    status: Literal['connected', 'ready', 'offline']
    tagCount: NotRequired[int]
    createdAt: str
    updatedAt: str
```

**errors**: `-32000`

---

### 1.2 `historian.testConnection`

**描述**：测试连接；不修改 DB。

**params**:

```ts
interface TestConnectionParams {
  server: ServerInput // 未保存的新配置也能测
}
interface ServerInput {
  type: HistorianType
  host: string
  port?: number
  username?: string
  password?: string // 明文（仅 RPC 内，之后不落盘）
  timeoutS?: number
  tls?: boolean
  windowsAuth?: boolean
}
```

**result**:

```ts
interface TestConnectionResult {
  ok: boolean
  latencyMs: number
  tagCount?: number
  version?: string
  detail?: string // ok=false 时的补充信息
}
```

**errors**: `-32001, -32002, -32003, -32004, -32040`

---

### 1.3 `historian.saveServer`

**描述**：新建或覆盖保存服务器配置。密码会 AES-GCM 加密后入库。

**params**:

```ts
interface SaveServerParams {
  id?: string // 未传则新建，返回新生成 id
  server: ServerInput & { name: string }
}
```

**result**: `{ id: string; server: Server }`

**errors**: `-32000, -32020`（name 为空等校验）

---

### 1.4 `historian.deleteServer`

**params**: `{ id: string }`
**result**: `{ ok: true }`
**errors**: `-32000`

---

## 2. 标签浏览与搜索

### 2.1 `historian.listTagTree`

**描述**：懒加载树形结构；`path` 为空返回根层级。

**params**:

```ts
interface ListTagTreeParams {
  serverId: string
  path?: string // 例如 'line-a/line-a-boiler'；省略表示根
  depth?: number // 默认 1；首次拉根推荐 2
}
```

**result**: `TagNode[]`

```ts
interface TagNode {
  id: string // 完整路径或稳定 id
  label: string
  kind: 'folder' | 'leaf'
  count?: number // folder：子孙 leaf 数
  hasChildren?: boolean // folder：是否有下一层
  desc?: string // leaf
  unit?: string // leaf
  type?: 'Analog' | 'Digital' // leaf
  dataType?: string // leaf：原始 DB 类型
}
```

**errors**: `-32011, -32040`

---

### 2.2 `historian.searchTags`

**描述**：跨层级按 label/desc 模糊搜索；分页。

**params**:

```ts
interface SearchTagsParams {
  serverId: string
  query: string
  limit?: number // 默认 100，最大 500
  offset?: number
  filter?: {
    type?: 'Analog' | 'Digital' | 'All'
    onlySelected?: boolean // 客户端拼 ID list 时给后端作 hint，可忽略
  }
}
```

**result**:

```ts
interface SearchTagsResult {
  items: TagNode[] // 只含 leaf
  total: number
}
```

**errors**: `-32011`

---

### 2.3 `historian.getTagMeta`

**params**: `{ serverId: string; tagId: string }`

**result**:

```ts
interface TagMeta extends TagNode {
  min?: number
  max?: number
  precision?: number
  description?: string
  sampleIntervalMs?: number
  firstTimestamp?: string
  lastTimestamp?: string
}
```

**errors**: `-32010`

---

## 3. 预览 / 样本

### 3.1 `historian.preview.sample`

**描述**：返回小段样本供 Step 2 图表和样本表格；结果行数硬上限 2000，避免 stdio 堵塞。

**params**:

```ts
interface PreviewSampleParams {
  serverId: string
  tagIds: string[] // 最多 10
  range: { start: string; end: string }
  sampling: 'raw' | '1m' | '5m' | '1h'
  maxPoints?: number // 默认 240
}
```

**result**:

```ts
interface PreviewSampleResult {
  times: string[] // 长度 N
  values: (number | null)[][] // shape [tags][N]
  quality: ('Good' | 'Uncertain' | 'Bad')[][] // shape [tags][N]
  tags: { id: string; label: string; unit?: string }[]
  truncated: boolean // 是否触发了 maxPoints 截断
}
```

**errors**: `-32010, -32020, -32021, -32040`

---

## 4. 导出 / 队列

### 4.1 `historian.export.start`

**描述**：入队一个导出任务；立即返回 taskId，真实进度通过 `export.progress` 推送。

**params**:

```ts
interface ExportStartParams {
  serverId: string
  name?: string // 默认 'export_{YYYYMMDD_HHmmss}'
  tagIds: string[] // 非空
  range: { start: string; end: string }
  sampling: 'raw' | '1m' | '5m' | '1h'
  aggregations?: ('avg' | 'min' | 'max' | 'last')[] // 非 raw 时有效
  segmentDays: number // 1..30
  format: 'CSV' | 'Excel' | 'JSON'
  outputDir: string
  fileNameTemplate?: string // 默认 '{name}_{start}_{end}.{ext}'
  options?: {
    splitByTag?: boolean
    includeQuality?: boolean
    utf8Bom?: boolean
    openFolderWhenDone?: boolean
  }
}
```

**result**: `{ taskId: string; task: ExportTask }`

**errors**: `-32010, -32020, -32021, -32022, -32023, -32040`

---

### 4.2 `historian.export.pause` / `.resume` / `.cancel`

**params**: `{ taskId: string }`

**result**: `{ ok: true; task: ExportTask }`

**errors**: `-32031, -32032`

---

### 4.3 `historian.export.list`

**描述**：当前队列快照（活动任务 + 已完成但未清理）。

**params**: `void`

**result**: `{ items: ExportTask[] }`

```ts
interface ExportTask {
  id: string
  serverId: string
  name: string
  tagCount: number
  range: { start: string; end: string }
  sampling: string
  segmentDays: number
  totalSegments: number
  doneSegments: number
  progress: number // 0..100
  status: 'queued' | 'running' | 'paused' | 'done' | 'cancelled' | 'failed'
  speedBytesPerSec?: number
  sizeBytes?: number
  estimatedSizeBytes?: number
  outputPath?: string
  format: 'CSV' | 'Excel' | 'JSON'
  error?: string
  createdAt: string
  updatedAt: string
}
```

---

### 4.4 `historian.export.history`

**params**:

```ts
interface ExportHistoryParams {
  limit?: number // 默认 50
  offset?: number
  query?: string // 按 name 模糊
  rangeWithinDays?: number // 默认 30
}
```

**result**:

```ts
interface ExportHistoryResult {
  items: ExportHistoryItem[]
  total: number
}
interface ExportHistoryItem {
  id: string
  name: string
  path: string
  serverId?: string
  tagCount: number
  rows: number
  sizeBytes: number
  range: { start: string; end: string }
  format: 'CSV' | 'Excel' | 'JSON'
  createdAt: string
  exists: boolean // 本地文件是否仍在
}
```

---

### 4.5 `historian.export.remove`

**描述**：从历史记录删除；可选择同时删除磁盘文件。

**params**: `{ historyId: string; deleteFile?: boolean }`

**result**: `{ ok: true }`

**errors**: `-32031`（记录不存在）

---

### 4.6 `historian.export.openInFolder`

**描述**：在系统资源管理器中定位文件。实际动作由 main 进程的 `shell.showItemInFolder` 执行，但统一封装成 RPC 简化前端调用。

**params**: `{ historyId: string }`

**result**: `{ ok: true; path: string }`

**errors**: `-32031`

> 实现注意：Python sidecar 只返回 `path`；真正调用 `shell.showItemInFolder` 由 `RpcClient` 拦截这个 method 后在 main 侧执行。或者让前端直接调 `window.hd.shell.showInFolder(path)`（推荐后者，保持职责清晰）。

---

## 5. 通知（sidecar → main → renderer）

### 5.1 `historian.export.progress`

**频率**：至少每 500ms 一次（仅 running 任务），段切换时立即一次。

```ts
interface ExportProgressEvent {
  taskId: string
  progress: number // 0..100
  doneSegments: number
  totalSegments: number
  currentSegment?: { index: number; start: string; end: string }
  speedBytesPerSec: number
  sizeBytes: number
  estimatedSizeBytes?: number
  rowsWritten: number
}
```

### 5.2 `historian.export.statusChanged`

```ts
interface ExportStatusChangedEvent {
  task: ExportTask // 新状态全量快照
}
```

### 5.3 `historian.connection.statusChanged`

```ts
interface ConnectionStatusChangedEvent {
  serverId: string
  status: 'connected' | 'ready' | 'offline'
  latencyMs?: number
  error?: string
}
```

### 5.4 `system.ready` (sidecar → main)

启动完成后发一次，main 收到后才允许向 renderer 开放 RPC。

```ts
interface SystemReadyEvent {
  version: string // sidecar 版本
  pythonVersion: string
  platform: 'darwin' | 'win32' | 'linux'
  adapters: { proficy: boolean; sqlserver: boolean; mock: true }
  userDataDir: string
}
```

---

## 6. 方法速查表

| Method                               | Request/Event        | Result                         | 错误码                 |
| ------------------------------------ | -------------------- | ------------------------------ | ---------------------- |
| `system.ping`                        | Notification         | —                              | —                      |
| `system.ready`                       | Event (sidecar→main) | SystemReadyEvent               | —                      |
| `historian.listServers`              | Request              | `Server[]`                     | -32000                 |
| `historian.testConnection`           | Request              | `TestConnectionResult`         | -32001..-32004, -32040 |
| `historian.saveServer`               | Request              | `{id, server}`                 | -32000, -32020         |
| `historian.deleteServer`             | Request              | `{ok}`                         | -32000                 |
| `historian.listTagTree`              | Request              | `TagNode[]`                    | -32011, -32040         |
| `historian.searchTags`               | Request              | `{items, total}`               | -32011                 |
| `historian.getTagMeta`               | Request              | `TagMeta`                      | -32010                 |
| `historian.preview.sample`           | Request              | `PreviewSampleResult`          | -32010..-32040         |
| `historian.export.start`             | Request              | `{taskId, task}`               | -32010..-32040         |
| `historian.export.pause`             | Request              | `{ok, task}`                   | -32031, -32032         |
| `historian.export.resume`            | Request              | `{ok, task}`                   | -32031, -32032         |
| `historian.export.cancel`            | Request              | `{ok, task}`                   | -32031                 |
| `historian.export.list`              | Request              | `{items}`                      | -32000                 |
| `historian.export.history`           | Request              | `{items, total}`               | -32000                 |
| `historian.export.remove`            | Request              | `{ok}`                         | -32031                 |
| `historian.export.openInFolder`      | Request              | `{ok, path}`                   | -32031                 |
| `historian.export.progress`          | Event                | `ExportProgressEvent`          | —                      |
| `historian.export.statusChanged`     | Event                | `ExportStatusChangedEvent`     | —                      |
| `historian.connection.statusChanged` | Event                | `ConnectionStatusChangedEvent` | —                      |

---

## 7. 共享类型落位

- TypeScript 定义统一放 `src/shared/rpc-types.ts` 和 `src/shared/domain-types.ts`。
- Python TypedDict 放 `python/rpc/types.py`；字段名采用 `camelCase`（跨语言一致）。
- 错误码双方维护 `shared/error-codes.ts` + `python/rpc/errors.py`，CI 里加 lint 检查两边数值/名字保持一致。
