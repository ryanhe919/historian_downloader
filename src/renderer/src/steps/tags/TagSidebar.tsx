/**
 * TagSidebar — left column of Step 1. Hosts:
 *   - search input (filters the tree in-place by label/desc substring)
 *   - filter pills: 全部 / Analog / Digital / 已选
 *   - the hierarchical tree itself (handcrafted `.tree-row` markup matching
 *     the design prototype 1:1, not the virtualized `<TagTree>` from
 *     components/ui — that one is only worth its weight for >1k leaves).
 */
import { useMemo, useState } from 'react'
import { Icon } from '@/components/ui'
import { useRpcQuery } from '@/hooks/useRpc'
import { useConnectionStore } from '@/stores/connection'
import { useTagsStore } from '@/stores/tags'
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

export function TagSidebar(): React.JSX.Element {
  const serverId = useConnectionStore((s) => s.selectedServerId)
  const selectedIds = useTagsStore((s) => s.selectedIds)
  const expandedIds = useTagsStore((s) => s.expandedIds)
  const toggleExpand = useTagsStore((s) => s.toggleExpand)
  const selectWithDetail = useTagsStore((s) => s.selectWithDetail)
  const search = useTagsStore((s) => s.searchQuery)
  const setSearch = useTagsStore((s) => s.setSearchQuery)

  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')

  const { data, error, loading } = useRpcQuery(
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
    treeBody = <div className="empty">请先在上一步选择服务器</div>
  } else if (error) {
    treeBody = (
      <div className="empty">
        <Icon name="alert" size={20} />
        <div>加载失败</div>
        <div style={{ fontSize: 11, marginTop: 4, color: 'var(--fg3)' }}>{error.message}</div>
      </div>
    )
  } else if (loading && filtered.length === 0) {
    treeBody = <div className="empty">加载中…</div>
  } else if (filtered.length === 0) {
    treeBody = (
      <div className="empty">
        <Icon name="search" size={20} />
        <div>没有匹配的标签</div>
      </div>
    )
  } else {
    treeBody = renderNodes(filtered)
  }

  return (
    <aside className="tag-sidebar">
      <div className="search-box">
        <div className="field">
          <Icon name="search" size={14} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索标签名或描述…"
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
