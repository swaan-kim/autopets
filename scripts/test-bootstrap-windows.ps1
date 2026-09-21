param([Parameter(Mandatory=$true)][string]$Package)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or -not $env:RUNNER_TEMP) { throw 'This native install check runs only on the disposable CI runner.' }
$taskRoot = Join-Path $env:RUNNER_TEMP ('autopets-설치 test-' + [Guid]::NewGuid().ToString('N'))
$taskExpanded = Join-Path $taskRoot 'package'
New-Item -ItemType Directory -Path $taskExpanded -Force | Out-Null
Expand-Archive -LiteralPath $Package -DestinationPath $taskExpanded
$env:AUTOPETS_HOME = Join-Path $taskRoot 'managed'
$env:AUTOPETS_DATA_DIR = Join-Path $taskRoot 'data'
$env:CODEX_HOME = Join-Path $taskRoot 'codex'
Remove-Item Env:CODEX_THREAD_ID -ErrorAction SilentlyContinue
Remove-Item Env:AUTOPETS_CONNECTION_FILE -ErrorAction SilentlyContinue
$taskNode = Join-Path $taskExpanded 'runtime/node.exe'
$taskStart = Join-Path $taskExpanded 'integrations/codex/bootstrap/start.mjs'
$taskApp = [IO.Path]::GetFullPath((Join-Path $env:AUTOPETS_HOME 'app/AutoPets.exe'))
function Stop-TestApp {
    Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and [string]::Equals($_.Path, $taskApp, [StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force
}
try {
    $taskFirst = (& (Join-Path $taskExpanded 'install.ps1') | ConvertFrom-Json)
    if ($LASTEXITCODE -ne 0 -or -not $taskFirst.ok -or -not $taskFirst.appReady -or $taskFirst.chatConnected -or $taskFirst.guidanceDelivered) { throw 'First installation did not reach honest app-ready state.' }
    $taskHooks = Get-Content -LiteralPath (Join-Path $env:CODEX_HOME 'hooks.json') -Raw
    $taskAppTime = (Get-Item -LiteralPath $taskApp).LastWriteTimeUtc
    $taskSecond = (& $taskNode $taskStart | ConvertFrom-Json)
    if ($LASTEXITCODE -ne 0 -or -not $taskSecond.ok -or (Get-Item -LiteralPath $taskApp).LastWriteTimeUtc -ne $taskAppTime) { throw 'Repeat call reinstalled or failed.' }
    if ((Get-Content -LiteralPath (Join-Path $env:CODEX_HOME 'hooks.json') -Raw) -ne $taskHooks) { throw 'Repeated setup duplicated hooks.' }
    $taskDisconnected = (& $taskNode $taskStart --disconnect | ConvertFrom-Json)
    if ($LASTEXITCODE -ne 0 -or -not $taskDisconnected.disconnected) { throw 'Disconnect failed.' }
    Stop-TestApp
    '{"session_id":"ci-synthetic","turn_id":"ci-turn","cwd":"C:\\","hook_event_name":"Stop"}' | & $taskNode (Join-Path $taskExpanded 'integrations/codex/bootstrap/user-hook.mjs') observe --autopets-user-v1 | Out-Null
    if (@(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and [string]::Equals($_.Path, $taskApp, [StringComparison]::OrdinalIgnoreCase) }).Count -ne 0) { throw 'A hook restarted the stopped app.' }
    '{"nativeInstall":true,"bundledRuntime":true,"repeatWithoutReinstall":true,"disconnect":true,"liveCodexVerified":false,"windowsPolicyVerified":false}' | Set-Content -LiteralPath 'work/bootstrap-windows-evidence.json' -Encoding UTF8
} finally { Stop-TestApp }
