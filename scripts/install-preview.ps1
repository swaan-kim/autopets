param(
    # Download this manifest from a reviewed, fixed AutoPets commit first.
    [Parameter(Mandatory=$true)][string]$ManifestPath,
    [switch]$AllowUnsignedPreview,
    [switch]$UpdateExistingPreview,
    [switch]$ValidateOnly,
    [switch]$DownloadOnly
)
$ErrorActionPreference = 'Stop'

function Read-PreviewManifest([string]$Path) {
    $taskFile = Get-Item -LiteralPath $Path
    if ($taskFile.PSIsContainer -or $taskFile.Length -gt 65536) { throw 'Invalid preview manifest file.' }
    $taskManifest = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($taskManifest.schemaVersion -ne 1 -or $taskManifest.channel -cne 'unsigned-preview' -or
        $taskManifest.platform -cne 'win32-x64' -or $taskManifest.repository -cne 'swaan-kim/autopets' -or
        $taskManifest.app.identifier -cne 'local.autopets.desktop') { throw 'Use an AutoPets Windows x64 preview manifest.' }
    if ($taskManifest.sourceCommit -cnotmatch '^[a-f0-9]{40}$') { throw 'The full preview source commit is required.' }
    $taskTagPattern = '^v\d+\.\d+\.\d+-dev\.\d{8}\.' + $taskManifest.sourceCommit.Substring(0, 12) + '$'
    if ($taskManifest.release.tag -cnotmatch $taskTagPattern) { throw 'The fixed release tag must match the source commit.' }
    $taskPublication = [DateTimeOffset]::MinValue
    if ($taskManifest.release.publishedAt -notmatch '^\d{4}-\d{2}-\d{2}T' -or
        -not [DateTimeOffset]::TryParse($taskManifest.release.publishedAt, [ref]$taskPublication)) { throw 'Invalid preview publication date.' }
    $taskUri = [uri]$taskManifest.installer.url
    $taskExpectedPath = '^/swaan-kim/autopets/releases/download/' + [regex]::Escape($taskManifest.release.tag) + '/[A-Za-z0-9_.-]+\.exe$'
    if (-not $taskUri.IsAbsoluteUri -or $taskUri.Scheme -cne 'https' -or $taskUri.Host -cne 'github.com' -or
        $taskUri.Port -ne 443 -or $taskUri.UserInfo -or $taskUri.Query -or $taskUri.Fragment -or
        $taskUri.AbsolutePath -cnotmatch $taskExpectedPath -or $taskManifest.installer.url -cne $taskUri.AbsoluteUri) {
        throw 'Use the fixed installer URL from swaan-kim/autopets.'
    }
    if ($taskManifest.installer.sha256 -cnotmatch '^[a-f0-9]{64}$' -or $taskManifest.app.sha256 -cnotmatch '^[a-f0-9]{64}$' -or
        $taskManifest.installer.authenticode -cne 'unsigned') { throw 'Preview file integrity information is missing.' }
    return $taskManifest
}

function Assert-PreviewWindows {
    if ($env:OS -ne 'Windows_NT' -or -not [Environment]::Is64BitOperatingSystem -or
        $env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { throw 'Use Windows x64.' }
}

function Assert-PreviewPublication($Manifest) {
    $taskHeaders = @{ 'User-Agent' = 'AutoPets-preview-installer'; Accept = 'application/vnd.github+json' }
    try {
        $taskCommit = Invoke-RestMethod -Uri "https://api.github.com/repos/swaan-kim/autopets/commits/$($Manifest.release.tag)" -Headers $taskHeaders -TimeoutSec 30
        $taskRelease = Invoke-RestMethod -Uri "https://api.github.com/repos/swaan-kim/autopets/releases/tags/$($Manifest.release.tag)" -Headers $taskHeaders -TimeoutSec 30
    } catch { throw 'Could not verify the pinned GitHub preview. Retry later; no installation was changed.' }
    if ($taskCommit.sha -cne $Manifest.sourceCommit -or $taskRelease.tag_name -cne $Manifest.release.tag -or
        $taskRelease.prerelease -ne $true -or $taskRelease.draft -ne $false) { throw 'The GitHub preview does not match this manifest.' }
    $taskAssets = @($taskRelease.assets | Where-Object { $_.browser_download_url -ceq $Manifest.installer.url })
    if ($taskAssets.Count -ne 1 -or $taskAssets[0].state -ne 'uploaded') { throw 'The pinned preview installer is not published.' }
}

function Get-PreviewSha256([string]$Path) {
    $taskStream = [IO.File]::OpenRead($Path)
    $taskHasher = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($taskHasher.ComputeHash($taskStream))).Replace('-', '').ToLowerInvariant() }
    finally { $taskHasher.Dispose(); $taskStream.Dispose() }
}

function Assert-PreviewFile([string]$Path, [string]$ExpectedHash) {
    if ((Get-PreviewSha256 $Path) -ine $ExpectedHash) { throw 'The preview file checksum does not match. Do not run it.' }
    $taskSignature = Get-AuthenticodeSignature -LiteralPath $Path
    # An unsigned release is explicitly opted into. A broken signature is never ignored.
    if ($taskSignature.Status -ne 'NotSigned') { throw 'The file signature differs from this unsigned preview manifest. Do not run it.' }
}

function Find-PreviewApp {
    $taskCandidates = New-Object 'System.Collections.Generic.List[string]'
    $taskManagedRoot = if ($env:AUTOPETS_HOME) { $env:AUTOPETS_HOME } else { Join-Path $env:LOCALAPPDATA 'AutoPets' }
    $taskOwnedPath = Join-Path $taskManagedRoot 'install-manifest.json'
    if (Test-Path -LiteralPath $taskOwnedPath -PathType Leaf) {
        $taskOwned = Get-Content -LiteralPath $taskOwnedPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($taskOwned.owner -ne 'autopets' -or -not [IO.Path]::IsPathRooted($taskOwned.appDirectory)) { throw 'Review the existing AutoPets installation before updating.' }
        $taskCandidates.Add((Join-Path $taskOwned.appDirectory 'AutoPets.exe'))
    }
    foreach ($taskKey in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\AutoPets', 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\local.autopets.desktop')) {
        $taskItem = Get-ItemProperty -LiteralPath $taskKey -ErrorAction SilentlyContinue
        if ($taskItem -and $taskItem.DisplayName -eq 'AutoPets' -and $taskItem.InstallLocation) {
            $taskLocation = $taskItem.InstallLocation.Trim([char]34)
            if (-not [IO.Path]::IsPathRooted($taskLocation)) { throw 'Review the existing AutoPets installation path.' }
            $taskCandidates.Add((Join-Path $taskLocation 'AutoPets.exe'))
        }
    }
    $taskFound = @($taskCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
        ForEach-Object { (Resolve-Path -LiteralPath $_).Path } | Sort-Object -Unique)
    if ($taskFound.Count -gt 1) { throw 'Multiple AutoPets installations were found. Choose the existing installation manually.' }
    if ($taskFound.Count -eq 1) { return $taskFound[0] }
    return $null
}

function New-PreviewMutex {
    $taskHasher = [Security.Cryptography.SHA256]::Create()
    try {
        $taskIdentity = ([BitConverter]::ToString($taskHasher.ComputeHash(
            [Text.Encoding]::UTF8.GetBytes([Security.Principal.WindowsIdentity]::GetCurrent().User.Value)
        ))).Replace('-', '').Substring(0, 16)
    } finally { $taskHasher.Dispose() }
    # Same caller lock as the stable helper; NSIS has its own installer lock.
    return New-Object Threading.Mutex($false, "Local\AutoPets-install-$taskIdentity")
}

function Get-PreviewInstaller($Manifest) {
    $taskDirectory = Join-Path ([IO.Path]::GetTempPath()) ('autopets-preview-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $taskDirectory | Out-Null
    $taskInstaller = Join-Path $taskDirectory 'AutoPets-setup.exe'
    try { Invoke-WebRequest -Uri $Manifest.installer.url -OutFile $taskInstaller -UseBasicParsing -TimeoutSec 180 }
    catch { throw 'Preview download failed. Retry later; no installation was changed.' }
    Assert-PreviewFile $taskInstaller $Manifest.installer.sha256
    return $taskInstaller
}

function Invoke-PreviewInstall([string]$Path, [bool]$OptIn, [bool]$Validate, [bool]$Download, [bool]$UpdateExisting = $false) {
    $taskManifest = Read-PreviewManifest $Path
    if ($Validate -and $Download) { throw 'Choose ValidateOnly or DownloadOnly.' }
    if ($Validate) {
        return @{ ok = $true; stage = 'manifest-validated'; channel = 'unsigned-preview'; sourceCommit = $taskManifest.sourceCommit;
            release = $taskManifest.release.tag; installed = $false; launched = $false; connectionConfirmed = $false }
    }
    if (-not $OptIn) { throw 'This is an unsigned development preview. Explicitly opt in with -AllowUnsignedPreview. Windows protection remains enabled and may block it.' }
    Assert-PreviewWindows
    $taskMutex = New-PreviewMutex
    $taskAcquired = $false
    try {
        try { $taskAcquired = $taskMutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $taskAcquired = $true }
        if (-not $taskAcquired) { throw 'AutoPets installation is already in progress. Retry after it finishes.' }
        Assert-PreviewPublication $taskManifest
        $taskApp = if ($Download) { $null } else { Find-PreviewApp }
        $taskMatches = $taskApp -and ((Get-PreviewSha256 $taskApp) -ieq $taskManifest.app.sha256)
        if ($taskMatches) {
            Assert-PreviewFile $taskApp $taskManifest.app.sha256
        } else {
            if ($taskApp) {
                if ((Get-AuthenticodeSignature -LiteralPath $taskApp).Status -ne 'NotSigned') {
                    throw 'Keep the existing signed or unverified installation. This helper will not replace it with an unsigned preview.'
                }
                if (-not $UpdateExisting) {
                    throw 'An existing preview differs from this release; its age is unknown. Review it before using -UpdateExistingPreview. No installation was changed.'
                }
            }
            if (-not $Download -and @(Get-Process -Name 'AutoPets' -ErrorAction SilentlyContinue).Count -gt 0) {
                throw 'Close AutoPets using its Exit menu, then retry. No running work or data was changed.'
            }
            $taskInstaller = Get-PreviewInstaller $taskManifest
            if ($Download) {
                return @{ ok = $true; stage = 'download-verified'; channel = 'unsigned-preview'; installerPath = $taskInstaller;
                    sha256 = $taskManifest.installer.sha256; sourceCommit = $taskManifest.sourceCommit; installed = $false; launched = $false; connectionConfirmed = $false }
            }
            # NSIS owns the existing install path and update behavior. Never uninstall/delete data here.
            try { $taskInstall = Start-Process -FilePath $taskInstaller -ArgumentList '/S' -PassThru -Wait -WindowStyle Hidden }
            catch { throw 'Windows did not start the preview installer. Keep protection enabled; use the signed release when available.' }
            if ($taskInstall.ExitCode -ne 0) { throw "Preview setup did not complete (exit $($taskInstall.ExitCode)). Keep protection enabled and inspect the Windows message." }
            $taskApp = Find-PreviewApp
            if (-not $taskApp) { throw 'Setup returned, but the AutoPets installation was not found. Do not repeat automatically.' }
            Assert-PreviewFile $taskApp $taskManifest.app.sha256
        }
        try { Start-Process -FilePath $taskApp -WindowStyle Hidden | Out-Null }
        catch { throw 'Windows did not start AutoPets. Keep protection enabled; use the signed release when available.' }
        # A successful process launch is not receiver readiness, host connection, or skill execution.
        return @{ ok = $true; stage = 'launch-requested'; channel = 'unsigned-preview'; sourceCommit = $taskManifest.sourceCommit;
            alreadyInstalled = [bool]$taskMatches; installed = $true; launchRequested = $true; connectionConfirmed = $false; nextAction = 'connect-in-app' }
    } finally {
        if ($taskAcquired) { $taskMutex.ReleaseMutex() }
        $taskMutex.Dispose()
    }
}

# Dot-sourcing defines functions only, allowing isolated tests without an installer invocation.
if ($MyInvocation.InvocationName -ne '.') {
    Invoke-PreviewInstall $ManifestPath $AllowUnsignedPreview.IsPresent $ValidateOnly.IsPresent $DownloadOnly.IsPresent $UpdateExistingPreview.IsPresent | ConvertTo-Json -Depth 4 -Compress
}
