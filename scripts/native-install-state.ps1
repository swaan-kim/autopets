# Helpers for the CI-only native lifecycle harness; never remove files manually.
function Get-InstallRegistration {
    foreach ($taskKey in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\AutoPets','HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\AutoPets','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\AutoPets')) {
        if (Test-Path -LiteralPath $taskKey) {
            $taskValue = Get-ItemProperty -LiteralPath $taskKey
            [pscustomobject]@{ key = $taskKey; version = $taskValue.DisplayVersion; location = $taskValue.InstallLocation; uninstall = $taskValue.UninstallString }
        }
    }
}
function Get-InstallShortcuts {
    $taskShell = New-Object -ComObject WScript.Shell
    try {
        $taskLocations = @('DesktopDirectory','CommonDesktopDirectory','Programs','CommonPrograms') | ForEach-Object { [Environment]::GetFolderPath($_) } | Where-Object { $_ } | Sort-Object -Unique
        foreach ($taskLocation in $taskLocations) {
            foreach ($taskLink in Get-ChildItem -LiteralPath $taskLocation -Filter '*.lnk' -File -Recurse -ErrorAction SilentlyContinue) {
                $taskShortcut = $taskShell.CreateShortcut($taskLink.FullName)
                if ($taskShortcut.TargetPath -ieq $taskApp -or $taskLink.BaseName -ieq 'AutoPets') {
                    [pscustomobject]@{ path = $taskLink.FullName; target = $taskShortcut.TargetPath }
                }
                [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($taskShortcut)
            }
        }
    } finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($taskShell) }
}
function Get-StateFiles([string]$Directory, [switch]$DurableOnly) {
    if (Test-Path -LiteralPath $Directory) {
        Get-ChildItem -LiteralPath $Directory -File -Recurse | Where-Object {
            -not $DurableOnly -or $_.FullName -notlike (Join-Path $Directory 'EBWebView\*')
        } | Sort-Object FullName | ForEach-Object {
            [pscustomobject]@{ path = $_.FullName.Substring($Directory.TrimEnd('\').Length + 1); bytes = $_.Length; sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }
        }
    }
}
function Assert-StateFiles($Before, $After, [string]$Name) {
    if ((ConvertTo-Json -InputObject @($Before) -Depth 5 -Compress) -cne (ConvertTo-Json -InputObject @($After) -Depth 5 -Compress)) { throw "$Name changed." }
}
function Invoke-InstallerStep([string]$Executable, [string]$Step) {
    if (@(Get-AppProcesses).Count) { throw 'Installer requires a normally stopped app.' }
    $taskTimer = [Diagnostics.Stopwatch]::StartNew()
    $taskProcess = Start-Process -FilePath $Executable -ArgumentList '/S' -PassThru -Wait -WindowStyle Hidden
    $taskTimer.Stop()
    $taskResult.steps += [pscustomobject]@{ step = $Step; seconds = [Math]::Round($taskTimer.Elapsed.TotalSeconds, 3); exitCode = $taskProcess.ExitCode }
    if ($taskProcess.ExitCode -ne 0) { throw "$Step failed with exit code $($taskProcess.ExitCode)." }
}
function Read-InstallFootprint {
    $taskRegistration = @(Get-InstallRegistration)
    if ($taskRegistration.Count -ne 1 -or $taskRegistration[0].key -notlike 'HKCU:*' -or $taskRegistration[0].version -ne '0.1.0' -or $taskRegistration[0].location.Trim('"','\') -ine $taskAppDirectory -or $taskRegistration[0].uninstall.Trim('"') -ine (Join-Path $taskAppDirectory 'uninstall.exe')) { throw 'Unexpected installation registration.' }
    $taskLinks = @(Get-InstallShortcuts)
    if (-not $taskLinks.Count -or @($taskLinks | Where-Object { $_.target -ine $taskApp }).Count) { throw 'Missing or incorrect shortcuts.' }
    $taskVerifier = @'
const {pathToFileURL} = require('node:url');
const path = require('node:path');
(async () => {
  const root = process.argv[1];
  const {verifyPackage} = await import(pathToFileURL(path.join(root,'integrations/codex/bootstrap/start.mjs')));
  const manifest = await verifyPackage(root, {installedResource:true});
  console.log(JSON.stringify({valid:true,files:manifest.files.length,runtime:process.version}));
})().catch(error => { console.error(error.message); process.exitCode=1; });
'@
    $taskPayload = & $taskNode -e $taskVerifier (Join-Path $taskAppDirectory 'connector') | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0 -or -not $taskPayload.valid) { throw 'Bundled payload verification failed.' }
    $taskFiles = @(Get-ChildItem -LiteralPath $taskAppDirectory -File -Recurse)
    [pscustomobject]@{ registration = $taskRegistration; shortcuts = $taskLinks; payload = $taskPayload; fileCount = $taskFiles.Count; programBytes = ($taskFiles | Measure-Object Length -Sum).Sum; executableHash = (Get-FileHash -LiteralPath $taskApp -Algorithm SHA256).Hash }
}
function Assert-Uninstalled {
    $taskProcesses = @(Get-CimInstance Win32_Process | Where-Object {
        $_.Name -ieq 'autopets.exe' -or ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($taskAppDirectory + '\', [StringComparison]::OrdinalIgnoreCase))
    })
    if ((Test-Path -LiteralPath $taskAppDirectory) -or @(Get-InstallRegistration).Count -or @(Get-InstallShortcuts).Count -or $taskProcesses.Count) { throw 'Uninstall left program files, registration, shortcuts or processes.' }
    $taskResult.removal = [pscustomobject]@{ programDirectoryExists = $false; registrationCount = 0; shortcutCount = 0; processCount = 0 }
}
