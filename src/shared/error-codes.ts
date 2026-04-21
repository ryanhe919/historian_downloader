// JSON-RPC application error codes (see docs/rpc-contract.md §0.3).
// Must be kept in sync with python/rpc/errors.py.

export const ErrorCode = {
  INTERNAL: -32000,
  CONNECTION_TIMEOUT: -32001,
  OLE_COM_UNAVAILABLE: -32002,
  CONNECTION_REFUSED: -32003,
  AUTH_FAILED: -32004,
  SERVER_NOT_FOUND: -32005,
  TAG_NOT_FOUND: -32010,
  TAG_TREE_FAIL: -32011,
  INVALID_RANGE: -32020,
  INVALID_SAMPLING: -32021,
  INVALID_FORMAT: -32022,
  OUTPUT_DIR_UNWRITABLE: -32023,
  EXPORT_CANCELLED: -32030,
  EXPORT_NOT_FOUND: -32031,
  EXPORT_ALREADY_RUNNING: -32032,
  ADAPTER_DRIVER: -32040,
  SIDECAR_RESTARTED: -32050
} as const

export type ErrorCodeName = keyof typeof ErrorCode
export type ErrorCodeValue = (typeof ErrorCode)[ErrorCodeName]
