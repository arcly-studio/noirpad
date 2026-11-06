"""Step C: the API returns error codes (the frontend writes the text) and
the UI language setting."""

import json
import re
from pathlib import Path

import pytest

from conftest import ROOT, new_note

LOCALES = ROOT / "static" / "locales"


def test_errors_are_codes(client):
    r = client.get("/api/note/nope")
    assert r.status_code == 404
    assert r.json() == {"detail": {"code": "note_not_found"}}


def test_error_params(client):
    nid = new_note(client)
    r = client.post("/api/encrypt", json={"id": nid, "password": "abc"})
    assert r.json()["detail"] == {"code": "password_too_short", "params": {"min": 4}}


def test_guard_errors_are_codes(client):
    r = client.get("/api/data", headers={"host": "evil.example"})
    assert r.json() == {"detail": {"code": "invalid_host"}}


def test_every_backend_code_is_translated():
    errors, notices = set(), set()
    for path in (ROOT / "noirpad").rglob("*.py"):
        src = path.read_text(encoding="utf-8")
        errors |= set(re.findall(r'ApiError\(\d+, "([a-z_]+)"', src))
        errors |= set(re.findall(r'_deny\(\d+, "([a-z_]+)"\)', src))
        notices |= set(re.findall(r'data_notice = \{"code": "([a-z_]+)"', src))
    assert len(errors) > 20 and notices == {"data_restored", "data_reset"}
    for lang in ("en", "cs"):
        locale = json.loads((LOCALES / f"{lang}.json").read_text(encoding="utf-8"))
        missing = sorted({f"errors.{c}" for c in errors if c not in locale["errors"]}
                         | {f"notice.{c}" for c in notices if c not in locale["notice"]})
        assert not missing, f"{lang}.json: {missing}"


def test_install_language_is_the_default_until_one_is_picked(client, np_backend):
    """N7: the setup wizard's language replaces "auto" only; a language
    picked in Settings always wins."""
    assert client.get("/api/session").json()["install_language"] is None
    (np_backend.DATA_DIR / "install-language.txt").write_text("cs", encoding="ascii")
    session = client.get("/api/session").json()
    assert (session["language"], session["install_language"]) == ("auto", "cs")
    client.put("/api/settings", json={"language": "en"})
    session = client.get("/api/session").json()
    assert (session["language"], session["install_language"]) == ("en", "cs")
    (np_backend.DATA_DIR / "install-language.txt").write_text("xx\n", encoding="ascii")
    assert client.get("/api/session").json()["install_language"] is None


def test_language_setting(client):
    assert client.get("/api/session").json()["language"] == "auto"
    assert client.put("/api/settings", json={"language": "cs"}).status_code == 200
    assert client.get("/api/session").json()["language"] == "cs"
    assert client.put("/api/settings", json={"language": "de"}).status_code == 422


# N12: the zoom of the desktop window stays in its range.
@pytest.mark.parametrize("value,status", [(70, 200), (200, 200), (69, 422), (201, 422), ("x", 422)])
def test_ui_zoom_range(client, np_backend, value, status):
    assert client.put("/api/settings", json={"ui_zoom": value}).status_code == status
    if status == 200:
        assert np_backend.read_data()["ui_zoom"] == value
