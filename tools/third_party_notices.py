"""N8: build THIRD-PARTY-NOTICES.txt (the licences of everything NoirPad ships).

    .venv\\Scripts\\python.exe tools\\third_party_notices.py          write the file
    .venv\\Scripts\\python.exe tools\\third_party_notices.py --check  exit 1 if it is
                                                                    missing or out of date

Sources, all pinned:
  * Python runtime: tools/notices/python-<major.minor>-LICENSE.txt (copy of the
    LICENSE.txt of the Windows build; it covers OpenSSL, libffi, zlib, ...).
  * Python packages: every pin in requirements.txt, licence files from the
    installed distribution (.venv). An installed version that differs from the
    pin is an error. A package without licence files needs FALLBACK.
  * Rust crates compiled into Python packages (cryptography, pydantic_core):
    the crate list of each wheel's SBOM must match tools/notices/rust/
    <dist>-<version>.json, which tools/rust_notices.py writes with the crates'
    licence files (run it after bumping such a package).
  * WebView2 SDK (inside pywebview): tools/notices/webview2-sdk-*.txt.
  * Frontend: static/vendor/VERSIONS.json and the LICENSE files next to the
    vendored files (written by npm run vendor).
  * Theme colour palettes: kept verbatim from the current file (the section
    between PALETTES_BEGIN and PALETTES_END). The original names of those
    palettes may appear only in this file (tests/test_theme_names.py).

build.ps1 runs --check after installing the requirements; tests/
test_third_party_notices.py runs the same check.
"""

import argparse
import importlib.metadata as md
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import rust_notices  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "THIRD-PARTY-NOTICES.txt"
NOTICES = ROOT / "tools" / "notices"
VENDOR = ROOT / "static" / "vendor"

PALETTES_BEGIN = "==== BEGIN THEME PALETTES (edited by hand, kept by the generator) ===="
PALETTES_END = "==== END THEME PALETTES ===="
# Theme ids whose colours come from a published palette (one entry each).
PALETTE_THEMES = ("dracula", "synthwave", "nord", "gruvbox", "tokyo-night")

# Packages whose distribution carries no licence file: text from the project.
FALLBACK = {"proxy_tools": "proxy_tools-LICENSE.txt"}

# Licence label where the metadata has none or contradicts the licence text.
LICENCE_ID = {
    "clr_loader": "MIT",
    "proxy_tools": "BSD (text of its source repository; the PyPI metadata says MIT)",
}

# static/vendor folder -> npm package (keys of VERSIONS.json).
VENDOR_DIRS = {
    "dompurify": "dompurify",
    "highlight": "@highlightjs/cdn-assets",
    "lucide": "lucide-static",
    "markdown-it": "markdown-it",
    "markdown-it-task-lists": "markdown-it-task-lists",
    "fonts/inter": "@fontsource-variable/inter",
    "fonts/jetbrains-mono": "@fontsource-variable/jetbrains-mono",
    "fonts/orbitron": "@fontsource-variable/orbitron",
    "fonts/outfit": "@fontsource-variable/outfit",
    "fonts/space-grotesk": "@fontsource-variable/space-grotesk",
    "fonts/unbounded": "@fontsource-variable/unbounded",
}

RULE = "-" * 79
LICENCE_FILE = re.compile(r"(^|/)(licen[cs]e|copying|notice|authors)[^/]*$", re.I)


class NoticeError(Exception):
    pass


def _text(path: Path) -> str:
    """Licence text with unified line ends and no trailing blanks."""
    raw = path.read_bytes().decode("utf-8-sig", errors="replace")
    lines = [ln.rstrip() for ln in raw.replace("\r\n", "\n").replace("\r", "\n").split("\n")]
    return "\n".join(lines).strip("\n")


def _entry(title: str, meta: list, texts: list) -> str:
    head = [RULE, title, *meta, RULE]
    body = []
    for name, text in texts:
        if len(texts) > 1:
            body.append(f"[{name}]")
        body.append(text)
        body.append("")
    return "\n".join(head) + "\n" + "\n".join(body)


def _pins() -> list:
    out = []
    for line in (ROOT / "requirements.txt").read_text(encoding="utf-8").splitlines():
        line = line.split("#", 1)[0].strip()
        if not line:
            continue
        m = re.fullmatch(r"([A-Za-z0-9_.\-]+)==([^\s;]+)", line)
        if not m:
            raise NoticeError(f"requirements.txt: not an exact pin: {line!r}")
        out.append((m.group(1), m.group(2)))
    return sorted(out, key=lambda p: p[0].lower().replace("_", "-"))


def _licence_id(meta) -> str:
    expr = meta.get("License-Expression")
    if expr:
        return expr.strip()
    lic = (meta.get("License") or "").strip().splitlines()
    if lic and len(lic[0]) <= 40:
        return lic[0].strip()
    found = [c.split("::")[-1].strip() for c in meta.get_all("Classifier") or []
             if c.startswith("License ::")]
    return ", ".join(found) or "see text"


def _homepage(meta) -> str:
    urls = {}
    for item in meta.get_all("Project-URL") or []:
        label, _, url = item.partition(",")
        urls[label.strip().lower()] = url.strip()
    for key in ("source", "source code", "repository", "homepage", "home"):
        if urls.get(key):
            return urls[key]
    return (meta.get("Home-page") or "").strip() or (next(iter(urls.values()), ""))


def python_runtime() -> str:
    ver = f"{sys.version_info.major}.{sys.version_info.minor}"
    src = NOTICES / f"python-{ver}-LICENSE.txt"
    if not src.exists():
        raise NoticeError(f"{src.relative_to(ROOT)} is missing: copy LICENSE.txt of the "
                          f"Python {ver} Windows build there")
    return _entry(f"Python {ver}", [
        "License: PSF-2.0 (Python Software Foundation License Version 2)",
        "https://www.python.org/",
        "The interpreter and standard library inside NoirPad.exe. The text below also",
        "covers the libraries of the Windows build (OpenSSL, libffi, zlib, expat, ...).",
    ], [("LICENSE.txt", _text(src))])


def python_packages() -> str:
    parts = []
    for name, pin in _pins():
        try:
            dist = md.distribution(name)
        except md.PackageNotFoundError:
            raise NoticeError(f"{name} is not installed: pip install -r requirements.txt")
        if dist.version != pin:
            raise NoticeError(f"{name}: installed {dist.version}, requirements.txt pins {pin}")
        files = sorted((f for f in dist.files or [] if LICENCE_FILE.search(str(f).replace("\\", "/"))),
                       key=lambda f: str(f).lower())
        texts = [(Path(str(f)).name, _text(Path(dist.locate_file(f)))) for f in files]
        if not texts and name in FALLBACK:
            texts = [("LICENSE", _text(NOTICES / FALLBACK[name]))]
        if not texts:
            raise NoticeError(f"{name} {pin} has no licence file: add it to FALLBACK")
        meta = dist.metadata
        lines = [f"License: {LICENCE_ID.get(name) or _licence_id(meta)}"]
        home = _homepage(meta)
        if home:
            lines.append(home)
        if name in FALLBACK:
            lines.append("(The package carries no licence file; text from its source repository.)")
        parts.append(_entry(f"{meta['Name']} {pin}", lines, texts))
    return "\n".join(parts)


def _crate_line(c: dict) -> str:
    used = " AND ".join(c["used"])
    lic = c["license"] if used == c["license"] else f"{c['license']} (used: {used})"
    return f"  {c['name']} {c['version']}: {lic}"


def rust_crates() -> str:
    """Section 3: the crates of every shipped wheel with a cargo SBOM."""
    parts = []
    for name, pin in _pins():
        dist = md.distribution(name)
        sbom = rust_notices.sbom_path(dist)
        if sbom is None:
            continue
        stored = rust_notices.out_path(dist.metadata["Name"], pin)
        if not stored.exists():
            raise NoticeError(f"tools/notices/rust/{stored.name} is missing: run tools\\rust_notices.py")
        data = json.loads(stored.read_text(encoding="utf-8"))
        have = [(c["name"], c["version"], c["license"], c["sha256"]) for c in data["crates"]]
        if have != [tuple(c) for c in rust_notices.crates(sbom)]:
            raise NoticeError(f"tools/notices/rust/{stored.name} does not match the SBOM of {name} {pin}: "
                              "run tools\\rust_notices.py")
        meta = [f"Compiled into the native module of {dist.metadata['Name']} {pin}. Crate list",
                f"from the SBOM in the wheel ({data['sbom']}).",
                "For a choice (\"A OR B\") the licence used is named.",
                "", *[_crate_line(c) for c in data["crates"]]]
        groups = {}                     # same text -> the crates that carry it
        for c in data["crates"]:
            for fname, text in c["files"]:
                groups.setdefault(_norm(text), [text, []])[1].append(f"{c['name']} {c['version']} ({fname})")
        for lib, ver, lic in data.get("bundled", []):
            meta.append(f"  {lib} {ver}: {lic} (C library linked into the module)")
            text = rust_notices.STANDARD[lic].read_text(encoding="utf-8")
            groups.setdefault(_norm(text), [text, []])[1].append(f"{lib} {ver}")
        texts = [("; ".join(who), _clean(text)) for text, who in groups.values()]
        parts.append(_entry(f"Rust crates in {dist.metadata['Name']} {pin}", meta, texts))
    return "\n".join(parts)


def _clean(raw: str) -> str:
    lines = [ln.rstrip() for ln in raw.replace("\r\n", "\n").replace("\r", "\n").split("\n")]
    return "\n".join(lines).strip("\n")


def _norm(raw: str) -> str:
    return " ".join(raw.split())


def webview2() -> str:
    return _entry("Microsoft Edge WebView2 SDK", [
        "License: BSD-3-Clause (Microsoft)",
        "https://www.nuget.org/packages/Microsoft.Web.WebView2",
        "Microsoft.Web.WebView2.Core.dll, Microsoft.Web.WebView2.WinForms.dll and",
        "WebView2Loader.dll, shipped inside pywebview.",
    ], [("LICENSE.txt", _text(NOTICES / "webview2-sdk-LICENSE.txt")),
        ("NOTICE.txt", _text(NOTICES / "webview2-sdk-NOTICE.txt"))])


def frontend() -> str:
    versions = json.loads((VENDOR / "VERSIONS.json").read_text(encoding="utf-8"))
    missing = sorted(set(versions) - set(VENDOR_DIRS.values()))
    if missing:
        raise NoticeError(f"VERSIONS.json lists {missing}: add the folder to VENDOR_DIRS")
    found = {p.parent.relative_to(VENDOR).as_posix() for p in VENDOR.rglob("LICENSE*")}
    unknown = sorted(found - set(VENDOR_DIRS))
    if unknown:
        raise NoticeError(f"static/vendor/{unknown}: add the folder to VENDOR_DIRS")
    parts = []
    for folder, pkg in sorted(VENDOR_DIRS.items(), key=lambda kv: kv[1]):
        lic = sorted((VENDOR / folder).glob("LICENSE*"))
        if not lic or pkg not in versions:
            raise NoticeError(f"static/vendor/{folder}: no LICENSE or not in VERSIONS.json "
                              "(run npm run vendor)")
        parts.append(_entry(f"{pkg} {versions[pkg]}", [f"static/vendor/{folder}"],
                            [(p.name, _text(p)) for p in lic]))
    return "\n".join(parts)


def palettes(current: str) -> str:
    """The hand-written section of the current file, unchanged."""
    m = re.search(re.escape(PALETTES_BEGIN) + r"\n(.*?)\n" + re.escape(PALETTES_END), current, re.S)
    if not m:
        raise NoticeError("the theme palette section is missing from THIRD-PARTY-NOTICES.txt "
                          "(restore it from git)")
    body = m.group(1).strip("\n")
    ids = re.findall(r"^NoirPad theme id: ([\w-]+)$", body, re.M)
    if sorted(ids) != sorted(PALETTE_THEMES):
        raise NoticeError(f"theme palette section lists {ids}, expected {list(PALETTE_THEMES)}")
    return f"{PALETTES_BEGIN}\n{body}\n{PALETTES_END}"


def other() -> str:
    return _entry("Other components", [], [("", "\n".join([
        "Microsoft Visual C++ Runtime (vcruntime140.dll, vcruntime140_1.dll), shipped",
        "with Python and redistributed under the Microsoft Visual Studio",
        "redistribution terms.",
        "",
        "PyInstaller bootloader (the NoirPad.exe launcher): GPL-2.0-or-later with the",
        "PyInstaller bootloader exception, which allows distributing it with any",
        "program without further obligations. https://pyinstaller.org/",
    ]))])


def build(current: str) -> str:
    from noirpad.__version__ import COPYRIGHT  # noqa: E402 (ROOT on sys.path below)
    sections = [
        ("1. Python runtime", python_runtime()),
        ("2. Python packages", python_packages()),
        ("3. Rust crates inside Python packages", rust_crates()),
        ("4. Microsoft Edge WebView2 SDK", webview2()),
        ("5. Frontend libraries and fonts", frontend()),
        ("6. Theme colour palettes", palettes(current)),
        ("7. Other components", other()),
    ]
    head = "\n".join([
        "NoirPad third-party notices",
        "===========================",
        "",
        "NoirPad",
        COPYRIGHT,
        "MIT License, see LICENSE.",
        "",
        "NoirPad includes the third-party software listed below. Each part keeps its",
        "own licence; the full texts follow.",
        "",
        "Generated by tools/third_party_notices.py from the pinned dependencies. Do not",
        "edit by hand, except section 6, which the generator keeps as it is.",
        "",
        "Contents",
        *[f"  {title}" for title, _ in sections],
        "",
    ])
    body = "\n".join(f"\n{'=' * 79}\n{title}\n{'=' * 79}\n\n{text}" for title, text in sections)
    return head + body.rstrip("\n") + "\n"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--check", action="store_true", help="fail if the file is missing or out of date")
    args = ap.parse_args(argv)
    if not OUT.exists():
        print(f"{OUT.name} is missing (restore it from git: the theme palette section is "
              "written by hand)", file=sys.stderr)
        return 1
    current = OUT.read_bytes().decode("utf-8").replace("\r\n", "\n")
    try:
        new = build(current)
    except NoticeError as e:
        print(f"{OUT.name}: {e}", file=sys.stderr)
        return 1
    if args.check:
        if new != current:
            print(f"{OUT.name} is out of date: run tools\\third_party_notices.py and commit it",
                  file=sys.stderr)
            return 1
        print(f"{OUT.name} is up to date")
        return 0
    OUT.write_bytes(new.encode("utf-8"))
    print(f"wrote {OUT.name} ({len(new.splitlines())} lines)")
    return 0


if __name__ == "__main__":
    sys.path.insert(0, str(ROOT))
    sys.exit(main())
