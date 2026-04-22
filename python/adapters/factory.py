"""Adapter factory: pick the right historian adapter by server type + platform."""

from __future__ import annotations

import logging
import os

from .base import BaseHistorianAdapter
from .mock import MockAdapter
from rpc import errors

log = logging.getLogger(__name__)


def create_adapter(server: dict) -> BaseHistorianAdapter:
    """Return an adapter instance appropriate for the given server config.

    Precedence:
      1. ``HD_FORCE_MOCK=1`` or ``server.type == 'mock'`` → MockAdapter.
      2. ``iFix`` + Windows + pywin32 available → ProficyHistorianAdapter.
      3. ``InTouch`` + pymssql available → SqlServerAdapter.
      4. Unsupported / misconfigured real adapters raise a typed RpcError.
      5. Otherwise → MockAdapter (with a warning).
    """
    stype = (server or {}).get("type")

    if os.environ.get("HD_FORCE_MOCK") == "1" or stype == "mock":
        return MockAdapter(server)

    if stype == "iFix":
        try:
            from .proficy import ProficyHistorianAdapter

            if ProficyHistorianAdapter.is_available():
                return ProficyHistorianAdapter(server)
            log.warning(
                "iFix adapter unavailable on this host (no pywin32 / not Windows)"
            )
            raise errors.OleComUnavailable()
        except Exception as exc:  # pragma: no cover — defensive: import failure
            if isinstance(exc, errors.RpcError):
                raise
            log.warning("failed to import ProficyHistorianAdapter: %s", exc)
            raise errors.OleComUnavailable() from exc

    if stype == "InTouch":
        try:
            from .sqlserver import SqlServerAdapter

            if SqlServerAdapter.is_available():
                return SqlServerAdapter(server)
            log.warning("InTouch adapter unavailable (pymssql not installed)")
            raise errors.AdapterDriverError("pymssql is not installed")
        except Exception as exc:  # pragma: no cover
            if isinstance(exc, errors.RpcError):
                raise
            log.warning("failed to import SqlServerAdapter: %s", exc)
            raise errors.AdapterDriverError(str(exc)) from exc

    log.warning("unknown server type %r; defaulting to MockAdapter", stype)
    return MockAdapter(server)


def adapter_support() -> dict:
    """Return which adapters are available on this platform (for system.ready)."""
    proficy_ok = False
    sqlserver_ok = False
    try:
        from .proficy import ProficyHistorianAdapter

        proficy_ok = ProficyHistorianAdapter.is_available()
    except Exception:  # pragma: no cover
        proficy_ok = False
    try:
        from .sqlserver import SqlServerAdapter

        sqlserver_ok = SqlServerAdapter.is_available()
    except Exception:  # pragma: no cover
        sqlserver_ok = False
    return {
        "proficy": proficy_ok,
        "sqlserver": sqlserver_ok,
        "mock": True,
    }
