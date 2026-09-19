$ErrorActionPreference = 'Stop'
$taskProject = Split-Path $PSScriptRoot -Parent
$taskRelease = Join-Path $taskProject 'release'
$taskExe = Join-Path $taskRelease 'AutoPets.exe'
if (-not (Test-Path -LiteralPath $taskExe -PathType Leaf)) {
    throw 'AutoPets.exe is not built yet. Run scripts/build.ps1 first.'
}

# The GUI is user-requested. Launch it directly without an intermediate shell.
# Native AppData default applies unless the caller explicitly set AUTOPETS_DATA_DIR.
Start-Process -FilePath $taskExe -WorkingDirectory $taskRelease | Out-Null
