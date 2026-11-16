"""N1.11: the built app shows only the green logo.

    .venv\\Scripts\\python.exe tools\\check_icons.py dist\\NoirPad

Run by build.ps1 right after PyInstaller (so also for the MSIX). Fails when:
  * the icons inside NoirPad.exe are not exactly the images of noirpad.ico;
  * the bundled noirpad.ico (window icon, desktop.py) differs from the repo's;
  * an .ico / .png / .bmp in the folder is not an output of tools/make_icons.py
    (docs/brand/icons.json);
  * any icon image of the exe has the blue of the old logo.
"""

import hashlib
import json
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
from make_icons import png_rgba  # noqa: E402

RT_ICON = 3


def ico_images(data: bytes) -> list:
    """The image blobs of an .ico file."""
    count = struct.unpack("<HHH", data[:6])[2]
    out = []
    for i in range(count):
        size, offset = struct.unpack("<II", data[6 + 16 * i + 8:6 + 16 * i + 16])
        out.append(data[offset:offset + size])
    return out


def exe_icons(exe: Path) -> list:
    import pefile
    pe = pefile.PE(str(exe), fast_load=True)
    pe.parse_data_directories(directories=[pefile.DIRECTORY_ENTRY["IMAGE_DIRECTORY_ENTRY_RESOURCE"]])
    out = []
    resources = getattr(pe, "DIRECTORY_ENTRY_RESOURCE", None)
    for kind in (resources.entries if resources else []):
        if kind.id != RT_ICON:
            continue
        for entry in kind.directory.entries:
            for lang in entry.directory.entries:
                out.append(pe.get_data(lang.data.struct.OffsetToData, lang.data.struct.Size))
    pe.close()
    return out


def colours(blob: bytes) -> tuple:
    """(green, blue) dominant opaque pixels of a PNG icon image (tests/test_brand.py rule)."""
    if blob[:8] != b"\x89PNG\r\n\x1a\n":
        return (0, 0)                      # make_icons writes PNG-in-ICO only
    _w, _h, px = png_rgba(blob)
    green = blue = 0
    for i in range(0, len(px), 4):
        r, g, b, a = px[i:i + 4]
        if a < 200 or max(r, g, b) - min(r, g, b) < 60:
            continue
        if g > r and g > b:
            green += 1
        elif b > r and b > g:
            blue += 1
    return green, blue


def check(folder: Path) -> list:
    problems = []
    repo_ico = (ROOT / "noirpad.ico").read_bytes()
    want = sorted(hashlib.sha256(b).hexdigest() for b in ico_images(repo_ico))

    exe = folder / "NoirPad.exe"
    if not exe.is_file():
        return [f"{exe} is missing"]
    icons = exe_icons(exe)
    got = sorted(hashlib.sha256(b).hexdigest() for b in icons)
    if got != want:
        problems.append(f"{exe.name}: its icons are not the images of noirpad.ico")
    for blob in icons:
        green, blue = colours(blob)
        if blue and blue * 10 >= green:
            problems.append(f"{exe.name}: an icon image is blue (green {green}, blue {blue})")

    bundled = [p for p in folder.rglob("noirpad.ico")]
    if not bundled:
        problems.append("noirpad.ico (window icon) is not in the bundle")
    for p in bundled:
        if p.read_bytes() != repo_ico:
            problems.append(f"{p.relative_to(folder)} differs from the repo's noirpad.ico")

    made = set(json.loads((ROOT / "docs" / "brand" / "icons.json").read_text(encoding="utf-8"))["outputs"].values())
    for p in folder.rglob("*"):
        if p.suffix.lower() in (".ico", ".png", ".bmp") and p.is_file():
            if hashlib.sha256(p.read_bytes()).hexdigest() not in made:
                problems.append(f"{p.relative_to(folder)} is not made by tools/make_icons.py")
    return problems


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if len(argv) != 1:
        print("usage: check_icons.py <folder with NoirPad.exe>", file=sys.stderr)
        return 2
    problems = check(Path(argv[0]))
    for p in problems:
        print(p, file=sys.stderr)
    if problems:
        return 1
    print("Icons OK: NoirPad.exe and every image in the bundle come from the green logo")
    return 0


if __name__ == "__main__":
    sys.exit(main())
