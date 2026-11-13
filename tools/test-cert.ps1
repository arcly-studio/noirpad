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
      3. Signs a COPY of the package: dist\msix-test\NoirPad-<version>.msix
         (signtool sign /fd SHA256 /sha1 <thumbprint>; the original stays
         unsigned for the Store).
      4. Exports only the public certificate: dist\msix-test\NoirPad-test.cer.
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

New-Item -ItemType Directory -Force -Path $TestDir | Out-Null
$signed = Join-Path $TestDir "NoirPad-$version.msix"
Copy-Item -LiteralPath $msix -Destination $signed -Force
& $signtool.FullName sign /fd SHA256 /sha1 $cert.Thumbprint $signed
if ($LASTEXITCODE -ne 0) { Fail "signtool sign (exit $LASTEXITCODE)" }

Export-Certificate -Cert $cert -FilePath $CerFile -Type CERT | Out-Null
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $signed).Hash.ToLower()
@(
    "NoirPad MSIX test certificate (N1.11)",
    "Subject: $Publisher",
    "Thumbprint: $($cert.Thumbprint)",
    "NotAfter: $($cert.NotAfter.ToString('yyyy-MM-dd'))",
    "Added to: Cert:\CurrentUser\My (by test-cert.ps1)",
    "Signed copy: dist\msix-test\NoirPad-$version.msix  SHA256 $hash",
    "Public certificate: dist\msix-test\NoirPad-test.cer"
) | Set-Content -LiteralPath $Record -Encoding ascii

Write-Host "`nSigned copy: $signed"
Write-Host "SHA256:      $hash"
Write-Host "Certificate: $CerFile (public part only)"
Write-Host "To trust it for installing, as administrator (separate step, see BUILD.md):"
Write-Host "  Import-Certificate -FilePath '$CerFile' -CertStoreLocation Cert:\LocalMachine\TrustedPeople"
