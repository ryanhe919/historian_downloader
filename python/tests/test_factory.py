from __future__ import annotations

import pytest

from adapters.factory import create_adapter
from rpc import errors


def test_create_adapter_keeps_mock_for_explicit_mock_server():
    adapter = create_adapter({"id": "mock-1", "type": "mock"})

    assert adapter.__class__.__name__ == "MockAdapter"


def test_create_adapter_raises_when_ifix_driver_unavailable(monkeypatch):
    class FakeAdapter:
        @classmethod
        def is_available(cls) -> bool:
            return False

    monkeypatch.setattr("adapters.proficy.ProficyHistorianAdapter", FakeAdapter)

    with pytest.raises(errors.OleComUnavailable):
        create_adapter({"id": "srv-1", "type": "iFix"})


def test_create_adapter_raises_when_sqlserver_driver_unavailable(monkeypatch):
    class FakeAdapter:
        @classmethod
        def is_available(cls) -> bool:
            return False

    monkeypatch.setattr("adapters.sqlserver.SqlServerAdapter", FakeAdapter)

    with pytest.raises(errors.AdapterDriverError, match="pymssql is not installed"):
        create_adapter({"id": "srv-2", "type": "InTouch"})
