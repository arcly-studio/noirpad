"""Step D: noirpad/__version__.py is the only place the version is written."""

import re

import subprocess

from noirpad.__version__ import AUTHOR, CONTACT_EMAIL, COPYRIGHT, PROJECT_URL, __version__

from conftest import ROOT


def test_api_version(client):
    assert client.get("/api/version").json() == {
        "version": __version__, "url": PROJECT_URL, "author": AUTHOR,
        "copyright": COPYRIGHT, "contact": CONTACT_EMAIL, "edition": "github"}


def test_fastapi_reports_same_version(np_backend):
    assert np_backend.app.version == __version__


def test_version_is_not_hardcoded_elsewhere():
    pattern = re.compile(re.escape(__version__))
    offenders = []
    for path in [*ROOT.glob("*.py"), *ROOT.glob("*.spec"), *ROOT.glob("*.iss"),
                 *ROOT.glob("*.ps1"), *(ROOT / "noirpad").rglob("*.py"),
                 *(ROOT / "static" / "js").glob("*.js"), ROOT / "static" / "index.html"]:
        if path.name == "__version__.py":
            continue
        if pattern.search(path.read_text(encoding="utf-8")):
            offenders.append(path.name)
    assert offenders == []


# Texts of others (their own copyright lines) and this test's own patterns.
THIRD_PARTY = ("THIRD-PARTY-NOTICES.txt", "tests/test_version.py")


def _tracked_text_files():
    """Every file in git (plus new ones not yet added), as text; binaries skipped."""
    out = subprocess.run(["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
                         cwd=ROOT, capture_output=True, check=True).stdout
    for rel in sorted(set(filter(None, out.decode("utf-8").split("\0")))):
        path = ROOT / rel
        if not path.is_file():
            continue
        try:
            yield rel, path.read_bytes().decode("utf-8-sig")
        except UnicodeDecodeError:
            continue


def test_project_url_and_publisher_are_the_new_owner():
    """The repository moved to the arcly-studio organization (2026-10) and is
    called noirpad in lower case (N1.7). The old owner may only remain in the
    notes for agents (CLAUDE.md)."""
    assert PROJECT_URL == "https://github.com/arcly-studio/noirpad"
    assert AUTHOR == "Arcly Studio"
    iss = (ROOT / "installer.iss").read_text(encoding="utf-8-sig")
    assert re.search(r'^#define AppPublisher\s+"Arcly Studio"', iss, re.M)      # own copy of AUTHOR
    assert PROJECT_URL in iss
    assert re.search(r"'CompanyName',\s*'\{AUTHOR\}'", (ROOT / "noirpad.spec").read_text(encoding="utf-8"))
    old_owner = [rel for rel, text in _tracked_text_files()
                 if "krystof2-ops" in text and rel not in ("CLAUDE.md", "tests/test_version.py")]
    assert old_owner == []
    # N1.7: lower-case repository URL everywhere (GitHub redirects, the docs should not).
    upper = [rel for rel, text in _tracked_text_files()
             if re.search(r"arcly-studio/NoirPad\b", text) and rel != "tests/test_version.py"]
    assert upper == []


def test_copyright_is_arcly_studio_everywhere():
    """N9: one holder, one line: LICENSE, About (/api/version), exe, installer."""
    assert COPYRIGHT == "Copyright (c) 2026 Arcly Studio"
    licence = (ROOT / "LICENSE").read_text(encoding="utf-8").splitlines()
    assert licence[0] == "MIT License" and licence[2] == COPYRIGHT
    iss = (ROOT / "installer.iss").read_text(encoding="utf-8-sig")
    assert re.search(r'^#define AppCopyright\s+"' + re.escape(COPYRIGHT) + r'\. MIT License\."', iss, re.M)
    spec = (ROOT / "noirpad.spec").read_text(encoding="utf-8")
    assert "StringStruct('LegalCopyright', '{COPYRIGHT}. MIT License.')" in spec
    assert re.search(r"^COPYRIGHT = re\.search\(r'\^COPYRIGHT", spec, re.M)
    stale = [rel for rel, text in _tracked_text_files()
             if re.search(r"NoirPad authors|Copyright \(c\) 2025", text) and rel not in THIRD_PARTY
             and not rel.startswith(("static/vendor/", "tools/notices/"))]
    assert stale == []


def test_about_contact_is_the_studio_mail():
    """N10: the address people without a GitHub account can write to."""
    assert CONTACT_EMAIL == "arclystudio.dev@gmail.com"
    html = (ROOT / "static" / "index.html").read_text(encoding="utf-8")
    assert 'id="about-contact"' in html and 'data-i18n="ui.settings.contact"' in html


def test_changelog_has_the_current_version():
    """N1.10: every version in __version__.py has its CHANGELOG entry and compare link."""
    text = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
    assert re.search(rf"^## \[{re.escape(__version__)}\] – (Unreleased|\d{{4}}-\d{{2}}-\d{{2}})$", text, re.M)
    assert re.search(rf"^\[{re.escape(__version__)}\]: https://github\.com/arcly-studio/noirpad/compare/v", text, re.M)


def test_changelog_1_1_0_is_truthful_about_encryption():
    text = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
    entry = text[text.index("## [1.1.0]"):text.index("## [1.0.2]")].replace("\n  ", " ")
    assert "Only the text and the formatting are encrypted: the note's name, tags, folder and images are not." in entry
    assert "images are not encrypted" in entry
