"""Per-note encryption envelope.

Envelope (same as the old desktop app): {"encrypted": true, "data":
base64(version(1) + salt(16) + payload)}. Version 1 = Fernet with a
PBKDF2-SHA256 key; version 2 = legacy XOR, decrypt-only.

N2: a version-1 envelope may also hold "formats": a Fernet token (same key) of
{"sha256": hash of the note's text, "formats": [...]}. Older versions ignore
the field and still open the text. The hash ties the formats to that text.
"""

import base64
import hashlib
import json
import logging
import os
import re
import unicodedata
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken  # noqa: F401  (re-exported)
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

log = logging.getLogger("noirpad")

PBKDF2_ITERATIONS = 480_000
MIN_NOTE_PASSWORD = 4          # shorter than 8: the UI warns, see encryption.js
MAX_NOTE_PASSWORD = 1024
LEGACY_CERTAIN_BYTES = 16

_LEGACY_IMAGE_RE = re.compile("\x00IMG:[^\x00]*\x00")


def derive_key(password: str, salt: bytes) -> bytes:
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt,
                     iterations=PBKDF2_ITERATIONS)
    return base64.urlsafe_b64encode(kdf.derive(password.encode()))


def _text_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def encrypt_with_key(content: str, key: bytes, salt: bytes, formats: Optional[list] = None) -> str:
    """Version-1 envelope from an already derived key (no KDF cost)."""
    combined = b"\x01" + salt + Fernet(key).encrypt(content.encode("utf-8"))
    envelope = {"encrypted": True, "data": base64.b64encode(combined).decode("ascii")}
    if formats:
        sealed = json.dumps({"sha256": _text_hash(content), "formats": formats}, ensure_ascii=False)
        envelope["formats"] = Fernet(key).encrypt(sealed.encode("utf-8")).decode("ascii")
    return json.dumps(envelope)


def envelope_formats(stored: str, text: str, key: bytes) -> Optional[list]:
    """The formats sealed in a version-1 envelope for this *text*. None = the
    envelope has none (they may still be in note_formats). Formats that cannot
    be opened or belong to another text are ignored: the note opens without
    them, and the log gets a code, never content."""
    obj = json.loads(stored)
    if "formats" not in obj:
        return None
    try:
        sealed = json.loads(Fernet(key).decrypt(obj["formats"]))
        formats = sealed["formats"]
        if not isinstance(formats, list):
            raise ValueError("not a list")
        expected = sealed["sha256"]
    except (InvalidToken, TypeError, ValueError, KeyError):
        log.warning("Note formats ignored: formats_unreadable")
        return []
    if expected != _text_hash(text):
        log.warning("Note formats ignored: formats_mismatch")
        return []
    return formats


def _parse_envelope(stored: str) -> tuple[int, bytes, bytes]:
    obj = json.loads(stored)  # json.JSONDecodeError is a subclass of ValueError
    if not isinstance(obj, dict) or not obj.get("encrypted"):
        raise ValueError("Content is not encrypted")
    combined = base64.b64decode(obj["data"])
    return combined[0], combined[1:17], combined[17:]


def encrypt_content(content: str, password: str) -> str:
    """Encrypt with a fresh random salt (version 1)."""
    salt = os.urandom(16)
    return encrypt_with_key(content, derive_key(password, salt), salt)


def unlock_content(stored: str, password: str) -> tuple[str, bytes, bytes]:
    """Decrypt *stored* → (plaintext, key, salt) for later re-encryption.

    Raises ValueError for structurally-bad / not-encrypted / unknown-version
    input, and InvalidToken for a wrong password. A legacy version-2 note
    gets a fresh salt + version-1 key, so its next save upgrades it.
    """
    version, salt, payload = _parse_envelope(stored)
    if version == 1:
        key = derive_key(password, salt)
        return Fernet(key).decrypt(payload).decode("utf-8"), key, salt
    if version == 2:
        xor_key = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 100000)
        text = bytes(b ^ xor_key[i % len(xor_key)] for i, b in enumerate(payload)).decode("utf-8")
        new_salt = os.urandom(16)
        return text, derive_key(password, new_salt), new_salt
    raise ValueError("Unknown encryption version")


def decrypt_content(stored: str, password: str) -> str:
    return unlock_content(stored, password)[0]


def legacy_key(stored: str, password: str) -> bytes:
    """The XOR key of a legacy version-2 envelope. Keeps an unlocked legacy
    note removable from its lock until it has been upgraded."""
    _version, salt, _payload = _parse_envelope(stored)
    return hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 100000)


def decrypt_with_key(stored: str, key: bytes, xor_key: Optional[bytes] = None) -> str:
    version, _salt, payload = _parse_envelope(stored)
    if version == 2 and xor_key is not None:
        return bytes(b ^ xor_key[i % len(xor_key)] for i, b in enumerate(payload)).decode("utf-8")
    if version != 1:
        raise ValueError("Unknown encryption version")
    return Fernet(key).decrypt(payload).decode("utf-8")


def envelope_version(stored: str) -> Optional[int]:
    """1 or 2 for an envelope, None for anything else."""
    return _parse_envelope(stored)[0] if is_encrypted_content(stored) else None


def envelope_time(stored: str) -> Optional[float]:
    """When a version-1 envelope was written, without the password: a Fernet
    token starts with 0x80 and its creation time in the clear. None for
    anything else (a legacy envelope has no time)."""
    try:
        version, _salt, payload = _parse_envelope(stored)
        raw = base64.urlsafe_b64decode(payload)
    except (ValueError, TypeError, KeyError):
        return None
    if version != 1 or len(raw) < 9 or raw[0] != 0x80:
        return None
    return float(int.from_bytes(raw[1:9], "big"))


def legacy_text_is_certain(text: str) -> bool:
    """Can a decrypted legacy version-2 text be trusted without a person
    looking at it? XOR has no integrity check, so a wrong password can give
    valid UTF-8. Random bytes that long, free of control and unassigned
    characters, are practically impossible; a shorter text proves nothing.
    The old image marker is the one control character legacy notes may hold."""
    if len(text.encode("utf-8")) < LEGACY_CERTAIN_BYTES:
        return False
    return all(ch in "\t\n\r" or unicodedata.category(ch) not in ("Cc", "Cs", "Co", "Cn")
               for ch in _LEGACY_IMAGE_RE.sub("", text))


def is_encrypted_content(content: str) -> bool:
    """True if *content* is a NoirPad encryption envelope: {"encrypted": true,
    "data": base64 of version (1 or 2) + 16-byte salt + payload}. A plain
    note that merely looks like that JSON is not one (C12)."""
    try:
        obj = json.loads(content)
    except (json.JSONDecodeError, TypeError):
        return False
    if not (isinstance(obj, dict) and obj.get("encrypted") is True and isinstance(obj.get("data"), str)):
        return False
    try:
        raw = base64.b64decode(obj["data"], validate=True)
    except (ValueError, TypeError):
        return False
    return len(raw) > 17 and raw[0] in (1, 2)
