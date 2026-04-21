/**
 * SelectedPanel — right column of Step 1. Shows a title with context from the
 * selected server, the "导入标签列表 / 全部清空" toolbar, the "已选标签" card
 * (table of picked tags or empty state), and a tip callout at the bottom.
 */
import { useMemo, useState } from 'react'
import { Icon, useToast } from '@/components/ui'
import { useRpcQuery } from '@/hooks/useRpc'
import { useConnectionStore } from '@/stores/connection'
import { useTagsStore } from '@/stores/tags'
import type { Server } from '@shared/domain-types'

type ViewMode = 'table' | 'trend'

export function SelectedPanel(): React.JSX.Element {
  const toast = useToast()
  const selectedIds = useTagsStore((s) => s.selectedIds)
  const selectedDetails = useTagsStore((s) => s.selectedDetails)
  const clearSelection = useTagsStore((s) => s.clearSelection)
  const deselectWithDetail = useTagsStore((s) => s.deselectWithDetail)

  const serverId = useConnectionStore((s) => s.selectedServerId)
  const { data: servers } = useRpcQuery('historian.listServers', undefined)
  const currentServer = useMemo<Server | undefined>(
    () => (servers ?? []).find((s) => s.id === serverId),
    [servers, serverId]
  )

  const [view, setView] = useState<ViewMode>('table')

  const selectedTags = useMemo(
    () =>
      Array.from(selectedIds)
        .map((id) => selectedDetails.get(id))
        .filter((t): t is NonNullable<typeof t> => !!t),
    [selectedIds, selectedDetails]
  )

  const estimatedMb = (selectedTags.length * 0.7).toFixed(1)

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, marginBottom: 20 }}>
        <div>
          <h1 className="page-title">选择要下载的标签</h1>
          <div className="page-sub" style={{ margin: 0 }}>
            {currentServer ? (
              <>
                已从{' '}
                <strong style={{ color: 'var(--fg1)' }}>
                  {currentServer.type} — {currentServer.name}
                </strong>{' '}
                加载 {(currentServer.tagCount ?? 0).toLocaleString()} 个标签。可在左侧按组导航或直接搜索。
              </>
            ) : (
              '请在上一步选择一个 Historian 服务器。'
            )}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button
            type="button"
            className="btn btn-bordered btn-sm"
            onClick={() =>
              toast.info?.('从 CSV 导入：TODO，待实现') ??
              toast.show({ status: 'info', title: '从 CSV 导入：TODO' })
            }
          >
            <Icon name="copy" size={12} />
            导入标签列表
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
            <div className="sub">
              共 {selectedTags.length} 个标签
              {selectedTags.length > 0 && <> · 估算每段 ~{estimatedMb} MB</>}
            </div>
          </div>
          <div className="tabs">
            <button
              type="button"
              className={`tab${view === 'table' ? ' active' : ''}`}
              onClick={() => setView('table')}
            >
              <Icon name="table" size={12} /> 表格
            </button>
            <button
              type="button"
              className={`tab${view === 'trend' ? ' active' : ''}`}
              onClick={() => setView('trend')}
            >
              <Icon name="chart" size={12} /> 趋势
            </button>
          </div>
        </div>
        {selectedTags.length === 0 ? (
          <div className="empty">
            <Icon name="tag" size={36} />
            <div>尚未选择标签</div>
            <div style={{ fontSize: 11, marginTop: 4 }}>
              从左侧列表中勾选，或粘贴标签名批量导入
            </div>
          </div>
        ) : view === 'trend' ? (
          <div className="empty">
            <Icon name="chart" size={36} />
            <div>趋势预览</div>
            <div style={{ fontSize: 11, marginTop: 4 }}>
              （待实现 — 下一步 "时间与采样" 会展示真实预览曲线）
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
                      {t.label}
                    </span>
                  </td>
                  <td>{t.desc ?? '—'}</td>
                  <td>
                    {t.type && (
                      <span className={`tag ${t.type === 'Analog' ? 'tag-primary' : 'tag-purple'}`}>
                        {t.type}
                      </span>
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
          background: 'rgba(0,111,238,0.04)',
          border: '1px solid rgba(0,111,238,0.2)',
          borderRadius: 12,
          fontSize: 'var(--fs-sm)',
          color: 'var(--fg2)'
        }}
      >
        <Icon name="info" size={16} stroke={2} style={{ color: 'var(--c-primary)', flexShrink: 0 }} />
        <span>
          可以选择 <strong>任意多个标签</strong>
          ，下一步会按时间范围自动分段导出以避免数据库一次性返回过多数据。
        </span>
      </div>
    </>
  )
}

export default SelectedPanel
