"""JSON-RPC dispatcher with decorator-based method registration."""

from __future__ import annotations

import asyncio
import inspect
import logging
from typing import Any, Awaitable, Callable

from . import errors


log = logging.getLogger(__name__)


Handler = Callable[[dict], Awaitable[Any]]
EmitFn = Callable[[str, dict], Awaitable[None]]


class Dispatcher:
    """Registry + router for JSON-RPC methods.

    Usage::

        dispatcher = Dispatcher()

        @dispatcher.method("historian.listServers")
        async def list_servers(params):
            return [...]

        response = await dispatcher.handle(request_dict)
    """

    def __init__(self) -> None:
        self._methods: dict[str, Handler] = {}
        self._emit: EmitFn | None = None

    # ---------- registration ----------

    def method(self, name: str) -> Callable[[Handler], Handler]:
        def decorator(func: Handler) -> Handler:
            if name in self._methods:
                raise ValueError(f"method already registered: {name}")
            self._methods[name] = func
            return func

        return decorator

    def register(self, name: str, handler: Handler) -> None:
        if name in self._methods:
            raise ValueError(f"method already registered: {name}")
        self._methods[name] = handler

    def has(self, name: str) -> bool:
        return name in self._methods

    def methods(self) -> list[str]:
        return sorted(self._methods)

    # ---------- notifications ----------

    def set_emit(self, emit: EmitFn) -> None:
        self._emit = emit

    async def emit(self, method: str, params: dict | None = None) -> None:
        """Push a notification to the peer (no id)."""
        if self._emit is None:
            log.debug("emit() called before transport is wired; dropping %s", method)
            return
        await self._emit(method, params or {})

    # ---------- dispatch ----------

    async def handle(self, message: dict) -> dict | None:
        """Dispatch one message. Returns a response dict, or None for notifications."""
        jsonrpc = message.get("jsonrpc")
        method = message.get("method")
        msg_id = message.get("id")
        params = message.get("params") or {}

        if jsonrpc != "2.0" or not isinstance(method, str):
            if msg_id is None:
                return None  # malformed notification — just drop
            return _error_response(msg_id, errors.INVALID_REQUEST, "invalid request")

        handler = self._methods.get(method)
        if handler is None:
            if msg_id is None:
                # Unknown notification — ignored per spec.
                log.debug("ignoring unknown notification: %s", method)
                return None
            return _error_response(msg_id, errors.METHOD_NOT_FOUND, f"method not found: {method}")

        if not isinstance(params, (dict, list)):
            if msg_id is None:
                return None
            return _error_response(msg_id, errors.INVALID_PARAMS, "params must be object or array")

        # Notifications: run but never reply.
        if msg_id is None:
            try:
                await _call_handler(handler, params)
            except Exception:
                log.exception("error in notification handler %s", method)
            return None

        # Requests: run, catch everything, return result or error.
        try:
            result = await _call_handler(handler, params)
        except errors.RpcError as rpc_err:
            log.info("rpc error in %s: code=%d msg=%s", method, rpc_err.code, rpc_err.message)
            return {"jsonrpc": "2.0", "id": msg_id, "error": rpc_err.to_dict()}
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            log.exception("unhandled exception in %s", method)
            return _error_response(msg_id, errors.INTERNAL, f"internal error: {exc}")
        return {"jsonrpc": "2.0", "id": msg_id, "result": result}


async def _call_handler(handler: Handler, params: Any) -> Any:
    res = handler(params)
    if inspect.isawaitable(res):
        return await res
    return res


def _error_response(msg_id: Any, code: int, message: str) -> dict:
    return {"jsonrpc": "2.0", "id": msg_id, "error": {"code": code, "message": message}}
