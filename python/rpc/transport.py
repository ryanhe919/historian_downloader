"""Line-delimited JSON transport over stdin/stdout (asyncio)."""

from __future__ import annotations

import asyncio
import json
import logging
import sys
from typing import Awaitable, Callable


log = logging.getLogger(__name__)

MAX_LINE_BYTES = 1 * 1024 * 1024  # 1 MiB per protocol §0.1


class LineTransport:
    """Reads JSON-RPC messages from stdin, writes to stdout, line-delimited UTF-8.

    ``handle_message`` is an async callable invoked for each well-formed JSON
    object received. The object is passed as a dict; its response (or None for
    notifications) is awaited and written back.
    """

    def __init__(
        self,
        handle_message: Callable[[dict], Awaitable[dict | None]],
        *,
        stdin: asyncio.StreamReader | None = None,
        stdout=None,
    ) -> None:
        self._handle = handle_message
        self._stdin = stdin
        self._stdout = stdout or sys.stdout
        self._write_lock = asyncio.Lock()
        self._stopping = False

    # ---------- public API ----------

    async def run(self) -> None:
        """Main loop — returns when stdin is closed."""
        reader = self._stdin or await _connect_stdin_reader()
        while not self._stopping:
            try:
                line = await reader.readline()
            except (asyncio.CancelledError, GeneratorExit):
                raise
            except Exception:  # pragma: no cover
                log.exception("stdin read error; terminating transport")
                return
            if not line:
                # EOF — parent closed stdin.
                log.info("stdin closed (EOF); transport loop exiting")
                return
            if len(line) > MAX_LINE_BYTES:
                log.warning("dropping stdin line of %d bytes (> %d MiB limit)", len(line), MAX_LINE_BYTES)
                continue
            text = line.decode("utf-8", errors="replace").rstrip("\r\n")
            if not text.strip():
                continue
            asyncio.create_task(self._dispatch(text))

    async def write(self, message: dict) -> None:
        """Serialize a single JSON-RPC message and flush stdout."""
        payload = json.dumps(message, ensure_ascii=False, separators=(",", ":"))
        if "\n" in payload:  # safety: collapse accidentally embedded newlines
            payload = payload.replace("\n", " ")
        line = payload + "\n"
        raw = line.encode("utf-8")
        if len(raw) > MAX_LINE_BYTES:
            log.error("refusing to write %d-byte line (> 1 MiB limit); id=%s method=%s",
                      len(raw), message.get("id"), message.get("method"))
            return
        async with self._write_lock:
            # stdout is a blocking text stream; writing is fast but we still want to
            # serialize concurrent writes so two coroutines don't interleave bytes.
            try:
                self._stdout.write(line)
                self._stdout.flush()
            except BrokenPipeError:  # pragma: no cover
                log.info("stdout broken pipe; parent likely exited")
                self._stopping = True

    def stop(self) -> None:
        self._stopping = True

    # ---------- helpers ----------

    async def _dispatch(self, text: str) -> None:
        try:
            obj = json.loads(text)
        except json.JSONDecodeError:
            log.warning("ignoring non-JSON line: %s", text[:200])
            return
        if not isinstance(obj, dict):
            log.warning("ignoring non-object JSON message: %s", type(obj).__name__)
            return
        try:
            response = await self._handle(obj)
        except Exception:  # pragma: no cover — handler is expected to catch
            log.exception("unhandled error in message handler")
            return
        if response is not None:
            await self.write(response)


async def _connect_stdin_reader() -> asyncio.StreamReader:
    """Wrap ``sys.stdin`` into an ``asyncio.StreamReader``."""
    loop = asyncio.get_running_loop()
    reader = asyncio.StreamReader(limit=MAX_LINE_BYTES * 2)
    protocol = asyncio.StreamReaderProtocol(reader)
    await loop.connect_read_pipe(lambda: protocol, sys.stdin)
    return reader


def configure_stdout() -> None:
    """Make stdout line-buffered with '\\n' newlines only."""
    try:
        sys.stdout.reconfigure(newline="\n", line_buffering=False, encoding="utf-8")
    except (AttributeError, ValueError):  # pragma: no cover
        pass
