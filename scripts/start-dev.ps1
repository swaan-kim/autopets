$ErrorActionPreference = 'Stop'
$taskProject = Split-Path $PSScriptRoot -Parent
$taskWorkspace = Split-Path (Split-Path $taskProject -Parent) -Parent
$taskToolchain = Join-Path $taskWorkspace 'work\toolchain\enable-toolchain.ps1'
if (Test-Path -LiteralPath $taskToolchain) { . $taskToolchain }
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) { throw 'Rust MSVC toolchain is required. See README.md.' }
if (-not (Get-Command cl.exe -ErrorAction SilentlyContinue)) {
    throw 'MSVC is not ready. Start from Developer PowerShell for Visual Studio, or complete the Build Tools installation described in README.md.'
}
$taskApp = Join-Path $taskProject 'apps\desktop'
Set-Location -LiteralPath $taskApp
# Native AppData default applies unless the caller explicitly set AUTOPETS_DATA_DIR.
& node 'node_modules/@tauri-apps/cli/tauri.js' dev
exit $LASTEXITCODE
