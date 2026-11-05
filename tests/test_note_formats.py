"""N2: formatting and link targets of locked notes are encrypted with the text."""

import base64
import hashlib
import io
import json
import logging
import zipfile

import pytest

from conftest import encryption_routes, new_note
from noirpad import crypto, scrub

PW = "correct horse"
URL = "https://tajny-odkaz-7f3a.example/cesta"
FMT = [{"start": 0, "end": 5, "bold": True, "link": URL}]
TEXT = "Dost dlouhý text poznámky s odkazem"


def formatted_note(client, text=TEXT, formats=FMT, name="Note"):
    nid = new_note(client, name)
    r = client.put(f"/api/note/{nid}", json={"content": text, "formats": formats})
    assert r.status_code == 200, r.text
    return nid


def lock(client, nid, password=PW):
    r = client.post("/api/encrypt", json={"id": nid, "password": password})
    assert r.status_code == 200, r.text
    return r.json()["unlock_token"]


def unlock(client, nid, password=PW):
    return client.post("/api/unlock", json={"id": nid, "password": password})


def stored(np_backend, nid):
    return np_backend.read_data()["notes"][nid]


def in_file(np_backend):
    return URL in np_backend.DATA_FILE.read_text(encoding="utf-8")


def locked_by_older_version(client, np_backend, text=TEXT):
    """An envelope without the field, its formats readable beside it."""
    nid = new_note(client)
    envelope = crypto.encrypt_content(text, PW)

    def _mut(data):
        data["notes"][nid] = envelope
        data["note_formats"][nid] = FMT

    np_backend.update_data(_mut)
    return nid, envelope


def legacy_envelope(text, password=PW, salt=bytes(range(16))):
    key = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 100000)
    payload = bytes(b ^ key[i % len(key)] for i, b in enumerate(text.encode()))
    return json.dumps({"encrypted": True,
                       "data": base64.b64encode(b"\x02" + salt + payload).decode()})


def set_note(np_backend, nid, envelope, formats=None):
    def _mut(data):
        data["notes"][nid] = envelope
        if formats is None:
            data["note_formats"].pop(nid, None)
        else:
            data["note_formats"][nid] = formats

    np_backend.update_data(_mut)


# ---- the normal life of a locked note ----------------------------------------


def test_locking_moves_the_formats_into_the_envelope(client, np_backend):
    nid = formatted_note(client)
    assert in_file(np_backend)
    lock(client, nid)
    assert not in_file(np_backend)
    assert nid not in np_backend.read_data()["note_formats"]
    assert unlock(client, nid).json()["formats"] == FMT


def test_the_envelope_stays_version_1_and_its_text_opens_without_the_field(client, np_backend):
    """An older NoirPad ignores the field: it opens the text, just unformatted."""
    nid = formatted_note(client)
    lock(client, nid)
    raw = stored(np_backend, nid)
    assert crypto.envelope_version(raw) == 1
    assert crypto.is_encrypted_content(raw)
    assert "formats" in json.loads(raw)
    assert crypto.decrypt_content(raw, PW) == TEXT


def test_saving_keeps_the_formats_encrypted(client, np_backend):
    nid = formatted_note(client, formats=[])
    token = lock(client, nid)
    assert "formats" not in json.loads(stored(np_backend, nid))
    r = client.post("/api/save-encrypted", json={"id": nid, "unlock_token": token,
                                                 "content": "nový text", "formats": FMT})
    assert r.status_code == 200
    assert not in_file(np_backend)
    assert nid not in np_backend.read_data()["note_formats"]
    body = unlock(client, nid).json()
    assert (body["content"], body["formats"]) == ("nový text", FMT)


def test_cleared_formats_leave_the_envelope(client, np_backend):
    nid = formatted_note(client)
    token = lock(client, nid)
    client.post("/api/save-encrypted", json={"id": nid, "unlock_token": token,
                                             "content": TEXT, "formats": []})
    assert "formats" not in json.loads(stored(np_backend, nid))
    assert unlock(client, nid).json()["formats"] == []


@pytest.mark.parametrize("how", ["token", "password"])
def test_removing_the_lock_brings_the_formats_back(client, np_backend, how):
    nid = formatted_note(client)
    token = lock(client, nid)
    auth = {"unlock_token": token} if how == "token" else {"password": PW}
    assert client.post("/api/decrypt", json={"id": nid, **auth}).status_code == 200
    body = client.get(f"/api/note/{nid}").json()
    assert (body["content"], body["formats"]) == (TEXT, FMT)


def test_formats_survive_the_trash(client, np_backend):
    nid = formatted_note(client)
    lock(client, nid)
    client.post("/api/tree/delete", json={"id": nid})
    assert client.get(f"/api/note/{nid}").json()["formats"] == []
    assert not in_file(np_backend)
    assert client.post("/api/trash/restore", json={"id": nid}).status_code == 200
    assert unlock(client, nid).json()["formats"] == FMT


def test_formats_survive_a_backup_and_its_import(client, np_backend):
    nid = formatted_note(client)
    lock(client, nid)
    backup = client.get("/api/backup").content
    with zipfile.ZipFile(io.BytesIO(backup)) as zf:
        assert URL.encode() not in zf.read("notes_data.json")
    r = client.post("/api/backup/import", files={"file": ("b.zip", backup, "application/zip")})
    assert r.status_code == 200, r.text
    assert not in_file(np_backend)
    assert unlock(client, nid).json()["formats"] == FMT


def test_plain_notes_keep_their_formats_in_the_open(client, np_backend):
    nid = formatted_note(client)
    assert client.get(f"/api/note/{nid}").json()["formats"] == FMT
    assert client.get("/api/data").json()["note_formats"][nid] == FMT


# ---- without the password ----------------------------------------------------


def test_a_locked_note_gives_no_formats_without_the_password(client, np_backend):
    """Even when an older version left them readable in the file."""
    nid, _ = locked_by_older_version(client, np_backend)
    assert in_file(np_backend)
    assert client.get(f"/api/note/{nid}").json()["formats"] == []
    assert URL not in client.get("/api/data").text


def test_a_locked_note_in_the_trash_gives_no_formats_either(client, np_backend):
    nid, _ = locked_by_older_version(client, np_backend)
    client.post("/api/tree/delete", json={"id": nid})
    assert in_file(np_backend)
    assert client.get(f"/api/note/{nid}").json()["formats"] == []
    assert URL not in client.get("/api/data").text


# ---- notes locked by an older version ----------------------------------------


def test_the_first_unlock_seals_the_formats_of_an_old_note(client, np_backend):
    nid, envelope = locked_by_older_version(client, np_backend)
    body = unlock(client, nid).json()
    assert (body["content"], body["formats"]) == (TEXT, FMT)
    assert not in_file(np_backend)
    assert stored(np_backend, nid) != envelope
    again = unlock(client, nid).json()
    assert (again["content"], again["formats"]) == (TEXT, FMT)


def test_a_token_from_that_unlock_keeps_working(client, np_backend):
    nid, _ = locked_by_older_version(client, np_backend)
    token = unlock(client, nid).json()["unlock_token"]
    assert client.post("/api/decrypt", json={"id": nid, "unlock_token": token}).status_code == 200
    assert client.get(f"/api/note/{nid}").json()["formats"] == FMT


def test_a_wrong_password_changes_nothing(client, np_backend):
    nid, envelope = locked_by_older_version(client, np_backend)
    assert unlock(client, nid, "wrong-password").status_code == 400
    assert stored(np_backend, nid) == envelope
    assert np_backend.read_data()["note_formats"][nid] == FMT


def test_a_failed_write_keeps_everything_and_the_note_opens(client, np_backend, monkeypatch):
    nid, envelope = locked_by_older_version(client, np_backend)

    def no_disk(path, data):
        raise OSError(28, "No space left on device")

    monkeypatch.setattr(np_backend, "_atomic_write_json", no_disk)
    body = unlock(client, nid).json()
    monkeypatch.undo()
    assert (body["content"], body["formats"]) == (TEXT, FMT)
    assert stored(np_backend, nid) == envelope
    assert np_backend.read_data()["note_formats"][nid] == FMT


def test_an_envelope_that_does_not_verify_is_not_written(client, np_backend, monkeypatch):
    nid, envelope = locked_by_older_version(client, np_backend)
    monkeypatch.setattr(encryption_routes, "envelope_formats",
                        lambda stored, text, key: None if stored == envelope else [])
    body = unlock(client, nid).json()
    assert body["content"] == TEXT
    assert stored(np_backend, nid) == envelope


@pytest.mark.parametrize("change", ["note", "formats"])
def test_a_note_changed_meanwhile_is_not_overwritten(client, np_backend, change):
    nid, envelope = locked_by_older_version(client, np_backend)
    salt = bytes(range(16))
    key = crypto.derive_key(PW, salt)
    if change == "note":
        set_note(np_backend, nid, "novější obsah", FMT)
    else:
        set_note(np_backend, nid, envelope, [{"start": 0, "end": 1, "bold": True}])
    before = np_backend.read_data()
    assert encryption_routes._rewrite_envelope(nid, envelope, TEXT, FMT, FMT, key, salt) is False
    assert np_backend.read_data() == before


def test_a_certain_legacy_note_is_upgraded_with_its_formats(client, np_backend):
    nid = new_note(client)
    set_note(np_backend, nid, legacy_envelope(TEXT), FMT)
    body = unlock(client, nid).json()
    assert (body["content"], body["formats"]) == (TEXT, FMT)
    assert crypto.envelope_version(stored(np_backend, nid)) == 1
    assert not in_file(np_backend)
    assert unlock(client, nid).json()["formats"] == FMT


def test_an_uncertain_legacy_note_keeps_its_formats_until_the_first_save(client, np_backend):
    nid = new_note(client)
    envelope = legacy_envelope("krátká")
    set_note(np_backend, nid, envelope, FMT)
    body = unlock(client, nid).json()
    assert body["formats"] == FMT
    assert stored(np_backend, nid) == envelope and in_file(np_backend)
    client.post("/api/save-encrypted", json={"id": nid, "unlock_token": body["unlock_token"],
                                             "content": "krátká", "formats": FMT})
    assert not in_file(np_backend)
    assert unlock(client, nid).json()["formats"] == FMT


# ---- formats tied to their text ----------------------------------------------


def with_formats_of(target, source):
    return json.dumps({**json.loads(target), "formats": json.loads(source)["formats"]})


def test_swapped_formats_between_two_notes_are_ignored(client, np_backend, caplog):
    """Same password, different salts: the other note's token does not open."""
    a = formatted_note(client, text="Text první poznámky")
    b = formatted_note(client, text="Text druhé poznámky", name="Other")
    lock(client, a)
    lock(client, b)
    raw_a, raw_b = stored(np_backend, a), stored(np_backend, b)
    set_note(np_backend, a, with_formats_of(raw_a, raw_b))
    caplog.set_level(logging.WARNING, logger="noirpad")
    body = unlock(client, a).json()
    assert (body["content"], body["formats"]) == ("Text první poznámky", [])
    assert "formats_unreadable" in caplog.text
    assert URL not in caplog.text and "Text první" not in caplog.text


def test_swapped_formats_under_the_same_key_are_ignored(client, np_backend, caplog):
    """Same password and salt: only the text hash can tell them apart."""
    salt = bytes(range(16))
    key = crypto.derive_key(PW, salt)
    a, b = new_note(client), new_note(client, "Other")
    raw_a = crypto.encrypt_with_key("Text první poznámky", key, salt, FMT)
    raw_b = crypto.encrypt_with_key("Text druhé poznámky", key, salt, FMT)
    swapped = with_formats_of(raw_a, raw_b)
    set_note(np_backend, a, swapped)
    set_note(np_backend, b, raw_b)
    caplog.set_level(logging.WARNING, logger="noirpad")
    body = unlock(client, a).json()
    assert (body["content"], body["formats"]) == ("Text první poznámky", [])
    assert "formats_mismatch" in caplog.text
    assert URL not in caplog.text and "Text první" not in caplog.text
    assert unlock(client, b).json()["formats"] == FMT


def test_formats_of_an_older_version_of_the_text_are_ignored(client, np_backend):
    nid = formatted_note(client)
    token = lock(client, nid)
    older = stored(np_backend, nid)
    client.post("/api/save-encrypted", json={"id": nid, "unlock_token": token,
                                             "content": "novější text", "formats": []})
    set_note(np_backend, nid, with_formats_of(stored(np_backend, nid), older))
    body = unlock(client, nid).json()
    assert (body["content"], body["formats"]) == ("novější text", [])


@pytest.mark.parametrize("bad", ["garbage", "", 5, None, ["x"], {"a": 1}])
def test_a_damaged_field_never_stops_the_note_from_opening(client, np_backend, caplog, bad):
    nid = formatted_note(client)
    lock(client, nid)
    set_note(np_backend, nid, json.dumps({**json.loads(stored(np_backend, nid)), "formats": bad}))
    caplog.set_level(logging.WARNING, logger="noirpad")
    body = unlock(client, nid).json()
    assert (body["content"], body["formats"]) == (TEXT, [])
    assert "formats_unreadable" in caplog.text


@pytest.mark.parametrize("sealed", [{"formats": FMT}, {"sha256": "x"}, {"sha256": "x", "formats": "ne"}, [1]])
def test_a_wrong_shape_inside_the_token_is_ignored(client, np_backend, sealed):
    salt = bytes(range(16))
    key = crypto.derive_key(PW, salt)
    token = crypto.Fernet(key).encrypt(json.dumps(sealed).encode()).decode()
    nid = new_note(client)
    set_note(np_backend, nid, json.dumps({**json.loads(crypto.encrypt_with_key(TEXT, key, salt)),
                                          "formats": token}))
    body = unlock(client, nid).json()
    assert (body["content"], body["formats"]) == (TEXT, [])


# ---- automatic copies --------------------------------------------------------


def snapshot(np_backend, tag="a"):
    dest = np_backend.backups_dir() / f"notes_data-29990101-000000-{tag}.json"
    dest.parent.mkdir(exist_ok=True)
    dest.write_bytes(np_backend.DATA_FILE.read_bytes())
    return dest


def test_locking_cleans_the_formats_from_every_kind_of_copy(client, np_backend):
    nid = formatted_note(client)
    snap = snapshot(np_backend)
    archive = np_backend.backups_dir() / "pre-import-20260101-000000-a.zip"
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("notes_data.json", np_backend.DATA_FILE.read_bytes())
    corrupt = np_backend.DATA_DIR / "notes_data.corrupt-20260101-000000-000000.json"
    corrupt.write_bytes(np_backend.DATA_FILE.read_bytes())
    lock(client, nid)
    assert scrub.sweep() is True
    assert URL not in snap.read_text(encoding="utf-8")
    assert URL not in corrupt.read_text(encoding="utf-8")
    with zipfile.ZipFile(archive) as zf:
        assert URL.encode() not in zf.read("notes_data.json")


def test_formats_are_cleaned_from_the_trash_of_a_copy(client, np_backend):
    nid = formatted_note(client)
    client.post("/api/tree/delete", json={"id": nid})
    snap = snapshot(np_backend)
    assert URL in snap.read_text(encoding="utf-8")
    assert client.post("/api/trash/restore", json={"id": nid}).status_code == 200
    lock(client, nid)
    scrub.sweep()
    assert URL not in snap.read_text(encoding="utf-8")


def test_a_copy_keeps_the_formats_until_the_note_was_unlocked(client, np_backend):
    """Until then the current data holds them too, and a copy may be needed."""
    nid, _ = locked_by_older_version(client, np_backend)
    snap = snapshot(np_backend)
    scrub.sweep()
    assert URL in snap.read_text(encoding="utf-8")
    unlock(client, nid)
    scrub.sweep()
    assert URL not in snap.read_text(encoding="utf-8")


def test_the_formats_of_other_notes_stay_in_a_copy(client, np_backend):
    nid = formatted_note(client)
    other = formatted_note(client, text="Druhá", name="Other")
    snap = snapshot(np_backend)
    lock(client, nid)
    scrub.sweep()
    # … the other note's are its own, in the open like the note itself
    formats = json.loads(snap.read_text(encoding="utf-8"))["note_formats"]
    assert list(formats) == [other]
