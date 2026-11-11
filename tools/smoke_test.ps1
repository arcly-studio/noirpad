<#
.SYNOPSIS
    Smoke test of a built NoirPad.exe: it must start its server and answer.

.DESCRIPTION
    Runs `NoirPad.exe --smoke-test` with a throwaway NOIRPAD_DATA_DIR (never
    touches real notes). The exe checks that every module NoirPad imports by
    name at run time is in the bundle (noirpad/runtime_imports.py), starts
    the server and writes its port and token to smoke-test.json. This script
    then needs GET /api/version = 200 with the expected version within
    -TimeoutSec, then GET /api/licenses = 200 with LICENSE (copyright line of
    Arcly Studio) and THIRD-PARTY-NOTICES.txt from the bundle (N8), deletes
    smoke-test.json and expects the exe to exit with 0.
    Any failure prints the exe's log and exits with 1.

    build.ps1 runs it between PyInstaller and Inno Setup, on the very
    dist\NoirPad that goes into the installer.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File tools\smoke_test.ps1 -Exe dist\NoirPad\NoirPad.exe -Version 1.0.1
#>
[CmdletBinding()]
param(
    [string]$Exe = "dist\NoirPad\NoirPad.exe",
    [string]$Version = "",          # expected /api/version; empty = don't compare
    [int]$TimeoutSec = 15
)

$ErrorActionPreference = "Stop"

function Fail($text) {
    Write-Host "SMOKE TEST FAILED: $text" -ForegroundColor Red
    $log = Join-Path $data "logs\noirpad.log"
    if (Test-Path -LiteralPath $log) {
        Write-Host "---- $log ----"
        Get-Content -LiteralPath $log -Encoding utf8 | Write-Host
    }
    exit 1
}

$Exe = (Resolve-Path -LiteralPath $Exe).Path
$data = Join-Path ([IO.Path]::GetTempPath()) ("noirpad-smoke-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $data | Out-Null
$info = Join-Path $data "smoke-test.json"

$previous = $env:NOIRPAD_DATA_DIR
$env:NOIRPAD_DATA_DIR = $data          # inherited by the exe only for this start
try {
    $proc = Start-Process -FilePath $Exe -ArgumentList "--smoke-test" -PassThru
} finally {
    $env:NOIRPAD_DATA_DIR = $previous
}
$null = $proc.Handle                    # keeps ExitCode readable after exit

try {
    $answer = $null
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline -and -not $proc.HasExited) {
        if (Test-Path -LiteralPath $info) {
            try {
                $smoke = Get-Content -LiteralPath $info -Raw -Encoding utf8 | ConvertFrom-Json
                $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 `
                    -Uri "http://127.0.0.1:$($smoke.port)/api/version" `
                    -Headers @{ "X-NoirPad-Token" = $smoke.token }
                if ($r.StatusCode -eq 200) { $answer = $r.Content | ConvertFrom-Json; break }
            } catch {
                Write-Verbose $_
            }
        }
        Start-Sleep -Milliseconds 200
    }

    if ($proc.HasExited) { Fail "NoirPad.exe exited early with code $($proc.ExitCode)" }
    if (-not $answer) { Fail "no 200 from /api/version within $TimeoutSec s" }
    if ($Version -and $answer.version -ne $Version) {
        Fail "/api/version says '$($answer.version)', expected '$Version'"
    }

    # N8: About -> Licenses reads LICENSE and THIRD-PARTY-NOTICES.txt from the bundle.
    try {
        $lr = Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 `
            -Uri "http://127.0.0.1:$($smoke.port)/api/licenses" `
            -Headers @{ "X-NoirPad-Token" = $smoke.token }
    } catch {
        Fail "/api/licenses failed: $($_.Exception.Message)"
    }
    $lic = [Text.Encoding]::UTF8.GetString($lr.RawContentStream.ToArray()) | ConvertFrom-Json
    if ($lic.license -notmatch "Copyright \(c\) 2026 Arcly Studio") {
        Fail "/api/licenses: LICENSE without the copyright line"
    }
    if ($lic.notices -notmatch "NoirPad third-party notices" -or $lic.notices -notmatch "BEGIN THEME PALETTES") {
        Fail "/api/licenses: THIRD-PARTY-NOTICES.txt missing or incomplete"
    }
    Write-Host "Smoke test: /api/licenses OK ($($lic.notices.Length) chars of notices)"

    # Ask for a clean shutdown and check it happens.
    Remove-Item -LiteralPath $info
    if (-not $proc.WaitForExit(10000)) { Fail "NoirPad.exe did not stop after the test" }
    if ($proc.ExitCode -ne 0) { Fail "NoirPad.exe exited with code $($proc.ExitCode)" }
    Write-Host "Smoke test OK: NoirPad.exe $($answer.version) answered /api/version and stopped cleanly"
} finally {
    if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
}
Remove-Item -Recurse -Force -LiteralPath $data -ErrorAction SilentlyContinue
