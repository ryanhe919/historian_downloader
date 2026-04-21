# hd-sidecar

Historian Downloader's Python sidecar — a JSON-RPC 2.0 server over stdin/stdout
consumed by the Electron main process.

## Requirements

- Python >= 3.10 (tested on 3.14 / macOS)
- Standard library only at runtime. Optional: `openpyxl` (Excel export),
  `pywin32` + `pymssql` (Windows real adapters, engineer B).

## Development

```bash
cd python
python -m pip install --user -r requirements-dev.txt      # pytest
python -m pytest tests/ -v
```

Run the sidecar directly for manual JSON-RPC smoke tests:

```bash
cd python
echo '{"jsonrpc":"2.0","id":1,"method":"historian.listServers"}' | python main.py
```

Expected output (two lines, order: `system.ready` notification, then the
response):

```json
{"jsonrpc":"2.0","method":"system.ready","params":{"version":"0.1.0", ... }}
{"jsonrpc":"2.0","id":1,"result":[ ... ]}
```

All log output goes to **stderr**. stdout is reserved for JSON-RPC messages
(one message per line, UTF-8, `\n` delimited, ≤ 1 MiB per line).

## Environment variables

| Name               | Purpose                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------ |
| `HD_USER_DATA_DIR` | Directory for `hd.sqlite3`. Set by Electron main; falls back to an OS-appropriate default. |
| `HD_FORCE_MOCK`    | `=1` forces `MockAdapter` regardless of server type.                                       |
| `HD_LOG_FILE`      | Optional path for an extra logging sink.                                                   |

## Layout

```
python/
├── main.py                  # asyncio entry point
├── rpc/                     # dispatcher, transport, errors, types
├── adapters/                # base + mock + Windows stubs (engineer B)
├── services/                # export queue, writers, segmenter, estimator
├── storage/                 # SQLite wrapper + SQL migration
├── util/                    # logging, time, paths
└── tests/                   # pytest suite
```

## Not implemented (handed off to engineer B)

- `adapters/proficy.py` — real Proficy iFix OLE DB queries
- `adapters/sqlserver.py` — InTouch `OpenQuery(INSQL, ...)` via pymssql
- Credential encryption (currently base64 in `password_enc`; upgrade to AES-GCM
  keyed off machine-id)
