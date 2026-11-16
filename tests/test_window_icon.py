"""N1.11: the running app shows the green logo, not the old blue one.

The exe icons were already green; the blue taskbar icon after an upgrade
over 1.0.x came from Windows' icon cache. Now:
  * the installer tells Explorer to refresh icons (ChangesAssociations);
  * the window gets the green noirpad.ico with all sizes (pywebview icon=);
  * build.ps1 checks the built exe and bundle (tools/check_icons.py).
"""

import re
import struct
import sys
import zlib
from pathlib import Path

import pytest

from conftest import ROOT

import desktop

sys.path.insert(0, str(ROOT / "tools"))
import check_icons  # noqa: E402


def test_installer_refreshes_explorer_icons():
    iss = (ROOT / "installer.iss").read_text(encoding="utf-8-sig")
    setup = iss.split("[Setup]", 1)[1].split("\n[", 1)[0]
    assert re.search(r"^ChangesAssociations=yes\s*$", setup, re.M)


def test_window_gets_the_bundled_green_icon(monkeypatch):
    src = (ROOT / "desktop.py").read_text(encoding="utf-8")
    start = src[src.index("webview.start("):]
    assert "icon=_window_icon())" in start.split("\n", 1)[0]
    spec = (ROOT / "noirpad.spec").read_text(encoding="utf-8")
    assert '(str(ROOT / "noirpad.ico"), ".")' in spec
    # In the repo (not frozen) the resource path is the repo's green icon.
    assert Path(desktop._window_icon()).read_bytes() == (ROOT / "noirpad.ico").read_bytes()
    monkeypatch.setattr(desktop.config, "resource_path", lambda rel: ROOT / "missing" / rel)
    assert desktop._window_icon() is None            # pywebview's default, no crash


def test_build_checks_the_icons_after_pyinstaller():
    ps = (ROOT / "build.ps1").read_text(encoding="utf-8-sig")
    check = ps.index(r'& $py tools\check_icons.py "dist\NoirPad"')
    assert ps.index("PyInstaller (onedir)") < check < ps.index("# ---- 4. Smoke test")
    assert re.search(r'check_icons\.py "dist\\NoirPad"\s*\n\s*if \(\$LASTEXITCODE -ne 0\) \{ Fail', ps)


# ---- tools/check_icons.py -----------------------------------------------------

def _ico(images):
    """An .ico file from PNG blobs."""
    head = struct.pack("<HHH", 0, 1, len(images))
    offset = 6 + 16 * len(images)
    dirs, body = b"", b""
    for blob in images:
        w = struct.unpack(">I", blob[16:20])[0]
        dirs += struct.pack("<BBBBHHII", w % 256, w % 256, 0, 0, 1, 32, len(blob), offset + len(body))
        body += blob
    return head + dirs + body


def _png(rgb, size=16):
    """A plain RGBA PNG of one colour."""
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    row = b"\x00" + (bytes(rgb) + b"\xff") * size
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(row * size)) + chunk(b"IEND", b""))


def test_repo_icon_passes_the_colour_check():
    for blob in check_icons.ico_images((ROOT / "noirpad.ico").read_bytes()):
        green, blue = check_icons.colours(blob)
        assert green > 0 and blue == 0


def test_a_blue_icon_image_is_caught():
    green, blue = check_icons.colours(_png((0x3D, 0x8B, 0xFF)))     # old logo blue
    assert blue > 0 and green == 0


def test_bundle_check_catches_a_wrong_window_icon_and_a_stray_image(tmp_path, monkeypatch):
    folder = tmp_path / "NoirPad"
    (folder / "_internal").mkdir(parents=True)
    (folder / "NoirPad.exe").write_bytes(b"MZ")
    (folder / "_internal" / "noirpad.ico").write_bytes(_ico([_png((0x3D, 0x8B, 0xFF))]))
    (folder / "_internal" / "old-logo.png").write_bytes(_png((0x3D, 0x8B, 0xFF)))
    repo_images = check_icons.ico_images((ROOT / "noirpad.ico").read_bytes())
    monkeypatch.setattr(check_icons, "exe_icons", lambda exe: [_png((0x3D, 0x8B, 0xFF))])
    problems = "\n".join(check_icons.check(folder))
    assert "its icons are not the images of noirpad.ico" in problems
    assert "an icon image is blue" in problems
    assert "differs from the repo's noirpad.ico" in problems
    assert "old-logo.png is not made by tools/make_icons.py" in problems
    # The real thing passes.
    (folder / "_internal" / "noirpad.ico").write_bytes((ROOT / "noirpad.ico").read_bytes())
    (folder / "_internal" / "old-logo.png").unlink()
    monkeypatch.setattr(check_icons, "exe_icons", lambda exe: list(repo_images))
    assert check_icons.check(folder) == []


def test_every_image_in_git_is_made_by_the_script_or_a_ui_screenshot():
    """Guard: no icon from anywhere else can slip into the app."""
    import json
    import subprocess
    made = json.loads((ROOT / "docs" / "brand" / "icons.json").read_text(encoding="utf-8"))["outputs"]
    files = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.split("\n")
    images = [f for f in files if f.lower().endswith((".ico", ".png", ".bmp"))]
    stray = [f for f in images if f not in made and not f.startswith("docs/screenshots/")]
    assert stray == []


# ---- WebView2's own zoom back to 100 % ----------------------------------------

class _Control:
    def __init__(self, zoom):
        self.ZoomFactor = zoom


class _Form:
    def __init__(self, zoom):
        self.webview = _Control(zoom)


class _Window:
    def __init__(self, zoom):
        self.native = _Form(zoom)


@pytest.mark.parametrize("zoom", [1.25, 0.5, 3.0])
def test_left_over_webview2_zoom_is_reset(zoom):
    win, calls = _Window(zoom), []
    desktop._reset_webview_zoom(win, invoke=lambda fn: (calls.append(1), fn()))
    assert win.native.webview.ZoomFactor == 1.0 and calls == [1]       # on the UI thread


def test_zoom_reset_without_a_native_window_is_harmless():
    desktop._reset_webview_zoom(object(), invoke=lambda fn: fn())
    w = _Window(1.0)
    w.native.webview = None
    desktop._reset_webview_zoom(w, invoke=lambda fn: fn())


def test_zoom_reset_runs_when_the_page_has_loaded():
    src = (ROOT / "desktop.py").read_text(encoding="utf-8")
    assert "window.events.loaded += lambda: _reset_webview_zoom(window)" in src
