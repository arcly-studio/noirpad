"""N1.10: licence texts of the Rust crates compiled into Python wheels.

cryptography and pydantic_core ship native modules built from Rust crates
(and cryptography links OpenSSL statically). Their wheels carry a CycloneDX
SBOM (dist-info/sboms/*.cyclonedx.json) that lists exactly those crates with
version, SPDX licence and SHA-256 of the .crate file. This tool turns that
list into tools/notices/rust/<dist>-<version>.json with the licence files of
every crate, which tools/third_party_notices.py puts into
THIRD-PARTY-NOTICES.txt without network access.

    .venv\\Scripts\\python.exe tools\\rust_notices.py      refresh after bumping such a wheel

Each .crate comes from the local cargo cache (~/.cargo/registry/cache) or
https://static.crates.io and must match the SHA-256 in the SBOM. Only the
licence files are read from the archive; nothing is extracted to disk.

Choice for "A OR B": the first licence of PREFERENCE that is offered (MIT
first: short, and the notice keeps each crate's copyright line). "A AND B":
both. NOTICE files are always kept (Apache-2.0 section 4d).
"""

import hashlib
import io
import json
import re
import sys
import tarfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "tools" / "notices" / "rust"
CARGO_CACHE = Path.home() / ".cargo" / "registry" / "cache"

PREFERENCE = ("MIT", "Apache-2.0", "BSD-3-Clause", "BSD-2-Clause", "Zlib", "Unicode-3.0",
              "Unicode-DFS-2016", "Unlicense")
FILE_KEY = {"MIT": "mit", "Apache-2.0": "apache", "BSD-3-Clause": "bsd", "BSD-2-Clause": "bsd",
            "Zlib": "zlib", "Unicode-3.0": "unicode", "Unicode-DFS-2016": "unicode",
            "Unlicense": "unlicense"}
LICENCE_NAME = re.compile(r"^(licen[cs]e|copying|notice|unlicense)[^/]*$", re.I)
NOTICE_NAME = re.compile(r"^notice", re.I)
# A crate whose archive has no licence file at all gets the standard text of a
# licence that needs no copyright line (Apache-2.0, also the text of OpenSSL).
STANDARD = {"Apache-2.0": ROOT / "tools" / "notices" / "spdx-Apache-2.0.txt"}
NO_FILE = "standard text, the crate has no licence file"


class RustNoticeError(Exception):
    pass


# ---- the SBOM ---------------------------------------------------------------

def sbom_path(dist) -> Path | None:
    """The cargo CycloneDX SBOM of an installed distribution, if it has one."""
    for f in dist.files or []:
        p = str(f).replace("\\", "/")
        if "/sboms/" in p and p.endswith(".cyclonedx.json"):
            return Path(dist.locate_file(f))
    return None


def _walk(components):
    for c in components:
        yield c
        yield from _walk(c.get("components", []))


def crates(sbom: Path) -> list:
    """(name, version, licence expression, sha256) of the crates compiled in.

    Path dependencies (the project's own crates, download_url=file://) are
    covered by the package's own licence; "excluded" ones are not linked."""
    data = json.loads(sbom.read_text(encoding="utf-8"))
    top = data["metadata"]["component"]
    out = {}
    for c in [*_walk(data.get("components", [])), *_walk(top.get("components", []))]:
        purl = c.get("purl", "")
        if not purl.startswith("pkg:cargo/") or "download_url=file:" in purl:
            continue
        if c.get("scope") == "excluded":
            continue
        expr = " AND ".join(l["expression"] if "expression" in l else l["license"].get("id", "")
                            for l in c.get("licenses", []))
        sha = next((h["content"] for h in c.get("hashes", []) if h.get("alg") == "SHA-256"), "")
        out[(c["name"], c["version"])] = (c["name"], c["version"], expr, sha)
    return sorted(out.values(), key=lambda t: (t[0].lower(), t[1]))


def bundled_generic(dist) -> list:
    """Non-cargo components of the SBOMs (cryptography: OpenSSL)."""
    out = []
    for f in dist.files or []:
        p = str(f).replace("\\", "/")
        if "/sboms/" in p and p.endswith(".json") and not p.endswith(".cyclonedx.json"):
            data = json.loads(Path(dist.locate_file(f)).read_text(encoding="utf-8"))
            for c in data.get("components", []):
                out.append((c["name"], c["version"]))
    return sorted(out)


# ---- licence choice ---------------------------------------------------------

def _strip(s: str) -> str:
    s = s.strip()
    while s.startswith("(") and s.endswith(")"):
        s = s[1:-1].strip()
    return s


def choose(expr: str) -> list:
    """SPDX expression -> licence ids whose texts are needed."""
    chosen = []
    for term in re.split(r"\s+AND\s+", _strip(expr)):
        options = [re.sub(r"\s+WITH\s+\S+", "", _strip(o)) for o in re.split(r"\s+OR\s+", _strip(term))]
        pick = next((p for p in PREFERENCE if p in options), None)
        if not pick:
            raise RustNoticeError(f"no usable licence in {expr!r}: extend PREFERENCE")
        chosen.append(pick)
    return chosen


def pick_files(files: dict, chosen: list) -> list:
    """Licence files of the crate (name -> text) that carry the chosen licences."""
    keyed = {n for n in files if any(k in n.lower() for k in set(FILE_KEY.values()))}
    generic = [n for n in files if n not in keyed and not NOTICE_NAME.match(n)]
    picked = []
    for lic in chosen:
        hit = [n for n in files if FILE_KEY[lic] in n.lower() and not NOTICE_NAME.match(n)]
        if not hit:
            hit = generic
        if not hit:
            raise RustNoticeError(f"no {lic} licence file among {sorted(files)}")
        picked += [n for n in hit if n not in picked]
    picked += [n for n in files if NOTICE_NAME.match(n) and n not in picked]
    return sorted(picked, key=str.lower)


# ---- the .crate archives ----------------------------------------------------

def _crate_bytes(name: str, version: str, sha: str) -> bytes:
    fname = f"{name}-{version}.crate"
    for cached in sorted(CARGO_CACHE.glob(f"*/{fname}")):
        data = cached.read_bytes()
        if hashlib.sha256(data).hexdigest() == sha:
            return data
    url = f"https://static.crates.io/crates/{name}/{fname}"
    req = urllib.request.Request(url, headers={"User-Agent": "noirpad-third-party-notices"})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read()
    if hashlib.sha256(data).hexdigest() != sha:
        raise RustNoticeError(f"{fname}: SHA-256 differs from the SBOM")
    return data


def licence_files(name: str, version: str, sha: str) -> dict:
    out = {}
    with tarfile.open(fileobj=io.BytesIO(_crate_bytes(name, version, sha)), mode="r:gz") as tar:
        for m in tar.getmembers():
            parts = m.name.split("/")
            if m.isfile() and len(parts) == 2 and LICENCE_NAME.match(parts[1]):
                out[parts[1]] = tar.extractfile(m).read().decode("utf-8", errors="replace")
    return out


# ---- the stored file --------------------------------------------------------

def out_path(dist_name: str, version: str) -> Path:
    return OUT_DIR / f"{dist_name.lower().replace('-', '_')}-{version}.json"


def refresh(dist) -> Path:
    sbom = sbom_path(dist)
    if not sbom:
        raise RustNoticeError(f"{dist.metadata['Name']} has no cargo SBOM")
    records = []
    for name, version, expr, sha in crates(sbom):
        files = licence_files(name, version, sha)
        if files:
            chosen = choose(expr)
            texts = [[n, files[n]] for n in pick_files(files, chosen)]
        else:
            chosen = [lic for lic in STANDARD if re.search(rf"(^|[\s(]){re.escape(lic)}($|[\s)])", expr)]
            if not chosen:
                raise RustNoticeError(f"{name} {version}: no licence file and no standard text for {expr!r}")
            chosen = chosen[:1]
            texts = [[NO_FILE, STANDARD[chosen[0]].read_text(encoding="utf-8")]]
        records.append({"name": name, "version": version, "license": expr, "used": chosen,
                        "sha256": sha, "files": texts})
    path = out_path(dist.metadata["Name"], dist.version)
    path.parent.mkdir(parents=True, exist_ok=True)
    known = {"openssl": ("OpenSSL", "Apache-2.0")}      # name and licence of C libraries
    bundled = [[*known.get(n.lower(), (n, "")), v] for n, v in bundled_generic(dist)]
    bundled = [[n, v, lic] for n, lic, v in bundled]
    if any(not lic for *_, lic in bundled):
        raise RustNoticeError(f"unknown licence of a bundled library: {bundled}")
    payload = {"dist": dist.metadata["Name"], "version": dist.version,
               "sbom": sbom.name, "bundled": bundled,
               "crates": records}
    path.write_text(json.dumps(payload, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    return path


def main() -> int:
    import importlib.metadata as md
    sys.path.insert(0, str(ROOT / "tools"))
    from third_party_notices import _pins
    done = 0
    for name, _pin in _pins():          # only what NoirPad ships (requirements.txt)
        dist = md.distribution(name)
        if sbom_path(dist) is None:
            continue
        path = refresh(dist)
        n = len(json.loads(path.read_text(encoding="utf-8"))["crates"])
        print(f"{path.relative_to(ROOT)}: {n} crates")
        done += 1
    if not done:
        print("no installed distribution carries a cargo SBOM", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
