# Measurements are limited to the disposable CI installation and its WebView descendants.
function Measure-NativeResources([int]$AppProcessId, [string]$Phase) {
    if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:GITHUB_REPOSITORY -ne 'swaan-kim/autopets') {
        throw 'Resource sampling is restricted to the disposable CI fixture.'
    }
    $taskRootProcess = Get-Process -Id $AppProcessId -ErrorAction Stop
    $taskExpectedApp = Join-Path $env:LOCALAPPDATA 'AutoPets\autopets.exe'
    if ($taskRootProcess.Path -ine $taskExpectedApp) { throw 'Resource root is not the fixture installation.' }
    $taskRootStarted = $taskRootProcess.StartTime.ToUniversalTime().Ticks
    $taskLogicalProcessors = [Environment]::ProcessorCount
    $taskTimer = [Diagnostics.Stopwatch]::StartNew()
    $taskSamples = @()
    for ($taskSampleIndex = 0; $taskSampleIndex -lt 9; $taskSampleIndex++) {
        if ($taskSampleIndex -gt 0) { Start-Sleep -Seconds 1 }
        $taskProcessTree = @(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId)
        $taskIds = [Collections.Generic.HashSet[int]]::new()
        [void]$taskIds.Add($AppProcessId)
        do {
            $taskAdded = $false
            foreach ($taskNode in $taskProcessTree) {
                if ($taskIds.Contains([int]$taskNode.ParentProcessId) -and $taskIds.Add([int]$taskNode.ProcessId)) { $taskAdded = $true }
            }
        } while ($taskAdded)
        $taskProcesses = @(foreach ($taskProcessId in $taskIds) {
            $taskProcess = Get-Process -Id $taskProcessId -ErrorAction SilentlyContinue
            if ($null -eq $taskProcess) { continue }
            try {
                [pscustomobject]@{ key = "$($taskProcess.Id):$($taskProcess.StartTime.ToUniversalTime().Ticks)";
                    name = $taskProcess.ProcessName; cpuSeconds = $taskProcess.TotalProcessorTime.TotalSeconds;
                    privateBytes = $taskProcess.PrivateMemorySize64; workingSetBytes = $taskProcess.WorkingSet64 }
            } catch { continue } # A child may exit during observation; the set change invalidates CPU below.
        })
        if (-not ($taskProcesses | Where-Object key -eq "${AppProcessId}:$taskRootStarted")) { throw 'Fixture process exited or changed during sampling.' }
        $taskSamples += [pscustomobject]@{ elapsedSeconds = $taskTimer.Elapsed.TotalSeconds;
            processKeys = @($taskProcesses.key | Sort-Object); processNames = @($taskProcesses.name | Sort-Object -Unique);
            cpuSeconds = ($taskProcesses | Measure-Object cpuSeconds -Sum).Sum;
            privateBytes = ($taskProcesses | Measure-Object privateBytes -Sum).Sum;
            workingSetBytes = ($taskProcesses | Measure-Object workingSetBytes -Sum).Sum }
    }
    $taskFirst = $taskSamples[0]; $taskLast = $taskSamples[-1]
    $taskKeySet = $taskFirst.processKeys -join '|'
    $taskStable = @($taskSamples | Where-Object { ($_.processKeys -join '|') -cne $taskKeySet }).Count -eq 0
    $taskDuration = $taskLast.elapsedSeconds - $taskFirst.elapsedSeconds
    $taskCpuDelta = $taskLast.cpuSeconds - $taskFirst.cpuSeconds
    $taskCpuPercent = $null
    if ($taskStable -and $taskDuration -gt 0 -and $taskCpuDelta -ge 0) {
        $taskCpuPercent = [Math]::Round(100 * $taskCpuDelta / $taskDuration / $taskLogicalProcessors, 3)
    }
    return [pscustomobject]@{ phase = $Phase; seconds = [Math]::Round($taskDuration, 3); sampleCount = $taskSamples.Count;
        logicalProcessors = $taskLogicalProcessors; stableProcessSet = $taskStable; cpuPercentOfMachine = $taskCpuPercent;
        cpuScope = 'AutoPets plus observed descendants; null when sampled process identities change';
        peakPrivateBytes = ($taskSamples | Measure-Object privateBytes -Maximum).Maximum;
        peakWorkingSetSumBytes = ($taskSamples | Measure-Object workingSetBytes -Maximum).Maximum;
        memoryScope = 'process sums; working set can double-count shared pages';
        processNames = @($taskSamples.processNames | Sort-Object -Unique); samples = $taskSamples;
        evidence = 'single disposable Windows runner, synthetic task, no AI workload or performance threshold' }
}
