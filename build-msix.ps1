<#
.SYNOPSIS
    Store edition: NoirPad MSIX package from a clean checkout (N1.9).

.DESCRIPTION
      1. build.ps1 -SkipInstaller: clean tree, venv, third-party notices,
         pytest + vitest, PyInstaller, smoke test of dist\NoirPad.
      2. Package layout dist\msix\layout: a copy of dist\NoirPad, the images
         from store\Assets (tools\make_icons.py), AppxManifest.xml
         (tools\msix_manifest.py, version X.Y.Z.0 from noirpad\__version__.py)
         and resources.pri (makepri: picks the scale / target-size images).
      3. Read-only check. An installed MSIX folder is read-only, so NoirPad
         must not write next to its exe (logs, caches, __pycache__, temp):
           a. smoke test of the layout as the Store edition -> no file in the
              layout may be added or changed;
           b. write access denied to everyone (icacls), a probe write must
              fail, then the same smoke test again -> it must pass.
      4. makeappx pack -> dist\msix\NoirPad-<version>.msix + .sha256.
    Not signed: the Store signs it. A test certificate and installing the
    package are N1.11 (only after the user's explicit yes).

    Needs the Windows SDK (makeappx.exe, makepri.exe). Nothing is installed
    by this script; without the SDK it stops and says what to install.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File build-msix.ps1
#>
[CmdletBinding()]
param(
    [string]$Python = "",
    [string]$RequirementsLock = ""
)

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

function Step($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Fail($text) { Write-Host "MSIX BUILD FAILED: $text" -ForegroundColor Red; exit 1 }
function Run {
    $exe, $rest = $args
    & $exe @rest
    if ($LASTEXITCODE -ne 0) { Fail "$exe $($rest -join ' ') (exit $LASTEXITCODE)" }
}
function SdkTool($name) {
    $found = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\$name" -ErrorAction SilentlyContinue |
        Sort-Object { [version]($_.Directory.Parent.Name) } | Select-Object -Last 1
    if (-not $found) {
        Fail ("$name not found. Install the Windows SDK (Windows 10/11 SDK, component " +
              "'MSIX Packaging Tools' / 'Windows App Certification Kit'), e.g. from " +
              "https://developer.microsoft.com/windows/downloads/windows-sdk/ - this script installs nothing.")
    }
    $found.FullName
}
# Every file in the layout with size and time: what NoirPad must leave alone.
function Snapshot($dir) {
    Get-ChildItem -LiteralPath $dir -Recurse -Force -File |
        ForEach-Object { "{0}|{1}|{2}" -f $_.FullName.Substring($dir.Length), $_.Length, $_.LastWriteTimeUtc.Ticks } |
        Sort-Object
}
function AssertUnchanged($before, $dir, $what) {
    $diff = Compare-Object $before (Snapshot $dir)
    if ($diff) {
        $diff | ForEach-Object { Write-Host "  $($_.SideIndicator) $($_.InputObject)" }
        Fail "$what wrote into the install folder (see the list above)"
    }
}
$Everyone = "*S-1-1-0"
function Unprotect($dir) {
    if (Test-Path -LiteralPath $dir) { icacls $dir /remove:d $Everyone /T /C /Q | Out-Null }
}

# ---- 1. app build (clean tree, tests, PyInstaller, smoke test) --------------
Step "build.ps1 -SkipInstaller"
$buildArgs = @{ SkipInstaller = $true }
if ($Python) { $buildArgs.Python = $Python }
if ($RequirementsLock) { $buildArgs.RequirementsLock = $RequirementsLock }
& "$PSScriptRoot\build.ps1" @buildArgs
if ($LASTEXITCODE -ne 0) { Fail "build.ps1" }

$py = (Resolve-Path ".venv\Scripts\python.exe").Path
$version = (& $py -c "from noirpad.__version__ import __version__; print(__version__)").Trim()
$msixVersion = (& $py -c "import sys; sys.path.insert(0, 'tools'); import msix_manifest as m; print(m.msix_version(m.app_version()))").Trim()

Step "Windows SDK"
$makeappx = SdkTool "makeappx.exe"
$makepri = SdkTool "makepri.exe"
Write-Host $makeappx
Write-Host $makepri

# ---- 2. layout ---------------------------------------------------------------
Step "Package layout (MSIX $msixVersion)"
$out = Join-Path $PSScriptRoot "dist\msix"
$layout = Join-Path $out "layout"
Unprotect $layout                       # a run that stopped half-way
if (Test-Path $out) { Remove-Item -Recurse -Force $out }
New-Item -ItemType Directory -Path $layout | Out-Null
Copy-Item -Path "dist\NoirPad\*" -Destination $layout -Recurse
Copy-Item -Path "store\Assets" -Destination (Join-Path $layout "Assets") -Recurse
Run $py tools\msix_manifest.py (Join-Path $layout "AppxManifest.xml")

# resources.pri from the images and the manifest only (not the whole app).
$pri = Join-Path $out "pri"
New-Item -ItemType Directory -Path $pri | Out-Null
Copy-Item -Path "store\Assets" -Destination (Join-Path $pri "Assets") -Recurse
Copy-Item -LiteralPath (Join-Path $layout "AppxManifest.xml") -Destination $pri
Run $makepri createconfig /cf (Join-Path $out "priconfig.xml") /dq en-US_cs-CZ /pv 10.0.0 /o
Run $makepri new /pr $pri /cf (Join-Path $out "priconfig.xml") /mn (Join-Path $pri "AppxManifest.xml") /of (Join-Path $layout "resources.pri") /o
Remove-Item -Recurse -Force $pri

# ---- 3. read-only install folder ----------------------------------------------
Step "Smoke test of the layout as the Store edition (nothing written next to the exe)"
$exe = Join-Path $layout "NoirPad.exe"
$before = Snapshot $layout
& "$PSScriptRoot\tools\smoke_test.ps1" -Exe $exe -Version $version -Edition store
if ($LASTEXITCODE -ne 0) { Fail "smoke test of the layout" }
AssertUnchanged $before $layout "NoirPad (writable layout)"

Step "Smoke test with the install folder write-protected (icacls)"
try {
    icacls $layout /deny "${Everyone}:(OI)(CI)(W,D,DC)" /T /C /Q | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail "icacls /deny" }
    $probe = Join-Path $layout "_internal\write-probe.tmp"
    $writable = $true
    try { [IO.File]::WriteAllText($probe, "x") } catch { $writable = $false }
    if ($writable) { Fail "the layout is still writable; the read-only test would prove nothing" }
    & "$PSScriptRoot\tools\smoke_test.ps1" -Exe $exe -Version $version -Edition store
    if ($LASTEXITCODE -ne 0) { Fail "smoke test with a read-only install folder" }
} finally {
    Unprotect $layout
}
AssertUnchanged $before $layout "NoirPad (read-only layout)"
Write-Host "Install folder untouched in both runs"

# ---- 4. pack -----------------------------------------------------------------
Step "makeappx pack"
$msix = Join-Path $out "NoirPad-$version.msix"
Run $makeappx pack /d $layout /p $msix /o
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $msix).Hash.ToLower()
Set-Content -LiteralPath "$msix.sha256" -Value "$hash  $(Split-Path $msix -Leaf)" -Encoding ascii -NoNewline

Step "Done"
Write-Host "MSIX:    dist\msix\NoirPad-$version.msix ($("{0:N1} MB" -f ((Get-Item $msix).Length / 1MB)))"
Write-Host "SHA256:  $hash"
Write-Host "Not signed (the Store signs it). Test certificate / install: N1.11."
