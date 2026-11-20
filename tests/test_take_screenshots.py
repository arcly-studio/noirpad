"""tools/take_screenshots.py and the WebView2 debugging port: only its own
NoirPad. A random port that is checked free first; before anything is sent
over CDP, the port must show a page of the instance it started (the backend
port from that instance's log). Otherwise it ends without sending anything.
(Once a fixed port 9333 reached another application.)"""

import importlib.util
import json
import socket
import sys
import types
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture
def shots(monkeypatch):
    # Playwright is a dev-only extra: the tool must import without it.
    monkeypatch.setitem(sys.modules, "playwright", None)
    monkeypatch.setitem(sys.modules, "playwright.sync_api", None)
    monkeypatch.syspath_prepend(str(ROOT / "tools"))
    spec = importlib.util.spec_from_file_location("take_screenshots", ROOT / "tools" / "take_screenshots.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_no_fixed_debugging_port():
    src = (ROOT / "tools" / "take_screenshots.py").read_text(encoding="utf-8")
    assert "9333" not in src
    assert "CDP_PORT" not in src


def test_free_port_has_no_listener(shots):
    port = shots.free_port()
    for family, host in ((socket.AF_INET, "127.0.0.1"), (socket.AF_INET6, "::1")):
        with socket.socket(family) as s:
            s.settimeout(0.3)
            assert s.connect_ex((host, port)) != 0


def test_a_port_someone_listens_on_is_not_free(shots, monkeypatch):
    with socket.socket() as busy:
        busy.bind(("127.0.0.1", 0))
        busy.listen()
        port = busy.getsockname()[1]
        assert shots.port_in_use(port)


def test_backend_port_comes_from_the_instance_log(shots, tmp_path):
    (tmp_path / "logs").mkdir()
    (tmp_path / "logs" / "noirpad.log").write_text(
        "2026-11-20 10:00:08,867 INFO    noirpad.desktop: Backend ready on 127.0.0.1:64156\n", encoding="utf-8")
    assert shots.backend_port(tmp_path, timeout=1) == 64156


def test_only_a_page_of_the_own_backend_counts(shots):
    targets = [
        {"type": "page", "url": "http://127.0.0.1:64745/scene.html"},       # another app
        {"type": "page", "url": "about:blank"},
        {"type": "worker", "url": "http://127.0.0.1:64156/x.js"},
    ]
    assert shots.own_target(targets, 64156) is None
    mine = {"type": "page", "url": "http://127.0.0.1:64156/#token=x"}
    assert shots.own_target(targets + [mine], 64156) is mine


class _Proc:
    pid = 4242

    def poll(self):
        return None

    def wait(self, timeout=None):
        return 0


def test_a_foreign_debugging_endpoint_gets_nothing(shots, monkeypatch, tmp_path):
    """The port answers, but with another app's pages: no CDP connection,
    the started instance is stopped, an error explains it."""
    sent = []
    pw = types.SimpleNamespace(chromium=types.SimpleNamespace(
        connect_over_cdp=lambda *a, **k: sent.append(a) or pytest.fail("connected to a foreign endpoint")))
    monkeypatch.setattr(shots.subprocess, "Popen", lambda *a, **k: _Proc())
    monkeypatch.setattr(shots.subprocess, "run", lambda *a, **k: None)
    monkeypatch.setattr(shots.time, "sleep", lambda s: None)
    monkeypatch.setattr(shots, "OWN_PAGE_TIMEOUT", 0.2, raising=False)

    def demo(data_dir, lang):
        (data_dir / "logs").mkdir(parents=True)
        (data_dir / "logs" / "noirpad.log").write_text(
            "INFO    noirpad.desktop: Backend ready on 127.0.0.1:64156\n", encoding="utf-8")

    monkeypatch.setattr(shots.demo_data, "write_demo", demo)
    foreign = json.dumps([{"type": "page", "url": "http://127.0.0.1:64745/scene.html",
                           "webSocketDebuggerUrl": "ws://127.0.0.1:1/devtools/page/x"}]).encode()
    urls = []

    def urlopen(url, timeout=None):
        urls.append(url)
        return types.SimpleNamespace(read=lambda: foreign)

    monkeypatch.setattr(shots.urllib.request, "urlopen", urlopen)
    with pytest.raises(RuntimeError, match="not this NoirPad"):
        shots.App(pw, "en")
    assert sent == []
    # only the read-only target list was asked for, never a debugger URL
    assert urls and all(u.endswith(("/json/version", "/json/list", "/json")) for u in urls)
