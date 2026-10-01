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
    Write-Host "Installer step started: $Step"
    # Preserve -Wait's descendant handling for the self-relocating uninstaller,
    # while bounding the entire operation. A timeout is failure, never success.
    $taskJob = Start-Job -ScriptBlock {
        param($taskExecutable)
        $ErrorActionPreference = 'Stop'
        $taskTimer = [Diagnostics.Stopwatch]::StartNew()
        $taskProcess = Start-Process -FilePath $taskExecutable -ArgumentList '/S' -PassThru -Wait -WindowStyle Hidden
        $taskTimer.Stop()
        return [pscustomobject]@{ exitCode = $taskProcess.ExitCode; seconds = [Math]::Round($taskTimer.Elapsed.TotalSeconds, 3) }
    } -ArgumentList $Executable
    if (-not (Wait-Job -Job $taskJob -Timeout 120)) {
        $taskResult.timedOutInstallerStep = $Step
        $taskResult.installerProcesses = @(Get-CimInstance Win32_Process | Where-Object {
            $_.Name -match 'autopets|setup|uninstall|webview' -or $_.ExecutablePath -eq $Executable
        } | Select-Object Name,ProcessId,ParentProcessId,ExecutablePath)
        $taskResult.visibleWindows = @([System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition) | ForEach-Object {
            [pscustomobject]@{ name = $_.Current.Name; pid = $_.Current.ProcessId }
        })
        throw "Installer step timed out after 120 seconds: $Step. No forced-termination pass is allowed."
    }
    $taskMeasurement = Receive-Job -Job $taskJob -ErrorAction Stop
    if ($taskJob.State -ne 'Completed' -or @($taskMeasurement).Count -ne 1 -or $null -eq $taskMeasurement.exitCode) { throw "Installer worker failed: $Step" }
    $taskExitCode = [int]$taskMeasurement.exitCode
    Remove-Job -Job $taskJob
    $taskResult.steps += [pscustomobject]@{ step = $Step; seconds = $taskMeasurement.seconds; exitCode = $taskExitCode }
    Write-Host "Installer step finished: $Step ($taskExitCode)"
    if ($taskExitCode -ne 0) { throw "$Step failed with exit code $taskExitCode." }
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
