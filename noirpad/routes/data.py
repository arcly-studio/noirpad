"""Whole-profile reads: data (with ETag) and disk usage."""

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse

from .. import storage
from ..crypto import is_encrypted_content

router = APIRouter()


def _without_locked_formats(holder: dict) -> dict:
    """N2: readable formats an older version left beside a locked note stay
    in the file until its next unlock, but do not go out without a password."""
    notes = holder.get("notes") or {}
    formats = holder.get("note_formats") or {}
    return {**holder, "note_formats": {note_id: value for note_id, value in formats.items()
                                       if not is_encrypted_content(notes.get(note_id, ""))}}


@router.get("/api/data")
def get_data(request: Request):
    """The whole profile. Polling clients send If-None-Match → 304 (D13)."""
    known = request.headers.get("if-none-match")
    if known and known == storage.data_etag():
        return Response(status_code=304, headers={"ETag": known})
    data, etag = storage.read_data_with_etag()
    view = _without_locked_formats(storage.public_view(data))
    view["trash"] = _without_locked_formats(view.get("trash") or {})
    return JSONResponse(view, headers={"ETag": etag})


def _folder_size(folder) -> int:
    size = 0
    if folder.exists():
        for f in folder.rglob("*"):
            if f.is_file():
                try:
                    size += f.stat().st_size
                except OSError:
                    pass
    return size


@router.get("/api/storage")
def get_storage():
    """On-disk size of notes_data.json, the images and the automatic
    backups (R11: snapshots and pre-import zips count too)."""
    notes_size = storage.DATA_FILE.stat().st_size if storage.DATA_FILE.exists() else 0
    images_size = _folder_size(storage.IMAGES_DIR)
    backups_size = _folder_size(storage.backups_dir())
    return {
        "notes_size": notes_size,
        "images_size": images_size,
        "backups_size": backups_size,
        "total_size": notes_size + images_size + backups_size,
    }
