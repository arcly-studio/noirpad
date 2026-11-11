<#
.SYNOPSIS
    Reproducible Windows build of NoirPad: tests → PyInstaller → Inno Setup.

.DESCRIPTION
    Run from a clean checkout (git status must be empty, otherwise the build
    stops: what ships must be exactly a commit). Steps:
      1. .venv with Python 3.14 + pinned requirements-dev.txt; THIRD-PARTY-NOTICES.txt
         must exist and match the pinned dependencies (tools\third_party_notices.py --check)
      2. npm ci (vitest) and the full test suite (pytest + vitest)
      3. PyInstaller onedir  → dist\NoirPad\NoirPad.exe
      4. Smoke test          → that NoirPad.exe must start and answer /api/version
                               (tools\smoke_test.ps1); otherwise no installer
      5. Inno Setup          → dist\installer\NoirPad-Setup-<version>.exe + .sha256
    The version comes from noirpad\__version__.py only.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File build.ps1
#>
[CmdletBinding()]
param(
    [string]$Python = "",       # interpreter for the venv; default: py -3.14
    [string]$Iscc = "",         # path to ISCC.exe; default: PATH / Inno Setup 6
    [string]$RequirementsLock = "",  # CI: install this file with --require-hashes (see BUILD.md)
    [switch]$SkipInstaller           # build-msix.ps1: stop after the smoke test (no Inno Setup)
)

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

function Step($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Fail($text) { Write-Host "BUILD FAILED: $text" -ForegroundColor Red; exit 1 }
# Run a native command; stop the build on a non-zero exit code.
function Run {
    $exe, $rest = $args
    & $exe @rest
    if ($LASTEXITCODE -ne 0) { Fail "$exe $($rest -join ' ') (exit $LASTEXITCODE)" }
}
function SizeMB($path) {
    $bytes = (Get-ChildItem -LiteralPath $path -Recurse -File | Measure-Object Length -Sum).Sum
    "{0:N1} MB" -f ($bytes / 1MB)
}

# ---- 0. clean tree ----------------------------------------------------------
Step "Checking that the working tree is clean"
$dirty = git status --porcelain
if ($LASTEXITCODE -ne 0) { Fail "not a git checkout" }
if ($dirty) {
    Write-Host $dirty
    Fail "uncommitted changes — commit or stash them first"
}
$commit = (git rev-parse --short HEAD).Trim()

# ---- 1. venv ----------------------------------------------------------------
Step "Python environment (.venv)"
if (-not (Test-Path ".venv\Scripts\python.exe")) {
    if ($Python) { Run $Python -m venv .venv }
    else { Run py -3.14 -m venv .venv }
}
$py = (Resolve-Path ".venv\Scripts\python.exe").Path
if ($RequirementsLock) {
    Run $py -m pip install --disable-pip-version-check -q --require-hashes -r $RequirementsLock
} else {
    Run $py -m pip install --disable-pip-version-check -q -r requirements-dev.txt
}
$version = (& $py -c "from noirpad.__version__ import __version__; print(__version__)").Trim()
$url = (& $py -c "from noirpad.__version__ import PROJECT_URL; print(PROJECT_URL)").Trim()
Write-Host "NoirPad $version ($commit), Python $(& $py -c 'import sys; print(sys.version.split()[0])')"

# ---- 1b. third-party notices (N8) -------------------------------------------
Step "Third-party notices"
& $py tools\third_party_notices.py --check
if ($LASTEXITCODE -ne 0) { Fail "THIRD-PARTY-NOTICES.txt is missing or out of date (tools\third_party_notices.py)" }

# ---- 2. tests ---------------------------------------------------------------
Step "Tests"
Run npm ci --no-audit --no-fund --loglevel=error
Run $py -m pytest -q
Run npx vitest run

# ---- 3. PyInstaller ---------------------------------------------------------
Step "PyInstaller (onedir)"
foreach ($dir in "build", "dist") {
    if (Test-Path $dir) { Remove-Item -Recurse -Force $dir }
}
Run $py -m PyInstaller --clean --noconfirm --log-level WARN noirpad.spec
if (-not (Test-Path "dist\NoirPad\NoirPad.exe")) { Fail "dist\NoirPad\NoirPad.exe was not created" }
Write-Host "dist\NoirPad: $(SizeMB 'dist\NoirPad')"

# ---- 4. Smoke test ----------------------------------------------------------
# On the exact dist\NoirPad that Inno Setup packs next.
Step "Smoke test (NoirPad.exe --smoke-test)"
& "$PSScriptRoot\tools\smoke_test.ps1" -Exe "dist\NoirPad\NoirPad.exe" -Version $version
if ($LASTEXITCODE -ne 0) { Fail "smoke test of dist\NoirPad\NoirPad.exe" }

if ($SkipInstaller) {
    Step "Done (no installer: -SkipInstaller)"
    Write-Host "dist\NoirPad: $(SizeMB 'dist\NoirPad')"
    exit 0
}

# ---- 5. Inno Setup ----------------------------------------------------------
Step "Inno Setup"
if (-not $Iscc) {
    $cmd = Get-Command ISCC.exe -ErrorAction SilentlyContinue
    $Iscc = if ($cmd) { $cmd.Source } else {
        @("${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "$env:ProgramFiles\Inno Setup 6\ISCC.exe",
          "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe") |
            Where-Object { Test-Path $_ } | Select-Object -First 1
    }
}
if (-not $Iscc) { Fail "ISCC.exe not found — install Inno Setup 6 or pass -Iscc" }
Run $Iscc /Q "/DAppVersion=$version" "/DAppURL=$url" installer.iss

$setup = "dist\installer\NoirPad-Setup-$version.exe"
if (-not (Test-Path $setup)) { Fail "$setup was not created" }
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $setup).Hash.ToLower()
$name = Split-Path $setup -Leaf
Set-Content -LiteralPath "$setup.sha256" -Value "$hash  $name" -Encoding ascii -NoNewline

Step "Done"
Write-Host "Installer: $setup ($(SizeMB $setup))"
Write-Host "SHA256:    $hash"
