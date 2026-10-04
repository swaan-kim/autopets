# Process-only supervisor. It never loads UI Automation or terminates app
# descendants, so a blocked provider cannot block its own timeout/diagnostics.
function Invoke-LifecycleWorker {
    param(
        [Parameter(Mandatory=$true)][string]$ScriptFile,
        [string[]]$ScriptArguments = @(),
        [Parameter(Mandatory=$true)][string]$EvidenceDirectory,
        [int]$StartupSeconds = 30,
        [int]$MaximumSeconds = 600
    )
    $taskPhasePath = Join-Path $EvidenceDirectory 'phase.json'
    $taskArguments = @('-NoProfile', '-NonInteractive', '-File', ('"' + $ScriptFile + '"')) + $ScriptArguments
    $taskWorker = Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList $taskArguments -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $EvidenceDirectory 'worker-output.txt') -RedirectStandardError (Join-Path $EvidenceDirectory 'worker-error.txt')
    # Keep the process handle before it exits. Windows PowerShell's
    # Start-Process object can otherwise lose the exit code of a short worker.
    [void]$taskWorker.Handle
    $taskStarted = [DateTime]::UtcNow
    $taskDeadline = $taskStarted.AddSeconds($StartupSeconds)
    $taskMaximumDeadline = $taskStarted.AddSeconds($MaximumSeconds)
    $taskPhase = 'worker-start'
    $taskLastPhaseAt = $taskStarted
    $taskTimedOut = $false
    try {
        while (-not $taskWorker.WaitForExit(100)) {
            if (Test-Path -LiteralPath $taskPhasePath) {
                try {
                    $taskObserved = Get-Content -LiteralPath $taskPhasePath -Raw | ConvertFrom-Json
                    $taskObservedAt = [DateTime]::Parse($taskObserved.startedAt).ToUniversalTime()
                    if ($taskObservedAt -gt $taskLastPhaseAt -and $taskObserved.name -match '^[a-z0-9-]+$' -and $taskObserved.timeoutSeconds -gt 0 -and $taskObserved.timeoutSeconds -le 180) {
                        $taskPhase = [string]$taskObserved.name
                        $taskLastPhaseAt = $taskObservedAt
                        $taskDeadline = $taskObservedAt.AddSeconds([int]$taskObserved.timeoutSeconds)
                        Write-Host "Native lifecycle phase: $taskPhase"
                    }
                } catch { } # A concurrent checkpoint replacement is retried.
            }
            if ([DateTime]::UtcNow -ge $taskDeadline -or [DateTime]::UtcNow -ge $taskMaximumDeadline) {
                $taskTimedOut = $true
                break
            }
        }
    } finally {
        if (-not $taskWorker.HasExited) {
            # Kill only the exact supervisor-owned worker, never a process
            # tree or app PID. A timeout is always a failed lifecycle test.
            $taskWorker.Kill()
            [void]$taskWorker.WaitForExit(5000)
        }
    }
    return [pscustomobject]@{
        timedOut = $taskTimedOut
        phase = $taskPhase
        workerPid = $taskWorker.Id
        workerExitCode = $taskWorker.ExitCode
        elapsedSeconds = [Math]::Round(([DateTime]::UtcNow - $taskStarted).TotalSeconds, 3)
        workerTerminated = $taskTimedOut
        appTerminationRequested = $false
    }
}
