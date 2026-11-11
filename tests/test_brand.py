"""The logo is used everywhere and the older ones are gone: N4 replaced the
white N with a green cursor, M1 ("glass sheets", 1.0.1) replaced N4's light
page with a blue >_."""

import hashlib
import re
import struct

from noirpad.__version__ import __version__

from conftest import ROOT

OLD_ICON_SHA256 = {
    "053bc07945e506d0c642f2a65b7f4af5fbd8dec71816cc5ad34ccc8c908e6d96",   # white N
    "9dd8c35b73328d9b931e14a7334550e9a35eae90025f042049d744d4c7a101f3",   # N4 noirpad.ico
    "88ab6592094455c467c9f32f360c5d1c36debb11e5373f2fd0ef63f18f5b0e15",   # N4 favicon.ico
    "ce95ddf3616d7ded978ca65a99d16b73125cf813dae1798f138966c46ba41510",   # N4 docs/logo.png
    "1ac2db07428068b32f9281cd955068bf1b5538b5cefe1f52a1fee64123b665ae",   # N4 noirpad-1024.png
    "ce297943550fad87cb6717607b241d9be86976fb6b6aab2a65ec60126167cd87",   # N4 icon-192.png
    "b4dbb9c8ebf37c3b08f1d869417b512eac80b100e00a88fa414209958eeb3e89",   # N4 icon-512.png
    "dc76abf82a4bb8fd366282cc92836a781ea87eb3e139fb95f6b9ad5c78c72a5d",   # N4 apple-touch-icon.png
}
STATIC = ROOT / "static"


def ico_sizes(path):
    data = path.read_bytes()
    _, kind, count = struct.unpack_from("<HHH", data)
    assert kind == 1
    sizes = set()
    for i in range(count):
        w, h = data[6 + 16 * i], data[7 + 16 * i]
        sizes.add((w or 256, h or 256))
    return sizes


def test_old_icon_is_gone_everywhere():
    for path in [*ROOT.glob("*.ico"), *STATIC.rglob("*.ico"), *(ROOT / "docs").rglob("*.ico"),
                 *(STATIC / "img").glob("*.png"), *(ROOT / "docs").glob("*.png"),
                 *(ROOT / "docs" / "brand").glob("*.png")]:
        assert hashlib.sha256(path.read_bytes()).hexdigest() not in OLD_ICON_SHA256, path


def test_m1_the_ui_svgs_are_the_brand_sources_and_n4_colours_are_gone():
    for name in ("noirpad-icon.svg", "noirpad-icon-small.svg"):
        brand = (ROOT / "docs" / "brand" / name).read_bytes()
        assert (STATIC / "img" / name).read_bytes() == brand, name
    for path in [*(ROOT / "docs" / "brand").iterdir(), *STATIC.rglob("*.svg"),
                 *STATIC.rglob("*.css"), STATIC / "index.html"]:
        if path.suffix in (".svg", ".html", ".css"):
            text = path.read_text(encoding="utf-8").lower()
            assert "#d9d6cf" not in text and "#e4e1da" not in text, path    # N4's light page


def test_app_and_installer_icon_has_all_windows_sizes():
    sizes = ico_sizes(ROOT / "noirpad.ico")
    assert {(16, 16), (24, 24), (32, 32), (48, 48), (256, 256)} <= sizes
    assert 'icon="noirpad.ico"' in (ROOT / "noirpad.spec").read_text(encoding="utf-8")
    iss = (ROOT / "installer.iss").read_text(encoding="utf-8-sig")
    assert "SetupIconFile=noirpad.ico" in iss
    assert r"UninstallDisplayIcon={app}\{#AppExeName}" in iss     # the exe carries noirpad.ico


def test_favicon():
    assert {(16, 16), (32, 32)} <= ico_sizes(STATIC / "favicon.ico")


def test_wizard_images_exist_with_alpha():
    iss = (ROOT / "installer.iss").read_text(encoding="utf-8-sig")
    files = re.search(r"^WizardSmallImageFile=(.+)$", iss, re.M).group(1).split(",")
    assert len(files) >= 2 and "WizardImageAlphaFormat=defined" in iss
    for rel in files:
        data = (ROOT / rel).read_bytes()
        assert data[:2] == b"BM"
        width, height, _, bpp = struct.unpack_from("<iiHH", data, 18)
        assert width == height == int(re.search(r"(\d+)\.bmp$", rel).group(1)) and bpp == 32


def test_web_icons_and_manifest(client):
    html = client.get("/").text
    for href in re.findall(r'<link rel="(?:icon|apple-touch-icon|manifest)" href="([^"]+)"', html):
        assert client.get(href).status_code == 200, href
    assert client.get("/static/img/noirpad-icon.svg").headers["content-type"].startswith("image/svg+xml")
    response = client.get("/static/manifest.json")
    assert response.headers["content-type"].startswith("application/manifest+json")
    manifest = response.json()
    assert {"192x192", "512x512"} <= {i["sizes"] for i in manifest["icons"]}
    for icon in manifest["icons"]:
        assert client.get(icon["src"]).status_code == 200, icon["src"]


def test_m1_icon_urls_carry_the_version_so_browsers_drop_the_cached_logo(client):
    """The version is written only in __version__.py: the files carry a mark,
    the server fills it in."""
    html = client.get("/").text
    hrefs = re.findall(r'<link rel="(?:icon|apple-touch-icon|manifest)" href="([^"]+)"', html)
    srcs = [i["src"] for i in client.get("/static/manifest.json").json()["icons"]]
    assert len(hrefs) == 4 and len(srcs) == 3
    for url in hrefs + srcs:
        assert url.endswith("?v=" + __version__), url
    assert "__NP_VERSION__" not in html
    assert "?v=__NP_VERSION__" in (STATIC / "index.html").read_text(encoding="utf-8")
    assert client.head("/static/manifest.json").status_code == 200


def test_ui_shows_the_svg_logo():
    logo = "/static/img/noirpad-icon.svg"
    assert logo in (STATIC / "js" / "welcome.js").read_text(encoding="utf-8")      # start page
    assert logo in (STATIC / "js" / "auth.js").read_text(encoding="utf-8")         # login / app lock
    assert 'class="about-logo np-decorative" src="' + logo in (STATIC / "index.html").read_text(encoding="utf-8")


def test_brand_sources_and_readme_logo():
    for name in ("noirpad-icon.svg", "noirpad-icon-small.svg", "noirpad-1024.png"):
        assert (ROOT / "docs" / "brand" / name).is_file()
    png = (ROOT / "docs" / "logo.png").read_bytes()
    assert png[:8] == b"\x89PNG\r\n\x1a\n" and struct.unpack(">II", png[16:24]) == (256, 256)
    for readme in ("README.md", "README.cs.md"):
        assert '<img src="docs/logo.png"' in (ROOT / readme).read_text(encoding="utf-8")


# ---- I3–I5 (kontrola 2): instalátor -------------------------------------------

def _iss():
    return (ROOT / "installer.iss").read_text(encoding="utf-8-sig")


def test_i3_a_silent_install_installs_webview2_too():
    iss = _iss()
    prep = re.search(r"function PrepareToInstall.*?\nend;", iss, re.S).group(0)
    assert "WizardSilent() and not WebView2Installed()" in prep
    assert "InstallWebView2Silently" in prep
    body = re.search(r"procedure InstallWebView2Silently\(\);.*?\nend;", iss, re.S).group(0)
    assert "DownloadTemporaryFile" in body and "MsgBox" not in body   # never a window when silent


def test_i4_the_dir_not_empty_text_does_not_ask_for_another_folder():
    iss = _iss()
    for line in re.findall(r"^\w+\.DirNotEmpty=.*$", iss, re.M):
        assert "choose" not in line and "zvolte" not in line, line


def test_i5_copyright_and_uninstall_name():
    iss = _iss()
    assert re.search(r"^AppCopyright=\{#AppCopyright\}$", iss, re.M)
    assert re.search(r"^VersionInfoCopyright=\{#AppCopyright\}$", iss, re.M)
    assert re.search(r"^UninstallDisplayName=\{#AppName\}$", iss, re.M)
    spec = (ROOT / "noirpad.spec").read_text(encoding="utf-8")
    assert "StringStruct('LegalCopyright', 'MIT License')" not in spec
    assert "StringStruct('LegalCopyright', '{COPYRIGHT}. MIT License.')" in spec   # N9


# ---- Green M1 (N1.9-logo): every raster comes from the green SVGs -----------------
#
# tools/make_icons.py renders all of them and records the SHA-256 of the two
# SVG sources and of each output in docs/brand/icons.json. A source changed
# without a new run, an output edited by hand, or a new raster icon that the
# script does not make fails here; so does a blue (old) colour.

import json
import sys

sys.path.insert(0, str(ROOT / "tools"))
import make_icons  # noqa: E402

GREENS = ("#00ff41", "#17ff52", "#31ff66")                    # green M1 tones
OLD_BLUES = ("#3d8bff", "#1c56d6", "#4a94ff", "#5aa2ff", "#9ccaff")   # blue M1 (1.0.1)
MANIFEST = json.loads((ROOT / "docs" / "brand" / "icons.json").read_text(encoding="utf-8"))


def test_svg_sources_are_green():
    for path in (make_icons.BIG, make_icons.SMALL):
        text = path.read_text(encoding="utf-8").lower()
        assert any(c in text for c in GREENS), path.name
        assert not [c for c in OLD_BLUES if c in text], path.name


def test_rasters_were_made_from_the_current_svgs():
    sources = {p.relative_to(ROOT).as_posix(): make_icons.sha(p) for p in make_icons.SOURCES}
    assert MANIFEST["sources"] == sources, "a source changed: run tools/make_icons.py"
    for rel, digest in MANIFEST["outputs"].items():
        assert make_icons.sha(ROOT / rel) == digest, f"{rel} differs from tools/make_icons.py output"


def test_every_raster_icon_is_made_by_the_script():
    expected = {*make_icons.PNGS, *make_icons.ICOS, *make_icons.BMPS, make_icons.SOCIAL[0]}
    assert set(MANIFEST["outputs"]) == expected
    found = {p.relative_to(ROOT).as_posix()
             for pattern in ("*.ico", "docs/*.png", "docs/brand/*.png", "static/*.ico",
                             "static/img/*.png", "installer/*.bmp")
             for p in ROOT.glob(pattern)}
    assert found <= expected, sorted(found - expected)


def _colours(pixels, step=1):
    """Coloured, opaque pixels: (green-dominant, blue-dominant) counts."""
    green = blue = 0
    for i in range(0, len(pixels), 4 * step):
        r, g, b, a = pixels[i:i + 4]
        if a < 200 or max(r, g, b) - min(r, g, b) < 60:
            continue                                        # transparent, dark or grey
        if g > r and g > b:
            green += 1
        elif b > r and b > g:
            blue += 1
    return green, blue


def _assert_green(name, pixels, step=1):
    green, blue = _colours(pixels, step)
    assert green > 20 and green > 10 * blue, f"{name}: green {green}, blue {blue}"


def test_every_icon_is_green():
    for rel in ("docs/logo.png", "static/img/icon-192.png", "static/img/apple-touch-icon.png"):
        _assert_green(rel, make_icons.png_rgba((ROOT / rel).read_bytes())[2])
    for rel in make_icons.ICOS:
        data = (ROOT / rel).read_bytes()
        count = struct.unpack_from("<H", data, 4)[0]
        for i in range(count):
            size, offset = struct.unpack_from("<I", data, 6 + 16 * i + 8)[0], struct.unpack_from("<I", data, 6 + 16 * i + 12)[0]
            if data[6 + 16 * i] in (16, 20, 24):
                continue                                    # too few coloured pixels to judge
            w, _, px = make_icons.png_rgba(data[offset:offset + size])
            _assert_green(f"{rel} {w}px", px, step=4 if w >= 128 else 1)
    for rel in make_icons.BMPS:
        data = (ROOT / rel).read_bytes()
        bgra = data[struct.unpack_from("<I", data, 10)[0]:]
        rgba = bytearray(len(bgra))
        rgba[0::4], rgba[1::4], rgba[2::4], rgba[3::4] = bgra[2::4], bgra[1::4], bgra[0::4], bgra[3::4]
        _assert_green(rel, rgba)


def test_colour_check_catches_the_blue_logo():
    blue = bytes([61, 139, 255, 255]) * 100 + bytes([0, 255, 65, 255]) * 5
    green, b = _colours(blue)
    assert b == 100 and green == 5
