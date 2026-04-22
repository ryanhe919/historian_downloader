/**
 * TagTree — virtualized hierarchical tree with folder / leaf rows.
 *
 * TimeUI does not ship a tree component; this is the base skeleton.
 * Wave 2 business code (工程师 B) is expected to consume this with
 * `@shared/domain-types`'s `TagNode`; to avoid cross-package circular
 * deps we keep a local `TreeNode` type here that's structurally
 * compatible with `TagNode`.
 */
import { useMemo, useRef, type CSSProperties } from 'react'
import { Checkbox } from '@timeui/react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Icon } from './Icon'

export interface TreeNode {
  id: string
  label: string
  kind: 'folder' | 'leaf'
  count?: number
  desc?: string
  unit?: string
  type?: 'Analog' | 'Digital'
  hasChildren?: boolean
  children?: TreeNode[]
}

export interface TagTreeProps {
  nodes: TreeNode[]
  expandedIds: Set<string> | string[]
  selectedIds: Set<string> | string[]
  onToggleExpand: (id: string) => void
  onToggleSelect: (id: string) => void
  rowHeight?: number
  height?: number | string
  className?: string
  style?: CSSProperties
}

interface FlatItem {
  node: TreeNode
  depth: number
}

function asSet(v: Set<string> | string[]): Set<string> {
  return v instanceof Set ? v : new Set(v)
}

function flatten(
  nodes: TreeNode[],
  expanded: Set<string>,
  depth = 0,
  out: FlatItem[] = []
): FlatItem[] {
  for (const node of nodes) {
    out.push({ node, depth })
    if (
      node.kind === 'folder' &&
      expanded.has(node.id) &&
      node.children &&
      node.children.length > 0
    ) {
      flatten(node.children, expanded, depth + 1, out)
    }
  }
  return out
}

export function TagTree({
  nodes,
  expandedIds,
  selectedIds,
  onToggleExpand,
  onToggleSelect,
  rowHeight = 30,
  height = '100%',
  className,
  style
}: TagTreeProps): React.JSX.Element {
  const expanded = useMemo(() => asSet(expandedIds), [expandedIds])
  const selected = useMemo(() => asSet(selectedIds), [selectedIds])

  const items = useMemo(() => flatten(nodes, expanded), [nodes, expanded])

  const parentRef = useRef<HTMLDivElement | null>(null)

  // TanStack Virtual is intentionally used here for large trees; React's
  // compiler-aware lint flags it as incompatible, but this component does
  // not depend on compiler memoization for correctness.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 8
  })

  const resolvedClass = ['tree', className].filter(Boolean).join(' ')

  return (
    <div
      ref={parentRef}
      role="tree"
      className={resolvedClass}
      style={{ height, overflow: 'auto', position: 'relative', ...style }}
    >
      <div
        style={{
          height: virtualizer.getTotalSize(),
          width: '100%',
          position: 'relative'
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const { node, depth } = items[virtualRow.index]
          const isFolder = node.kind === 'folder'
          const isExpanded = isFolder && expanded.has(node.id)
          const isSelected = selected.has(node.id)
          const hasKids = isFolder && (node.hasChildren ?? (node.children?.length ?? 0) > 0)

          const rowClass = ['tree-row', !isFolder && isSelected ? 'selected' : '']
            .filter(Boolean)
            .join(' ')

          return (
            <div
              key={node.id}
              role="treeitem"
              aria-level={depth + 1}
              aria-expanded={isFolder ? isExpanded : undefined}
              aria-selected={!isFolder ? isSelected : undefined}
              className={rowClass}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
                paddingLeft: `${depth * 16 + 8}px`
              }}
              onClick={() => {
                if (isFolder) {
                  onToggleExpand(node.id)
                } else {
                  onToggleSelect(node.id)
                }
              }}
            >
              {/* Chevron */}
              <span
                className={['tree-caret', isExpanded ? 'open' : ''].filter(Boolean).join(' ')}
                aria-hidden
                style={{ visibility: hasKids ? 'visible' : 'hidden' }}
              >
                <Icon name="chevronRight" size={10} stroke={2} />
              </span>

              {/* Checkbox (leaves only) */}
              {!isFolder && (
                <span
                  onClick={(e) => {
                    // prevent bubbling — row-level onClick also toggles select
                    e.stopPropagation()
                    onToggleSelect(node.id)
                  }}
                  style={{ display: 'inline-flex', alignItems: 'center' }}
                >
                  <Checkbox
                    size="sm"
                    isSelected={isSelected}
                    onChange={() => onToggleSelect(node.id)}
                    aria-label={node.label}
                  />
                </span>
              )}

              {/* Leading icon */}
              <span className="tree-icon" aria-hidden>
                {isFolder ? (
                  <Icon name={isExpanded ? 'folderOpen' : 'folder'} size={14} />
                ) : (
                  <Icon name="tag" size={14} />
                )}
              </span>

              {/* Label + desc */}
              <span className="tree-label">
                <code>{node.label}</code>
                {node.desc ? (
                  <span
                    style={{
                      marginLeft: 8,
                      color: 'var(--fg3)',
                      fontSize: 11,
                      fontFamily: 'var(--font-sans)'
                    }}
                  >
                    {node.desc}
                  </span>
                ) : null}
              </span>

              {/* Trailing meta */}
              {isFolder && typeof node.count === 'number' ? (
                <span className="tree-count">{node.count}</span>
              ) : null}
              {!isFolder && node.unit ? (
                <span className="tag tag-default" style={{ marginLeft: 4 }}>
                  {node.unit}
                </span>
              ) : null}
              {!isFolder && node.type ? (
                <span
                  className={node.type === 'Digital' ? 'tag tag-purple' : 'tag tag-primary'}
                  style={{ marginLeft: 4 }}
                >
                  {node.type}
                </span>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
