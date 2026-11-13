"""Store edition: bring over the GitHub edition's notes once (ROADMAP N1.9).

On a Store start with an empty data folder, the notes of the GitHub edition
(%LOCALAPPDATA%\\NoirPad) are COPIED, never moved: the source stays as it
is, nothing is written into it (inside MSIX a write there would land in the
package's private copy anyway). Copies keep their file times (copy2).

What is copied: notes_data.json and images/. The automatic copies
(backups/, corrupt-* files) are never copied (the user's decision, variant A
of ROADMAP N1.9 "Kopie při importu"): readable copies of locked notes stay
in the GitHub edition's folder and are not multiplied.

Not while the GitHub edition runs: its installer mutex or its data lock
tells. Then nothing is copied and the UI asks to close it and start again.

After a successful import the UI shows once (toast, EN/CS) that the GitHub
edition can be uninstalled in Windows Settings → Apps. NoirPad never
uninstalls anything itself.

The marker IMPORT_MARKER in the Store data folder records the import; with
it (or with notes already there) nothing is imported again.

Tests and the smoke test set NOIRPAD_DATA_DIR: then the source is only
NOIRPAD_IMPORT_FROM, never the user's real GitHub data.
"""

import json
import logging
import os
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from . import edition

log = logging.getLogger("noirpad.store_import")

IMPORT_MARKER = "imported-from-github.json"
DATA_NAME = "notes_data.json"
IMAGES = "images"
APP_MUTEX = "NoirPad-B6F2E7C0-AppMutex"     # desktop.py / installer.iss (GitHub edition)

NOTICE_DONE = "github_imported"
NOTICE_BLOCKED = "github_import_blocked"


def source_dir() -> Optional[Path]:
    """Where to import from; None when there is nothing safe to read."""
    explicit = os.environ.get("NOIRPAD_IMPORT_FROM")
    if explicit:
        return Path(explicit)
    if os.environ.get("NOIRPAD_DATA_DIR"):
        return None                 # tests / portable: never the user's real data
    return edition.github_data_dir()


def _mutex_held(name: str) -> bool:
    if sys.platform != "win32":
        return False
    import ctypes
    SYNCHRONIZE = 0x00100000
    handle = ctypes.windll.kernel32.OpenMutexW(SYNCHRONIZE, False, name)
    if handle:
        ctypes.windll.kernel32.CloseHandle(handle)
        return True
    return False


def _data_lock_held(src: Path) -> bool:
    """The GitHub edition (desktop or web) holds a byte lock on noirpad.lock.

    Read-only handle: nothing is created or changed in the source folder."""
    lock = src / "noirpad.lock"
    if not lock.is_file():
        return False
    try:
        with open(lock, "rb") as handle:
            if os.name == "nt":
                import msvcrt
                try:
                    msvcrt.locking(handle.fileno(), msvcrt.LK_NBRLCK, 1)
                except OSError:
                    return True
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                try:
                    fcntl.flock(handle.fileno(), fcntl.LOCK_SH | fcntl.LOCK_NB)
                except OSError:
                    return True
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
    except OSError:
        return False
    return False


def github_running(src: Path) -> bool:
    return _mutex_held(APP_MUTEX) or _data_lock_held(src)


def _copy_file(src: Path, dst: Path) -> None:
    """copy2 (keeps the file times) through a temporary name."""
    tmp = dst.with_name(dst.name + ".import-tmp")
    shutil.copy2(src, tmp)
    os.replace(tmp, dst)


def _replaceable(data_file: Path) -> bool:
    """True when the Store data file is missing or holds nothing of the user's.

    A start while the GitHub edition runs postpones the import, but that
    session already writes its own notes_data.json (settings, a theme). As
    long as it has no note, folder or trashed note, the import still runs on
    the next start, as the notice promised. Anything else, or a file that
    cannot be read, is never replaced."""
    if not data_file.exists():
        return True
    try:
        data = json.loads(data_file.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        return False
    if not isinstance(data, dict):
        return False
    trash = data.get("trash", {})
    return (data.get("notes") == {} and data.get("tree", []) == []
            and isinstance(trash, dict) and not trash.get("notes") and not trash.get("tree"))


def maybe_import(target: Path) -> Optional[dict]:
    """Run under the Store data lock, before the backend touches *target*.

    Returns a data notice ({"code", "params"}) or None."""
    if edition.edition() != edition.STORE:
        return None
    target = Path(target)
    if (target / IMPORT_MARKER).exists() or not _replaceable(target / DATA_NAME):
        return None
    src = source_dir()
    if src is None or not (src / DATA_NAME).is_file():
        return None
    if src.resolve() == target.resolve():
        return None
    if github_running(src):
        log.info("GitHub edition is running; import postponed")
        return {"code": NOTICE_BLOCKED, "params": {}}

    target.mkdir(parents=True, exist_ok=True)
    images = 0
    src_images = src / IMAGES
    if src_images.is_dir():
        (target / IMAGES).mkdir(exist_ok=True)
        for item in sorted(src_images.iterdir()):
            if item.is_file():
                _copy_file(item, target / IMAGES / item.name)
                images += 1
    # Notes last: until they are there, the next start tries again.
    _copy_file(src / DATA_NAME, target / DATA_NAME)
    (target / IMPORT_MARKER).write_text(json.dumps({
        "imported_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "images": images,
        "notice_shown": False,
    }, indent=2) + "\n", encoding="utf-8")
    log.info("Imported the GitHub edition's notes (%d images)", images)
    return {"code": NOTICE_DONE, "params": {}}


def pending_notice(target: Path) -> Optional[dict]:
    """The import notice until the user has seen it once."""
    try:
        marker = json.loads((Path(target) / IMPORT_MARKER).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if marker.get("notice_shown"):
        return None
    return {"code": NOTICE_DONE, "params": {}}


def mark_notice_shown(target: Path) -> None:
    path = Path(target) / IMPORT_MARKER
    try:
        marker = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return
    marker["notice_shown"] = True
    path.write_text(json.dumps(marker, indent=2) + "\n", encoding="utf-8")
