param([Parameter(Mandatory=$true)][string]$Installer)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:RUNNER_OS -ne 'Windows' -or $env:GITHUB_REPOSITORY -ne 'swaan-kim/autopets') {
    throw 'This check runs only on the disposable GitHub-hosted Windows runner.'
}
if ($env:AUTOPETS_HOME -or $env:AUTOPETS_DATA_DIR -or $env:AUTOPETS_CONNECTION_FILE) { throw 'Default product paths are required for this check.' }
$taskInstaller = (Resolve-Path -LiteralPath $Installer).Path
$taskExpectedHash = 'aedd45bc8cb71e8ffa5b338c6c3fb9ec8b2e811663b79da8710b7a8cab85c5da'
if ((Get-FileHash -LiteralPath $taskInstaller -Algorithm SHA256).Hash.ToLowerInvariant() -ne $taskExpectedHash) { throw 'Installer differs from the previously verified build.' }
$taskProgram = Join-Path $env:LOCALAPPDATA 'AutoPets'
$taskData = Join-Path $env:LOCALAPPDATA 'local.autopets.desktop'
$taskApp = Join-Path $taskProgram 'autopets.exe'
$taskRoot = Join-Path $env:RUNNER_TEMP ('autopets-roundtrip-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $taskRoot -Force | Out-Null
$taskEvidenceDirectory = Join-Path $env:GITHUB_WORKSPACE 'work/installer-roundtrip'
New-Item -ItemType Directory -Path $taskEvidenceDirectory -Force | Out-Null
$taskResult = [ordered]@{ installerSha256 = $taskExpectedHash; installerBytes = (Get-Item -LiteralPath $taskInstaller).Length; signature = (Get-AuthenticodeSignature -LiteralPath $taskInstaller).Status.ToString(); sourceCommit = 'db06cb964be9824d8a975710f055fcfc1a1d0ed3'; buildCommit = '8b39f29f4bb373fda2637f65fa3af988883cb3b0'; harnessCommit = $env:GITHUB_SHA; environment = 'GitHub-hosted Windows'; steps = @(); outcome = 'incomplete'; desktopAppLaunched = $false; normalExitVerified = $false; cleanConsumerPcVerified = $false }

function Get-Registration {
    foreach ($taskKey in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\AutoPets', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\AutoPets', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\AutoPets')) {
        if (Test-Path -LiteralPath $taskKey) {
            $taskValue = Get-ItemProperty -LiteralPath $taskKey
            [pscustomobject]@{ key = $taskKey; version = $taskValue.DisplayVersion; installLocation = $taskValue.InstallLocation; uninstallString = $taskValue.UninstallString }
        }
    }
}
function Get-OwnedProcesses {
    Get-CimInstance Win32_Process | Where-Object { $_.Name -ieq 'autopets.exe' -or ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($taskProgram + '\', [StringComparison]::OrdinalIgnoreCase)) } | Select-Object ProcessId,Name,ExecutablePath
}
function Get-Shortcuts {
    $taskShell = New-Object -ComObject WScript.Shell
    try {
        $taskLocations = @('DesktopDirectory','CommonDesktopDirectory','Programs','CommonPrograms') | ForEach-Object { [Environment]::GetFolderPath($_) } | Where-Object { $_ } | Sort-Object -Unique
        foreach ($taskLocation in $taskLocations) {
            if (-not (Test-Path -LiteralPath $taskLocation)) { continue }
            foreach ($taskLink in Get-ChildItem -LiteralPath $taskLocation -Filter '*.lnk' -File -Recurse) {
                $taskShortcut = $taskShell.CreateShortcut($taskLink.FullName)
                if ($taskShortcut.TargetPath -ieq $taskApp -or $taskLink.BaseName -ieq 'AutoPets') {
                    [pscustomobject]@{ path = $taskLink.FullName; target = $taskShortcut.TargetPath }
                }
                [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($taskShortcut)
            }
        }
    } finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($taskShell) }
}
function Get-Files([string]$Directory) {
    if (Test-Path -LiteralPath $Directory) {
        Get-ChildItem -LiteralPath $Directory -File -Recurse | Sort-Object FullName | ForEach-Object {
            [pscustomobject]@{ path = [IO.Path]::GetRelativePath($Directory, $_.FullName); bytes = $_.Length; sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }
        }
    }
}
function Assert-SameFiles($Before, $After, [string]$Name) {
    if ((ConvertTo-Json -InputObject @($Before) -Depth 5 -Compress) -cne (ConvertTo-Json -InputObject @($After) -Depth 5 -Compress)) { throw "$Name changed." }
}
function Assert-NoProcesses {
    if (@(Get-OwnedProcesses).Count -ne 0) { throw 'Unexpected AutoPets or bundled runtime process. No forced termination is performed.' }
}
function Read-InstalledState {
    Assert-NoProcesses
    $taskRegistration = @(Get-Registration)
    if ($taskRegistration.Count -ne 1 -or $taskRegistration[0].key -notlike 'HKCU:*' -or $taskRegistration[0].version -ne '0.1.0' -or $taskRegistration[0].installLocation.Trim('"','\') -ine $taskProgram) { throw 'Unexpected installation registration.' }
    foreach ($taskFile in @('autopets.exe','uninstall.exe','connector\runtime\node.exe')) {
        if (-not (Test-Path -LiteralPath (Join-Path $taskProgram $taskFile) -PathType Leaf)) { throw "Missing installed file: $taskFile" }
    }
    $taskLinks = @(Get-Shortcuts)
    if ($taskLinks.Count -eq 0 -or @($taskLinks | Where-Object { $_.target -ine $taskApp }).Count -ne 0) { throw 'Missing or incorrect application shortcuts.' }
    $taskNode = Join-Path $taskProgram 'connector/runtime/node.exe'
    $taskVerifier = @'
const {pathToFileURL} = require('node:url');
const path = require('node:path');
(async () => {
  const root = process.argv[1];
  const {verifyPackage} = await import(pathToFileURL(path.join(root,'integrations/codex/bootstrap/start.mjs')));
  const manifest = await verifyPackage(root, {installedResource:true});
  console.log(JSON.stringify({valid:true,files:manifest.files.length,version:manifest.appVersion,runtime:process.version}));
})().catch(error => { console.error(error.message); process.exitCode=1; });
'@
    $taskManifest = & $taskNode -e $taskVerifier (Join-Path $taskProgram 'connector') | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0 -or -not $taskManifest.valid) { throw 'Installed connector payload verification failed.' }
    $taskFiles = @(Get-Files $taskProgram)
    [pscustomobject]@{ registration = $taskRegistration; shortcuts = $taskLinks; payload = $taskManifest; fileCount = $taskFiles.Count; programBytes = ($taskFiles | Measure-Object bytes -Sum).Sum; executableHash = (Get-FileHash -LiteralPath $taskApp -Algorithm SHA256).Hash }
}
function Invoke-Fixture([string]$Phase) {
    $env:AUTOPETS_INSTALL_FIXTURE_PHASE = $Phase
    $env:AUTOPETS_INSTALL_FIXTURE_EVIDENCE = Join-Path $taskRoot ($Phase + '.json')
    & cargo +stable test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml --lib application::store::install_roundtrip::installer_fixture -- --ignored --exact --nocapture
    if ($LASTEXITCODE -ne 0) { throw "Data fixture failed: $Phase" }
    Copy-Item -LiteralPath $env:AUTOPETS_INSTALL_FIXTURE_EVIDENCE -Destination $taskEvidenceDirectory
}
function Invoke-Setup([string]$Executable, [string]$Step) {
    $taskTimer = [Diagnostics.Stopwatch]::StartNew()
    # -Wait follows the standard NSIS uninstaller's self-relocated child too.
    $taskProcess = Start-Process -FilePath $Executable -ArgumentList '/S' -PassThru -Wait -WindowStyle Hidden
    $taskTimer.Stop()
    $taskResult.steps += [pscustomobject]@{ step = $Step; seconds = [Math]::Round($taskTimer.Elapsed.TotalSeconds, 3); launcherExitCode = $taskProcess.ExitCode }
    if ($taskProcess.ExitCode -ne 0) { throw "$Step returned $($taskProcess.ExitCode)." }
}

try {
    if ((Test-Path -LiteralPath $taskProgram) -or (Test-Path -LiteralPath $taskData) -or @(Get-Registration).Count -or @(Get-Shortcuts).Count) { throw 'Runner already has AutoPets state; refusing to replace it.' }
    Assert-NoProcesses
    $taskCodexDirectory = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.codex'
    $taskAiBaseline = @(Get-Files $taskCodexDirectory)
    Invoke-Setup $taskInstaller 'install'
    $taskResult.firstInstall = Read-InstalledState
    $taskProgramBaseline = @(Get-Files $taskProgram)
    Assert-SameFiles $taskAiBaseline @(Get-Files $taskCodexDirectory) 'AI settings after install'
    Invoke-Fixture 'seed'
    $taskDataBaseline = @(Get-Files $taskData)
    $taskDataBaseline | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $taskEvidenceDirectory 'data-before-removal.json') -Encoding UTF8
    $taskUninstaller = Join-Path $taskProgram 'uninstall.exe'
    if ($taskResult.firstInstall.registration[0].uninstallString.Trim('"') -ine $taskUninstaller) { throw 'Unexpected registered uninstall command.' }
    Invoke-Setup $taskUninstaller 'uninstall'
    $taskRemainingFiles = @(Get-Files $taskProgram)
    $taskRemainingRegistry = @(Get-Registration)
    $taskRemainingLinks = @(Get-Shortcuts)
    $taskRemainingProcesses = @(Get-OwnedProcesses)
    $taskResult.removal = [pscustomobject]@{ remainingFiles = $taskRemainingFiles; remainingRegistry = $taskRemainingRegistry; remainingShortcuts = $taskRemainingLinks; remainingProcesses = $taskRemainingProcesses; programDirectoryExists = (Test-Path -LiteralPath $taskProgram) }
    if ($taskRemainingFiles.Count -or $taskRemainingRegistry.Count -or $taskRemainingLinks.Count -or $taskRemainingProcesses.Count) { throw 'Uninstall left application files, registration, shortcuts or processes.' }
    Assert-SameFiles $taskDataBaseline @(Get-Files $taskData) 'Data files after uninstall'
    Assert-SameFiles $taskAiBaseline @(Get-Files $taskCodexDirectory) 'AI settings after uninstall'
    $taskResult.removalDataByteIdentical = $true
    Invoke-Fixture 'verify-removed'
    $taskDataBeforeReinstall = @(Get-Files $taskData)
    Invoke-Setup $taskInstaller 'reinstall'
    $taskResult.reinstall = Read-InstalledState
    Assert-SameFiles $taskProgramBaseline @(Get-Files $taskProgram) 'Reinstalled program payload'
    Assert-SameFiles $taskDataBeforeReinstall @(Get-Files $taskData) 'Data files after reinstall'
    Assert-SameFiles $taskAiBaseline @(Get-Files $taskCodexDirectory) 'AI settings after reinstall'
    $taskResult.reinstallDataByteIdentical = $true
    Invoke-Fixture 'verify-reinstalled'
    $taskResult.aiConfigurationUnchanged = $true
    $taskResult.outcome = 'passed'
} catch {
    $taskResult.outcome = 'failed'
    $taskResult.failure = $_.Exception.Message
    throw
} finally {
    $taskResult | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $taskEvidenceDirectory 'result.json') -Encoding UTF8
}
