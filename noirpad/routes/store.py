"""Store edition: add the installer edition's notes (Settings → Data, N1.11)."""

from fastapi import APIRouter
from pydantic import BaseModel

from .. import storage, store_import, store_merge
from ..models import Name

router = APIRouter()


class AddInstallerNotesReq(BaseModel):
    folder: Name            # the folder's name in the UI language ("From installer version")


@router.get("/api/store/installer-notes")
def installer_notes_status():
    """Whether Settings → Data offers "Add notes from the installer version"."""
    return {"available": store_import.installer_notes_available(storage.DATA_DIR)}


@router.post("/api/store/installer-notes")
def add_installer_notes(req: AddInstallerNotesReq):
    return store_merge.add_installer_notes(req.folder)
