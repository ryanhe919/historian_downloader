"""AES-GCM helpers for local credential storage.

Key derivation: PBKDF2-HMAC-SHA256 over the machine-id with a fixed app salt,
100_000 iterations → 32-byte AES-256 key. Ciphertext payload is stored as
``base64(nonce || ciphertext_with_tag)`` under the ``aesgcm:`` scheme prefix.

This is NOT protection against an attacker with code execution on the same
machine — it's a "defense in depth / no plaintext on disk" tier. Do not rely
on it to protect against local admins or forensic imaging.
"""

from __future__ import annotations

import base64
import logging
import os
from typing import Optional

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

from util.machine_id import get_machine_id

log = logging.getLogger(__name__)


SCHEME = "aesgcm:"
SALT = b"hd-salt-v1"
ITERATIONS = 100_000
KEY_LEN = 32  # AES-256
NONCE_LEN = 12

_KEY_CACHE: dict[str, bytes] = {}


def _derive_key(machine_id: str) -> bytes:
    """PBKDF2-HMAC-SHA256(machine_id, SALT, 100_000) → 32 bytes."""
    cached = _KEY_CACHE.get(machine_id)
    if cached is not None:
        return cached
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=KEY_LEN,
        salt=SALT,
        iterations=ITERATIONS,
    )
    key = kdf.derive(machine_id.encode("utf-8"))
    _KEY_CACHE[machine_id] = key
    return key


def _get_key(machine_id: Optional[str] = None) -> bytes:
    mid = machine_id or get_machine_id()
    return _derive_key(mid)


def encrypt_password(plain: str, machine_id: Optional[str] = None) -> str:
    """Encrypt a plaintext password → ``aesgcm:<base64>``.

    Raises TypeError for non-str input.
    """
    if not isinstance(plain, str):
        raise TypeError(f"plain must be str, got {type(plain).__name__}")
    key = _get_key(machine_id)
    nonce = os.urandom(NONCE_LEN)
    ct = AESGCM(key).encrypt(nonce, plain.encode("utf-8"), None)
    blob = base64.b64encode(nonce + ct).decode("ascii")
    return SCHEME + blob


def decrypt_password(enc: str, machine_id: Optional[str] = None) -> str:
    """Decrypt a previously-encrypted blob. Raises ValueError on failure."""
    if not isinstance(enc, str):
        raise TypeError(f"enc must be str, got {type(enc).__name__}")
    if not enc.startswith(SCHEME):
        raise ValueError("not an aesgcm blob")
    try:
        raw = base64.b64decode(enc[len(SCHEME) :].encode("ascii"), validate=True)
    except (ValueError, TypeError) as exc:
        raise ValueError(f"invalid base64 payload: {exc}") from exc
    if len(raw) < NONCE_LEN + 16:
        raise ValueError("ciphertext truncated")
    nonce, ct = raw[:NONCE_LEN], raw[NONCE_LEN:]
    key = _get_key(machine_id)
    try:
        pt = AESGCM(key).decrypt(nonce, ct, None)
    except Exception as exc:  # cryptography.exceptions.InvalidTag → ValueError
        raise ValueError(f"decryption failed: {exc}") from exc
    return pt.decode("utf-8")


def is_encrypted(enc: str) -> bool:
    """True iff the blob uses the current aesgcm scheme."""
    return isinstance(enc, str) and enc.startswith(SCHEME)


def _reset_key_cache_for_tests() -> None:
    _KEY_CACHE.clear()
