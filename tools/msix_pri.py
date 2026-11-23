"""One resources.pri for the MSIX, with every scale (build-msix.ps1).

    python tools\\msix_pri.py config <priconfig.xml>
    python tools\\msix_pri.py check <layout> <dump.xml>

makepri's default configuration splits the scales into resources.scale-125.pri
and so on, meant for resource packages of a bundle. NoirPad ships one package,
where only resources.pri counts, so Windows knew the 100 % images only and
scaled them up. "config" removes the split; "check" (on the output of
`makepri dump`) fails when an image is missing from resources.pri or another
.pri lies next to it.
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import make_icons  # noqa: E402


def single_config(xml: str) -> str:
    """priconfig.xml without <packaging> (no resource packages)."""
    out, count = re.subn(r"\s*<packaging>.*?</packaging>", "", xml, flags=re.S)
    if count != 1:
        raise ValueError(f"expected one <packaging> in the makepri configuration, found {count}")
    return out


def read_dump(path: Path) -> str:
    data = Path(path).read_bytes()
    return data.decode("utf-16" if data[:2] in (b"\xff\xfe", b"\xfe\xff") else "utf-8-sig")


def problems(layout: Path, dump: str) -> list:
    out = [f"{p.name}: only resources.pri may be in the package"
           for p in sorted(Path(layout).glob("*.pri")) if p.name.lower() != "resources.pri"]
    if not (Path(layout) / "resources.pri").is_file():
        out.append("resources.pri is missing")
    listed = {v.strip().replace("/", "\\").lower() for v in re.findall(r"<Value>([^<]+)</Value>", dump)}
    for rel in make_icons.store_assets():
        name = rel.split("/", 1)[1].replace("/", "\\")          # Assets\...
        if name.lower() not in listed:
            out.append(f"{name} is not in resources.pri")
    return out


def main(argv: list) -> int:
    if len(argv) == 2 and argv[0] == "config":
        path = Path(argv[1])
        path.write_text(single_config(path.read_text(encoding="utf-8-sig")), encoding="utf-8")
        return 0
    if len(argv) == 3 and argv[0] == "check":
        found = problems(Path(argv[1]), read_dump(Path(argv[2])))
        for p in found:
            print(f"  {p}")
        if not found:
            print(f"resources.pri: all {len(make_icons.store_assets())} images, every scale")
        return 1 if found else 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
