$ErrorActionPreference = 'Stop'
$taskProject = Split-Path $PSScriptRoot -Parent
$taskWorkspace = Split-Path (Split-Path $taskProject -Parent) -Parent
$taskToolchain = Join-Path $taskWorkspace 'work\toolchain\enable-toolchain.ps1'
if (Test-Path -LiteralPath $taskToolchain) { . $taskToolchain }
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) { throw 'Rust MSVC toolchain is required. See README.md.' }
if (-not (Get-Command cl.exe -ErrorAction SilentlyContinue)) { throw 'MSVC is not ready. Start from Developer PowerShell for Visual Studio, or complete the Build Tools installation described in README.md.' }
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
