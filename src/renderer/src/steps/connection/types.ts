/**
 * Types and default values for Step 0's parameter form. Kept out of the
 * *.tsx file so react-refresh/only-export-components stays happy.
 */
import type { ServerInput } from '@shared/domain-types'

/**
 * Draft shape the ConnectionForm maintains. `name` lives alongside
 * `ServerInput` so we can call `saveServer` with a single object; `password`
 * is kept out of the persisted `Server` domain type and only sent on save.
 */
export interface ConnectionDraft extends ServerInput {
  name: string
  password: string
  savePassword: boolean
}

export const EMPTY_DRAFT: ConnectionDraft = {
  name: '',
  type: 'iFix',
  host: '',
  port: 14000,
  username: '',
  password: '',
  timeoutS: 15,
  tls: true,
  windowsAuth: false,
  savePassword: true
}

export interface ConnectionFormProps {
  value: ConnectionDraft
  onChange: (next: ConnectionDraft) => void
  onTest: () => void
  onSave: () => void
  /** Disables the Save button while the Test is in flight. */
  testing?: boolean
  saving?: boolean
  /** Id of the Server currently being edited (purely informational for title). */
  selectedId?: string | null
}
