"""Logging utilities — force all output to stderr so that stdout stays pure JSON-RPC."""

from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

_configured = False


def configure_logging_to_stderr(
    level: int | str = logging.INFO, log_file: str | Path | None = None
) -> None:
    """Configure the root logger to emit to stderr and optionally a file.

    Idempotent — safe to call multiple times (subsequent calls are no-ops).
    NEVER logs to stdout: stdout is reserved for JSON-RPC messages.
    """
    global _configured
    if _configured:
        return

    root = logging.getLogger()
    root.setLevel(level)

    # Remove any default handlers that may point at stdout.
    for h in list(root.handlers):
        root.removeHandler(h)

    fmt = logging.Formatter(
        fmt="%(asctime)s %(levelname)-5s %(name)s: %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
    )

    stderr_handler = logging.StreamHandler(stream=sys.stderr)
    stderr_handler.setFormatter(fmt)
    root.addHandler(stderr_handler)

    # Optional file log controlled via env var.
    file_path = log_file or os.environ.get("HD_LOG_FILE")
    if file_path:
        try:
            p = Path(file_path)
            p.parent.mkdir(parents=True, exist_ok=True)
            fh = logging.FileHandler(p, encoding="utf-8")
            fh.setFormatter(fmt)
            root.addHandler(fh)
        except OSError as e:  # pragma: no cover
            root.warning("could not open log file %s: %s", file_path, e)

    _configured = True
