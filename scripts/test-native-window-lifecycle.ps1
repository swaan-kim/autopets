param(
    [Parameter(Mandatory=$true)][string]$Installer,
    [string]$ExpectedSha256 = 'aedd45bc8cb71e8ffa5b338c6c3fb9ec8b2e811663b79da8710b7a8cab85c5da',
    [string]$SourceCommit = 'db06cb964be9824d8a975710f055fcfc1a1d0ed3',
    [switch]$Roundtrip,
    [switch]$RequireFits,
    [switch]$Worker
)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:RUNNER_OS -ne 'Windows' -or $env:GITHUB_REPOSITORY -ne 'swaan-kim/autopets') {
    throw 'Native UI checks run only on the disposable GitHub-hosted Windows runner.'
}
if ($env:AUTOPETS_HOME -or $env:AUTOPETS_DATA_DIR -or $env:AUTOPETS_CONNECTION_FILE) { throw 'Default product paths are required.' }
$taskOut = Join-Path $env:GITHUB_WORKSPACE 'work/native-window-lifecycle'
New-Item -ItemType Directory -Path $taskOut -Force | Out-Null
if (-not $Worker) {
    . (Join-Path $PSScriptRoot 'native-lifecycle-watchdog.ps1')
    $taskArguments = @('-Installer', ('"' + $Installer + '"'), '-ExpectedSha256', $ExpectedSha256, '-SourceCommit', $SourceCommit, '-Worker')
    if ($Roundtrip) { $taskArguments += '-Roundtrip' }
    if ($RequireFits) { $taskArguments += '-RequireFits' }
    $taskWatchdog = Invoke-LifecycleWorker -ScriptFile $PSCommandPath -ScriptArguments $taskArguments -EvidenceDirectory $taskOut
    $taskWatchdog | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskOut 'watchdog.json') -Encoding UTF8
    Get-Content -LiteralPath (Join-Path $taskOut 'worker-output.txt') -ErrorAction SilentlyContinue | Write-Host
    $taskResultFile = Join-Path $taskOut 'result.json'
    $taskPartial = [pscustomobject]@{ outcome = 'incomplete'; forcedTerminationUsed = $false }
    if (Test-Path -LiteralPath $taskResultFile) {
        try { $taskPartial = Get-Content -LiteralPath $taskResultFile -Raw | ConvertFrom-Json }
        catch { $taskPartial | Add-Member NoteProperty checkpointReadFailed $true }
    }
    if ($taskWatchdog.timedOut) {
        # Independent process/HTTP evidence distinguishes app startup from a
        # stuck UIA readiness probe. Never read AutomationElement here.
        $taskExpectedApp = Join-Path $env:LOCALAPPDATA 'AutoPets/autopets.exe'
        $taskProcesses = @(Get-Process -Name autopets -ErrorAction SilentlyContinue | Where-Object { $_.Path -ieq $taskExpectedApp } | ForEach-Object { [pscustomobject]@{ pid = $_.Id; workingSetBytes = $_.WorkingSet64 } })
        $taskConnectionPath = Join-Path $env:LOCALAPPDATA 'local.autopets.desktop/connection.json'
        $taskBridge = [ordered]@{ connectionFilePresent = (Test-Path -LiteralPath $taskConnectionPath); requestSucceeded = $false; appReady = $null }
        if ($taskBridge.connectionFilePresent) {
            try {
                $taskConnection = Get-Content -LiteralPath $taskConnectionPath -Raw | ConvertFrom-Json
                if ($taskConnection.baseUrl -notmatch '^http://127\.0\.0\.1:[0-9]+$') { throw 'Unexpected bridge address.' }
                $taskSetup = Invoke-RestMethod -Uri ($taskConnection.baseUrl + '/v1/setup') -Headers @{ Authorization = 'Bearer ' + $taskConnection.token } -TimeoutSec 2
                $taskBridge.requestSucceeded = $true
                $taskBridge.appReady = [bool]$taskSetup.appReady
            } catch { $taskBridge.failure = $_.Exception.GetType().Name }
        }
        $taskPartial.outcome = 'failed'
        if ($taskPartial.failure) { $taskPartial | Add-Member NoteProperty precedingFailure $taskPartial.failure }
        $taskPartial | Add-Member -Force NoteProperty failure ("Native test worker exceeded the deadline in phase: " + $taskWatchdog.phase)
        $taskPartial | Add-Member -Force NoteProperty timeoutEvidence ([pscustomobject]@{ phase = $taskWatchdog.phase; appProcesses = $taskProcesses; bridge = $taskBridge; uiAutomationObservationCompleted = $false; appTerminationRequested = $false })
        $taskPartial | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $taskResultFile -Encoding UTF8
    }
    if ($taskWatchdog.timedOut -or $taskWatchdog.workerExitCode -ne 0 -or $taskPartial.outcome -ne 'passed') {
        Get-Content -LiteralPath (Join-Path $taskOut 'worker-error.txt') -ErrorAction SilentlyContinue | Write-Host
        throw "Native lifecycle did not pass. Last observed phase: $($taskWatchdog.phase). See result.json and watchdog.json."
    }
    return
}
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,WindowsBase,System.Windows.Forms,System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class AutoPetsNativeCheck {
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr handle);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr handle);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr handle);
}
'@
$taskAppDirectory = Join-Path $env:LOCALAPPDATA 'AutoPets'
$taskDataDirectory = Join-Path $env:LOCALAPPDATA 'local.autopets.desktop'
$taskApp = Join-Path $taskAppDirectory 'autopets.exe'
$taskNode = Join-Path $taskAppDirectory 'connector/runtime/node.exe'
$taskConnectionFile = Join-Path $taskDataDirectory 'connection.json'
$taskTitle = [regex]::Unescape('AutoPets \u00b7 \uc791\uc740 \uc791\uc5c5 \ub3d9\ub8cc')
$taskQuitName = [regex]::Unescape('AutoPets \uc885\ub8cc')
$taskReadyName = [regex]::Unescape('\uc571 \uc900\ube44')
$taskWindow = $null
$taskResult = [ordered]@{ outcome = 'incomplete'; harnessCommit = $env:GITHUB_SHA; installerSha256 = $ExpectedSha256; sourceCommit = $SourceCommit; environment = 'GitHub-hosted Windows'; automation = 'UI Automation InvokePattern'; forcedTerminationUsed = $false; screenshots = @(); steps = @() }
$taskOriginalPath = $env:PATH
. (Join-Path $PSScriptRoot 'native-install-state.ps1')
. (Join-Path $PSScriptRoot 'measure-native-resources.ps1')
. (Join-Path $PSScriptRoot 'native-bridge-readiness.ps1')

function Save-LifecycleResult {
    $taskPendingResult = Join-Path $taskOut 'result.pending.json'
    $taskResult | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $taskPendingResult -Encoding UTF8
    Move-Item -LiteralPath $taskPendingResult -Destination (Join-Path $taskOut 'result.json') -Force
}
function Set-LifecyclePhase([string]$Name, [int]$Seconds = 30) {
    $taskPhase = [pscustomobject]@{ name = $Name; startedAt = [DateTime]::UtcNow.ToString('O'); timeoutSeconds = $Seconds }
    $taskResult.phase = $taskPhase
    Save-LifecycleResult
    $taskPhase | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskOut 'phase.json') -Encoding UTF8
    Write-Host "Native checkpoint: $Name"
}

function Start-AndObserveApp([string]$Step, [bool]$Fresh) {
    Set-LifecyclePhase ($Step + '-launch')
    $taskProcess = Start-Process -FilePath $taskApp -PassThru -WindowStyle Normal
    $taskResult.steps += [pscustomobject]@{ step = $Step + '-launched'; pid = $taskProcess.Id }
    Set-LifecyclePhase ($Step + '-bridge') 40
    $taskConnection = Assert-ReadyBridge $taskProcess
    $taskResult.steps += [pscustomobject]@{ step = $Step + '-bridge-ready'; pid = $taskProcess.Id; appReady = $true }
    # The parent can time out this whole phase even if an individual UIA
    # FindFirst/Current/Invoke call never returns to the polling loop.
    Set-LifecyclePhase ($Step + '-uia-ready') 140
    $taskFound = Wait-ReadyWindow $taskProcess $Fresh
    Set-LifecyclePhase ($Step + '-rendered')
    return [pscustomobject]@{ process = $taskProcess; window = $taskFound; connection = $taskConnection }
}

function Wait-Until([scriptblock]$Probe, [string]$Failure, [int]$Seconds = 30) {
    $taskDeadline = [DateTime]::UtcNow.AddSeconds($Seconds)
    while ([DateTime]::UtcNow -lt $taskDeadline) {
        $taskValue = & $Probe
        if ($taskValue) { return $taskValue }
        Start-Sleep -Milliseconds 100
    }
    throw $Failure
}
function Get-AppProcesses {
    Get-Process -Name autopets -ErrorAction SilentlyContinue | Where-Object { $_.Path -ieq $taskApp }
}
function Get-MainWindow([int]$ProcessId) {
    $taskCondition = [System.Windows.Automation.AndCondition]::new([System.Windows.Automation.Condition[]]@(
        [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $ProcessId),
        [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, $taskTitle)
    ))
    [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $taskCondition)
}
function Find-Name($Window, [string]$Name) {
    $taskCondition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, $Name)
    $Window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $taskCondition)
}
function Find-Button($Window, [string]$Name) {
    $taskCondition = [System.Windows.Automation.AndCondition]::new([System.Windows.Automation.Condition[]]@(
        [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button),
        [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, $Name)
    ))
    $Window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $taskCondition)
}
function Wait-ReadyWindow($Process, [bool]$Fresh) {
    $taskFound = Wait-Until { Get-MainWindow $Process.Id } 'Main window was not exposed by UI Automation.' 60
    [void](Wait-Until {
        $taskHandle = [IntPtr]$taskFound.Current.NativeWindowHandle
        $taskQuit = Find-Button $taskFound $taskQuitName
        if ([AutoPetsNativeCheck]::IsWindowVisible($taskHandle) -and -not [AutoPetsNativeCheck]::IsIconic($taskHandle) -and $taskQuit -and $taskQuit.Current.IsEnabled) {
            if (-not $Fresh -or (Find-Name $taskFound $taskReadyName)) { return $true }
        }
        return $false
    } 'Window appeared, but the rendered app controls were not ready.' 60)
    if ($RequireFits) {
        [void](Wait-Until {
            $taskBounds = $taskFound.Current.BoundingRectangle
            $taskRectangle = [Drawing.Rectangle]::new([int]$taskBounds.X, [int]$taskBounds.Y, [int]$taskBounds.Width, [int]$taskBounds.Height)
            $taskWorkArea = [Windows.Forms.Screen]::FromHandle([IntPtr]$taskFound.Current.NativeWindowHandle).WorkingArea
            return $taskWorkArea.Contains($taskRectangle)
        } 'Main window extends outside the monitor work area.' 10)
        Assert-QuitVisible $taskFound
    }
    return $taskFound
}
function Assert-QuitVisible($Window) {
    $taskQuit = Find-Button $Window $taskQuitName
    $taskBounds = $taskQuit.Current.BoundingRectangle
    $taskRectangle = [Drawing.Rectangle]::new([int]$taskBounds.X, [int]$taskBounds.Y, [int]$taskBounds.Width, [int]$taskBounds.Height)
    $taskWorkArea = [Windows.Forms.Screen]::FromHandle([IntPtr]$Window.Current.NativeWindowHandle).WorkingArea
    if ($taskQuit.Current.IsOffscreen -or -not $taskWorkArea.Contains($taskRectangle)) { throw 'Quit button requires scrolling or extends outside the work area.' }
}
function Invoke-Button($Button) {
    if (-not $Button -or -not $Button.Current.IsEnabled) { throw 'Required button is unavailable.' }
    $taskPattern = $null
    if (-not $Button.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$taskPattern)) { throw 'Button has no accessible InvokePattern.' }
    ([System.Windows.Automation.InvokePattern]$taskPattern).Invoke()
}
function Save-WindowImage($Window, [string]$Name) {
    [void][AutoPetsNativeCheck]::SetForegroundWindow([IntPtr]$Window.Current.NativeWindowHandle)
    Start-Sleep -Milliseconds 300
    $taskBounds = $Window.Current.BoundingRectangle
    $taskRectangle = [Drawing.Rectangle]::new([int]$taskBounds.X, [int]$taskBounds.Y, [int]$taskBounds.Width, [int]$taskBounds.Height)
    $taskScreen = [Windows.Forms.SystemInformation]::VirtualScreen
    $taskVisible = [Drawing.Rectangle]::Intersect($taskRectangle, $taskScreen)
    if ($taskVisible.Width -le 0 -or $taskVisible.Height -le 0) { throw 'Window has no visible screen area.' }
    $taskBitmap = [Drawing.Bitmap]::new($taskVisible.Width, $taskVisible.Height)
    $taskGraphics = [Drawing.Graphics]::FromImage($taskBitmap)
    try {
        $taskGraphics.CopyFromScreen($taskVisible.Location, [Drawing.Point]::Empty, $taskVisible.Size)
        $taskBitmap.Save((Join-Path $taskOut ($Name + '.png')), [Drawing.Imaging.ImageFormat]::Png)
    } finally { $taskGraphics.Dispose(); $taskBitmap.Dispose() }
    $taskResult.screenshots += [pscustomobject]@{ file = $Name + '.png'; windowWidth = $taskRectangle.Width; windowHeight = $taskRectangle.Height; capturedWidth = $taskVisible.Width; capturedHeight = $taskVisible.Height; clipped = ($taskVisible -ne $taskRectangle) }
}
function Request-Bridge($Connection, [string]$Path, $Body = $null) {
    $taskArguments = @{ Uri = $Connection.baseUrl + $Path; Headers = @{ Authorization = 'Bearer ' + $Connection.token }; TimeoutSec = 5 }
    if ($null -eq $Body) { Invoke-RestMethod @taskArguments -Method Get }
    else { Invoke-RestMethod @taskArguments -Method Post -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 8 -Compress))) }
}
function Assert-ReadyBridge($Process) {
    $taskEvidenceFile = Join-Path $taskOut ($taskResult.phase.name + '-readiness.json')
    $taskConnection = Wait-NativeBridgeReady -AppProcessId $Process.Id -AppStartedAt $Process.StartTime -AppPath $taskApp -ConnectionFile $taskConnectionFile -EvidenceFile $taskEvidenceFile
    $taskReadiness = Get-Content -LiteralPath $taskEvidenceFile -Raw | ConvertFrom-Json
    $taskResult.steps += [pscustomobject]@{ step = $taskResult.phase.name + '-http-ready'; appPid = $Process.Id; seconds = $taskReadiness.elapsedSeconds; attempts = @($taskReadiness.attempts).Count }
    return $taskConnection
}
function Invoke-Recall($Original, [long]$Handle, [string]$Step) {
    Set-LifecyclePhase $Step 30
    $taskDuplicate = Start-Process -FilePath $taskApp -PassThru -WindowStyle Hidden
    if (-not $taskDuplicate.WaitForExit(10000) -or $taskDuplicate.ExitCode -ne 0) { throw 'Repeated launch did not exit normally.' }
    $Original.Refresh()
    if ($Original.HasExited -or @(Get-AppProcesses).Count -ne 1) { throw 'Repeated launch replaced or duplicated the original process.' }
    Set-LifecyclePhase ($Step + '-bridge') 40
    [void](Assert-ReadyBridge $Original)
    Set-LifecyclePhase ($Step + '-uia-ready') 140
    $taskRecalled = Wait-ReadyWindow $Original $false
    if ($taskRecalled.Current.NativeWindowHandle -ne $Handle) { throw 'Repeated launch did not reuse the original window.' }
    $taskResult.steps += [pscustomobject]@{ step = $Step; originalPidPreserved = $true; originalWindowPreserved = $true; appProcessCount = 1; duplicateExitCode = $taskDuplicate.ExitCode }
    return $taskRecalled
}
function Test-PortRefused([int]$Port) {
    $taskClient = [Net.Sockets.TcpClient]::new()
    try { $taskClient.Connect('127.0.0.1', $Port); return $false }
    catch [Net.Sockets.SocketException] { if ($_.Exception.SocketErrorCode -eq [Net.Sockets.SocketError]::ConnectionRefused) { return $true }; throw }
    finally { $taskClient.Dispose() }
}
function Quit-ThroughButton($Window, $Process, $Connection, [string]$Step) {
    Set-LifecyclePhase $Step 45
    $taskQuit = Find-Button $Window $taskQuitName
    if (-not $taskQuit) { throw 'Quit button is missing.' }
    $taskScroll = $null
    if ($RequireFits) { Assert-QuitVisible $Window }
    elseif ($taskQuit.TryGetCurrentPattern([System.Windows.Automation.ScrollItemPattern]::Pattern, [ref]$taskScroll)) {
        ([System.Windows.Automation.ScrollItemPattern]$taskScroll).ScrollIntoView()
    }
    [void](Wait-Until {
        $taskBounds = $taskQuit.Current.BoundingRectangle
        $taskCenter = [Drawing.Point]::new([int]($taskBounds.X + $taskBounds.Width / 2), [int]($taskBounds.Y + $taskBounds.Height / 2))
        $taskWorkArea = [Windows.Forms.Screen]::FromHandle([IntPtr]$Window.Current.NativeWindowHandle).WorkingArea
        return (-not $taskQuit.Current.IsOffscreen -and $taskWorkArea.Contains($taskCenter))
    } 'Quit button could not be scrolled into the visible work area.' 10)
    Save-WindowImage $Window ($Step + '-button')
    Write-Host "Native quit requested: $Step"
    $taskMarker = Join-Path $taskOut ($Step + '-invoked.txt')
    $taskWorkerScript = Join-Path $PSScriptRoot 'invoke-native-quit.ps1'
    $taskWorker = Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList @('-NoProfile','-NonInteractive','-File', "`"$taskWorkerScript`"", '-AppProcessId', $Process.Id, '-MarkerFile', "`"$taskMarker`"") -WindowStyle Hidden -PassThru -RedirectStandardError (Join-Path $taskOut ($Step + '-worker-error.txt'))
    $taskWorkerStopped = $false
    try {
        if (-not $Process.WaitForExit(15000)) { throw 'Exit button did not stop the app. Forced app termination is not accepted.' }
        if (-not (Test-Path -LiteralPath $taskMarker)) { throw 'App exited without an observed quit-button invocation.' }
        if ($Process.ExitCode -ne 0 -or @(Get-AppProcesses).Count -ne 0) { throw 'App failed to exit normally.' }
        $taskInvokedAt = [DateTime]::Parse((Get-Content -LiteralPath $taskMarker -Raw)).ToUniversalTime()
        $taskSeconds = ($Process.ExitTime.ToUniversalTime() - $taskInvokedAt).TotalSeconds
        if ($taskSeconds -lt 0) { throw 'App exited before the quit-button request.' }
        $taskPort = ([Uri]$Connection.baseUrl).Port
        [void](Wait-Until { Test-PortRefused $taskPort } 'Local bridge still accepts connections after app exit.' 10)
        if (Test-Path -LiteralPath $taskConnectionFile) { throw 'Normal exit left its connection file behind.' }
        if (-not $taskWorker.WaitForExit(2000)) { $taskWorkerStopped = $true }
        $taskResult.steps += [pscustomobject]@{ step = $Step; invokedButton = 'AutoPets quit'; exitCode = $Process.ExitCode; seconds = [Math]::Round($taskSeconds, 3); appProcessCount = 0; portClosed = $true; connectionFileRemoved = $true; uiAutomationWorkerCleanup = $taskWorkerStopped }
        Write-Host "Native app exited normally: $Step"
    } finally {
        # Only the known UIA helper started above is reclaimed. Never kill the
        # app or count a killed app as a normal exit, even on a failed check.
        $taskWorker.Refresh()
        if (-not $taskWorker.HasExited) { $taskWorker.Kill(); [void]$taskWorker.WaitForExit(5000) }
    }
}
function Read-Fixture {
    $taskOutput = & $taskNode --no-warnings (Join-Path $env:GITHUB_WORKSPACE 'scripts/inspect-native-lifecycle-data.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Synthetic data verification failed.' }
    return $taskOutput
}

function Save-RoleFixture($Window) {
    Set-LifecyclePhase 'save-role' 60
    $taskRoleNav = [regex]::Unescape('\uc5ed\ud560\uacfc \ub0b4 \ud3ab')
    $taskRoleSave = [regex]::Unescape('\ub0b4 \ud3ab \uc800\uc7a5')
    $taskRoleSaved = [regex]::Unescape('\ub0b4 \ud3ab \ubcc0\uacbd \uc800\uc7a5')
    Invoke-Button (Find-Button $Window $taskRoleNav)
    $taskSave = Wait-Until {
        $taskButton = Find-Button $Window $taskRoleSave
        if ($taskButton -and $taskButton.Current.IsEnabled) { return $taskButton }
        return $null
    } 'Role editor did not become ready.' 20
    $taskScroll = $null
    if ($taskSave.TryGetCurrentPattern([System.Windows.Automation.ScrollItemPattern]::Pattern, [ref]$taskScroll)) {
        ([System.Windows.Automation.ScrollItemPattern]$taskScroll).ScrollIntoView()
    }
    Invoke-Button $taskSave
    [void](Wait-Until { Find-Button $Window $taskRoleSaved } 'Role save did not complete.' 20)
    Save-WindowImage $Window 'saved-role'
    $taskResult.steps += [pscustomobject]@{ step = 'save-role'; actualUi = $true; template = 'research-document' }
}

try {
    Set-LifecyclePhase 'preflight' 120
    if (-not [Environment]::UserInteractive) { throw 'Runner has no interactive desktop; no GUI pass can be claimed.' }
    if ((Test-Path -LiteralPath $taskAppDirectory) -or (Test-Path -LiteralPath $taskDataDirectory) -or @(Get-AppProcesses).Count) { throw 'Runner is not fresh.' }
    if (@(Get-InstallRegistration).Count -or @(Get-InstallShortcuts).Count) { throw 'Runner already has installation metadata.' }
    if ((Get-FileHash -LiteralPath $Installer -Algorithm SHA256).Hash.ToLowerInvariant() -ne $taskResult.installerSha256) { throw 'Pinned installer hash mismatch.' }
    $taskResult.installerBytes = (Get-Item -LiteralPath $Installer).Length
    $taskResult.signature = (Get-AuthenticodeSignature -LiteralPath $Installer).Status.ToString()
    $taskResult.elevatedRunner = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    $taskAiDirectory = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.codex'
    $taskAiBaseline = @(Get-StateFiles $taskAiDirectory)
    if ($Roundtrip) {
        $env:PATH = "$env:SystemRoot\System32;$env:SystemRoot;$env:SystemRoot\System32\WindowsPowerShell\v1.0"
        foreach ($taskTool in @('node','npm','pnpm','cargo','rustc','git','python')) {
            if (Get-Command $taskTool -CommandType Application -ErrorAction SilentlyContinue) { throw "Developer tool remains on PATH: $taskTool" }
        }
        $taskResult.developerToolsAbsentFromPath = $true
    }
    Set-LifecyclePhase 'install' 150
    Invoke-InstallerStep $Installer 'install'
    Set-LifecyclePhase 'install-footprint' 45
    $taskResult.firstInstall = Read-InstallFootprint
    # Fresh installs need not have a positions file until a pet is moved.
    # Seed deliberate, valid custom positions to test actual native restoration.
    $taskWorkArea = [Windows.Forms.Screen]::PrimaryScreen.WorkingArea
    $taskPositions = [ordered]@{}
    for ($taskIndex = 0; $taskIndex -lt 3; $taskIndex++) {
        $taskPositions[('pet-' + $taskIndex)] = @{ x = $taskWorkArea.Right - 200 - $taskIndex * 190; y = $taskWorkArea.Bottom - 250 }
    }
    New-Item -ItemType Directory -Path $taskDataDirectory -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $taskDataDirectory 'positions.json'), ($taskPositions | ConvertTo-Json -Depth 3), [Text.UTF8Encoding]::new($false))
    $taskStartTimer = [Diagnostics.Stopwatch]::StartNew()
    # Visible native window on the isolated runner is the subject of this test.
    $taskLaunch = Start-AndObserveApp 'first' $true
    $taskOriginal = $taskLaunch.process
    $taskWindow = $taskLaunch.window
    $taskConnection = $taskLaunch.connection
    $taskStartTimer.Stop()
    $taskHandle = [long]$taskWindow.Current.NativeWindowHandle
    $taskResult.steps += [pscustomobject]@{ step = 'first-render'; seconds = [Math]::Round($taskStartTimer.Elapsed.TotalSeconds, 3); nativeWindowVisible = $true; renderedSetupHeadingFound = $true; quitButtonFound = $true }
    Save-WindowImage $taskWindow 'first-window'
    Set-LifecyclePhase 'measure-idle-resources' 30
    $taskResult.resources = @((Measure-NativeResources $taskOriginal.Id 'manager-no-task'))
    $taskWindow = Invoke-Recall $taskOriginal $taskHandle 'recall-while-visible'
    Set-LifecyclePhase 'caption-close' 30
    $taskCaptionClose = $taskWindow.FindFirst([System.Windows.Automation.TreeScope]::Descendants,
        [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty, 'Close'))
    Invoke-Button $taskCaptionClose
    [void](Wait-Until { -not [AutoPetsNativeCheck]::IsWindowVisible([IntPtr]$taskHandle) } 'Caption X did not hide the window.' 10)
    $taskOriginal.Refresh()
    if ($taskOriginal.HasExited) { throw 'Caption X unexpectedly exited the app.' }
    Set-LifecyclePhase 'caption-close-bridge' 40
    [void](Assert-ReadyBridge $taskOriginal)
    $taskResult.steps += [pscustomobject]@{ step = 'caption-close'; hidden = $true; processAlive = $true; bridgeAlive = $true }
    $taskWindow = Invoke-Recall $taskOriginal $taskHandle 'recall-after-hide'
    Save-WindowImage $taskWindow 'reopened-window'
    # Synthetic protocol input, not a real AI connection or enabled hook.
    $taskFixtureDirectory = Join-Path $env:RUNNER_TEMP 'native-window-fixture'
    New-Item -ItemType Directory -Path $taskFixtureDirectory -Force | Out-Null
    [void](Request-Bridge $taskConnection '/v1/events' @{ eventId = 'gui-start'; sessionId = 'gui-fixture'; turnId = 'fixture-turn'; kind = 'turn_started'; cwd = $taskFixtureDirectory; timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() })
    [void](Request-Bridge $taskConnection '/v1/task-config' @{ requestId = 'gui-config'; sessionId = 'gui-fixture'; turnId = 'fixture-turn'; cwd = $taskFixtureDirectory; completionCriterion = 'GUI restart must preserve this test record'; interventionMode = 'milestones'; elapsedAlertMinutes = 7 })
    Save-RoleFixture $taskWindow
    Set-LifecyclePhase 'measure-working-resources' 30
    $taskResult.resources += Measure-NativeResources $taskOriginal.Id 'manager-with-synthetic-working-pet'
    Quit-ThroughButton $taskWindow $taskOriginal $taskConnection 'normal-exit'
    Set-LifecyclePhase 'before-restart-data' 30
    $taskBeforeRestart = Read-Fixture
    $taskBeforeRestart | Set-Content -LiteralPath (Join-Path $taskOut 'before-restart.json') -Encoding UTF8
    $taskLaunch = Start-AndObserveApp 'restart' $false
    $taskRestart = $taskLaunch.process
    $taskWindow = $taskLaunch.window
    $taskConnection = $taskLaunch.connection
    Save-WindowImage $taskWindow 'after-restart'
    Set-LifecyclePhase 'after-restart-data' 30
    $taskAfterRestart = Read-Fixture
    if ($taskBeforeRestart -cne $taskAfterRestart) { throw 'Logical records, settings or pet positions changed after restart.' }
    $taskAfterRestart | Set-Content -LiteralPath (Join-Path $taskOut 'after-restart.json') -Encoding UTF8
    $taskResult.steps += [pscustomobject]@{ step = 'restart'; dataPreserved = $true; settingsPreserved = $true; positionsPreserved = $true; integrity = 'ok' }
    Quit-ThroughButton $taskWindow $taskRestart $taskConnection 'normal-exit-after-restart'
    if ($Roundtrip) {
        Set-LifecyclePhase 'before-overwrite-data' 30
        $taskDurable = @(Get-StateFiles $taskDataDirectory -DurableOnly)
        Set-LifecyclePhase 'overwrite-install' 150
        Invoke-InstallerStep $Installer 'overwrite-install'
        Set-LifecyclePhase 'after-overwrite-data' 45
        $taskResult.overwrite = Read-InstallFootprint
        Assert-StateFiles $taskDurable @(Get-StateFiles $taskDataDirectory -DurableOnly) 'Data after overwrite install'
        if ((Read-Fixture) -cne $taskBeforeRestart) { throw 'Overwrite install changed synthetic records or settings.' }
        $taskUninstaller = Join-Path $taskAppDirectory 'uninstall.exe'
        Set-LifecyclePhase 'uninstall' 150
        Invoke-InstallerStep $taskUninstaller 'uninstall'
        Set-LifecyclePhase 'after-uninstall-data' 45
        Assert-Uninstalled
        Assert-StateFiles $taskDurable @(Get-StateFiles $taskDataDirectory -DurableOnly) 'Data after uninstall'
        $taskResult.uninstallDataByteIdentical = $true
        Set-LifecyclePhase 'reinstall' 150
        Invoke-InstallerStep $Installer 'reinstall'
        Set-LifecyclePhase 'after-reinstall-data' 45
        $taskResult.reinstall = Read-InstallFootprint
        Assert-StateFiles $taskDurable @(Get-StateFiles $taskDataDirectory -DurableOnly) 'Data after reinstall'
        $taskResult.reinstallDataByteIdentical = $true
        if ($taskResult.firstInstall.executableHash -ne $taskResult.reinstall.executableHash) { throw 'Reinstall changed app binary.' }
        $taskLaunch = Start-AndObserveApp 'reinstall' $false
        $taskReinstalled = $taskLaunch.process
        $taskWindow = $taskLaunch.window
        $taskConnection = $taskLaunch.connection
        if ((Read-Fixture) -cne $taskBeforeRestart) { throw 'Reinstalled app changed records, settings or positions.' }
        Save-WindowImage $taskWindow 'after-reinstall'
        Quit-ThroughButton $taskWindow $taskReinstalled $taskConnection 'normal-exit-after-reinstall'
        $taskResult.steps += [pscustomobject]@{ step = 'reinstalled-app'; usable = $true; dataPreserved = $true; settingsPreserved = $true; positionsPreserved = $true }
    }
    Set-LifecyclePhase 'final-data-check' 45
    Assert-StateFiles $taskAiBaseline @(Get-StateFiles $taskAiDirectory) 'AI settings'
    $taskResult.aiConfigurationUnchanged = $true
    $taskResult.windowFitRequired = [bool]$RequireFits
    $taskResult.outcome = 'passed'
} catch {
    $taskResult.outcome = 'failed'
    $taskResult.failure = $_.Exception.Message
    $taskResult.failurePhase = $taskResult.phase.name
    # Persist the failure before optional UI diagnostics, which can themselves
    # hit an unresponsive provider. The process-only parent bounds this phase.
    Set-LifecyclePhase 'failure-diagnostics' 15
    if ($taskWindow) {
        try {
            $taskItems = $taskWindow.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
            $taskTree = for ($taskIndex = 0; $taskIndex -lt [Math]::Min($taskItems.Count, 350); $taskIndex++) {
                $taskCurrent = $taskItems[$taskIndex].Current
                [pscustomobject]@{ name = $taskCurrent.Name; type = $taskCurrent.ControlType.ProgrammaticName; id = $taskCurrent.AutomationId; enabled = $taskCurrent.IsEnabled; offscreen = $taskCurrent.IsOffscreen }
            }
            $taskTree | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $taskOut 'failure-ui-tree.json') -Encoding UTF8
            Save-WindowImage $taskWindow 'failure-window'
        } catch { $taskResult.diagnosticFailure = $_.Exception.Message }
    }
    throw
} finally {
    $env:PATH = $taskOriginalPath
    Save-LifecycleResult
}
