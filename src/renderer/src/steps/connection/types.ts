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

/**
 * "新建连接" 时 ConnectionForm 里显示的初始值。
 *
 * 设计原则：凡是需要用户自己填的字段（name/host/port/username/password
 * /timeoutS）都留空，由 placeholder 提示建议值；只有 Historian 类型和两个
 * 非破坏性开关（TLS、保存凭据）才给"合理默认"——因为 Select 不能真空，
 * TLS/savePassword 对大多数部署是正确选择。这样点"新建连接"后表单看起来
 * 是空白的，而不是像预填了一个旧连接。
 */
export const EMPTY_DRAFT: ConnectionDraft = {
  name: '',
  type: 'iFix',
  host: '',
  port: undefined,
  username: '',
  password: '',
  timeoutS: undefined,
  tls: true,
  windowsAuth: false,
  savePassword: true
}

export interface ConnectionFormProps {
  value: ConnectionDraft
  onChange: (next: ConnectionDraft) => void
  onTest: () => void
  onSave: () => void
  /**
   * Requested delete of the currently-edited connection. Only shown when
   * provided AND in edit mode (selectedId non-null). Parent is responsible
   * for confirmation + RPC.
   */
  onDelete?: () => void
  /** Disables the Save button while the Test is in flight. */
  testing?: boolean
  saving?: boolean
  /** Id of the Server currently being edited (purely informational for title). */
  selectedId?: string | null
}
