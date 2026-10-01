# Run only after the downloaded ZIP digest has been checked against release notes.
# No execution-policy, security, trust or machine-wide PATH changes.
$ErrorActionPreference = 'Stop'
$taskRoot = $PSScriptRoot
$taskManifest = Get-Content -LiteralPath (Join-Path $taskRoot 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($taskManifest.version -ne 1) { throw 'Unsupported AutoPets package.' }
if (-not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { throw 'Windows x64 is required.' }
$taskSeen = @{}
foreach ($taskFile in $taskManifest.files) {
    if ($taskFile.path -notmatch '^[a-zA-Z0-9_./-]+$' -or $taskFile.path -match '(^|/)\.\.(/|$)' -or $taskFile.path.StartsWith('/') -or $taskSeen.ContainsKey($taskFile.path)) { throw 'Invalid package path.' }
    $taskSeen[$taskFile.path] = $true
    $taskPath = [IO.Path]::GetFullPath((Join-Path $taskRoot $taskFile.path))
    if (-not $taskPath.StartsWith($taskRoot.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Package path escaped its root.' }
    if ((Get-Item -LiteralPath $taskPath).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked package file.' }
    $taskActual = (Get-FileHash -LiteralPath $taskPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($taskActual -ne $taskFile.sha256) { throw 'AutoPets package verification failed.' }
}
& (Join-Path $taskRoot 'runtime/node.exe') (Join-Path $taskRoot 'integrations/codex/bootstrap/start.mjs') --package $taskRoot
exit $LASTEXITCODE
