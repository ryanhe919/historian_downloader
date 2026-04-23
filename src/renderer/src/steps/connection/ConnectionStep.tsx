/**
 * Step 0 — Connection. Grid of saved Historian servers + a parameter form.
 *
 * Frontend A is expected to mount this in App.tsx for `step === 0`.
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import {
  Button,
  Empty,
  Grid,
  Icon,
  Input,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Skeleton,
  useToast
} from '@/components/ui'
import { useRpcMutation, useRpcQuery } from '@/hooks/useRpc'
import { isRpcError } from '@/lib/rpc'
import { clearDownstreamFromConnection } from '@/lib/cascade'
import { useConnectionStore } from '@/stores/connection'
import { ErrorCode } from '@shared/error-codes'
import type { Server } from '@shared/domain-types'
import { ConnectionForm } from './ConnectionForm'
import { ServerCard } from './ServerCard'
import { EMPTY_DRAFT, type ConnectionDraft } from './types'

/** Map application error codes to the Chinese copy mandated by rpc-contract §0.3. */
function errorMessage(err: unknown): string {
  if (!isRpcError(err)) return err instanceof Error ? err.message : '未知错误'
  switch (err.code) {
    case ErrorCode.CONNECTION_TIMEOUT:
      return '连接超时，检查网络或超时配置'
    case ErrorCode.OLE_COM_UNAVAILABLE:
      return '当前系统不支持 iFix 驱动（需要 Windows）'
    case ErrorCode.CONNECTION_REFUSED:
      return '无法连接到主机'
    case ErrorCode.AUTH_FAILED:
      return '用户名或密码错误'
    case ErrorCode.ADAPTER_DRIVER:
      return '数据源驱动异常'
    case ErrorCode.INVALID_RANGE:
      return '字段校验失败'
    case ErrorCode.SERVER_NOT_FOUND:
      return '该服务器不存在或已被删除，请刷新列表'
    case ErrorCode.SIDECAR_RESTARTED:
      return '后端刚刚重启，请重试'
    default:
      return err.message || 'sidecar 内部错误，请查看日志'
  }
}

function serverToDraft(s: Server): ConnectionDraft {
  return {
    name: s.name,
    type: s.type,
    host: s.host,
    port: s.port,
    username: s.username,
    password: '', // never echo back passwords — user types a new one if they want to update
    timeoutS: s.timeoutS,
    tls: s.tls,
    windowsAuth: s.windowsAuth,
    savePassword: s.hasPassword
  }
}

export function ConnectionStep(): React.JSX.Element {
  const toast = useToast()
  const selectedServerId = useConnectionStore((s) => s.selectedServerId)
  const setSelectedServerId = useConnectionStore((s) => s.setSelectedServerId)
  const setRuntimeStatus = useConnectionStore((s) => s.setRuntimeStatus)

  const { data, loading, error, refetch } = useRpcQuery('historian.listServers', undefined)
  const servers = useMemo<Server[]>(() => data ?? [], [data])

  const [search, setSearch] = useState('')
  const [draftOverride, setDraftOverride] = useState<ConnectionDraft | null>(null)
  const formRef = useRef<HTMLDivElement | null>(null)

  // `editingId` is derived from the zustand-owned `selectedServerId`; the
  // form shows either the selected server's saved fields (edit mode) or an
  // empty draft (new mode). Previously a second useState + a render-time
  // setState hack caused timing issues where "新建连接" appeared to do
  // nothing (the render-time branch races handleNew's own setState).
  const editingId = selectedServerId

  const draft = useMemo<ConnectionDraft>(() => {
    if (draftOverride) return draftOverride
    if (!selectedServerId) return EMPTY_DRAFT
    const found = servers.find((s) => s.id === selectedServerId)
    return found ? serverToDraft(found) : EMPTY_DRAFT
  }, [draftOverride, selectedServerId, servers])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return servers
    return servers.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.host.toLowerCase().includes(q) ||
        s.type.toLowerCase().includes(q)
    )
  }, [servers, search])

  const testMut = useRpcMutation('historian.testConnection')
  const saveMut = useRpcMutation('historian.saveServer')
  const deleteMut = useRpcMutation('historian.deleteServer')

  // Pending deletion — set by the trash icon / form "删除" button;
  // a Modal reads this to confirm. `null` = closed.
  const [pendingDelete, setPendingDelete] = useState<Server | null>(null)

  const handleNew = useCallback(() => {
    // Clearing the selection drops any local draft override, so the derived
    // form state falls back to a fresh EMPTY_DRAFT. We also scroll + focus
    // the form so the user has an immediate visible cue that they're now
    // editing a brand-new connection.
    setSelectedServerId(null)
    setDraftOverride(null)
    requestAnimationFrame(() => {
      const el = formRef.current
      if (!el) return
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      const nameInput = el.querySelector<HTMLInputElement>('input[aria-label="连接名称"]')
      nameInput?.focus()
    })
  }, [setSelectedServerId])

  const handleSelect = useCallback(
    (id: string) => {
      // Switching to a different server invalidates the previously-picked
      // tag ids (tag ids are server-scoped); clear the downstream tag
      // selection so Step 1 starts fresh for the new server.
      const prev = useConnectionStore.getState().selectedServerId
      if (prev && prev !== id) {
        // Only drop tags, not time-range — time presets are generic.
        clearDownstreamFromConnection()
      }
      if (prev !== id) {
        setDraftOverride(null)
      }
      setSelectedServerId(id)
    },
    [setSelectedServerId]
  )

  const handleAskDelete = useCallback((server: Server) => {
    setPendingDelete(server)
  }, [])

  const handleConfirmDelete = useCallback(async () => {
    const target = pendingDelete
    if (!target) return
    try {
      await deleteMut.mutate({ id: target.id })
      const isSelected = selectedServerId === target.id
      if (isSelected) {
        // Remove downstream state only when the _selected_ server goes
        // away. Deleting an unrelated row in the grid shouldn't blow away
        // the user's tag/time picks for the currently-selected one.
        setSelectedServerId(null)
        clearDownstreamFromConnection()
      }
      toast.success(`${target.name} 已删除`, { title: '连接已删除' })
      setPendingDelete(null)
      await refetch()
    } catch (e) {
      toast.error(errorMessage(e), { title: '删除失败' })
    }
  }, [pendingDelete, deleteMut, selectedServerId, setSelectedServerId, refetch, toast])

  const handleTest = useCallback(
    async (override?: ConnectionDraft | Server) => {
      const isServer = !!override && !('password' in override)
      const input: ConnectionDraft = isServer
        ? serverToDraft(override as Server)
        : override
          ? (override as ConnectionDraft)
          : draft
      // `testing` / `connected` / `failed` overlay only makes sense for a
      // persisted server row (we can't badge an unsaved draft).
      const statusTargetId = isServer ? (override as Server).id : editingId
      if (statusTargetId) setRuntimeStatus(statusTargetId, 'testing')
      try {
        const res = await testMut.mutate({
          server: {
            id: statusTargetId ?? undefined,
            type: input.type,
            host: input.host,
            port: input.port,
            username: input.username,
            password: input.password || undefined,
            timeoutS: input.timeoutS,
            tls: input.tls,
            windowsAuth: input.windowsAuth
          }
        })
        if (res.ok) {
          if (statusTargetId) setRuntimeStatus(statusTargetId, 'connected')
          toast.success(`连接成功 · ${res.latencyMs} ms`, {
            title: res.tagCount ? `${res.tagCount.toLocaleString()} 个标签` : '测试通过'
          })
        } else {
          if (statusTargetId) setRuntimeStatus(statusTargetId, 'failed')
          toast.error(res.detail ?? '测试失败', { title: '连接失败' })
        }
      } catch (e) {
        if (statusTargetId) setRuntimeStatus(statusTargetId, 'failed')
        toast.error(errorMessage(e), { title: '连接失败' })
      }
    },
    [draft, editingId, setRuntimeStatus, testMut, toast]
  )

  const handleSave = useCallback(async () => {
    try {
      // `savePassword` is a UI-only flag (enforcement lives in the backend);
      // the rest of the draft is the exact ServerInput payload we need.
      const { name, password, savePassword, ...input } = draft
      void savePassword
      const res = await saveMut.mutate({
        id: editingId ?? undefined,
        server: {
          name: name.trim(),
          ...input,
          // Blank password + savePassword=false explicitly clears the stored
          // credential on updates; otherwise we preserve the previous secret.
          password: savePassword ? (password ? password : undefined) : editingId ? '' : undefined
        }
      })
      toast.success('已保存', { title: res.server.name })
      setDraftOverride(null)
      await refetch()
      setSelectedServerId(res.id)
    } catch (e) {
      toast.error(errorMessage(e), { title: '保存失败' })
    }
  }, [draft, editingId, saveMut, refetch, setSelectedServerId, toast])

  return (
    <div className="panel-inner">
      <h1 className="page-title">选择 Historian 服务器</h1>
      <div className="page-sub">
        支持 GE iFix Historian 与 Wonderware InTouch Historian。选择已有连接或新建一个连接。
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <Button color="primary" onClick={handleNew}>
          <Icon name="plus" size={14} /> 新建连接
        </Button>
        <Button variant="bordered" onClick={() => void refetch()} loading={loading}>
          <Icon name="refresh" size={14} /> 刷新
        </Button>
        <div style={{ flex: 1 }} />
        <div style={{ width: 280 }}>
          <Input
            type="search"
            value={search}
            onChange={setSearch}
            placeholder="按名称、主机、类型搜索…"
            startContent={<Icon name="search" size={14} />}
            isClearable
            onClear={() => setSearch('')}
            aria-label="搜索服务器"
          />
        </div>
      </div>

      {loading && servers.length === 0 ? (
        <Grid columns={2} gap={14}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={110} />
          ))}
        </Grid>
      ) : error ? (
        <Empty
          image="error"
          title="加载服务器失败"
          description={errorMessage(error)}
          actions={
            <Button variant="bordered" onClick={() => void refetch()}>
              重试
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <Empty
          title={search ? '未找到匹配的服务器' : '暂无服务器'}
          description={search ? `关键字 "${search}"` : '点击"新建连接"创建第一个连接'}
          image={search ? 'search' : 'no-data'}
        />
      ) : (
        <Grid columns={2} gap={14}>
          {filtered.map((s) => (
            <ServerCard
              key={s.id}
              server={s}
              isActive={s.id === selectedServerId}
              onSelect={handleSelect}
              onQuickTest={(srv) => void handleTest(srv)}
              onDelete={handleAskDelete}
            />
          ))}
        </Grid>
      )}

      <div ref={formRef}>
        <ConnectionForm
          value={draft}
          onChange={setDraftOverride}
          onTest={() => void handleTest()}
          onSave={() => void handleSave()}
          onDelete={
            editingId
              ? () => {
                  const server = servers.find((s) => s.id === editingId)
                  if (server) handleAskDelete(server)
                }
              : undefined
          }
          testing={testMut.loading}
          saving={saveMut.loading}
          selectedId={editingId}
        />
      </div>

      <Modal
        isOpen={!!pendingDelete}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
        size="sm"
      >
        <ModalHeader>删除连接</ModalHeader>
        <ModalBody>
          <p style={{ margin: 0 }}>
            确定要删除 <strong>{pendingDelete?.name}</strong> 吗？
          </p>
          {pendingDelete && selectedServerId === pendingDelete.id && (
            <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--fg3)' }}>
              该连接正被选中使用，删除后 Step 1 已选标签、Step 2 自定义时间范围将一并清空。
            </p>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="bordered" onClick={() => setPendingDelete(null)} autoFocus>
            取消
          </Button>
          <Button
            color="danger"
            onClick={() => void handleConfirmDelete()}
            loading={deleteMut.loading}
          >
            删除
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  )
}

export default ConnectionStep
