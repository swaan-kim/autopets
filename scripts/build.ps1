param([string]$ToolchainPath = $env:AUTOPETS_TOOLCHAIN_PATH)

$ErrorActionPreference = 'Stop'
$taskProject = Split-Path $PSScriptRoot -Parent
. (Join-Path $PSScriptRoot 'toolchain.ps1')
Initialize-AutoPetsToolchain -ToolchainPath $ToolchainPath
$taskApp = Join-Path $taskProject 'apps\desktop'
Set-Location -LiteralPath $taskApp
& node 'node_modules/@tauri-apps/cli/tauri.js' build --no-bundle
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$taskExe = Join-Path $taskApp 'src-tauri\target\release\autopets.exe'
if (-not (Test-Path -LiteralPath $taskExe)) { throw 'Build did not produce the expected Windows executable.' }
$taskRelease = Join-Path $taskProject 'release'
New-Item -ItemType Directory -Force -Path $taskRelease | Out-Null
Copy-Item -LiteralPath $taskExe -Destination (Join-Path $taskRelease 'AutoPets.exe')
Write-Output (Join-Path $taskRelease 'AutoPets.exe')
