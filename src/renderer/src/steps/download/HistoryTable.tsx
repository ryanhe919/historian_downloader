/**
 * HistoryTable — paginated list of prior exports with "show in folder" +
 * delete actions. Delete opens a Modal for confirmation (optionally also
 * unlinks the on-disk file).
 */
import { useCallback, useMemo, useState } from 'react'
import {
  Button,
  Checkbox,
  Empty,
  Icon,
  Input,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Pagination,
  Skeleton,
  Table,
  Tag,
  Tooltip,
  useToast
} from '@/components/ui'
import { useRpcMutation, useRpcQuery } from '@/hooks/useRpc'
import { formatBytes, formatRows } from '@/lib/format'
import { formatRangeShort } from '@/lib/time'
import type { ExportHistoryItem } from '@shared/domain-types'

interface DeleteTarget {
  id: string
  name: string
}

const PAGE_SIZE = 10

export function HistoryTable(): React.JSX.Element {
  const toast = useToast()
  const [page, setPage] = useState(1)
  const [query, setQuery] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const [deleteFile, setDeleteFile] = useState(false)

  const { data, loading, refetch } = useRpcQuery(
    'historian.export.history',
    {
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
      query: query.trim() || undefined
    },
    { deps: [page, query] }
  )

  const removeMut = useRpcMutation('historian.export.remove')
  const openMut = useRpcMutation('historian.export.openInFolder')

  const openInFolder = useCallback(
    async (id: string) => {
      try {
        await openMut.mutate({ historyId: id })
      } catch (e) {
        toast.error((e as Error).message, { title: '打开失败' })
      }
    },
    [openMut, toast]
  )

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return
    try {
      await removeMut.mutate({ historyId: deleteTarget.id, deleteFile })
      toast.success(deleteFile ? '已删除记录与文件' : '已删除记录')
      setDeleteTarget(null)
      setDeleteFile(false)
      await refetch()
    } catch (e) {
      toast.error((e as Error).message, { title: '删除失败' })
    }
  }, [deleteTarget, deleteFile, removeMut, refetch, toast])

  const items = useMemo(() => data?.items ?? [], [data])
  const total = data?.total ?? 0

  const columns = useMemo(
    () => [
      {
        key: 'name',
        title: '文件名',
        render: (row: ExportHistoryItem) => (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="file" size={14} />
            <span style={{ fontWeight: 500 }}>{row.name}</span>
            {!row.exists ? (
              <Tag size="sm" color="warning">
                文件缺失
              </Tag>
            ) : null}
          </div>
        )
      },
      {
        key: 'tagCount',
        title: '标签',
        width: 80,
        align: 'right' as const,
        render: (row: ExportHistoryItem) => <span className="mono">{row.tagCount}</span>
      },
      {
        key: 'rows',
        title: '行数',
        width: 120,
        align: 'right' as const,
        render: (row: ExportHistoryItem) => <span className="mono">{formatRows(row.rows)}</span>
      },
      {
        key: 'sizeBytes',
        title: '体积',
        width: 100,
        align: 'right' as const,
        render: (row: ExportHistoryItem) => (
          <span className="mono">{formatBytes(row.sizeBytes)}</span>
        )
      },
      {
        key: 'range',
        title: '时间范围',
        width: 200,
        render: (row: ExportHistoryItem) => (
          <span className="mono" style={{ fontSize: 11 }}>
            {formatRangeShort(row.range)}
          </span>
        )
      },
      {
        key: 'createdAt',
        title: '导出时间',
        width: 180,
        render: (row: ExportHistoryItem) => (
          <span style={{ fontSize: 12, color: 'var(--fg3)' }}>
            {new Date(row.createdAt).toLocaleString()}
          </span>
        )
      },
      {
        key: 'actions',
        title: '',
        width: 96,
        render: (row: ExportHistoryItem) => (
          <div style={{ display: 'flex', gap: 2 }}>
            <Tooltip content="在文件夹中显示">
              <button
                type="button"
                className="icon-btn"
                disabled={!row.exists}
                onClick={() => void openInFolder(row.id)}
                aria-label="在文件夹中显示"
              >
                <Icon name="folderOpen" size={14} />
              </button>
            </Tooltip>
            <Tooltip content="删除">
              <button
                type="button"
                className="icon-btn"
                onClick={() => {
                  setDeleteTarget({ id: row.id, name: row.name })
                  setDeleteFile(false)
                }}
                aria-label="删除"
              >
                <Icon name="trash" size={14} />
              </button>
            </Tooltip>
          </div>
        )
      }
    ],
    [openInFolder]
  )

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 10
        }}
      >
        <div style={{ flex: 1 }}>
          <Input
            type="search"
            size="sm"
            value={query}
            onChange={(v) => {
              setQuery(v)
              setPage(1)
            }}
            placeholder="搜索文件名…"
            startContent={<Icon name="search" size={13} />}
            isClearable
            onClear={() => setQuery('')}
            aria-label="搜索历史"
          />
        </div>
        <Button size="sm" variant="bordered" onClick={() => void refetch()}>
          <Icon name="refresh" size={12} /> 刷新
        </Button>
      </div>

      {loading && items.length === 0 ? (
        <Skeleton height={240} />
      ) : items.length === 0 ? (
        <Empty
          title={query ? '未找到匹配的历史' : '暂无历史'}
          description={query ? `关键字 "${query}"` : '完成导出后记录将出现在此'}
          image={query ? 'search' : 'no-data'}
        />
      ) : (
        <>
          <Table<ExportHistoryItem>
            columns={columns}
            data={items}
            rowKey="id"
            density="comfortable"
            variant="divided"
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
            <Pagination
              total={total}
              pageSize={PAGE_SIZE}
              page={page}
              onChange={setPage}
              variant="simple"
            />
          </div>
        </>
      )}

      <Modal
        isOpen={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null)
            setDeleteFile(false)
          }
        }}
        size="sm"
      >
        <ModalHeader>删除历史记录</ModalHeader>
        <ModalBody>
          <p style={{ margin: 0, marginBottom: 12 }}>
            确定要删除 <strong>{deleteTarget?.name}</strong> 的历史记录吗？
          </p>
          <Checkbox isSelected={deleteFile} onChange={setDeleteFile}>
            同时删除磁盘上的文件
          </Checkbox>
        </ModalBody>
        <ModalFooter>
          <Button
            variant="bordered"
            onClick={() => {
              setDeleteTarget(null)
              setDeleteFile(false)
            }}
          >
            取消
          </Button>
          <Button color="danger" onClick={() => void handleDelete()} loading={removeMut.loading}>
            删除
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  )
}

export default HistoryTable
