"""notes_data.json: locked read-modify-write, backups, recovery, migrations.

The data paths are module globals so tests (and set_data_dir) can repoint
them; other modules read them at call time as ``storage.DATA_FILE``.
"""

import copy
import json
import logging
import os
import threading
import time
from pathlib import Path
from typing import IO, Any, Callable, Optional

from . import config
from .errors import ApiError
from .runtime import RUNTIME
from .tree import has_user_ids, strip_user_ids

log = logging.getLogger("noirpad")

DATA_DIR: Path
DATA_FILE: Path
DATA_BAK: Path
DATA_TMP: Path
IMAGES_DIR: Path
IMAGES_DIR_R: Path

# A plain Lock: helpers called while it is held use the *_unlocked variants.
file_lock = threading.Lock()

DEFAULT_DATA: dict[str, Any] = {
    "tree": [],
    "notes": {},
    "favorites": [],
    "trash": {"tree": [], "notes": {}},
    "note_formats": {},
    # note_id -> [image filename, ...]. Lets us clean images of encrypted
    # notes (whose content can't be regex-parsed) from the trash.
    "note_images": {},
    # Per-note rendering mode. Absence == "rich-text" (default for legacy
    # notes); explicit "markdown" enables block-level MD syntax rendering.
    # Only non-default values are stored, keeping the data file small.
    "note_modes": {},
    "theme": "matrix",
    "ui_font": "jetbrains-mono",
    "font_family": "Cascadia Code",
    "font_size": 12,
    "autosave": False,
    "page_orientation": "landscape",
    # Noir effects (Settings → Noir effects): off for a new install.
    "glow_enabled": False,
    "matrix_rain_enabled": False,
    "crt_enabled": False,
    "show_splash": True,
    "autosave_interval": 5,
    "spellcheck": True,
    "glitch_effect": True,
    "confirm_delete": True,
    "idle_lock_minutes": "off",
    "default_encrypted": False,
    "glow_intensity": 100,  # 0-150 percent
    "custom_shortcuts": {},  # id -> "Ctrl+Shift+X" (only non-default)
    "language": "auto",      # "auto" (browser language) | "en" | "cs"
    "md_split": True,        # Markdown: preview next to the source
    "ui_zoom": 100,          # desktop window, percent (Ctrl+= / Ctrl+- / Ctrl+0)
    "recent_notes": [],      # start page: [{"id", "at"}], newest first (max 10)
}


def set_data_dir(path: Path) -> None:
    """Point the backend at *path* and run the one-time data migrations."""
    global DATA_DIR, DATA_FILE, DATA_BAK, DATA_TMP, IMAGES_DIR, IMAGES_DIR_R
    DATA_DIR = Path(path)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    DATA_FILE = DATA_DIR / "notes_data.json"
    DATA_BAK = DATA_DIR / "notes_data.json.bak"
    DATA_TMP = DATA_DIR / "notes_data.json.tmp"
    IMAGES_DIR = DATA_DIR / "images"
    IMAGES_DIR.mkdir(exist_ok=True)
    IMAGES_DIR_R = IMAGES_DIR.resolve()
    RUNTIME.data_notice = None
    _remove_interrupted_writes()
    _migrate_legacy_data_if_needed(DATA_DIR)
    _migrate_to_single_profile()
    _scrub_profile_snapshots()
    _migrate_noir_effects()
    RUNTIME.app_lock = read_data().get("app_lock") or None
    RUNTIME.app_lock_tokens.clear()


def _remove_interrupted_writes() -> None:
    """N1: temp files left by a crash hold whole copies of the data. A write
    replaces its target only when complete, so with notes_data.json in place
    they are never needed. Without it, one may be all that is left: keep it.
    Runs before anything else writes, under the instance lock (R11)."""
    if not DATA_FILE.exists():
        return
    backups = DATA_DIR / "backups"
    for leftover in [*DATA_DIR.glob("notes_data*.tmp"), *backups.glob("*.tmp"), *backups.glob("*.part")]:
        try:
            leftover.unlink()
        except OSError as exc:
            log.warning("Could not remove %s: errno %s", leftover.name, exc.errno)


def _migrate_legacy_data_if_needed(target_dir: Path) -> None:
    """Seed an empty *target_dir* from a project-directory database, once.

    Very old builds kept notes_data.json + images/ next to the code. Only
    runs when the data dir has no notes_data.json yet; never overwrites.
    """
    base = config.PROJECT_DIR
    target_data = target_dir / "notes_data.json"
    legacy_data = base / "notes_data.json"
    if target_data.exists() or not legacy_data.is_file():
        return
    if base.resolve() == target_dir.resolve():
        return
    try:
        target_data.write_bytes(legacy_data.read_bytes())
    except OSError as exc:
        log.error("Failed to migrate notes_data.json: %s", exc)
        return

    legacy_images = base / "images"
    target_images = target_dir / "images"
    if legacy_images.is_dir():
        target_images.mkdir(exist_ok=True)
        for src in legacy_images.iterdir():
            dst = target_images / src.name
            if not src.is_file() or dst.exists():
                continue
            try:
                dst.write_bytes(src.read_bytes())
            except OSError as exc:
                log.warning("Could not migrate image %s: %s", src.name, exc)

    log.warning("Migrated legacy NoirPad data from %s -> %s", base, target_dir)


# ---------------------------------------------------------------------------
# Rotating backups
# ---------------------------------------------------------------------------
#
# Snapshots of notes_data.json live in DATA_DIR/backups/: at most one per
# BACKUP_MIN_INTERVAL seconds, the newest BACKUP_KEEP are kept.

BACKUP_MIN_INTERVAL = 10 * 60
BACKUP_KEEP = 7


def backups_dir() -> Path:
    return DATA_DIR / "backups"


def stamp() -> str:
    """Sortable timestamp, unique enough for several files per second."""
    now = time.time()
    return time.strftime("%Y%m%d-%H%M%S", time.localtime(now)) + f"-{int(now * 1e6) % 1_000_000:06d}"


def rotate(pattern: str, keep: int) -> None:
    for old in sorted(backups_dir().glob(pattern))[:-keep]:
        try:
            old.unlink()
        except OSError as exc:
            log.warning("Could not remove old backup %s: %s", old.name, exc)


def make_backup(force: bool = False) -> Optional[Path]:
    """Snapshot the current notes_data.json into backups/ (throttled).

    Callers writing the data file hold file_lock; the file being copied
    was just read successfully, so a snapshot is always a valid file.
    R7: a snapshot that cannot be made never stops the save itself.
    """
    dest = None
    try:
        if not DATA_FILE.exists():
            return None
        bdir = backups_dir()
        bdir.mkdir(exist_ok=True)
        existing = sorted(bdir.glob("notes_data-*.json"))
        if (not force and existing
                and time.time() - existing[-1].stat().st_mtime < BACKUP_MIN_INTERVAL):
            return None
        dest = bdir / f"notes_data-{stamp()}.json"
        dest.write_bytes(DATA_FILE.read_bytes())
    except OSError as exc:
        log.warning("Could not write a backup snapshot: errno %s (%s)", exc.errno, exc.strerror)
        if dest is not None:
            dest.unlink(missing_ok=True)
        return None
    rotate("notes_data-*.json", BACKUP_KEEP)
    return dest


# ---------------------------------------------------------------------------
# Reading and writing
# ---------------------------------------------------------------------------


def _load_json_file(path: Path) -> dict[str, Any]:
    """Parse a data file. ValueError (bad UTF-8 / JSON / shape) = corrupt.
    R10: a BOM (Notepad, PowerShell 5.1) is fine; a hand-edited structure
    is repaired in memory instead of breaking the app."""
    data = json.loads(path.read_bytes().decode("utf-8-sig"))
    if not isinstance(data, dict):
        raise ValueError("top level is not an object")
    if _repair_shape(data):
        log.warning("%s had an unexpected structure; repaired in memory", path.name)
    return data


def _repair_items(items: Any) -> tuple[list, bool]:
    """A tree as a list of {id, type, ...} dicts with list children."""
    if not isinstance(items, list):
        return [], items is not None
    out, changed = [], False
    for item in items:
        if not isinstance(item, dict) or not isinstance(item.get("id"), str):
            changed = True
            continue
        if "children" in item or item.get("type") == "folder":
            kids, kids_changed = _repair_items(item.get("children"))
            changed |= kids_changed or ("children" in item and not isinstance(item["children"], list))
            item["children"] = kids
        if "tags" in item and not isinstance(item["tags"], list):
            item["tags"] = []
            changed = True
        out.append(item)
    return out, changed


def _repair_shape(data: dict[str, Any]) -> bool:
    """Structural keys get the type the app expects (settings are left
    alone: a missing glow_enabled still means "migrate the effects")."""
    changed = False
    data["tree"], c = _repair_items(data.get("tree"))
    changed |= c
    trash = data.get("trash")
    if not isinstance(trash, dict):
        trash, changed = {}, changed or trash is not None
    trash["tree"], c = _repair_items(trash.get("tree"))
    changed |= c
    data["trash"] = trash
    for holder, key in ((data, "notes"), (trash, "notes"), (data, "note_formats"),
                        (data, "note_images"), (data, "note_modes")):
        if not isinstance(holder.get(key, {}), dict):
            holder[key] = {}
            changed = True
        holder.setdefault(key, {})
    if not isinstance(data.get("favorites", []), list):
        data["favorites"] = []
        changed = True
    return changed


def _atomic_write_json(path: Path, data: dict[str, Any]) -> None:
    """tmp file + fsync + os.replace: a crash never leaves a half file, a
    failed write no leftover .tmp (R7)."""
    tmp = path.with_name(path.name + ".tmp")
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except BaseException:
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass
        raise


def _recover_corrupt_data(reason: Exception) -> dict[str, Any]:
    """notes_data.json is unreadable: keep it aside, fall back to a backup.

    The damaged file is never overwritten — it is renamed to
    notes_data.corrupt-<timestamp>.json. The newest backup that parses is
    restored; the UI shows RUNTIME.data_notice to the user.
    """
    corrupt = DATA_DIR / f"notes_data.corrupt-{stamp()}.json"
    os.replace(DATA_FILE, corrupt)
    log.error("notes_data.json is corrupt (%s); moved to %s", reason, corrupt.name)
    try:
        os.utime(corrupt)   # the age limit (scrub.py) counts from today, not from its last save
    except OSError as exc:
        log.warning("Could not date %s: errno %s", corrupt.name, exc.errno)

    candidates = sorted(backups_dir().glob("notes_data-*.json"), reverse=True)
    if DATA_BAK.exists():           # single .bak written by older versions
        candidates.append(DATA_BAK)
    for candidate in candidates:
        try:
            data = _load_json_file(candidate)
        except (OSError, ValueError):
            continue
        _noir_effects_upgrade(data)      # a snapshot from before the redesign
        _atomic_write_json(DATA_FILE, data)
        when = time.strftime("%Y-%m-%d %H:%M", time.localtime(candidate.stat().st_mtime))
        RUNTIME.data_notice = {"code": "data_restored",
                               "params": {"file": corrupt.name, "when": when}}
        return data

    RUNTIME.data_notice = {"code": "data_reset", "params": {"file": corrupt.name}}
    return copy.deepcopy(DEFAULT_DATA)


def read_data_unlocked() -> dict[str, Any]:
    """Read notes_data.json WITHOUT taking the lock (caller must hold it)."""
    if not DATA_FILE.exists():
        return copy.deepcopy(DEFAULT_DATA)
    try:
        return _load_json_file(DATA_FILE)
    except ValueError as exc:  # includes UnicodeDecodeError / JSONDecodeError
        return _recover_corrupt_data(exc)


def write_data_unlocked(data: dict[str, Any]) -> None:
    """Write notes_data.json WITHOUT taking the lock (caller must hold it)."""
    make_backup()
    _atomic_write_json(DATA_FILE, data)


# Kept in notes_data.json but never sent to the browser or put in a backup.
PRIVATE_KEYS = ("app_lock", "scrub_pending", "scrub_locked", "scrub_first_pass_done")


def public_view(data: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in data.items() if k not in PRIVATE_KEYS}


def read_data() -> dict[str, Any]:
    """Locked read — for read-only endpoints."""
    with file_lock:
        return read_data_unlocked()


def update_data(mutator: Callable[[dict[str, Any]], Any]) -> Any:
    """Hold the lock across the WHOLE read-modify-write sequence.

    `mutator(data)` mutates `data` in place and may return a value that is
    forwarded to the caller. If the mutator raises (e.g. HTTPException for a
    validation failure), the lock is released and NO write happens.
    """
    return update_data_tracked(mutator)[0]


def update_data_tracked(mutator: Callable[[dict[str, Any]], Any]) -> tuple[Any, str, str]:
    """update_data + the ETag right before and right after this write (R9):
    a client whose copy was at `before` is at `after` with its own change."""
    with file_lock:
        before = _etag_unlocked()
        data = read_data_unlocked()
        result = mutator(data)
        try:
            write_data_unlocked(data)
        except OSError as exc:
            # R7: say why (e.g. the disk is full); the file on disk is unchanged.
            log.error("Saving notes_data.json failed: errno %s (%s)", exc.errno, exc.strerror)
            raise ApiError(507, "data_write_failed", error=exc.strerror or type(exc).__name__)
        after = _etag_unlocked()
    return result, before, after


def _etag_unlocked() -> str:
    try:
        st = DATA_FILE.stat()
    except FileNotFoundError:
        return '"0"'
    return f'"{st.st_mtime_ns:x}-{st.st_size:x}"'


def data_etag() -> str:
    """Changes whenever notes_data.json is rewritten (D13)."""
    with file_lock:
        return _etag_unlocked()


def read_data_with_etag() -> tuple[dict[str, Any], str]:
    """The data and the ETag of exactly that state, read under one lock."""
    with file_lock:
        data = read_data_unlocked()
        return data, _etag_unlocked()


# ---------------------------------------------------------------------------
# Single local profile
# ---------------------------------------------------------------------------
#
# NoirPad has one profile per data directory. Data written by the old
# multi-user build (top-level `users`/`sessions`, `user_id` on every tree
# item) is flattened once at startup.


def _migrate_noir_effects() -> None:
    """Data from before the "G" redesign keeps the look it had.

    The new defaults switch the Noir effects off, but an existing install
    must not lose them silently: glow stays on (it always was), matrix
    rain keeps its stored value (on unless the user turned it off), and
    CRT is left unset so the browser can carry over its old local
    setting. The old default UI font Orbitron becomes JetBrains Mono, the
    redesign's monospace face. Runs once: glow_enabled marks it as done.
    """
    with file_lock:
        if not DATA_FILE.exists():
            return
        try:
            data = read_data_unlocked()
        except OSError:
            return
        if _noir_effects_upgrade(data):
            write_data_unlocked(data)
            log.info("Noir effects: kept the effects of the existing data")


def _noir_effects_upgrade(data: dict[str, Any]) -> bool:
    """Make pre-redesign *data* keep its effects (see above). False = nothing to do."""
    if "glow_enabled" in data:
        return False
    data["glow_enabled"] = True
    data["matrix_rain_enabled"] = data.get("matrix_rain_enabled", True) is not False
    if data.get("ui_font", "orbitron") == "orbitron":
        data["ui_font"] = "jetbrains-mono"
    return True


def _without_accounts(data: dict[str, Any]) -> dict[str, Any]:
    """I6: a copy without the old accounts' secrets — only the user names
    stay (to tell whose notes were whose); password hashes and session
    tokens never sit in a forgotten snapshot."""
    def public(user: Any) -> Any:
        return {k: v for k, v in user.items() if k in _ACCOUNT_PUBLIC} if isinstance(user, dict) else user

    clean = {k: v for k, v in data.items() if k != "sessions"}
    users = data.get("users")
    if isinstance(users, dict):
        clean["users"] = {uid: public(u) for uid, u in users.items()}
    elif isinstance(users, list):
        clean["users"] = [public(u) for u in users]
    return clean


_ACCOUNT_PUBLIC = ("id", "username", "name", "display_name")


def _scrub_profile_snapshots() -> None:
    """I6: snapshots written by older versions still hold the accounts'
    password hashes: rewrite them once without (the notes stay)."""
    for snap in DATA_DIR.glob("notes_data.pre-single-profile-*.json"):
        try:
            data = _load_json_file(snap)
            if _without_accounts(data) == data:
                continue
            _atomic_write_json(snap, _without_accounts(data))
            log.info("Removed old account data from %s", snap.name)
        except (OSError, ValueError) as exc:
            log.warning("Could not clean %s: %s", snap.name, exc)


def _migrate_to_single_profile() -> None:
    """Flatten a legacy multi-user notes_data.json into the single profile.

    The original file is kept as
    `notes_data.pre-single-profile-<timestamp>.json` next to it.
    """
    with file_lock:
        if not DATA_FILE.exists():
            return
        try:
            data = read_data_unlocked()
        except OSError:  # corrupt content is recovered inside read_data_unlocked
            return
        legacy = (
            "users" in data
            or "sessions" in data
            or has_user_ids(data.get("tree") or [])
            or has_user_ids((data.get("trash") or {}).get("tree") or [])
        )
        if not legacy:
            return
        snapshot = DATA_FILE.with_name(
            f"notes_data.pre-single-profile-{time.strftime('%Y%m%d-%H%M%S')}.json")
        _atomic_write_json(snapshot, _without_accounts(data))
        data.pop("users", None)
        data.pop("sessions", None)
        strip_user_ids(data.get("tree") or [])
        strip_user_ids((data.get("trash") or {}).get("tree") or [])
        write_data_unlocked(data)
        log.warning("Converted multi-user data to a single profile (snapshot: %s)",
                    snapshot.name)


def acquire_instance_lock(data_dir: Optional[Path] = None) -> Optional[IO]:
    """Lock DATA_DIR/noirpad.lock so only one NoirPad uses this data dir.

    Two processes doing read-modify-write on the same notes_data.json would
    silently drop each other's changes (D7). Returns the open lock handle
    (keep it alive for the process lifetime) or None if another NoirPad —
    desktop or web — already holds it. The OS releases it on exit/crash.
    """
    path = Path(data_dir or DATA_DIR) / "noirpad.lock"
    handle = open(path, "a+")
    try:
        if os.name == "nt":
            import msvcrt
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        handle.close()
        return None
    return handle
