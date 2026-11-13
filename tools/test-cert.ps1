<#
.SYNOPSIS
    N1.11 test signing of the NoirPad MSIX for a local install. Run only after
    the user's explicit yes.

.DESCRIPTION
    -Create
      1. Reads Publisher from the AppxManifest.xml inside
         dist\msix\NoirPad-<version>.msix (build-msix.ps1) and checks it
         against tools\msix_manifest.py.
      2. Creates (or reuses) a self-signed code-signing certificate whose
         Subject is exactly that Publisher, in Cert:\CurrentUser\My. Its
         private key is NON-EXPORTABLE: it never leaves this store, no .pfx is
         written anywhere.
      3. Empties dist\msix-test and writes two TEST packages there, both signed
         (signtool sign /fd SHA256 /sha1 <thumbprint>); the Store package in
         dist\msix stays unsigned and unchanged:
           NoirPad-X.Y.Z.0-TEST.msix          copy of the Store package
           NoirPad-X.Y.Z.1-TEST-UPGRADE.msix  the same files, only Identity
                                              Version raised (upgrade test);
                                              this version is never in git.
      4. Checks both signatures from the files (signer = this certificate,
         version, Publisher) and smoke-tests both unpacked packages as the
         Store edition, writable and read-only (like build-msix.ps1).
      5. Exports only the public certificate: dist\msix-test\NoirPad-test.cer.
      Trusting that .cer (Cert:\LocalMachine\TrustedPeople) is NOT done here:
      it needs an administrator and is the user's own step (BUILD.md).

    -Remove
      Removes the test certificate from every certificate store of the current
      user and of the local machine where it is found (by the thumbprint
      recorded by -Create and by Subject = Issuer = Publisher, i.e. this
      self-signed certificate only), with its private key. A store of the local
      machine needs an administrator: the script then prints the command.

    Uses the Windows SDK signtool.exe; installs nothing. Run with Windows
    PowerShell 5.1 (PKI cmdlets): powershell -ExecutionPolicy Bypass -File ...

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File tools\test-cert.ps1 -Create
.EXAMPLE
    powershell -ExecutionPolicy Bypass -File tools\test-cert.ps1 -Remove
#>
[CmdletBinding()]
param(
    [switch]$Create,
    [switch]$Remove
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $Root

$FriendlyName = "NoirPad MSIX test certificate (N1.11)"
$TestDir = Join-Path $Root "dist\msix-test"
$Record = Join-Path $TestDir "test-cert.txt"
$CerFile = Join-Path $TestDir "NoirPad-test.cer"

function Fail($text) { Write-Host "TEST-CERT FAILED: $text" -ForegroundColor Red; exit 1 }

if ($Create -eq $Remove) { Fail "use exactly one of -Create or -Remove" }

$py = Join-Path $Root ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $py)) { Fail ".venv is missing: run build-msix.ps1 first" }
$Publisher = (& $py -c "import sys; sys.path.insert(0, 'tools'); import msix_manifest as m; print(m.PUBLISHER)").Trim()
if (-not $Publisher.StartsWith("CN=")) { Fail "no Publisher in tools\msix_manifest.py" }

# Only this self-signed test certificate: Subject and Issuer are the Publisher.
function Find-TestCerts {
    $thumbs = @()
    if (Test-Path -LiteralPath $Record) {
        $thumbs = Get-Content -LiteralPath $Record | Where-Object { $_ -match '^Thumbprint: ' } |
            ForEach-Object { ($_ -replace '^Thumbprint: ', '').Trim() }
    }
    foreach ($location in "Cert:\CurrentUser", "Cert:\LocalMachine") {
        foreach ($store in Get-ChildItem -LiteralPath $location) {
            Get-ChildItem -LiteralPath $store.PSPath -ErrorAction SilentlyContinue |
                Where-Object {
                    $_ -is [System.Security.Cryptography.X509Certificates.X509Certificate2] -and
                    (($thumbs -contains $_.Thumbprint) -or
                     ($_.Subject -eq $Publisher -and $_.Issuer -eq $Publisher))
                } |
                ForEach-Object { [pscustomobject]@{ Store = "$location\$($store.Name)"; Cert = $_ } }
        }
    }
}

# ---- -Remove ------------------------------------------------------------------
if ($Remove) {
    $found = @(Find-TestCerts)
    if (-not $found) { Write-Host "No NoirPad test certificate in any store."; exit 0 }
    $left = @()
    foreach ($item in $found) {
        $path = "$($item.Store)\$($item.Cert.Thumbprint)"
        try {
            if ($item.Cert.HasPrivateKey) { Remove-Item -LiteralPath $path -DeleteKey }
            else { Remove-Item -LiteralPath $path }
            Write-Host "Removed $path"
        } catch {
            $left += $path
            Write-Host "Could not remove $path ($($_.Exception.Message))" -ForegroundColor Yellow
        }
    }
    if ($left) {
        Write-Host "`nRun in PowerShell as administrator:" -ForegroundColor Yellow
        $left | ForEach-Object { Write-Host "  Remove-Item -LiteralPath '$_'" }
        exit 1
    }
    if (Test-Path -LiteralPath $Record) { Remove-Item -LiteralPath $Record }
    Write-Host "Done. The signed copy and the .cer in dist\msix-test can be deleted with dist\."
    exit 0
}

# ---- -Create ------------------------------------------------------------------
$version = (& $py -c "from noirpad.__version__ import __version__; print(__version__)").Trim()
$msix = Join-Path $Root "dist\msix\NoirPad-$version.msix"
if (-not (Test-Path -LiteralPath $msix)) { Fail "$msix is missing: run build-msix.ps1 first" }

# Publisher of the package itself (read from the zip; nothing is extracted).
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($msix)
try {
    $entry = $zip.GetEntry("AppxManifest.xml")
    if (-not $entry) { Fail "no AppxManifest.xml in $msix" }
    $reader = New-Object System.IO.StreamReader($entry.Open())
    try { [xml]$manifest = $reader.ReadToEnd() } finally { $reader.Dispose() }
} finally { $zip.Dispose() }
$packagePublisher = $manifest.Package.Identity.Publisher
if ($packagePublisher -cne $Publisher) {
    Fail "Publisher of the package ($packagePublisher) differs from tools\msix_manifest.py ($Publisher)"
}

$signtool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" -ErrorAction SilentlyContinue |
    Sort-Object { [version]($_.Directory.Parent.Name) } | Select-Object -Last 1
if (-not $signtool) {
    Fail ("signtool.exe not found. Install the Windows SDK (component 'Windows SDK Signing Tools " +
          "for Desktop Apps') from https://developer.microsoft.com/windows/downloads/windows-sdk/ - this script installs nothing.")
}

$cert = Get-ChildItem -LiteralPath "Cert:\CurrentUser\My" |
    Where-Object { $_.Subject -eq $Publisher -and $_.Issuer -eq $Publisher -and $_.FriendlyName -eq $FriendlyName -and
                   $_.HasPrivateKey -and $_.NotAfter -gt (Get-Date).AddDays(1) } |
    Sort-Object NotAfter | Select-Object -Last 1
if ($cert) {
    Write-Host "Reusing $($cert.Thumbprint) from Cert:\CurrentUser\My"
} else {
    # Microsoft Learn, "Create a certificate for package signing": code signing EKU,
    # end entity, Subject = Publisher of the manifest.
    $cert = New-SelfSignedCertificate -Type Custom -KeyUsage DigitalSignature `
        -KeyExportPolicy NonExportable `
        -CertStoreLocation "Cert:\CurrentUser\My" `
        -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3", "2.5.29.19={text}") `
        -Subject $Publisher -FriendlyName $FriendlyName `
        -NotAfter (Get-Date).AddMonths(3)
    Write-Host "Created $($cert.Thumbprint) in Cert:\CurrentUser\My (private key not exportable)"
}
if ($cert.Subject -cne $Publisher) { Fail "certificate Subject '$($cert.Subject)' is not '$Publisher'" }

$sdkBin = $signtool.Directory.FullName
$makeappx = Join-Path $sdkBin "makeappx.exe"
if (-not (Test-Path -LiteralPath $makeappx)) { Fail "makeappx.exe not found next to signtool.exe ($sdkBin)" }

# Package versions: the Store one (X.Y.Z.0) and one higher only for the upgrade
# test (X.Y.Z.1). The higher one exists only in dist\msix-test, never in git.
$baseVersion = $manifest.Package.Identity.Version
if ($baseVersion -notmatch '^\d+\.\d+\.\d+\.0$') { Fail "package version $baseVersion is not X.Y.Z.0" }
$upgradeVersion = $baseVersion -replace '\.0$', '.1'

# dist\msix-test holds only this script's output: start empty.
if (Test-Path -LiteralPath $TestDir) { icacls $TestDir /reset /T /C /Q | Out-Null; Remove-Item -LiteralPath $TestDir -Recurse -Force }
New-Item -ItemType Directory -Path $TestDir | Out-Null

function Sign($file) {
    & $signtool.FullName sign /fd SHA256 /sha1 $cert.Thumbprint $file
    if ($LASTEXITCODE -ne 0) { Fail "signtool sign $file (exit $LASTEXITCODE)" }
}

# Read the package signature from the file itself (no trust store needed):
# AppxSignature.p7x = "PKCX" + PKCS#7; it must be valid and made by $cert.
function Assert-Signed($file, $expectVersion) {
    Add-Type -AssemblyName System.Security
    $z = [System.IO.Compression.ZipFile]::OpenRead($file)
    try {
        $sig = $z.GetEntry("AppxSignature.p7x")
        if (-not $sig) { Fail "$file has no signature" }
        $ms = New-Object System.IO.MemoryStream; $s = $sig.Open(); $s.CopyTo($ms); $s.Dispose()
        $bytes = $ms.ToArray()
        $r = New-Object System.IO.StreamReader($z.GetEntry("AppxManifest.xml").Open())
        try { [xml]$m = $r.ReadToEnd() } finally { $r.Dispose() }
    } finally { $z.Dispose() }
    if ([Text.Encoding]::ASCII.GetString($bytes, 0, 4) -ne "PKCX") { Fail "${file}: unknown signature format" }
    $cms = New-Object System.Security.Cryptography.Pkcs.SignedCms
    $cms.Decode([byte[]]$bytes[4..($bytes.Length - 1)])
    $cms.CheckSignature($true)                       # signature only; the root is not trusted here
    $signer = $cms.SignerInfos[0].Certificate
    if ($signer.Thumbprint -ne $cert.Thumbprint) { Fail "$file is signed by $($signer.Thumbprint), not the test certificate" }
    if ($m.Package.Identity.Version -ne $expectVersion) { Fail "$file has version $($m.Package.Identity.Version), expected $expectVersion" }
    if ($m.Package.Identity.Publisher -cne $Publisher) { Fail "$file has another Publisher" }
}

# Same check as build-msix.ps1: the unpacked package as the Store edition,
# writable (no file may change) and read-and-execute only (must still start).
function Smoke($file) {
    $dir = Join-Path $TestDir ("smoke-" + [IO.Path]::GetFileNameWithoutExtension($file))
    & $makeappx unpack /p $file /d $dir /o | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail "makeappx unpack $file (exit $LASTEXITCODE)" }
    $snap = { Get-ChildItem -LiteralPath $dir -Recurse -Force -File |
              ForEach-Object { "{0}|{1}|{2}" -f $_.FullName, $_.Length, $_.LastWriteTimeUtc.Ticks } | Sort-Object }
    $before = & $snap
    $exe = Join-Path $dir "NoirPad.exe"
    & "$PSScriptRoot\smoke_test.ps1" -Exe $exe -Version $version -Edition store
    if ($LASTEXITCODE -ne 0) { Fail "smoke test of $file" }
    try {
        icacls $dir /inheritance:r /grant:r "*S-1-5-32-545:(OI)(CI)RX" "*S-1-1-0:(OI)(CI)RX" /C /Q | Out-Null
        if ($LASTEXITCODE -ne 0) { Fail "icacls (read-only)" }
        $writable = $true
        try { [IO.File]::WriteAllText((Join-Path $dir "_internal\write-probe.tmp"), "x") } catch { $writable = $false }
        if ($writable) { Fail "the unpacked package is still writable" }
        & "$PSScriptRoot\smoke_test.ps1" -Exe $exe -Version $version -Edition store
        if ($LASTEXITCODE -ne 0) { Fail "smoke test of $file with a read-only folder" }
    } finally {
        icacls $dir /reset /T /C /Q | Out-Null
    }
    if (Compare-Object $before (& $snap)) { Fail "NoirPad wrote into the unpacked $file" }
    Remove-Item -LiteralPath $dir -Recurse -Force
}

# 1. The Store package as it is, signed (same content, only the signature added).
$test0 = Join-Path $TestDir "NoirPad-$baseVersion-TEST.msix"
Copy-Item -LiteralPath $msix -Destination $test0
Sign $test0

# 2. The upgrade test package: the same files, only Identity Version raised.
$layout = Join-Path $TestDir "layout-$upgradeVersion"
& $makeappx unpack /p $msix /d $layout /o | Out-Null
if ($LASTEXITCODE -ne 0) { Fail "makeappx unpack (exit $LASTEXITCODE)" }
foreach ($f in "AppxBlockMap.xml", "AppxSignature.p7x", "[Content_Types].xml", "AppxMetadata") {
    $p = Join-Path $layout $f
    if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Recurse -Force }
}
$manifestPath = Join-Path $layout "AppxManifest.xml"
$original = [IO.File]::ReadAllText($manifestPath)
$pattern = '(<Identity\b[^>]*?\bVersion=")' + [regex]::Escape($baseVersion) + '(")'
if ([regex]::Matches($original, $pattern).Count -ne 1) { Fail "Identity Version $baseVersion not found once in the manifest" }
$changed = [regex]::Replace($original, $pattern, '${1}' + $upgradeVersion + '${2}')
if ($changed.Replace($upgradeVersion, $baseVersion) -ne $original) { Fail "the manifest would differ in more than the version" }
[IO.File]::WriteAllText($manifestPath, $changed, (New-Object System.Text.UTF8Encoding($false)))
$test1 = Join-Path $TestDir "NoirPad-$upgradeVersion-TEST-UPGRADE.msix"
& $makeappx pack /d $layout /p $test1 /o | Out-Null
if ($LASTEXITCODE -ne 0) { Fail "makeappx pack (exit $LASTEXITCODE)" }
Remove-Item -LiteralPath $layout -Recurse -Force
Sign $test1

Assert-Signed $test0 $baseVersion
Assert-Signed $test1 $upgradeVersion
Write-Host "Both packages are signed by $($cert.Thumbprint)"

Smoke $test0
Smoke $test1
Write-Host "Smoke tests of both signed packages passed (writable and read-only)"

Export-Certificate -Cert $cert -FilePath $CerFile -Type CERT | Out-Null
$storeHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $msix).Hash.ToLower()
$hash0 = (Get-FileHash -Algorithm SHA256 -LiteralPath $test0).Hash.ToLower()
$hash1 = (Get-FileHash -Algorithm SHA256 -LiteralPath $test1).Hash.ToLower()
@(
    "NoirPad MSIX test certificate (N1.11)",
    "Subject: $Publisher",
    "Thumbprint: $($cert.Thumbprint)",
    "NotAfter: $($cert.NotAfter.ToString('yyyy-MM-dd'))",
    "Added to: Cert:\CurrentUser\My (by test-cert.ps1)",
    "Store package (unsigned, for Partner Center): dist\msix\NoirPad-$version.msix  SHA256 $storeHash",
    "Test package: dist\msix-test\NoirPad-$baseVersion-TEST.msix  SHA256 $hash0",
    "Upgrade test package: dist\msix-test\NoirPad-$upgradeVersion-TEST-UPGRADE.msix  SHA256 $hash1",
    "Public certificate: dist\msix-test\NoirPad-test.cer"
) | Set-Content -LiteralPath $Record -Encoding ascii

Write-Host "`nTest package:         $test0"
Write-Host "  SHA256 $hash0"
Write-Host "Upgrade test package: $test1"
Write-Host "  SHA256 $hash1"
Write-Host "Certificate: $CerFile (public part only)"
Write-Host "Only dist\msix\NoirPad-$version.msix (unsigned, $baseVersion) goes to Partner Center."
Write-Host "To trust the test certificate for installing, as administrator (separate step, see BUILD.md):"
Write-Host "  Import-Certificate -FilePath '$CerFile' -CertStoreLocation Cert:\LocalMachine\TrustedPeople"
