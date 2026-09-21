param(
    [Parameter(Mandatory=$true)][uri]$PackageUrl,
    [Parameter(Mandatory=$true)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$Sha256
)
$ErrorActionPreference = 'Stop'
# The caller gets this script and ZIP digest from a reviewed, fixed release.
# Never interpret downloaded response text as a shell command.
if ($PackageUrl.Scheme -ne 'https' -or $PackageUrl.Host -ne 'github.com' -or $PackageUrl.UserInfo -or $PackageUrl.Query -or $PackageUrl.Fragment -or $PackageUrl.AbsolutePath -notmatch '^/swaan-kim/autopets/releases/download/v[0-9]+\.[0-9]+\.[0-9]+/AutoPets-windows-x64\.zip$') { throw 'Use the fixed AutoPets GitHub release URL.' }
$taskDirectory = Join-Path ([IO.Path]::GetTempPath()) ('autopets-download-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $taskDirectory | Out-Null
$taskArchive = Join-Path $taskDirectory 'AutoPets.zip'
try { Invoke-WebRequest -Uri $PackageUrl -OutFile $taskArchive -UseBasicParsing -TimeoutSec 120 }
catch { throw 'AutoPets download failed. Retry without changing your existing installation.' }
if ((Get-FileHash -LiteralPath $taskArchive -Algorithm SHA256).Hash -ne $Sha256) { throw 'AutoPets download checksum does not match the release.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$taskZip = [IO.Compression.ZipFile]::OpenRead($taskArchive)
$taskSeen = @{}
$taskSize = 0L
try {
    if ($taskZip.Entries.Count -gt 1000) { throw 'Too many package entries.' }
    foreach ($taskEntry in $taskZip.Entries) {
        $taskName = $taskEntry.FullName
        $taskSize += $taskEntry.Length
        if ($taskName -notmatch '^[a-zA-Z0-9_./-]+$' -or $taskName.StartsWith('/') -or $taskName -match '(^|/)\.\.(/|$)' -or $taskSeen.ContainsKey($taskName) -or (($taskEntry.ExternalAttributes -shr 16) -band 61440) -eq 40960 -or $taskSize -gt 1073741824) { throw 'Unsafe package contents.' }
        $taskSeen[$taskName] = $true
    }
} finally { $taskZip.Dispose() }
$taskExpanded = Join-Path $taskDirectory 'package'
Expand-Archive -LiteralPath $taskArchive -DestinationPath $taskExpanded
& (Join-Path $taskExpanded 'install.ps1')
exit $LASTEXITCODE
