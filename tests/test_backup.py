"""Backup download + import, including the D15 / K5 import hardening."""

import io
import json
import zipfile
from pathlib import Path

import pytest

from conftest import make_png, make_zip, new_folder, new_note, pending


def upload_png(client):
    r = client.post("/api/images/upload", files={"file": ("a.png", make_png(), "image/png")})
    return r.json()["filename"]


def download(client):
    r = client.get("/api/backup")
    assert r.status_code == 200
    return r.content


def import_zip(client, data):
    return client.post("/api/backup/import",
                       files={"file": ("backup.zip", data, "application/zip")})


def backup_with(tree, notes, images=None):
    files = {"notes_data.json": json.dumps({"tree": tree, "notes": notes})}
    for name, data in (images or {}).items():
        files["images/" + name] = data
    return make_zip(files)


FIXTURE_1_0_2 = Path(__file__).parent / "fixtures" / "backup-1.0.2.zip"
PASSWORD_1_0_2 = "fixture-password"


def _ids_by_name(tree):
    return {item["name"]: item["id"] for item in tree}


def test_backup_from_1_0_2_restores_completely(client, np_backend):
    """Written by the code of the 1.0.2 release. Never regenerate this file:
    it proves that a backup from an older release can still be restored."""
    assert import_zip(client, FIXTURE_1_0_2.read_bytes()).status_code == 200
    data = client.get("/api/data").json()
    ids = _ids_by_name(data["tree"])
    assert set(ids) == {"Plain", "Markdown", "Locked v1", "Locked legacy"}

    plain = client.get(f"/api/note/{ids['Plain']}").json()["content"]
    assert plain.startswith("Plain note 1.0.2 <<IMG:")
    image = plain.split("<<IMG:")[1].split(">>")[0]
    assert client.get(f"/images/{image}").status_code == 200
    assert client.get(f"/api/note/{ids['Markdown']}").json()["mode"] == "markdown"
    assert [i["name"] for i in client.get("/api/trash").json()["tree"]] == ["In trash"]

    for name, text in (("Locked v1", "Locked v1 from 1.0.2 ✓"),
                       ("Locked legacy", "Legacy XOR note from 1.0.2 ✓")):
        r = client.post("/api/unlock", json={"id": ids[name], "password": PASSWORD_1_0_2})
        assert r.status_code == 200, r.text
        assert r.json()["content"] == text
        assert client.post("/api/unlock", json={"id": ids[name],
                                                "password": "wrong-password"}).status_code == 400


def test_backup_from_1_0_2_survives_another_roundtrip(client, np_backend):
    import_zip(client, FIXTURE_1_0_2.read_bytes())
    ids = _ids_by_name(client.get("/api/data").json()["tree"])
    client.post("/api/unlock", json={"id": ids["Locked legacy"], "password": PASSWORD_1_0_2})
    assert import_zip(client, download(client)).status_code == 200
    for name, text in (("Locked v1", "Locked v1 from 1.0.2 ✓"),
                       ("Locked legacy", "Legacy XOR note from 1.0.2 ✓")):
        r = client.post("/api/unlock", json={"id": ids[name], "password": PASSWORD_1_0_2})
        assert r.json()["content"] == text


def test_backup_roundtrip(client, np_backend, tmp_path):
    f = new_folder(client, "Složka")
    img = upload_png(client)
    nid = new_note(client, "Poznámka", parent_id=f, content=f"text <<IMG:{img}>>")
    client.post("/api/favorites/toggle", json={"id": nid})
    blob = download(client)

    zf = zipfile.ZipFile(io.BytesIO(blob))
    assert set(zf.namelist()) == {"notes_data.json", f"images/{img}"}

    # Fresh, empty profile → import → everything is back.
    np_backend.set_data_dir(tmp_path / "fresh")
    assert import_zip(client, blob).status_code == 200
    data = client.get("/api/data").json()
    assert data["tree"][0]["children"][0]["name"] == "Poznámka"
    assert data["favorites"] == [nid]
    assert client.get(f"/api/note/{nid}").json()["content"] == f"text <<IMG:{img}>>"
    assert client.get(f"/images/{img}").content == make_png()


def test_import_replaces_existing_notes(client):
    new_note(client, "Stará", content="old")
    blob = backup_with([{"id": "n1", "name": "Nová", "type": "note"}], {"n1": "new"})
    assert import_zip(client, blob).status_code == 200
    assert [i["name"] for i in client.get("/api/data").json()["tree"]] == ["Nová"]


def test_import_drops_unreferenced_notes_and_user_ids(client):
    blob = backup_with([{"id": "n1", "name": "N", "type": "note", "user_id": "u"}],
                       {"n1": "a", "orphan": "b"})
    import_zip(client, blob)
    data = client.get("/api/data").json()
    assert data["tree"] == [{"id": "n1", "name": "N", "type": "note"}]
    assert data["notes"] == {"n1": "a"}


def test_import_rejects_garbage(client):
    assert import_zip(client, b"not a zip").status_code == 400
    assert import_zip(client, make_zip({"x.txt": "y"})).status_code == 400
    assert import_zip(client, make_zip({"notes_data.json": "{bad"})).status_code == 400


def test_import_zip_slip(client, np_backend):
    blob = backup_with([], {}, {"../../evil.png": make_png()})
    assert import_zip(client, blob).status_code == 400
    assert not (np_backend.DATA_DIR.parent / "evil.png").exists()


# K5 – import zálohy zapsal images/payload.html z cizího zipu
def test_k5_import_rejects_non_images(client, np_backend):
    new_note(client, "Zůstane", content="x")
    blob = backup_with([], {}, {"payload.html": b"<script>alert(1)</script>"})
    assert import_zip(client, blob).status_code == 415
    assert not (np_backend.IMAGES_DIR / "payload.html").exists()
    assert client.get("/api/data").json()["tree"][0]["name"] == "Zůstane"


# D15 – před importem automatická záloha stávajícího stavu
def test_d15_import_makes_safety_backup(client, np_backend):
    new_note(client, "Před importem", content="důležité")
    import_zip(client, backup_with([], {}))
    safety = sorted((np_backend.DATA_DIR / "backups").glob("pre-import-*.zip"))
    assert len(safety) == 1
    saved = json.loads(zipfile.ZipFile(safety[0]).read("notes_data.json"))
    assert saved["tree"][0]["name"] == "Před importem"


# D15 – limit rozbalené velikosti (zip bomb)
def test_d15_uncompressed_size_limit(client, np_backend, monkeypatch):
    monkeypatch.setattr(np_backend, "MAX_BACKUP_UNCOMPRESSED", 10_000)
    new_note(client, "Zůstane")
    blob = make_zip({"notes_data.json": json.dumps({"tree": [], "pad": "x" * 50_000})})
    assert import_zip(client, blob).status_code == 413
    assert client.get("/api/data").json()["tree"][0]["name"] == "Zůstane"


# D15 – limit počtu souborů
def test_d15_file_count_limit(client, np_backend, monkeypatch):
    monkeypatch.setattr(np_backend, "MAX_BACKUP_FILES", 5)
    images = {f"{i:08d}-0000-0000-0000-000000000000.png": make_png() for i in range(10)}
    assert import_zip(client, backup_with([], {}, images)).status_code == 413


# D15 – obrázek ze zálohy nesmí přepsat existující se stejným jménem
def test_d15_existing_image_not_overwritten(client, np_backend):
    name = upload_png(client)
    original = (np_backend.IMAGES_DIR / name).read_bytes()
    other = make_png(7, 7)
    import_zip(client, backup_with([], {}, {name: other}))
    assert (np_backend.IMAGES_DIR / name).read_bytes() == original



# ---- D4–D6: a bad backup never half-replaces the notes -----------------------

IMG = "11111111-2222-4333-8444-555555555555.png"
NOTE = {"id": "n", "name": "N", "type": "note"}


def _state(client):
    data = client.get("/api/data").json()
    return data["tree"], data["notes"]


@pytest.mark.parametrize("payload", [
    [1, 2],                                                   # not an object
    {"tree": "x"},                                            # tree not a list
    {"tree": [{"type": "note"}]},                             # item without id
    {"tree": [{"id": "n", "name": "N", "type": "file"}]},     # unknown type
    {"tree": [NOTE], "notes": {"n": 5}},                      # content not text
    {"tree": [NOTE], "notes": {}, "trash": []},               # trash not an object
    {"tree": [{"id": "f", "name": "F", "type": "folder", "children": "x"}]},
    {"tree": [NOTE], "favorites": "n"},
    {"tree": [NOTE], "note_images": {"n": "x.png"}},
])
def test_d4_import_rejects_malformed_data(client, payload):
    before = (new_note(client, name="Keep", content="keep me"), _state(client))[1]
    r = import_zip(client, make_zip({"notes_data.json": json.dumps(payload)}))
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "backup_corrupt_data"
    assert _state(client) == before
    assert client.get("/api/notes/export-md").status_code == 200


def _zip_with_flag(bit):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as zf:
        info = zipfile.ZipInfo("notes_data.json")
        zf.writestr(info, json.dumps({"tree": [], "notes": {}}))
    raw = bytearray(buf.getvalue())
    # general purpose flag: local header offset 6, central directory +8
    raw[6] |= bit
    cd = raw.rfind(b"PK\x01\x02")
    raw[cd + 8] |= bit
    return bytes(raw)


def _corrupt_deflate():
    data = make_zip({"notes_data.json": json.dumps({"tree": [], "notes": {"x": "a" * 5000}})})
    raw = bytearray(data)
    start = raw.find(b"notes_data.json") + len("notes_data.json")
    for i in range(start + 5, start + 40):
        raw[i] ^= 0xFF
    return bytes(raw)


@pytest.mark.parametrize("blob", [_zip_with_flag(0x1), _corrupt_deflate()],
                         ids=["password-protected", "corrupt-deflate"])
def test_d4_unreadable_zip_is_a_clean_400(client, blob):
    new_note(client, name="Keep", content="keep me")
    before = _state(client)
    r = import_zip(client, blob)
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "not_a_zip"
    assert _state(client) == before


def test_d6_import_refuses_an_oversized_image(client, np_backend, monkeypatch):
    monkeypatch.setattr(np_backend, "MAX_IMAGE_BYTES", 1000)
    new_note(client, name="Keep", content="keep me")
    before = _state(client)
    big = make_png() + b"\x00" * 5000
    r = import_zip(client, backup_with([NOTE], {"n": f"<<IMG:{IMG}>>"}, {IMG: big}))
    assert r.status_code == 413
    assert r.json()["detail"] == {"code": "backup_image_too_large", "params": {"name": f"images/{IMG}"}}
    assert _state(client) == before
    assert not (np_backend.IMAGES_DIR / IMG).exists()


def test_d5_failed_image_write_leaves_the_notes_untouched(client, np_backend, monkeypatch):
    import pathlib as _pl
    new_note(client, name="Keep", content="keep me")
    before = _state(client)
    real = _pl.Path.write_bytes

    def disk_full(self, data):
        if self.parent == np_backend.IMAGES_DIR:
            raise OSError(28, "No space left on device")
        return real(self, data)

    monkeypatch.setattr(_pl.Path, "write_bytes", disk_full)
    r = import_zip(client, backup_with([NOTE], {"n": f"<<IMG:{IMG}>>"}, {IMG: make_png()}))
    assert r.status_code == 507
    assert r.json()["detail"]["code"] == "backup_write_failed"
    assert _state(client) == before
    assert [p.name for p in np_backend.IMAGES_DIR.iterdir() if p.is_file()] == []


def test_d5_valid_import_with_image_still_works(client, np_backend):
    r = import_zip(client, backup_with([NOTE], {"n": f"<<IMG:{IMG}>>"}, {IMG: make_png()}))
    assert r.status_code == 200
    assert (np_backend.IMAGES_DIR / IMG).read_bytes() == make_png()
    assert client.get("/api/note/n").json()["content"] == f"<<IMG:{IMG}>>"
