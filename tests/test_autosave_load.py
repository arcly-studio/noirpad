"""Typing without a pause is saved every 2 s (flow-autosave.test.js). What that
must not change: one automatic copy per 10 minutes, and a locked note that is
encrypted properly on every single save."""

import json
import time

from conftest import new_note

PW = "heslo-dlouhe-1234"


def make_note(client):
    return new_note(client)



def stored(np_backend, note_id):
    return json.loads(np_backend.DATA_FILE.read_text(encoding="utf-8"))["notes"][note_id]


def test_many_saves_in_a_row_make_one_automatic_copy(client, np_backend):
    nid = make_note(client)
    for i in range(40):
        assert client.put(f"/api/note/{nid}", json={"content": "text " * i, "formats": []}).status_code == 200
    assert len(list(np_backend.backups_dir().glob("notes_data-*.json"))) == 1


def test_a_long_note_with_6000_formats_is_saved_quickly(client, np_backend):
    """Every 2 s, so one save has to be far below that (a generous limit)."""
    nid = make_note(client)
    text = "\n".join(f"{i} Your notes stay on this PC, no account at all." for i in range(1800))
    formats = [{"tag": "bold", "start": i * 20, "end": i * 20 + 4} for i in range(6000)]
    took = []
    for i in range(5):
        started = time.perf_counter()
        assert client.put(f"/api/note/{nid}", json={"content": text + "x" * i, "formats": formats}).status_code == 200
        took.append(time.perf_counter() - started)
    assert sorted(took)[2] < 1.0, took


def test_a_locked_note_is_encrypted_properly_on_every_save(client, np_backend):
    nid = make_note(client)
    client.put(f"/api/note/{nid}", json={"content": "start", "formats": []})
    r = client.post("/api/encrypt", json={"id": nid, "password": PW})
    assert r.status_code == 200, r.text
    token = r.json()["unlock_token"]
    seen = set()
    for i in range(12):
        text = f"tajnytext{i} " * 3
        formats = [{"tag": "bold", "start": 0, "end": 3 + i % 3}]
        r = client.post("/api/save-encrypted", json={"id": nid, "unlock_token": token, "content": text, "formats": formats})
        assert r.status_code == 200, r.text
        raw = np_backend.DATA_FILE.read_text(encoding="utf-8")
        assert "tajnytext" not in raw                          # never readable on disk
        seen.add(stored(np_backend, nid))
        opened = client.post("/api/unlock", json={"id": nid, "password": PW}).json()
        assert opened["content"] == text and opened["formats"][0]["end"] == 3 + i % 3
    assert len(seen) == 12                                     # each save its own encryption
    for copy in np_backend.backups_dir().glob("notes_data-*.json"):
        assert "tajnytext" not in copy.read_text(encoding="utf-8")
