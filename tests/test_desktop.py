"""Step E: desktop start-up never fails silently (log file + message box)."""

import json
import logging
import os
import subprocess
import sys
import threading
import time
import types
from logging.handlers import RotatingFileHandler
from pathlib import Path

import pytest
import uvicorn

import desktop
from noirpad import app as noirpad_app, logs
from noirpad.runtime_imports import RUNTIME_IMPORTS, UVICORN_OPTIONS

ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture
def desk(np_backend, monkeypatch):
    """desktop.main() against the per-test data dir, with message boxes captured."""
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
    return logs.log_path(np_backend.DATA_DIR).read_text(encoding="utf-8")


def test_missing_webview2_explains_and_points_to_log(desk, np_backend, monkeypatch):
    monkeypatch.setattr(desktop, "_webview2_version", lambda: None)
    assert desktop.main() == 2
    assert len(desk) == 1 and "WebView2" in desk[0]
    assert str(logs.log_path(np_backend.DATA_DIR)) in desk[0]
    text = log_text(np_backend)
    assert f"NoirPad {desktop.__version__} starting" in text and "WebView2 runtime: MISSING" in text


def test_crash_at_start_is_logged_and_shown(desk, np_backend, monkeypatch):
    def boom(*_args):
        raise RuntimeError("boom")

    monkeypatch.setattr(desktop, "_run", boom)
    assert desktop.main() == 1
    assert "boom" in desk[0] and "noirpad.log" in desk[0]
    assert "Traceback" in log_text(np_backend)


def test_second_instance_focuses_the_first(desk, np_backend, monkeypatch):
    focused = []
    monkeypatch.setattr(desktop, "_focus_running_instance", lambda lang, data_dir: focused.append(lang))
    held = np_backend.acquire_instance_lock()
    try:
        assert desktop.main() == 0
    finally:
        held.close()
    assert focused == ["en"] or focused == ["cs"]


def test_czech_messages_follow_the_language_setting(desk, client, np_backend, monkeypatch):
    client.put("/api/settings", json={"language": "cs"})
    monkeypatch.setattr(desktop, "_webview2_version", lambda: None)
    desktop.main()
    assert "není nainstalovaný" in desk[0]


def test_message_boxes_use_the_install_language_until_one_is_picked(desk, client, np_backend, monkeypatch):
    (np_backend.DATA_DIR / "install-language.txt").write_text("cs", encoding="ascii")
    assert desktop._language(np_backend.DATA_DIR) == "cs"
    client.put("/api/settings", json={"language": "en"})
    assert desktop._language(np_backend.DATA_DIR) == "en"


def test_log_rotates_and_never_contains_note_content(desk, client, np_backend, monkeypatch):
    monkeypatch.setattr(desktop, "_webview2_version", lambda: None)
    desktop.main()
    handler = next(h for h in logging.getLogger().handlers if isinstance(h, RotatingFileHandler))
    assert handler.maxBytes == 1024 * 1024 and handler.backupCount == 3

    secret = "TAJNY-OBSAH-123"
    r = client.post("/api/tree/new-note", json={"name": secret})
    client.put(f"/api/note/{r.json()['id']}", json={"content": secret})
    client.post("/api/encrypt", json={"id": r.json()["id"], "password": secret})
    logging.getLogger("noirpad").error("an error without user data")
    assert secret not in log_text(np_backend)


# ---- 1.0.0 regression: the installed app died on `import websockets.legacy` --


def _uvicorn_config():
    """The uvicorn.Config desktop.py runs, unloaded."""
    return desktop._ServerHandle(noirpad_app.app, 0).server.config


def test_uvicorn_config_imports_no_optional_packages(monkeypatch):
    # A half-present websockets (importable, without .legacy) is what the
    # 1.0.0 bundle had; uvicorn's ws="auto" then crashed at start-up.
    monkeypatch.setitem(sys.modules, "websockets", types.ModuleType("websockets"))
    for name in ("wsproto", "httptools", "uvloop"):
        monkeypatch.setitem(sys.modules, name, None)
    for name in [n for n in sys.modules if n.startswith("uvicorn.protocols.websockets")]:
        monkeypatch.delitem(sys.modules, name)

    config_ = _uvicorn_config()
    config_.load()

    assert config_.ws_protocol_class is None
    assert config_.http_protocol_class.__module__ == "uvicorn.protocols.http.h11_impl"
    assert not [n for n in sys.modules if n.startswith("uvicorn.protocols.websockets")]


def test_runtime_imports_cover_what_uvicorn_loads_by_name():
    """Every implementation our uvicorn options select is in the list the
    spec bundles and `NoirPad.exe --smoke-test` imports."""
    from uvicorn import config as uc

    picked = [uc.HTTP_PROTOCOLS[UVICORN_OPTIONS["http"]],
              uc.LIFESPAN[UVICORN_OPTIONS["lifespan"]],
              uc.LOOP_FACTORIES[UVICORN_OPTIONS["loop"]]]
    assert UVICORN_OPTIONS["ws"] == "none"
    for target in picked:
        assert target.split(":")[0] in RUNTIME_IMPORTS


def test_runtime_imports_are_importable():
    assert desktop._missing_runtime_imports() == []


def test_spec_bundles_the_runtime_imports():
    spec = (ROOT / "noirpad.spec").read_text(encoding="utf-8")
    assert '_imports["RUNTIME_IMPORTS"]' in spec and '_imports["WINDOWS_IMPORTS"]' in spec


# ---- a crashing server: one message, at once, data lock released -----------


def test_server_crash_fails_fast_with_one_message(desk, np_backend, monkeypatch):
    def crash(_self, *args, **kwargs):
        raise ModuleNotFoundError("No module named 'websockets.legacy'")

    monkeypatch.setattr(desktop, "_webview2_version", lambda: "test")
    monkeypatch.setattr(uvicorn.Server, "run", crash)
    started = time.monotonic()
    assert desktop.main() == 1
    assert time.monotonic() - started < 5          # not the old 10 s timeout
    no_server = {m["no_server"].split("\n")[0] for m in desktop.MESSAGES.values()}
    assert len(desk) == 1 and desk[0].split("\n")[0] in no_server
    assert "Local server crashed" in log_text(np_backend)
    held = np_backend.acquire_instance_lock()      # lock released before the box
    assert held is not None
    held.close()


def test_second_instance_takes_over_when_first_exits(desk, np_backend, monkeypatch):
    """1.1.0 (finding 6): the first one closing or giving up is no reason to
    stay quiet any more; the second starts (test_desktop_start.py)."""
    monkeypatch.setattr(desktop, "_find_app_window", lambda data_dir: 0)
    held = np_backend.acquire_instance_lock()
    threading.Timer(0.5, held.close).start()       # the first NoirPad exits
    lock = desktop._focus_running_instance("en", np_backend.DATA_DIR)
    assert lock is not None and desk == []
    lock.close()


def test_second_instance_explains_when_no_window_appears(desk, np_backend, monkeypatch):
    monkeypatch.setattr(desktop, "_find_app_window", lambda data_dir: 0)
    monkeypatch.setattr(desktop, "LOCK_WAIT_SECONDS", 0.3)
    held = np_backend.acquire_instance_lock()
    try:
        assert desktop._focus_running_instance("en", np_backend.DATA_DIR) is None
    finally:
        held.close()
    assert len(desk) == 1 and "already running" in desk[0]


# ---- --smoke-test: what build.ps1 runs against the built NoirPad.exe --------


def test_smoke_test_mode_serves_api_version_and_stops(tmp_path):
    import httpx

    env = {**os.environ, "NOIRPAD_DATA_DIR": str(tmp_path)}
    proc = subprocess.Popen([sys.executable, str(ROOT / "desktop.py"), desktop.SMOKE_FLAG],
                            env=env, cwd=ROOT)
    info = tmp_path / desktop.SMOKE_FILE
    try:
        deadline = time.monotonic() + 30
        while not info.exists() and proc.poll() is None and time.monotonic() < deadline:
            time.sleep(0.1)
        assert info.exists(), (tmp_path / "logs" / "noirpad.log").read_text(encoding="utf-8")
        smoke = json.loads(info.read_text(encoding="utf-8"))
        url = f"http://127.0.0.1:{smoke['port']}/api/version"
        assert httpx.get(url).status_code == 403                       # token still required
        r = httpx.get(url, headers={"X-NoirPad-Token": smoke["token"]})
        assert r.status_code == 200 and r.json()["version"] == smoke["version"]
        info.unlink()
        assert proc.wait(timeout=15) == 0
    finally:
        if proc.poll() is None:
            proc.kill()


def test_installer_removes_the_previous_build_first():
    r"""Leftover packages from an older build in {app}\_internal shadowed
    missing modules (stale websockets 16 → "No module named
    'websockets.legacy'"), so an upgrade starts from an empty _internal."""
    iss = (ROOT / "installer.iss").read_text(encoding="utf-8")
    section = iss.split("[InstallDelete]", 1)[1].split("\n[", 1)[0]
    assert r'Type: filesandordirs; Name: "{app}\_internal"' in section


@pytest.mark.skipif(sys.platform != "win32", reason="Windows mutex")
def test_installer_mutex_stays_held_until_the_process_ends(desk, np_backend, monkeypatch):
    """B8: releasing AppMutex when the window closed let the uninstaller
    start while NoirPad.exe was still shutting down and locking its files."""
    import ctypes
    monkeypatch.setattr(desktop, "_webview2_version", lambda: None)
    assert desktop.main([]) == 2
    handle = ctypes.windll.kernel32.OpenMutexW(0x00100000, False, desktop.APP_MUTEX)  # SYNCHRONIZE
    assert handle, "AppMutex was released before the process ended"
    ctypes.windll.kernel32.CloseHandle(handle)


class _Handlers(list):
    """Stand-in for a pywebview event: supports `+=`."""

    def __iadd__(self, fn):
        self.append(fn)
        return self


def test_webview_profile_lives_in_the_data_dir(tmp_path, monkeypatch):
    """B8: nothing NoirPad writes at run time may land in the install dir."""
    calls = {}
    fake = types.SimpleNamespace(
        settings={},
        create_window=lambda *a, **kw: types.SimpleNamespace(
            events=types.SimpleNamespace(closing=_Handlers(), loaded=_Handlers()), toggle_fullscreen=lambda: None),
        start=lambda **kw: calls.update(kw),
    )
    monkeypatch.setitem(sys.modules, "webview", fake)
    desktop._show_window(1234, "tok", tmp_path)
    assert Path(calls["storage_path"]) == tmp_path / "webview"
    assert calls["private_mode"] is False
    assert Path(calls["icon"]).read_bytes() == (ROOT / "noirpad.ico").read_bytes()   # N1.11: green window icon


def _installer_section(name):
    iss = (ROOT / "installer.iss").read_text(encoding="utf-8-sig")
    return iss.split(f"[{name}]", 1)[1].split("\n[", 1)[0]


def test_uninstaller_removes_the_whole_install_dir():
    """B8: the uninstall left NoirPad.exe, python314.dll, … behind."""
    section = _installer_section("UninstallDelete")
    assert 'Type: filesandordirs; Name: "{app}"' in section
    entries = [line for line in section.splitlines() if line.startswith("Type:")]
    assert not any("localappdata" in line.lower() for line in entries)   # notes: only on "Yes"


def test_installer_closes_noirpad_processes_first():
    code = _installer_section("Code")
    assert "function InitializeUninstall(): Boolean;" in code
    assert "Result := CloseAppProcesses(UninstallSilent());" in code
    assert "function PrepareToInstall(" in code
    # Only NoirPad.exe started from {app} is ever closed; WebView2 is only waited for.
    assert "StartsWithText(VarText(Item.ExecutablePath), AppDir)" in code
    assert "KillProcesses(AppProcessIds()" in code
    assert "KillProcesses(MatchingProcessIds(True)" not in code
    # The data folder is deleted only on the user's answer (test_uninstall_data.py).
    assert code.count("DelTree(") == 1


def test_installer_refuses_a_foreign_non_empty_folder():
    """Review of B8: [UninstallDelete] {app} must never wipe a folder that
    already holds other files (only reachable with /DIR= now)."""
    code = _installer_section("Code")
    assert "function UnsafeInstallDir(const Dir: String): Boolean;" in code
    assert "if UnsafeInstallDir(ExpandConstant('{app}')) then" in code


def test_installer_always_uses_the_fixed_folder():
    """Manual test point 9: no folder page, always %LOCALAPPDATA%/Programs/NoirPad."""
    setup = _installer_section("Setup")
    assert r"DefaultDirName={localappdata}\Programs\{#AppName}" in setup
    assert "DisableDirPage=yes" in setup
    assert "UsePreviousAppDir=no" in setup


def test_k5_closing_the_window_saves_first():
    """K5: the first close request is cancelled, the page saves the open
    note (no 64 kB keepalive limit), then the window closes for real."""
    calls = []

    class Handlers(list):
        def __iadd__(self, fn):
            self.append(fn)
            return self

    class FakeWindow:
        def __init__(self):
            self.events = types.SimpleNamespace(closing=Handlers())

        def evaluate_js(self, script, callback=None):
            calls.append(script)
            callback("saved")

        def destroy(self):
            calls.append("destroy")
            # destroy() fires `closing` again; this time it must go through
            assert all(h() is not False for h in self.events.closing)

    win = FakeWindow()
    desktop._save_before_close(win)
    [handler] = win.events.closing
    assert handler() is False                       # first close: cancelled
    deadline = time.time() + 5
    while "destroy" not in calls and time.time() < deadline:
        time.sleep(0.02)
    assert "flushForClose()" in calls[0]
    assert calls[-1] == "destroy"


class _ClosingPage:
    """A window whose page answers flushForClose with *answer* after
    *delay* s, and reports `_closeBusy` = *busy* meanwhile."""

    class Handlers(list):
        def __iadd__(self, fn):
            self.append(fn)
            return self

    def __init__(self, answer, delay=0.0, busy=None):
        self.events = types.SimpleNamespace(closing=self.Handlers())
        self.answer, self.delay, self.busy = answer, delay, busy
        self.destroyed = threading.Event()
        self.asked = 0

    def evaluate_js(self, script, callback=None):
        if callback is None:            # the _closeBusy question
            return self.busy
        self.asked += 1
        threading.Timer(self.delay, callback, [self.answer]).start()

    def destroy(self):
        self.destroyed.set()
        assert all(h() is not False for h in self.events.closing)


def _close(page):
    desktop._save_before_close(page)
    [handler] = page.events.closing
    assert handler() is False
    return handler


def test_r2_failed_save_and_user_stays_keeps_the_window():
    page = _ClosingPage("stay")
    handler = _close(page)
    assert not page.destroyed.wait(0.5)
    # the next close asks the page again
    page.answer = "close"
    assert handler() is False
    assert page.destroyed.wait(2)
    assert page.asked == 2


def test_r2_window_waits_while_the_page_is_still_busy(monkeypatch):
    monkeypatch.setattr(desktop, "CLOSE_SAVE_TIMEOUT", 0.1)
    page = _ClosingPage("close", delay=0.8, busy="asking")   # the question is on screen
    _close(page)
    assert not page.destroyed.wait(0.5)       # well past CLOSE_SAVE_TIMEOUT
    assert page.destroyed.wait(2)


def test_r2_a_page_that_is_not_busy_does_not_block_closing(monkeypatch):
    monkeypatch.setattr(desktop, "CLOSE_SAVE_TIMEOUT", 0.1)
    page = _ClosingPage("close", delay=30, busy=None)        # hung, says nothing
    _close(page)
    assert page.destroyed.wait(2)


def test_r2_a_slow_save_has_a_limit(monkeypatch):
    monkeypatch.setattr(desktop, "CLOSE_SAVE_TIMEOUT", 0.1)
    monkeypatch.setattr(desktop, "CLOSE_BUSY_LIMIT", 0.4)
    page = _ClosingPage("close", delay=30, busy="saving")
    _close(page)
    assert page.destroyed.wait(2)


# ---- S5 (kontrola 2): uživatelské jméno Windows v logu --------------------

def test_s5_the_log_never_names_the_user(tmp_path, monkeypatch):
    home = r"C:\Users\Jan Novák"
    monkeypatch.setenv("USERPROFILE", home)
    monkeypatch.setenv("HOME", home)
    monkeypatch.setattr(logs.Path, "home", classmethod(lambda cls: Path(home)))
    path = logs.setup_logging(tmp_path)
    log = logging.getLogger("noirpad")
    log.info("data dir %s", home + r"\AppData\Local\NoirPad")
    log.warning("mixed %s and %s", "c:/users/jan novák/Documents/x.md", home.upper() + r"\Y")
    try:
        open(home + r"\nope\notes_data.json", encoding="utf-8")
    except OSError:
        log.exception("Could not read")          # repr() doubles the backslashes
    log.info(r"C:\Users\Jan Nováková stays: another user's folder")
    for h in logging.getLogger().handlers:
        h.flush()
    text = path.read_text(encoding="utf-8")
    assert r"~\AppData\Local\NoirPad" in text
    assert "~/Documents/x.md" in text and r"~\Y" in text
    assert r"~\\nope\\notes_data.json" in text
    assert "Nováková stays" in text
    assert "jan novák\\" not in text.lower() and "jan novák/" not in text.lower()
