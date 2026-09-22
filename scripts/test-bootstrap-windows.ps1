param([Parameter(Mandatory=$true)][string]$Installer)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or -not $env:RUNNER_TEMP) { throw 'This native install check runs only on the disposable CI runner.' }
$taskRoot = Join-Path $env:RUNNER_TEMP ('autopets-설치 test-' + [Guid]::NewGuid().ToString('N'))
$taskAppDirectory = Join-Path $taskRoot 'app'
New-Item -ItemType Directory -Path $taskAppDirectory -Force | Out-Null
$env:AUTOPETS_HOME = Join-Path $taskRoot 'managed'
$env:AUTOPETS_DATA_DIR = Join-Path $taskRoot 'data'
$env:CODEX_HOME = Join-Path $taskRoot 'codex'
Remove-Item Env:CODEX_THREAD_ID -ErrorAction SilentlyContinue
Remove-Item Env:AUTOPETS_CONNECTION_FILE -ErrorAction SilentlyContinue
$taskResources = Join-Path $taskAppDirectory 'connector'
$taskNode = Join-Path $taskResources 'runtime/node.exe'
$taskStart = Join-Path $taskResources 'integrations/codex/bootstrap/start.mjs'
$taskApp = [IO.Path]::GetFullPath((Join-Path $taskAppDirectory 'AutoPets.exe'))
function Stop-TestApp {
    Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and [string]::Equals($_.Path, $taskApp, [StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force
}
try {
    # NSIS requires its FINAL /D value unquoted, including spaces and Korean text.
    $taskInstall = Start-Process -FilePath ([IO.Path]::GetFullPath($Installer)) -ArgumentList @('/S', "/D=$taskAppDirectory") -PassThru -Wait -WindowStyle Hidden
    if ($taskInstall.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $taskApp -PathType Leaf) -or -not (Test-Path -LiteralPath $taskNode -PathType Leaf)) { throw 'Single self-contained EXE installation failed.' }
    if (Test-Path -LiteralPath $env:CODEX_HOME) { throw 'Silent installer changed AI settings before explicit connection.' }
    Start-Process -FilePath $taskApp -WindowStyle Hidden
    $taskDeadline = [DateTime]::UtcNow.AddSeconds(30)
    $taskInitial = $null
    while ([DateTime]::UtcNow -lt $taskDeadline) {
        try {
            $taskConnection = Get-Content -LiteralPath (Join-Path $env:AUTOPETS_DATA_DIR 'connection.json') -Raw | ConvertFrom-Json
            $taskInitial = Invoke-RestMethod -Uri "$($taskConnection.baseUrl)/v1/setup" -Headers @{ Authorization = "Bearer $($taskConnection.token)" } -TimeoutSec 2
            break
        } catch { Start-Sleep -Milliseconds 250 }
    }
    if (-not $taskInitial -or -not $taskInitial.appReady -or $taskInitial.chatConnected -or $taskInitial.guidanceDelivered) { throw 'Installed app did not reach honest app-ready state.' }
    if (Test-Path -LiteralPath $env:CODEX_HOME) { throw 'App launch connected AI without an explicit action.' }
    New-Item -ItemType Directory -Path $env:CODEX_HOME -Force | Out-Null
    $taskUnrelatedHooks = '{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"unrelated-fixture-command"}]}]}}'
    $taskHooksPath = Join-Path $env:CODEX_HOME 'hooks.json'
    $taskUnrelatedHooks | Set-Content -LiteralPath $taskHooksPath -Encoding UTF8
    $taskFirst = (& $taskNode $taskStart --installed-resource $taskResources --connect --app-executable $taskApp | ConvertFrom-Json)
    if ($LASTEXITCODE -ne 0 -or -not $taskFirst.ok -or -not $taskFirst.appReady -or $taskFirst.chatConnected -or $taskFirst.guidanceDelivered) { throw 'Explicit connection did not reach event-waiting state.' }
    $taskHooks = Get-Content -LiteralPath $taskHooksPath -Raw
    $taskAppTime = (Get-Item -LiteralPath $taskApp).LastWriteTimeUtc
    # Skill/AI repeat uses the same installed resources, not a ZIP or download.
    $taskManagedNode = Join-Path $env:AUTOPETS_HOME 'connector/runtime/node.exe'
    $taskManagedStart = Join-Path $env:AUTOPETS_HOME 'connector/integrations/codex/bootstrap/start.mjs'
    $taskSecond = (& $taskManagedNode $taskManagedStart | ConvertFrom-Json)
    if ($LASTEXITCODE -ne 0 -or -not $taskSecond.ok -or (Get-Item -LiteralPath $taskApp).LastWriteTimeUtc -ne $taskAppTime) { throw 'AI repeat reinstalled or failed.' }
    if ((Get-Content -LiteralPath $taskHooksPath -Raw) -ne $taskHooks) { throw 'Repeated connection duplicated hooks.' }
    $taskManagedLicense = Join-Path $env:AUTOPETS_HOME 'connector/runtime/LICENSE'
    'repair-fixture' | Set-Content -LiteralPath $taskManagedLicense
    $taskRepair = (& $taskNode $taskStart --installed-resource $taskResources --connect --app-executable $taskApp | ConvertFrom-Json)
    if ($LASTEXITCODE -ne 0 -or -not $taskRepair.ok -or (Get-FileHash -LiteralPath $taskManagedLicense).Hash -ne (Get-FileHash -LiteralPath (Join-Path $taskResources 'runtime/LICENSE')).Hash) { throw 'Installed-resource repair failed.' }
    $taskDisconnected = (& $taskNode $taskStart --disconnect | ConvertFrom-Json)
    if ($LASTEXITCODE -ne 0 -or -not $taskDisconnected.disconnected) { throw 'Disconnect failed.' }
    Stop-TestApp
    '{"session_id":"ci-synthetic","turn_id":"ci-turn","cwd":"C:\\","hook_event_name":"Stop"}' | & $taskNode (Join-Path $taskResources 'integrations/codex/bootstrap/user-hook.mjs') observe --autopets-user-v1 | Out-Null
    if (@(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and [string]::Equals($_.Path, $taskApp, [StringComparison]::OrdinalIgnoreCase) }).Count -ne 0) { throw 'A hook restarted the stopped app.' }
    # Exercise uninstaller-owned removal too, not only an already-disconnected app.
    $taskReconnect = (& $taskNode $taskStart | ConvertFrom-Json)
    if ($LASTEXITCODE -ne 0 -or -not $taskReconnect.ok) { throw 'Reconnect before uninstall failed.' }
    Stop-TestApp
    $taskUninstallers = @(Get-ChildItem -LiteralPath $taskAppDirectory -Filter '*uninstall*.exe' -File)
    if ($taskUninstallers.Count -ne 1) { throw 'Expected one application uninstaller.' }
    $taskUninstall = Start-Process -FilePath $taskUninstallers[0].FullName -ArgumentList @('/S', "_?=$taskAppDirectory") -PassThru -Wait -WindowStyle Hidden
    if ($taskUninstall.ExitCode -ne 0 -or (Test-Path -LiteralPath $taskApp)) { throw 'Application removal failed.' }
    $taskRemainingHooks = Get-Content -LiteralPath $taskHooksPath -Raw | ConvertFrom-Json
    if (($taskRemainingHooks | ConvertTo-Json -Depth 20 -Compress) -ne (($taskUnrelatedHooks | ConvertFrom-Json) | ConvertTo-Json -Depth 20 -Compress)) { throw 'Uninstall did not remove only the owned AI hooks.' }
    if (Test-Path -LiteralPath (Join-Path $env:CODEX_HOME 'skills/autopets/SKILL.md')) { throw 'Uninstall left the owned skill behind.' }
    if (-not (Test-Path -LiteralPath $env:AUTOPETS_DATA_DIR)) { throw 'Uninstall unexpectedly removed application records.' }
    '{"nativeInstall":true,"singleExe":true,"bundledRuntime":true,"installerDoesNotConnect":true,"explicitConnect":true,"repeatWithoutReinstall":true,"repair":true,"disconnect":true,"uninstall":true,"liveCodexVerified":false,"windowsPolicyVerified":false,"signedUpdateVerified":false}' | Set-Content -LiteralPath 'work/bootstrap-windows-evidence.json' -Encoding UTF8
} finally { Stop-TestApp }
