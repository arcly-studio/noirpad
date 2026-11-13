"""Store edition: ADD the installer (GitHub) edition's notes to the notes
already here (Settings → Data, N1.11).

The automatic copy at the first start (store_import.maybe_import) never
writes over notes the Store edition already has. When it was skipped for
that reason, this adds the installer edition's notes into a new top-level
folder instead. Nothing existing is changed or merged:

- the new folder gets a free name ("… 2", "… 3" when the name is taken);
- a note or folder id that exists here gets a new id (also in the per-note
  maps and favorites);
- an image name that exists here with other bytes gets a new name, and the
  references in the added notes are rewritten. An identical file is reused.
  A locked note's text cannot be rewritten without its password: if one of
  its images would need a new name, nothing is added (409);
- not copied: trash, settings, theme, backups/ and corrupt-* files.

All or nothing: a safety copy (backups/pre-import-*.zip, like an imported
backup) first, then the new images (never over an existing file), then one
atomic write of notes_data.json. If that write fails, the new images and the
safety copy are removed again and the data file is as it was. The marker
(store_import.IMPORT_MARKER) is written only after the data file.

The source folder is only read. Not while the installer edition runs.
"""

import copy
import json
import logging
import os
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import config, edition, storage, store_import
from .crypto import is_encrypted_content
from .errors import ApiError
from .images import IMAGE_NAME_RE, extract_image_names, image_ext_ok
from .tree import collect_all_ids, collect_note_ids, strip_user_ids

log = logging.getLogger("noirpad.store_merge")

NOTE_MAPS = ("notes", "note_formats", "note_modes", "note_images")


def _check_available(target: Path) -> Path:
    if edition.edition() != edition.STORE:
        raise ApiError(404, "not_store_edition")
    if (target / store_import.IMPORT_MARKER).exists():
        raise ApiError(409, "installer_import_done")
    src = store_import.source_dir()
    if src is None or not (src / store_import.DATA_NAME).is_file() or src.resolve() == target.resolve():
        raise ApiError(404, "installer_import_nothing")
    if store_import.github_running(src):
        raise ApiError(409, "installer_import_running")
    return src


def _read_source(src: Path) -> dict:
    from .routes.backup import validate_backup_data
    try:
        data = json.loads((src / store_import.DATA_NAME).read_text(encoding="utf-8-sig"))
        validate_backup_data(data)
    except (OSError, ValueError, ApiError):
        raise ApiError(400, "installer_import_unreadable")
    return data


def _taken_names(current: dict) -> set:
    from .images import referenced_images
    names = set(referenced_images(current))
    for folder in (storage.IMAGES_DIR, storage.IMAGES_DIR / ".trash"):
        if folder.is_dir():
            names.update(p.name for p in folder.iterdir())
    return names


def _source_images(src_data: dict, note_ids: list) -> set:
    names = set()
    for nid in note_ids:
        names.update(n for n in (src_data.get("note_images") or {}).get(nid) or [] if IMAGE_NAME_RE.match(n))
        content = (src_data.get("notes") or {}).get(nid)
        if isinstance(content, str) and not is_encrypted_content(content):
            names.update(extract_image_names(content))
    return names


def _plan_images(src: Path, names: set, taken: set) -> tuple[dict, list]:
    """-> (renames {old: new}, copies [(source path, target name)])."""
    renames, copies = {}, []
    for name in sorted(names):
        path = src / store_import.IMAGES / name
        if not path.is_file() or path.stat().st_size > config.MAX_IMAGE_BYTES:
            continue                                   # dangling or not ours: left as it is
        head = path.read_bytes()[:16]
        if not image_ext_ok(name, head):
            continue
        if name not in taken:
            copies.append((path, name))
            continue
        existing = storage.IMAGES_DIR / name
        if existing.is_file() and existing.read_bytes() == path.read_bytes():
            continue                                   # the same image is already here
        new = f"{uuid.uuid4()}{Path(name).suffix}"
        renames[name] = new
        copies.append((path, new))
    return renames, copies


def _rewrite(value: Any, renames: dict) -> Any:
    """Image names inside a note's text or formats (uuid names: plain replace)."""
    if not renames:
        return value
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    for old, new in renames.items():
        text = text.replace(old, new)
    return text if isinstance(value, str) else json.loads(text)


def _remap_tree(items: list, mapping: dict, used: set) -> list:
    out = []
    for item in items:
        item = dict(item)
        old = item["id"]
        new = old if old not in used else str(uuid.uuid4())
        while new in used:
            new = str(uuid.uuid4())
        used.add(new)
        mapping[old] = new
        item["id"] = new
        if item.get("type") == "folder":
            item["children"] = _remap_tree(item.get("children") or [], mapping, used)
        out.append(item)
    return out


def _free_name(tree: list, base: str) -> str:
    names = {i.get("name") for i in tree if i.get("type") == "folder"}
    if base not in names:
        return base
    n = 2
    while f"{base} {n}" in names:
        n += 1
    return f"{base} {n}"


def _write_images(copies: list) -> list:
    written = []
    try:
        storage.IMAGES_DIR.mkdir(parents=True, exist_ok=True)
        for path, name in copies:
            dest = storage.IMAGES_DIR / name
            if dest.exists():
                raise ApiError(409, "installer_import_conflict")     # appeared meanwhile
            tmp = dest.with_name(dest.name + ".part")
            shutil.copy2(path, tmp)                                    # keeps the file time
            os.replace(tmp, dest)
            written.append(dest)
    except BaseException:
        _remove(written)
        raise
    return written


def _remove(paths) -> None:
    for path in paths:
        for p in (path, path.with_name(path.name + ".part")):
            try:
                p.unlink()
            except OSError:
                pass


def add_installer_notes(folder_name: str) -> dict:
    target = storage.DATA_DIR
    src = _check_available(target)
    src_data = _read_source(src)

    src_tree = strip_user_ids(copy.deepcopy(src_data.get("tree") or []))
    note_ids = [nid for item in src_tree for nid in collect_note_ids(item)
                if nid in (src_data.get("notes") or {})]
    if not note_ids:
        raise ApiError(404, "installer_import_nothing")

    with storage.file_lock:
        current = storage.read_data_unlocked()
    renames, copies = _plan_images(src, _source_images(src_data, note_ids), _taken_names(current))
    for nid in note_ids:
        content = src_data["notes"][nid]
        if is_encrypted_content(content):
            listed = set((src_data.get("note_images") or {}).get(nid) or [])
            if listed & set(renames):
                raise ApiError(409, "installer_import_conflict")

    def _mut(data: dict) -> dict:
        used = set(data.get("notes") or {}) | set((data.get("trash") or {}).get("notes") or {})
        for root in (data.get("tree") or []) + ((data.get("trash") or {}).get("tree") or []):
            used.update(collect_all_ids(root))
        mapping: dict = {}
        children = _remap_tree(src_tree, mapping, used)
        folder_id = str(uuid.uuid4())
        while folder_id in used:
            folder_id = str(uuid.uuid4())
        name = _free_name(data.get("tree") or [], folder_name)
        data.setdefault("tree", []).append({"id": folder_id, "name": name, "type": "folder",
                                            "children": children})
        for key in NOTE_MAPS:
            src_map = src_data.get(key) or {}
            dst_map = data.setdefault(key, {})
            for nid in note_ids:
                if nid not in src_map:
                    continue
                value = copy.deepcopy(src_map[nid])
                if key == "note_images":
                    value = [renames.get(n, n) for n in value if isinstance(n, str) and IMAGE_NAME_RE.match(n)]
                elif key in ("notes", "note_formats") and not is_encrypted_content(src_data["notes"][nid]):
                    value = _rewrite(value, renames)
                dst_map[mapping[nid]] = value
        favorites = data.setdefault("favorites", [])
        for nid in dict.fromkeys(src_data.get("favorites") or []):
            if nid in note_ids and mapping[nid] not in favorites:
                favorites.append(mapping[nid])
        return {"folder": name, "folder_id": folder_id, "notes": len(note_ids)}

    # Safety copy of the current state, as before importing a backup.
    from .routes.backup import build_backup_zip
    with storage.file_lock:
        bdir = storage.backups_dir()
        bdir.mkdir(exist_ok=True)
        safety = bdir / f"pre-import-{storage.stamp()}.zip"
        safety.write_bytes(build_backup_zip(storage.read_data_unlocked()))

    try:
        written = _write_images(copies)
    except BaseException:
        _remove([safety])
        raise
    try:
        result = storage.update_data(_mut)
    except BaseException:
        _remove(written)
        _remove([safety])          # the data file is unchanged: nothing to keep a copy of
        raise
    storage.rotate("pre-import-*.zip", storage.BACKUP_KEEP)

    marker = target / store_import.IMPORT_MARKER
    tmp = marker.with_name(marker.name + ".tmp")
    tmp.write_text(json.dumps({
        "imported_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "mode": "added",
        "folder": result["folder"],
        "notes": result["notes"],
        "images": len(written),
        "notice_shown": True,
    }, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(tmp, marker)
    log.info("Added %d notes and %d images from the installer edition", result["notes"], len(written))
    return {"ok": True, **result, "images": len(written)}
