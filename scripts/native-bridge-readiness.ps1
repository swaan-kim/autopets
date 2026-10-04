# Read-only readiness check. A connection file is discovery evidence, not an
# HTTP-ready signal: the server publishes it before scheduling its accept loop.
function Wait-NativeBridgeReady {
    param(
        [Parameter(Mandatory=$true)][int]$AppProcessId,
        [Parameter(Mandatory=$true)][datetime]$AppStartedAt,
        [Parameter(Mandatory=$true)][string]$AppPath,
        [Parameter(Mandatory=$true)][string]$ConnectionFile,
        [Parameter(Mandatory=$true)][string]$EvidenceFile,
        [ValidateRange(1,30)][int]$Seconds = 30
    )
    $taskTimer = [Diagnostics.Stopwatch]::StartNew()
    $taskEvidence = [ordered]@{ outcome = 'waiting'; appPid = $AppProcessId; maximumSeconds = $Seconds; requestMaximumSeconds = 2; attempts = @() }
    $taskExpectedPath = [IO.Path]::GetFullPath($AppPath)
    $taskFirstIncompleteFileAt = $null
    $taskAttempt = $null
    function Save-BridgeEvidence {
        $taskEvidence.elapsedSeconds = [Math]::Round($taskTimer.Elapsed.TotalSeconds, 3)
        $taskPending = $EvidenceFile + '.pending'
        $taskEvidence | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $taskPending -Encoding UTF8
        Move-Item -LiteralPath $taskPending -Destination $EvidenceFile -Force
    }
    function Test-ExpectedProcess {
        $taskProcess = Get-Process -Id $AppProcessId -ErrorAction SilentlyContinue
        if (-not $taskProcess) { return $false }
        try {
            return (-not $taskProcess.HasExited -and
                [IO.Path]::GetFullPath($taskProcess.Path) -ieq $taskExpectedPath -and
                $taskProcess.StartTime.ToUniversalTime().Ticks -eq $AppStartedAt.ToUniversalTime().Ticks)
        } catch { return $false }
    }
    try {
        while ($taskTimer.Elapsed.TotalSeconds -lt $Seconds) {
            $taskAttempt = [ordered]@{ at = [DateTime]::UtcNow.ToString('O'); elapsedSeconds = [Math]::Round($taskTimer.Elapsed.TotalSeconds, 3); appIdentityMatched = (Test-ExpectedProcess); connectionFilePresent = (Test-Path -LiteralPath $ConnectionFile); result = 'pending' }
            $taskEvidence.attempts += $taskAttempt
            if (-not $taskAttempt.appIdentityMatched) { $taskAttempt.result = 'app-exited-or-changed'; throw 'Expected app process exited or changed during bridge readiness.' }
            if (-not $taskAttempt.connectionFilePresent) {
                $taskAttempt.result = 'waiting-for-connection-file'
                Save-BridgeEvidence
                Start-Sleep -Milliseconds 100
                continue
            }
            $taskInfo = Get-Item -LiteralPath $ConnectionFile
            $taskAttempt.connectionWrittenAt = $taskInfo.LastWriteTimeUtc.ToString('O')
            $taskAttempt.connectionBytes = $taskInfo.Length
            try {
                $taskConnection = Get-Content -LiteralPath $ConnectionFile -Raw | ConvertFrom-Json -ErrorAction Stop
                if ($null -eq $taskConnection) { throw 'Connection file is still empty.' }
            } catch {
                if ($null -eq $taskFirstIncompleteFileAt) { $taskFirstIncompleteFileAt = $taskTimer.Elapsed.TotalSeconds }
                if ($taskTimer.Elapsed.TotalSeconds - $taskFirstIncompleteFileAt -ge 2) {
                    $taskAttempt.result = 'invalid-connection-json'
                    throw 'Connection file remained incomplete or invalid for two seconds.'
                }
                $taskAttempt.result = 'connection-file-being-written'
                Save-BridgeEvidence
                Start-Sleep -Milliseconds 100
                continue
            }
            if ($taskConnection.version -ne 1 -or $taskConnection.baseUrl -notmatch '^http://127\.0\.0\.1:[0-9]+$' -or $taskConnection.token -isnot [string] -or -not $taskConnection.token) {
                $taskAttempt.result = 'invalid-connection-fields'
                throw 'Connection file fields are invalid.'
            }
            $taskRemaining = [Math]::Floor($Seconds - $taskTimer.Elapsed.TotalSeconds)
            if ($taskRemaining -lt 1) { $taskAttempt.result = 'deadline-before-request'; break }
            $taskRequestSeconds = [int][Math]::Min(2, $taskRemaining)
            $taskAttempt.requestTimeoutSeconds = $taskRequestSeconds
            $taskRequestTimer = [Diagnostics.Stopwatch]::StartNew()
            $taskRetry = $false
            try {
                # GET only. Never replays setup, event, quit, or user requests.
                $taskResponse = Invoke-WebRequest -UseBasicParsing -Method Get -Uri ($taskConnection.baseUrl + '/v1/setup') -Headers @{ Authorization = 'Bearer ' + $taskConnection.token } -TimeoutSec $taskRequestSeconds
                $taskAttempt.httpStatus = [int]$taskResponse.StatusCode
            } catch {
                $taskError = $_.Exception
                $taskAttempt.errorType = $taskError.GetType().Name
                if ($taskError -is [Net.WebException]) {
                    $taskAttempt.transportStatus = $taskError.Status.ToString()
                    if ($taskError.Response) { $taskAttempt.httpStatus = [int]$taskError.Response.StatusCode }
                    $taskRetry = $taskError.Status -in @([Net.WebExceptionStatus]::Timeout, [Net.WebExceptionStatus]::ConnectFailure)
                }
                $taskAttempt.result = if ($taskRetry) { 'transport-not-ready' } else { 'fatal-http-error' }
                if (-not $taskRetry) { throw 'Bridge returned a non-retryable HTTP error.' }
            } finally {
                $taskAttempt.requestSeconds = [Math]::Round($taskRequestTimer.Elapsed.TotalSeconds, 3)
                Save-BridgeEvidence
            }
            if ($taskRetry) { Start-Sleep -Milliseconds 100; continue }
            if ($taskTimer.Elapsed.TotalSeconds -ge $Seconds) { $taskAttempt.result = 'deadline-after-request'; break }
            try { $taskState = $taskResponse.Content | ConvertFrom-Json -ErrorAction Stop }
            catch { $taskAttempt.result = 'invalid-response-json'; throw 'Bridge returned invalid JSON.' }
            if ($taskState.appReady -isnot [bool] -or -not $taskState.appReady -or $taskState.chatConnected -isnot [bool] -or $taskState.chatConnected -or $taskState.guidanceDelivered -isnot [bool] -or $taskState.guidanceDelivered) {
                $taskAttempt.result = 'unexpected-setup-state'
                throw 'Unexpected app or AI connection state.'
            }
            $taskAttempt.appIdentityMatchedAfterResponse = Test-ExpectedProcess
            if (-not $taskAttempt.appIdentityMatchedAfterResponse) { $taskAttempt.result = 'app-exited-or-changed'; throw 'App process changed before readiness was confirmed.' }
            $taskAttempt.result = 'ready'
            $taskEvidence.outcome = 'passed'
            Save-BridgeEvidence
            return $taskConnection
        }
        throw 'Local bridge did not become ready within its bounded startup interval.'
    } catch {
        $taskEvidence.outcome = 'failed'
        $taskEvidence.failure = $_.Exception.Message
        Save-BridgeEvidence
        throw
    }
}
