"""N1.11 test, findings 1 and 2: a second start while NoirPad runs.

The running window was searched by its title only, so with both editions open
the second start of one brought the other's window to the front, could show a
window that was still hidden, and took a maximised window out of that state.
Now the window is marked with its data folder once its page is ready. And the
window has the theme's background from the start (it was white for a second)."""

import ctypes
import os
import re
import subprocess
import sys
import time
import types
from pathlib import Path

import pytest

import desktop
from noirpad import logs

ROOT = Path(__file__).resolve().parent.parent
pytestmark = pytest.mark.skipif(sys.platform != "win32", reason="Windows")


# ---- real processes ------------------------------------------------------------------

class Running:
    """A NoirPad that already runs on *data* (tests/fake_noirpad_window.py)."""

    def __init__(self, data: Path, *args):
        self.data = data
        data.mkdir(parents=True, exist_ok=True)
        self.proc = subprocess.Popen([sys.executable, str(ROOT / "tests" / "fake_noirpad_window.py"), str(data), *args],
                                     stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True,
                                     env={**os.environ, "NOIRPAD_DATA_DIR": str(data)})
        line = self.proc.stdout.readline().strip()
        assert line.isdigit(), "the fake window did not start"
        self.hwnd = int(line)

    @property
    def raised(self):
        """The second start restored this (minimised) window."""
        return not ctypes.windll.user32.IsIconic(self.hwnd)

    def close(self):
        self.proc.stdin.close()
        try:
            self.proc.wait(10)
        except subprocess.TimeoutExpired:
            self.proc.kill()
        self.proc.stdout.close()


@pytest.fixture
def running():
    made = []

    def start(data, *args):
        made.append(Running(data, *args))
        return made[-1]
    yield start
    for r in made:
        r.close()


def start_again(edition, data):
    """A real second NoirPad process on that edition's data folder."""
    env = {**os.environ, "NOIRPAD_DATA_DIR": str(data), "NOIRPAD_EDITION": edition}
    proc = subprocess.run([sys.executable, str(ROOT / "desktop.py")], env=env, cwd=ROOT, timeout=60,
                          capture_output=True, text=True)
    log = logs.log_path(data).read_text(encoding="utf-8")
    return proc.returncode, log


@pytest.mark.parametrize("edition", ["github", "store"])
def test_a_second_start_raises_the_running_window(running, tmp_path, edition):
    first = running(tmp_path / edition)
    code, log = start_again(edition, first.data)
    assert code == 0 and first.raised
    assert "Brought the running NoirPad to the front" in log
    assert "WebView2 runtime" not in log                # it never got as far as a window of its own


@pytest.mark.parametrize("order", [("github", "store"), ("store", "github")])
@pytest.mark.parametrize("again", ["github", "store"])
def test_with_both_editions_open_only_the_own_window_is_raised(running, tmp_path, order, again):
    open_ = {edition: running(tmp_path / edition) for edition in order}
    code, _ = start_again(again, open_[again].data)
    assert code == 0
    assert {e: r.raised for e, r in open_.items()} == {again: True, ("store" if again == "github" else "github"): False}


def test_the_other_editions_window_is_never_the_own_one(running, tmp_path):
    """Own folder held without a window (e.g. the web version), the other
    edition open: no window is found, none is touched."""
    other = running(tmp_path / "store")
    assert desktop._find_app_window(tmp_path / "github") == 0
    assert desktop._find_app_window(other.data) == other.hwnd


def test_a_hidden_window_is_not_shown_from_outside(running, tmp_path):
    first = running(tmp_path / "store", "hidden")
    assert desktop._find_app_window(first.data) == 0


# ---- marking and raising ----------------------------------------------------------------

def test_the_window_is_marked_when_the_page_is_ready_before_starting_ends(monkeypatch, tmp_path):
    """Until then a second start waits ("Starting"): no half-made window is raised."""
    import threading
    order = []
    monkeypatch.setattr(desktop, "_mark_window", lambda data_dir: order.append(("mark", data_dir)) or True)
    monkeypatch.setattr(desktop, "_release_mutex", lambda handle: order.append("starting ends"))
    ready, loaded = threading.Event(), threading.Event()
    thread = desktop._watch_start(ready, loaded, tmp_path, "en", timeout=5, exit_fn=lambda code: order.append("exit"))
    time.sleep(0.3)
    assert order == []
    ready.set()
    thread.join(5)
    assert order == [("mark", tmp_path), "starting ends"]


class _User32:
    def __init__(self, iconic):
        self.iconic, self.calls = iconic, []

    def IsIconic(self, hwnd):
        return self.iconic

    def ShowWindow(self, hwnd, how):
        self.calls.append(("show", how))

    def SetForegroundWindow(self, hwnd):
        self.calls.append("front")


@pytest.mark.parametrize("iconic, expected", [(False, ["front"]), (True, [("show", 9), "front"])])
def test_only_a_minimised_window_is_restored(monkeypatch, iconic, expected):
    """SW_RESTORE on a maximised window would end the maximised state."""
    fake = _User32(iconic)
    monkeypatch.setattr(ctypes, "windll", types.SimpleNamespace(user32=fake))
    desktop._bring_to_front(1234)
    assert fake.calls == expected


# ---- the background before the page shows ------------------------------------------------

CSS = (ROOT / "static" / "css" / "themes.css").read_text(encoding="utf-8")


def theme_ids():
    utils = (ROOT / "static" / "js" / "utils.js").read_text(encoding="utf-8")
    block = re.search(r"NP\.THEMES = \{(.*?)\n    \};", utils, re.S).group(1)
    return re.findall(r'^\s*"?([a-z-]+)"?\s*:', block, re.M)


def css_background(theme):
    own = re.search(rf'^\[data-theme="{theme}"\] \{{[^}}]*?--bg:\s*(#[0-9a-f]{{6}})', CSS, re.M)
    return own.group(1) if own else "#0e0e10"


def test_every_theme_has_its_own_background():
    ids = theme_ids()
    assert len(ids) == 17
    assert {t: desktop._theme_background(t) for t in ids} == {t: css_background(t) for t in ids}
    assert desktop._theme_background("dracula") == "#282a36"


@pytest.mark.parametrize("theme", [None, "", "no-such-theme", 7, 'x"] {'])
def test_unknown_theme_is_the_default_dark(theme):
    assert desktop._theme_background(theme) == "#0e0e10"


class _Handlers(list):
    def __iadd__(self, fn):
        self.append(fn)
        return self


@pytest.mark.parametrize("theme, colour", [("nord", "#2e3440"), ("matrix", "#0e0e10")])
def test_the_window_is_created_with_the_saved_themes_background(np_backend, monkeypatch, theme, colour):
    np_backend.update_data(lambda d: d.update(theme=theme))
    made = {}

    def create_window(*a, **kw):
        made.update(kw)
        return types.SimpleNamespace(events=types.SimpleNamespace(closing=_Handlers(), loaded=_Handlers()),
                                     toggle_fullscreen=lambda: None)
    monkeypatch.setitem(sys.modules, "webview", types.SimpleNamespace(
        settings={}, create_window=create_window, start=lambda **kw: None))
    desktop._show_window(1234, "tok", np_backend.DATA_DIR)
    assert made["background_color"] == colour


def test_unreadable_data_is_no_obstacle(monkeypatch):
    from noirpad import storage

    def broken():
        raise OSError("no disk")
    monkeypatch.setattr(storage, "read_data", broken)
    assert desktop._window_background() == "#0e0e10"
