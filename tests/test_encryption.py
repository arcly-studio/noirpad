"""Per-note encryption: lock, unlock (token), save, remove, wrong password.

D2: the password is sent only to lock/unlock; saves use a short-lived
unlock token and the derived key lives only in server memory.
"""

import json
import time

import pytest

from conftest import new_note

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
    assert unlock(client, nid, "wrong-password").status_code != 200


def test_legacy_v2_note_is_upgraded_on_save(client, np_backend):
    import base64
    import hashlib
    import os

    nid = new_note(client, content="placeholder")
    salt = os.urandom(16)
    key = hashlib.pbkdf2_hmac("sha256", PW.encode(), salt, 100000)
    payload = bytes(b ^ key[i % len(key)] for i, b in enumerate("stará".encode()))
    env = json.dumps({"encrypted": True,
                      "data": base64.b64encode(b"\x02" + salt + payload).decode()})
    np_backend._update_data(lambda d: d["notes"].__setitem__(nid, env))

    body = unlock(client, nid).json()
    assert body["content"] == "stará"
    client.post("/api/save-encrypted", json={"id": nid, "unlock_token": body["unlock_token"],
                                              "content": "nová", "formats": []})
    version = base64.b64decode(json.loads(stored(np_backend, nid))["data"])[0]
    assert version == 1
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
