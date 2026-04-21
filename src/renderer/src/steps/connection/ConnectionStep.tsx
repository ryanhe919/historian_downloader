/**
 * Step 0 — Connection. Grid of saved Historian servers + a parameter form.
 *
 * Frontend A is expected to mount this in App.tsx for `step === 0`.
 */
import { useCallback, useMemo, useState } from 'react'
import { Button, Empty, Grid, Icon, Input, Skeleton, useToast } from '@/components/ui'
import { useRpcMutation, useRpcQuery } from '@/hooks/useRpc'
import { isRpcError } from '@/lib/rpc'
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

  const { data, loading, error, refetch } = useRpcQuery('historian.listServers', undefined)
  const servers = useMemo<Server[]>(() => data ?? [], [data])

  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState<ConnectionDraft>(EMPTY_DRAFT)
  const [editingId, setEditingId] = useState<string | null>(null)

  // When the selection changes from outside (or the list refreshes), hydrate
  // the form with the selected server's fields. We compute the derived state
  // during render rather than in an effect — setting state inside an effect
  // would trigger a cascading render (react-hooks/set-state-in-effect).
  if (selectedServerId && editingId !== selectedServerId) {
    const found = servers.find((s) => s.id === selectedServerId)
    if (found) {
      setDraft(serverToDraft(found))
      setEditingId(selectedServerId)
    }
  }

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

  const handleNew = useCallback(() => {
    setEditingId(null)
    setSelectedServerId(null)
    setDraft({ ...EMPTY_DRAFT })
  }, [setSelectedServerId])

  const handleSelect = useCallback(
    (id: string) => {
      setSelectedServerId(id)
    },
    [setSelectedServerId]
  )

  const handleTest = useCallback(
    async (override?: ConnectionDraft | Server) => {
      const input: ConnectionDraft =
        override && 'password' in override
          ? (override as ConnectionDraft)
          : override
            ? serverToDraft(override as Server)
            : draft
      try {
        const res = await testMut.mutate({
          server: {
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
          toast.success(`连接成功 · ${res.latencyMs} ms`, {
            title: res.tagCount ? `${res.tagCount.toLocaleString()} 个标签` : '测试通过'
          })
        } else {
          toast.error(res.detail ?? '测试失败', { title: '连接失败' })
        }
      } catch (e) {
        toast.error(errorMessage(e), { title: '连接失败' })
      }
    },
    [draft, testMut, toast]
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
          // Only send the password if the user actually typed one; backend keeps
          // the existing hash otherwise.
          password: password ? password : undefined
        }
      })
      toast.success('已保存', { title: res.server.name })
      await refetch()
      setEditingId(res.id)
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
            />
          ))}
        </Grid>
      )}

      <ConnectionForm
        value={draft}
        onChange={setDraft}
        onTest={() => void handleTest()}
        onSave={() => void handleSave()}
        testing={testMut.loading}
        saving={saveMut.loading}
        selectedId={editingId}
      />
    </div>
  )
}

export default ConnectionStep
