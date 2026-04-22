/**
 * SelectedPanel — right column of Step 1.
 *
 * Title + context from the selected server, a "手动添加 / 全部清空" toolbar,
 * the "已选标签" table (or empty state) and a tip callout at the bottom.
 *
 * "手动添加" lets the user paste tag names that aren't necessarily present
 * in the server's tag tree (useful for maintenance flows where a tag list
 * is curated offline). Pasted names are dedup'd against the existing
 * selection and become leaf TagNodes with id=label — Step 2 / Step 3 treat
 * them like any other selected tag.
 */
import { useMemo, useState } from 'react'
import {
  Button,
  Callout,
  Icon,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Tag,
  useToast
} from '@/components/ui'
import { useRpcQuery } from '@/hooks/useRpc'
import { useConnectionStore } from '@/stores/connection'
import { useTagsStore } from '@/stores/tags'
import type { Server } from '@shared/domain-types'

/**
 * Parse a free-form textarea value into a deduped list of tag names.
 * Splits on newline, comma, semicolon, tab, and whitespace runs, trims each
 * fragment, and drops empty strings. Preserves first-seen order.
 */
function parseTagNames(raw: string): string[] {
  if (!raw) return []
  const parts = raw
    .split(/[\n,;\t]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of parts) {
    if (seen.has(p)) continue
    seen.add(p)
    out.push(p)
  }
  return out
}

export function SelectedPanel(): React.JSX.Element {
  const toast = useToast()
  const selectedIds = useTagsStore((s) => s.selectedIds)
  const selectedDetails = useTagsStore((s) => s.selectedDetails)
  const clearSelection = useTagsStore((s) => s.clearSelection)
  const deselectWithDetail = useTagsStore((s) => s.deselectWithDetail)
  const addTagsManually = useTagsStore((s) => s.addTagsManually)

  const serverId = useConnectionStore((s) => s.selectedServerId)
  const { data: servers } = useRpcQuery('historian.listServers', undefined)
  const currentServer = useMemo<Server | undefined>(
    () => (servers ?? []).find((s) => s.id === serverId),
    [servers, serverId]
  )

  const selectedTags = useMemo(
    () =>
      Array.from(selectedIds)
        .map((id) => selectedDetails.get(id))
        .filter((t): t is NonNullable<typeof t> => !!t),
    [selectedIds, selectedDetails]
  )

  // `serverId` may point at a row the sidecar no longer returns (e.g. user
  // opened this step after deleting the server on another machine); in that
  // case skip the success blurb and render a warning instead of the left
  // pane's "请先选择" (which would be a duplicate + wrong diagnosis here).
  const serverMissing = !!serverId && !currentServer

  // Manual-add modal state.
  const [addOpen, setAddOpen] = useState(false)
  const [addText, setAddText] = useState('')

  const parsedNames = useMemo(() => parseTagNames(addText), [addText])
  const newCount = useMemo(() => {
    let n = 0
    for (const name of parsedNames) if (!selectedIds.has(name)) n += 1
    return n
  }, [parsedNames, selectedIds])
  const duplicateCount = parsedNames.length - newCount

  const handleAddSubmit = (): void => {
    if (parsedNames.length === 0) return
    const { added, skipped } = addTagsManually(parsedNames)
    if (added > 0) {
      toast.success(`已添加 ${added} 个标签${skipped > 0 ? `（跳过 ${skipped} 个重复）` : ''}`, {
        title: '手动添加'
      })
    } else {
      toast.show({
        status: 'info',
        title: '无新标签',
        description: skipped > 0 ? `输入的 ${skipped} 个全部已存在` : undefined,
        duration: 2500
      })
    }
    setAddText('')
    setAddOpen(false)
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, marginBottom: 20 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 className="page-title">选择要下载的标签</h1>
          {currentServer && (
            <div className="page-sub" style={{ margin: 0 }}>
              已从{' '}
              <strong style={{ color: 'var(--fg1)' }}>
                {currentServer.type} — {currentServer.name}
              </strong>{' '}
              加载 {(currentServer.tagCount ?? 0).toLocaleString()}{' '}
              个标签。可在左侧按组导航或直接搜索，也可手动添加服务器上未列出的标签。
            </div>
          )}
          {serverMissing && (
            <div style={{ marginTop: 10 }}>
              <Callout variant="warning">该服务器已被删除或不再可用</Callout>
            </div>
          )}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button
            type="button"
            className="btn btn-bordered btn-sm"
            onClick={() => setAddOpen(true)}
            aria-label="手动添加标签"
          >
            <Icon name="plus" size={12} />
            手动添加
          </button>
          <button
            type="button"
            className="btn btn-light btn-sm"
            disabled={selectedTags.length === 0}
            onClick={() => clearSelection()}
          >
            全部清空
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-head">
          <div>
            <h3>已选标签</h3>
            <div className="sub">共 {selectedTags.length} 个标签</div>
          </div>
        </div>
        {selectedTags.length === 0 ? (
          <div className="empty">
            <Icon name="tag" size={36} />
            <div>尚未选择标签</div>
            <div style={{ fontSize: 11, marginTop: 4 }}>
              从左侧列表中勾选，或点击右上角“手动添加”粘贴标签名
            </div>
          </div>
        ) : (
          <table className="t">
            <thead>
              <tr>
                <th style={{ width: 36 }}></th>
                <th>标签名</th>
                <th>描述</th>
                <th>类型</th>
                <th>单位</th>
                <th style={{ width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {selectedTags.map((t) => (
                <tr key={t.id} className="selected">
                  <td>
                    <span className="ck checked" />
                  </td>
                  <td>
                    <span className="mono" style={{ color: 'var(--fg1)', fontSize: 12 }}>
                      {t.path ?? t.label}
                    </span>
                  </td>
                  <td>{t.desc ?? '—'}</td>
                  <td>
                    {t.type && (
                      <Tag
                        size="sm"
                        variant="soft"
                        color={t.type === 'Analog' ? 'primary' : 'secondary'}
                      >
                        {t.type}
                      </Tag>
                    )}
                  </td>
                  <td className="mono">{t.unit || '—'}</td>
                  <td>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label="移除"
                      onClick={() => deselectWithDetail(t.id)}
                    >
                      <Icon name="x" size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '12px 14px',
          background: 'var(--tint-primary-weak)',
          border: '1px solid var(--tint-primary-border)',
          borderRadius: 12,
          fontSize: 'var(--fs-sm)',
          color: 'var(--fg2)'
        }}
      >
        <Icon
          name="info"
          size={16}
          stroke={2}
          style={{ color: 'var(--c-primary)', flexShrink: 0 }}
        />
        <span>
          可以选择 <strong>任意多个标签</strong>
          ，下一步会按时间范围自动分段导出以避免数据库一次性返回过多数据。
        </span>
      </div>

      <Modal
        isOpen={addOpen}
        onOpenChange={(open) => {
          if (!open) {
            setAddOpen(false)
            setAddText('')
          }
        }}
        size="md"
      >
        <ModalHeader>手动添加标签</ModalHeader>
        <ModalBody>
          <div style={{ fontSize: 12, color: 'var(--fg3)', marginBottom: 8 }}>
            每行一个标签名，或用逗号 / 分号 / 制表符分隔。重复的会自动跳过。
          </div>
          <textarea
            value={addText}
            onChange={(e) => setAddText(e.target.value)}
            placeholder={'FIC-1001.PV\nFIC-1002.PV, FIC-1003.PV\nTC-2001.PV; TC-2002.PV'}
            rows={8}
            autoFocus
            style={{
              width: '100%',
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              padding: '10px 12px',
              borderRadius: 8,
              border: '1px solid var(--border-default)',
              background: 'var(--bg-surface)',
              color: 'var(--fg1)',
              resize: 'vertical',
              outline: 'none',
              boxSizing: 'border-box'
            }}
            aria-label="标签名列表"
          />
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginTop: 10,
              fontSize: 12,
              color: 'var(--fg2)'
            }}
          >
            <span>
              解析到 <strong>{parsedNames.length}</strong> 个标签
              {duplicateCount > 0 && (
                <span style={{ color: 'var(--fg3)' }}> · 其中 {duplicateCount} 个已存在</span>
              )}
            </span>
            {newCount > 0 && (
              <span style={{ color: 'var(--c-success)' }}>
                将新增 <strong>{newCount}</strong> 个
              </span>
            )}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button
            variant="bordered"
            onClick={() => {
              setAddOpen(false)
              setAddText('')
            }}
          >
            取消
          </Button>
          <Button color="primary" onClick={handleAddSubmit} disabled={newCount === 0}>
            添加 {newCount > 0 ? newCount : ''}
          </Button>
        </ModalFooter>
      </Modal>
    </>
  )
}

export default SelectedPanel
