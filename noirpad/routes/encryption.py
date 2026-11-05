"""Per-note encryption endpoints.

The password is sent once: to lock (/api/encrypt) or unlock (/api/unlock).
The server derives the key, keeps it in memory and hands back a short-lived
unlock token for that one note. Autosave sends the token, never the
password. /api/lock, /api/lock-all, idle expiry and process exit forget the
key. PBKDF2 runs outside the data-file lock.
"""

import logging
import os
import secrets
import time
from typing import Optional

from fastapi import APIRouter

from .. import scrub
from ..crypto import (MAX_NOTE_PASSWORD, MIN_NOTE_PASSWORD, InvalidToken, decrypt_content,
                      decrypt_with_key, derive_key, encrypt_with_key, envelope_version,
                      is_encrypted_content, legacy_key, legacy_text_is_certain, unlock_content)
from ..errors import ApiError
from ..server_auth import guarded_attempt
from .notes import set_mode
from ..images import extract_image_names
from ..models import DecryptReq, LockReq, PasswordReq, SaveEncryptedReq
from ..runtime import RUNTIME
from ..storage import read_data, update_data
from ..tree import note_exists

log = logging.getLogger("noirpad")

router = APIRouter()

UNLOCK_IDLE_TTL = 30 * 60        # forget a key after 30 min without use
UNLOCK_MAX_TTL = 12 * 60 * 60    # … and after 12 h no matter what


def _check_new_password(password: str) -> None:
    if len(password) < MIN_NOTE_PASSWORD:
        raise ApiError(400, "password_too_short", min=MIN_NOTE_PASSWORD)
    if len(password) > MAX_NOTE_PASSWORD:
        raise ApiError(400, "password_too_long")


def _expired(entry: dict, now: float) -> bool:
    return now - entry["used"] > UNLOCK_IDLE_TTL or now - entry["created"] > UNLOCK_MAX_TTL


def _remember_key(note_id: str, key: bytes, salt: bytes, xor_key: Optional[bytes] = None) -> str:
    now = time.time()
    for tok, entry in list(RUNTIME.unlocked.items()):
        if _expired(entry, now):
            RUNTIME.unlocked.pop(tok, None)
    token = secrets.token_urlsafe(32)
    RUNTIME.unlocked[token] = {"note_id": note_id, "key": key, "salt": salt, "xor_key": xor_key,
                               "created": now, "used": now}
    return token


def _key_for(token: Optional[str], note_id: str) -> dict:
    entry = RUNTIME.unlocked.get(token or "")
    now = time.time()
    if entry is None or entry["note_id"] != note_id or _expired(entry, now):
        RUNTIME.unlocked.pop(token or "", None)
        raise ApiError(401, "note_locked")
    entry["used"] = now
    return entry


def _forget_note_keys(note_id: str) -> None:
    for tok, entry in list(RUNTIME.unlocked.items()):
        if entry["note_id"] == note_id:
            RUNTIME.unlocked.pop(tok, None)


def _stored_note(data: dict, note_id: str) -> str:
    content = data.get("notes", {}).get(note_id)
    if content is None or not note_exists(data, note_id):
        raise ApiError(404, "note_not_found")
    return content


@router.post("/api/encrypt")
def encrypt_note(req: PasswordReq):
    """Lock a plain note. Returns an unlock token so it stays open."""
    _check_new_password(req.password)
    salt = os.urandom(16)
    key = derive_key(req.password, salt)

    def _mut(data: dict) -> None:
        content = _stored_note(data, req.id)
        if is_encrypted_content(content):
            raise ApiError(400, "note_already_encrypted")
        # Image names from the PLAINTEXT, so the trash cleanup still finds them.
        data.setdefault("note_images", {})[req.id] = extract_image_names(content)
        data["notes"][req.id] = encrypt_with_key(content, key, salt)

    update_data(_mut)
    scrub.request_sweep()      # after the write: the snapshot it made still holds the text
    return {"ok": True, "unlock_token": _remember_key(req.id, key, salt)}


def _guess():
    """D15: at most LOGIN_MAX_FAILURES wrong note passwords per
    LOGIN_WINDOW (all notes, all clients), as for the app lock; a try
    holds its slot while the KDF runs (parallel guesses, R8)."""
    return guarded_attempt(RUNTIME.note_password_failures)


class _NoteChanged(Exception):
    """The note is no longer the envelope the upgrade started from."""


def _upgrade_legacy_note(note_id: str, stored: str, text: str, key: bytes, salt: bytes) -> bool:
    """N4: replace a legacy XOR envelope with version 1 right after the
    password opened it. On any problem the original stays as it is and the
    note still opens; its next save upgrades it. A text that cannot be told
    from a wrong password's output waits for that save too."""
    if not legacy_text_is_certain(text):
        return False
    try:
        upgraded = encrypt_with_key(text, key, salt)
        if decrypt_with_key(upgraded, key) != text:
            raise ValueError("the new envelope does not open")

        def _mut(data: dict) -> None:
            if data.get("notes", {}).get(note_id) != stored:
                raise _NoteChanged()
            data.setdefault("note_images", {})[note_id] = extract_image_names(text)
            data["notes"][note_id] = upgraded

        update_data(_mut)
    except Exception as exc:  # the note must open no matter what
        log.warning("Could not upgrade a legacy note: %s", type(exc).__name__)
        return False
    scrub.request_sweep()
    return True


@router.post("/api/unlock")
def unlock_note(req: PasswordReq):
    """Check the password and return the plaintext + an unlock token.

    The file stays encrypted.
    """
    data = read_data()
    stored = _stored_note(data, req.id)
    with _guess():
        try:
            text, key, salt = unlock_content(stored, req.password)
        except (InvalidToken, ValueError):
            raise ApiError(400, "wrong_password")
    xor_key = None
    if envelope_version(stored) == 2 and not _upgrade_legacy_note(req.id, stored, text, key, salt):
        xor_key = legacy_key(stored, req.password)
    return {
        "content": text,
        "formats": data.get("note_formats", {}).get(req.id, []),
        "mode": data.get("note_modes", {}).get(req.id, "rich-text"),
        "unlock_token": _remember_key(req.id, key, salt, xor_key),
    }


@router.post("/api/save-encrypted")
def save_encrypted(req: SaveEncryptedReq):
    """Autosave of an unlocked note: re-encrypt with the remembered key."""
    entry = _key_for(req.unlock_token, req.id)

    def _mut(data: dict) -> None:
        _stored_note(data, req.id)
        data.setdefault("note_images", {})[req.id] = extract_image_names(req.content)
        data["notes"][req.id] = encrypt_with_key(req.content, entry["key"], entry["salt"])
        if req.formats:
            data.setdefault("note_formats", {})[req.id] = req.formats
        else:   # cleared formatting must stay cleared (D16)
            data.get("note_formats", {}).pop(req.id, None)
        set_mode(data, req.id, req.mode)

    update_data(_mut)
    if entry["xor_key"] is not None:      # this save upgraded a legacy note
        entry["xor_key"] = None
        scrub.request_sweep()
    if req.lock_after:
        RUNTIME.unlocked.pop(req.unlock_token, None)
    return {"ok": True}


def _text_for_removal(stored: str, password: str) -> str:
    """The text a permanent removal may write, from the password alone. Only
    a legacy text that is certain: without an integrity check, a wrong
    password would otherwise replace the note with nonsense for good."""
    text = decrypt_content(stored, password)
    if envelope_version(stored) == 2 and not legacy_text_is_certain(text):
        raise ApiError(400, "legacy_note_unlock_first")
    return text


@router.post("/api/decrypt")
def decrypt_note(req: DecryptReq):
    """Remove encryption for good (unlock token, or the password)."""
    entry = _key_for(req.unlock_token, req.id) if req.unlock_token else None
    if entry is None and not req.password:
        raise ApiError(400, "password_required")
    stored_before = read_data().get("notes", {}).get(req.id)
    key = entry["key"] if entry else None
    if key is None and stored_before is not None:
        with _guess():
            try:
                _text_for_removal(stored_before, req.password)   # KDF outside the lock
            except (InvalidToken, ValueError):
                raise ApiError(400, "wrong_password")

    def _mut(data: dict) -> None:
        stored = _stored_note(data, req.id)
        try:
            text = (decrypt_with_key(stored, key, entry["xor_key"]) if key is not None
                    else _text_for_removal(stored, req.password))
        except (InvalidToken, ValueError):
            raise ApiError(400, "wrong_password")
        data["notes"][req.id] = text
        data.setdefault("note_images", {})[req.id] = extract_image_names(text)

    update_data(_mut)
    _forget_note_keys(req.id)
    return {"ok": True}


@router.post("/api/lock")
def lock_note(req: LockReq):
    """Forget the key behind one unlock token (lock button, closing a tab)."""
    RUNTIME.unlocked.pop(req.unlock_token, None)
    return {"ok": True}


@router.post("/api/lock-all")
def lock_all():
    """Forget every remembered key (auto-lock, leaving the page)."""
    RUNTIME.unlocked.clear()
    return {"ok": True}
