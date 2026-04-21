/**
 * TagSidebar — left column of Step 1. Hosts:
 *   - search input (filters the tree in-place by label/desc substring)
 *   - filter pills: 全部 / Analog / Digital / 已选
 *   - the hierarchical tree itself (handcrafted `.tree-row` markup matching
 *     the design prototype 1:1, not the virtualized `<TagTree>` from
 *     components/ui — that one is only worth its weight for >1k leaves).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Icon, Skeleton } from '@/components/ui'
import { useRpcQuery } from '@/hooks/useRpc'
import { isRpcError } from '@/lib/rpc'
import { useConnectionStore } from '@/stores/connection'
import { useTagsStore } from '@/stores/tags'
import { ErrorCode } from '@shared/error-codes'
import type { TagNode, TagValueType } from '@shared/domain-types'

interface NestedTagNode extends TagNode {
  children?: NestedTagNode[]
}

type TypeFilter = 'all' | 'Analog' | 'Digital' | 'selected'

const FILTERS: { id: TypeFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'Analog', label: 'Analog' },
  { id: 'Digital', label: 'Digital' },
  { id: 'selected', label: '已选' }
]

/**
 * Translate an `error.code` coming from the sidecar into Chinese copy
 * appropriate for the tag-tree loading failure slot. Kept local because it's
 * a narrow subset with one tree-specific line (OLE_COM_UNAVAILABLE).
 */
function tagTreeErrorMessage(err: unknown): string {
  if (!isRpcError(err)) return err instanceof Error ? err.message : '加载失败'
  switch (err.code) {
    case ErrorCode.OLE_COM_UNAVAILABLE:
      return 'iFix 适配器需要在 Windows 上运行'
    case ErrorCode.CONNECTION_TIMEOUT:
      return '连接超时'
    case ErrorCode.CONNECTION_REFUSED:
      return '无法连接到主机'
    case ErrorCode.AUTH_FAILED:
      return '用户名或密码错误'
    case ErrorCode.SERVER_NOT_FOUND:
      return '服务器已被删除，请回上一步重新选择'
    case ErrorCode.ADAPTER_DRIVER:
      return `driver error: ${err.message || '未知'}`
    default:
      return err.message || '加载失败'
  }
}

/** Walk nodes depth-first, collecting leaves that pass the filter + keyword. */
function filterTree(
  nodes: NestedTagNode[],
  keyword: string,
  typeFilter: TypeFilter,
  selectedIds: Set<string>
): NestedTagNode[] {
  const kw = keyword.trim().toLowerCase()
  const matchLeaf = (n: NestedTagNode): boolean => {
    if (n.kind !== 'leaf') return false
    if (typeFilter === 'selected' && !selectedIds.has(n.id)) return false
    if (typeFilter === 'Analog' && n.type !== 'Analog') return false
    if (typeFilter === 'Digital' && n.type !== 'Digital') return false
    if (!kw) return true
    return (
      n.label.toLowerCase().includes(kw) || (n.desc ?? '').toLowerCase().includes(kw)
    )
  }
  const walk = (list: NestedTagNode[]): NestedTagNode[] => {
    const out: NestedTagNode[] = []
    for (const n of list) {
      if (n.kind === 'leaf') {
        if (matchLeaf(n)) out.push(n)
      } else {
        const kids = walk(n.children ?? [])
        if (kids.length > 0) out.push({ ...n, children: kids })
      }
    }
    return out
  }
  // No filters at all → return the original tree.
  if (!kw && typeFilter === 'all') return nodes
  return walk(nodes)
}

function collectLeafIndex(
  nodes: NestedTagNode[],
  out = new Map<string, TagNode>()
): Map<string, TagNode> {
  for (const n of nodes) {
    if (n.kind === 'leaf') {
      out.set(n.id, {
        id: n.id,
        label: n.label,
        kind: 'leaf',
        desc: n.desc,
        unit: n.unit,
        type: n.type as TagValueType | undefined,
        dataType: n.dataType
      })
    } else if (n.children) {
      collectLeafIndex(n.children, out)
    }
  }
  return out
}

/** Detect macOS at render time; preload exposes `process.platform` as `platform`. */
function isMac(): boolean {
  return typeof window !== 'undefined' && window.hd?.platform === 'darwin'
}

export function TagSidebar(): React.JSX.Element {
  const serverId = useConnectionStore((s) => s.selectedServerId)
  const selectedIds = useTagsStore((s) => s.selectedIds)
  const expandedIds = useTagsStore((s) => s.expandedIds)
  const toggleExpand = useTagsStore((s) => s.toggleExpand)
  const selectWithDetail = useTagsStore((s) => s.selectWithDetail)
  const search = useTagsStore((s) => s.searchQuery)
  const setSearch = useTagsStore((s) => s.setSearchQuery)

  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const searchInputRef = useRef<HTMLInputElement>(null)

  const { data, error, loading, refetch } = useRpcQuery(
    'historian.listTagTree',
    { serverId: serverId ?? '', depth: 99 },
    { enabled: !!serverId }
  )

  const roots = useMemo<NestedTagNode[]>(
    () => (data ?? []) as unknown as NestedTagNode[],
    [data]
  )
  const leafIndex = useMemo(() => collectLeafIndex(roots), [roots])
  const filtered = useMemo(
    () => filterTree(roots, search, typeFilter, selectedIds),
    [roots, search, typeFilter, selectedIds]
  )

  const handleLeafToggle = (id: string): void => {
    const node = leafIndex.get(id)
    if (node) selectWithDetail(node)
  }

  // When the user is searching or filtering, auto-expand so matches are visible.
  const isFiltering = search.trim() !== '' || typeFilter !== 'all'
  const isExpanded = (id: string): boolean => isFiltering || expandedIds.has(id)

  // Ctrl/⌘+K focuses the search box. We intentionally *don't* bail when the
  // input already has focus — re-focusing is idempotent and selects nothing —
  // but we DO bail when some other editable element (another input, textarea,
  // contenteditable) is focused, so we don't steal focus mid-typing elsewhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'k' && e.key !== 'K') return
      const isMod = isMac() ? e.metaKey : e.ctrlKey
      if (!isMod || e.altKey || e.shiftKey) return
      const active = document.activeElement as HTMLElement | null
      if (active && active !== searchInputRef.current) {
        const tag = active.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || active.isContentEditable) return
      }
      e.preventDefault()
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const renderNodes = (list: NestedTagNode[], depth = 0): React.ReactNode => {
    return list.map((node) => {
      if (node.kind === 'folder') {
        const open = isExpanded(node.id)
        const childKids = node.children ?? []
        return (
          <div key={node.id}>
            <div
              className="tree-row"
              style={{ paddingLeft: 8 + depth * 12 }}
              onClick={() => toggleExpand(node.id)}
            >
              <span className={`tree-caret${open ? ' open' : ''}`}>
                <Icon name="chevronRight" size={10} />
              </span>
              <span className="tree-icon">
                <Icon name={open ? 'folderOpen' : 'folder'} size={14} />
              </span>
              <span className="tree-label">{node.label}</span>
              {node.count !== undefined && <span className="tree-count">{node.count}</span>}
            </div>
            {open && childKids.length > 0 && (
              <div className="tree-children">{renderNodes(childKids, depth + 1)}</div>
            )}
          </div>
        )
      }
      const sel = selectedIds.has(node.id)
      return (
        <div
          key={node.id}
          className={`tree-row${sel ? ' selected' : ''}`}
          style={{ paddingLeft: 8 + depth * 12 }}
          onClick={() => handleLeafToggle(node.id)}
        >
          <span className="tree-caret" style={{ visibility: 'hidden' }}>
            <Icon name="chevronRight" size={10} />
          </span>
          <span
            className={`ck${sel ? ' checked' : ''}`}
            onClick={(e) => {
              e.stopPropagation()
              handleLeafToggle(node.id)
            }}
          />
          <span className="tree-icon">
            <Icon name="tag" size={12} stroke={1.8} />
          </span>
          <span className="tree-label">{node.label}</span>
          {node.type && (
            <span className="tree-count" style={{ textTransform: 'none' }}>
              {node.type === 'Analog' ? 'A' : 'D'}
            </span>
          )}
        </div>
      )
    })
  }

  let treeBody: React.ReactNode
  if (!serverId) {
    treeBody = (
      <div className="empty">
        <Icon name="database" size={20} />
        <div>请先在 Step 0 选择已保存的 Historian 服务器</div>
      </div>
    )
  } else if (error) {
    treeBody = (
      <div className="empty">
        <Icon name="alert" size={20} />
        <div>加载失败</div>
        <div style={{ fontSize: 11, marginTop: 4, color: 'var(--fg3)' }}>
          {tagTreeErrorMessage(error)}
        </div>
        <div style={{ marginTop: 10 }}>
          <Button size="sm" variant="bordered" onClick={() => void refetch()}>
            <Icon name="refresh" size={12} /> 重试
          </Button>
        </div>
      </div>
    )
  } else if (loading && filtered.length === 0) {
    treeBody = (
      <div style={{ padding: '8px 8px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} height={32} radius={6} />
        ))}
      </div>
    )
  } else if (filtered.length === 0) {
    // Distinguish "adapter returned an empty tree" from "filters hid every match".
    const isEmptyTree = search.trim() === '' && typeFilter === 'all'
    treeBody = (
      <div className="empty">
        <Icon name={isEmptyTree ? 'tag' : 'search'} size={20} />
        {isEmptyTree ? (
          <div>该服务器没有可用标签（historian 空）</div>
        ) : (
          <>
            <div>没有匹配的标签（已过滤）</div>
            <div style={{ fontSize: 11, marginTop: 4, color: 'var(--fg3)' }}>
              清除搜索或筛选条件以查看全部标签
            </div>
          </>
        )}
      </div>
    )
  } else {
    treeBody = renderNodes(filtered)
  }

  const shortcut = isMac() ? '⌘K' : 'Ctrl+K'

  return (
    <aside className="tag-sidebar">
      <div className="search-box">
        <div className="field">
          <Icon name="search" size={14} />
          <input
            ref={searchInputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`按标签名或描述搜索 · ${shortcut}`}
            aria-label="搜索标签"
          />
        </div>
      </div>
      <div className="filter-row">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`preset-pill${typeFilter === f.id ? ' active' : ''}`}
            onClick={() => setTypeFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="tree">{treeBody}</div>
    </aside>
  )
}

export default TagSidebar
