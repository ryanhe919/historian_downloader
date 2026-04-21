# Historian Downloader — 架构设计

> 版本：v1.0 · 日期：2026-04-21 · 状态：待审批
> 约束：本设计不推翻已定决策（Electron + Vite + React 19 + TypeScript / JSON-RPC 2.0 over stdio / PyInstaller sidecar / @timeui 适配层 / Proficy + SQL Server + Mock 三种 adapter）。

---

## 1. 分层概览

```
┌───────────────────────────────────────────────────────────────────────┐
│                         Electron Renderer (Chromium)                   │
│  ┌───────────────────────────────────────────────────────────────┐    │
│  │  React 19 UI                                                    │    │
│  │   app/ (shell)   steps/0..3   components/ui/ (TimeUI 适配层)    │    │
│  │   hooks/useRpc  stores/*      lib/rpc-client.ts                 │    │
│  └───────────────────────┬───────────────────────────────────────┘    │
│                          │ window.hd.rpc.call / window.hd.on           │
└──────────────────────────┼────────────────────────────────────────────┘
                           │ contextBridge (contextIsolation=true)
┌──────────────────────────┼────────────────────────────────────────────┐
│                     Electron Preload (isolated world)                  │
│   暴露 { rpc.call(method, params), on(event, cb), off, platform,       │
│         dialog.pickFolder, shell.openPath, app.version }               │
└──────────────────────────┬────────────────────────────────────────────┘
                           │ ipcMain ↔ ipcRenderer (invoke/handle)
┌──────────────────────────┼────────────────────────────────────────────┐
│                        Electron Main (Node)                            │
│   ┌─────────────────┐  ┌─────────────────┐  ┌──────────────────────┐   │
│   │ WindowManager   │  │ RpcClient       │  │ SidecarSupervisor    │   │
│   │ (frameless win) │  │ id/timeout/retry│  │ spawn/kill/restart   │   │
│   └─────────────────┘  └────────┬────────┘  └──────────┬───────────┘   │
│                                 │ 行分隔 JSON              │ stdin/stdout │
│                                 ▼                         ▼             │
│                        stdin(pipe)           stdout(pipe)  stderr→log   │
└──────────────────────────┬────────────────────────────────────────────┘
                           │ UTF-8 line-delimited JSON-RPC 2.0
┌──────────────────────────┼────────────────────────────────────────────┐
│                  Python Sidecar (PyInstaller onefile)                  │
│   rpc/dispatcher.py (asyncio) → methods 注册表                          │
│      │                                                                  │
│      ├─ adapters/base.py  (BaseHistorianAdapter 抽象)                   │
│      │   ├─ adapters/proficy.py   (pywin32 + ADODB, Windows only)       │
│      │   ├─ adapters/sqlserver.py (pymssql, Windows/macOS/Linux)        │
│      │   └─ adapters/mock.py      (开发态 fallback)                     │
│      ├─ services/export_queue.py  (任务编排 + 分段)                      │
│      ├─ services/writers.py       (csv/xlsx/json 写出)                  │
│      └─ storage/db.py             (SQLite：server/task/history/settings) │
└───────────────────────────────────────────────────────────────────────┘
```

**为什么 stdio 而不是 HTTP/WebSocket**：

- 生命周期与主进程绑定，崩了就是崩了，无端口占用/防火墙/跨账户权限问题。
- 无需身份验证层，天然只允许父进程调用。
- 打包成 PyInstaller onefile 后 spawn 即可通信，不需要 `localhost:xxxx` 端口协商。
- 缺点（stdout 污染、大 payload）通过"stderr 专门走日志 / 大数据落盘不走 stdio"规避。

---

## 2. 目录结构（文件级）

### 2.1 根仓库

```
HistorianDownloader/
├── docs/
│   ├── architecture.md                  ← 本文档
│   └── rpc-contract.md                  ← JSON-RPC 契约
├── src/
│   ├── main/
│   │   ├── index.ts                     ← app 启动、createWindow（已有，需改造）
│   │   ├── window.ts                    ← frameless BrowserWindow 工厂
│   │   ├── ipc/
│   │   │   ├── rpc-bridge.ts            ← ipcMain.handle('hd:rpc') 路由到 RpcClient
│   │   │   ├── dialog.ts                ← showOpenDialog / showSaveDialog
│   │   │   └── shell.ts                 ← shell.showItemInFolder / openPath
│   │   ├── sidecar/
│   │   │   ├── supervisor.ts            ← spawn/kill/restart、backoff
│   │   │   ├── resolve-binary.ts        ← dev=python python/main.py；prod=resources/hd-sidecar(.exe)
│   │   │   └── types.ts
│   │   ├── rpc/
│   │   │   ├── client.ts                ← JSON-RPC 2.0 客户端（id 分配、pending map、超时、notification）
│   │   │   ├── line-transport.ts        ← 基于 stdin/stdout 的行分隔编解码
│   │   │   └── errors.ts                ← JSON-RPC 错误码 → JS Error 子类
│   │   └── logger.ts                    ← electron-log；sidecar stderr 接入
│   ├── preload/
│   │   ├── index.ts                     ← contextBridge.exposeInMainWorld('hd', ...)
│   │   └── index.d.ts                   ← window.hd 类型声明
│   ├── shared/                          ← main/preload/renderer 共享的 TS 类型
│   │   ├── rpc-types.ts                 ← 所有 method 的 params/result 类型
│   │   ├── domain-types.ts              ← Server/Tag/Task/History 等业务类型
│   │   └── error-codes.ts               ← -32000..-32099 应用错误码枚举
│   └── renderer/
│       ├── index.html
│       └── src/
│           ├── main.tsx
│           ├── App.tsx                  ← 已有，需重写成 shell 组装器
│           ├── app/
│           │   ├── TitleBar.tsx
│           │   ├── StepBar.tsx
│           │   ├── FooterBar.tsx
│           │   ├── TweaksPanel.tsx
│           │   └── EnvChip.tsx
│           ├── steps/
│           │   ├── connection/
│           │   │   ├── ConnectionStep.tsx
│           │   │   ├── ServerCard.tsx
│           │   │   └── ConnectionForm.tsx
│           │   ├── tags/
│           │   │   ├── TagSelectionStep.tsx
│           │   │   ├── TagTree.tsx       ← 虚拟滚动
│           │   │   ├── TagSearchList.tsx
│           │   │   └── SelectedTable.tsx
│           │   ├── timerange/
│           │   │   ├── TimeRangeStep.tsx
│           │   │   ├── PresetPills.tsx
│           │   │   ├── SamplingTabs.tsx
│           │   │   ├── SegmentSlider.tsx
│           │   │   ├── PreviewChart.tsx  ← canvas
│           │   │   └── SampleTable.tsx
│           │   └── download/
│           │       ├── DownloadStep.tsx
│           │       ├── QueueRow.tsx
│           │       └── HistoryTable.tsx
│           ├── components/ui/           ← TimeUI 适配层（见 §10）
│           │   ├── index.ts
│           │   ├── Button.tsx
│           │   ├── Card.tsx
│           │   ├── Field.tsx
│           │   ├── Input.tsx
│           │   ├── Select.tsx
│           │   ├── Checkbox.tsx
│           │   ├── Tabs.tsx
│           │   ├── Tag.tsx
│           │   ├── Badge.tsx
│           │   ├── Tree.tsx
│           │   ├── Table.tsx
│           │   ├── Progress.tsx
│           │   ├── Dialog.tsx
│           │   ├── Tooltip.tsx
│           │   ├── Icon.tsx
│           │   ├── Toast.tsx
│           │   ├── Slider.tsx
│           │   └── ScrollArea.tsx
│           ├── components/              ← 非 ui 层的可复用业务组件
│           │   ├── Stat.tsx
│           │   └── EmptyState.tsx
│           ├── hooks/
│           │   ├── useRpc.ts            ← useRpcQuery / useRpcMutation / useRpcEvent
│           │   ├── useTheme.ts
│           │   └── useSettings.ts
│           ├── stores/                  ← zustand
│           │   ├── connection.ts
│           │   ├── tags.ts
│           │   ├── timerange.ts
│           │   ├── download.ts
│           │   └── settings.ts          ← theme/accent/density
│           ├── lib/
│           │   ├── rpc.ts               ← 包一层 window.hd.rpc，暴露 typed 方法
│           │   ├── time.ts              ← preset 到 { start,end } 的展开
│           │   └── format.ts            ← 字节/行数格式化
│           ├── styles/
│           │   ├── tokens.css           ← 直接搬 colors_and_type.css（按需改路径）
│           │   ├── globals.css          ← 搬 styles.css
│           │   └── density.css          ← [data-density="compact|comfortable"] 覆盖
│           └── assets/
│               └── logo.png
├── python/                              ← 新增目录
│   ├── pyproject.toml
│   ├── main.py                          ← asyncio 入口
│   ├── rpc/
│   │   ├── __init__.py
│   │   ├── dispatcher.py                ← 方法注册 + 路由
│   │   ├── errors.py                    ← 应用错误码
│   │   └── transport.py                 ← 读 stdin line、写 stdout line
│   ├── adapters/
│   │   ├── __init__.py
│   │   ├── base.py                      ← BaseHistorianAdapter
│   │   ├── proficy.py                   ← 从 oledb.py 迁移
│   │   ├── sqlserver.py                 ← 从 views.py 迁移
│   │   ├── mock.py                      ← 内置 mock 数据
│   │   └── factory.py                   ← 根据 server.type+platform 选择
│   ├── services/
│   │   ├── export_queue.py              ← in-memory 队列 + SQLite 持久化
│   │   ├── writers.py                   ← CSV / Excel(openpyxl) / JSON 写出
│   │   ├── segmenter.py                 ← 分段策略
│   │   └── estimator.py                 ← 行数 / 体积预估
│   ├── storage/
│   │   ├── db.py                        ← sqlite3 封装（schema 见 §7.2）
│   │   └── migrations/001_init.sql
│   ├── util/
│   │   ├── logging.py                   ← 日志强制走 stderr 或文件
│   │   └── time.py
│   ├── build/
│   │   └── hd-sidecar.spec              ← PyInstaller spec
│   └── tests/
├── resources/
│   ├── icon.png
│   └── hd-sidecar/                      ← electron-builder extraResources 打进
│       ├── hd-sidecar                   ← macOS/Linux
│       └── hd-sidecar.exe               ← Windows
├── build/
├── electron-builder.yml
├── electron.vite.config.ts
└── package.json
```

---

## 3. Electron 主进程职责

### 3.1 生命周期

| 阶段                | 动作                                                                                                      |
| ------------------- | --------------------------------------------------------------------------------------------------------- |
| `app.whenReady`     | 创建主窗口 → `supervisor.start()` 启动 sidecar → 建立 RpcClient → `ready-to-show` 后展示                  |
| `before-quit`       | `supervisor.stop()`（SIGTERM，2s 未退则 SIGKILL）                                                         |
| `window-all-closed` | macOS 保留；其他平台退出                                                                                  |
| sidecar crash       | `supervisor` 指数 backoff 重启（1s → 2s → 4s → 8s，上限 30s），同时给 renderer 发 `sidecar.statusChanged` |

### 3.2 `SidecarSupervisor`（`src/main/sidecar/supervisor.ts`）

- `resolveBinary()`：
  - dev：`python3 ${projectRoot}/python/main.py`
  - prod：`path.join(process.resourcesPath, 'hd-sidecar/hd-sidecar' + (win ? '.exe' : ''))`
- `spawn` 时设置 `stdio: ['pipe','pipe','pipe']`、`windowsHide: true`；环境变量里透传 `HD_USER_DATA_DIR`（从 `app.getPath('userData')`）用于定位 SQLite。
- `stderr` 全部写入 `electron-log` 文件（便于排查 OLE/ODBC 错误）。
- 崩溃重启策略如上；若连续 5 次失败，进入"fatal"态，通知 UI 弹错误对话框。

### 3.3 `RpcClient`（`src/main/rpc/client.ts`）

- `call(method, params, { timeoutMs = 30_000 })`：
  - 分配自增 id（number，从 1 起）。
  - 写入 `{"jsonrpc":"2.0","id":N,"method":..,"params":..}\n`。
  - 在 `pending: Map<id, {resolve, reject, timer}>` 注册。
  - 超时：`clearTimeout` + `reject` + 保留 id 供后到响应丢弃时记日志。
- `notify(method, params)`：不分配 id（用于 ping/心跳）。
- 收到消息：
  - 有 `id` + `result|error` → 命中 pending 并 resolve/reject。
  - 有 `method` 无 `id` → 事件总线广播（`export.progress` 等）。
- 失败恢复：sidecar 重启后，所有 `pending` 立即 `reject(new SidecarRestartedError())`，UI 侧 hook 负责 retry。

### 3.4 IPC 对 renderer 的桥接（`src/main/ipc/rpc-bridge.ts`）

- `ipcMain.handle('hd:rpc:call', (_, method, params) => rpcClient.call(method, params))`
- 事件：`webContents.send('hd:rpc:event', { method, params })` 广播给所有窗口。
- 附加非 RPC 的主进程能力：`ipcMain.handle('hd:dialog:pickFolder')`、`ipcMain.handle('hd:shell:openPath')`。

---

## 4. Preload API 设计

```ts
// src/preload/index.d.ts
declare global {
  interface Window {
    hd: {
      rpc: {
        call<T = unknown>(
          method: string,
          params?: unknown,
          opts?: { timeoutMs?: number }
        ): Promise<T>
      }
      on<K extends keyof HdEvents>(event: K, cb: (payload: HdEvents[K]) => void): () => void
      off<K extends keyof HdEvents>(event: K, cb: (payload: HdEvents[K]) => void): void
      dialog: {
        pickFolder(opts?: { title?: string; defaultPath?: string }): Promise<string | null>
      }
      shell: {
        openPath(p: string): Promise<void>
        showInFolder(p: string): Promise<void>
      }
      platform: 'darwin' | 'win32' | 'linux'
      appVersion: string
      env: { isDev: boolean; rpcMock: boolean }
    }
  }
}

type HdEvents = {
  'historian.export.progress': ExportProgress
  'historian.export.statusChanged': ExportTask
  'historian.connection.statusChanged': ConnectionStatus
  'sidecar.statusChanged': { state: 'starting' | 'ready' | 'crashed' | 'fatal'; error?: string }
}
```

**安全**：

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true`。
- CSP `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self';`。
- 只通过 contextBridge 暴露白名单方法，renderer 不能直接访问 ipcRenderer。
- 现有 `src/main/index.ts` 里的 `sandbox: false` 必须改回 `true`。

---

## 5. JSON-RPC 2.0 over stdio 传输

### 5.1 编码

- UTF-8，每条消息一行（`\n` 结尾），中间不允许换行。
- 禁止 `\r\n`；Python 侧 `sys.stdout.reconfigure(newline='\n')`。
- 单条消息最大 1 MiB；超过视为协议违规，双向都断开重启。

### 5.2 消息类型

| 类型         | 方向           | 有 id | 结构                                              |
| ------------ | -------------- | ----- | ------------------------------------------------- |
| Request      | main → sidecar | 是    | `{jsonrpc, id, method, params}`                   |
| Response     | sidecar → main | 是    | `{jsonrpc, id, result}` 或 `{jsonrpc, id, error}` |
| Notification | 双向           | 否    | `{jsonrpc, method, params}`                       |

### 5.3 id 策略

- main 用递增 int；sidecar 内部若要回拨 main 再议（当前不需要）。
- 超时默认 30s；导出相关接口（`export.start` 等）是瞬时返回 taskId，不需要长超时。

### 5.4 大 payload 处理（关键决策）

**stdio 不承载大数据**：

- 预览接口（`preview.sample`）最多返回 2000 行，走 stdio 可接受（< 200 KiB）。
- 真正的导出：Python 侧直接写盘到 `outputDir`，前端只通过 `export.progress` 通知获知进度、字节数、段编号；不通过 stdio 回传行数据。
- 历史文件重新打开：用 `shell.openPath` / `showInFolder`，不回流内容。

**为什么不流式 stdio**：protocol 要每条 JSON 是一行，拆分重组会把简单协议复杂化；落盘方案天然支持断点续传（段文件已落盘的段可跳过），也省内存。

### 5.5 心跳

- main 每 10s 发 `system.ping`（notification，不带 id），超过 30s 未收到任何消息就判定 sidecar 卡死 → 重启。
- sidecar 启动时先发 `system.ready` 通知，main 收到后才允许 renderer 调用 RPC。

---

## 6. Python Sidecar 架构

### 6.1 启动

```python
# python/main.py 伪码
async def main():
    setup_logging_to_stderr_and_file()
    db = Storage(path=env_or_default('HD_USER_DATA_DIR'))
    dispatcher = Dispatcher()
    register_methods(dispatcher, db)          # 装配所有 historian.* 方法
    queue = ExportQueue(db, dispatcher.emit)  # emit 是 notification 推送
    await emit_ready()
    await Transport(dispatcher).run()         # 读 stdin、写 stdout
```

### 6.2 Dispatcher

- 方法注册：装饰器 `@method('historian.export.start')`，自动记录 params TypedDict。
- 执行：`await handler(params)` → 捕获异常 → 映射为 JSON-RPC error。
- 并发：使用 `asyncio.create_task` 串行化单客户端的 request，耗时方法（read_data 大批量）丢线程池（`asyncio.to_thread`）避免卡 stdin 读。

### 6.3 异常映射

| Python 异常              | error.code | error.message                     |
| ------------------------ | ---------- | --------------------------------- |
| `ConnectionTimeoutError` | -32001     | "connection timeout"              |
| `OleComUnavailable`      | -32002     | "OLE/COM provider not available"  |
| `TagNotFoundError`       | -32010     | "tag not found"                   |
| `InvalidRangeError`      | -32020     | "invalid time range"              |
| `ExportCancelled`        | -32030     | "export cancelled"                |
| `AdapterDriverError`     | -32040     | "driver error: {detail}"          |
| 未知                     | -32000     | "internal error" + 日志 traceback |

### 6.4 优雅退出

- 收到 SIGTERM（或 stdin 关闭）：
  1. 停止接受新 request。
  2. 调用 `queue.pause_all()`，把运行中任务的 checkpoint 写进 SQLite。
  3. flush stderr、关闭 SQLite。
  4. `os._exit(0)`。

### 6.5 PyInstaller 打包

- `python/build/hd-sidecar.spec` 要点：
  - `onefile=True`、`console=True`（Windows 下也保留 console，以便 stdio 管道有效；通过 `windowsHide: true` + 子进程隐藏窗口）。
  - `hiddenimports = ['win32com.client', 'pythoncom', 'pymssql', 'openpyxl', 'pandas']`。
  - macOS/Linux 的构建产物不打包 win32com。用 `sys.platform` 分支，或两个 spec 文件。
  - `--exclude-module` 掉不需要的 `tkinter`、`matplotlib`。
- 输出放到 `resources/hd-sidecar/hd-sidecar(.exe)`，由 electron-builder 的 `extraResources` 把 `resources/hd-sidecar/**` 打进。

---

## 7. Historian Adapter 抽象

### 7.1 `BaseHistorianAdapter`

```python
class BaseHistorianAdapter:
    async def test_connection(self) -> dict: ...   # {ok, latencyMs, tagCount, version}
    async def list_tag_tree(self, path: str | None) -> list[dict]: ...
    async def search_tags(self, query: str, limit: int, offset: int) -> dict: ...
    async def get_tag_meta(self, tag_id: str) -> dict: ...
    async def read_segment(
        self, tag_ids: list[str], start: datetime, end: datetime, sampling: str
    ) -> Iterator[Row]: ...
    async def close(self) -> None: ...
```

### 7.2 实现

| Adapter                   | 平台    | 依赖           | 来源                                         |
| ------------------------- | ------- | -------------- | -------------------------------------------- |
| `ProficyHistorianAdapter` | Windows | pywin32, ADODB | 迁移 `oledb.py` + `views.py` 的 iFix 分支    |
| `SqlServerAdapter`        | 跨平台  | pymssql        | 迁移 `views.py` 的 SQL Server (InTouch) 分支 |
| `MockAdapter`             | 跨平台  | 无             | 直接内置 `tagTree` 和生成的时序数据          |

### 7.3 工厂选择

```python
def create_adapter(server: ServerConfig) -> BaseHistorianAdapter:
    if os.environ.get('HD_FORCE_MOCK') == '1':
        return MockAdapter(server)
    if sys.platform != 'win32' and server.type == 'iFix':
        log.warning("iFix adapter needs Windows; falling back to Mock")
        return MockAdapter(server)
    if server.type == 'iFix':
        return ProficyHistorianAdapter(server)
    if server.type == 'InTouch':
        return SqlServerAdapter(server)
    raise UnsupportedHistorianType(server.type)
```

---

## 8. 下载任务队列

### 8.1 流程

```
export.start(params)
  → 校验（tagIds 非空、range 合法、outputDir 可写、format 支持）
  → SQLite: INSERT task(status='queued')
  → ExportQueue.enqueue(task)
  → return { taskId }
         │
         ▼
 Scheduler 单 worker 循环（可配置并发=1，避免 OLE DB 并发 COM 问题）
  loop:
    task = queue.next()  (跳过 paused/cancelled)
    for seg in segmenter.segments(task.range, task.segmentDays):
      if task.cancelled: break
      while task.paused: await sleep(0.5)
      rows = adapter.read_segment(tags, seg.start, seg.end, sampling)
      writer.append(task.outputPath, rows)
      emit('historian.export.progress', { taskId, done=seg.idx+1, total, ... })
      SQLite: UPDATE task SET progress=..., checkpoint=seg.end
    SQLite: UPDATE task SET status='done'
    SQLite: INSERT history(...)
    emit('historian.export.statusChanged', task)
```

### 8.2 为什么 SQLite 而不是 JSON 文件

- 并发写安全（WAL 模式）。大任务进行中前端刷新，读取队列不会撞写锁。
- 支持按 `created_at DESC LIMIT offset` 做分页历史查询，JSON 文件需要全量加载。
- 支持断点续传的 checkpoint 原子更新。
- `sqlite3` 是 Python 标准库，无额外依赖。
- 小应用量级下文件体积和 JSON 接近，但结构化查询能力是 JSON 比不了的。

### 8.3 表结构

```sql
-- 001_init.sql
CREATE TABLE servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,           -- 'iFix' | 'InTouch'
  host TEXT NOT NULL,
  port INTEGER,
  username TEXT,
  password_enc TEXT,            -- 本地 AES-GCM（key 派生自 machine-id，非高强度但够用）
  timeout_s INTEGER DEFAULT 15,
  tls INTEGER DEFAULT 0,
  windows_auth INTEGER DEFAULT 0,
  extra_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL,
  name TEXT NOT NULL,
  tag_ids_json TEXT NOT NULL,
  range_start TEXT NOT NULL,
  range_end TEXT NOT NULL,
  sampling TEXT NOT NULL,       -- 'raw' | '1m' | '5m' | '1h'
  segment_days INTEGER NOT NULL,
  format TEXT NOT NULL,         -- 'CSV' | 'Excel' | 'JSON'
  output_dir TEXT NOT NULL,
  output_path TEXT,             -- 完整落盘路径
  status TEXT NOT NULL,         -- 'queued'|'running'|'paused'|'done'|'cancelled'|'failed'
  total_segments INTEGER NOT NULL,
  done_segments INTEGER NOT NULL DEFAULT 0,
  progress INTEGER NOT NULL DEFAULT 0,   -- 0..100
  checkpoint TEXT,                        -- 已完成到的段结束时间
  size_bytes INTEGER DEFAULT 0,
  speed_bps INTEGER DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE history (
  id TEXT PRIMARY KEY,
  task_id TEXT,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  server_id TEXT,
  tag_count INTEGER,
  rows INTEGER,
  size_bytes INTEGER,
  range_start TEXT,
  range_end TEXT,
  format TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_history_created ON history(created_at DESC);
```

### 8.4 默认 outputDir

| 平台    | 路径                                                                                 |
| ------- | ------------------------------------------------------------------------------------ |
| Windows | `D:\Historian\Exports`（不存在则回落到 `%USERPROFILE%\Documents\Historian\Exports`） |
| macOS   | `~/Historian/Exports`                                                                |
| Linux   | `~/Historian/Exports`                                                                |

前端 Step 3 可让用户通过 `window.hd.dialog.pickFolder` 覆盖。

---

## 9. 主题 / Tweaks / 设置持久化

| 数据                              | 位置                               | 原因                   |
| --------------------------------- | ---------------------------------- | ---------------------- |
| `theme` (light/dark)              | localStorage `hd.settings.theme`   | 纯 UI，renderer 单独管 |
| `accent` (blue/purple/green/teal) | localStorage `hd.settings.accent`  | 同上                   |
| `density` (compact/comfortable)   | localStorage `hd.settings.density` | 同上                   |
| 连接配置、任务、历史              | SQLite（sidecar 侧）               | 跨进程共享，结构化查询 |

**实施**：

- 所有 UI 偏好合并进一个 `hd.settings` 命名空间（`localStorage.setItem('hd.settings', JSON.stringify({theme, accent, density}))`）。
- `useSettings()` hook 订阅 + setter；变更时写 `<html data-theme="..." data-density="..." style="--c-primary:...">`。

---

## 10. UI 组件适配层 (`components/ui/`)

### 10.1 设计原则

- **优先直接使用 `@timeui/react`**，业务代码 `import { Button, Card } from '@timeui/react'`。
- 只有 TimeUI 没有的组件才落在 `components/ui/` 里自写，接口对齐 TimeUI 命名风格。
- 业务组件用 TimeUI 的 `Layout` 原语（Box/Flex/Grid/Stack）替代散装 `<div style={{display:flex}}>`，保证主题 token 贯穿。

### 10.2 TimeUI 覆盖映射（已通过 MCP 核实）

| 设计稿需要 | 直接用 @timeui/react                                                | 额外获得能力                      |
| ---------- | ------------------------------------------------------------------- | --------------------------------- |
| 按钮       | `Button` (7 variant × 6 color × 5 size)                             | 可控圆角、loading、icon-only      |
| 卡片       | `Card` + `CardHeader/Body/Footer`；KPI 行用 `StatCard`              | accentBar、pressable、href 化整卡 |
| 表单域     | `FormField`（隐式承载 label/description/error/required）            | 统一 a11y                         |
| 输入框     | `Input`（startContent/endContent、isClearable、password 显隐）      | —                                 |
| 下拉选择   | `Select`（自定义 listbox、可搜索、可滚动）                          | —                                 |
| 复选框     | `Checkbox` + `CheckboxGroup`                                        | indeterminate                     |
| 单选       | `Radio` + `RadioGroup`（Tweaks 密度切换备选）                       | —                                 |
| 开关       | `Switch`（Tweaks 主题、TLS、Windows 集成认证）                      | iOS HIG 风格                      |
| 分段控制   | `SegmentedControl`（主题 light/dark、采样模式切换）                 | thumb 滑动动画                    |
| 滑块       | `Slider`（Step 2 分段天数）                                         | 原生 range，a11y 开箱即用         |
| 日期选择   | `DatePicker`（自定义时间范围）                                      | isClearable、showTodayButton      |
| 标签       | `Tag` (solid/soft/outline × 6 color × 3 size)                       | 可关闭、可点击                    |
| 徽章       | `Badge` (数字/dot、4 placement)                                     | 脉动动画                          |
| 表格       | `Table`（排序、行选、固定列、sticky head、密度切换、loading/empty） | 原生支持队列/历史需要的所有能力   |
| 步骤条     | **`Steps` (navigation variant，替代手写 StepBar)**                  | current/status 自动推断、可点跳转 |
| 标签页     | `Tabs`（Step 3 格式切换备选，或各步内子分页）                       | underline/pills/bordered          |
| 分页       | `Pagination`（历史列表）                                            | default/simple/mini               |
| 菜单       | `Menu`（titlebar 的"文件/编辑/视图/帮助"下拉）                      | keyboard nav、selectionMode       |
| 浮层       | `Popover`（tag 元信息悬浮、更多操作）                               | 12 placement、portal              |
| 提示       | `Tooltip`（icon-only 按钮的可访问名）                               | warm-up                           |
| 模态框     | `Modal`（确认取消任务、删除历史）                                   | focus trap、毛玻璃 overlay        |
| **抽屉**   | **`Drawer`（Tweaks 面板替换原设计稿的浮窗）**                       | 4 placement、5 size、focus trap   |
| Toast      | `ToastProvider` + `useToast()`                                      | 五个快捷方法、hover 暂停          |
| Callout    | `Callout`（连接失败、空数据等提示）                                 | 5 语义色                          |
| 空状态     | `Empty`（队列空、历史空、搜索无结果）                               | 4 preset 插画                     |
| 骨架屏     | `Skeleton` / `SkeletonGroup`（首屏）                                | shimmer/pulse                     |
| 排版       | `Typography`（Text/Heading/Paragraph/Link/Code）                    | 主题 token 贯穿                   |
| 布局       | `Layout`（Box/Flex/Grid/Stack/Container）                           | —                                 |
| 头像       | `Avatar` / `AvatarGroup`（预留扩展）                                | —                                 |
| 代码块     | `CodeBlock`（设置页/帮助页预留）                                    | 复制按钮                          |
| 搜索       | `Search`（Step 1 标签搜索顶替手写 Input）                           | 分组、快捷键 mod+k                |
| 上传       | `Upload`（保留扩展，当前设计稿未使用）                              | —                                 |

### 10.3 TimeUI 没有覆盖的组件（放 `components/ui/` 自写）

| 组件       | 为什么需要                           | 实现方案                                                                         |
| ---------- | ------------------------------------ | -------------------------------------------------------------------------------- |
| `TagTree`  | TimeUI 没有树形组件，Step 1 核心交互 | 自写递归 `.tree-row` + `@tanstack/react-virtual` 虚拟滚动                        |
| `Progress` | TimeUI 无进度条，队列 QueueRow 必需  | 自写 `.progress-track + .progress-fill`，支持 striped / 语义色                   |
| `Icon`     | TimeUI 不含图标系统                  | 基于设计稿 `icons.jsx` 的 path 字典，封装成 `<Icon name size stroke>` React 组件 |
| `TitleBar` | Electron frameless 特定              | 自写，集成 TimeUI `Menu` 作为菜单层                                              |

### 10.4 包入口

```ts
// src/renderer/src/components/ui/index.ts
// 1) 直接 re-export TimeUI 的所有可用组件
export * from '@timeui/react'

// 2) 仅导出 TimeUI 缺失的补丁组件
export { TagTree } from './TagTree'
export { Progress } from './Progress'
export { Icon } from './Icon'
```

业务代码统一 `import { Button, Card, TagTree, Progress, Icon } from '@/components/ui'`。未来 TimeUI 补上 Tree/Progress/Icon 时，把补丁组件从这个文件里删掉，业务代码零改动。

---

## 11. 开发态 Mock

两档 mock，可叠加：

| 档位         | 控制                                              | 行为                                                                                          |
| ------------ | ------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| sidecar mock | `HD_FORCE_MOCK=1` 环境变量或 server.type==='mock' | Python 端走 `MockAdapter`                                                                     |
| 纯前端 mock  | `VITE_RPC_MOCK=1` 环境变量                        | `lib/rpc.ts` 拦截 `window.hd.rpc.call`，直接返回 `__mocks__/*` 的固定 payload，不启动 sidecar |

建议 `npm run dev:ui` 脚本只跑 `electron-vite dev` 且 `VITE_RPC_MOCK=1`，给纯 UI 调试用；`npm run dev` 启完整链路（sidecar + UI）。

---

## 12. 构建与打包

### 12.1 dev 脚本

```json
// package.json scripts 新增
{
  "dev": "electron-vite dev",
  "dev:ui": "VITE_RPC_MOCK=1 electron-vite dev",
  "sidecar:dev": "python python/main.py",
  "sidecar:build": "cd python && pyinstaller build/hd-sidecar.spec --clean --noconfirm -o ../resources/hd-sidecar",
  "build:mac": "npm run sidecar:build && electron-vite build && electron-builder --mac",
  "build:win": "npm run sidecar:build && electron-vite build && electron-builder --win"
}
```

dev 模式下主进程用 `python python/main.py` 直跑，无需打包（快速迭代）。

### 12.2 electron-builder

```yaml
# electron-builder.yml 新增
extraResources:
  - from: resources/hd-sidecar
    to: hd-sidecar
    filter: ['**/*']
asarUnpack:
  - resources/**
```

### 12.3 CI 思路（留 TODO）

- matrix: `[macos-latest, windows-latest]`。
- 每平台各自 `pyinstaller` 一次（跨平台不能交叉编译 PyInstaller）。
- Windows 需要 `pip install pywin32 pymssql`；macOS 只装 `pymssql`。
- 签名：Windows 用 `CSC_LINK` EV 证书（TODO）、macOS 用 Developer ID + notarize（TODO）。

---

## 13. 安全

- `contextIsolation=true`、`sandbox=true`、`nodeIntegration=false`（要改现有 `sandbox: false`）。
- CSP：严格 `default-src 'self'`，生产不允许远程脚本。
- preload 只白名单暴露；所有 renderer → main 的调用通过 `ipcMain.handle` 统一入口。
- sidecar stdout 严禁 `print()` 非 JSON-RPC 内容——所有日志走 `logging` 模块到 stderr 或文件（由 `util/logging.py` 统一配置）。
- 密码存 SQLite 时 AES-GCM（key = machine-id + app salt），不是明文；明确说明这是"防止肩窥"级别保护，不是密码学安全。
- 自动更新（electron-updater）留 TODO，需要 publish 配置真实 URL。

---

## 14. 后续派发任务

### Frontend 工程师 A — App Shell + 主题

- [ ] `src/renderer/src/app/TitleBar.tsx`（frameless，`-webkit-app-region: drag`，traffic light 跨平台绘制；菜单栏用 TimeUI `Menu`）
- [ ] `src/renderer/src/app/StepBar.tsx` **用 TimeUI `Steps variant="navigation"` 封装**（4 步可点跳转，status 自动推断；额外展示 step.desc 走 item.description）
- [ ] `src/renderer/src/app/FooterBar.tsx`（统计 + 上一步/下一步/开始下载，用 TimeUI `Button + Layout`）
- [ ] `src/renderer/src/app/TweaksPanel.tsx` **用 TimeUI `Drawer placement="right"` 替代浮窗**；内部用 `SegmentedControl`（theme）+ 色板按钮 + `SegmentedControl`（density）
- [ ] `src/renderer/src/hooks/useTheme.ts`、`useSettings.ts`；主题变化通过 `<html data-theme=...>` 驱动 TimeUI CSS 变量
- [ ] 搬 `styles.css` + `colors_and_type.css` 到 `styles/globals.css` + `styles/tokens.css`；与 TimeUI 的 token 系统做 mapping review
- [ ] `App.tsx` 重写为 shell 组装器（根部包 `ToastProvider`）

### Frontend 工程师 B — 标签选择（Step 1）

- [ ] `steps/tags/TagTree.tsx` **自写（TimeUI 无）**：虚拟滚动用 `@tanstack/react-virtual`，行内用 TimeUI `Checkbox + Tag`
- [ ] `steps/tags/TagSearchList.tsx` 用 TimeUI `Search`（分组、快捷键 `mod+k`）；onSearch debounce 250ms 触发 `historian.searchTags`
- [ ] `steps/tags/SelectedTable.tsx` 用 TimeUI `Table`（支持排序、行选、empty 态走 `Empty`）
- [ ] `stores/tags.ts`（selectedIds 集合、搜索态）
- [ ] 接 `historian.listTagTree / searchTags / getTagMeta`

### Frontend 工程师 C — Connection + TimeRange + Download（Step 0/2/3）

- [ ] `steps/connection/*`：服务器卡片网格用 TimeUI `Card pressable` + 右上角 `Button isIconOnly`；参数表单用 `FormField + Input + Select + Switch`；测试连接用 `Button loading` + `Toast` 反馈
- [ ] `steps/timerange/*`：预设用 TimeUI `SegmentedControl`（或 `Tag clickable`）；自定义时间走 `DatePicker`；采样模式 `SegmentedControl`；分段天数 `Slider`；预览图用 canvas（TimeUI 无 chart，自写）；样本表 `Table`
- [ ] `steps/download/*`：格式选择 `SegmentedControl`（CSV/Excel/JSON）；QueueRow 每行用 `Card` 承载 + 自写 `Progress` + 暂停/继续/取消用 `Button` 组；HistoryTable 用 `Table` + 底部 `Pagination`
- [ ] 订阅 `historian.export.progress` 更新 QueueRow（`useRpcEvent`）
- [ ] 接 `historian.testConnection / export.start|pause|resume|cancel / export.history`
- [ ] 确认删除历史走 TimeUI `Modal`

### Frontend 基建工程师 — UI 层 + RPC + Store

- [ ] 安装 `@timeui/react`（由用户确认 registry / tarball / workspace 路径）
- [ ] `components/ui/index.ts` re-export TimeUI + 自写补丁（`TagTree` / `Progress` / `Icon`）
- [ ] `components/ui/TagTree.tsx`（见工程师 B 协作，基建负责通用骨架）
- [ ] `components/ui/Progress.tsx`（striped、语义色，不依赖 TimeUI）
- [ ] `components/ui/Icon.tsx`（迁移设计稿 `icons.jsx` 的 path 字典）
- [ ] TimeUI 主题 token 与 `colors_and_type.css` 做 mapping（主色 `--c-primary` 接入 TimeUI 的 color 系统）
- [ ] `lib/rpc.ts` typed wrapper，生成自 `shared/rpc-types.ts`
- [ ] `hooks/useRpc.ts`：`useRpcQuery(key, method, params)` + `useRpcMutation()` + `useRpcEvent()`
- [ ] `shared/rpc-types.ts`、`shared/domain-types.ts`、`shared/error-codes.ts` 三个类型文件（和 Python TypedDict 同步 review）
- [ ] `stores/*` 5 个 zustand slice

### Python 工程师 A — Sidecar 骨架 + Mock + 导出

- [ ] `python/main.py` asyncio 入口
- [ ] `rpc/dispatcher.py` + `rpc/transport.py` + `rpc/errors.py`
- [ ] `adapters/base.py` + `adapters/mock.py` + `adapters/factory.py`
- [ ] `services/export_queue.py`、`services/writers.py`、`services/segmenter.py`、`services/estimator.py`
- [ ] 所有 `historian.*` 方法注册与单测

### Python 工程师 B — 真实 Adapter + 存储

- [ ] `adapters/proficy.py`（从 `oledb.py` 迁移，保留 `ihtrend` SQL 模板）
- [ ] `adapters/sqlserver.py`（迁移 InTouch `OpenQuery(INSQL,...)` 模板）
- [ ] `storage/db.py` + `migrations/001_init.sql`
- [ ] 凭据加密（AES-GCM + machine-id 派生）
- [ ] Windows 环境下的集成测试脚本

### 打包工程师

- [ ] `python/build/hd-sidecar.spec`（Windows 和 macOS 两份）
- [ ] 修改 `electron-builder.yml`（`extraResources`）
- [ ] `package.json` 新增 `sidecar:build` / `dev:ui` 脚本
- [ ] GitHub Actions workflow（matrix 构建，留 TODO：签名）
- [ ] 改 `src/main/index.ts` 的 `sandbox: false` → `true`，接入 supervisor

### 未决 / 阻塞

- [x] ~~**Blocker**：`@timeui/react` 私有包获取方式~~ — **已解决**：`timeui` MCP 已接入，组件清单确认（详见 §10.2）。**仍需用户提供包的安装方式**（registry URL / tarball / workspace 路径）给基建工程师 `npm install`。
- [ ] 自动更新 publish URL 与签名证书（后续迭代）。
- [ ] iFix / InTouch 真实 DSN 与测试数据（需要客户现场样本）。
