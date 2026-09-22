param(
    # Obtain this small JSON file from the reviewed product site/release first.
    [Parameter(Mandatory=$true)][string]$ManifestPath,
    [switch]$ValidateOnly
)
$ErrorActionPreference = 'Stop'
if ((Get-Item -LiteralPath $ManifestPath).Length -gt 65536) { throw 'Release information is too large.' }
$taskChannel = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$taskRelease = $taskChannel.publicRelease
if ($taskChannel.version -ne 2 -or $taskChannel.platform -ne 'win32-x64' -or -not $taskRelease) { throw 'A verified public AutoPets release is not available yet.' }
if ($taskRelease.version -cnotmatch '^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$' -or $taskRelease.tag -cne "v$($taskRelease.version)") { throw 'Invalid pinned release version.' }
$taskUrl = [uri]$taskRelease.installer.url
$taskExpectedPath = '^/swaan-kim/autopets/releases/download/' + [regex]::Escape($taskRelease.tag) + '/[A-Za-z0-9_.-]+\.exe$'
if ($taskUrl.Scheme -ne 'https' -or $taskUrl.Host -ne 'github.com' -or $taskUrl.Port -ne 443 -or $taskUrl.UserInfo -or $taskUrl.Query -or $taskUrl.Fragment -or $taskUrl.AbsolutePath -notmatch $taskExpectedPath) { throw 'Use the fixed AutoPets installer URL.' }
if ($taskRelease.installer.sha256 -notmatch '^[a-fA-F0-9]{64}$' -or $taskRelease.installer.authenticodeThumbprint -notmatch '^([a-fA-F0-9]{40}|[a-fA-F0-9]{64})$') { throw 'Release integrity information is missing.' }
foreach ($taskGate in @('cleanWindows', 'windowsExecution', 'codexTwoChats', 'guidanceDelivery', 'repairAndUninstall', 'authenticode', 'signedUpdater')) {
    if ($taskRelease.evidence.$taskGate -isnot [bool] -or $taskRelease.evidence.$taskGate -ne $true) { throw 'Public release verification is incomplete.' }
}
if ($taskRelease.update.url -cne 'https://swaan-kim.github.io/autopets/updates/windows-x64.json' -or [string]::IsNullOrWhiteSpace($taskRelease.update.publicKey) -or $taskRelease.update.publicKey.Length -gt 4096) { throw 'Signed update information is missing.' }
$taskPublication = [DateTimeOffset]::MinValue
if ($taskRelease.publishedAt -notmatch '^\d{4}-\d{2}-\d{2}T' -or -not [DateTimeOffset]::TryParse($taskRelease.publishedAt, [ref]$taskPublication)) { throw 'Invalid publication date.' }
if ($ValidateOnly) { @{ ok = $true; version = $taskRelease.version; installer = $taskUrl.AbsoluteUri } | ConvertTo-Json -Compress; exit 0 }
if (-not [Environment]::Is64BitOperatingSystem -or $env:OS -ne 'Windows_NT' -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { throw 'Use Windows x64.' }

function Find-AutoPets {
    $taskManagedRoot = if ($env:AUTOPETS_HOME) { $env:AUTOPETS_HOME } else { Join-Path $env:LOCALAPPDATA 'AutoPets' }
    $taskOwnedManifest = Join-Path $taskManagedRoot 'install-manifest.json'
    if (Test-Path -LiteralPath $taskOwnedManifest -PathType Leaf) {
        $taskOwned = Get-Content -LiteralPath $taskOwnedManifest -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($taskOwned.owner -ne 'autopets' -or -not [IO.Path]::IsPathRooted($taskOwned.appDirectory)) { throw 'Review the existing AutoPets installation.' }
        $taskExisting = Join-Path $taskOwned.appDirectory 'AutoPets.exe'
        if (Test-Path -LiteralPath $taskExisting -PathType Leaf) { return $taskExisting }
    }
    foreach ($taskKey in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\AutoPets', 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\local.autopets.desktop')) {
        $taskItem = Get-ItemProperty -LiteralPath $taskKey -ErrorAction SilentlyContinue
        if ($taskItem -and $taskItem.DisplayName -eq 'AutoPets' -and $taskItem.InstallLocation) {
            $taskExisting = Join-Path $taskItem.InstallLocation.Trim([char]34) 'AutoPets.exe'
            if (Test-Path -LiteralPath $taskExisting -PathType Leaf) { return $taskExisting }
        }
    }
    return $null
}
function Assert-TrustedSignature([string]$Path) {
    $taskSignature = Get-AuthenticodeSignature -LiteralPath $Path
    if ($taskSignature.Status -ne 'Valid' -or -not $taskSignature.SignerCertificate) { throw 'The AutoPets Windows signature could not be verified.' }
    $taskThumbprint = if ($taskRelease.installer.authenticodeThumbprint.Length -eq 64) {
        $taskHash = [Security.Cryptography.SHA256]::Create()
        try { ([BitConverter]::ToString($taskHash.ComputeHash($taskSignature.SignerCertificate.RawData))).Replace('-', '') } finally { $taskHash.Dispose() }
    } else { $taskSignature.SignerCertificate.Thumbprint }
    if ($taskThumbprint -ne $taskRelease.installer.authenticodeThumbprint) { throw 'The AutoPets publisher does not match this reviewed release.' }
}
# Serializes AI invocations. The NSIS pre-install hook owns its product install lock.
$taskIdentityHash = [Security.Cryptography.SHA256]::Create()
try { $taskIdentity = ([BitConverter]::ToString($taskIdentityHash.ComputeHash([Text.Encoding]::UTF8.GetBytes([Security.Principal.WindowsIdentity]::GetCurrent().User.Value)))).Replace('-', '').Substring(0, 16) } finally { $taskIdentityHash.Dispose() }
$taskMutex = New-Object Threading.Mutex($false, "Local\AutoPets-install-$taskIdentity")
$taskAcquired = $false
try {
    try { $taskAcquired = $taskMutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $taskAcquired = $true }
    if (-not $taskAcquired) { throw 'AutoPets installation is already in progress. Retry after it finishes.' }
    $taskApp = Find-AutoPets
    if (-not $taskApp) {
        $taskDirectory = Join-Path ([IO.Path]::GetTempPath()) ('autopets-installer-' + [Guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $taskDirectory | Out-Null
        $taskInstaller = Join-Path $taskDirectory 'AutoPets-setup.exe'
        try { Invoke-WebRequest -Uri $taskUrl -OutFile $taskInstaller -UseBasicParsing -TimeoutSec 180 }
        catch { throw 'AutoPets download failed. Retry without changing the existing installation.' }
        if ((Get-FileHash -LiteralPath $taskInstaller -Algorithm SHA256).Hash -ne $taskRelease.installer.sha256) { throw 'The AutoPets installer checksum does not match.' }
        Assert-TrustedSignature $taskInstaller
        $taskInstall = Start-Process -FilePath $taskInstaller -ArgumentList '/S' -PassThru -Wait -WindowStyle Hidden
        if ($taskInstall.ExitCode -ne 0) { throw 'AutoPets installation did not complete. Retry when ready.' }
        $taskApp = Find-AutoPets
        if (-not $taskApp) { throw 'AutoPets installation was not found. Open the installed app from Start.' }
    }
    Assert-TrustedSignature $taskApp
    # Both entrypoints finish at the same visible app onboarding. No AI config here.
    Start-Process -FilePath $taskApp -WindowStyle Hidden
    @{ ok = $true; appLaunched = $true; connectionConfirmed = $false; nextAction = 'connect-in-app' } | ConvertTo-Json -Compress
} finally {
    if ($taskAcquired) { $taskMutex.ReleaseMutex() }
    $taskMutex.Dispose()
}
