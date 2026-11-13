"""N1.11: Store edition, Settings → Data → "Add notes from the installer version".

When the first-start copy was skipped because the Store edition already had
notes, noirpad/store_merge.py ADDS the installer (GitHub) edition's notes into
a new folder. Every test uses a temporary NOIRPAD_DATA_DIR (conftest) and a
temporary source folder (NOIRPAD_IMPORT_FROM), never real data.
"""

import hashlib
import io
import json
import zipfile
from pathlib import Path

import pytest

from conftest import make_png, new_folder, new_note

from noirpad import store_import, store_merge

FIXTURE_1_0_2 = Path(__file__).parent / "fixtures" / "backup-1.0.2.zip"
PASSWORD_1_0_2 = "fixture-password"
FOLDER = "Z verze z instalátoru"


def _source_from_fixture(src: Path) -> dict:
    """The installer edition's data folder, as 1.0.2 left it (fixture), plus
    automatic copies, a trashed note and settings that must not travel."""
    (src / "images").mkdir(parents=True)
    with zipfile.ZipFile(FIXTURE_1_0_2) as zf:
        data = json.loads(zf.read("notes_data.json"))
        for name in zf.namelist():
            if name.startswith("images/") and not name.endswith("/"):
                (src / name).write_bytes(zf.read(name))
    data["theme"] = "amber"
    data["language"] = "cs"
    (src / "notes_data.json").write_text(json.dumps(data), encoding="utf-8")
    (src / "backups").mkdir()
    (src / "backups" / "notes_data-20260101-000000-000000.json").write_text("{}", encoding="utf-8")
    (src / "notes_data.corrupt-20260101-000000.json").write_text("{broken", encoding="utf-8")
    return data


def _write_source(src: Path, data: dict, images: dict = None):
    (src / "images").mkdir(parents=True, exist_ok=True)
    for name, body in (images or {}).items():
        (src / "images" / name).write_bytes(body)
    (src / "notes_data.json").write_text(json.dumps(data), encoding="utf-8")


def _state(folder: Path) -> dict:
    """Every file below *folder* with the hash of its bytes."""
    return {str(p.relative_to(folder)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(folder.rglob("*")) if p.is_file()}


@pytest.fixture
def store(client, np_backend, tmp_path, monkeypatch):
    src = tmp_path / "installer"
    src.mkdir()
    monkeypatch.setenv("NOIRPAD_EDITION", "store")
    monkeypatch.setenv("NOIRPAD_IMPORT_FROM", str(src))
    monkeypatch.setattr(store_import, "_mutex_held", lambda name: False)
    return client, np_backend, src


def _add(client, folder=FOLDER):
    return client.post("/api/store/installer-notes", json={"folder": folder})


def _tree(client):
    return client.get("/api/data").json()["tree"]


def _folder(client, name=FOLDER):
    return next(i for i in _tree(client) if i["type"] == "folder" and i["name"] == name)


# ---- what is added, what is not ----------------------------------------------

def test_adds_the_notes_into_a_new_folder_and_changes_nothing_existing(store):
    client, backend, src = store
    _source_from_fixture(src)
    mine = new_note(client, "Mine", content="my own note")
    before = client.get(f"/api/note/{mine}").json()["content"]
    r = _add(client)
    assert r.status_code == 200, r.text
    assert r.json()["folder"] == FOLDER and r.json()["notes"] == 4
    folder = _folder(client)
    assert sorted(i["name"] for i in folder["children"]) == ["Locked legacy", "Locked v1", "Markdown", "Plain"]
    assert client.get(f"/api/note/{mine}").json()["content"] == before
    assert [i["name"] for i in _tree(client) if i["type"] == "note"] == ["Mine"]
    ids = {i["name"]: i["id"] for i in folder["children"]}
    plain = client.get(f"/api/note/{ids['Plain']}").json()["content"]
    image = plain.split("<<IMG:")[1].split(">>")[0]
    assert client.get(f"/images/{image}").status_code == 200
    assert client.get(f"/api/note/{ids['Markdown']}").json()["mode"] == "markdown"


def test_trash_settings_theme_and_automatic_copies_stay_behind(store):
    client, backend, src = store
    _source_from_fixture(src)
    new_note(client, "Mine", content="x")
    client.put("/api/settings", json={"theme": "ice"})
    theme, language = (client.get("/api/data").json()[k] for k in ("theme", "language"))
    assert _add(client).status_code == 200
    data = client.get("/api/data").json()
    assert (data["theme"], data["language"]) == (theme, language)
    assert client.get("/api/trash").json()["tree"] == []
    target = backend.storage.DATA_DIR
    assert not list(target.glob("*corrupt*"))
    assert not list((target / "backups").glob("notes_data-20260101-*"))


def test_the_source_folder_is_only_read(store):
    client, backend, src = store
    _source_from_fixture(src)
    new_note(client, "Mine", content="x")
    before = _state(src)
    assert _add(client).status_code == 200
    assert _state(src) == before


def test_locked_notes_from_1_0_x_open_and_save_after_adding(store):
    """1.0.2 envelopes (no "formats" field) and the legacy format: the right
    password opens them, a save re-encrypts, the next unlock still works."""
    client, backend, src = store
    _source_from_fixture(src)
    new_note(client, "Mine", content="x")
    assert _add(client).status_code == 200
    ids = {i["name"]: i["id"] for i in _folder(client)["children"]}
    for name, text in (("Locked v1", "Locked v1 from 1.0.2 ✓"), ("Locked legacy", "Legacy XOR note from 1.0.2 ✓")):
        assert client.post("/api/unlock", json={"id": ids[name], "password": "wrong-password"}).status_code == 400
        r = client.post("/api/unlock", json={"id": ids[name], "password": PASSWORD_1_0_2})
        assert r.status_code == 200, r.text
        assert r.json()["content"] == text
        saved = client.post("/api/save-encrypted", json={"id": ids[name], "unlock_token": r.json()["unlock_token"],
                                                         "content": text + " edited", "formats": []})
        assert saved.status_code == 200, saved.text
        client.post("/api/lock", json={"id": ids[name]})
        again = client.post("/api/unlock", json={"id": ids[name], "password": PASSWORD_1_0_2})
        assert again.json()["content"] == text + " edited"


def test_favorites_of_added_notes_travel_with_new_ids(store):
    client, backend, src = store
    _write_source(src, {"tree": [{"id": "n1", "name": "Fav", "type": "note"}],
                        "notes": {"n1": "favourite"}, "favorites": ["n1", "gone"]})
    new_note(client, "Mine", content="x")
    assert _add(client).status_code == 200
    fav_id = _folder(client)["children"][0]["id"]
    assert fav_id in client.get("/api/data").json()["favorites"]


# ---- collisions -------------------------------------------------------------

def test_taken_folder_name_gets_a_number_and_is_never_merged(store):
    client, backend, src = store
    _source_from_fixture(src)
    existing = new_folder(client, FOLDER)
    new_note(client, "Inside", parent_id=existing, content="x")
    new_folder(client, FOLDER + " 2")
    assert _add(client).json()["folder"] == FOLDER + " 3"
    assert [c["name"] for c in _folder(client)["children"]] == ["Inside"]
    assert len(_folder(client, FOLDER + " 3")["children"]) == 4


def test_same_ids_get_new_ids_and_the_same_image_is_reused(store):
    """After a manual backup import of the same data: every id is taken."""
    client, backend, src = store
    _source_from_fixture(src)
    r = client.post("/api/backup/import", files={"file": ("b.zip", FIXTURE_1_0_2.read_bytes(), "application/zip")})
    assert r.status_code == 200
    before = client.get("/api/data").json()
    old_ids = {i["id"] for i in before["tree"]}
    images_before = _state(backend.storage.DATA_DIR / "images")
    contents = {nid: client.get(f"/api/note/{nid}").json()["content"] for nid in old_ids}
    assert _add(client).status_code == 200
    added = {i["id"] for i in _folder(client)["children"]}
    assert added and not (added & old_ids)
    assert {nid: client.get(f"/api/note/{nid}").json()["content"] for nid in old_ids} == contents
    assert _state(backend.storage.DATA_DIR / "images") == images_before       # identical image reused


def test_same_image_name_with_other_bytes_gets_a_new_name(store):
    client, backend, src = store
    name = "11111111-1111-4111-8111-111111111111.png"
    _write_source(src, {"tree": [{"id": "n1", "name": "Pic", "type": "note"}],
                        "notes": {"n1": f"see <<IMG:{name}>> and ![x](/images/{name})"},
                        "note_images": {"n1": [name]}},
                  images={name: make_png(3, 3)})
    images = backend.storage.DATA_DIR / "images"
    images.mkdir(exist_ok=True)
    mine = make_png(2, 2)
    (images / name).write_bytes(mine)
    new_note(client, "Mine", content=f"<<IMG:{name}>>")
    assert _add(client).status_code == 200
    nid = _folder(client)["children"][0]["id"]
    content = client.get(f"/api/note/{nid}").json()["content"]
    assert name not in content
    new = content.split("<<IMG:")[1].split(">>")[0]
    assert content == f"see <<IMG:{new}>> and ![x](/images/{new})"
    assert (images / name).read_bytes() == mine                    # nothing existing overwritten
    assert (images / new).read_bytes() == make_png(3, 3)
    assert json.loads(backend.storage.DATA_FILE.read_text(encoding="utf-8"))["note_images"][nid] == [new]


def test_locked_note_needing_a_renamed_image_adds_nothing(store):
    client, backend, src = store
    name = "22222222-2222-4222-8222-222222222222.png"
    from noirpad.crypto import encrypt_content
    envelope = encrypt_content(f"secret <<IMG:{name}>>", "pw-1234")
    _write_source(src, {"tree": [{"id": "n1", "name": "Locked", "type": "note"}],
                        "notes": {"n1": envelope}, "note_images": {"n1": [name]}},
                  images={name: make_png(3, 3)})
    images = backend.storage.DATA_DIR / "images"
    images.mkdir(exist_ok=True)
    (images / name).write_bytes(make_png(2, 2))
    new_note(client, "Mine", content="x")
    before = _state(backend.storage.DATA_DIR)
    r = _add(client)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "installer_import_conflict"
    assert _state(backend.storage.DATA_DIR) == before


# ---- all or nothing ---------------------------------------------------------

def test_a_failed_data_write_leaves_everything_as_it_was(store, monkeypatch):
    client, backend, src = store
    _source_from_fixture(src)
    new_note(client, "Mine", content="x")
    before = _state(backend.storage.DATA_DIR)

    def boom(path, data):
        raise OSError(28, "No space left on device")
    monkeypatch.setattr(backend.storage, "_atomic_write_json", boom)
    r = _add(client)
    assert r.status_code == 507
    monkeypatch.undo()
    assert _state(backend.storage.DATA_DIR) == before          # no image, no safety copy, no marker
    assert not (backend.storage.DATA_DIR / store_import.IMPORT_MARKER).exists()


def test_a_failed_image_copy_leaves_everything_as_it_was(store, monkeypatch):
    client, backend, src = store
    names = [f"3333333{i}-3333-4333-8333-333333333333.png" for i in range(3)]
    _write_source(src, {"tree": [{"id": "n1", "name": "Pics", "type": "note"}],
                        "notes": {"n1": "".join(f"<<IMG:{n}>>" for n in names)},
                        "note_images": {"n1": names}},
                  images={n: make_png(2 + i, 2) for i, n in enumerate(names)})
    new_note(client, "Mine", content="x")
    before = _state(backend.storage.DATA_DIR)
    real, calls = store_merge.shutil.copy2, []

    def copy_then_fail(a, b):
        calls.append(b)
        if len(calls) == 2:
            raise OSError(28, "No space left on device")
        return real(a, b)
    monkeypatch.setattr(store_merge.shutil, "copy2", copy_then_fail)
    with pytest.raises(OSError):
        store_merge.add_installer_notes(FOLDER)
    monkeypatch.undo()
    assert _state(backend.storage.DATA_DIR) == before


def test_safety_copy_and_marker_after_success(store):
    client, backend, src = store
    _source_from_fixture(src)
    mine = new_note(client, "Mine", content="before adding")
    target = backend.storage.DATA_DIR
    assert client.get("/api/store/installer-notes").json() == {"available": True}
    assert _add(client).status_code == 200
    safety = sorted((target / "backups").glob("pre-import-*.zip"))
    assert len(safety) == 1
    with zipfile.ZipFile(io.BytesIO(safety[0].read_bytes())) as zf:
        assert json.loads(zf.read("notes_data.json"))["notes"][mine] == "before adding"
    marker = json.loads((target / store_import.IMPORT_MARKER).read_text(encoding="utf-8"))
    assert marker["mode"] == "added" and marker["folder"] == FOLDER and marker["notice_shown"] is True
    assert client.get("/api/store/installer-notes").json() == {"available": False}
    again = _add(client)
    assert again.status_code == 409 and again.json()["detail"]["code"] == "installer_import_done"


def test_refused_while_the_installer_edition_runs(store, monkeypatch):
    client, backend, src = store
    _source_from_fixture(src)
    new_note(client, "Mine", content="x")
    monkeypatch.setattr(store_import, "_mutex_held", lambda name: name == store_import.APP_MUTEX)
    before = _state(backend.storage.DATA_DIR)
    r = _add(client)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "installer_import_running"
    assert _state(backend.storage.DATA_DIR) == before


def test_only_in_the_store_edition(store, monkeypatch):
    client, backend, src = store
    _source_from_fixture(src)
    monkeypatch.setenv("NOIRPAD_EDITION", "github")
    assert client.get("/api/store/installer-notes").json() == {"available": False}
    assert _add(client).status_code == 404


def test_not_offered_without_notes_in_the_installer_edition(store):
    """Only trashed notes there: nothing to add, no button."""
    client, backend, src = store
    _write_source(src, {"tree": [], "notes": {},
                        "trash": {"tree": [{"id": "t", "name": "Old", "type": "note"}], "notes": {"t": "x"}}})
    assert client.get("/api/store/installer-notes").json() == {"available": False}
    assert _add(client).json()["detail"]["code"] == "installer_import_nothing"


# ---- notice b: the first-start copy was skipped ------------------------------

def _store_with_own_notes(tmp_path):
    target = tmp_path / "store"
    target.mkdir()
    (target / "notes_data.json").write_text(json.dumps(
        {"tree": [{"id": "m", "name": "Mine", "type": "note"}], "notes": {"m": "mine"}}), encoding="utf-8")
    return target


def test_skipped_notice_when_both_have_notes(monkeypatch, tmp_path):
    src = tmp_path / "installer"
    src.mkdir()
    _source_from_fixture(src)
    monkeypatch.setenv("NOIRPAD_EDITION", "store")
    monkeypatch.setenv("NOIRPAD_IMPORT_FROM", str(src))
    monkeypatch.setattr(store_import, "_mutex_held", lambda name: False)
    target = _store_with_own_notes(tmp_path)
    before = (target / "notes_data.json").read_bytes()
    assert store_import.maybe_import(target) == {"code": "github_import_skipped", "params": {}}
    assert (target / "notes_data.json").read_bytes() == before
    store_import.mark_skipped_shown(target)
    assert store_import.maybe_import(target) is None                  # once


def test_no_skipped_notice_without_notes_in_the_installer_edition(monkeypatch, tmp_path):
    src = tmp_path / "installer"
    _write_source(src, {"tree": [], "notes": {},
                        "trash": {"tree": [{"id": "t", "name": "Old", "type": "note"}], "notes": {"t": "x"}}})
    monkeypatch.setenv("NOIRPAD_EDITION", "store")
    monkeypatch.setenv("NOIRPAD_IMPORT_FROM", str(src))
    monkeypatch.setattr(store_import, "_mutex_held", lambda name: False)
    target = _store_with_own_notes(tmp_path)
    assert store_import.maybe_import(target) is None
    # The same folders once the installer edition has a live note: now it says so.
    _write_source(src, {"tree": [{"id": "n", "name": "Live", "type": "note"}], "notes": {"n": "x"}})
    assert store_import.maybe_import(target) == {"code": "github_import_skipped", "params": {}}


def test_dismissing_the_skipped_notice_marks_it_shown(store):
    from noirpad.runtime import RUNTIME
    client, backend, src = store
    RUNTIME.data_notice = {"code": "github_import_skipped", "params": {}}
    client.post("/api/session/dismiss-notice")
    assert (backend.storage.DATA_DIR / store_import.SKIP_MARKER).exists()
    assert not (backend.storage.DATA_DIR / store_import.IMPORT_MARKER).exists()   # the button stays


def test_desktop_shows_the_skipped_notice():
    src = (Path(__file__).resolve().parent.parent / "desktop.py").read_text(encoding="utf-8")
    assert "early = (store_import.NOTICE_BLOCKED, store_import.NOTICE_SKIPPED)" in src
