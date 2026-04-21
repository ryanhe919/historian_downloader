"""Ensure password_enc in SQLite is AES-GCM + backward compat with legacy b64."""

from __future__ import annotations

import base64
import sqlite3

import pytest

from storage.db import Storage
from util.crypto import SCHEME as AES_SCHEME


@pytest.fixture()
def storage(tmp_path):
    db = Storage(tmp_path / "hd.sqlite3")
    yield db
    db.close()


def _raw_password_enc(db_path, server_id):
    conn = sqlite3.connect(str(db_path))
    try:
        row = conn.execute(
            "SELECT password_enc FROM servers WHERE id = ?", (server_id,)
        ).fetchone()
        return row[0] if row else None
    finally:
        conn.close()


def test_save_server_writes_aesgcm_blob(tmp_path, storage):
    s = storage.save_server({
        "name": "iFix-crypt", "type": "iFix", "host": "10.0.0.9",
        "password": "secret-value",
    })
    raw = _raw_password_enc(storage._path, s["id"])
    assert raw is not None
    assert raw.startswith(AES_SCHEME), f"password_enc must be AES-GCM, got {raw!r}"
    assert "secret-value" not in raw
    # b64 of 'secret-value' must not appear either — otherwise we still leak it.
    b64_plain = base64.b64encode(b"secret-value").decode("ascii")
    assert b64_plain not in raw
    # decrypt round-trip works through the public API.
    assert storage.get_server_password(s["id"]) == "secret-value"


def test_legacy_b64_record_still_reads_and_upgrades(tmp_path, storage):
    s = storage.save_server({
        "name": "legacy", "type": "iFix", "host": "10.0.0.7",
        "password": "placeholder",  # we overwrite below
    })
    sid = s["id"]

    # Forcibly rewrite password_enc to the legacy b64: format to emulate
    # a v0.1.0 row that predates the AES-GCM upgrade.
    legacy = "b64:" + base64.b64encode(b"legacy-pw").decode("ascii")
    with storage._lock:
        storage._conn.execute(
            "UPDATE servers SET password_enc = ? WHERE id = ?", (legacy, sid)
        )

    # Read → decrypt should yield the legacy plaintext.
    assert storage.get_server_password(sid) == "legacy-pw"

    # The on-disk value should now have been upgraded to aesgcm: form.
    raw = _raw_password_enc(storage._path, sid)
    assert raw.startswith(AES_SCHEME), "legacy password must be re-encrypted on first read"
    assert storage.get_server_password(sid) == "legacy-pw"


def test_update_without_password_preserves_aesgcm(storage):
    s = storage.save_server({
        "name": "n1", "type": "iFix", "host": "1.1.1.1", "password": "keep-me",
    })
    sid = s["id"]
    storage.save_server({"name": "n1-renamed", "type": "iFix", "host": "1.1.1.1"}, server_id=sid)
    assert storage.get_server_password(sid) == "keep-me"
    raw = _raw_password_enc(storage._path, sid)
    assert raw.startswith(AES_SCHEME)


def test_has_password_flag_is_true_after_encryption(storage):
    s = storage.save_server({
        "name": "has-pw", "type": "iFix", "host": "1.2.3.4", "password": "pw",
    })
    assert s["hasPassword"] is True
