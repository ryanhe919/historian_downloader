import { create } from 'zustand'
import type { TagNode } from '@shared/domain-types'

interface TagsState {
  selectedIds: Set<string>
  expandedIds: Set<string>
  searchQuery: string
  /**
   * Full TagNode info for each selected id.
   * Populated by `selectWithDetail` / `recordTagDetail`, consumed by the
   * right-hand "已选" table which needs label/desc/unit without an extra RPC.
   */
  selectedDetails: Map<string, TagNode>
  toggleSelect: (id: string) => void
  selectMany: (ids: string[]) => void
  deselectMany: (ids: string[]) => void
  clearSelection: () => void
  toggleExpand: (id: string) => void
  setSearchQuery: (q: string) => void
  /** Toggle select AND remember/forget the node's detail in one shot. */
  selectWithDetail: (node: TagNode) => void
  deselectWithDetail: (id: string) => void
  recordTagDetail: (node: TagNode) => void
  forgetTagDetail: (id: string) => void
}

export const useTagsStore = create<TagsState>((set) => ({
  selectedIds: new Set(),
  expandedIds: new Set(['line-a', 'line-a-boiler']),
  searchQuery: '',
  selectedDetails: new Map(),
  toggleSelect: (id) =>
    set((s) => {
      const next = new Set(s.selectedIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { selectedIds: next }
    }),
  selectMany: (ids) =>
    set((s) => {
      const next = new Set(s.selectedIds)
      ids.forEach((id) => next.add(id))
      return { selectedIds: next }
    }),
  deselectMany: (ids) =>
    set((s) => {
      const next = new Set(s.selectedIds)
      const details = new Map(s.selectedDetails)
      ids.forEach((id) => {
        next.delete(id)
        details.delete(id)
      })
      return { selectedIds: next, selectedDetails: details }
    }),
  clearSelection: () => set({ selectedIds: new Set(), selectedDetails: new Map() }),
  toggleExpand: (id) =>
    set((s) => {
      const next = new Set(s.expandedIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { expandedIds: next }
    }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  selectWithDetail: (node) =>
    set((s) => {
      const ids = new Set(s.selectedIds)
      const details = new Map(s.selectedDetails)
      if (ids.has(node.id)) {
        ids.delete(node.id)
        details.delete(node.id)
      } else {
        ids.add(node.id)
        details.set(node.id, node)
      }
      return { selectedIds: ids, selectedDetails: details }
    }),
  deselectWithDetail: (id) =>
    set((s) => {
      if (!s.selectedIds.has(id)) return {}
      const ids = new Set(s.selectedIds)
      const details = new Map(s.selectedDetails)
      ids.delete(id)
      details.delete(id)
      return { selectedIds: ids, selectedDetails: details }
    }),
  recordTagDetail: (node) =>
    set((s) => {
      const details = new Map(s.selectedDetails)
      details.set(node.id, node)
      return { selectedDetails: details }
    }),
  forgetTagDetail: (id) =>
    set((s) => {
      if (!s.selectedDetails.has(id)) return {}
      const details = new Map(s.selectedDetails)
      details.delete(id)
      return { selectedDetails: details }
    })
}))
