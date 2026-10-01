# Read-only Authenticode audit of explicitly supplied files. Nothing is launched,
# extracted, installed, unblocked, signed, or added to a certificate store.
# The only write is a new JSON report outside the supplied payload directory.
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$Installer,
    [Parameter(Mandatory=$true)][string]$ReportPath,
    [string]$InstalledDirectory,
    [string]$ExpectedPublisher,
    [string]$ExpectedThumbprint,
    [switch]$InventoryOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Get-AuditPath([string]$Path) {
    # Do not accept providers, alternate data streams, UNC paths, or device paths.
    $taskFull = [IO.Path]::GetFullPath($ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path))
    if ($taskFull -notmatch '^[A-Za-z]:\\' -or $taskFull.Substring(2).Contains(':')) { throw 'Expected a local filesystem path.' }
    return $taskFull
}

function Test-AuditReparsePath([string]$Path) {
    $taskCursor = $Path
    while ($taskCursor) {
        if (Test-Path -LiteralPath $taskCursor) {
            if (((Get-Item -LiteralPath $taskCursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { return $true }
        }
        $taskParent = [IO.Path]::GetDirectoryName($taskCursor)
        if ($taskParent -eq $taskCursor) { break }
        $taskCursor = $taskParent
    }
    return $false
}

function Add-AuditFailure([string]$Code, [string]$File) {
    $taskFailures.Add([pscustomobject]@{ code = $Code; file = $File })
}

function Convert-AuditCertificate($Certificate) {
    if ($null -eq $Certificate) { return $null }
    return [ordered]@{
        subject = $Certificate.Subject
        thumbprint = $Certificate.Thumbprint
        notBeforeUtc = $Certificate.NotBefore.ToUniversalTime().ToString('O')
        notAfterUtc = $Certificate.NotAfter.ToUniversalTime().ToString('O')
    }
}

function Read-AuditFile([string]$Path, [string]$Label, [bool]$FirstParty) {
    $taskEntry = [ordered]@{
        file = $Label
        firstParty = $FirstParty
        bytes = $null
        sha256 = $null
        signatureStatus = 'NotInspected'
        signatureType = $null
        signer = $null
        publisherMatches = $null
        thumbprintMatches = $null
        timestamp = [ordered]@{ present = $false; authority = $null; signedAtUtc = $null }
    }
    $taskFiles.Add($taskEntry)
    $taskStream = $null
    $taskHasher = $null
    try {
        if (Test-AuditReparsePath $Path) {
            $taskEntry.signatureStatus = 'ReparsePointRejected'
            Add-AuditFailure 'reparse-point-rejected' $Label
            return
        }
        if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
            $taskEntry.signatureStatus = 'Missing'
            Add-AuditFailure 'required-file-missing' $Label
            return
        }
        # Hold a read-only, non-write-sharing handle while hashing and asking
        # Windows to verify the same file. Inputs are never opened for writing.
        $taskStream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
        $taskEntry.bytes = $taskStream.Length
        $taskHasher = [Security.Cryptography.SHA256]::Create()
        $taskEntry.sha256 = ([BitConverter]::ToString($taskHasher.ComputeHash($taskStream))).Replace('-', '').ToLowerInvariant()
        $taskSignature = Get-AuthenticodeSignature -LiteralPath $Path
        $taskEntry.signatureStatus = $taskSignature.Status.ToString()
        $taskEntry.signatureType = $taskSignature.SignatureType.ToString()
        $taskEntry.signer = Convert-AuditCertificate $taskSignature.SignerCertificate
        $taskEntry.timestamp.present = $null -ne $taskSignature.TimeStamperCertificate
        $taskEntry.timestamp.authority = Convert-AuditCertificate $taskSignature.TimeStamperCertificate
        if ($taskEntry.signatureStatus -ne 'Valid' -or $null -eq $taskEntry.signer) { Add-AuditFailure 'signature-not-valid' $Label }
        if ($FirstParty -and -not $taskEntry.timestamp.present) { Add-AuditFailure 'first-party-timestamp-missing' $Label }
        if ($FirstParty -and $taskPublisherValid) {
            # A full X509 Subject comparison, never a substring, wildcard, or CN-only match.
            $taskEntry.publisherMatches = $null -ne $taskEntry.signer -and [string]::Equals($taskEntry.signer.subject, $ExpectedPublisher, [StringComparison]::Ordinal)
            if (-not $taskEntry.publisherMatches) { Add-AuditFailure 'first-party-publisher-mismatch' $Label }
        }
        if ($FirstParty -and $taskThumbprintValid -and $ExpectedThumbprint) {
            $taskEntry.thumbprintMatches = $null -ne $taskEntry.signer -and [string]::Equals($taskEntry.signer.thumbprint, $ExpectedThumbprint, [StringComparison]::OrdinalIgnoreCase)
            if (-not $taskEntry.thumbprintMatches) { Add-AuditFailure 'first-party-thumbprint-mismatch' $Label }
        }
    } catch {
        $taskEntry.signatureStatus = 'InspectionFailed'
        # Do not serialize raw exceptions, absolute paths, or host identity.
        Add-AuditFailure 'file-inspection-failed' $Label
    } finally {
        if ($null -ne $taskHasher) { $taskHasher.Dispose() }
        if ($null -ne $taskStream) { $taskStream.Dispose() }
    }
}

$taskFailures = New-Object 'System.Collections.Generic.List[object]'
$taskFiles = New-Object 'System.Collections.Generic.List[object]'
$taskInstallerPath = $null
$taskPayloadPath = $null
$taskPayloadComplete = $false
$taskPublisherValid = -not [string]::IsNullOrWhiteSpace($ExpectedPublisher) -and $ExpectedPublisher -eq $ExpectedPublisher.Trim() -and $ExpectedPublisher -notmatch '[\x00-\x1f\x7f*?]' -and $ExpectedPublisher -match '(^|,\s*)CN=[^,]+'
$taskThumbprintValid = -not $ExpectedThumbprint -or $ExpectedThumbprint -match '^[A-Fa-f0-9]{40}$'

try {
    $taskInstallerPath = Get-AuditPath $Installer
} catch { Add-AuditFailure 'invalid-installer-path' 'installer' }
if ($InstalledDirectory) {
    try {
        $taskPayloadPath = Get-AuditPath $InstalledDirectory
        if ($taskPayloadPath.Length -le 3) { $taskPayloadPath = $null; throw 'A drive root is not an installed application directory.' }
        $taskPayloadPath = $taskPayloadPath.TrimEnd('\')
        # Normalize 8.3 names before comparing the report boundary. Inspect the
        # original path for reparse ancestors before any canonicalization.
        if ((Test-Path -LiteralPath $taskPayloadPath -PathType Container) -and -not (Test-AuditReparsePath $taskPayloadPath)) {
            $taskPayloadPath = (Get-Item -LiteralPath $taskPayloadPath -Force).FullName.TrimEnd('\')
        }
    }
    catch { Add-AuditFailure 'invalid-payload-path' 'payload' }
}

# Refuse reports that could overwrite inputs, traverse a link, or silently replace
# old evidence. The caller supplies an existing parent and a fresh .json name.
try {
    $taskReportPath = Get-AuditPath $ReportPath
    if ([IO.Path]::GetExtension($taskReportPath) -ine '.json' -or
        (Test-Path -LiteralPath $taskReportPath) -or
        -not (Test-Path -LiteralPath ([IO.Path]::GetDirectoryName($taskReportPath)) -PathType Container) -or
        (Test-AuditReparsePath $taskReportPath)) { throw 'Unsafe report destination.' }
    $taskReportParent = (Get-Item -LiteralPath ([IO.Path]::GetDirectoryName($taskReportPath)) -Force).FullName
    $taskReportPath = Join-Path $taskReportParent ([IO.Path]::GetFileName($taskReportPath))
    if (
        ($taskInstallerPath -and [string]::Equals($taskReportPath, $taskInstallerPath, [StringComparison]::OrdinalIgnoreCase)) -or
        ($taskPayloadPath -and $taskReportPath.StartsWith($taskPayloadPath + '\', [StringComparison]::OrdinalIgnoreCase))) {
        throw 'Unsafe report destination.'
    }
} catch {
    [Console]::Error.WriteLine('Signature audit refused the report destination; use a new .json path outside the payload with an existing, non-reparse parent directory.')
    exit 2
}

if (-not $taskPublisherValid) {
    if ($ExpectedPublisher) { Add-AuditFailure 'invalid-expected-publisher' 'configuration' }
    elseif (-not $InventoryOnly) { Add-AuditFailure 'expected-publisher-required' 'configuration' }
}
if (-not $taskThumbprintValid) { Add-AuditFailure 'invalid-expected-thumbprint' 'configuration' }
if (-not $InstalledDirectory) { Add-AuditFailure 'required-payload-not-supplied' 'payload' }
try {
    # A Node caller launched from PowerShell 7 can inherit its PSModulePath when
    # spawning Windows PowerShell 5.1. Use this engine's own standard module.
    Import-Module -Name (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
} catch { Add-AuditFailure 'authenticode-module-unavailable' 'configuration' }

if ($taskInstallerPath) {
    if ([IO.Path]::GetExtension($taskInstallerPath) -ine '.exe') { Add-AuditFailure 'installer-must-be-exe' 'installer' }
    else { Read-AuditFile $taskInstallerPath 'installer' $true }
}

if ($taskPayloadPath) {
    try {
        if (Test-AuditReparsePath $taskPayloadPath) { Add-AuditFailure 'reparse-point-rejected' 'payload' }
        elseif (-not (Test-Path -LiteralPath $taskPayloadPath -PathType Container)) { Add-AuditFailure 'payload-directory-missing' 'payload' }
        else {
            $taskPayloadPath = (Get-Item -LiteralPath $taskPayloadPath -Force).FullName.TrimEnd('\')
            $taskRequired = @('autopets.exe', 'uninstall.exe', 'connector/runtime/node.exe')
            $taskSeen = @{}
            $taskDirectories = New-Object 'System.Collections.Generic.Stack[string]'
            $taskDirectories.Push($taskPayloadPath)
            $taskTraversalComplete = $true
            while ($taskDirectories.Count -gt 0) {
                $taskDirectory = $taskDirectories.Pop()
                if (Test-AuditReparsePath $taskDirectory) {
                    Add-AuditFailure 'reparse-point-rejected' 'payload'
                    $taskTraversalComplete = $false
                    continue
                }
                # Traverse one level at a time so reparse directories are rejected
                # before they can redirect a recursive walk outside the input root.
                foreach ($taskItem in @(Get-ChildItem -LiteralPath $taskDirectory -Force | Sort-Object Name)) {
                    if (-not $taskItem.FullName.StartsWith($taskPayloadPath + '\', [StringComparison]::OrdinalIgnoreCase)) {
                        Add-AuditFailure 'payload-path-escape-rejected' 'payload'
                        $taskTraversalComplete = $false
                        continue
                    }
                    $taskRelative = $taskItem.FullName.Substring($taskPayloadPath.Length + 1).Replace('\', '/')
                    $taskLabel = 'payload/' + $taskRelative
                    if (($taskItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                        Add-AuditFailure 'reparse-point-rejected' $taskLabel
                        $taskTraversalComplete = $false
                        continue
                    }
                    if ($taskItem.PSIsContainer) { $taskDirectories.Push($taskItem.FullName); continue }
                    if ($taskItem.Extension -in @('.exe', '.dll', '.node')) {
                        $taskSeen[$taskRelative] = $true
                        $taskFirstParty = $taskItem.Name -in @('autopets.exe', 'uninstall.exe')
                        Read-AuditFile $taskItem.FullName $taskLabel $taskFirstParty
                    }
                }
            }
            $taskPayloadComplete = $taskTraversalComplete
            foreach ($taskRequiredFile in $taskRequired) {
                if (-not $taskSeen.ContainsKey($taskRequiredFile)) {
                    Add-AuditFailure 'required-file-missing' ('payload/' + $taskRequiredFile)
                    $taskPayloadComplete = $false
                }
            }
        }
    } catch {
        $taskPayloadComplete = $false
        Add-AuditFailure 'payload-inspection-failed' 'payload'
    }
}

$taskPassed = $taskFailures.Count -eq 0
$taskReport = [ordered]@{
    schemaVersion = 1
    checkedAtUtc = [DateTime]::UtcNow.ToString('O')
    mode = if ($InventoryOnly) { 'inventory-only' } else { 'strict' }
    outcome = if ($taskPassed) { 'passed' } else { 'failed' }
    expectedPublisher = if ($taskPublisherValid) { $ExpectedPublisher } else { $null }
    expectedThumbprint = if ($taskThumbprintValid -and $ExpectedThumbprint) { $ExpectedThumbprint.ToUpperInvariant() } else { $null }
    installedPayloadSupplied = [bool]$InstalledDirectory
    installedPayloadComplete = $taskPayloadComplete
    signatureReady = $taskPassed -and $taskPayloadComplete -and $taskPublisherValid
    publicReleaseReady = $false
    runtimePolicyVerified = $false
    smartAppControlVerified = $false
    limits = @(
        'Only supplied installer bytes and supplied payload .exe/.dll/.node files are inspected; installer contents are not extracted.'
        'The supplied payload is not proven to have come from this installer.'
        'Authenticode validity uses this Windows host trust policy; it does not prove Smart App Control, SmartScreen, runtime, installation, or release readiness.'
        'Timestamp authority metadata is reported when available; Get-AuthenticodeSignature does not expose the signing instant.'
        'First-party timestamp presence is required; third-party publisher allowlisting is not enforced by this signature gate.'
    )
    files = @($taskFiles.ToArray() | Sort-Object { $_.file })
    failures = @($taskFailures.ToArray() | Sort-Object file, code)
}
try {
    $taskJson = $taskReport | ConvertTo-Json -Depth 8
    $taskReportStream = [IO.File]::Open($taskReportPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try {
        $taskBytes = (New-Object Text.UTF8Encoding($false)).GetBytes($taskJson + [Environment]::NewLine)
        $taskReportStream.Write($taskBytes, 0, $taskBytes.Length)
    } finally { $taskReportStream.Dispose() }
} catch {
    [Console]::Error.WriteLine('Signature audit could not create the JSON report.')
    exit 2
}
Write-Output ('Signature audit: ' + $taskReport.outcome + '; signatureReady=' + $taskReport.signatureReady.ToString().ToLowerInvariant() + '; publicReleaseReady=false.')
if (-not $InventoryOnly -and -not $taskPassed) { exit 1 }
exit 0
