"""Every raster logo of NoirPad from the green M1 SVGs ("Glass sheets").

    .venv\\Scripts\\python.exe tools\\make_icons.py

Sources (the only hand-edited logo files):
  docs/brand/noirpad-icon.svg        >= 40 px
  docs/brand/noirpad-icon-small.svg  <= 32 px

Outputs (commit them with docs/brand/icons.json):
  docs/brand/noirpad-1024.png, docs/logo.png (256), static/img/icon-192.png,
  icon-512.png, apple-touch-icon.png (180), noirpad.ico (exe + installer,
  9 sizes), static/favicon.ico (16/32/48), installer/wizard-small-*.bmp
  (32-bit with alpha, Inno Setup), docs/brand/social-preview.png (rendered
  from social-preview.html, which shows noirpad-1024.png), and the MSIX
  images in store/Assets/ (tiles, Square44x44Logo target sizes, StoreLogo,
  SplashScreen; see store_assets()).

The SVGs are rendered by chrome-headless-shell (Playwright's, in
%LOCALAPPDATA%\\ms-playwright, or NOIRPAD_CHROMIUM) with a throwaway profile,
never the user's browser. Only the standard library is used; ICO entries are
PNGs (Windows Vista+).

docs/brand/icons.json records the SHA-256 of both sources and of every
output; tests/test_brand.py fails when a source changed without a new run,
or an output was replaced by hand.
"""

import hashlib
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BRAND = ROOT / "docs" / "brand"
BIG = BRAND / "noirpad-icon.svg"
SMALL = BRAND / "noirpad-icon-small.svg"
MANIFEST = BRAND / "icons.json"
SMALL_MAX = 32          # the small SVG up to this size, the big one above

PNGS = {
    "docs/brand/noirpad-1024.png": 1024,
    "docs/logo.png": 256,
    "static/img/icon-512.png": 512,
    "static/img/icon-192.png": 192,
    "static/img/apple-touch-icon.png": 180,
}
ICOS = {
    "noirpad.ico": [16, 20, 24, 32, 40, 48, 64, 128, 256],
    "static/favicon.ico": [16, 32, 48],
}
# Inno Setup WizardSmallImageFile: 100 %, 125 %, 125 % (classic), 150 %, 175 %, 200 %, 250 %
BMPS = {f"installer/wizard-small-{s}.bmp": s for s in (55, 64, 69, 83, 92, 110, 138)}
SOCIAL = ("docs/brand/social-preview.png", BRAND / "social-preview.html", (1280, 640))
# MSIX (Store edition, N1.9): store/Assets/<name>.scale-<n>.png and the
# Square44x44Logo target sizes (taskbar, Start list) in three variants. The
# logo's own dark rounded square is drawn on a transparent canvas, so plated
# and unplated look the same. Tiles: the logo centred at ICON_SHARE of the
# shorter side (Windows asks for padding on tiles and the splash screen).
STORE_DIR = "store/Assets"
STORE_SCALES = (100, 125, 150, 200, 400)
STORE_TILES = {                     # name: (width, height, share of the shorter side)
    "Square44x44Logo": (44, 44, 1.0),
    "StoreLogo": (50, 50, 1.0),
    "Square71x71Logo": (71, 71, 0.75),
    "Square150x150Logo": (150, 150, 0.6),
    "Wide310x150Logo": (310, 150, 0.6),
    "Square310x310Logo": (310, 310, 0.55),
    "SplashScreen": (620, 300, 200 / 300),
}
STORE_TARGET_SIZES = (16, 24, 32, 48, 256)
STORE_VARIANTS = ("", "_altform-unplated", "_altform-lightunplated")


def store_assets() -> dict:
    """{path: (width, height, logo size)} for every MSIX image."""
    out = {}
    for name, (w, h, share) in STORE_TILES.items():
        for scale in STORE_SCALES:
            sw, sh = round(w * scale / 100), round(h * scale / 100)
            out[f"{STORE_DIR}/{name}.scale-{scale}.png"] = (sw, sh, round(min(sw, sh) * share))
    for size in STORE_TARGET_SIZES:
        for variant in STORE_VARIANTS:
            out[f"{STORE_DIR}/Square44x44Logo.targetsize-{size}{variant}.png"] = (size, size, size)
    return out


# Files the outputs depend on (hashes in icons.json).
SOURCES = (BIG, SMALL, BRAND / "social-preview.html")


# ---- Chromium -------------------------------------------------------------------

def chromium() -> str:
    """chrome-headless-shell (Playwright's headless Chromium; the full browser
    hangs on --screenshot). NOIRPAD_CHROMIUM overrides it."""
    env = os.environ.get("NOIRPAD_CHROMIUM")
    if env:
        return env
    pw = Path(os.environ.get("LOCALAPPDATA", "")) / "ms-playwright"
    found = sorted(pw.glob("chromium_headless_shell-*/chrome-headless-shell-win*/chrome-headless-shell.exe"),
                   key=lambda p: int(p.parent.parent.name.rsplit("-", 1)[1]))
    if found:
        return str(found[-1])
    sys.exit("No chrome-headless-shell found: run npx playwright install chromium-headless-shell "
             "or set NOIRPAD_CHROMIUM")


def screenshot(url: str, width: int, height: int, tmp: Path) -> bytes:
    out = tmp / "shot.png"
    if out.exists():
        out.unlink()
    subprocess.run([chromium(), "--disable-gpu", "--hide-scrollbars",
                    f"--user-data-dir={tmp / 'profile'}", "--force-device-scale-factor=1",
                    "--default-background-color=00000000", "--allow-file-access-from-files",
                    f"--window-size={width},{height}", f"--screenshot={out}", url],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60)
    data = out.read_bytes()
    w, h = struct.unpack(">II", data[16:24])
    if (w, h) != (width, height):
        raise SystemExit(f"Chromium gave {w}x{h}, expected {width}x{height}")
    return data


def render_tile(width: int, height: int, logo: int, tmp: Path) -> bytes:
    """The logo (small SVG up to SMALL_MAX px) centred on a transparent canvas."""
    if (width, height) == (logo, logo):
        return render_svg(logo, tmp)
    svg = SMALL if logo <= SMALL_MAX else BIG
    page = tmp / f"tile-{width}x{height}-{logo}.html"
    page.write_text(
        "<!doctype html><html><head><style>html,body{margin:0;background:transparent;"
        f"overflow:hidden;width:{width}px;height:{height}px}}body{{display:flex;align-items:center;"
        f"justify-content:center}}img{{display:block;width:{logo}px;height:{logo}px}}</style></head>"
        f'<body><img src="{svg.as_uri()}"></body></html>', encoding="utf-8")
    return screenshot(page.as_uri(), width, height, tmp)


def render_svg(size: int, tmp: Path) -> bytes:
    svg = SMALL if size <= SMALL_MAX else BIG
    page = tmp / f"icon-{size}.html"
    page.write_text(
        "<!doctype html><html><head><style>html,body{margin:0;background:transparent;"
        f"overflow:hidden}}img{{display:block;width:{size}px;height:{size}px}}</style></head>"
        f'<body><img src="{svg.as_uri()}"></body></html>', encoding="utf-8")
    return screenshot(page.as_uri(), size, size, tmp)


# ---- PNG decode / encode (8-bit RGB/RGBA, non-interlaced: what Chromium writes) ---

def png_rgba(data: bytes):
    """-> (width, height, bytearray RGBA rows top-down)."""
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    pos, idat, ihdr = 8, b"", None
    while pos < len(data):
        length, kind = struct.unpack(">I4s", data[pos:pos + 8])
        chunk = data[pos + 8:pos + 8 + length]
        if kind == b"IHDR":
            ihdr = struct.unpack(">IIBBBBB", chunk)
        elif kind == b"IDAT":
            idat += chunk
        pos += 12 + length
    w, h, depth, ctype, _, _, interlace = ihdr
    if depth != 8 or ctype not in (2, 6) or interlace:
        raise ValueError(f"unsupported PNG (depth {depth}, colour type {ctype})")
    bpp = 4 if ctype == 6 else 3
    raw = zlib.decompress(idat)
    stride = w * bpp
    out, prev, i = bytearray(), bytearray(stride), 0
    for _ in range(h):
        f = raw[i]
        line = bytearray(raw[i + 1:i + 1 + stride])
        i += 1 + stride
        for x in range(stride):
            a = line[x - bpp] if x >= bpp else 0
            b = prev[x]
            c = prev[x - bpp] if x >= bpp else 0
            if f == 1:
                line[x] = (line[x] + a) & 255
            elif f == 2:
                line[x] = (line[x] + b) & 255
            elif f == 3:
                line[x] = (line[x] + ((a + b) >> 1)) & 255
            elif f == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        prev = line
        if bpp == 3:
            for x in range(w):
                out += line[x * 3:x * 3 + 3] + b"\xff"
        else:
            out += line
    return w, h, out


def bmp32(png: bytes) -> bytes:
    """32-bit BI_RGB bottom-up BMP with straight alpha (Inno: WizardImageAlphaFormat=defined)."""
    w, h, px = png_rgba(png)
    body = bytearray()
    for y in range(h - 1, -1, -1):
        row = px[y * w * 4:(y + 1) * w * 4]
        for x in range(w):
            r, g, b, a = row[x * 4:x * 4 + 4]
            body += bytes((b, g, r, a))
    header = struct.pack("<IiiHHIIiiII", 40, w, h, 1, 32, 0, len(body), 2835, 2835, 0, 0)
    return b"BM" + struct.pack("<IHHI", 14 + 40 + len(body), 0, 0, 54) + header + bytes(body)


def ico(pngs: list) -> bytes:
    head = struct.pack("<HHH", 0, 1, len(pngs))
    offset = 6 + 16 * len(pngs)
    entries, blobs = b"", b""
    for size, data in pngs:
        s = 0 if size >= 256 else size
        entries += struct.pack("<BBBBHHII", s, s, 0, 0, 1, 32, len(data), offset + len(blobs))
        blobs += data
    return head + entries + blobs


# ---- main ---------------------------------------------------------------------------

def sha(path: Path) -> str:
    """SHA-256; text sources with LF line ends (same result for CRLF checkouts)."""
    data = path.read_bytes()
    if path.suffix in (".svg", ".html"):
        data = data.replace(b"\r\n", b"\n")
    return hashlib.sha256(data).hexdigest()


def main() -> int:
    tmp = Path(tempfile.mkdtemp(prefix="noirpad-icons-"))
    try:
        cache = {}

        def icon(size):
            if size not in cache:
                cache[size] = render_svg(size, tmp)
            return cache[size]

        written = {}
        for rel, size in PNGS.items():
            written[rel] = icon(size)
        for rel, sizes in ICOS.items():
            written[rel] = ico([(s, icon(s)) for s in sizes])
        for rel, size in BMPS.items():
            written[rel] = bmp32(icon(size))
        (ROOT / STORE_DIR).mkdir(parents=True, exist_ok=True)
        for rel, (w, h, logo) in store_assets().items():
            written[rel] = icon(w) if w == h == logo else render_tile(w, h, logo, tmp)
        for rel, data in written.items():
            (ROOT / rel).write_bytes(data)
            print(rel)
        # After noirpad-1024.png is written: the preview shows it.
        rel, page, (w, h) = SOCIAL
        (ROOT / rel).write_bytes(screenshot(page.as_uri(), w, h, tmp))
        print(rel)
        manifest = {
            "generator": "tools/make_icons.py",
            "sources": {p.relative_to(ROOT).as_posix(): sha(p) for p in SOURCES},
            "outputs": {r: sha(ROOT / r) for r in sorted([*written, rel])},
        }
        MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        print(MANIFEST.relative_to(ROOT).as_posix())
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
