"""N1.11 test, icon finding: one logo everywhere. The Store edition's taskbar icon
differed from the exe's: noirpad.ico held two drawings (simplified up to 32 px)
and the MSIX images lacked the 30 px Windows 11 takes at 125 %, so Windows
scaled the simplified 32 px one down while the exe showed the detailed 40 px.

Now: the detailed drawing from 24 px (tuned at 24 and 32 px, same proportions),
every MSIX size is noirpad.ico's own image or resampled from it, tiles show
the logo like the exe, and one resources.pri knows every scale."""

import re
import struct
import subprocess
import sys
from pathlib import Path

import pytest

from conftest import ROOT

sys.path.insert(0, str(ROOT / "tools"))
import make_icons  # noqa: E402

ASSETS = ROOT / "store" / "Assets"
VARIANTS = ("", "_altform-unplated", "_altform-lightunplated")
# Windows 11: taskbar 24/30/36/48/60/72/96, Start 32/40/48/64/80/96/256,
# title bar 16/20/24/32/40/48/64 (100 to 400 %).
WINDOWS_SIZES = (16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 256)
# Sizes noirpad.ico does not have: the next larger image, but 30 from 40
# (what the exe shows on the taskbar at 125 %), never from the tuned 32.
RESAMPLED = {30: 40, 36: 40, 60: 64, 72: 128, 80: 128, 96: 128}
BACKGROUND = (0x0E, 0x0E, 0x10)


def ico_images():
    data, out = (ROOT / "noirpad.ico").read_bytes(), {}
    for i in range(struct.unpack_from("<H", data, 4)[0]):
        size, offset = struct.unpack_from("<II", data, 6 + 16 * i + 8)
        out[data[6 + 16 * i] or 256] = data[offset:offset + size]
    return out


ICO = ico_images()


def pixels(blob):
    return make_icons.png_rgba(blob)


def asset(name):
    return pixels((ASSETS / name).read_bytes())


def assert_close(got, want, what, limit=1):
    assert got[:2] == want[:2], what
    worst = max(abs(a - b) for a, b in zip(got[2], want[2]))
    assert worst <= limit, f"{what}: differs by {worst}"


def over_background(px):
    """RGBA pixels drawn over the tile background -> [(r, g, b), ...]"""
    out = []
    for i in range(0, len(px), 4):
        a = px[i + 3] / 255
        out.append(tuple(px[i + c] * a + BACKGROUND[c] * (1 - a) for c in range(3)))
    return out


def mean_difference(a, b):
    return sum(abs(x - y) for p, q in zip(a, b) for x, y in zip(p, q)) / (3 * len(a))


# ---- the app icon ---------------------------------------------------------------

@pytest.mark.parametrize("size", [24, 32, 40, 48, 64, 128])
def test_ico_has_one_drawing_from_24_px(size):
    """Every image from 24 px looks like the 256 px one scaled down (the
    simplified drawing, with larger and brighter sheets, differed by 28)."""
    want = over_background(pixels(make_icons.resample(ICO[256], size))[2])
    diff = mean_difference(over_background(pixels(ICO[size])[2]), want)
    assert diff < 15, f"{size} px: mean difference {diff:.1f}"


@pytest.mark.parametrize("size", [24, 32])
def test_prompt_and_rim_stand_out_at_24_and_32_px(size):
    """Tuned for legibility: a white >, and a tile edge lighter than the
    untuned drawing's, so it does not melt into a dark taskbar."""
    def lum(p):
        return 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]
    _, _, px = pixels(ICO[size])
    rows = over_background(px)
    plain = over_background(pixels(make_icons.resample(ICO[256], size))[2])
    white = [p for p in rows if min(p) > 200]
    assert len(white) >= 3
    edge = [size * (size // 2), size * (size // 2) + size - 1, size // 2, size * (size - 1) + size // 2]
    assert sum(lum(rows[i]) for i in edge) > sum(lum(plain[i]) for i in edge) + 10


def test_favicon_has_the_same_drawing():
    data, sizes = (ROOT / "static" / "favicon.ico").read_bytes(), {}
    for i in range(struct.unpack_from("<H", data, 4)[0]):
        size, offset = struct.unpack_from("<II", data, 6 + 16 * i + 8)
        sizes[data[6 + 16 * i]] = data[offset:offset + size]
    assert sizes == {s: ICO[s] for s in (16, 32, 48)}


# ---- MSIX images ------------------------------------------------------------------

def test_every_size_windows_11_asks_for_is_there():
    assert set(make_icons.STORE_TARGET_SIZES) == set(WINDOWS_SIZES)
    assert set(RESAMPLED) == set(WINDOWS_SIZES) - set(ICO)


@pytest.mark.parametrize("variant", VARIANTS)
@pytest.mark.parametrize("size", WINDOWS_SIZES)
def test_msix_size_is_the_ico_image(size, variant):
    got = asset(f"Square44x44Logo.targetsize-{size}{variant}.png")
    if size in ICO:
        assert got == pixels(ICO[size]), f"{size} px differs from noirpad.ico"
    else:
        assert_close(got, pixels(make_icons.resample(ICO[RESAMPLED[size]], size)), f"{size} px")


@pytest.mark.parametrize("scale, size, source", [(100, 44, 48), (125, 55, 64), (150, 66, 128),
                                                  (200, 88, 128), (400, 176, 256)])
def test_square44_scales_come_from_the_ico(scale, size, source):
    got = asset(f"Square44x44Logo.scale-{scale}.png")
    assert_close(got, pixels(make_icons.resample(ICO[source], size)), f"scale-{scale}")


TILES = {"StoreLogo": (50, 50), "Square71x71Logo": (71, 71), "Square150x150Logo": (150, 150),
         "Wide310x150Logo": (310, 150), "Square310x310Logo": (310, 310)}


@pytest.mark.parametrize("scale", [100, 125, 150, 200, 400])
@pytest.mark.parametrize("name", list(TILES))
def test_tiles_show_the_logo_like_the_exe_on_the_dark_background(name, scale):
    w, h, px = asset(f"{name}.scale-{scale}.png")
    assert (w, h) == tuple(round(v * scale / 100) for v in TILES[name])
    assert set(px[3::4]) == {255}, "not opaque"
    assert tuple(px[:3]) == BACKGROUND
    # The logo fills the shorter side (the exe icon has no margin either).
    side = min(w, h)
    x0, y0 = (w - side) // 2, (h - side) // 2
    logo = bytearray()
    for y in range(y0, y0 + side):
        logo += px[(y * w + x0) * 4:(y * w + x0 + side) * 4]
    size = min(48, side)
    got = over_background(pixels(make_icons.resample(make_icons.png(side, side, logo), size))[2])
    want = over_background(pixels(make_icons.resample(ICO[256], size))[2])
    diff = mean_difference(got, want)
    assert diff < 5, f"mean difference {diff:.1f}"


# ---- resources.pri ------------------------------------------------------------------

def test_build_makes_one_resources_pri_and_checks_it():
    ps = (ROOT / "build-msix.ps1").read_text(encoding="utf-8-sig")
    order = [ps.index(s) for s in (
        "Run $makepri createconfig",
        "Run $py tools\\msix_pri.py config",
        "Run $makepri new",
        "Run $makepri dump",
        "Run $py tools\\msix_pri.py check",
        "Run $makeappx pack",
    )]
    assert order == sorted(order)


def test_config_without_split_packages():
    import msix_pri
    xml = ('<resources><packaging><autoResourcePackage qualifier="Scale"/></packaging>'
           '<index root="\\"><default><qualifier name="Scale" value="100"/></default></index></resources>')
    out = msix_pri.single_config(xml)
    assert "autoResourcePackage" not in out and "packaging" not in out
    assert '<qualifier name="Scale" value="100"' in out
    with pytest.raises(ValueError):
        msix_pri.single_config("<resources><index/></resources>")      # makepri changed: look again


def _dump(paths):
    rows = "".join(f'<Candidate type="Path"><Value>{p}</Value></Candidate>' for p in paths)
    return f"<PriInfo><ResourceMap>{rows}</ResourceMap></PriInfo>"


def test_check_finds_a_missing_image_and_a_second_pri(tmp_path):
    import msix_pri
    names = [rel.split("/", 1)[1].replace("/", "\\") for rel in make_icons.store_assets()]
    (tmp_path / "resources.pri").write_bytes(b"x")
    assert msix_pri.problems(tmp_path, _dump(names)) == []
    gone = [n for n in names if n != "Assets\\StoreLogo.scale-125.png"]
    assert any("StoreLogo.scale-125" in p for p in msix_pri.problems(tmp_path, _dump(gone)))
    (tmp_path / "resources.scale-125.pri").write_bytes(b"x")
    assert any("resources.scale-125.pri" in p for p in msix_pri.problems(tmp_path, _dump(names)))


def _makepri():
    import os
    found = sorted(Path(os.environ.get("ProgramFiles(x86)", "C:/none")).glob("Windows Kits/10/bin/*/x64/makepri.exe"))
    return found[-1] if found else None


@pytest.mark.skipif(_makepri() is None, reason="Windows SDK not installed")
def test_real_makepri_puts_every_scale_into_one_file(tmp_path):
    import shutil

    import msix_manifest
    import msix_pri
    src, out = tmp_path / "src", tmp_path / "out"
    shutil.copytree(ASSETS, src / "Assets")
    out.mkdir()
    (src / "AppxManifest.xml").write_text(msix_manifest.manifest("1.0.0"), encoding="utf-8")
    cfg, dump = tmp_path / "priconfig.xml", tmp_path / "dump.xml"

    def run(*args):
        subprocess.run([str(_makepri()), *map(str, args)], check=True, capture_output=True, timeout=120)
    run("createconfig", "/cf", cfg, "/dq", "en-US_cs-CZ", "/pv", "10.0.0", "/o")
    cfg.write_text(msix_pri.single_config(cfg.read_text(encoding="utf-8-sig")), encoding="utf-8")
    run("new", "/pr", src, "/cf", cfg, "/mn", src / "AppxManifest.xml", "/of", out / "resources.pri", "/o")
    run("dump", "/if", out / "resources.pri", "/of", dump, "/o")
    assert msix_pri.problems(out, msix_pri.read_dump(dump)) == []
    assert [p.name for p in out.iterdir()] == ["resources.pri"]


def test_release_docs_name_the_medium_drawing():
    for rel in ("BUILD.md", "CLAUDE.md"):
        assert re.search(r"noirpad-icon-medium\.svg", (ROOT / rel).read_text(encoding="utf-8")), rel
