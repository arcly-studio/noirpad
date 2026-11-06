"""N1: readable text of locked and deleted notes must not stay in the copies."""

import json
import logging
import os
import threading
import time
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from conftest import API_HEADERS, make_png, new_folder, new_note
from noirpad import scrub, storage

PW = "correct horse"
MARK = "ZNACKA-TAJNY-TEXT-7f3a"
DAY = 24 * 60 * 60


def lock(client, note_id):
    r = client.post("/api/encrypt", json={"id": note_id, "password": PW})
    assert r.status_code == 200, r.text


def snapshot(np_backend, tag="a"):
    """A snapshot of the current data under a name of our own."""
    dest = np_backend.backups_dir() / f"notes_data-29990101-000000-{tag}.json"   # the newest
    dest.parent.mkdir(exist_ok=True)
    dest.write_bytes(np_backend.DATA_FILE.read_bytes())
    return dest


def pre_import_zip(np_backend, tag="a", image=None):
    dest = np_backend.backups_dir() / f"pre-import-20260101-000000-{tag}.zip"
    dest.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("notes_data.json", np_backend.DATA_FILE.read_bytes())
        if image:
            zf.writestr("images/a.png", image)
    return dest


def all_bytes_with(np_backend, mark=MARK):
    """Every file of the data folder that holds *mark*, zips looked into."""
    needle = mark.encode()
    found = []
    for path in Path(np_backend.DATA_DIR).rglob("*"):
        if not path.is_file():
            continue
        if needle in path.read_bytes():
            found.append(path.name)
        elif zipfile.is_zipfile(path):
            with zipfile.ZipFile(path) as zf:
                found += [f"{path.name}:{n}" for n in zf.namelist() if needle in zf.read(n)]
    return found


# ---- locked notes -----------------------------------------------------------


def test_locking_cleans_every_kind_of_copy(client, np_backend):
    nid = new_note(client, content=MARK)
    snap = snapshot(np_backend)
    archive = pre_import_zip(np_backend)
    corrupt = np_backend.DATA_DIR / "notes_data.corrupt-20260101-000000-000000.json"
    corrupt.write_bytes(np_backend.DATA_FILE.read_bytes())
    bak = np_backend.DATA_BAK
    bak.write_bytes(np_backend.DATA_FILE.read_bytes())
    profile = np_backend.DATA_DIR / "notes_data.pre-single-profile-20260101-000000.json"
    profile.write_bytes(np_backend.DATA_FILE.read_bytes())
    assert len(all_bytes_with(np_backend)) >= 6

    lock(client, nid)
    assert scrub.sweep() is True

    assert all_bytes_with(np_backend) == []
    envelope = np_backend.read_data()["notes"][nid]
    for path in (snap, corrupt, bak, profile):
        assert json.loads(path.read_text(encoding="utf-8"))["notes"][nid] == envelope
    with zipfile.ZipFile(archive) as zf:
        assert json.loads(zf.read("notes_data.json"))["notes"][nid] == envelope


def test_the_snapshot_taken_by_the_locking_write_is_cleaned(client, np_backend):
    nid = new_note(client, content=MARK)
    for old in np_backend.backups_dir().glob("notes_data-*.json"):
        old.unlink()                    # the throttle lets the locking write snapshot
    lock(client, nid)
    assert list(np_backend.backups_dir().glob("notes_data-*.json"))
    assert all_bytes_with(np_backend)   # … that snapshot is still readable

    scrub.sweep()
    assert all_bytes_with(np_backend) == []


def test_a_locked_note_in_the_trash_is_cleaned_too(client, np_backend):
    nid = new_note(client, content=MARK)
    snapshot(np_backend)
    lock(client, nid)
    client.post("/api/tree/delete", json={"id": nid})
    scrub.sweep()
    assert all_bytes_with(np_backend) == []


def test_a_cleaned_snapshot_still_restores_the_note(client, np_backend):
    nid = new_note(client, content=MARK)
    other = new_note(client, "Other", content="Zůstává čitelná")
    snapshot(np_backend)
    lock(client, nid)
    scrub.sweep()

    np_backend.DATA_FILE.write_text("{ damaged", encoding="utf-8")
    data = np_backend.read_data()
    assert data["notes"][other] == "Zůstává čitelná"
    assert client.post("/api/unlock", json={"id": nid, "password": PW}).json()["content"] == MARK


def test_cleaning_keeps_other_notes_and_images_in_a_zip(client, np_backend):
    nid = new_note(client, content=MARK)
    other = new_note(client, "Other", content="Druhá poznámka")
    png = make_png()
    archive = pre_import_zip(np_backend, image=png)
    lock(client, nid)
    scrub.sweep()
    with zipfile.ZipFile(archive) as zf:
        assert zf.read("images/a.png") == png
        assert json.loads(zf.read("notes_data.json"))["notes"][other] == "Druhá poznámka"


def test_cleaning_keeps_the_age_of_a_copy(client, np_backend):
    nid = new_note(client, content=MARK)
    snap = snapshot(np_backend)
    archive = pre_import_zip(np_backend)
    old = time.time() - 3 * DAY
    for path in (snap, archive):
        os.utime(path, (old, old))
    lock(client, nid)
    scrub.sweep()
    for path in (snap, archive):
        assert abs(path.stat().st_mtime - old) < 2


def test_a_pass_without_anything_to_clean_writes_nothing(client, np_backend):
    nid = new_note(client, content=MARK)
    lock(client, nid)
    scrub.sweep()
    snap = snapshot(np_backend)
    archive = pre_import_zip(np_backend)
    before = (snap.stat().st_mtime_ns, archive.stat().st_mtime_ns)
    scrub.sweep()
    assert (snap.stat().st_mtime_ns, archive.stat().st_mtime_ns) == before


def test_a_copy_of_an_older_locked_version_stays_as_it_is(client, np_backend):
    nid = new_note(client, content=MARK)
    r = client.post("/api/encrypt", json={"id": nid, "password": PW})
    snap = snapshot(np_backend)
    older = json.loads(snap.read_text(encoding="utf-8"))["notes"][nid]
    client.post("/api/save-encrypted", json={"id": nid, "unlock_token": r.json()["unlock_token"],
                                             "content": "novější", "formats": []})
    scrub.sweep()
    assert json.loads(snap.read_text(encoding="utf-8"))["notes"][nid] == older


# ---- only a lock changes a copy, and never one newer than the lock -----------


def zip_note(archive, nid):
    with zipfile.ZipFile(archive) as zf:
        return json.loads(zf.read("notes_data.json"))["notes"][nid]


def older_backup_of_a_locked_note(client, np_backend, nid, monkeypatch=None, then=None):
    """A backup with this note locked, optionally long ago."""
    if then is None:
        lock(client, nid)
    else:
        with monkeypatch.context() as m:
            m.setattr(time, "time", lambda: then)
            lock(client, nid)
    return client.get("/api/backup").content


def edit_after_removing_the_lock(client, nid, text):
    token = client.post("/api/unlock", json={"id": nid, "password": PW}).json()["unlock_token"]
    assert client.post("/api/decrypt", json={"id": nid, "unlock_token": token}).status_code == 200
    assert client.put(f"/api/note/{nid}", json={"content": text, "formats": []}).status_code == 200


def import_backup(client, backup):
    r = client.post("/api/backup/import", files={"file": ("b.zip", backup, "application/zip")})
    assert r.status_code == 200, r.text


def test_1_0_x_import_of_an_older_lock_keeps_the_newer_text_at_first_start(client, np_backend, monkeypatch):
    """1.0.x data: the note was unlocked and edited, then a backup with the
    older locked version was imported. The first pass of 1.1.0 covers every
    locked note, but the safety copy holds the newer text."""
    nid = new_note(client, content="starší text")
    backup = older_backup_of_a_locked_note(client, np_backend, nid, monkeypatch, time.time() - 100 * DAY)
    edit_after_removing_the_lock(client, nid, "NOVĚJŠÍ TEXT")
    import_backup(client, backup)
    # as 1.0.x left it: no mark of a lock, the first pass still to come
    np_backend.update_data(lambda d: (d.pop("scrub_locked", None), d.pop("scrub_first_pass_done", None)))
    archive = next(np_backend.backups_dir().glob("pre-import-*.zip"))
    assert scrub.sweep() is True
    assert zip_note(archive, nid) == "NOVĚJŠÍ TEXT"
    assert np_backend.read_data()["scrub_first_pass_done"] is True


def test_a_copy_newer_than_the_lock_is_skipped_even_for_a_marked_note(client, np_backend):
    nid = new_note(client, content="čitelný text")
    snap = snapshot(np_backend)
    lock(client, nid)
    in_an_hour = time.time() + 3600
    os.utime(snap, (in_an_hour, in_an_hour))
    assert scrub.sweep() is True
    assert "čitelný text" in snap.read_text(encoding="utf-8")
    assert "scrub_locked" not in np_backend.read_data()     # … left to rotation and limits


def test_the_first_pass_cleans_copies_older_than_the_lock(client, np_backend):
    """What the first pass is for: copies an older version left readable."""
    nid = new_note(client, content=MARK)
    snap = snapshot(np_backend)
    long_ago = time.time() - 50 * DAY
    os.utime(snap, (long_ago, long_ago))
    lock(client, nid)
    np_backend.update_data(lambda d: d.pop("scrub_locked", None))
    scrub.sweep()
    assert MARK not in snap.read_text(encoding="utf-8")


def test_import_marks_nothing_and_changes_no_copy(client, np_backend):
    """Within seconds, so the time check cannot tell: only a lock changes a copy."""
    nid = new_note(client, content="starší text")
    backup = older_backup_of_a_locked_note(client, np_backend, nid)
    scrub.sweep()
    edit_after_removing_the_lock(client, nid, "NOVĚJŠÍ TEXT")
    import_backup(client, backup)
    assert "scrub_locked" not in np_backend.read_data()
    archive = next(np_backend.backups_dir().glob("pre-import-*.zip"))
    assert scrub.sweep() is True
    assert zip_note(archive, nid) == "NOVĚJŠÍ TEXT"


def test_a_note_locked_anew_during_a_pass_stays_marked(client, np_backend, monkeypatch):
    nid = new_note(client, content="text")
    lock(client, nid)
    real = scrub._copies

    def lock_again_meanwhile():
        def _mut(data):
            data["notes"][nid] = scrub.storage.read_data_unlocked()["notes"][nid] + " "
        np_backend.update_data(_mut)
        return real()

    monkeypatch.setattr(scrub, "_copies", lock_again_meanwhile)
    scrub.sweep()
    assert np_backend.read_data()["scrub_locked"] == [nid]


def test_the_marks_stay_out_of_the_browser_and_backups(client, np_backend):
    nid = new_note(client, content="text")
    lock(client, nid)
    scrub.sweep()
    lock_data = client.get("/api/data").json()
    lock_zip = zipfile.ZipFile(__import__("io").BytesIO(client.get("/api/backup").content))
    for view in (lock_data, json.loads(lock_zip.read("notes_data.json"))):
        assert "scrub_locked" not in view and "scrub_first_pass_done" not in view


# ---- notes deleted for good --------------------------------------------------


def test_deleting_for_good_removes_the_note_from_copies(client, np_backend):
    keep = new_note(client, "Keep", content="Zůstává")
    nid = new_note(client, "Secret", content=MARK)
    snap = snapshot(np_backend)
    archive = pre_import_zip(np_backend)
    client.post("/api/tree/delete", json={"id": nid})
    client.post("/api/trash/empty")
    assert np_backend.read_data()["scrub_pending"] == [nid]

    assert scrub.sweep() is True

    assert all_bytes_with(np_backend) == []
    assert "scrub_pending" not in np_backend.read_data()
    for data in (json.loads(snap.read_text(encoding="utf-8")),
                 json.loads(zipfile.ZipFile(archive).read("notes_data.json"))):
        assert nid not in data["notes"] and nid not in json.dumps(data["tree"])
        assert data["notes"][keep] == "Zůstává"


def test_deleting_one_item_from_the_trash_cleans_copies(client, np_backend):
    nid = new_note(client, content=MARK)
    client.post("/api/tree/delete", json={"id": nid})
    snapshot(np_backend)
    client.post("/api/trash/delete", json={"id": nid})
    scrub.sweep()
    assert all_bytes_with(np_backend) == []


def test_a_note_moved_out_of_a_deleted_folder_stays_in_the_copy(client, np_backend):
    folder = new_folder(client)
    child = new_note(client, "Child", parent_id=folder, content="Dítě")
    anchor = new_note(client, "Anchor")
    snap = snapshot(np_backend)
    r = client.post("/api/tree/move", json={"id": child, "target_id": anchor, "position": "after"})
    assert r.status_code == 200, r.text
    client.post("/api/tree/delete", json={"id": folder})
    client.post("/api/trash/empty")
    assert np_backend.read_data()["scrub_pending"] == [folder]
    scrub.sweep()
    data = json.loads(snap.read_text(encoding="utf-8"))
    assert {i["id"] for i in data["tree"]} == {child, anchor}
    assert data["notes"][child] == "Dítě"


def test_a_note_absent_from_current_data_is_not_removed_from_copies(client, np_backend):
    """An emptied data file or a replacing import looks just like this: the
    copies are what brings the notes back."""
    nid = new_note(client, content="Moje poznámka")
    snap = snapshot(np_backend)
    archive = pre_import_zip(np_backend)
    np_backend.update_data(lambda d: (d["notes"].clear(), d["tree"].clear()))
    scrub.sweep()
    assert json.loads(snap.read_text(encoding="utf-8"))["notes"][nid] == "Moje poznámka"
    with zipfile.ZipFile(archive) as zf:
        assert json.loads(zf.read("notes_data.json"))["notes"][nid] == "Moje poznámka"


def test_an_id_that_came_back_is_not_deleted_from_copies(client, np_backend):
    nid = new_note(client, content="Vrácená")
    snap = snapshot(np_backend)
    np_backend.update_data(lambda d: d.__setitem__("scrub_pending", [nid]))
    scrub.sweep()
    assert json.loads(snap.read_text(encoding="utf-8"))["notes"][nid] == "Vrácená"
    assert "scrub_pending" not in np_backend.read_data()


def test_a_failed_copy_keeps_the_deletion_pending(client, np_backend, monkeypatch):
    nid = new_note(client, content=MARK)
    snap = snapshot(np_backend)
    client.post("/api/tree/delete", json={"id": nid})
    client.post("/api/trash/empty")
    real = storage._atomic_write_json

    def fail(path, data):
        if path == snap:
            raise OSError(13, "Permission denied")
        real(path, data)

    monkeypatch.setattr(storage, "_atomic_write_json", fail)
    assert scrub.sweep() is False
    assert np_backend.read_data()["scrub_pending"] == [nid]
    assert MARK in snap.read_text(encoding="utf-8")

    monkeypatch.undo()
    assert scrub.sweep() is True      # the next start
    assert "scrub_pending" not in np_backend.read_data()
    assert MARK not in snap.read_text(encoding="utf-8")


def test_pending_ids_stay_out_of_the_browser_and_backups(client, np_backend):
    nid = new_note(client)
    client.post("/api/tree/delete", json={"id": nid})
    client.post("/api/trash/empty")
    assert "scrub_pending" in np_backend.read_data()
    assert "scrub_pending" not in client.get("/api/data").json()
    with zipfile.ZipFile(__import__("io").BytesIO(client.get("/api/backup").content)) as zf:
        assert "scrub_pending" not in json.loads(zf.read("notes_data.json"))


# ---- what cannot be cleaned --------------------------------------------------


def test_damaged_files_are_left_alone_and_do_not_stop_the_pass(client, np_backend):
    nid = new_note(client, content=MARK)
    snap = snapshot(np_backend, "good")
    bad_json = np_backend.DATA_DIR / "notes_data.corrupt-20260101-000000-000000.json"
    bad_json.write_bytes(b"{ damaged " + MARK.encode())
    bad_zip = np_backend.backups_dir() / "pre-import-20260101-000000-bad.zip"
    bad_zip.write_bytes(b"not a zip")
    lock(client, nid)

    assert scrub.sweep() is True

    assert MARK not in snap.read_text(encoding="utf-8")
    assert bad_json.read_bytes() == b"{ damaged " + MARK.encode()
    assert bad_zip.read_bytes() == b"not a zip"


def test_interrupted_writes_are_removed_at_start(np_backend, client):
    new_note(client, content=MARK)
    tmp = np_backend.DATA_DIR / "notes_data.json.tmp"
    tmp.write_bytes(np_backend.DATA_FILE.read_bytes())
    backups = np_backend.backups_dir()
    backups.mkdir(exist_ok=True)
    (backups / "notes_data-x.json.tmp").write_bytes(b"left over")
    (backups / "pre-import-x.zip.part").write_bytes(b"left over")
    np_backend.set_data_dir(np_backend.DATA_DIR)
    assert not tmp.exists()
    assert not list(backups.glob("*.tmp")) and not list(backups.glob("*.part"))


def test_a_temp_file_is_kept_when_it_may_be_all_that_is_left(np_backend, client):
    new_note(client, content="Poslední kopie")
    tmp = np_backend.DATA_DIR / "notes_data.json.tmp"
    tmp.write_bytes(np_backend.DATA_FILE.read_bytes())
    np_backend.DATA_FILE.unlink()
    np_backend.set_data_dir(np_backend.DATA_DIR)
    assert tmp.exists()


def test_the_log_stays_free_of_note_text(client, np_backend, caplog):
    caplog.set_level(logging.DEBUG, logger="noirpad")
    nid = new_note(client, content=MARK)
    snapshot(np_backend)
    bad = np_backend.DATA_DIR / "notes_data.corrupt-20260101-000000-000000.json"
    bad.write_text("{ " + MARK, encoding="utf-8")
    lock(client, nid)
    scrub.sweep()
    client.post("/api/tree/delete", json={"id": nid})
    client.post("/api/trash/empty")
    scrub.sweep()
    np_backend.DATA_FILE.write_text("{ " + MARK, encoding="utf-8")
    np_backend.read_data()
    assert caplog.text
    assert MARK not in caplog.text


# ---- retention ---------------------------------------------------------------


def _aged(path, days):
    path.write_bytes(b"{}")
    then = time.time() - days * DAY
    os.utime(path, (then, then))
    return path


def test_old_copies_stay_while_there_are_no_notes(client, np_backend):
    """After a reset to empty data, an old copy may be all that is left."""
    backups = np_backend.backups_dir()
    backups.mkdir(exist_ok=True)
    old_zip = _aged(backups / "pre-import-20260101-000000-000000.zip", 31)
    files = [_aged(np_backend.DATA_DIR / f"notes_data.corrupt-2026010{i}-000000-000000.json", 31)
             for i in range(1, 6)]
    scrub.sweep()
    assert old_zip.exists() and all(f.exists() for f in files)


def test_old_pre_import_zips_and_damaged_files_go_after_30_days(client, np_backend):
    new_note(client, content="Aktuální poznámka")
    backups = np_backend.backups_dir()
    backups.mkdir(exist_ok=True)
    old_zip = _aged(backups / "pre-import-20260101-000000-000000.zip", 31)
    new_zip = _aged(backups / "pre-import-20260201-000000-000000.zip", 29)
    old_bad = _aged(np_backend.DATA_DIR / "notes_data.corrupt-20260101-000000-000000.json", 31)
    new_bad = _aged(np_backend.DATA_DIR / "notes_data.corrupt-20260201-000000-000000.json", 29)
    scrub.sweep()
    assert not old_zip.exists() and not old_bad.exists()
    assert new_zip.exists() and new_bad.exists()


def test_a_file_set_aside_today_is_kept_despite_its_old_date(client, np_backend):
    """The user is told about this file at this very start. A data file last
    saved long ago must not be removed by the first pass a few seconds later."""
    new_note(client, content="Poznámka")
    np_backend.DATA_FILE.write_text("{ damaged", encoding="utf-8")
    then = time.time() - 60 * DAY
    os.utime(np_backend.DATA_FILE, (then, then))
    np_backend.read_data()
    corrupt = list(np_backend.DATA_DIR.glob("notes_data.corrupt-*.json"))
    assert len(corrupt) == 1
    scrub.sweep()
    assert corrupt[0].exists()


def test_at_most_three_damaged_files_stay(client, np_backend):
    new_note(client, content="Aktuální poznámka")
    files =[_aged(np_backend.DATA_DIR / f"notes_data.corrupt-2026010{i}-000000-000000.json", 1)
             for i in range(1, 6)]
    scrub.sweep()
    assert [f.exists() for f in files] == [False, False, True, True, True]


def test_snapshots_have_no_age_limit(client, np_backend):
    """The newest good snapshot is what recovers a damaged file, however old."""
    backups = np_backend.backups_dir()
    backups.mkdir(exist_ok=True)
    snap = _aged(backups / "notes_data-20260101-000000-000000.json", 400)
    scrub.sweep()
    assert snap.exists()


# ---- the background thread ---------------------------------------------------


@pytest.fixture
def background(monkeypatch):
    monkeypatch.setattr(scrub, "BACKGROUND", True)
    monkeypatch.setattr(scrub, "RETRY_DELAY", 0.05)   # polling can hold a file the pass replaces
    monkeypatch.setattr(scrub, "_retries", 0)
    yield
    scrub.stop(5)


def wait_until(condition, timeout=5.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            if condition():
                return True
        except OSError:     # Windows: a file the pass is writing right now
            pass
        time.sleep(0.01)
    return False


def test_the_start_does_not_wait_for_the_pass(np_backend, background, monkeypatch):
    started, release = threading.Event(), threading.Event()

    def slow_sweep():
        started.set()
        release.wait(30)

    monkeypatch.setattr(scrub, "sweep", slow_sweep)
    monkeypatch.setattr(scrub, "STARTUP_DELAY", 0.0)
    try:
        begin = time.monotonic()
        with TestClient(np_backend.app, base_url="http://127.0.0.1:8000",
                        headers=API_HEADERS) as c:
            assert started.wait(5)           # the pass is running and stuck …
            assert not release.is_set()
            nid = new_note(c, content="Uložení běží")    # … and saving works
            assert c.get(f"/api/note/{nid}").json()["content"] == "Uložení běží"
            assert time.monotonic() - begin < 5
            release_at_exit = time.monotonic()
        # closing waited for at most STOP_TIMEOUT, then left the stuck thread
        assert time.monotonic() - release_at_exit < scrub.STOP_TIMEOUT + 1
    finally:
        release.set()


def test_the_pass_at_start_runs_only_after_the_delay(np_backend, background, monkeypatch):
    calls = []
    monkeypatch.setattr(scrub, "sweep", lambda: calls.append(1))
    monkeypatch.setattr(scrub, "STARTUP_DELAY", 0.3)
    with TestClient(np_backend.app, base_url="http://127.0.0.1:8000", headers=API_HEADERS):
        assert calls == []                   # the server is up, nothing has run
        assert wait_until(lambda: calls)


def test_closing_cancels_a_pass_that_has_not_started(np_backend, background, monkeypatch):
    calls = []
    monkeypatch.setattr(scrub, "sweep", lambda: calls.append(1))
    monkeypatch.setattr(scrub, "STARTUP_DELAY", 60.0)
    begin = time.monotonic()
    with TestClient(np_backend.app, base_url="http://127.0.0.1:8000", headers=API_HEADERS):
        pass
    assert time.monotonic() - begin < 2
    assert calls == []


def test_a_pass_in_progress_does_not_block_saving(client, np_backend, monkeypatch):
    """sweep() holds only its own lock while it works through the copies."""
    nid = new_note(client, content="Před")
    snapshot(np_backend)
    entered, release = threading.Event(), threading.Event()
    real = scrub._clean_json_file

    def stuck(path, *plan):
        entered.set()
        release.wait(30)
        real(path, *plan)

    monkeypatch.setattr(scrub, "_clean_json_file", stuck)
    worker = threading.Thread(target=scrub.sweep)
    worker.start()
    try:
        assert entered.wait(5)
        begin = time.monotonic()
        r = client.put(f"/api/note/{nid}", json={"content": "Po", "formats": []})
        assert r.status_code == 200
        assert time.monotonic() - begin < 5
    finally:
        release.set()
        worker.join(10)


def test_locking_starts_a_pass_without_waiting_for_it(client, np_backend, background):
    nid = new_note(client, content=MARK)
    snapshot(np_backend)
    lock(client, nid)
    assert wait_until(lambda: all_bytes_with(np_backend) == [])


def test_locking_right_before_closing_is_cleaned_before_the_app_ends(np_backend, background):
    with TestClient(np_backend.app, base_url="http://127.0.0.1:8000", headers=API_HEADERS) as c:
        nid = new_note(c, content=MARK)
        snapshot(np_backend)
        lock(c, nid)
    assert all_bytes_with(np_backend) == []


def test_a_failed_pass_is_repeated_a_few_times(np_backend, background, monkeypatch):
    calls = []

    def fails():
        calls.append(1)
        return False

    monkeypatch.setattr(scrub, "sweep", fails)
    scrub.request_sweep()
    assert wait_until(lambda: len(calls) == 1 + scrub.MAX_RETRIES)
    time.sleep(0.2)
    assert len(calls) == 4                # … and then waits for the next start


def test_the_retry_limits_are_60_seconds_and_3_times():
    assert (scrub.RETRY_DELAY, scrub.MAX_RETRIES) == (60.0, 3)


def test_a_pass_that_stopped_on_an_error_is_repeated_too(np_backend, background, monkeypatch):
    """E.g. its last write, with a virus scanner holding notes_data.json open."""
    calls = []

    def fails_once():
        calls.append(1)
        if len(calls) == 1:
            raise OSError(13, "Permission denied")
        return True

    monkeypatch.setattr(scrub, "sweep", fails_once)
    scrub.request_sweep()
    assert wait_until(lambda: len(calls) == 2)


def test_a_pass_that_worked_is_not_repeated(np_backend, background, monkeypatch):
    calls = []
    monkeypatch.setattr(scrub, "sweep", lambda: calls.append(1) or True)
    scrub.request_sweep()
    assert wait_until(lambda: calls)
    time.sleep(0.1)
    assert len(calls) == 1


def test_deleting_for_good_starts_a_pass(client, np_backend, background):
    nid = new_note(client, content=MARK)
    snapshot(np_backend)
    client.post("/api/tree/delete", json={"id": nid})
    client.post("/api/trash/empty")
    assert wait_until(lambda: all_bytes_with(np_backend) == [])
    assert wait_until(lambda: "scrub_pending" not in np_backend.read_data())


def test_a_request_during_a_pass_gets_its_own_pass(np_backend, background, monkeypatch):
    calls, entered, release = [], threading.Event(), threading.Event()

    def sweep():
        calls.append(1)
        entered.set()
        release.wait(5)

    monkeypatch.setattr(scrub, "sweep", sweep)
    scrub.request_sweep()
    assert entered.wait(5)
    scrub.request_sweep()
    release.set()
    assert wait_until(lambda: len(calls) == 2)
