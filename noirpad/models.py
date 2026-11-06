"""Pydantic request bodies."""

from typing import Annotated, Any, Literal, Optional

from pydantic import BaseModel, Field, StringConstraints

from .config import MAX_FORMATS, MAX_NAME_LEN, MAX_NOTE_CHARS, MAX_TAG_LEN, MAX_TAGS
from .crypto import MAX_NOTE_PASSWORD

# Trimmed; never empty (C6). The UI checks too, this is the backstop.
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_NAME_LEN)]
NoteText = Annotated[str, Field(max_length=MAX_NOTE_CHARS)]
Formats = Annotated[list[Any], Field(max_length=MAX_FORMATS)]
NotePassword = Annotated[str, Field(max_length=MAX_NOTE_PASSWORD)]


class NewItemReq(BaseModel):
    parent_id: Optional[str] = None
    name: Name


class RenameReq(BaseModel):
    id: str
    name: Name


class MoveReq(BaseModel):
    id: str
    target_id: str
    position: Literal["before", "after", "inside"]


class IdReq(BaseModel):
    id: str


class SavedFileReq(BaseModel):
    token: str = Field(max_length=100)


class NoteBody(BaseModel):
    content: NoteText
    formats: Formats = []
    # Optional per-note rendering mode. None means "leave unchanged"; pass
    # "rich-text" to clear back to default, "markdown" to opt in.
    mode: Optional[str] = None
    # R6: the rev (GET /api/note) this text was written on; a different
    # stored rev = changed elsewhere meanwhile -> 409. None = overwrite.
    base_rev: Optional[str] = Field(default=None, max_length=64)


class TagsBody(BaseModel):
    tags: Annotated[list[Annotated[str, Field(max_length=MAX_TAG_LEN)]],
                    Field(max_length=MAX_TAGS)]


MAX_RECENT_NOTES = 10


class RecentNote(BaseModel):
    id: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    at: Annotated[int, Field(ge=0, le=10**13)]   # when it was last opened, ms since the epoch


class SettingsBody(BaseModel):
    theme: Optional[str] = None
    ui_font: Optional[str] = None
    font_family: Optional[str] = None
    font_size: Optional[int] = None
    autosave: Optional[bool] = None
    page_orientation: Optional[str] = None
    glow_enabled: Optional[bool] = None
    matrix_rain_enabled: Optional[bool] = None
    crt_enabled: Optional[bool] = None
    show_splash: Optional[bool] = None
    autosave_interval: Optional[int] = None
    spellcheck: Optional[bool] = None
    glitch_effect: Optional[bool] = None
    confirm_delete: Optional[bool] = None
    idle_lock_minutes: Optional[str] = None
    default_encrypted: Optional[bool] = None
    glow_intensity: Optional[int] = None
    custom_shortcuts: Optional[dict] = None
    language: Optional[Literal["auto", "en", "cs"]] = None
    md_split: Optional[bool] = None            # Markdown: preview next to the source
    ui_zoom: Optional[Annotated[int, Field(ge=70, le=200)]] = None   # desktop window, percent
    # Start page "Recent": newest first, at most MAX_RECENT_NOTES.
    recent_notes: Optional[Annotated[list[RecentNote], Field(max_length=MAX_RECENT_NOTES)]] = None


class PasswordReq(BaseModel):
    id: str
    password: NotePassword


class DecryptReq(BaseModel):
    id: str
    unlock_token: Optional[str] = None
    password: Optional[NotePassword] = None


class LockReq(BaseModel):
    unlock_token: str


class SaveEncryptedReq(BaseModel):
    id: str
    unlock_token: str
    content: NoteText
    formats: Formats = []
    lock_after: bool = False   # leaving the page: save, then forget the key
    mode: Optional[str] = None # like NoteBody.mode (Ctrl+M on an unlocked note)


class AppLockReq(BaseModel):
    password: Annotated[str, Field(max_length=1024)]
    current_password: Optional[Annotated[str, Field(max_length=1024)]] = None


class LoginReq(BaseModel):
    password: str
    remember: bool = True
