# Building NoirPad

Releases are built by `build.ps1`, locally or in GitHub Actions — the same steps either way.

## Requirements (Windows 10/11, x64)

| Tool | Version | Notes |
|---|---|---|
| Python | 3.14 (`.python-version`) | from python.org or the `py` launcher; other versions are untested |
| Node.js | 22+ | only for the JS tests (vitest); the app has no JS build step |
| Inno Setup | 6 | `ISCC.exe` on PATH or in the default install folder (`choco install innosetup`) |
| Git | any | the build refuses to run on a dirty tree |

All Python packages are pinned: `requirements.txt` (runtime) and `requirements-dev.txt`
(tests + PyInstaller). JS dev packages are pinned in `package-lock.json`.

## One command

```powershell
git clone https://github.com/arcly-studio/noirpad.git
cd noirpad
powershell -ExecutionPolicy Bypass -File build.ps1
```

`build.ps1`:

1. stops if `git status` is not clean — what ships is exactly a commit;
2. creates `.venv` (Python 3.14) if missing and installs `requirements-dev.txt`;
3. `npm ci`, then `pytest` and `vitest` — any failure stops the build;
4. PyInstaller with `noirpad.spec` → `dist\NoirPad\NoirPad.exe` (onedir; ~45 MB);
5. smoke test (`tools/smoke_test.ps1`) of that very `dist\NoirPad`: `NoirPad.exe --smoke-test`
   with a throwaway `NOIRPAD_DATA_DIR` must import every module it loads by name at run time
   (`noirpad/runtime_imports.py`), answer `GET /api/version` with 200 within 15 s, serve LICENSE and
   `THIRD-PARTY-NOTICES.txt` from the bundle on `GET /api/licenses` and exit
   cleanly — otherwise no installer is built;
6. Inno Setup with `installer.iss` → `dist\installer\NoirPad-Setup-<version>.exe` (~19 MB)
   and `NoirPad-Setup-<version>.exe.sha256`.

Options: `-Python C:\path\to\python.exe` (interpreter for the venv), `-Iscc C:\path\to\ISCC.exe`,
`-RequirementsLock requirements-ci.lock` (what CI uses, see below).

## Version

The version lives **only** in `noirpad/__version__.py` (`__version__`, plus `PROJECT_URL`). The API
(`/api/version`), the About box, the exe's version resource (spec) and the installer
(`/DAppVersion`, passed by `build.ps1`) all read it from there. A test fails if the version string
appears anywhere else.

## Store edition (MSIX)

```powershell
powershell -ExecutionPolicy Bypass -File build-msix.ps1
```

Needs the Windows SDK (`makeappx.exe`, `makepri.exe`); the script installs nothing and says what
is missing. It runs `build.ps1 -SkipInstaller` (clean tree, tests, PyInstaller, smoke test), builds
the layout `dist\msix\layout` (copy of `dist\NoirPad`, `store\Assets`, `AppxManifest.xml` from
`tools\msix_manifest.py` with version X.Y.Z.0, `resources.pri`), smoke-tests it as the Store
edition twice (writable: no file may change; write-protected with icacls: must still pass) and
packs `dist\msix\NoirPad-<version>.msix` + `.sha256`. Unsigned: the Store signs it.

Test signing for a local install (N1.11, only after an explicit yes), in Windows PowerShell 5.1:

```powershell
powershell -ExecutionPolicy Bypass -File tools\test-cert.ps1 -Create   # cert + signed copy in dist\msix-test
powershell -ExecutionPolicy Bypass -File tools\test-cert.ps1 -Remove   # remove the cert from every store
```

`-Create` makes a self-signed code-signing certificate whose Subject is exactly the manifest
`Publisher`, keeps its private key non-exportable in `Cert:\CurrentUser\My`, signs a copy of the
MSIX (`signtool sign /fd SHA256 /sha1 <thumbprint>`) into `dist\msix-test\` and exports only the
public `.cer`. Trusting that `.cer` in `Cert:\LocalMachine\TrustedPeople` is a separate manual
step as administrator. No `.pfx` is ever written.

Third-party licences of the Rust crates inside `cryptography` and `pydantic_core`: after bumping
either, run `.venv\Scripts\python.exe tools\rust_notices.py` (crate list from the wheel's SBOM,
licence files from the `.crate` archives, SHA-256 checked), then `tools\third_party_notices.py`.

## Releasing

1. Update `__version__` and add a section to `CHANGELOG.md` (`## [x.y.z] – date`).
2. Commit, then tag and push: `git tag v1.2.3 && git push origin v1.2.3`.
3. `.github/workflows/release.yml` checks that the tag matches `__version__`, runs `build.ps1` on
   `windows-latest` with a read-only token, then a separate job, the only one that may write,
   creates a **draft** release with the installer, its `.sha256` and the changelog section.
   Review it and publish.

`.github/workflows/test.yml` runs pytest + vitest and the whole `build.ps1` (incl. the smoke
test) on every push and pull request.

## Pinned tools in CI

Actions are pinned to a commit SHA with the version in a comment, Inno Setup to a version in the
workflows. Dependabot proposes updates as grouped pull requests, a week after a release.

### Python packages with hashes

The CI builds install `requirements-ci.lock` with `pip install --require-hashes`: a package whose
files changed on PyPI stops the build. Local development keeps using `requirements-dev.txt`.

`requirements.txt` and `requirements-dev.txt` stay the source of the versions. After changing one,
regenerate the lock (a throwaway venv, so your `.venv` stays as it is):

```powershell
py -3.14 -m venv $env:TEMP\np-piptools
& $env:TEMP\np-piptools\Scripts\python.exe -m pip install pip-tools
& $env:TEMP\np-piptools\Scripts\python.exe -m piptools compile --quiet --generate-hashes --allow-unsafe `
    --no-strip-extras --no-emit-index-url --output-file requirements-ci.lock requirements-dev.txt
```

Commit the result together with the change. `tests/test_ci.py` fails when the lock and the
requirements files disagree, so a forgotten lock (also on a Dependabot pull request) shows up in
the tests, before the build.

## Notes

- **Data directory:** both the exe and `python desktop.py` / `python NoirPad-web.py` use
  `%LOCALAPPDATA%\NoirPad`. For testing, set `NOIRPAD_DATA_DIR` to a scratch folder so real notes
  are never touched. `tools/demo_data.py <dir> [--lang cs]` fills a folder with demo notes;
  `tools/take_screenshots.py [--gif]` starts `desktop.py` on them and regenerates the README's
  `docs/screenshots/` (and `docs/demo.gif`) over the WebView2 DevTools protocol (needs
  `pip install playwright`, plus `ffmpeg` and `oxipng` on PATH).
- **Logo (M1 "glass sheets", green since 1.1.0):** the only sources are `docs/brand/noirpad-icon.svg`
  (40 px and up) and `noirpad-icon-small.svg` (32 px and less); `static/img/` holds identical
  copies. Every raster is rendered from them by `tools/make_icons.py` (chrome-headless-shell from
  Playwright, standard library otherwise): `docs/brand/noirpad-1024.png`, `docs/logo.png`,
  `static/img/icon-*.png`, `apple-touch-icon.png`, `noirpad.ico` (exe, window, installer),
  `static/favicon.ico`, `installer/wizard-small-*.bmp` (32-bit with alpha) and
  `docs/brand/social-preview.png`. It writes their hashes to `docs/brand/icons.json`;
  `tests/test_brand.py` fails on a hand-edited or stale raster and on a non-green icon. The UI shows the SVG through `<img>` only
  (never inline: the file has `id`s). Icon URLs in `static/index.html` and `static/manifest.json`
  end in `?v=__NP_VERSION__`; the server fills in the version, so browsers drop a cached old icon.
  `docs/brand/social-preview.png` (1280×640) is a headless-Chrome screenshot of
  `docs/brand/social-preview.html`.
- **Console:** the exe is windowed (no console). Diagnostics go to
  `%LOCALAPPDATA%\NoirPad\logs\noirpad.log`; start-up failures also show a message box.
- **Code signing:** builds are not signed, so SmartScreen warns on first run (see README).
- **Installer:** per-user (`%LOCALAPPDATA%\Programs\NoirPad`), no admin rights. The `AppId` GUID in
  `installer.iss` must never change, or upgrades and uninstall break. `AppMutex` must stay equal to
  `APP_MUTEX` in `desktop.py`.
- **Single instance:** a lock file in the data directory allows one NoirPad (desktop or web) per
  data folder; a second desktop launch brings the running window to the front.
