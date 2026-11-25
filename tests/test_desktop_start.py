"""1.1.0 finding 6: a start never hangs on "Loading", a start while the
previous NoirPad is still closing waits for it and then starts, at most one
error box per data folder, and the release build never opens a WebView2
debugging port."""

import getpass
import logging
import os
import re
import subprocess
import sys
import threading
import time
import types
from pathlib import Path

import pytest

import desktop
from noirpad import config, logs
from noirpad.runtime import RUNTIME

ROOT = Path(__file__).resolve().parent.parent
WIN = pytest.mark.skipif(sys.platform != "win32", reason="Windows mutexes")


@pytest.fixture
def desk(np_backend, monkeypatch):
    """desktop.main() against the per-test data dir, message boxes captured."""
    monkeypatch.setenv("NOIRPAD_DATA_DIR", str(np_backend.DATA_DIR))
    boxes = []
    monkeypatch.setattr(desktop, "_message_box", lambda text, flags: boxes.append(text) or 0)
    root = logging.getLogger()
    before = list(root.handlers)
    yield boxes
    for handler in root.handlers[:]:
        if handler not in before:
            root.removeHandler(handler)
            handler.close()


def log_text(np_backend):
    for h in logging.getLogger().handlers:
        h.flush()
    path = logs.log_path(np_backend.DATA_DIR)
    return path.read_text(encoding="utf-8") if path.exists() else ""


# ---- the zoom reset: the deadlock behind "Loading" forever -----------------

class _UiForm:
    """pywebview's form: its WebView2 control may be touched on the UI thread only."""

    def __init__(self, zoom):
        self.on_ui_thread = False
        self._control = types.SimpleNamespace(ZoomFactor=zoom)

    @property
    def webview(self):
        if not self.on_ui_thread:
            raise AssertionError("WebView2 control touched off the UI thread")
        return self._control


def test_zoom_reset_touches_the_control_only_on_the_ui_thread_and_never_waits():
    form = _UiForm(1.5)
    posted = []
    desktop._reset_webview_zoom(types.SimpleNamespace(native=form), post=posted.append)
    assert len(posted) == 1                          # handed to the UI thread ...
    assert form._control.ZoomFactor == 1.5           # ... and not waited for
    form.on_ui_thread = True
    posted[0]()
    assert form._control.ZoomFactor == 1.0


def test_zoom_reset_is_posted_with_begin_invoke():
    src = (ROOT / "desktop.py").read_text(encoding="utf-8")
    body = src.split("def _reset_webview_zoom", 1)[1].split("\ndef ", 1)[0]
    assert "form.BeginInvoke(Action(fn))" in body
    assert ".Invoke(" not in body.replace("BeginInvoke(", "")


# ---- a start while another NoirPad holds the data folder -------------------

def _hold_lock_elsewhere(data_dir: Path, seconds: float) -> subprocess.Popen:
    """Another process (a NoirPad that is closing) holds the data lock."""
    code = ("import sys, time, pathlib; sys.path.insert(0, sys.argv[1]); "
            "from noirpad import storage; "
            "h = storage.acquire_instance_lock(pathlib.Path(sys.argv[2])); "
            "print('held' if h else 'busy', flush=True); time.sleep(float(sys.argv[3]))")
    env = {**os.environ, "NOIRPAD_DATA_DIR": str(data_dir)}
    proc = subprocess.Popen([sys.executable, "-c", code, str(ROOT), str(data_dir), str(seconds)],
                            stdout=subprocess.PIPE, text=True, env=env)
    assert proc.stdout.readline().strip() == "held"
    return proc


def test_restart_while_the_previous_is_closing_waits_and_starts(desk, np_backend, monkeypatch):
    """The rapid restart: closed with X, started again while the old process
    still holds the folder. It must start once the old one is gone, not end
    quietly (before: nothing happened at all)."""
    served = []
    monkeypatch.setattr(desktop, "_find_app_window", lambda data_dir: 0)
    monkeypatch.setattr(desktop, "_serve", lambda lang, smoke, starting=None: served.append(lang) or 0)
    old = _hold_lock_elsewhere(np_backend.DATA_DIR, 1.5)
    try:
        started = time.monotonic()
        assert desktop.main([]) == 0
        took = time.monotonic() - started
    finally:
        old.wait(10)
    assert len(served) == 1, log_text(np_backend)
    assert 1.0 < took < 10
    assert desk == []
    assert "The other NoirPad has closed; starting" in log_text(np_backend)


def test_a_running_window_is_brought_to_front_and_nothing_starts(desk, np_backend, monkeypatch):
    served, fronted = [], []
    monkeypatch.setattr(desktop, "_find_app_window", lambda data_dir: 4242)
    monkeypatch.setattr(desktop, "_bring_to_front", fronted.append)
    monkeypatch.setattr(desktop, "FOCUS_GRACE_SECONDS", 0.2)
    monkeypatch.setattr(desktop, "_serve", lambda *a, **k: served.append(1) or 0)
    held = np_backend.acquire_instance_lock()
    try:
        assert desktop.main([]) == 0
    finally:
        held.close()
    assert fronted == [4242] and served == [] and desk == []


@WIN
def test_no_second_box_while_the_first_is_still_starting(desk, np_backend, monkeypatch):
    monkeypatch.setattr(desktop, "_find_app_window", lambda data_dir: 0)
    monkeypatch.setattr(desktop, "LOCK_WAIT_SECONDS", 0.4)
    held = np_backend.acquire_instance_lock()
    starting = desktop._hold_mutex("Starting", np_backend.DATA_DIR)
    try:
        assert desktop.main([]) == 0
    finally:
        desktop._release_mutex(starting)
        held.close()
    assert desk == []
    assert "still starting or shows an error" in log_text(np_backend)


@WIN
def test_no_second_box_while_the_first_shows_one(desk, np_backend, monkeypatch):
    monkeypatch.setattr(desktop, "_find_app_window", lambda data_dir: 0)
    monkeypatch.setattr(desktop, "LOCK_WAIT_SECONDS", 0.4)
    held = np_backend.acquire_instance_lock()
    box = desktop._hold_mutex("ErrorBox", np_backend.DATA_DIR)
    try:
        assert desktop.main([]) == 0
    finally:
        desktop._release_mutex(box)
        held.close()
    assert desk == []


def test_folder_held_without_a_window_says_already_running_once(desk, np_backend, monkeypatch):
    """E.g. the web version in a terminal: one box after the wait."""
    monkeypatch.setattr(desktop, "_find_app_window", lambda data_dir: 0)
    monkeypatch.setattr(desktop, "LOCK_WAIT_SECONDS", 0.4)
    held = np_backend.acquire_instance_lock()
    try:
        assert desktop.main([]) == 0
    finally:
        held.close()
    assert len(desk) == 1 and desk[0] in {m["running"] for m in desktop.MESSAGES.values()}


@WIN
def test_any_error_box_is_shown_once_per_data_folder(desk, np_backend, monkeypatch):
    """Another NoirPad on the same folder already shows an error: this one
    only logs (here: WebView2 missing)."""
    monkeypatch.setattr(desktop, "_webview2_version", lambda: None)
    other = desktop._hold_mutex("ErrorBox", np_backend.DATA_DIR)
    try:
        assert desktop.main([]) == 2
    finally:
        desktop._release_mutex(other)
    assert desk == []
    assert "no second message box" in log_text(np_backend)
    # and without the other one, the box is there again
    assert desktop.main([]) == 2
    assert len(desk) == 1


# ---- the start watch: never "Loading" forever -------------------------------

def _watch(np_backend, *, ready_after=None, loaded=True, closed_after=None, lang="en", on_box=None):
    page_ready, page_loaded, closed = threading.Event(), threading.Event(), threading.Event()
    if loaded:
        page_loaded.set()
    if ready_after is not None:
        threading.Timer(ready_after, page_ready.set).start()
    if closed_after is not None:
        threading.Timer(closed_after, closed.set).start()
    exits = []
    t = desktop._watch_start(page_ready, page_loaded, np_backend.DATA_DIR, lang,
                             timeout=0.4, exit_fn=exits.append, closed=closed)
    t.join(5)
    return exits


def test_page_never_ready_one_box_cause_in_the_log_and_the_process_ends(desk, np_backend, monkeypatch):
    logs.setup_logging(np_backend.DATA_DIR)
    exits = _watch(np_backend, lang="cs")
    assert exits == [1]
    assert len(desk) == 1 and desk[0].startswith("NoirPad se nepodařilo dokončit spuštění")
    assert str(logs.log_path(np_backend.DATA_DIR)) in desk[0]
    text = log_text(np_backend)
    assert "Start did not finish within" in text
    assert "the page loaded, but the app in it did not finish starting" in text
    assert "Threads at that moment" in text and "noirpad-start-watch" in text
    assert getpass.getuser() not in text                 # the log never names the user
    assert str(Path.home()) not in text


def test_page_that_never_loaded_is_named_as_such(desk, np_backend):
    logs.setup_logging(np_backend.DATA_DIR)
    _watch(np_backend, loaded=False)
    assert "the window did not load the page" in log_text(np_backend)


def test_page_ready_in_time_no_box(desk, np_backend):
    logs.setup_logging(np_backend.DATA_DIR)
    assert _watch(np_backend, ready_after=0.05) == []
    assert desk == [] and "Page ready after" in log_text(np_backend)


def test_window_closed_while_starting_no_box(desk, np_backend):
    assert _watch(np_backend, closed_after=0.05) == []
    assert desk == []


def test_page_ready_while_the_box_is_open_keeps_running(desk, np_backend, monkeypatch):
    holder = {}

    def box(text, flags):
        holder["ready"].set()
        return 0

    monkeypatch.setattr(desktop, "_message_box", box)
    page_ready, page_loaded = threading.Event(), threading.Event()
    holder["ready"] = page_ready
    exits = []
    desktop._watch_start(page_ready, page_loaded, np_backend.DATA_DIR, "en",
                         timeout=0.2, exit_fn=exits.append).join(5)
    assert exits == []


def test_a_previous_hang_goes_into_the_log_anonymized_and_its_file_away(desk, np_backend, monkeypatch):
    monkeypatch.setattr(desktop, "_webview2_version", lambda: None)
    hang = np_backend.DATA_DIR / desktop.HANG_FILE
    hang.write_text(f'Thread 0x1 (most recent call first):\n  File "{Path.home()}\\NoirPad\\x.py", line 1\n',
                    encoding="utf-8")
    desktop.main([])
    text = log_text(np_backend)
    assert "The previous start hung and was ended" in text and "x.py" in text
    assert str(Path.home()) not in text
    assert not hang.exists()


def test_an_empty_hang_file_is_not_a_hang(desk, np_backend, monkeypatch):
    monkeypatch.setattr(desktop, "_webview2_version", lambda: None)
    (np_backend.DATA_DIR / desktop.HANG_FILE).write_text("", encoding="utf-8")
    desktop.main([])
    assert "previous start hung" not in log_text(np_backend)


def test_the_page_reports_ready(client):
    RUNTIME.page_ready.clear()
    r = client.post("/api/session/ready")
    assert r.status_code == 200 and RUNTIME.page_ready.is_set()


def test_the_backstop_ends_a_hang_that_blocks_python_itself():
    src = (ROOT / "desktop.py").read_text(encoding="utf-8")
    assert "faulthandler.dump_traceback_later(STARTUP_BACKSTOP, repeat=False, file=hang, exit=True)" in src
    assert desktop.STARTUP_TIMEOUT == 15.0 and desktop.STARTUP_BACKSTOP > desktop.STARTUP_TIMEOUT


def test_start_messages_exist_in_both_languages():
    for lang in ("en", "cs"):
        assert "{log}" in desktop.MESSAGES[lang]["start_timeout"]
    assert set(desktop.MESSAGES["en"]) == set(desktop.MESSAGES["cs"])


# ---- the release build never opens a WebView2 debugging port ---------------

RELEASE_FILES = ["desktop.py", "noirpad.spec", "installer.iss", "build.ps1", "build-msix.ps1",
                 "tools/msix_manifest.py", "tools/smoke_test.ps1", "tools/test-cert.ps1"]
DEBUG_PATTERNS = [
    r"remote-debugging",
    r"WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
    r"AdditionalBrowserArguments",
    r"REMOTE_DEBUGGING_PORT\"\]\s*=(?!\s*None)",
    r"\bdebug\s*=\s*True",
    r"AreDevToolsEnabled",
]


def _release_sources():
    files = [ROOT / f for f in RELEASE_FILES]
    files += sorted((ROOT / "noirpad").rglob("*.py"))
    files += sorted(p for p in (ROOT / "store").rglob("*") if p.is_file() and p.suffix in (".xml", ".ps1", ".py", ".json"))
    return [f for f in files if f.exists()]


def test_release_sources_never_enable_remote_debugging():
    hits = []
    for f in _release_sources():
        text = f.read_text(encoding="utf-8", errors="replace")
        for pat in DEBUG_PATTERNS:
            for m in re.finditer(pat, text):
                hits.append(f"{f.relative_to(ROOT)}: {m.group(0)}")
    assert hits == []


def test_the_screenshot_tool_with_its_debug_port_is_not_bundled():
    spec = (ROOT / "noirpad.spec").read_text(encoding="utf-8")
    assert "take_screenshots" not in spec


class _Handlers(list):
    def __iadd__(self, fn):
        self.append(fn)
        return self


def _fake_webview(seen):
    def start(**kw):
        seen["env"] = dict(os.environ)
        seen["start"] = kw
        seen["settings"] = dict(fake.settings)

    fake = types.SimpleNamespace(
        settings={"REMOTE_DEBUGGING_PORT": 9555},
        create_window=lambda *a, **kw: types.SimpleNamespace(
            events=types.SimpleNamespace(closing=_Handlers(), loaded=_Handlers()), toggle_fullscreen=lambda: None),
        start=start,
    )
    return fake


def test_built_exe_drops_webview2_overrides_from_the_environment(desk, np_backend, monkeypatch, tmp_path):
    logs.setup_logging(np_backend.DATA_DIR)
    seen = {}
    monkeypatch.setitem(sys.modules, "webview", _fake_webview(seen))
    monkeypatch.setattr(config, "is_frozen", lambda: True)
    monkeypatch.setenv("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "--remote-debugging-port=9555")
    monkeypatch.setenv("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER", str(tmp_path))
    desktop._show_window(1234, "tok", tmp_path)
    assert not [k for k in seen["env"] if k.upper().startswith("WEBVIEW2_")]
    assert seen["settings"]["REMOTE_DEBUGGING_PORT"] is None
    assert seen["start"]["debug"] is False
    text = log_text(np_backend)
    assert "Ignoring WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS" in text
    assert "9555" not in text                             # the value is never logged


def test_dev_run_keeps_them_for_the_screenshot_tool(desk, np_backend, monkeypatch, tmp_path):
    seen = {}
    monkeypatch.setitem(sys.modules, "webview", _fake_webview(seen))
    monkeypatch.setattr(config, "is_frozen", lambda: False)
    monkeypatch.setenv("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "--remote-debugging-port=9555")
    desktop._show_window(1234, "tok", tmp_path)
    assert seen["env"]["WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"] == "--remote-debugging-port=9555"
    assert seen["settings"]["REMOTE_DEBUGGING_PORT"] is None
