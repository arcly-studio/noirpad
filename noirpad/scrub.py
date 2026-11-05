"""Keeps locked and permanently deleted notes out of the automatic copies (N1).

The copies are the snapshots, the pre-import zips, the set-aside damaged data
files and the leftovers of old versions. One idempotent pass compares them
with the current data: a note that is locked now gets its envelope instead of
readable text, a note deleted for good is removed. Ids of deleted notes wait
in the private data key `scrub_pending` until every copy has been handled, so
a failed or interrupted pass is repeated at the next start.

Passes run on one background thread, outside `storage.file_lock`: they never
hold up the start, a save or closing the app. Copies are replaced atomically,
so a killed pass leaves at most a leftover temp file (removed at start).

A note is never removed just because the current data lacks it: that is also
what an emptied data file or a replacing import looks like, and the copies
exist for exactly those cases. A copy that cannot be parsed cannot be cleaned;
the retention limits below are what removes those.
"""

import json
import logging
import os
import threading
import time
import zipfile
from pathlib import Path
from typing import Any, Optional

from . import storage
from .crypto import envelope_version, is_encrypted_content

log = logging.getLogger("noirpad")

STARTUP_DELAY = 5.0            # seconds after the server start
STOP_TIMEOUT = 2.0             # closing the app waits at most this long
MAX_AGE = 30 * 24 * 60 * 60    # for pre-import zips and damaged data files
CORRUPT_KEEP = 3

# Tests turn the thread off and call sweep() themselves.
BACKGROUND = True

# One pass at a time: two would overwrite each other's changes in a copy.
_pass_lock = threading.Lock()

_state_lock = threading.Lock()
_wake = threading.Event()
_thread: Optional[threading.Thread] = None
_due: Optional[float] = None


# ---------------------------------------------------------------------------
# One copy
# ---------------------------------------------------------------------------


def _exposes(value: Any, current: str) -> bool:
    """Does this version of a locked note say more than the current envelope?
    Readable text does; so does the weak legacy format once the note is upgraded."""
    if not is_encrypted_content(value):
        return True
    return envelope_version(value) == 2 and envelope_version(current) != 2


def _lock_notes(notes: Any, locked: dict[str, str]) -> bool:
    if not isinstance(notes, dict):
        return False
    changed = False
    for note_id, envelope in locked.items():
        if note_id in notes and _exposes(notes[note_id], envelope):
            notes[note_id] = envelope
            changed = True
    return changed


def _without_items(items: Any, ids: set[str]) -> tuple[Any, bool]:
    """*items* without the deleted ones. Children of a deleted folder that are
    not deleted themselves (moved out later) stay, one level up."""
    if not isinstance(items, list):
        return items, False
    out: list = []
    changed = False
    for item in items:
        if not isinstance(item, dict):
            out.append(item)
            continue
        children, kids_changed = _without_items(item.get("children"), ids)
        changed |= kids_changed
        if isinstance(item.get("id"), str) and item["id"] in ids:
            changed = True
            out.extend(children if isinstance(children, list) else [])
            continue
        if kids_changed:
            item["children"] = children
        out.append(item)
    return out, changed


def _forget_notes(holder: Any, ids: set[str]) -> bool:
    if not isinstance(holder, dict):
        return False
    tree, changed = _without_items(holder.get("tree"), ids)
    if changed:
        holder["tree"] = tree
    for key in ("notes", "note_formats", "note_images", "note_modes"):
        mapping = holder.get(key)
        if isinstance(mapping, dict):
            for note_id in ids & mapping.keys():
                del mapping[note_id]
                changed = True
    favorites = holder.get("favorites")
    if isinstance(favorites, list) and ids.intersection(f for f in favorites if isinstance(f, str)):
        holder["favorites"] = [f for f in favorites if f not in ids]
        changed = True
    return changed


def clean_copy(copy: dict[str, Any], locked: dict[str, str], deleted: set[str]) -> bool:
    """Clean a parsed copy in place. True = it changed and must be rewritten."""
    trash = copy.get("trash")
    changed = _lock_notes(copy.get("notes"), locked)
    if isinstance(trash, dict):
        changed |= _lock_notes(trash.get("notes"), locked)
    if deleted:
        changed |= _forget_notes(copy, deleted)
        changed |= _forget_notes(trash, deleted)
    return changed


def _parse(raw: bytes) -> Optional[dict[str, Any]]:
    """The copy's data as written, without the repairs a live file gets."""
    try:
        data = json.loads(raw.decode("utf-8-sig"))
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


def _clean_json_file(path: Path, locked: dict[str, str], deleted: set[str]) -> None:
    stat = path.stat()
    data = _parse(path.read_bytes())
    if data is None or not clean_copy(data, locked, deleted):
        return
    storage._atomic_write_json(path, data)
    os.utime(path, ns=(stat.st_atime_ns, stat.st_mtime_ns))   # its age means something


def _clean_zip_file(path: Path, locked: dict[str, str], deleted: set[str]) -> None:
    stat = path.stat()
    tmp = path.with_name(path.name + ".part")
    try:
        with zipfile.ZipFile(path) as source:
            try:
                data = _parse(source.read("notes_data.json"))
            except KeyError:
                return
            if data is None or not clean_copy(data, locked, deleted):
                return
            with open(tmp, "wb") as raw, zipfile.ZipFile(raw, "w", zipfile.ZIP_DEFLATED) as target:
                for info in source.infolist():
                    if info.filename == "notes_data.json":
                        target.writestr(info.filename, json.dumps(data, ensure_ascii=False, indent=2))
                    else:
                        target.writestr(info, source.read(info))
                target.close()
                raw.flush()
                os.fsync(raw.fileno())
        os.replace(tmp, path)
        os.utime(path, ns=(stat.st_atime_ns, stat.st_mtime_ns))
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise


# ---------------------------------------------------------------------------
# One pass
# ---------------------------------------------------------------------------


def _copies() -> tuple[list[Path], list[Path]]:
    """The automatic copies right now: JSON files and zips."""
    backups = storage.backups_dir()
    json_files = sorted(backups.glob("notes_data-*.json"))
    json_files += sorted(storage.DATA_DIR.glob("notes_data.corrupt-*.json"))
    json_files += sorted(storage.DATA_DIR.glob("notes_data.pre-single-profile-*.json"))
    if storage.DATA_BAK.exists():
        json_files.append(storage.DATA_BAK)
    return json_files, sorted(backups.glob("pre-import-*.zip"))


def _plan(data: dict[str, Any]) -> tuple[dict[str, str], set[str]]:
    """(id -> envelope of every locked note, ids of notes deleted for good)."""
    trash = data.get("trash") or {}
    live = {**(trash.get("notes") or {}), **(data.get("notes") or {})}
    locked = {note_id: text for note_id, text in live.items() if is_encrypted_content(text)}
    known: set = set(live)
    for root in (data.get("tree") or [], trash.get("tree") or []):
        known.update(_tree_ids(root))
    # An id that is back (a backup was imported) is not deleted any more.
    return locked, {i for i in data.get("scrub_pending") or [] if isinstance(i, str)} - known


def _tree_ids(items: list) -> set[str]:
    ids: set[str] = set()
    for item in items:
        ids.add(item["id"])
        ids |= _tree_ids(item.get("children") or [])
    return ids


def _enforce_retention() -> None:
    now = time.time()
    corrupt = sorted(storage.DATA_DIR.glob("notes_data.corrupt-*.json"), reverse=True)
    too_old = list(storage.backups_dir().glob("pre-import-*.zip")) + corrupt
    for path in corrupt[CORRUPT_KEEP:] + [p for p in too_old if _age(p, now) > MAX_AGE]:
        try:
            path.unlink(missing_ok=True)
        except OSError as exc:
            log.warning("Could not remove old copy %s: errno %s", path.name, exc.errno)


def _age(path: Path, now: float) -> float:
    try:
        return now - path.stat().st_mtime
    except OSError:
        return 0.0


def sweep() -> bool:
    """One pass over all copies. False = some copy could not be handled."""
    with _pass_lock:
        data = storage.read_data()
        locked, deleted = _plan(data)
        json_files, zip_files = _copies()
        complete = True
        for path, clean in [(p, _clean_json_file) for p in json_files] + [(p, _clean_zip_file) for p in zip_files]:
            try:
                clean(path, locked, deleted)
            except FileNotFoundError:
                pass      # just rotated away
            except zipfile.BadZipFile:
                log.warning("Could not read the old copy %s", path.name)
            except Exception as exc:  # one bad copy must not stop the others
                log.warning("Could not clean the old copy %s: %s", path.name, type(exc).__name__)
                complete = False
        # No notes at all: an old copy may be the only way back to them.
        if data.get("notes") or (data.get("trash") or {}).get("notes"):
            _enforce_retention()
        if complete and data.get("scrub_pending"):
            _clear_pending(set(data["scrub_pending"]))
        return complete


def _clear_pending(handled: set) -> None:
    def _mut(current: dict) -> None:
        left = [i for i in current.get("scrub_pending") or [] if i not in handled]
        if left:
            current["scrub_pending"] = left
        else:
            current.pop("scrub_pending", None)

    storage.update_data(_mut)


# ---------------------------------------------------------------------------
# The background thread
# ---------------------------------------------------------------------------


def _schedule(delay: float) -> None:
    global _thread, _due
    if not BACKGROUND:
        return
    with _state_lock:
        due = time.monotonic() + delay
        _due = due if _due is None else min(_due, due)
        if _thread is None or not _thread.is_alive():
            _thread = threading.Thread(target=_work, name="noirpad-scrub", daemon=True)
            _thread.start()
    _wake.set()


def _work() -> None:
    global _due, _thread
    while True:
        with _state_lock:
            if _due is None:
                _thread = None   # under the lock: a new request starts a new thread
                return
            wait = _due - time.monotonic()
            if wait <= 0:
                _due = None
            else:
                _wake.clear()
        if wait > 0:
            _wake.wait(wait)
            continue
        try:
            sweep()
        except Exception:  # a failed cleanup must never reach the user's work
            log.exception("Cleaning the old copies failed")


def start() -> None:
    """The pass at every start: later, so the start never waits for it."""
    _schedule(STARTUP_DELAY)


def request_sweep() -> None:
    """A note was just locked or deleted for good: clean the copies now."""
    _schedule(0)


def stop(timeout: float = STOP_TIMEOUT) -> None:
    """Closing the app: drop a pass that has not started (the next start
    repeats it) and give a running one a moment. Never waits longer."""
    global _due
    with _state_lock:
        if _due is not None and _due > time.monotonic():
            _due = None
        thread = _thread
    _wake.set()
    if thread is not None:
        thread.join(timeout)
