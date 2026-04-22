"""JSON-RPC application error codes and exception classes.

Must stay in lockstep with ``src/shared/error-codes.ts`` (TypeScript side).
See ``docs/rpc-contract.md`` §0.3.
"""

from __future__ import annotations

# JSON-RPC 2.0 reserved codes
PARSE_ERROR = -32700
INVALID_REQUEST = -32600
METHOD_NOT_FOUND = -32601
INVALID_PARAMS = -32602
INTERNAL_ERROR_RESERVED = -32603

# Application codes (-32000..-32099)
INTERNAL = -32000
CONNECTION_TIMEOUT = -32001
OLE_COM_UNAVAILABLE = -32002
CONNECTION_REFUSED = -32003
AUTH_FAILED = -32004
SERVER_NOT_FOUND = -32005

TAG_NOT_FOUND = -32010
TAG_TREE_FAIL = -32011

INVALID_RANGE = -32020
INVALID_SAMPLING = -32021
INVALID_FORMAT = -32022
OUTPUT_DIR_UNWRITABLE = -32023

EXPORT_CANCELLED = -32030
EXPORT_NOT_FOUND = -32031
EXPORT_ALREADY_RUNNING = -32032

ADAPTER_DRIVER = -32040
SIDECAR_RESTARTED = -32050


class RpcError(Exception):
    """Raised inside an RPC handler to produce a JSON-RPC error response."""

    def __init__(self, code: int, message: str, data: object | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.data = data

    def to_dict(self) -> dict:
        d: dict = {"code": self.code, "message": self.message}
        if self.data is not None:
            d["data"] = self.data
        return d


# Semantic subclasses — handy for adapters.
class ConnectionTimeoutError(RpcError):
    def __init__(self, timeout_s: int | float) -> None:
        super().__init__(CONNECTION_TIMEOUT, f"connection timeout after {timeout_s}s")


class OleComUnavailable(RpcError):
    def __init__(self) -> None:
        super().__init__(OLE_COM_UNAVAILABLE, "OLE/COM provider not available")


class ConnectionRefusedRpc(RpcError):
    def __init__(self, detail: str = "") -> None:
        msg = "connection refused"
        if detail:
            msg = f"{msg}: {detail}"
        super().__init__(CONNECTION_REFUSED, msg)


class AuthFailed(RpcError):
    def __init__(self) -> None:
        super().__init__(AUTH_FAILED, "authentication failed")


class ServerNotFound(RpcError):
    def __init__(self, server_id: str) -> None:
        super().__init__(SERVER_NOT_FOUND, f"server '{server_id}' not found")


class TagNotFoundError(RpcError):
    def __init__(self, tag_id: str) -> None:
        super().__init__(TAG_NOT_FOUND, f"tag '{tag_id}' not found")


class TagTreeFail(RpcError):
    def __init__(self, detail: str = "") -> None:
        msg = "failed to list tag tree"
        if detail:
            msg = f"{msg}: {detail}"
        super().__init__(TAG_TREE_FAIL, msg)


class InvalidRangeError(RpcError):
    def __init__(self, message: str = "start >= end") -> None:
        super().__init__(INVALID_RANGE, message)


class InvalidSamplingError(RpcError):
    def __init__(self, value: str) -> None:
        super().__init__(INVALID_SAMPLING, f"unknown sampling: {value}")


class InvalidFormatError(RpcError):
    def __init__(self, value: str) -> None:
        super().__init__(INVALID_FORMAT, f"unsupported format: {value}")


class OutputDirUnwritable(RpcError):
    def __init__(self, path: str) -> None:
        super().__init__(OUTPUT_DIR_UNWRITABLE, f"cannot write to {path}")


class ExportCancelled(RpcError):
    def __init__(self) -> None:
        super().__init__(EXPORT_CANCELLED, "export cancelled by user")


class ExportNotFound(RpcError):
    def __init__(self, task_id: str) -> None:
        super().__init__(EXPORT_NOT_FOUND, f"task '{task_id}' not found")


class ExportAlreadyRunning(RpcError):
    def __init__(self) -> None:
        super().__init__(EXPORT_ALREADY_RUNNING, "task already running")


class AdapterDriverError(RpcError):
    def __init__(self, detail: str) -> None:
        super().__init__(ADAPTER_DRIVER, f"driver error: {detail}")
