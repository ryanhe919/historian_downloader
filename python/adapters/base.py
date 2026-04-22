"""Abstract base class for Historian adapters."""

from __future__ import annotations

from datetime import datetime
from typing import Any, AsyncIterator


class BaseHistorianAdapter:
    """Contract that all historian adapters must implement.

    Concrete implementations:
      - MockAdapter (cross-platform, synthetic data)
      - ProficyHistorianAdapter (Windows-only, by engineer B)
      - SqlServerAdapter (pymssql, by engineer B)
    """

    def __init__(self, server: dict) -> None:
        self.server = server

    @property
    def server_id(self) -> str:
        return self.server.get("id", "")

    async def test_connection(self) -> dict:
        """Return ``{ok, latencyMs, tagCount?, version?, detail?}``."""
        raise NotImplementedError

    async def list_tag_tree(
        self, path: str | None = None, depth: int = 1
    ) -> list[dict]:
        raise NotImplementedError

    async def search_tags(
        self,
        query: str,
        limit: int = 100,
        offset: int = 0,
        filter_type: str | None = None,
    ) -> dict:
        raise NotImplementedError

    async def get_tag_meta(self, tag_id: str) -> dict:
        raise NotImplementedError

    async def read_segment(
        self,
        tag_ids: list[str],
        start: datetime,
        end: datetime,
        sampling: str,
    ) -> AsyncIterator[dict]:
        """Async iterator yielding row dicts ``{time, values: [...], quality: [...]}``."""
        raise NotImplementedError
        yield {}  # pragma: no cover — make this an async generator signature

    async def preview_sample(
        self,
        tag_ids: list[str],
        start: datetime,
        end: datetime,
        sampling: str,
        max_points: int = 240,
    ) -> dict:
        raise NotImplementedError

    async def close(self) -> None:
        return None
