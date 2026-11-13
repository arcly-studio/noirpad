"""N1.9: Store edition (MSIX) — edition switch, data folder, one-time import
from the GitHub edition, AppxManifest, MSIX images, read-only install folder."""

import json
import os
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

from conftest import ROOT
from noirpad import config, edition, store_import

sys.path.insert(0, str(ROOT / "tools"))
import make_icons  # noqa: E402
import msix_manifest  # noqa: E402


# ---- edition and data folder ---------------------------------------------------

def test_not_packaged_here():
    assert edition.is_packaged() is False


@pytest.mark.parametrize("value, expected", [("store", "store"), ("github", "github"),
                                             ("STORE", "store"), ("", "github"), ("x", "github")])
def test_edition_override(monkeypatch, value, expected):
    monkeypatch.setenv("NOIRPAD_EDITION", value)
    assert edition.edition() == expected


def test_store_data_folder_is_outside_appdata(monkeypatch, tmp_path):
    monkeypatch.delenv("NOIRPAD_DATA_DIR", raising=False)
    monkeypatch.setenv("NOIRPAD_EDITION", "store")
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    assert config.get_data_dir() == tmp_path / "NoirPad"
    monkeypatch.setenv("NOIRPAD_EDITION", "github")
    assert config.get_data_dir().name == "NoirPad" and "AppData" in str(config.get_data_dir())


def test_data_dir_override_wins(monkeypatch, tmp_path):
    monkeypatch.setenv("NOIRPAD_EDITION", "store")
    monkeypatch.setenv("NOIRPAD_DATA_DIR", str(tmp_path / "x"))
    assert config.get_data_dir() == tmp_path / "x"


def test_api_version_names_the_edition(client, monkeypatch):
    assert client.get("/api/version").json()["edition"] == "github"
    monkeypatch.setenv("NOIRPAD_EDITION", "store")
    assert client.get("/api/version").json()["edition"] == "store"


def test_store_edition_does_not_take_the_installer_mutex():
    src = (ROOT / "desktop.py").read_text(encoding="utf-8")
    block = re.search(r"    if store:\n.*?    else:\n        _hold_app_mutex\(\)", src, re.S)
    assert block and len(re.findall(r"^\s+_hold_app_mutex\(\)", src, re.M)) == 1


# ---- one-time import from the GitHub edition -----------------------------------

def _github(tmp_path, images=("a.png", "b.png")):
    src = tmp_path / "github"
    (src / "images").mkdir(parents=True)
    (src / "notes_data.json").write_text('{"notes": {}}', encoding="utf-8")
    for name in images:
        (src / "images" / name).write_bytes(b"\x89PNG" + name.encode())
    (src / "backups").mkdir()
    (src / "backups" / "notes_data-20260101-000000.json").write_text("{}", encoding="utf-8")
    (src / "notes_data.corrupt-20260101-000000.json").write_text("{broken", encoding="utf-8")
    old =1_700_000_000
    for path in src.rglob("*"):
        if path.is_file():
            os.utime(path, (old, old))
    return src


def _listing(path):
    return sorted((p.relative_to(path).as_posix(), p.stat().st_size, p.stat().st_mtime_ns)
                  for p in path.rglob("*"))


@pytest.fixture
def store(monkeypatch, tmp_path):
    src = _github(tmp_path)
    monkeypatch.setenv("NOIRPAD_EDITION", "store")
    monkeypatch.setenv("NOIRPAD_IMPORT_FROM", str(src))
    monkeypatch.setattr(store_import, "_mutex_held", lambda name: False)
    return src, tmp_path / "store"


def test_import_copies_notes_and_images_with_their_times(store):
    src, target = store
    before = _listing(src)
    assert store_import.maybe_import(target) == {"code": "github_imported", "params": {}}
    assert (target / "notes_data.json").read_text(encoding="utf-8") == '{"notes": {}}'
    for name in ("notes_data.json", "images/a.png", "images/b.png"):
        assert (target / name).stat().st_mtime_ns == (src / name).stat().st_mtime_ns, name
    assert _listing(src) == before                         # source untouched, nothing written there
    assert not list(target.rglob("*.import-tmp"))


def test_import_never_copies_the_automatic_copies(store):
    """backups/ and corrupt-* stay in the GitHub folder (user's decision A, ROADMAP N1.9)."""
    src, target = store
    store_import.maybe_import(target)
    assert (target / "notes_data.json").exists()
    assert not (target / "backups").exists()
    assert not list(target.rglob("*corrupt*"))
    assert (src / "backups").exists() and list(src.glob("*corrupt*"))


def test_import_runs_once(store):
    src, target = store
    store_import.maybe_import(target)
    (src / "notes_data.json").write_text('{"changed": 1}', encoding="utf-8")
    assert store_import.maybe_import(target) is None
    assert (target / "notes_data.json").read_text(encoding="utf-8") == '{"notes": {}}'


@pytest.mark.parametrize("mine", [
    '{"notes": {"n1": {"title": "mine"}}, "tree": []}',
    '{"notes": {}, "tree": [{"id": "f1", "type": "folder"}]}',
    '{"notes": {}, "tree": [], "trash": {"tree": [], "notes": {"n1": {}}}}',
    '{"mine": 1}',
    '{broken',
])
def test_import_never_overwrites_store_notes(store, mine):
    src, target = store
    target.mkdir()
    (target / "notes_data.json").write_text(mine, encoding="utf-8")
    assert store_import.maybe_import(target) is None
    assert (target / "notes_data.json").read_text(encoding="utf-8") == mine


def test_import_after_a_blocked_start(store, monkeypatch):
    """The blocked start wrote an empty Store data file: the next start still imports."""
    src, target = store
    monkeypatch.setattr(store_import, "_mutex_held", lambda name: name == store_import.APP_MUTEX)
    assert store_import.maybe_import(target)["code"] == "github_import_blocked"
    target.mkdir(exist_ok=True)
    (target / "notes_data.json").write_text(
        '{"tree": [], "notes": {}, "trash": {"tree": [], "notes": {}}, "theme": "amber"}', encoding="utf-8")
    monkeypatch.setattr(store_import, "_mutex_held", lambda name: False)
    assert store_import.maybe_import(target) == {"code": "github_imported", "params": {}}
    assert (target / "notes_data.json").read_text(encoding="utf-8") == '{"notes": {}}'
    assert (target / "imported-from-github.json").exists()


def test_no_import_in_the_github_edition(store, monkeypatch):
    src, target = store
    monkeypatch.setenv("NOIRPAD_EDITION", "github")
    assert store_import.maybe_import(target) is None
    assert not target.exists()


def test_no_import_from_real_data_in_tests(monkeypatch):
    """With NOIRPAD_DATA_DIR set, only NOIRPAD_IMPORT_FROM is a source."""
    monkeypatch.setenv("NOIRPAD_DATA_DIR", "C:/somewhere")
    monkeypatch.delenv("NOIRPAD_IMPORT_FROM", raising=False)
    assert store_import.source_dir() is None


def test_import_waits_while_github_runs(store, monkeypatch):
    src, target = store
    monkeypatch.setattr(store_import, "_mutex_held", lambda name: name == store_import.APP_MUTEX)
    assert store_import.maybe_import(target) == {"code": "github_import_blocked", "params": {}}
    assert not (target / "notes_data.json").exists()


@pytest.mark.skipif(os.name != "nt", reason="msvcrt byte lock")
def test_import_sees_the_github_data_lock(store):
    """The GitHub edition's data lock (storage.acquire_instance_lock) blocks it."""
    from noirpad import storage
    src, target = store
    held = storage.acquire_instance_lock(src)
    try:
        assert store_import.github_running(src) is True
        assert store_import.maybe_import(target)["code"] == "github_import_blocked"
    finally:
        held.close()
    assert store_import.github_running(src) is False


def test_notice_is_shown_once(store, client):
    from noirpad import storage
    from noirpad.runtime import RUNTIME
    src, target = store
    store_import.maybe_import(target)
    assert store_import.pending_notice(target)["code"] == "github_imported"
    store_import.mark_notice_shown(target)
    assert store_import.pending_notice(target) is None
    # Through the API: dismissing the notice marks it shown in the data folder.
    marker = storage.DATA_DIR / store_import.IMPORT_MARKER
    marker.write_text(json.dumps({"notice_shown": False}), encoding="utf-8")
    RUNTIME.data_notice = {"code": "github_imported", "params": {}}
    client.post("/api/session/dismiss-notice")
    assert json.loads(marker.read_text(encoding="utf-8"))["notice_shown"] is True


@pytest.mark.parametrize("lang", ["en", "cs"])
def test_notice_texts(lang):
    notice = json.loads((ROOT / "static" / "locales" / f"{lang}.json").read_text(encoding="utf-8"))["notice"]
    done, blocked = notice["github_imported"], notice["github_import_blocked"]
    assert ("Settings → Apps" if lang == "en" else "Nastavení Windows → Aplikace") in done
    assert "GitHub" in done and "GitHub" in blocked


# ---- AppxManifest ----------------------------------------------------------------

NS = {"m": "http://schemas.microsoft.com/appx/manifest/foundation/windows10",
      "uap": "http://schemas.microsoft.com/appx/manifest/uap/windows10",
      "rescap": "http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"}


@pytest.mark.parametrize("version, expected", [("1.1.0", "1.1.0.0"), ("1.0.2", "1.0.2.0"), ("2.10.3", "2.10.3.0")])
def test_msix_version_has_a_zero_fourth_part(version, expected):
    assert msix_manifest.msix_version(version) == expected


@pytest.mark.parametrize("bad", ["1.1", "1.1.0.0", "1.1.0-beta", "1.70000.0"])
def test_msix_version_rejects(bad):
    with pytest.raises(ValueError):
        msix_manifest.msix_version(bad)


def test_manifest():
    from noirpad.__version__ import __version__
    root = ET.fromstring(msix_manifest.manifest(msix_manifest.app_version()).encode("utf-8"))
    ident = root.find("m:Identity", NS).attrib
    assert ident == {"Name": "krystof02.NoirPad", "Publisher": "CN=7A230D16-A4F0-44D2-9725-8DF77823543E",
                     "Version": __version__ + ".0", "ProcessorArchitecture": "x64"}
    assert re.fullmatch(r"\d+\.\d+\.\d+\.0", ident["Version"])
    assert root.find("m:Properties/m:PublisherDisplayName", NS).text == "Arcly Studio"
    family = root.find("m:Dependencies/m:TargetDeviceFamily", NS).attrib
    assert family == {"Name": "Windows.Desktop", "MinVersion": "10.0.17763.0", "MaxVersionTested": "10.0.26100.0"}
    app = root.find("m:Applications/m:Application", NS).attrib
    assert app["Executable"] == "NoirPad.exe" and app["EntryPoint"] == "Windows.FullTrustApplication"
    assert root.find("m:Capabilities/rescap:Capability", NS).attrib["Name"] == "runFullTrust"
    assert not re.search(r"encrypt|šifr", msix_manifest.DESCRIPTION, re.I)


def test_every_image_the_manifest_names_exists_in_all_scales():
    text = msix_manifest.manifest("1.0.0")
    names = set(re.findall(r'Assets\\(\w+)\.png', text))
    assert names == set(make_icons.STORE_TILES)
    assets = ROOT / make_icons.STORE_DIR
    for name in names:
        for scale in make_icons.STORE_SCALES:
            assert (assets / f"{name}.scale-{scale}.png").is_file(), (name, scale)
    for size in make_icons.STORE_TARGET_SIZES:
        for variant in make_icons.STORE_VARIANTS:
            assert (assets / f"Square44x44Logo.targetsize-{size}{variant}.png").is_file()


def test_store_images_have_the_right_size_and_are_green():
    import test_brand
    for rel, (w, h, _) in make_icons.store_assets().items():
        data = (ROOT / rel).read_bytes()
        assert (int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")) == (w, h), rel
    for rel in ("store/Assets/StoreLogo.scale-100.png", "store/Assets/Square150x150Logo.scale-100.png",
                "store/Assets/Square44x44Logo.targetsize-48_altform-unplated.png"):
        test_brand._assert_green(rel, make_icons.png_rgba((ROOT / rel).read_bytes())[2])


# ---- build-msix.ps1: read-only install folder --------------------------------------

def test_build_msix_checks_a_read_only_install_folder():
    ps = (ROOT / "build-msix.ps1").read_text(encoding="utf-8-sig")
    order = [ps.index(s) for s in (
        '"$PSScriptRoot\\build.ps1" @buildArgs',             # clean tree, tests, PyInstaller
        "$before = Snapshot $layout",
        "-Edition store",
        'AssertUnchanged $before $layout "NoirPad (writable layout)"',
        "Protect $layout",
        "if ($writable) { Fail",
        'AssertUnchanged $before $layout "NoirPad (read-only layout)"',
        "Run $makeappx pack",
    )]
    assert order == sorted(order)
    assert "Unprotect $layout" in ps.split("finally", 1)[1]
    assert "/inheritance:r /grant:r" in ps and "(OI)(CI)RX" in ps and "/reset /T" in ps
    assert "installs nothing" in ps and "Install-" not in ps and "winget" not in ps


def test_build_ps1_can_stop_before_the_installer():
    ps = (ROOT / "build.ps1").read_text(encoding="utf-8-sig")
    assert ps.index("if ($SkipInstaller)") > ps.index("tools\\smoke_test.ps1")
    assert ps.index("if ($SkipInstaller)") < ps.index('Step "Inno Setup"')


def test_nothing_is_written_next_to_the_exe():
    """The data folder never resolves into the program folder."""
    assert "resource_path" in (ROOT / "noirpad" / "config.py").read_text(encoding="utf-8")
    for path in [*(ROOT / "noirpad").rglob("*.py"), ROOT / "desktop.py"]:
        text = path.read_text(encoding="utf-8")
        assert not re.search(r"(_MEIPASS|sys\.executable)[^\n]*\b(write_|open\(|mkdir)", text), path


def test_import_notice_is_a_toast_not_a_dialog():
    """Information only (N1.9): NP.toast, never alert/confirm."""
    js = (ROOT / "static" / "js" / "auth.js").read_text(encoding="utf-8")
    assert re.search(r'TOAST_NOTICES = \["github_imported", "github_import_blocked"\]', js)
    assert "NP.toast(text" in js
    # The browser's own alert/confirm (NP.dialog.alert is the app's window for other notices).
    assert not re.search(r"(?<![.\w])(alert|confirm)\(|window\.(alert|confirm)\(", js)


def test_builds_do_not_delete_each_others_output():
    ps = (ROOT / "build.ps1").read_text(encoding="utf-8-sig")
    assert r'$outputs = @("build", "dist\NoirPad")' in ps
    assert 'foreach ($dir in "build", "dist")' not in ps
    assert r'"dist\msix"' not in ps.split("# ---- 3. PyInstaller", 1)[1].split("# ---- 4.", 1)[0]


# ---- N1.11 preparation: tools/test-cert.ps1 (never run by tests) ----------------

def _test_cert():
    return (ROOT / "tools" / "test-cert.ps1").read_text(encoding="utf-8-sig")


def test_test_cert_keeps_the_private_key_in_the_store():
    """No .pfx anywhere: the key is non-exportable, only the public .cer is written."""
    src = _test_cert()
    assert "-KeyExportPolicy NonExportable" in src
    assert "Export-PfxCertificate" not in src and ".pfx" not in src.replace("No .pfx", "").replace("no .pfx", "")
    assert re.search(r"Export-Certificate -Cert \$cert -FilePath \$CerFile -Type CERT", src)
    assert '-CertStoreLocation "Cert:\CurrentUser\My"' in src


def test_test_cert_subject_is_the_manifest_publisher():
    src = _test_cert()
    assert "m.PUBLISHER" in src and "-Subject $Publisher" in src
    assert "$manifest.Package.Identity.Publisher" in src and "-cne $Publisher" in src
    assert '"2.5.29.37={text}1.3.6.1.5.5.7.3.3"' in src and '"2.5.29.19={text}"' in src


def test_test_cert_signs_a_copy_and_trusts_nothing():
    """The Store package stays unsigned; trusting the .cer is the user's admin step."""
    src = _test_cert()
    assert r'$TestDir = Join-Path $Root "dist\msix-test"' in src
    assert "Copy-Item -LiteralPath $msix -Destination $test0" in src
    assert "sign /fd SHA256 /sha1 $cert.Thumbprint $file" in src
    assert "Sign $test0" in src and "Sign $test1" in src
    # Everything the script writes goes into $TestDir (dist\msix-test).
    for var in ("$test0", "$test1", "$layout", "$dir"):
        assert re.search(rf"^\s*{re.escape(var)} = Join-Path \$TestDir ", src, re.M), var
    code ="\n".join(ln for ln in src.splitlines() if not ln.lstrip().startswith(("Write-Host", "#")))
    assert "Import-Certificate" not in code and "Import-PfxCertificate" not in code
    assert "Add-AppxPackage" not in src and "Start-Process" not in src


def test_test_packages_say_test_and_only_raise_the_version():
    """Upgrade test package X.Y.Z.1: TEST in the name, nothing but Identity Version changed."""
    src = _test_cert()
    assert '"NoirPad-$baseVersion-TEST.msix"' in src
    assert '"NoirPad-$upgradeVersion-TEST-UPGRADE.msix"' in src
    assert r"$upgradeVersion = $baseVersion -replace '\.0$', '.1'" in src
    assert "$changed.Replace($upgradeVersion, $baseVersion) -ne $original" in src
    assert "Assert-Signed $test0 $baseVersion" in src and "Assert-Signed $test1 $upgradeVersion" in src
    assert "Smoke $test0" in src and "Smoke $test1" in src and "-Edition store" in src


def test_upgrade_test_version_is_never_in_git():
    """The upgrade test version (X.Y.Z.1) is computed by test-cert.ps1, never written in git."""
    out = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    from noirpad.__version__ import __version__
    test_ver = __version__ + ".1"
    hits = []
    for name in out.splitlines():
        path = ROOT / name
        if path.suffix.lower() in {".png", ".ico", ".bmp", ".gif", ".zip", ".woff2", ".ttf"} or not path.is_file():
            continue
        if test_ver in path.read_text(encoding="utf-8", errors="ignore"):
            hits.append(name)
    assert hits == []
    assert re.search(r'^__version__ = "\d+\.\d+\.\d+"$', (ROOT / "noirpad" / "__version__.py").read_text(encoding="utf-8"), re.M)


def test_test_cert_remove_looks_in_every_store():
    src = _test_cert()
    assert '"Cert:\CurrentUser", "Cert:\LocalMachine"' in src
    assert "-DeleteKey" in src
    assert "$_.Subject -eq $Publisher -and $_.Issuer -eq $Publisher" in src


def test_signing_material_is_ignored_by_git():
    lines = (ROOT / ".gitignore").read_text(encoding="utf-8").splitlines()
    for pattern in ("*.pfx", "*.p12", "*.cer", "*.key", "dist/"):
        assert pattern in lines
