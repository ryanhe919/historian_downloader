"""Tests for ``util.crypto`` AES-GCM helpers."""

from __future__ import annotations

import base64

import pytest

from util import crypto


def test_encrypt_decrypt_roundtrip():
    blob = crypto.encrypt_password("hunter2")
    assert blob.startswith("aesgcm:")
    assert "hunter2" not in blob
    assert crypto.decrypt_password(blob) == "hunter2"


def test_encrypt_empty_and_unicode():
    assert crypto.decrypt_password(crypto.encrypt_password("")) == ""
    cn = "机密口令-🔐"
    assert crypto.decrypt_password(crypto.encrypt_password(cn)) == cn


def test_nonce_randomisation_yields_different_ciphertexts():
    a = crypto.encrypt_password("same")
    b = crypto.encrypt_password("same")
    assert a != b, "each encryption must use a fresh nonce"
    assert crypto.decrypt_password(a) == crypto.decrypt_password(b) == "same"


def test_different_machine_ids_derive_different_keys():
    crypto._reset_key_cache_for_tests()
    blob = crypto.encrypt_password("top-secret", machine_id="machine-A")
    # A key derived from machine-B should not decrypt a machine-A blob.
    with pytest.raises(ValueError):
        crypto.decrypt_password(blob, machine_id="machine-B")


def test_decrypt_rejects_non_aesgcm_blob():
    with pytest.raises(ValueError):
        crypto.decrypt_password("b64:aGVsbG8=")
    with pytest.raises(ValueError):
        crypto.decrypt_password("plaintext")


def test_decrypt_rejects_truncated_blob():
    # Valid prefix but too short for nonce + tag.
    trunc = "aesgcm:" + base64.b64encode(b"\x00" * 4).decode("ascii")
    with pytest.raises(ValueError):
        crypto.decrypt_password(trunc)


def test_encrypt_type_check():
    with pytest.raises(TypeError):
        crypto.encrypt_password(None)  # type: ignore[arg-type]
    with pytest.raises(TypeError):
        crypto.decrypt_password(None)  # type: ignore[arg-type]


def test_is_encrypted_helper():
    assert crypto.is_encrypted(crypto.encrypt_password("x")) is True
    assert crypto.is_encrypted("b64:aGVsbG8=") is False
    assert crypto.is_encrypted("plain") is False
