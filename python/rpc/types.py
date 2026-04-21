"""TypedDict definitions mirroring ``docs/rpc-contract.md``.

Field names use camelCase for wire-parity with the TypeScript side.
"""

from __future__ import annotations

from typing import Literal, NotRequired, TypedDict


# ---------- domain types ----------

HistorianType = Literal["iFix", "InTouch"]
ConnStatus = Literal["connected", "ready", "offline"]
Sampling = Literal["raw", "1m", "5m", "1h"]
ExportFormat = Literal["CSV", "Excel", "JSON"]
ExportStatus = Literal["queued", "running", "paused", "done", "cancelled", "failed"]
Quality = Literal["Good", "Uncertain", "Bad"]


class TimeRange(TypedDict):
    start: str
    end: str


class ServerInput(TypedDict, total=False):
    type: HistorianType
    host: str
    port: int
    username: str
    password: str
    timeoutS: int
    tls: bool
    windowsAuth: bool
    name: str


class ServerTD(TypedDict):
    id: str
    name: str
    type: HistorianType
    host: str
    port: NotRequired[int]
    username: NotRequired[str]
    hasPassword: bool
    timeoutS: int
    tls: bool
    windowsAuth: bool
    version: NotRequired[str]
    status: ConnStatus
    tagCount: NotRequired[int]
    createdAt: str
    updatedAt: str


class TestConnectionResult(TypedDict, total=False):
    ok: bool
    latencyMs: int
    tagCount: int
    version: str
    detail: str


class TagNode(TypedDict, total=False):
    id: str
    label: str
    kind: Literal["folder", "leaf"]
    count: int
    hasChildren: bool
    desc: str
    unit: str
    type: Literal["Analog", "Digital"]
    dataType: str


class SearchTagsResult(TypedDict):
    items: list[TagNode]
    total: int


class TagMeta(TagNode, total=False):
    min: float
    max: float
    precision: int
    description: str
    sampleIntervalMs: int
    firstTimestamp: str
    lastTimestamp: str


class PreviewSampleResult(TypedDict):
    times: list[str]
    values: list[list[float | None]]
    quality: list[list[Quality]]
    tags: list[dict]
    truncated: bool


class ExportTaskTD(TypedDict):
    id: str
    serverId: str
    name: str
    tagCount: int
    range: TimeRange
    sampling: str
    segmentDays: int
    totalSegments: int
    doneSegments: int
    progress: int
    status: ExportStatus
    speedBytesPerSec: NotRequired[int]
    sizeBytes: NotRequired[int]
    estimatedSizeBytes: NotRequired[int]
    outputPath: NotRequired[str]
    format: ExportFormat
    error: NotRequired[str]
    createdAt: str
    updatedAt: str


class ExportProgressEvent(TypedDict, total=False):
    taskId: str
    progress: int
    doneSegments: int
    totalSegments: int
    currentSegment: dict
    speedBytesPerSec: int
    sizeBytes: int
    estimatedSizeBytes: int
    rowsWritten: int


class ExportHistoryItem(TypedDict):
    id: str
    name: str
    path: str
    serverId: NotRequired[str]
    tagCount: int
    rows: int
    sizeBytes: int
    range: TimeRange
    format: ExportFormat
    createdAt: str
    exists: bool


class ExportHistoryResult(TypedDict):
    items: list[ExportHistoryItem]
    total: int


class SystemReadyEvent(TypedDict):
    version: str
    pythonVersion: str
    platform: str
    adapters: dict
    userDataDir: str
