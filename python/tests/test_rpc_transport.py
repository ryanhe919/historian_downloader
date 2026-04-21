"""End-to-end test of the RPC transport + dispatcher wired through an in-memory stream."""

from __future__ import annotations

import asyncio
import io
import json

import pytest

from rpc.dispatcher import Dispatcher
from rpc.transport import LineTransport


class _FakeStdout:
    def __init__(self) -> None:
        self.buf = io.StringIO()
        self.lines: list[str] = []

    def write(self, s: str) -> int:
        self.buf.write(s)
        # Capture completed lines.
        val = self.buf.getvalue()
        while "\n" in val:
            line, _, rest = val.partition("\n")
            self.lines.append(line)
            val = rest
        self.buf = io.StringIO()
        self.buf.write(val)
        return len(s)

    def flush(self) -> None:
        pass


async def _make_stdin(lines: list[str]) -> asyncio.StreamReader:
    reader = asyncio.StreamReader(limit=4 * 1024 * 1024)
    for line in lines:
        reader.feed_data(line.encode("utf-8"))
    reader.feed_eof()
    return reader


@pytest.mark.asyncio
async def test_request_response_roundtrip():
    dispatcher = Dispatcher()

    @dispatcher.method("echo")
    async def echo(params):
        return {"you_said": params}

    stdin = await _make_stdin([
        '{"jsonrpc":"2.0","id":1,"method":"echo","params":{"msg":"hi"}}\n',
    ])
    stdout = _FakeStdout()
    transport = LineTransport(dispatcher.handle, stdin=stdin, stdout=stdout)

    await asyncio.wait_for(transport.run(), timeout=2.0)
    # Let dispatched tasks flush.
    await asyncio.sleep(0.05)

    assert stdout.lines, "expected at least one response line"
    resp = json.loads(stdout.lines[0])
    assert resp == {"jsonrpc": "2.0", "id": 1, "result": {"you_said": {"msg": "hi"}}}


@pytest.mark.asyncio
async def test_method_not_found_returns_error():
    dispatcher = Dispatcher()
    stdin = await _make_stdin(['{"jsonrpc":"2.0","id":2,"method":"nope"}\n'])
    stdout = _FakeStdout()
    transport = LineTransport(dispatcher.handle, stdin=stdin, stdout=stdout)
    await asyncio.wait_for(transport.run(), timeout=2.0)
    await asyncio.sleep(0.05)
    resp = json.loads(stdout.lines[0])
    assert resp["id"] == 2
    assert "error" in resp
    assert resp["error"]["code"] == -32601


@pytest.mark.asyncio
async def test_notification_has_no_response():
    dispatcher = Dispatcher()

    received: list = []

    @dispatcher.method("ping")
    async def ping(params):
        received.append(params)

    stdin = await _make_stdin(['{"jsonrpc":"2.0","method":"ping"}\n'])
    stdout = _FakeStdout()
    transport = LineTransport(dispatcher.handle, stdin=stdin, stdout=stdout)
    await asyncio.wait_for(transport.run(), timeout=2.0)
    await asyncio.sleep(0.05)
    assert stdout.lines == []
    assert received == [{}]


@pytest.mark.asyncio
async def test_rpc_error_exception_maps_to_error_response():
    from rpc import errors as rpc_errors

    dispatcher = Dispatcher()

    @dispatcher.method("boom")
    async def boom(_):
        raise rpc_errors.TagNotFoundError("t99")

    stdin = await _make_stdin(['{"jsonrpc":"2.0","id":7,"method":"boom"}\n'])
    stdout = _FakeStdout()
    transport = LineTransport(dispatcher.handle, stdin=stdin, stdout=stdout)
    await asyncio.wait_for(transport.run(), timeout=2.0)
    await asyncio.sleep(0.05)
    resp = json.loads(stdout.lines[0])
    assert resp["id"] == 7
    assert resp["error"]["code"] == rpc_errors.TAG_NOT_FOUND
