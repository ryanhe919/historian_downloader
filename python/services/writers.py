"""File writers for CSV / JSON / Excel. All append-friendly for segment-by-segment export."""

from __future__ import annotations

import csv
import io
import json
import logging
import os
from dataclasses import dataclass
from pathlib import Path

from rpc import errors

log = logging.getLogger(__name__)


# Optional openpyxl import — only required if the user picks Excel.
try:
    import openpyxl  # type: ignore

    _HAS_OPENPYXL = True
except ImportError:  # pragma: no cover
    openpyxl = None  # type: ignore[assignment]
    _HAS_OPENPYXL = False


@dataclass
class WriteStats:
    rows: int
    bytes_appended: int


def resolve_output_dir(dir_path: str | Path) -> Path:
    """Normalize an output-dir path: expand ``~`` and resolve to absolute.

    Does NOT create the directory or check permissions — that is
    :func:`ensure_output_dir`'s job. Splitting the concerns lets callers
    inspect the resolved path (e.g. for error messages) before filesystem
    side effects.
    """
    raw = os.fspath(dir_path)
    expanded = os.path.expanduser(raw)
    absolute = os.path.abspath(expanded)
    return Path(absolute)


def ensure_output_dir(dir_path: str | Path) -> Path:
    """Resolve ``~``/relative paths, create the directory, and probe writability.

    Raises :class:`errors.OutputDirUnwritable` (mapped to ``-32023``) when
    creation fails, the path is not a directory, or it exists but is not
    writable by the current process.
    """
    p = resolve_output_dir(dir_path)
    try:
        p.mkdir(parents=True, exist_ok=True)
    except OSError as e:
        raise errors.OutputDirUnwritable(str(p)) from e
    if not p.is_dir():
        raise errors.OutputDirUnwritable(str(p))
    if not os.access(p, os.W_OK):
        raise errors.OutputDirUnwritable(str(p))
    # Belt-and-braces: actually write a probe file. os.access can lie on
    # some network filesystems / ACL-heavy Windows shares.
    try:
        probe = p / ".hd_write_probe"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink(missing_ok=True)
    except OSError as e:
        raise errors.OutputDirUnwritable(str(p)) from e
    return p


def supports_excel() -> bool:
    return _HAS_OPENPYXL


def validate_format(fmt: str) -> None:
    if fmt not in ("CSV", "Excel", "JSON"):
        raise errors.InvalidFormatError(fmt)
    if fmt == "Excel" and not _HAS_OPENPYXL:
        log.warning("Excel format requested but openpyxl is not installed")
        raise errors.InvalidFormatError("Excel (openpyxl not installed)")


def build_header(tag_ids: list[str], include_quality: bool) -> list[str]:
    header = ["time"]
    for tid in tag_ids:
        header.append(tid)
        if include_quality:
            header.append(f"{tid}__quality")
    return header


# ---------- CSV ----------


def write_csv_segment(
    path: Path,
    rows: list[dict],
    *,
    header: list[str],
    append: bool,
    include_quality: bool,
    utf8_bom: bool,
) -> WriteStats:
    """Append a batch of rows to ``path`` as CSV.

    Each row is ``{time, values: [...], quality: [...]}``.
    Writes the header only on the first call (``append=False``).
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    mode = "ab" if append else "wb"
    buf = io.BytesIO()
    text = io.TextIOWrapper(buf, encoding="utf-8", newline="")
    writer = csv.writer(text)
    if not append:
        writer.writerow(header)
    for row in rows:
        flat: list = [row["time"]]
        vals = row.get("values") or []
        qs = row.get("quality") or []
        for i, v in enumerate(vals):
            flat.append("" if v is None else v)
            if include_quality:
                flat.append(qs[i] if i < len(qs) else "")
        writer.writerow(flat)
    text.flush()
    data = buf.getvalue()
    if not append and utf8_bom:
        data = b"\xef\xbb\xbf" + data
    with open(path, mode) as f:
        f.write(data)
    return WriteStats(rows=len(rows), bytes_appended=len(data))


# ---------- JSON (JSONL) ----------


def write_json_segment(
    path: Path,
    rows: list[dict],
    *,
    append: bool,
    include_quality: bool,
    utf8_bom: bool,
) -> WriteStats:
    """Write rows as newline-delimited JSON (one object per line).

    We use JSONL rather than a single JSON array so segmented appending is trivial
    and consumers can stream-parse without loading the whole file.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    mode = "ab" if append else "wb"
    parts: list[bytes] = []
    if not append and utf8_bom:
        parts.append(b"\xef\xbb\xbf")
    for row in rows:
        obj = {"time": row["time"], "values": row.get("values") or []}
        if include_quality:
            obj["quality"] = row.get("quality") or []
        parts.append((json.dumps(obj, ensure_ascii=False) + "\n").encode("utf-8"))
    data = b"".join(parts)
    with open(path, mode) as f:
        f.write(data)
    return WriteStats(rows=len(rows), bytes_appended=len(data))


# ---------- Excel ----------


def write_excel_whole(
    path: Path,
    rows: list[dict],
    *,
    header: list[str],
    include_quality: bool,
) -> WriteStats:
    """Excel export is not streaming-friendly; write the entire file at once."""
    if not _HAS_OPENPYXL:
        raise errors.InvalidFormatError("Excel (openpyxl not installed)")
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Export"
    ws.append(header)
    total_rows = 0
    for row in rows:
        flat: list = [row["time"]]
        vals = row.get("values") or []
        qs = row.get("quality") or []
        for i, v in enumerate(vals):
            flat.append(v)
            if include_quality:
                flat.append(qs[i] if i < len(qs) else "")
        ws.append(flat)
        total_rows += 1
    path.parent.mkdir(parents=True, exist_ok=True)
    wb.save(str(path))
    try:
        size = path.stat().st_size
    except OSError:
        size = 0
    return WriteStats(rows=total_rows, bytes_appended=size)


def extension_for(fmt: str) -> str:
    return {"CSV": "csv", "Excel": "xlsx", "JSON": "jsonl"}.get(fmt, "csv")
