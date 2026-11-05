"""Per-note encryption: lock, unlock (token), save, remove, wrong password.

D2: the password is sent only to lock/unlock; saves use a short-lived
unlock token and the derived key lives only in server memory.
"""

import base64
import hashlib
import json
import time

import pytest

from conftest import encryption_routes, new_note
from noirpad import crypto, scrub

PW = "correct horse"


def stored(np_backend, note_id):
    return np_backend._read_data()["notes"][note_id]


def lock(client, nid, password=PW):
    r = client.post("/api/encrypt", json={"id": nid, "password": password})
    assert r.status_code == 200, r.text
    return r.json()["unlock_token"]


def unlock(client, nid, password=PW):
    return client.post("/api/unlock", json={"id": nid, "password": password})


def test_encrypt_keeps_note_unlocked_with_token(client, np_backend):
    nid = new_note(client, content="tajné")
    token = lock(client, nid)
    raw = stored(np_backend, nid)
    assert json.loads(raw)["encrypted"] is True
    assert "tajné" not in raw
    r = client.post("/api/save-encrypted",
                    json={"id": nid, "unlock_token": token, "content": "nové", "formats": []})
    assert r.status_code == 200
    assert unlock(client, nid).json()["content"] == "nové"


def test_unlock_returns_content_and_leaves_file_encrypted(client, np_backend):
    nid = new_note(client, content="tajné")
    lock(client, nid)
    r = unlock(client, nid)
    assert r.status_code == 200
    body = r.json()
    assert body["content"] == "tajné"
    assert body["unlock_token"]
    assert json.loads(stored(np_backend, nid))["encrypted"] is True


def test_wrong_password(client, np_backend):
    nid = new_note(client, content="tajné")
    lock(client, nid)
    before = stored(np_backend, nid)
    assert unlock(client, nid, "nope-nope").status_code == 400
    assert client.post("/api/decrypt", json={"id": nid, "password": "nope-nope"}).status_code == 400
    assert stored(np_backend, nid) == before


@pytest.mark.parametrize("password", ["", "a", "abc"])
def test_d2_too_short_password_rejected(client, np_backend, password):
    nid = new_note(client, content="x")
    r = client.post("/api/encrypt", json={"id": nid, "password": password})
    assert r.status_code == 400
    assert stored(np_backend, nid) == "x"


def test_n5_four_characters_are_enough(client, np_backend):
    nid = new_note(client, content="krátké")
    r = client.post("/api/encrypt", json={"id": nid, "password": "1234"})
    assert r.status_code == 200
    assert stored(np_backend, nid) != "krátké"
    assert unlock(client, nid, "1234").status_code == 200


def test_double_encrypt_is_rejected(client):
    nid = new_note(client, content="x")
    lock(client, nid)
    assert client.post("/api/encrypt", json={"id": nid, "password": PW}).status_code == 400


# D2 – heslo se neposílá při každém autosave: save-encrypted ho ani nepřijme
def test_d2_save_requires_token_not_password(client, np_backend):
    nid = new_note(client, content="v1")
    lock(client, nid)
    r = client.post("/api/save-encrypted",
                    json={"id": nid, "password": PW, "content": "v2", "formats": []})
    assert r.status_code == 422
    r = client.post("/api/save-encrypted",
                    json={"id": nid, "unlock_token": "forged", "content": "v2", "formats": []})
    assert r.status_code == 401


def test_d2_token_is_bound_to_its_note(client):
    a = new_note(client, "A", content="a")
    b = new_note(client, "B", content="b")
    token_a = lock(client, a)
    lock(client, b)
    r = client.post("/api/save-encrypted",
                    json={"id": b, "unlock_token": token_a, "content": "x", "formats": []})
    assert r.status_code == 401


def test_d2_lock_forgets_key(client):
    nid = new_note(client, content="v1")
    token = lock(client, nid)
    assert client.post("/api/lock", json={"unlock_token": token}).status_code == 200
    r = client.post("/api/save-encrypted",
                    json={"id": nid, "unlock_token": token, "content": "v2", "formats": []})
    assert r.status_code == 401


def test_d2_lock_all_forgets_every_key(client, np_backend):
    a = new_note(client, "A", content="a")
    token = lock(client, a)
    client.post("/api/lock-all")
    assert np_backend.RUNTIME.unlocked == {}
    r = client.post("/api/save-encrypted",
                    json={"id": a, "unlock_token": token, "content": "x", "formats": []})
    assert r.status_code == 401


def test_d2_idle_token_expires(client, np_backend, monkeypatch):
    nid = new_note(client, content="v1")
    token = lock(client, nid)
    real_time = time.time
    monkeypatch.setattr(np_backend.time, "time",
                        lambda: real_time() + np_backend.UNLOCK_IDLE_TTL + 1)
    r = client.post("/api/save-encrypted",
                    json={"id": nid, "unlock_token": token, "content": "x", "formats": []})
    assert r.status_code == 401


def test_d2_password_never_stored(client, np_backend):
    nid = new_note(client, content="x")
    token = lock(client, nid)
    text = np_backend.DATA_FILE.read_text(encoding="utf-8")
    assert PW not in text and token not in text


def test_remove_encryption_with_token(client, np_backend):
    nid = new_note(client, content="tajné")
    token = lock(client, nid)
    r = client.post("/api/decrypt", json={"id": nid, "unlock_token": token})
    assert r.status_code == 200
    assert stored(np_backend, nid) == "tajné"
    assert np_backend.RUNTIME.unlocked == {}


def test_remove_encryption_with_password(client, np_backend):
    nid = new_note(client, content="tajné")
    lock(client, nid)
    assert client.post("/api/decrypt", json={"id": nid, "password": PW}).status_code == 200
    assert stored(np_backend, nid) == "tajné"


def test_legacy_desktop_envelope_decrypts(client, np_backend):
    nid = new_note(client, content="placeholder")
    envelope = np_backend.encrypt_content("ze staré appky", PW)
    np_backend._update_data(lambda d: d["notes"].__setitem__(nid, envelope))
    assert unlock(client, nid).json()["content"] == "ze staré appky"


# Written by NoirPad 1.0.1 with cryptography 46.0.7. Never regenerate this
# literal: it proves that notes locked by an older release still open.
ENVELOPE_FROM_1_0_1 = (
    '{"encrypted": true, "data": "ATmZ+vnqeMdKgIjkJ/UWZyVnQUFBQUFCcTYzVE1IbE9CdkwzSkFEREY4U0wtYVRi'
    'dm1iRDFiUVJyZnhUSVB6M1NxSGhlVGlwVVJPVDI4VlR0THRkQXdNSFEwU3FsNE1NeUtnRmF1UVJDRC15X1N6OGhSVVdk'
    'UlowYnVtTTUwUVkyQ1ljWF9DRGhZYU9LTnJreGhkd3Z0SDNCZk0yRQ=="}'
)


def test_envelope_from_1_0_1_still_unlocks(client, np_backend):
    nid = new_note(client, content="placeholder")
    np_backend._update_data(lambda d: d["notes"].__setitem__(nid, ENVELOPE_FROM_1_0_1))
    r = unlock(client, nid, "fixture-password")
    assert r.status_code == 200, r.text
    assert r.json()["content"] == "Poznámka zamčená verzí 1.0.1 ✓"
    assert unlock(client, nid, "wrong-password").status_code == 400


def legacy_envelope(text, password=PW, salt=bytes(range(16))):
    """A legacy version-2 (XOR) envelope, as the old desktop app wrote it."""
    key = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 100000)
    raw = text.encode() if isinstance(text, str) else text
    payload = bytes(b ^ key[i % len(key)] for i, b in enumerate(raw))
    return json.dumps({"encrypted": True,
                       "data": base64.b64encode(b"\x02" + salt + payload).decode()})


def legacy_note(client, np_backend, text, password=PW):
    nid = new_note(client, content="placeholder")
    envelope = legacy_envelope(text, password)
    np_backend._update_data(lambda d: d["notes"].__setitem__(nid, envelope))
    return nid, envelope


def version_of(raw):
    return base64.b64decode(json.loads(raw)["data"])[0]


LONG_LEGACY = "Stará poznámka z tkinter verze ✓"


# N4: a legacy note moves to version 1 once its password has opened it.
def test_n4_unlock_upgrades_a_legacy_note(client, np_backend):
    nid, _ = legacy_note(client, np_backend, LONG_LEGACY)
    body = unlock(client, nid).json()
    assert body["content"] == LONG_LEGACY
    assert version_of(stored(np_backend, nid)) == 1
    assert unlock(client, nid).json()["content"] == LONG_LEGACY
    assert unlock(client, nid, "wrong-password").status_code == 400


def test_n4_unlocked_token_still_saves_after_the_upgrade(client, np_backend):
    nid, _ = legacy_note(client, np_backend, LONG_LEGACY)
    token = unlock(client, nid).json()["unlock_token"]
    r = client.post("/api/save-encrypted",
                    json={"id": nid, "unlock_token": token, "content": "nová", "formats": []})
    assert r.status_code == 200
    assert unlock(client, nid).json()["content"] == "nová"


def test_n4_only_the_password_upgrades_never_a_failed_try(client, np_backend):
    nid, envelope = legacy_note(client, np_backend, LONG_LEGACY)
    wrong = "wrong-password"
    assert unlock(client, nid, wrong).status_code in (200, 400)
    assert stored(np_backend, nid) == envelope
    client.get(f"/api/note/{nid}")
    client.get("/api/data")
    assert stored(np_backend, nid) == envelope


def test_n4_failed_write_keeps_the_original_and_the_note_opens(client, np_backend, monkeypatch):
    nid, envelope = legacy_note(client, np_backend, LONG_LEGACY)

    def no_disk(path, data):
        raise OSError(28, "No space left on device")

    monkeypatch.setattr(np_backend, "_atomic_write_json", no_disk)
    r = unlock(client, nid)
    assert r.status_code == 200 and r.json()["content"] == LONG_LEGACY
    monkeypatch.undo()
    assert stored(np_backend, nid) == envelope


def test_n4_new_envelope_that_does_not_open_is_not_written(client, np_backend, monkeypatch):
    nid, envelope = legacy_note(client, np_backend, LONG_LEGACY)
    monkeypatch.setattr(encryption_routes, "decrypt_with_key", lambda *a: "something else")
    r = unlock(client, nid)
    assert r.status_code == 200 and r.json()["content"] == LONG_LEGACY
    assert stored(np_backend, nid) == envelope


def test_n4_note_changed_meanwhile_is_not_overwritten(client, np_backend, monkeypatch):
    nid, envelope = legacy_note(client, np_backend, LONG_LEGACY)
    salt = bytes(range(16))
    key = crypto.derive_key(PW, salt)
    np_backend._update_data(lambda d: d["notes"].__setitem__(nid, "novější obsah"))
    assert encryption_routes._upgrade_legacy_note(nid, envelope, LONG_LEGACY, key, salt) is False
    assert stored(np_backend, nid) == "novější obsah"


# Bytes a wrong password can produce: valid UTF-8, so only a person can tell.
@pytest.mark.parametrize("text", ["krátká", "a" * 15, "text\x01s řídicím znakem a dost dlouhý", "\x7f" * 20])
def test_n4_uncertain_text_waits_for_the_first_save(client, np_backend, text):
    nid, envelope = legacy_note(client, np_backend, text)
    body = unlock(client, nid).json()
    assert body["content"] == text
    assert stored(np_backend, nid) == envelope
    client.post("/api/save-encrypted", json={"id": nid, "unlock_token": body["unlock_token"],
                                             "content": "uložená", "formats": []})
    assert version_of(stored(np_backend, nid)) == 1


def test_n4_old_image_marker_counts_as_ordinary_text(client, np_backend):
    text = "Poznámka s obrázkem \x00IMG:a.png\x00 a textem"
    nid, _ = legacy_note(client, np_backend, text)
    assert unlock(client, nid).json()["content"] == text
    assert version_of(stored(np_backend, nid)) == 1


def test_n4_upgrade_cleans_the_weak_format_from_copies(client, np_backend):
    nid, envelope = legacy_note(client, np_backend, LONG_LEGACY)
    snap = np_backend.backups_dir() / "notes_data-20260101-000000-000000.json"
    snap.parent.mkdir(exist_ok=True)
    snap.write_bytes(np_backend.DATA_FILE.read_bytes())
    unlock(client, nid)
    scrub.sweep()
    in_copy = json.loads(snap.read_text(encoding="utf-8"))["notes"][nid]
    assert in_copy == stored(np_backend, nid) and in_copy != envelope


# Removing the lock through the token used to fail: the key it holds is the
# new version-1 one, the note on disk still legacy.
def test_removing_the_lock_of_a_legacy_note_with_a_token(client, np_backend):
    nid, _ = legacy_note(client, np_backend, "krátká")
    token = unlock(client, nid).json()["unlock_token"]
    assert version_of(stored(np_backend, nid)) == 2
    r = client.post("/api/decrypt", json={"id": nid, "unlock_token": token})
    assert r.status_code == 200, r.text
    assert stored(np_backend, nid) == "krátká"


def test_removing_the_lock_of_an_upgraded_note_with_its_token(client, np_backend):
    nid, _ = legacy_note(client, np_backend, LONG_LEGACY)
    token = unlock(client, nid).json()["unlock_token"]
    r = client.post("/api/decrypt", json={"id": nid, "unlock_token": token})
    assert r.status_code == 200, r.text
    assert stored(np_backend, nid) == LONG_LEGACY


def _password_giving_valid_utf8(envelope):
    """A wrong password whose XOR output happens to be valid UTF-8."""
    for i in range(20000):
        guess = f"guess-{i}"
        try:
            crypto.decrypt_content(envelope, guess)
            return guess
        except ValueError:
            continue
    raise AssertionError("no such password found")


# A wrong password used to replace a legacy note with nonsense for good.
def test_wrong_password_cannot_replace_a_legacy_note_with_nonsense(client, np_backend):
    nid, envelope = legacy_note(client, np_backend, "ab")
    wrong = _password_giving_valid_utf8(envelope)
    assert crypto.decrypt_content(envelope, wrong) != "ab"     # the XOR does not notice
    r = client.post("/api/decrypt", json={"id": nid, "password": wrong})
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "legacy_note_unlock_first"
    assert stored(np_backend, nid) == envelope


def test_removing_the_lock_with_the_password_still_works_when_certain(client, np_backend):
    nid, _ = legacy_note(client, np_backend, LONG_LEGACY)
    r = client.post("/api/decrypt", json={"id": nid, "password": PW})
    assert r.status_code == 200, r.text
    assert stored(np_backend, nid) == LONG_LEGACY


def test_short_legacy_note_is_removed_through_unlock_first(client, np_backend):
    nid, envelope = legacy_note(client, np_backend, "ab")
    r = client.post("/api/decrypt", json={"id": nid, "password": PW})
    assert r.json()["detail"]["code"] == "legacy_note_unlock_first"
    assert stored(np_backend, nid) == envelope
    token = unlock(client, nid).json()["unlock_token"]
    assert client.post("/api/decrypt", json={"id": nid, "unlock_token": token}).status_code == 200
    assert stored(np_backend, nid) == "ab"


def test_legacy_v2_note_is_upgraded_on_save(client, np_backend):
    nid, _ = legacy_note(client, np_backend, "stará")

    body = unlock(client, nid).json()
    assert body["content"] == "stará"
    client.post("/api/save-encrypted", json={"id": nid, "unlock_token": body["unlock_token"],
                                              "content": "nová", "formats": []})
    assert version_of(stored(np_backend, nid)) == 1
    assert unlock(client, nid).json()["content"] == "nová"


def test_d2_save_with_lock_after_forgets_key(client, np_backend):
    nid = new_note(client, content="v1")
    token = lock(client, nid)
    r = client.post("/api/save-encrypted", json={
        "id": nid, "unlock_token": token, "content": "v2", "formats": [], "lock_after": True})
    assert r.status_code == 200
    assert np_backend.RUNTIME.unlocked == {}
    assert unlock(client, nid).json()["content"] == "v2"


# K2: a locked note's file must never be overwritten with its plaintext.
def test_k2_plain_save_cannot_overwrite_an_encrypted_note(client, np_backend):
    nid = new_note(client, content="tajné")
    lock(client, nid)
    before = stored(np_backend, nid)
    r = client.put(f"/api/note/{nid}", json={"content": "tajné v čistém textu", "formats": [],
                                            "mode": "markdown"})
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "note_is_encrypted"
    assert stored(np_backend, nid) == before


def test_k2_mode_change_of_an_unlocked_note_stays_encrypted(client, np_backend):
    nid = new_note(client, content="# tajné")
    token = lock(client, nid)
    r = client.post("/api/save-encrypted", json={"id": nid, "unlock_token": token,
                                                 "content": "# tajné", "mode": "markdown"})
    assert r.status_code == 200
    raw = stored(np_backend, nid)
    assert "tajné" not in raw and json.loads(raw)["encrypted"] is True
    assert client.get(f"/api/note/{nid}").json()["mode"] == "markdown"
    client.post("/api/save-encrypted", json={"id": nid, "unlock_token": token,
                                             "content": "# tajné", "mode": "rich-text"})
    assert client.get(f"/api/note/{nid}").json()["mode"] == "rich-text"


# D15: guessing a note's password is rate-limited like the app lock.
@pytest.mark.parametrize("endpoint", ["/api/unlock", "/api/decrypt"])
def test_d15_note_password_guesses_are_limited(client, np_backend, endpoint):
    nid = new_note(client, content="tajné")
    lock(client, nid)
    codes = [client.post(endpoint, json={"id": nid, "password": f"guess-{i}"}).status_code
             for i in range(np_backend.LOGIN_MAX_FAILURES + 1)]
    assert codes[:-1] == [400] * np_backend.LOGIN_MAX_FAILURES
    assert codes[-1] == 429
    r = client.post(endpoint, json={"id": nid, "password": PW})   # even the right one waits
    assert r.status_code == 429 and r.json()["detail"]["code"] == "too_many_attempts"


# D16: clearing the formatting of an unlocked note sticks.
def test_d16_save_encrypted_can_clear_formats(client):
    nid = new_note(client, content="tučně")
    token = lock(client, nid)
    fmt = [{"start": "1.0", "end": "1.5", "bold": True}]
    client.post("/api/save-encrypted", json={"id": nid, "unlock_token": token, "content": "tučně", "formats": fmt})
    assert unlock(client, nid).json()["formats"] == fmt
    client.post("/api/save-encrypted", json={"id": nid, "unlock_token": token, "content": "tučně", "formats": []})
    assert unlock(client, nid).json()["formats"] == []
