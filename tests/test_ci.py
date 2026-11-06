"""N14: what the release pipeline promises. The workflows only really run on
GitHub; this keeps their shape from drifting between those runs."""

import re
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
WORKFLOWS = ROOT / ".github" / "workflows"
RELEASE = (WORKFLOWS / "release.yml").read_text(encoding="utf-8")
TESTS = (WORKFLOWS / "test.yml").read_text(encoding="utf-8")
LOCK = (ROOT / "requirements-ci.lock").read_text(encoding="utf-8")


def job(text, name):
    """The block of one job in a workflow."""
    m = re.search(rf"^  {name}:\n(.*?)(?=^  \w[\w-]*:\n|\Z)", text, re.S | re.M)
    assert m, name
    return m.group(1)


def pins(path):
    found = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith("-r "):
            found.update(pins(path.parent / line[3:].strip()))
        elif line and not line.startswith("#"):
            name, _, version = line.partition("==")
            assert version, f"not pinned: {line}"
            found[name.lower().replace("_", "-")] = version
    return found


# ---- release.yml -------------------------------------------------------------


def test_only_the_publish_job_can_write():
    assert re.search(r"^permissions:\n  contents: read$", RELEASE, re.M)
    assert RELEASE.count("contents: write") == 1
    assert "contents: write" in job(RELEASE, "publish")
    assert "permissions" not in job(RELEASE, "build")


def test_the_publish_job_runs_nothing_from_the_repo():
    publish = job(RELEASE, "publish")
    assert "needs: build" in publish
    for tool in ("checkout", "pip ", "npm ", "build.ps1", "python"):
        assert tool not in publish


def test_the_build_job_cannot_reach_a_write_token():
    build = job(RELEASE, "build")
    assert "GH_TOKEN" not in build and "github.token" not in build
    assert "persist-credentials: false" in build


def test_the_draft_still_gets_the_same_four_files_and_the_notes():
    publish = job(RELEASE, "publish")
    assert re.findall(r'"release-files/([^"]+)"', publish) == [
        "NoirPad-Setup-$version.exe", "NoirPad-Setup-$version.exe.sha256",
        "NoirPad-Setup.exe", "NoirPad-Setup.exe.sha256"]
    assert "--draft" in publish
    assert "--notes-file release-files/release-notes.md" in publish
    assert '--repo "$env:GITHUB_REPOSITORY"' in publish     # there is no checkout to guess it from


def test_all_of_that_reaches_the_publish_job():
    build = job(RELEASE, "build")
    assert "path: dist/installer/" in build
    assert "if-no-files-found: error" in build
    assert "Set-Content dist/installer/release-notes.md" in build
    assert re.search(r"name: release-files", build) and re.search(r"name: release-files", job(RELEASE, "publish"))
    # the installer's own .sha256 comes from build.ps1, the stable name's from here
    assert '"$setup.sha256"' in (ROOT / "build.ps1").read_text(encoding="utf-8")
    assert '"dist/installer/NoirPad-Setup.exe.sha256"' in build


def test_the_tag_reaches_scripts_only_through_the_environment():
    runs = re.findall(r"run: \|?\n?(.*?)(?=\n      - |\Z)", RELEASE, re.S)
    assert runs
    for run in runs:
        assert "${{" not in run


# ---- pinned tools ------------------------------------------------------------


@pytest.mark.parametrize("workflow", sorted(WORKFLOWS.glob("*.yml")), ids=lambda p: p.name)
def test_actions_are_pinned_to_a_commit(workflow):
    uses = re.findall(r"uses:\s*(\S+)(.*)", workflow.read_text(encoding="utf-8"))
    assert uses
    for action, comment in uses:
        assert re.fullmatch(r"[\w./-]+@[0-9a-f]{40}", action), action
        assert re.fullmatch(r"\s*# v\d+\.\d+\.\d+", comment), action


@pytest.mark.parametrize("text", [RELEASE, TESTS], ids=["release", "test"])
def test_inno_setup_has_a_version_and_the_build_uses_the_hashes(text):
    assert re.search(r"choco install innosetup --version=\d+\.\d+\.\d+ ", text)
    assert "./build.ps1 -Python python -RequirementsLock requirements-ci.lock" in text


def test_dependabot_covers_all_three_with_a_cooldown():
    text = (ROOT / ".github" / "dependabot.yml").read_text(encoding="utf-8")
    for ecosystem in ("pip", "npm", "github-actions"):
        assert f"package-ecosystem: {ecosystem}" in text
    assert text.count("default-days: 7") == 3
    assert text.count("groups:") == 3


# ---- the lock file -----------------------------------------------------------


def test_lock_has_exactly_the_versions_of_the_requirements_files():
    locked = {name.lower().replace("_", "-"): version
              for name, version in re.findall(r"^([A-Za-z0-9_.-]+)==([^\s\\]+)", LOCK, re.M)}
    assert locked == pins(ROOT / "requirements-dev.txt")


def test_every_package_in_the_lock_has_hashes():
    blocks = re.split(r"^(?=[A-Za-z0-9_.-]+==)", LOCK, flags=re.M)[1:]
    assert blocks
    for block in blocks:
        assert "--hash=sha256:" in block, block.splitlines()[0]


def test_local_development_does_not_use_the_lock():
    build = (ROOT / "build.ps1").read_text(encoding="utf-8")
    assert '[string]$RequirementsLock = ""' in build
    assert "--require-hashes -r $RequirementsLock" in build
    assert "-q -r requirements-dev.txt" in build
    assert "pip install --disable-pip-version-check -r requirements-dev.txt" in job(TESTS, "test")


# ---- .gitignore and SECURITY.md ----------------------------------------------


@pytest.mark.parametrize("name", [".env", ".env.local", "signing.pfx", "cert.p12", "key.pem", "private.key", "x.snk"])
def test_secrets_are_ignored(name):
    r = subprocess.run(["git", "check-ignore", "-q", name], cwd=ROOT)
    assert r.returncode == 0, name


def test_security_policy_has_a_fallback_address():
    assert "arclystudio.dev@gmail.com" in (ROOT / "SECURITY.md").read_text(encoding="utf-8")
