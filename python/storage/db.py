"""SQLite storage layer for servers, tasks, history, and settings.

All query methods return camelCase dicts matching the RPC contract.
Passwords are stored as AES-GCM blobs (``aesgcm:<base64>``); see
``util.crypto``. Legacy ``b64:`` and plaintext entries are read transparently
and re-encrypted on the next write.
"""

from __future__ import annotations

import base64
import json
import logging
import sqlite3
import threading
import uuid
from pathlib import Path
from typing import Any

from util.crypto import (
    SCHEME as AES_SCHEME,
    decrypt_password,
    encrypt_password,
    is_encrypted,
)
from util.time import iso_now

log = logging.getLogger(__name__)


MIGRATIONS_DIR = Path(__file__).parent / "migrations"
SCHEMA_VERSION = 1


class Storage:
    """Thin wrapper around ``sqlite3`` with WAL + a module-level lock.

    We keep a single connection and protect it with a lock rather than sharing
    it across threads; SQLite connections are not safe to use from multiple
    threads concurrently.
    """

    def __init__(self, db_path: Path | str) -> None:
        self._path = Path(db_path)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(
            str(self._path),
            isolation_level=None,
            check_same_thread=False,
            timeout=30.0,
        )
        self._conn.row_factory = sqlite3.Row
        self._lock = threading.RLock()
        self._init_schema()

    # ---------- schema ----------

    def _init_schema(self) -> None:
        with self._lock:
            self._conn.execute("PRAGMA journal_mode=WAL;")
            self._conn.execute("PRAGMA foreign_keys=ON;")
            # Check existing schema version first.
            try:
                cur = self._conn.execute(
                    "SELECT value FROM settings WHERE key='schema_version'"
                )
                row = cur.fetchone()
                current = int(row[0]) if row else 0
            except sqlite3.OperationalError:
                current = 0
            if current < SCHEMA_VERSION:
                sql_path = MIGRATIONS_DIR / "001_init.sql"
                if not sql_path.exists():
                    raise RuntimeError(f"missing migration: {sql_path}")
                sql = sql_path.read_text(encoding="utf-8")
                self._conn.executescript(sql)
                log.info(
                    "storage: migrated to schema v%d at %s", SCHEMA_VERSION, self._path
                )

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    # ---------- settings ----------

    def get_setting(self, key: str, default: str | None = None) -> str | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT value FROM settings WHERE key = ?", (key,)
            ).fetchone()
        return row[0] if row else default

    def set_setting(self, key: str, value: str) -> None:
        with self._lock:
            self._conn.execute(
                "INSERT INTO settings(key, value) VALUES(?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (key, value),
            )

    # ---------- servers ----------

    def save_server(self, server: dict, server_id: str | None = None) -> dict:
        """Insert or update a server. Returns the full Server dict."""
        now = iso_now()
        sid = server_id or server.get("id") or _uuid()
        password = server.get("password")
        password_enc = _encode_password(password) if password else None

        with self._lock:
            existing = self._conn.execute(
                "SELECT * FROM servers WHERE id = ?", (sid,)
            ).fetchone()

            if existing is None:
                self._conn.execute(
                    """
                    INSERT INTO servers
                      (id, name, type, host, port, username, password_enc,
                       timeout_s, tls, windows_auth, extra_json,
                       created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        sid,
                        server.get("name", ""),
                        server.get("type", "iFix"),
                        server.get("host", ""),
                        server.get("port"),
                        server.get("username"),
                        password_enc,
                        int(server.get("timeoutS", 15)),
                        1 if server.get("tls") else 0,
                        1 if server.get("windowsAuth") else 0,
                        json.dumps(server.get("extra") or {}, ensure_ascii=False),
                        now,
                        now,
                    ),
                )
            else:
                # Keep existing password if not provided in update.
                new_pw = (
                    password_enc if password is not None else existing["password_enc"]
                )
                self._conn.execute(
                    """
                    UPDATE servers SET
                      name=?, type=?, host=?, port=?, username=?, password_enc=?,
                      timeout_s=?, tls=?, windows_auth=?, extra_json=?, updated_at=?
                    WHERE id=?
                    """,
                    (
                        server.get("name", existing["name"]),
                        server.get("type", existing["type"]),
                        server.get("host", existing["host"]),
                        server.get("port", existing["port"]),
                        server.get("username", existing["username"]),
                        new_pw,
                        int(server.get("timeoutS", existing["timeout_s"] or 15)),
                        1 if server.get("tls", bool(existing["tls"])) else 0,
                        (
                            1
                            if server.get("windowsAuth", bool(existing["windows_auth"]))
                            else 0
                        ),
                        json.dumps(server.get("extra") or {}, ensure_ascii=False),
                        now,
                        sid,
                    ),
                )
        return self.get_server(sid)  # type: ignore[return-value]

    def get_server(self, server_id: str) -> dict | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM servers WHERE id = ?", (server_id,)
            ).fetchone()
        return _server_row_to_dict(row) if row else None

    def list_servers(self) -> list[dict]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM servers ORDER BY created_at"
            ).fetchall()
        return [_server_row_to_dict(r) for r in rows]

    def delete_server(self, server_id: str) -> bool:
        with self._lock:
            cur = self._conn.execute("DELETE FROM servers WHERE id = ?", (server_id,))
        return cur.rowcount > 0

    def get_server_password(self, server_id: str) -> str | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT password_enc FROM servers WHERE id = ?", (server_id,)
            ).fetchone()
        if not row or not row[0]:
            return None
        stored = row[0]
        plain = _decode_password(stored)
        # Opportunistic re-encryption: if the on-disk value is legacy b64: /
        # plaintext, upgrade it to the AES-GCM scheme now that we know the
        # plaintext. Failure to rewrite is non-fatal.
        if not is_encrypted(stored):
            try:
                new_enc = _encode_password(plain)
                with self._lock:
                    self._conn.execute(
                        "UPDATE servers SET password_enc = ?, updated_at = ? WHERE id = ?",
                        (new_enc, iso_now(), server_id),
                    )
                log.info("password_enc: upgraded server %s to AES-GCM", server_id)
            except Exception as exc:  # pragma: no cover — best-effort
                log.warning(
                    "password_enc: failed to upgrade server %s: %s", server_id, exc
                )
        return plain

    # ---------- tasks ----------

    def create_task(self, task: dict) -> dict:
        now = iso_now()
        tid = task.get("id") or _uuid()
        with self._lock:
            self._conn.execute(
                """
                INSERT INTO tasks
                  (id, server_id, name, tag_ids_json, range_start, range_end,
                   sampling, segment_days, format, output_dir, output_path, status,
                   total_segments, done_segments, progress, checkpoint, size_bytes,
                   speed_bps, error, options_json, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    tid,
                    task["serverId"],
                    task["name"],
                    json.dumps(task["tagIds"], ensure_ascii=False),
                    task["range"]["start"],
                    task["range"]["end"],
                    task["sampling"],
                    int(task["segmentDays"]),
                    task["format"],
                    task["outputDir"],
                    task.get("outputPath"),
                    task.get("status", "queued"),
                    int(task.get("totalSegments", 0)),
                    int(task.get("doneSegments", 0)),
                    int(task.get("progress", 0)),
                    task.get("checkpoint"),
                    int(task.get("sizeBytes", 0)),
                    int(task.get("speedBytesPerSec", 0)),
                    task.get("error"),
                    json.dumps(task.get("options") or {}, ensure_ascii=False),
                    now,
                    now,
                ),
            )
        return self.get_task(tid)  # type: ignore[return-value]

    def update_task(self, task_id: str, **fields: Any) -> dict | None:
        if not fields:
            return self.get_task(task_id)
        mapping = {
            "status": "status",
            "totalSegments": "total_segments",
            "doneSegments": "done_segments",
            "progress": "progress",
            "checkpoint": "checkpoint",
            "sizeBytes": "size_bytes",
            "speedBytesPerSec": "speed_bps",
            "outputPath": "output_path",
            "error": "error",
            "name": "name",
        }
        sets: list[str] = []
        values: list[Any] = []
        for k, v in fields.items():
            col = mapping.get(k)
            if col is None:
                continue
            sets.append(f"{col}=?")
            values.append(v)
        if not sets:
            return self.get_task(task_id)
        sets.append("updated_at=?")
        values.append(iso_now())
        values.append(task_id)
        with self._lock:
            self._conn.execute(
                f"UPDATE tasks SET {', '.join(sets)} WHERE id = ?",
                tuple(values),
            )
        return self.get_task(task_id)

    def get_task(self, task_id: str) -> dict | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM tasks WHERE id = ?", (task_id,)
            ).fetchone()
        return _task_row_to_dict(row) if row else None

    def list_tasks(self, *, statuses: list[str] | None = None) -> list[dict]:
        with self._lock:
            if statuses:
                placeholders = ",".join("?" * len(statuses))
                rows = self._conn.execute(
                    f"SELECT * FROM tasks WHERE status IN ({placeholders}) "
                    "ORDER BY created_at",
                    tuple(statuses),
                ).fetchall()
            else:
                rows = self._conn.execute(
                    "SELECT * FROM tasks ORDER BY created_at"
                ).fetchall()
        return [_task_row_to_dict(r) for r in rows]

    def list_next_queued(self) -> dict | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM tasks WHERE status IN ('queued','running') "
                "ORDER BY created_at LIMIT 1"
            ).fetchone()
        return _task_row_to_dict(row) if row else None

    def complete_task(
        self, task_id: str, *, status: str, error: str | None = None
    ) -> dict | None:
        return self.update_task(
            task_id,
            status=status,
            error=error,
            progress=100 if status == "done" else None,
        )

    # ---------- history ----------

    def add_history(self, item: dict) -> dict:
        hid = item.get("id") or _uuid()
        created = item.get("createdAt") or iso_now()
        with self._lock:
            self._conn.execute(
                """
                INSERT INTO history
                  (id, task_id, name, path, server_id, tag_count, rows, size_bytes,
                   range_start, range_end, format, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    hid,
                    item.get("taskId"),
                    item["name"],
                    item["path"],
                    item.get("serverId"),
                    int(item.get("tagCount", 0)),
                    int(item.get("rows", 0)),
                    int(item.get("sizeBytes", 0)),
                    (item.get("range") or {}).get("start"),
                    (item.get("range") or {}).get("end"),
                    item.get("format", "CSV"),
                    created,
                ),
            )
        return self.get_history(hid)  # type: ignore[return-value]

    def get_history(self, history_id: str) -> dict | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM history WHERE id = ?", (history_id,)
            ).fetchone()
        return _history_row_to_dict(row) if row else None

    def list_history(
        self,
        *,
        limit: int = 50,
        offset: int = 0,
        query: str | None = None,
    ) -> tuple[list[dict], int]:
        params: list[Any] = []
        where = ""
        if query:
            where = "WHERE name LIKE ?"
            params.append(f"%{query}%")
        with self._lock:
            total_row = self._conn.execute(
                f"SELECT COUNT(*) FROM history {where}", tuple(params)
            ).fetchone()
            rows = self._conn.execute(
                f"SELECT * FROM history {where} "
                "ORDER BY created_at DESC LIMIT ? OFFSET ?",
                tuple(params) + (int(limit), int(offset)),
            ).fetchall()
        return [_history_row_to_dict(r) for r in rows], int(total_row[0])

    def remove_history(self, history_id: str) -> bool:
        with self._lock:
            cur = self._conn.execute("DELETE FROM history WHERE id = ?", (history_id,))
        return cur.rowcount > 0


# ---------- helpers ----------


def _uuid() -> str:
    return uuid.uuid4().hex


def _encode_password(pw: str) -> str:
    """Encrypt a plaintext password with AES-GCM (machine-id-derived key)."""
    return encrypt_password(pw)


def _decode_password(enc: str) -> str:
    """Decrypt a stored password blob.

    Supports three on-disk forms for backward compatibility:
      1. ``aesgcm:<b64>`` — current scheme.
      2. ``b64:<b64>``    — legacy placeholder (v0.1.0 sidecar).
      3. raw plaintext    — any other opaque string; treated as-is so
         legacy rows keep working.
    """
    if is_encrypted(enc):
        try:
            return decrypt_password(enc)
        except ValueError:
            log.warning(
                "password_enc: AES-GCM decrypt failed; "
                "machine-id may have changed — treating as plaintext"
            )
            return enc
    if enc.startswith("b64:"):
        try:
            return base64.b64decode(enc[4:].encode("ascii")).decode("utf-8")
        except (ValueError, UnicodeDecodeError):
            return enc
    return enc


def _server_row_to_dict(row: sqlite3.Row) -> dict:
    out: dict[str, Any] = {
        "id": row["id"],
        "name": row["name"],
        "type": row["type"],
        "host": row["host"],
        "hasPassword": bool(row["password_enc"]),
        "timeoutS": int(row["timeout_s"] or 15),
        "tls": bool(row["tls"]),
        "windowsAuth": bool(row["windows_auth"]),
        "status": "offline",  # live status is managed at runtime, not in DB
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }
    if row["port"] is not None:
        out["port"] = int(row["port"])
    if row["username"]:
        out["username"] = row["username"]
    return out


def _task_row_to_dict(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "serverId": row["server_id"],
        "name": row["name"],
        "tagIds": json.loads(row["tag_ids_json"] or "[]"),
        "tagCount": len(json.loads(row["tag_ids_json"] or "[]")),
        "range": {"start": row["range_start"], "end": row["range_end"]},
        "sampling": row["sampling"],
        "segmentDays": int(row["segment_days"]),
        "format": row["format"],
        "outputDir": row["output_dir"],
        "outputPath": row["output_path"],
        "status": row["status"],
        "totalSegments": int(row["total_segments"] or 0),
        "doneSegments": int(row["done_segments"] or 0),
        "progress": int(row["progress"] or 0),
        "checkpoint": row["checkpoint"],
        "sizeBytes": int(row["size_bytes"] or 0),
        "speedBytesPerSec": int(row["speed_bps"] or 0),
        "error": row["error"],
        "options": json.loads(row["options_json"] or "{}"),
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def _history_row_to_dict(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "taskId": row["task_id"],
        "name": row["name"],
        "path": row["path"],
        "serverId": row["server_id"],
        "tagCount": int(row["tag_count"] or 0),
        "rows": int(row["rows"] or 0),
        "sizeBytes": int(row["size_bytes"] or 0),
        "range": {
            "start": row["range_start"],
            "end": row["range_end"],
        },
        "format": row["format"] or "CSV",
        "createdAt": row["created_at"],
    }


def public_task_view(task: dict) -> dict:
    """Strip internal fields (tagIds, options, checkpoint) so tasks match ExportTask contract."""
    out = dict(task)
    out.pop("tagIds", None)
    out.pop("options", None)
    out.pop("checkpoint", None)
    return out
