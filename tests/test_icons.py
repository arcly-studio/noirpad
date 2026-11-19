"""G1: the UI icons come from the bundled Lucide sprite (no CDN), and every
icon the UI asks for exists in it."""

import re

from conftest import ROOT

STATIC = ROOT / "static"
SPRITE = STATIC / "vendor" / "lucide" / "sprite.svg"


def _symbols():
    return set(re.findall(r'<symbol id="i-([\w-]+)"', SPRITE.read_text(encoding="utf-8")))


def _used():
    used = set(re.findall(r"sprite\.svg#i-([\w-]+)", (STATIC / "index.html").read_text(encoding="utf-8")))
    for js in (STATIC / "js").glob("*.js"):
        text = js.read_text(encoding="utf-8")
        used |= set(re.findall(r'NP\.icon\("([\w-]+)"', text))
        used |= set(re.findall(r'\bicon:\s*"([\w-]+)"', text))
        # setIcon(btn, "a") / setIcon(btn, cond ? "a" : "b")
        for args in re.findall(r"setIcon\([^,]+,([^)]*)\)", text):
            used |= set(re.findall(r'"([\w-]+)"', args))
        # Format menu tables (format.js): [id, "icon", "format.items.…"]
        used |= set(re.findall(r'\["[\w-]+", "([\w-]+)", "format\.items\.', text))
    return used


def test_sprite_is_bundled_with_its_licence():
    assert SPRITE.is_file()
    licence = (SPRITE.parent / "LICENSE").read_text(encoding="utf-8")
    assert "ISC License" in licence and "Cole Bemis" in licence   # Lucide + Feather (MIT)


def test_every_used_icon_exists():
    missing = _used() - _symbols()
    assert not missing, missing
    assert {"star", "lock", "lock-open", "download", "ellipsis"} <= _used()


def test_icons_are_local():
    html = (STATIC / "index.html").read_text(encoding="utf-8")
    assert "https://" not in re.sub(r"<!--.*?-->", "", html, flags=re.S)
