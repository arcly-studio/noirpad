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
"""

from __future__ import annotations

import os
import sys

# PyInstaller windowed builds have no console: give print() somewhere to go.
if sys.stdout is None:
    sys.stdout = open(os.devnull, "w")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w")

import importlib
import json
import logging
import secrets
import socket
import threading
import time
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
# A second launch right after the first may find no window yet: wait this
# long for it before saying "already running".
FOCUS_WAIT_SECONDS = 6.0

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


def _find_app_window() -> int:
    """The running NoirPad window: title "NoirPad" and a WinForms class
    (pywebview), so an Explorer folder called NoirPad never matches."""
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.windll.user32
    found = []

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def _visit(hwnd, _lparam):
        title = ctypes.create_unicode_buffer(64)
        cls = ctypes.create_unicode_buffer(128)
        user32.GetWindowTextW(hwnd, title, 64)
        user32.GetClassNameW(hwnd, cls, 128)
        if title.value == WINDOW_TITLE and cls.value.startswith("WindowsForms10."):
            found.append(hwnd)
            return False
        return True

    user32.EnumWindows(_visit, 0)
    return found[0] if found else 0


def _focus_running_instance(lang: str) -> None:
    """Bring the already-open NoirPad window to front, or explain why not.

    The other NoirPad may have been launched a moment ago and have no
    window yet, so wait for one. If it exits meanwhile (it failed to start
    and has told the user why), stay quiet: one error box, not two.
    """
    from noirpad import storage

    deadline = time.monotonic() + FOCUS_WAIT_SECONDS
    while True:
        if sys.platform == "win32":
            import ctypes
            hwnd = _find_app_window()
            if hwnd:
                user32 = ctypes.windll.user32
                user32.ShowWindow(hwnd, 9)  # SW_RESTORE
                user32.SetForegroundWindow(hwnd)
                return
        free = storage.acquire_instance_lock()
        if free is not None:
            free.close()
            log.info("The other NoirPad exited; nothing to focus")
            return
        if time.monotonic() >= deadline:
            break
        time.sleep(0.25)
    _message_box(MESSAGES[lang]["running"], MB_OK | MB_ICONINFORMATION)


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
        log.info("Another NoirPad uses the same data directory; focusing it")
        if smoke:
            return 3
        _focus_running_instance(lang)
        return 0
    from noirpad import edition, store_import
    store = edition.edition() == edition.STORE
    # Store edition: copy the GitHub edition's notes once, before the
    # backend (and its migrations) touch the data folder.
    blocked = store_import.maybe_import(data_dir) if store else None
    from noirpad import app as _backend  # noqa: F401  (the import points storage at data_dir)
    if store:
        from noirpad.runtime import RUNTIME
        notice = blocked if blocked and blocked["code"] == store_import.NOTICE_BLOCKED             else store_import.pending_notice(data_dir)
        if notice and RUNTIME.data_notice is None:       # a recovered data file comes first
            RUNTIME.data_notice = notice
    else:
        _hold_app_mutex()      # the installer's mutex belongs to the GitHub edition
    # The data lock is released before main() shows an error box, so a
    # NoirPad started meanwhile doesn't report "already running" on top of it.
    try:
        return _serve(lang, smoke)
    finally:
        instance_lock.close()


def _serve(lang: str, smoke: bool) -> int:
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
        _show_window(port, token, storage.DATA_DIR)
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


def _show_window(port: int, token: str, data_dir: Path) -> None:
    # The fragment never reaches the server or its logs; api.js reads it
    # and removes it from the address bar.
    window_url = f"http://127.0.0.1:{port}/#token={token}"

    import webview

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
    )
    from noirpad.runtime import RUNTIME
    RUNTIME.save_dialog = lambda name: _ask_save_path(window, name)
    RUNTIME.toggle_fullscreen = window.toggle_fullscreen
    _save_before_close(window)
    # Persistent WebView2 profile so localStorage (open folders, CRT
    # toggle) survives restarts; it lives next to the notes.
    storage_path = data_dir / "webview"
    storage_path.mkdir(parents=True, exist_ok=True)
    # gui="edgechromium" forces WebView2 on Windows, which is what we
    # ship for. On other platforms pywebview picks the system default.
    gui = "edgechromium" if sys.platform == "win32" else None
    webview.start(gui=gui, private_mode=False, storage_path=str(storage_path))


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


def _save_before_close(window) -> None:
    """K5: the page's own unload flush is a keepalive request, which may
    carry at most 64 kB, so a long note typed into just before closing was
    lost. The first close request is cancelled, the page saves the open
    note (NP.editor.flushForClose), then the window really closes. A page
    that does not answer within CLOSE_SAVE_TIMEOUT and is not busy never
    blocks closing.

    R2: if the save fails, the page asks whether to close anyway; "stay"
    keeps the window (and the unsaved text) open."""
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
        if state["closing"]:
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
        answer = _message_box(MESSAGES[lang][failed.message].format(log=log_file), failed.flags)
        if failed.url and answer == IDYES:
            webbrowser.open(failed.url)
        return failed.code
    except Exception as exc:
        log.exception("NoirPad failed to start")
        _message_box(MESSAGES[lang]["crash"].format(error=exc, log=log_file),
                     MB_OK | MB_ICONERROR)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
