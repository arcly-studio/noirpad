"""
NoirPad desktop launcher (PyInstaller entry point).

Wraps the FastAPI app (noirpad.app) in a native window using pywebview +
WebView2 (EdgeChromium) on Windows. The server runs in a background thread
on a free loopback port; the webview points at it. `python desktop.py` in
dev gives the same experience without bundling.

Failures never vanish silently: everything goes to the log file
(%LOCALAPPDATA%\\NoirPad\\logs\\noirpad.log) and start-up problems — no
WebView2 runtime, a crash — are shown in a Windows message box with the
path to that log.

``NoirPad.exe --smoke-test`` (build.ps1) starts everything except the
window: it imports the modules NoirPad loads by name at run time, starts
the server, writes its port and token to <data dir>/smoke-test.json and
runs until that file is deleted (at most SMOKE_MAX_SECONDS). Problems go to
the log and the exit code, never to a message box.

A start never hangs on "Loading" (N1.11 test, finding 6): the page reports when it
has started (POST /api/session/ready); without that within STARTUP_TIMEOUT the
log gets the stage and every thread's stack, one message box explains it and
the process ends. A start while the previous NoirPad is still closing waits
for it and then starts normally. At most one error box per data folder.
The release build never opens a WebView2 debugging port.
"""

from __future__ import annotations

import os
import re
import sys

# PyInstaller windowed builds have no console: give print() somewhere to go.
if sys.stdout is None:
    sys.stdout = open(os.devnull, "w")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w")

import faulthandler
import hashlib
import importlib
import json
import logging
import secrets
import socket
import threading
import time
import traceback
import webbrowser
from pathlib import Path
from typing import Optional

import uvicorn

from noirpad import config, logs
from noirpad.__version__ import __version__
from noirpad.runtime_imports import RUNTIME_IMPORTS, UVICORN_OPTIONS, WINDOWS_IMPORTS

log = logging.getLogger("noirpad.desktop")

WINDOW_TITLE = "NoirPad"
WINDOW_MIN_WIDTH = 720
WINDOW_MIN_HEIGHT = 480
WINDOW_INITIAL_WIDTH = 1280
WINDOW_INITIAL_HEIGHT = 800

# Held until the process is gone; installer.iss AppMutex uses the same name
# so setup/uninstall can ask the user to close the app first.
APP_MUTEX = "NoirPad-B6F2E7C0-AppMutex"

WEBVIEW2_GUID = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
WEBVIEW2_DOWNLOAD = "https://go.microsoft.com/fwlink/p/?LinkId=2124703"  # Evergreen bootstrapper

SERVER_START_TIMEOUT = 15.0
# Closing the window: how long the page may take to save the open note.
# While it says it is still busy, the wait goes on (R2): a slow save up to
# CLOSE_BUSY_LIMIT, the "could not be saved – close anyway?" question as long
# as it is on screen.
CLOSE_SAVE_TIMEOUT = 5.0
CLOSE_BUSY_LIMIT = 120.0
# A second launch while another NoirPad holds the data folder: it waits up to
# LOCK_WAIT_SECONDS for that one to finish closing (then starts normally) or
# to show its window (then brings it to the front; a window that vanishes
# within FOCUS_GRACE_SECONDS was closing).
LOCK_WAIT_SECONDS = 15.0
FOCUS_GRACE_SECONDS = 2.0
# The page has this long to report that it started (finding 6: "Loading"
# forever). A hang that even keeps Python's own threads from running ends
# the process after STARTUP_BACKSTOP; the next start logs where it hung.
STARTUP_TIMEOUT = 15.0
STARTUP_BACKSTOP = 30.0
HANG_FILE = "startup-hang.txt"

SMOKE_FLAG = "--smoke-test"
SMOKE_FILE = "smoke-test.json"
SMOKE_MAX_SECONDS = 60.0

MB_OK, MB_YESNO =0x0, 0x4
MB_ICONERROR, MB_ICONWARNING, MB_ICONINFORMATION = 0x10, 0x30, 0x40
IDYES = 6

MESSAGES = {
    "en": {
        "running": "NoirPad is already running (maybe as the web version in a terminal).\n\n"
                   "Close the other instance first; two NoirPads on the same notes would "
                   "overwrite each other's changes.",
        "webview2": "NoirPad needs the Microsoft Edge WebView2 Runtime, which is not "
                    "installed on this computer.\n\nOpen the Microsoft download page now?\n\n"
                    "Details are in the log:\n{log}",
        "no_server": "NoirPad could not start its local server.\n\nDetails are in the log:\n{log}",
        "crash": "NoirPad could not start: {error}\n\nDetails are in the log:\n{log}",
        "start_timeout": "NoirPad did not finish starting and will close now.\n\n"
                         "Please start it again. Details are in the log:\n{log}",
        "view_failed": "NoirPad's display has stopped responding.\n\nRestore it?",
        "view_gave_up": "NoirPad's display keeps failing. Please close NoirPad and start it again.\n\n"
                        "Details are in the log:\n{log}",
    },
    "cs": {
        "running": "NoirPad už běží (možná jako webová verze v terminálu).\n\n"
                   "Nejdřív ho zavřete: dva NoirPady nad stejnými poznámkami by si navzájem "
                   "přepisovaly změny.",
        "webview2": "NoirPad potřebuje Microsoft Edge WebView2 Runtime, který na tomto "
                    "počítači není nainstalovaný.\n\nOtevřít stránku Microsoftu ke stažení?\n\n"
                    "Podrobnosti jsou v logu:\n{log}",
        "no_server": "NoirPadu se nepodařilo spustit místní server.\n\n"
                     "Podrobnosti jsou v logu:\n{log}",
        "crash": "NoirPad se nepodařilo spustit: {error}\n\nPodrobnosti jsou v logu:\n{log}",
        "start_timeout": "NoirPad se nepodařilo dokončit spuštění a teď se zavře.\n\n"
                         "Spusťte ho prosím znovu. Podrobnosti jsou v logu:\n{log}",
        "view_failed": "Zobrazení NoirPadu přestalo reagovat.\n\nObnovit?",
        "view_gave_up": "Zobrazení NoirPadu opakovaně selhává. Zavřete prosím NoirPad a spusťte ho znovu.\n\n"
                        "Podrobnosti jsou v logu:\n{log}",
    },
}


# ---------------------------------------------------------------------------
# Windows helpers
# ---------------------------------------------------------------------------


def _language(data_dir: Path) -> str:
    """The UI language setting, else the installer's language, else
    Windows' display language (the same order as the app itself)."""
    try:
        setting = json.loads((data_dir / "notes_data.json").read_text(encoding="utf-8")).get("language")
    except (OSError, ValueError, AttributeError):
        setting = None
    if setting in MESSAGES:
        return setting
    installed = config.install_language(data_dir)
    if installed in MESSAGES:
        return installed
    if sys.platform == "win32":
        import ctypes
        return "cs" if ctypes.windll.kernel32.GetUserDefaultUILanguage() & 0x3FF == 0x05 else "en"
    return "en"


_headless = False   # --smoke-test: no message boxes, they would block the build


def _message_box(text: str, flags: int) -> int:
    if _headless:
        log.error("Message box suppressed (--smoke-test): %s", text)
        return 0
    if sys.platform != "win32":
        print(text, file=sys.stderr)
        return 0
    import ctypes
    return ctypes.windll.user32.MessageBoxW(None, text, WINDOW_TITLE, flags | 0x10000)  # MB_SETFOREGROUND


# Named mutexes per data folder (both editions have their own): "Starting"
# while a NoirPad starts (until its page is ready), "ErrorBox" while one shows
# an error. A second NoirPad never adds its own error box to either.
SYNCHRONIZE = 0x00100000


def _mutex_name(kind: str, data_dir: Path) -> str:
    key = os.path.normcase(str(Path(data_dir).resolve()))
    return f"NoirPad-{kind}-{hashlib.sha1(key.encode('utf-8')).hexdigest()[:16]}"


def _hold_mutex(kind: str, data_dir: Path):
    if sys.platform != "win32":
        return None
    import ctypes
    return ctypes.windll.kernel32.CreateMutexW(None, False, _mutex_name(kind, data_dir)) or None


def _release_mutex(handle) -> None:
    if handle and sys.platform == "win32":
        import ctypes
        ctypes.windll.kernel32.CloseHandle(handle)


def _mutex_exists(kind: str, data_dir: Path) -> bool:
    if sys.platform != "win32":
        return False
    import ctypes
    handle = ctypes.windll.kernel32.OpenMutexW(SYNCHRONIZE, False, _mutex_name(kind, data_dir))
    if handle:
        ctypes.windll.kernel32.CloseHandle(handle)
    return bool(handle)


def _error_box(text: str, flags: int, data_dir: Path) -> int:
    """An error box, unless another NoirPad on this data folder already
    shows one (then only the log)."""
    if _mutex_exists("ErrorBox", data_dir):
        log.info("Another NoirPad already shows an error; no second message box")
        return 0
    held = _hold_mutex("ErrorBox", data_dir)
    try:
        return _message_box(text, flags)
    finally:
        _release_mutex(held)


def _webview2_version() -> Optional[str]:
    """Installed WebView2 Runtime version, per Microsoft's documented
    registry keys (machine-wide 64/32-bit view, then per-user)."""
    if sys.platform != "win32":
        return "n/a"
    import winreg
    keys = [
        (winreg.HKEY_LOCAL_MACHINE, rf"SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{WEBVIEW2_GUID}"),
        (winreg.HKEY_LOCAL_MACHINE, rf"SOFTWARE\Microsoft\EdgeUpdate\Clients\{WEBVIEW2_GUID}"),
        (winreg.HKEY_CURRENT_USER, rf"Software\Microsoft\EdgeUpdate\Clients\{WEBVIEW2_GUID}"),
    ]
    for hive, path in keys:
        try:
            with winreg.OpenKey(hive, path) as key:
                version = winreg.QueryValueEx(key, "pv")[0]
        except OSError:
            continue
        if version and version != "0.0.0.0":
            return version
    return None


_app_mutex = None


def _hold_app_mutex() -> None:
    """Create the installer mutex and never close it: Windows releases it
    when the process ends. Closing it when the window closes left a few
    seconds (WebView2 and .NET shutting down) in which the uninstaller saw
    no NoirPad, yet NoirPad.exe and python314.dll were still locked, and
    the uninstall left the program folder behind (B8)."""
    global _app_mutex
    if sys.platform != "win32" or _app_mutex:
        return
    import ctypes
    _app_mutex = ctypes.windll.kernel32.CreateMutexW(None, False, APP_MUTEX)


def _app_windows(wanted) -> list:
    """Visible top-level NoirPad windows (title "NoirPad", a WinForms class as
    pywebview's) for which wanted(hwnd) is true. InternalGetWindowText sends no
    message, so a window that does not answer cannot block this."""
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.windll.user32
    found = []

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def _visit(hwnd, _lparam):
        title = ctypes.create_unicode_buffer(64)
        cls = ctypes.create_unicode_buffer(128)
        user32.InternalGetWindowText(hwnd, title, 64)
        user32.GetClassNameW(hwnd, cls, 128)
        if (title.value == WINDOW_TITLE and cls.value.startswith("WindowsForms10.")
                and user32.IsWindowVisible(hwnd) and wanted(hwnd)):
            found.append(hwnd)
        return True

    user32.EnumWindows(_visit, 0)
    return found


def _window_mark(hwnd: int, data_dir: Path) -> bool:
    import ctypes
    from ctypes import wintypes
    get = ctypes.WINFUNCTYPE(wintypes.HANDLE, wintypes.HWND, wintypes.LPCWSTR)(("GetPropW", ctypes.windll.user32))
    return bool(get(hwnd, _mutex_name("Window", data_dir)))


def _mark_window(data_dir: Path) -> bool:
    """Mark this process's window as the one of *data_dir* (a window property;
    it goes with the window). The title alone is the same in both editions."""
    if sys.platform != "win32":
        return False
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.windll.user32
    put = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPCWSTR, wintypes.HANDLE)(("SetPropW", user32))

    def own(hwnd) -> bool:
        pid = wintypes.DWORD()
        user32.GetWindowThreadProcessId(wintypes.HWND(hwnd), ctypes.byref(pid))
        return pid.value == os.getpid()

    marked = [hwnd for hwnd in _app_windows(own) if put(hwnd, _mutex_name("Window", data_dir), 1)]
    return bool(marked)


def _find_app_window(data_dir: Path) -> int:
    """The window of the NoirPad that runs on *data_dir*, whichever edition;
    0 while it has none, is still starting, or only another NoirPad is open."""
    found = _app_windows(lambda hwnd: _window_mark(hwnd, data_dir))
    return found[0] if found else 0


def _bring_to_front(hwnd: int) -> None:
    import ctypes
    user32 = ctypes.windll.user32
    if user32.IsIconic(hwnd):       # a maximised window stays maximised
        user32.ShowWindow(hwnd, 9)  # SW_RESTORE
    user32.SetForegroundWindow(hwnd)


def _focus_running_instance(lang: str, data_dir: Path):
    """Another NoirPad holds the data folder. Returns the data lock when it
    finishes closing meanwhile (this one then starts normally), else None.

    - Its window shows and stays: brought to the front, this one ends.
    - It lets go of the folder (it was closing, or failed and said why):
      this one takes over and starts.
    - Neither within LOCK_WAIT_SECONDS: "already running" (e.g. the web
      version), unless it is still starting or shows an error box itself;
      then only the log, so there is never a second box.
    """
    from noirpad import storage

    deadline = time.monotonic() + LOCK_WAIT_SECONDS
    first_seen = None
    while True:
        lock = storage.acquire_instance_lock(data_dir)
        if lock is not None:
            log.info("The other NoirPad has closed; starting")
            return lock
        hwnd = _find_app_window(data_dir) if sys.platform == "win32" else 0
        now = time.monotonic()
        if hwnd:
            if first_seen is None:
                first_seen = now
                _bring_to_front(hwnd)
            elif now - first_seen >= FOCUS_GRACE_SECONDS:
                log.info("Brought the running NoirPad to the front")
                return None
        if now >= deadline:
            break
        time.sleep(0.25)
    if _mutex_exists("Starting", data_dir) or _mutex_exists("ErrorBox", data_dir):
        log.warning("The other NoirPad is still starting or shows an error after %.0f s; "
                    "this one ends without a message", LOCK_WAIT_SECONDS)
        return None
    log.warning("Another NoirPad has used the data folder for %.0f s and shows no window",
                LOCK_WAIT_SECONDS)
    _error_box(MESSAGES[lang]["running"], MB_OK | MB_ICONINFORMATION, data_dir)
    return None


# ---------------------------------------------------------------------------
# Networking helpers
# ---------------------------------------------------------------------------

def _pick_free_port() -> int:
    """Ask the kernel for a free loopback port. Closing the socket
    immediately releases it; uvicorn will rebind a moment later."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _missing_runtime_imports() -> list[str]:
    """Modules NoirPad imports by name at run time that can't be imported
    here (in NoirPad.exe: that the build left out)."""
    names = RUNTIME_IMPORTS + (WINDOWS_IMPORTS if sys.platform == "win32" else ())
    missing = []
    for name in names:
        try:
            importlib.import_module(name)
        except Exception as exc:
            log.error("Cannot import %s: %r", name, exc)
            missing.append(name)
    return missing


class _StartupFailed(Exception):
    """Start-up stopped; main() shows MESSAGES[lang][message] once the data
    lock is released, opens *url* on "Yes" and exits with *code*."""

    def __init__(self, message: str, flags: int, code: int, url: Optional[str] = None):
        super().__init__(message)
        self.message, self.flags, self.code, self.url = message, flags, code, url


# ---------------------------------------------------------------------------
# Uvicorn lifecycle
# ---------------------------------------------------------------------------

class _ServerHandle:
    """Owns the uvicorn.Server + its thread so we can stop both on exit."""

    def __init__(self, app, port: int):
        config_ = uvicorn.Config(
            app=app,
            host="127.0.0.1",
            port=port,
            log_level="info",
            log_config=None,     # uvicorn logs go to our log file (root logger)
            access_log=False,    # never log requests (URLs carry note ids)
            workers=1,
            reload=False,
            **UVICORN_OPTIONS,   # h11, no WebSockets: nothing picked by "auto"
        )
        self.server = uvicorn.Server(config_)
        # Uvicorn installs its own SIGINT/SIGTERM handlers when run on the
        # main thread; we're in a worker thread so we suppress that install
        # to keep the main thread (pywebview) responsive to Ctrl+C / close.
        self.server.install_signal_handlers = lambda: None
        self.thread = threading.Thread(
            target=self._serve, name="noirpad-uvicorn", daemon=True
        )

    def _serve(self) -> None:
        try:
            self.server.run()
        except SystemExit:      # uvicorn's own start-up errors; it logged why
            pass
        except BaseException:
            log.critical("Local server crashed", exc_info=True)

    def start(self) -> None:
        self.thread.start()

    def wait_ready(self, timeout: float) -> bool:
        """True once uvicorn listens. False as soon as its thread ends
        (crash, missing module, port taken, failed lifespan) instead of
        sitting out the timeout, or when *timeout* elapses."""
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self.server.started:
                return True
            if not self.thread.is_alive():
                return False
            self.thread.join(0.05)
        return self.server.started

    def stop(self, join_timeout: float = 5.0) -> None:
        self.server.should_exit = True
        self.thread.join(timeout=join_timeout)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def _run(data_dir: Path, log_file: Path, lang: str, smoke: bool = False) -> int:
    from noirpad import storage

    # One NoirPad per data directory (desktop or web), see D7 in the audit.
    # R11: taken BEFORE the backend is imported — that import runs the data
    # migrations, which must never run next to another NoirPad.
    Path(data_dir).mkdir(parents=True, exist_ok=True)
    instance_lock = storage.acquire_instance_lock(data_dir)
    if instance_lock is None:
        log.info("Another NoirPad uses the same data directory; waiting for it")
        if smoke:
            return 3
        instance_lock = _focus_running_instance(lang, data_dir)
        if instance_lock is None:
            return 0
    _report_previous_hang(data_dir)
    starting = None if smoke else _hold_mutex("Starting", data_dir)
    from noirpad import edition, store_import
    store = edition.edition() == edition.STORE
    # Store edition: copy the GitHub edition's notes once, before the
    # backend (and its migrations) touch the data folder.
    blocked = store_import.maybe_import(data_dir) if store else None
    from noirpad import app as _backend  # noqa: F401  (the import points storage at data_dir)
    if store:
        from noirpad.runtime import RUNTIME
        # Postponed (installer edition running) or skipped (own notes here):
        # that notice; otherwise the "copied" notice until it was seen once.
        early = (store_import.NOTICE_BLOCKED, store_import.NOTICE_SKIPPED)
        notice = blocked if blocked and blocked["code"] in early else store_import.pending_notice(data_dir)
        if notice and RUNTIME.data_notice is None:       # a recovered data file comes first
            RUNTIME.data_notice = notice
    else:
        _hold_app_mutex()      # the installer's mutex belongs to the GitHub edition
    # The data lock is released before main() shows an error box, so a
    # NoirPad started meanwhile doesn't report "already running" on top of it.
    try:
        return _serve(lang, smoke, starting)
    finally:
        _release_mutex(starting)
        instance_lock.close()


def _serve(lang: str, smoke: bool, starting=None) -> int:
    from noirpad import storage

    webview2 = _webview2_version()
    log.info("WebView2 runtime: %s", webview2 or "MISSING")
    if webview2 is None and not smoke:
        raise _StartupFailed("webview2", MB_YESNO | MB_ICONWARNING, 2, WEBVIEW2_DOWNLOAD)

    if smoke:
        missing = _missing_runtime_imports()
        if missing:
            log.error("Smoke test: modules missing from the build: %s", ", ".join(missing))
            return 4

    from noirpad import app as backend_app, server_auth

    # Random per-launch token: every /api/ request must carry it, so other
    # local processes (or web pages) that find the port can't use the API.
    token = secrets.token_urlsafe(32)
    server_auth.configure(mode="desktop", password=None, desktop_token=token)
    port = _pick_free_port()
    handle = _ServerHandle(backend_app.app, port)
    handle.start()

    if not handle.wait_ready(SERVER_START_TIMEOUT):
        ended = not handle.thread.is_alive()
        handle.stop()
        log.error("Backend did not start on 127.0.0.1:%d (%s)", port,
                  "server thread ended" if ended else f"not ready within {SERVER_START_TIMEOUT:.0f} s")
        raise _StartupFailed("no_server", MB_OK | MB_ICONERROR, 1)
    log.info("Backend ready on 127.0.0.1:%d", port)

    try:
        if smoke:
            return _smoke_wait(handle, port, token, storage.DATA_DIR)
        _show_window(port, token, storage.DATA_DIR, lang=lang, starting=starting)
    finally:
        handle.stop()
    log.info("NoirPad closed")
    return 0


def _smoke_wait(handle: _ServerHandle, port: int, token: str, data_dir: Path) -> int:
    """Publish port + token for build.ps1 and serve until it deletes the
    file. Only ever run with a throwaway NOIRPAD_DATA_DIR."""
    info = data_dir / SMOKE_FILE
    tmp = info.with_suffix(".tmp")
    tmp.write_text(json.dumps({"port": port, "token": token, "version": __version__}),
                   encoding="utf-8")
    os.replace(tmp, info)
    deadline = time.monotonic() + SMOKE_MAX_SECONDS
    while info.exists() and handle.thread.is_alive() and time.monotonic() < deadline:
        time.sleep(0.1)
    if not handle.thread.is_alive():
        log.error("Smoke test: the server stopped on its own")
        return 1
    log.info("Smoke test finished")
    return 0


def _no_remote_debugging(webview) -> None:
    """The release build never opens a WebView2 DevTools port: pywebview's
    own setting stays off, and in the built exe the WebView2 overrides from
    the environment (extra browser arguments such as a debugging port, another
    runtime or profile folder) are dropped before WebView2 starts. Only the
    variable's name is logged. Dev runs (python desktop.py) keep them for
    tools/take_screenshots.py."""
    if "REMOTE_DEBUGGING_PORT" in getattr(webview, "settings", {}):
        webview.settings["REMOTE_DEBUGGING_PORT"] = None
    if not config.is_frozen():
        return
    for key in list(os.environ):
        if key.upper().startswith("WEBVIEW2_"):
            log.warning("Ignoring %s from the environment (not used by the release build)", key)
            del os.environ[key]


def _thread_stacks() -> str:
    names = {t.ident: t.name for t in threading.enumerate()}
    out = []
    for ident, frame in sys._current_frames().items():
        out.append(f"Thread {names.get(ident, ident)}:\n" + "".join(traceback.format_stack(frame)))
    return "\n".join(out)


def _report_previous_hang(data_dir: Path) -> None:
    """The backstop of the last start wrote its thread stacks here before it
    ended the process: into the (anonymized) log, then away with the file."""
    path = Path(data_dir) / HANG_FILE
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return
    if text.strip():
        log.error("The previous start hung and was ended; its threads then:\n%s", text.strip())
    try:
        path.unlink()
    except OSError:
        pass


def _watch_start(page_ready: threading.Event, loaded: threading.Event, data_dir: Path,
                 lang: str, starting=None, timeout: Optional[float] = None, exit_fn=None,
                 closed: Optional[threading.Event] = None) -> threading.Thread:
    """Finding 6: the page must report that it started within STARTUP_TIMEOUT.
    Otherwise: the stage and every thread's stack to the log, one message box,
    and the process ends (unless the page made it while the box was open)."""
    timeout = STARTUP_TIMEOUT if timeout is None else timeout
    exit_fn = exit_fn or os._exit
    closed = closed or threading.Event()
    started = time.monotonic()

    def started_up(late: str) -> None:
        faulthandler.cancel_dump_traceback_later()
        log.info("Page ready after %.1f s%s", time.monotonic() - started, late)
        # First the mark, then "Starting" ends: a second start waiting
        # meanwhile finds a finished window.
        if sys.platform == "win32" and not _mark_window(data_dir):
            log.warning("The window could not be marked for a second start")
        _release_mutex(starting)

    def watch() -> None:
        while not page_ready.wait(0.1):
            if closed.is_set():          # the window closed while starting
                return
            if time.monotonic() - started >= timeout:
                break
        if page_ready.is_set():
            started_up("")
            return
        stage = ("the page loaded, but the app in it did not finish starting" if loaded.is_set()
                 else "the window did not load the page")
        log.error("Start did not finish within %.0f s: %s", timeout, stage)
        log.error("Threads at that moment:\n%s", _thread_stacks())
        _error_box(MESSAGES[lang]["start_timeout"].format(log=logs.log_path(data_dir)),
                   MB_OK | MB_ICONERROR, data_dir)
        if page_ready.is_set():
            started_up(" (late); keeps running")
            return
        log.error("Ending NoirPad after the failed start")
        logging.shutdown()
        exit_fn(1)

    thread = threading.Thread(target=watch, name="noirpad-start-watch", daemon=True)
    thread.start()
    return thread


def _arm_backstop(data_dir: Path):
    """A hang that keeps even the watch thread from running (a thread holding
    Python's lock): faulthandler writes all stacks to HANG_FILE and ends the
    process; the next start puts them into the log (_report_previous_hang)."""
    try:
        hang = open(Path(data_dir) / HANG_FILE, "w", encoding="utf-8")
    except OSError:
        return None
    faulthandler.dump_traceback_later(STARTUP_BACKSTOP, repeat=False, file=hang, exit=True)
    return hang


def _disarm_backstop(hang) -> None:
    faulthandler.cancel_dump_traceback_later()
    if hang is None:
        return
    hang.close()
    try:
        Path(hang.name).unlink()
    except OSError:
        pass


# ---- WebView2 processes that die ------------------------------------------
# WebView2 reports it (ProcessFailed) and leaves the recovery to the app:
# without one the window stays empty for good (browser process) or shows an
# error page (renderer). pywebview does nothing.
VIEW_LOST = ("BrowserProcessExited", "RenderProcessExited")
VIEW_HUNG = "RenderProcessUnresponsive"     # reported again every few seconds
VIEW_HUNG_WINDOW = 60.0                     # two reports within this: it really hangs
VIEW_MAX_FAILURES = 3                       # the third within VIEW_FAILURE_WINDOW
VIEW_FAILURE_WINDOW = 300.0                 # is not restored any more


class _ViewRecovery:
    """Decides what happens when one of the window's processes failed. failed()
    is called on the UI thread and returns at once (no message loop inside the
    event, as Microsoft asks); the question and the recovery run elsewhere.

    ask() -> True: restore. restore() -> True: the page is ready again.
    give_up(): tell the user it keeps failing. dead: the page is gone and was
    not restored (closing must not wait for it)."""

    def __init__(self, ask, restore, give_up, clock=time.monotonic, run=None):
        self.ask, self.restore, self.give_up, self.clock = ask, restore, give_up, clock
        self.run = run or (lambda fn: threading.Thread(target=fn, name="noirpad-view", daemon=True).start())
        self.dead = False
        self._busy = False
        self._lost_meanwhile = False
        self._failures: list = []
        self._hung: Optional[float] = None

    def failed(self, kind: str, reason: str = "", code: int = 0) -> None:
        log.error("WebView2: %s (reason %s, exit code %s)", kind, reason or "?", code)
        now = self.clock()
        if kind == VIEW_HUNG:
            first, self._hung = self._hung, now
            if first is None or now - first > VIEW_HUNG_WINDOW:
                return                       # maybe just a long moment
        elif kind in VIEW_LOST:
            self.dead = True
        else:
            return                           # GPU, utility, frames: WebView2 recovers itself
        if self._busy:                       # one question at a time
            self._lost_meanwhile = self._lost_meanwhile or kind in VIEW_LOST
            return
        self._busy, self._lost_meanwhile = True, False
        self._hung = None
        self._failures = [t for t in self._failures if now - t < VIEW_FAILURE_WINDOW] + [now]
        again = len(self._failures) >= VIEW_MAX_FAILURES
        self.run(lambda: self._handle(again))

    def _handle(self, again: bool) -> None:
        try:
            if again:
                log.error("The display failed %d times within %.0f s; not restored", len(self._failures),
                          VIEW_FAILURE_WINDOW)
                self.give_up()
            elif not (self.ask() or (self._lost_meanwhile and self.ask())):
                # (Asked again when the page died while the question was about
                # one that only did not respond.)
                log.info("Restoring the display was declined")
            elif self.restore():
                self.dead = False
                log.info("The display was restored")
            else:
                log.error("The display could not be restored")
                self.give_up()
        except Exception:
            log.exception("Restoring the display failed")
        finally:
            self._busy = False


def _watch_view(window, url: str, data_dir: Path, storage_path: Path, lang: str, post=None) -> _ViewRecovery:
    """Restore the content of *window* in place when its WebView2 dies."""
    from noirpad.runtime import RUNTIME

    def on_ui(fn) -> None:
        if post is not None:
            post(fn)
            return
        from System import Action          # pythonnet
        window.native.BeginInvoke(Action(fn))

    def new_control() -> None:
        """On the UI thread: a new WebView2 control in the same window."""
        from webview.platforms.edgechromium import EdgeChrome
        form = window.native
        old = form.browser
        try:
            form.Controls.Remove(old.webview)
            old.webview.Dispose()
        except Exception as exc:           # it may be half gone already
            log.warning("Removing the failed display: %s", type(exc).__name__)
        form.browser = EdgeChrome(form, window, str(storage_path))
        form.webview = form.browser.webview
        form.browser.load_url(url)         # with the token: the page has lost it

    def restore() -> bool:
        # What the lost page had unlocked is locked again, as when it is left.
        RUNTIME.unlocked.clear()
        RUNTIME.app_lock_tokens.clear()
        if RUNTIME.data_notice is None:
            RUNTIME.data_notice = {"code": "view_restored", "params": {}}
        RUNTIME.page_ready.clear()
        on_ui(new_control)
        return RUNTIME.page_ready.wait(STARTUP_TIMEOUT)

    recovery = _ViewRecovery(
        ask=lambda: _error_box(MESSAGES[lang]["view_failed"], MB_YESNO | MB_ICONWARNING, data_dir) == IDYES,
        restore=restore,
        give_up=lambda: _error_box(MESSAGES[lang]["view_gave_up"].format(log=logs.log_path(data_dir)),
                                   MB_OK | MB_ICONERROR, data_dir))
    hooked: list = []

    def on_failed(_sender, args) -> None:
        kind = str(args.ProcessFailedKind.ToString())
        try:
            reason, code = str(args.Reason.ToString()), int(args.ExitCode)
        except Exception:                  # an older WebView2 SDK
            reason, code = "", 0
        recovery.failed(kind, reason, code)

    def hook() -> None:
        try:
            browser = window.native.browser
            if hooked and hooked[-1] is browser:
                return
            browser.webview.CoreWebView2.ProcessFailed += on_failed
            hooked[:] = [browser]
        except Exception as exc:           # never let the window fail over this
            log.warning("WebView2 failures are not watched: %s", type(exc).__name__)

    def on_loaded() -> None:
        try:
            on_ui(hook)
        except Exception as exc:
            log.warning("WebView2 failures are not watched: %s", type(exc).__name__)

    window.events.loaded += on_loaded
    return recovery


DEFAULT_BACKGROUND = "#0e0e10"


def _theme_background(theme) -> str:
    """--bg of *theme* in themes.css; the default dark one for a theme that
    has none of its own or is unknown."""
    if not isinstance(theme, str) or not re.fullmatch(r"[a-z-]+", theme):
        return DEFAULT_BACKGROUND
    css = (config.STATIC_DIR / "css" / "themes.css").read_text(encoding="utf-8")
    m = re.search(r'^\[data-theme="%s"\] \{[^}]*?--bg:\s*(#[0-9a-fA-F]{6})' % theme, css, re.M)
    return m.group(1) if m else DEFAULT_BACKGROUND


def _window_background() -> str:
    """Background of the window until the page shows (pywebview: white)."""
    from noirpad import storage
    try:
        return _theme_background(storage.read_data().get("theme"))
    except Exception as exc:          # never let the window fail over this
        log.warning("Could not read the theme for the window: %s", type(exc).__name__)
        return DEFAULT_BACKGROUND


def _show_window(port: int, token: str, data_dir: Path, lang: str = "en", starting=None) -> None:
    # The fragment never reaches the server or its logs; api.js reads it
    # and removes it from the address bar.
    window_url = f"http://127.0.0.1:{port}/#token={token}"

    import webview
    _no_remote_debugging(webview)

    # links.js opens external links with window.open(); pywebview must hand
    # those to the system browser, never load them in the app window.
    webview.settings["OPEN_EXTERNAL_LINKS_IN_BROWSER"] = True
    # Exports go through _ask_save_path (api.js download → desktop_save.py).
    # A download from anywhere else still gets pywebview's "Save as" dialog.
    webview.settings["ALLOW_DOWNLOADS"] = True

    window = webview.create_window(
        WINDOW_TITLE,
        url=window_url,
        width=WINDOW_INITIAL_WIDTH,
        height=WINDOW_INITIAL_HEIGHT,
        min_size=(WINDOW_MIN_WIDTH, WINDOW_MIN_HEIGHT),
        resizable=True,
        confirm_close=False,
        background_color=_window_background(),
    )
    from noirpad.runtime import RUNTIME
    RUNTIME.save_dialog = lambda name: _ask_save_path(window, name)
    RUNTIME.toggle_fullscreen = window.toggle_fullscreen
    # Persistent WebView2 profile so localStorage (open folders, CRT
    # toggle) survives restarts; it lives next to the notes.
    storage_path = data_dir / "webview"
    storage_path.mkdir(parents=True, exist_ok=True)
    recovery = _watch_view(window, window_url, data_dir, storage_path, lang)
    _save_before_close(window, lambda: recovery.dead)
    # One zoom only (settings.js ui_zoom): WebView2's own Ctrl+wheel zoom of
    # older versions may still be stored in its profile; back to 100 %.
    window.events.loaded += lambda: _reset_webview_zoom(window)
    # Finding 6: never "Loading" forever (the page posts /api/session/ready).
    loaded = threading.Event()
    window.events.loaded += loaded.set
    RUNTIME.page_ready.clear()
    closed = threading.Event()
    hang = _arm_backstop(data_dir)
    _watch_start(RUNTIME.page_ready, loaded, data_dir, lang, starting, closed=closed)
    # gui="edgechromium" forces WebView2 on Windows, which is what we
    # ship for. On other platforms pywebview picks the system default.
    gui = "edgechromium" if sys.platform == "win32" else None
    try:
        webview.start(gui=gui, debug=False, private_mode=False, storage_path=str(storage_path), icon=_window_icon())
    finally:
        closed.set()
        _disarm_backstop(hang)


def _window_icon() -> Optional[str]:
    """The green noirpad.ico bundled next to the app (noirpad.spec datas).

    pywebview's WinForms window loads it with all its sizes (System.Drawing
    Icon from the file, platforms/winforms.py); without it the window takes
    only the 32 px icon out of NoirPad.exe. None: pywebview's default."""
    path = config.resource_path("noirpad.ico")
    return str(path) if path.is_file() else None


def _reset_webview_zoom(window, post=None) -> None:
    """WebView2's own zoom factor to 1.0 (NoirPad zooms with CSS, ui_zoom).

    Up to 1.0.x, Ctrl+wheel zoomed WebView2 itself, which keeps that zoom in
    its profile (data folder webview\\). settings.js now takes Ctrl+wheel; this
    resets a zoom left over from before. window.native is pywebview's WinForms
    form, .webview its WebView2 control.

    Finding 6: this runs on pywebview's event thread. Touching the control
    there (even hasattr) could block on the UI thread while holding Python's
    lock, which the UI thread needs for every request of the page: "Loading"
    forever and a window that does not close. So everything happens in a
    callback posted to the UI thread (BeginInvoke: nobody waits for it)."""
    form = getattr(window, "native", None)
    if form is None:
        return

    def reset():
        try:
            control = getattr(form, "webview", None)
            if control is None or not hasattr(control, "ZoomFactor"):
                return
            if abs(float(control.ZoomFactor) - 1.0) > 1e-9:
                log.info("WebView2 zoom %.2f reset to 1.0", float(control.ZoomFactor))
                control.ZoomFactor = 1.0
        except Exception as exc:          # never let the window fail over this
            log.warning("Could not reset the WebView2 zoom: %s", type(exc).__name__)

    if post is None:
        from System import Action          # pythonnet
        post = lambda fn: form.BeginInvoke(Action(fn))  # noqa: E731
    try:
        post(reset)
    except Exception as exc:
        log.warning("Could not reset the WebView2 zoom: %s", type(exc).__name__)


def _page_close_state(window, timeout: float = 2.0) -> Optional[str]:
    """What the page does while the window closes: "saving", "asking" (the
    user is answering whether to close anyway) or None (done, or the page
    does not answer at all)."""
    out: dict = {}
    got = threading.Event()

    def ask() -> None:
        try:
            out["v"] = window.evaluate_js(
                "(window.NP && NP.editor && NP.editor._closeBusy) || null")
        except Exception:
            pass
        got.set()

    threading.Thread(target=ask, name="noirpad-close-busy", daemon=True).start()
    got.wait(timeout)
    value = out.get("v")
    return value if value in ("saving", "asking") else None


def _save_before_close(window, page_is_dead=lambda: False) -> None:
    """K5: the page's own unload flush is a keepalive request, which may
    carry at most 64 kB, so a long note typed into just before closing was
    lost. The first close request is cancelled, the page saves the open
    note (NP.editor.flushForClose), then the window really closes. A page
    that does not answer within CLOSE_SAVE_TIMEOUT and is not busy never
    blocks closing.

    R2: if the save fails, the page asks whether to close anyway; "stay"
    keeps the window (and the unsaved text) open.

    A page whose WebView2 process is gone has nothing left to save: the window
    closes at once."""
    state = {"started": False, "closing": False}

    def flush_then_close() -> None:
        done = threading.Event()
        result: dict = {}

        def answered(value) -> None:
            result["answer"] = value
            done.set()

        def ask_page() -> None:
            try:
                window.evaluate_js(
                    "(window.NP && NP.editor && NP.editor.flushForClose)"
                    " ? NP.editor.flushForClose() : Promise.resolve(null)",
                    answered)
            except Exception:
                log.exception("Saving before close failed")
                done.set()

        threading.Thread(target=ask_page, name="noirpad-close-save", daemon=True).start()
        started = time.monotonic()
        while not done.wait(CLOSE_SAVE_TIMEOUT):
            if page_is_dead():
                break
            busy = _page_close_state(window)
            if busy == "asking" or (busy == "saving"
                                    and time.monotonic() - started < CLOSE_BUSY_LIMIT):
                continue
            log.warning("The page did not finish saving within %.0f s; closing anyway",
                        time.monotonic() - started)
            break
        if result.get("answer") == "stay":
            state["started"] = False        # the next close asks again
            return
        state["closing"] = True
        window.destroy()

    def on_closing():
        if state["closing"] or page_is_dead():
            return True
        if not state["started"]:
            state["started"] = True
            threading.Thread(target=flush_then_close, name="noirpad-close", daemon=True).start()
        return False

    window.events.closing += on_closing


_last_save_dir: Optional[str] = None


def _downloads_dir() -> str:
    """The user's Downloads folder (it can be moved, so ask the registry)."""
    if sys.platform == "win32":
        import winreg
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER,
                                r"Software\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders") as key:
                return winreg.QueryValueEx(key, "{374DE290-123F-4565-9164-39C4925E467B}")[0]
        except OSError:
            pass
    return str(Path.home() / "Downloads")


def _ask_save_path(window, filename: str) -> Optional[str]:
    """Native "Save as" for an export (N6); None when cancelled. Starts in
    the folder used last time this run, else in Downloads."""
    global _last_save_dir
    import webview

    ext = Path(filename).suffix.lstrip(".")
    types = (f"{ext.upper()} (*.{ext})",) if ext.isalnum() else ()
    result = window.create_file_dialog(webview.FileDialog.SAVE, directory=_last_save_dir or _downloads_dir(),
                                       save_filename=filename, file_types=types)
    if not result:
        return None
    path = result[0] if isinstance(result, (list, tuple)) else result
    _last_save_dir = str(Path(path).parent)
    return path


def main(argv: Optional[list[str]] = None) -> int:
    global _headless
    smoke = SMOKE_FLAG in (sys.argv[1:] if argv is None else argv)
    _headless = smoke
    data_dir = config.get_data_dir()
    log_file = logs.setup_logging(data_dir)
    lang = _language(data_dir)
    log.info("NoirPad %s starting (desktop%s, %s, Python %s, data dir %s)",
             __version__, ", smoke test" if smoke else "",
             "installed" if config.is_frozen() else "dev",
             sys.version.split()[0], data_dir)
    try:
        return _run(data_dir, log_file, lang, smoke)
    except _StartupFailed as failed:
        answer = _error_box(MESSAGES[lang][failed.message].format(log=log_file), failed.flags, data_dir)
        if failed.url and answer == IDYES:
            webbrowser.open(failed.url)
        return failed.code
    except Exception as exc:
        log.exception("NoirPad failed to start")
        _error_box(MESSAGES[lang]["crash"].format(error=exc, log=log_file),
                   MB_OK | MB_ICONERROR, data_dir)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
