"""Process-wide mutable state (never written to disk)."""

import os
import threading
from pathlib import Path
from typing import Callable, Optional

LOOPBACK_HOSTS = ("127.0.0.1", "localhost")


def env_allowed_hosts() -> set[str]:
    raw = os.environ.get("NOIRPAD_ALLOWED_HOSTS") or ""
    return {h.strip().lower() for h in raw.split(",") if h.strip()}


class _Runtime:
    mode: str = "server"
    password: Optional[str] = os.environ.get("NOIRPAD_PASSWORD") or None
    desktop_token: Optional[str] = None
    data_notice: Optional[dict] = None       # {"code", "params"}, shown once in the UI (D8)
    # Unlocked encrypted notes: token -> {note_id, key, salt, created, used}.
    # Keys live only here, never on disk; lost on lock, expiry or exit.
    unlocked: dict[str, dict] = {}
    allowed_hosts: set[str] = set(LOOPBACK_HOSTS) | env_allowed_hosts()
    sessions: dict[str, float] = {}       # token -> expires_at (epoch secs)
    login_failures: list[float] = []
    # App lock (app_lock.py): stored scrypt record, unlocked client tokens.
    app_lock: Optional[dict] = None
    app_lock_tokens: set[str] = set()
    app_lock_failures: list[float] = []
    note_password_failures: list[float] = []   # wrong note passwords (D15)
    # Desktop app (desktop.py): native "Save as" dialog, suggested name →
    # chosen path or None; files saved through it, token -> path (N6).
    save_dialog: Optional[Callable[[str], Optional[str]]] = None
    toggle_fullscreen: Optional[Callable[[], None]] = None   # desktop window (D13)
    saved_files: dict[str, Path] = {}
    # Set by POST /api/session/ready once the page has started; desktop.py
    # watches it so a start never hangs on "Loading" (N1.11 test, finding 6).
    page_ready: threading.Event = threading.Event()


RUNTIME = _Runtime()
