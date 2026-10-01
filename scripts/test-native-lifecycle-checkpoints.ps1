# File-only regression. It extracts the writer function without executing the
# native lifecycle harness, loading UI Automation, or starting any application.
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -ne 5 -or $PSVersionTable.PSVersion.Minor -ne 1) {
    throw 'Run this regression with Windows PowerShell 5.1.'
}
$taskTokens = $null; $taskParseErrors = $null
$taskAst = [Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'test-native-window-lifecycle.ps1'), [ref]$taskTokens, [ref]$taskParseErrors)
if ($taskParseErrors.Count) { throw 'Native lifecycle script does not parse.' }
$taskFunction = @($taskAst.FindAll({ param($item) $item -is [Management.Automation.Language.FunctionDefinitionAst] -and $item.Name -eq 'Write-LifecycleCheckpoint' }, $true))
if ($taskFunction.Count -ne 1) { throw 'Expected one checkpoint writer.' }
Invoke-Expression $taskFunction[0].Extent.Text

$taskDirectory = Join-Path ([IO.Path]::GetTempPath()) ('autopets-checkpoint-' + [Guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($taskDirectory)
$taskPhasePath = Join-Path $taskDirectory 'phase.json'
$taskDonePath = Join-Path $taskDirectory 'done'
$taskReadyPath = Join-Path $taskDirectory 'ready'
$taskReader = $null; $taskReaderResult = $null
$taskKorean = [regex]::Unescape('\ud3ab \uc900\ube44 \ud655\uc778')
try {
    $taskInitial = @{ name = 'checkpoint-0'; sequence = 0; label = $taskKorean; payload = ('x' * 8192) }
    Write-LifecycleCheckpoint $taskPhasePath $taskInitial
    # A reader permitting writes but no second read makes any hidden encoding
    # read in the writer fail deterministically; writing itself stays allowed.
    $taskHeldReader = [IO.File]::Open($taskPhasePath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Write)
    try {
        $taskLegacyError = $null
        try { $taskInitial | ConvertTo-Json | Set-Content -LiteralPath $taskPhasePath -Encoding UTF8 }
        catch { $taskLegacyError = $_.Exception.Message }
        Write-LifecycleCheckpoint $taskPhasePath $taskInitial
    } finally { $taskHeldReader.Dispose() }
    if ((Get-Content -LiteralPath $taskPhasePath -Raw | ConvertFrom-Json).label -cne $taskKorean) { throw 'UTF-8 content did not survive the held reader.' }

    $taskReader = [PowerShell]::Create()
    [void]$taskReader.AddScript({
        param($PhasePath, $DonePath, $ReadyPath, $ExpectedLabel)
        $ErrorActionPreference = 'Stop'
        $taskObserved = 0; $taskPartial = 0; $taskLastPartial = $null
        $taskDeadline = [DateTime]::UtcNow.AddSeconds(30)
        [IO.File]::WriteAllText($ReadyPath, 'ready')
        while (-not (Test-Path -LiteralPath $DonePath) -and [DateTime]::UtcNow -lt $taskDeadline) {
            try {
                $taskValue = Get-Content -LiteralPath $PhasePath -Raw | ConvertFrom-Json
                if ($null -eq $taskValue -or $taskValue.name -notmatch '^checkpoint-[0-9]+$' -or $taskValue.label -cne $ExpectedLabel -or $taskValue.payload.Length -ne 8192) { throw 'Incomplete checkpoint.' }
                $taskObserved++
            } catch { $taskPartial++; $taskLastPartial = $_.Exception.Message } # Same retry behavior as the watchdog.
        }
        [pscustomobject]@{ observed = $taskObserved; partialReadsRetried = $taskPartial; lastPartial = $taskLastPartial; completed = (Test-Path -LiteralPath $DonePath) }
    }).AddArgument($taskPhasePath).AddArgument($taskDonePath).AddArgument($taskReadyPath).AddArgument($taskKorean)
    $taskReaderAsync = $taskReader.BeginInvoke()
    $taskReadyDeadline = [DateTime]::UtcNow.AddSeconds(5)
    while (-not (Test-Path -LiteralPath $taskReadyPath)) {
        if ([DateTime]::UtcNow -ge $taskReadyDeadline) { throw 'Concurrent reader did not start.' }
        Start-Sleep -Milliseconds 10
    }
    for ($taskIndex = 1; $taskIndex -le 1000; $taskIndex++) {
        Write-LifecycleCheckpoint $taskPhasePath @{ name = "checkpoint-$taskIndex"; sequence = $taskIndex; label = $taskKorean; payload = ('x' * 8192) }
    }
    [IO.File]::WriteAllText($taskDonePath, 'done')
    $taskReaderResult = @($taskReader.EndInvoke($taskReaderAsync))
    # HadErrors also includes intentionally caught partial JSON errors. Only
    # unhandled stream errors or missing valid observations fail this reader.
    if ($taskReader.Streams.Error.Count -gt 0 -or $taskReaderResult.Count -ne 1 -or -not $taskReaderResult[0].completed -or $taskReaderResult[0].observed -lt 1) { throw ('Concurrent reader did not observe a complete checkpoint: ' + ($taskReaderResult | ConvertTo-Json -Compress) + ' ' + ($taskReader.Streams.Error | Out-String)) }
    $taskFinal = Get-Content -LiteralPath $taskPhasePath -Raw | ConvertFrom-Json
    if ($taskFinal.sequence -ne 1000 -or $taskFinal.label -cne $taskKorean -or $taskFinal.payload.Length -ne 8192) { throw 'Final checkpoint contents changed.' }
    [pscustomobject]@{ passed = $true; powershell = $PSVersionTable.PSVersion.ToString(); legacySetContentError = $taskLegacyError; heldReaderWritePassed = $true; writes = 1000; reader = $taskReaderResult[0]; finalSequence = $taskFinal.sequence; utf8Preserved = $true; nativeUiUsed = $false } | ConvertTo-Json -Depth 5
} finally {
    if ($taskReader) { $taskReader.Stop(); $taskReader.Dispose() }
    foreach ($taskFile in @($taskPhasePath, $taskDonePath, $taskReadyPath)) { if ([IO.File]::Exists($taskFile)) { [IO.File]::Delete($taskFile) } }
    # Nonrecursive deletion only; never removes content outside these fixtures.
    [IO.Directory]::Delete($taskDirectory)
}
