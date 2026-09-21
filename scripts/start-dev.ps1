param([string]$ToolchainPath = $env:AUTOPETS_TOOLCHAIN_PATH)

$ErrorActionPreference = 'Stop'
$taskProject = Split-Path $PSScriptRoot -Parent
. (Join-Path $PSScriptRoot 'toolchain.ps1')
Initialize-AutoPetsToolchain -ToolchainPath $ToolchainPath
$taskApp = Join-Path $taskProject 'apps\desktop'
Set-Location -LiteralPath $taskApp
# Native AppData default applies unless the caller explicitly set AUTOPETS_DATA_DIR.
& node 'node_modules/@tauri-apps/cli/tauri.js' dev
exit $LASTEXITCODE
