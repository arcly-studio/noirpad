"""Keeps locked and permanently deleted notes out of the automatic copies (N1).

The copies are the snapshots, the pre-import zips, the set-aside damaged data
files and the leftovers of old versions. One idempotent pass goes through them:
a note that was locked gets its envelope instead of readable text and loses its
readable formats (N2), a note deleted for good is removed. Their ids wait in
the private data keys `scrub_locked` and `scrub_pending` until every copy has
been handled, so a failed or interrupted pass is repeated at the next start.

Only those events change a copy, never the mere fact that a note is locked now:
an imported backup can hold an older lock than the copies, whose text is the
newer one. For the same reason a copy written after the current envelope is
skipped and left to rotation and the limits. Notes have no time of their own;
the time of the copy's file is compared with the time in the envelope's token.

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
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

from . import storage
from .crypto import envelope_time, envelope_version, is_encrypted_content

log = logging.getLogger("noirpad")

STARTUP_DELAY = 5.0            # seconds after the server start
STOP_TIMEOUT = 2.0             # closing the app waits at most this long
MAX_AGE = 30 * 24 * 60 * 60    # for pre-import zips and damaged data files
CORRUPT_KEEP = 3
RETRY_DELAY = 60.0
MAX_RETRIES = 3                # per session
# The snapshot of a locking write is made just after its envelope, and a
# Fernet time has whole seconds: a copy that close is still from before it.
COPY_TIME_MARGIN = 10.0

# Tests turn the thread off and call sweep() themselves.
BACKGROUND = True

# One pass at a time: two would overwrite each other's changes in a copy.
_pass_lock = threading.Lock()

_state_lock = threading.Lock()
_wake = threading.Event()
_thread: Optional[threading.Thread] = None
_due: Optional[float] = None
_retries = 0


# ---------------------------------------------------------------------------
# One copy
# ---------------------------------------------------------------------------


def mark_locked(data: dict[str, Any], note_id: str) -> None:
    """Inside the write that locks a note or re-encrypts it after a verified
    password: its automatic copies are now to be cleaned. Nothing else asks
    for that. An imported envelope may be older than the copies, and a legacy
    text saved without proof may be a wrong password's output."""
    data["scrub_locked"] = sorted(set(data.get("scrub_locked") or []) | {note_id})


@dataclass(frozen=True)
class _Plan:
    locked: dict[str, str]    # id -> current envelope of the notes to clean in the copies
    weak: set[str]            # of those, the ones whose legacy copies go too
    sealed: set[str]          # of those, the ones whose readable formats go too
    deleted: set[str]         # ids of notes deleted for good
    events: set[str]          # what `scrub_locked` held when the plan was made
    first: bool               # the one pass over all locked notes


def _copy_is_older(note_id: str, plan: _Plan, copy_time: float) -> bool:
    """May this copy be cleaned of this note? Not when it was written after the
    current envelope: its readable text is then the newer one (a backup with an
    older lock was imported). A legacy envelope has no time: the copy stays."""
    written = envelope_time(plan.locked[note_id])
    return written is not None and copy_time <= written + COPY_TIME_MARGIN


def _exposes(value: Any, note_id: str, plan: _Plan) -> bool:
    """Does this version of a locked note say more than the current envelope?
    Readable text does; so does the weak legacy format once a verified password
    upgraded the note."""
    if not is_encrypted_content(value):
        return True
    return (note_id in plan.weak and envelope_version(value) == 2
            and envelope_version(plan.locked[note_id]) != 2)


def _lock_notes(notes: Any, plan: _Plan, ids: set[str]) -> bool:
    if not isinstance(notes, dict):
        return False
    changed = False
    for note_id in ids & notes.keys():
        if _exposes(notes[note_id], note_id, plan):
            notes[note_id] = plan.locked[note_id]
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


def _forget_formats(holder: Any, ids: set[str]) -> bool:
    mapping = holder.get("note_formats") if isinstance(holder, dict) else None
    if not isinstance(mapping, dict) or not ids & mapping.keys():
        return False
    for note_id in ids & mapping.keys():
        del mapping[note_id]
    return True


def clean_copy(copy: dict[str, Any], plan: _Plan, copy_time: float) -> bool:
    """Clean a parsed copy in place. True = it changed and must be rewritten."""
    trash = copy.get("trash")
    ids = {note_id for note_id in plan.locked if _copy_is_older(note_id, plan, copy_time)}
    changed = _lock_notes(copy.get("notes"), plan, ids)
    if isinstance(trash, dict):
        changed |= _lock_notes(trash.get("notes"), plan, ids)
    changed |= _forget_formats(copy, plan.sealed & ids)
    changed |= _forget_formats(trash, plan.sealed & ids)
    if plan.deleted:
        changed |= _forget_notes(copy, plan.deleted)
        changed |= _forget_notes(trash, plan.deleted)
    return changed


def _parse(raw: bytes) -> Optional[dict[str, Any]]:
    """The copy's data as written, without the repairs a live file gets."""
    try:
        data = json.loads(raw.decode("utf-8-sig"))
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


def _clean_json_file(path: Path, plan: _Plan) -> None:
    stat = path.stat()
    data = _parse(path.read_bytes())
    if data is None or not clean_copy(data, plan, stat.st_mtime):
        return
    storage._atomic_write_json(path, data)
    os.utime(path, ns=(stat.st_atime_ns, stat.st_mtime_ns))   # its age means something


def _clean_zip_file(path: Path, plan: _Plan) -> None:
    stat = path.stat()
    tmp = path.with_name(path.name + ".part")
    try:
        with zipfile.ZipFile(path) as source:
            try:
                data = _parse(source.read("notes_data.json"))
            except KeyError:
                return
            if data is None or not clean_copy(data, plan, stat.st_mtime):
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


def _live_notes(data: dict[str, Any]) -> dict[str, Any]:
    return {**((data.get("trash") or {}).get("notes") or {}), **(data.get("notes") or {})}


def _plan(data: dict[str, Any]) -> _Plan:
    """What this pass does: the notes `mark_locked` named, and once, for copies
    an older version left behind, every locked note (readable text only). A
    note whose formats are still readable in the current data keeps them in the
    copies too: it has not been unlocked yet."""
    trash = data.get("trash") or {}
    live = _live_notes(data)
    locked = {note_id: text for note_id, text in live.items() if is_encrypted_content(text)}
    events = {i for i in data.get("scrub_locked") or [] if isinstance(i, str)}
    first = not data.get("scrub_first_pass_done")
    if not first:
        locked = {note_id: text for note_id, text in locked.items() if note_id in events}
    readable = {**(trash.get("note_formats") or {}), **(data.get("note_formats") or {})}
    sealed = {note_id for note_id in locked if not readable.get(note_id)}
    known: set = set(live)
    for root in (data.get("tree") or [], trash.get("tree") or []):
        known.update(_tree_ids(root))
    # An id that is back (a backup was imported) is not deleted any more.
    deleted = {i for i in data.get("scrub_pending") or [] if isinstance(i, str)} - known
    return _Plan(locked=locked, weak=events & locked.keys(), sealed=sealed, deleted=deleted,
                 events=events, first=first)


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
        plan = _plan(data)
        json_files, zip_files = _copies()
        complete = True
        for path, clean in [(p, _clean_json_file) for p in json_files] + [(p, _clean_zip_file) for p in zip_files]:
            try:
                clean(path, plan)
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
        if complete and (data.get("scrub_pending") or plan.events or plan.first):
            _record_done(set(data.get("scrub_pending") or []), plan)
        return complete


def _record_done(handled: set, plan: _Plan) -> None:
    def _store(current: dict, key: str, left: list) -> None:
        if left:
            current[key] = left
        else:
            current.pop(key, None)

    def _mut(current: dict) -> None:
        _store(current, "scrub_pending",
               [i for i in current.get("scrub_pending") or [] if i not in handled])
        # A note locked anew during the pass stays named for the next one.
        live = _live_notes(current)
        _store(current, "scrub_locked",
               [i for i in current.get("scrub_locked") or []
                if i not in plan.events or (i in plan.locked and live.get(i) != plan.locked[i])])
        current["scrub_first_pass_done"] = True

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
            finished = sweep() is not False
        except Exception:  # a failed cleanup must never reach the user's work
            log.exception("Cleaning the old copies failed")
            finished = False
        if not finished:
            _retry()


def _retry() -> None:
    """A copy could not be handled (held open by a virus scanner?): try again
    soon, a few times per session. The next start repeats it anyway."""
    global _retries
    if _retries < MAX_RETRIES:
        _retries += 1
        _schedule(RETRY_DELAY)


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
