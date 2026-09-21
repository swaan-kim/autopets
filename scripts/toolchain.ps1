function Initialize-AutoPetsToolchain {
    [CmdletBinding()]
    param([string]$ToolchainPath)

    $ErrorActionPreference = 'Stop'
    if (-not [string]::IsNullOrWhiteSpace($ToolchainPath)) {
        try {
            $taskToolchainFile = Resolve-Path -LiteralPath $ToolchainPath -ErrorAction Stop
        }
        catch {
            throw "AutoPets toolchain script not found: $ToolchainPath"
        }
        if ($taskToolchainFile.Provider.Name -ne 'FileSystem' -or
            -not (Test-Path -LiteralPath $taskToolchainFile.ProviderPath -PathType Leaf) -or
            [System.IO.Path]::GetExtension($taskToolchainFile.ProviderPath) -ne '.ps1') {
            throw "AutoPets toolchain path must point to a PowerShell .ps1 file: $ToolchainPath"
        }
        . $taskToolchainFile.ProviderPath
    }

    if (-not (Get-Command cargo -CommandType Application -ErrorAction SilentlyContinue)) {
        throw 'Rust MSVC toolchain is required on PATH. You may supply -ToolchainPath or AUTOPETS_TOOLCHAIN_PATH. See docs/releases/windows.md.'
    }
    if (-not (Get-Command cl.exe -CommandType Application -ErrorAction SilentlyContinue)) {
        throw 'MSVC is not ready. Use Developer PowerShell for Visual Studio or supply -ToolchainPath or AUTOPETS_TOOLCHAIN_PATH. See docs/releases/windows.md.'
    }
}
