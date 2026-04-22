/**
 * customTags — user-maintained tag library persisted to localStorage.
 *
 * These tags exist in the renderer only; the sidecar never sees them as a
 * tree, but when the user picks one in Step 1 its name is pushed through
 * `historian.export.start` exactly like a server-sourced tag. That lets
 * curated tag lists (e.g. a plant's "常用标签") stay with the app across
 * sessions without touching the backend.
 *
 * Persisted under `hd.customTags` — a single JSON array.
 */
import { create } from 'zustand'
import type { TagValueType } from '@shared/domain-types'

export interface CustomTag {
  id: string
  name: string
  desc?: string
  unit?: string
  type?: TagValueType
  /**
   * Optional group path. Use `/` to express nested folders, e.g.
   * `"生产线 A/水泵"` renders as two-level folders under "我的标签".
   * Empty / undefined → placed at the root of "我的标签".
   */
  group?: string
}

const STORAGE_KEY = 'hd.customTags'

/**
 * Normalize a group path: trim each segment, drop empties, collapse dupes.
 * Returns undefined for an effectively blank path so storage stays clean.
 */
export function normalizeGroupPath(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const parts = raw
    .split('/')
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length === 0) return undefined
  return parts.join('/')
}

function loadPersisted(): CustomTag[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (x): x is CustomTag =>
        !!x &&
        typeof x === 'object' &&
        typeof (x as CustomTag).id === 'string' &&
        typeof (x as CustomTag).name === 'string'
    )
  } catch {
    return []
  }
}

function persist(items: CustomTag[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  } catch {
    // ignore (private mode, quota)
  }
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `ct_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`
}

export interface CustomTagsState {
  items: CustomTag[]
  /** Insert a new tag; returns the created record (with generated id). */
  add: (input: Omit<CustomTag, 'id'>) => CustomTag
  /** Patch an existing tag. Silently no-ops if id is unknown. */
  update: (id: string, patch: Partial<Omit<CustomTag, 'id'>>) => void
  /** Delete a single tag. */
  remove: (id: string) => void
  /** Wipe the entire library. */
  clear: () => void
}

export const useCustomTagsStore = create<CustomTagsState>((set, get) => ({
  items: loadPersisted(),
  add: (input) => {
    const record: CustomTag = { id: newId(), ...input }
    const next = [...get().items, record]
    persist(next)
    set({ items: next })
    return record
  },
  update: (id, patch) => {
    const next = get().items.map((t) => (t.id === id ? { ...t, ...patch } : t))
    persist(next)
    set({ items: next })
  },
  remove: (id) => {
    const next = get().items.filter((t) => t.id !== id)
    persist(next)
    set({ items: next })
  },
  clear: () => {
    persist([])
    set({ items: [] })
  }
}))
