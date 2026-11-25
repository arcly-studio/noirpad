"""N1.11 test: the window stayed empty for good after its WebView2 process died.
WebView2 reports such a failure and leaves the recovery to the app; pywebview
did nothing. Now: one question, a new control in the same window.

The last part kills the processes of a real window of its own and is run only
with NOIRPAD_GUI_TESTS=1 (it opens windows on the screen)."""

import json
import os
import subprocess
import sys
import threading
import time
import types
from pathlib import Path

import pytest

import desktop
from noirpad.runtime import RUNTIME

ROOT = Path(__file__).resolve().parent.parent
LOST = ["BrowserProcessExited", "RenderProcessExited"]


class Case:
    """A _ViewRecovery whose question, recovery and clock are the test's."""

    def __init__(self, answers=(True,), restored=True):
        self.answers, self.restored = list(answers), restored
        self.calls, self.now, self.jobs = [], 0.0, []
        self.r = desktop._ViewRecovery(self._ask, self._restore, lambda: self.calls.append("gave up"),
                                       clock=lambda: self.now, run=self.jobs.append)

    def _ask(self):
        self.calls.append("ask")
        return self.answers.pop(0)

    def _restore(self):
        self.calls.append("restore")
        return self.restored

    def fail(self, kind, at=None):
        if at is not None:
            self.now = at
        self.r.failed(kind, "Crashed", 1)

    def finish(self):
        jobs, self.jobs[:] = list(self.jobs), []
        for job in jobs:
            job()


@pytest.mark.parametrize("kind", LOST)
def test_a_lost_page_is_asked_about_once_and_restored(kind):
    c = Case()
    c.fail(kind)
    assert c.r.dead and c.calls == [], "nothing may run inside the event"
    c.finish()
    assert c.calls == ["ask", "restore"] and not c.r.dead


def test_one_question_at_a_time():
    c = Case()
    c.fail(LOST[0])
    c.fail(LOST[0])
    c.fail(LOST[1])
    assert len(c.jobs) == 1


@pytest.mark.parametrize("kind", ["GpuProcessExited", "UtilityProcessExited", "FrameRenderProcessExited",
                                  "SandboxHelperProcessExited", "UnknownProcessExited"])
def test_what_webview2_recovers_itself_is_only_logged(kind, caplog):
    c = Case()
    with caplog.at_level("ERROR"):
        c.fail(kind)
    assert c.jobs == [] and not c.r.dead and kind in caplog.text


def test_no_answer_for_a_moment_is_no_reason_to_ask():
    c = Case()
    c.fail(desktop.VIEW_HUNG, at=0)
    assert c.jobs == []
    c.fail(desktop.VIEW_HUNG, at=100)              # long after: a new moment
    assert c.jobs == []
    c.fail(desktop.VIEW_HUNG, at=115)              # still, seconds later: it hangs
    assert len(c.jobs) == 1 and not c.r.dead
    c.finish()
    assert c.calls == ["ask", "restore"]


def test_declined_stays_dead_and_asks_again_only_for_a_new_failure():
    c = Case(answers=[False, True])
    c.fail(LOST[0])
    c.finish()
    assert c.calls == ["ask"] and c.r.dead
    c.fail(LOST[0], at=10)
    c.finish()
    assert c.calls == ["ask", "ask", "restore"] and not c.r.dead


def test_dies_while_asking_about_a_hanging_page():
    c = Case(answers=[False, True])                # "keep waiting", then it is gone
    c.fail(desktop.VIEW_HUNG, at=0)
    c.fail(desktop.VIEW_HUNG, at=15)
    c.fail(LOST[0], at=16)
    c.finish()
    assert c.calls == ["ask", "ask", "restore"]


def test_the_third_failure_in_five_minutes_is_not_restored():
    c = Case(answers=[True] * 9)
    for at in (0, 100, 200):
        c.fail(LOST[0], at=at)
        c.finish()
    assert c.calls == ["ask", "restore", "ask", "restore", "gave up"] and c.r.dead


def test_failures_far_apart_are_restored_every_time():
    c = Case(answers=[True] * 9)
    for at in (0, 200, 400, 600):
        c.fail(LOST[0], at=at)
        c.finish()
    assert c.calls == ["ask", "restore"] * 4


def test_a_recovery_that_does_not_get_ready_is_said_so():
    c = Case(restored=False)
    c.fail(LOST[0])
    c.finish()
    assert c.calls == ["ask", "restore", "gave up"] and c.r.dead


def test_texts_in_both_languages():
    assert desktop.MESSAGES["cs"]["view_failed"] == "Zobrazení NoirPadu přestalo reagovat.\n\nObnovit?"
    assert desktop.MESSAGES["en"]["view_failed"].endswith("Restore it?")
    for lang in desktop.MESSAGES:
        assert "{log}" in desktop.MESSAGES[lang]["view_gave_up"]


# ---- the window ----------------------------------------------------------------------

class _Event(list):
    def __iadd__(self, fn):
        self.append(fn)
        return self


class _Args:
    def __init__(self, kind):
        self.ProcessFailedKind = types.SimpleNamespace(ToString=lambda: kind)
        self.Reason = types.SimpleNamespace(ToString=lambda: "Crashed")
        self.ExitCode = 5


def _window(made):
    """pywebview's window, form and EdgeChrome, without a screen."""
    def browser():
        core = types.SimpleNamespace(ProcessFailed=_Event())
        b = types.SimpleNamespace(webview=types.SimpleNamespace(CoreWebView2=core, Dispose=lambda: made.append("disposed")))
        b.load_url = lambda url: made.append(("load", url))
        return b
    form = types.SimpleNamespace(browser=browser(), Controls=types.SimpleNamespace(Remove=lambda c: made.append("removed")))
    form.webview = form.browser.webview
    edge = types.ModuleType("webview.platforms.edgechromium")

    def edge_chrome(f, w, profile):
        made.append(("control", profile))
        return browser()
    edge.EdgeChrome = edge_chrome
    return types.SimpleNamespace(native=form, events=types.SimpleNamespace(loaded=_Event(), closing=_Event())), edge


@pytest.fixture
def view(monkeypatch, tmp_path, np_backend):
    made, boxes = [], []
    window, edge = _window(made)
    monkeypatch.setitem(sys.modules, "webview.platforms.edgechromium", edge)
    monkeypatch.setattr(desktop, "_error_box", lambda text, flags, data_dir: boxes.append(text) or desktop.IDYES)
    monkeypatch.setattr(desktop, "STARTUP_TIMEOUT", 2)

    def post(fn):                       # the UI thread; the new page gets ready soon after
        fn()
        if any(isinstance(m, tuple) and m[0] == "load" for m in made):
            threading.Timer(0.2, RUNTIME.page_ready.set).start()
    recovery = desktop._watch_view(window, "http://127.0.0.1:1/#token=t", tmp_path, tmp_path / "webview", "cs", post=post)
    for fn in window.events.loaded:
        fn()
    yield types.SimpleNamespace(window=window, made=made, boxes=boxes, recovery=recovery)
    RUNTIME.data_notice = None
    RUNTIME.page_ready.clear()


def _wait(cond, seconds=5):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if cond():
            return True
        time.sleep(0.05)
    return False


def test_the_same_window_gets_a_new_control_with_the_token(view):
    RUNTIME.unlocked["tok"] = {"note_id": "n"}
    RUNTIME.app_lock_tokens.add("a")
    core = view.window.native.browser.webview.CoreWebView2
    assert len(core.ProcessFailed) == 1
    core.ProcessFailed[0](None, _Args("BrowserProcessExited"))
    assert _wait(lambda: not view.recovery.dead and not view.recovery._busy)
    assert view.boxes == [desktop.MESSAGES["cs"]["view_failed"]]
    assert view.made[:2] == ["removed", "disposed"]
    assert ("load", "http://127.0.0.1:1/#token=t") in view.made
    assert RUNTIME.data_notice == {"code": "view_restored", "params": {}}
    assert RUNTIME.unlocked == {} and RUNTIME.app_lock_tokens == set()      # passwords are asked again


def test_the_new_control_is_watched_too_and_no_control_twice(view):
    old = view.window.native.browser.webview.CoreWebView2
    for fn in view.window.events.loaded:          # the page reloads by itself
        fn()
    assert len(old.ProcessFailed) == 1
    old.ProcessFailed[0](None, _Args("RenderProcessExited"))
    assert _wait(lambda: not view.recovery._busy and not view.recovery.dead)
    new = view.window.native.browser.webview.CoreWebView2
    assert new is not old and len(new.ProcessFailed) == 0
    for fn in view.window.events.loaded:
        fn()
    assert len(new.ProcessFailed) == 1


def test_a_dead_page_never_delays_closing():
    events = types.SimpleNamespace(closing=_Event())
    window = types.SimpleNamespace(events=events, evaluate_js=lambda *a: pytest.fail("asked a dead page"),
                                   destroy=lambda: None)
    desktop._save_before_close(window, lambda: True)
    assert events.closing[0]() is True


def test_a_living_page_is_still_asked_to_save_first():
    asked = threading.Event()
    events = types.SimpleNamespace(closing=_Event())
    window = types.SimpleNamespace(events=events, evaluate_js=lambda script, cb=None: asked.set() or (cb and cb("close")),
                                   destroy=lambda: None)
    desktop._save_before_close(window, lambda: False)
    assert events.closing[0]() is False
    assert asked.wait(5)


def test_the_window_is_watched_and_closes_by_that():
    src = (ROOT / "desktop.py").read_text(encoding="utf-8")
    body = src.split("def _show_window", 1)[1].split("\ndef ", 1)[0]
    assert "recovery = _watch_view(window, window_url," in body
    assert "_save_before_close(window, lambda: recovery.dead)" in body


def test_the_notice_reaches_the_page(client, monkeypatch):
    monkeypatch.setattr(RUNTIME, "data_notice", {"code": "view_restored", "params": {}})
    assert client.get("/api/session").json()["data_notice"]["code"] == "view_restored"
    assert client.post("/api/session/dismiss-notice").status_code == 200
    assert RUNTIME.data_notice is None


# ---- a real window whose processes are killed --------------------------------------------

@pytest.mark.skipif(sys.platform != "win32" or os.environ.get("NOIRPAD_GUI_TESTS") != "1",
                    reason="opens windows: NOIRPAD_GUI_TESTS=1")
@pytest.mark.parametrize("victim", ["browser", "renderer"])
def test_real_crash_is_restored_with_the_saved_text(tmp_path, victim):
    done = subprocess.run([sys.executable, str(ROOT / "tests" / "gui_crash_app.py"), str(tmp_path / "data"), victim],
                          cwd=ROOT, capture_output=True, text=True, timeout=120,
                          env={**os.environ, "NOIRPAD_DATA_DIR": str(tmp_path / "data")})
    assert "RESULT " in done.stdout, done.stdout[-2000:] + done.stderr[-2000:]
    result = json.loads(done.stdout.split("RESULT ", 1)[1].splitlines()[0])
    assert result["killed"] >= 1 and result["boxes"] == 1
    assert result["same_window"] and result["restored"]
    # Typed without a pause until the kill: at most about two seconds are missing.
    assert result["typed"] - result["text"] <= 18, result
    assert result["open_note"] and result["toast"]
    assert result["typing_works"] and result["exit_seconds"] < 10
    log = (tmp_path / "data" / "logs" / "noirpad.log").read_text(encoding="utf-8")
    kind = "BrowserProcessExited" if victim == "browser" else "RenderProcessExited"
    assert f"WebView2: {kind}" in log and "The display was restored" in log
    assert "zzzz" not in log                               # never the text of a note
