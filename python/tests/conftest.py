"""Pytest config — put the sidecar root on sys.path so absolute imports work.

Also wires a tiny shim so tests marked ``@pytest.mark.asyncio`` run under
``asyncio.run()`` without requiring the external ``pytest-asyncio`` plugin.
"""

from __future__ import annotations

import asyncio
import inspect
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def pytest_collection_modifyitems(config, items):
    # Register the mark so no warnings are emitted.
    config.addinivalue_line(
        "markers",
        "asyncio: run this async test function via asyncio.run()",
    )


@pytest.hookimpl(tryfirst=True)
def pytest_pyfunc_call(pyfuncitem):
    func = pyfuncitem.obj
    if inspect.iscoroutinefunction(func):
        # Gather the signature-matched kwargs, then run.
        sig = inspect.signature(func)
        kwargs = {name: pyfuncitem.funcargs[name] for name in sig.parameters}
        asyncio.run(func(**kwargs))
        return True
    return None
