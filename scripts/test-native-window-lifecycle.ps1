param([Parameter(Mandatory=$true)][string]$Installer)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:RUNNER_OS -ne 'Windows' -or $env:GITHUB_REPOSITORY -ne 'swaan-kim/autopets') {
    throw 'Native UI checks run only on the disposable GitHub-hosted Windows runner.'
}
if ($env:AUTOPETS_HOME -or $env:AUTOPETS_DATA_DIR -or $env:AUTOPETS_CONNECTION_FILE) { throw 'Default product paths are required.' }
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
$taskOut = Join-Path $env:GITHUB_WORKSPACE 'work/native-window-lifecycle'
New-Item -ItemType Directory -Path $taskOut -Force | Out-Null
$taskTitle = [regex]::Unescape('AutoPets \u00b7 \uc791\uc740 \uc791\uc5c5 \ub3d9\ub8cc')
$taskQuitName = [regex]::Unescape('AutoPets \uc885\ub8cc')
$taskReadyName = [regex]::Unescape('\uc571 \uc900\ube44')
$taskWindow = $null
$taskResult = [ordered]@{ outcome = 'incomplete'; harnessCommit = $env:GITHUB_SHA; installerSha256 = 'aedd45bc8cb71e8ffa5b338c6c3fb9ec8b2e811663b79da8710b7a8cab85c5da'; sourceCommit = 'db06cb964be9824d8a975710f055fcfc1a1d0ed3'; environment = 'GitHub-hosted Windows'; automation = 'UI Automation InvokePattern'; forcedTerminationUsed = $false; screenshots = @(); steps = @() }

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
    return $taskFound
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
function Get-Connection {
    if (-not (Test-Path -LiteralPath $taskConnectionFile)) { return $null }
    $taskConnection = Get-Content -LiteralPath $taskConnectionFile -Raw | ConvertFrom-Json
    if ($taskConnection.baseUrl -notmatch '^http://127\.0\.0\.1:[0-9]+$') { throw 'Expected exact loopback bridge address.' }
    return $taskConnection
}
function Request-Bridge($Connection, [string]$Path, $Body = $null) {
    $taskArguments = @{ Uri = $Connection.baseUrl + $Path; Headers = @{ Authorization = 'Bearer ' + $Connection.token }; TimeoutSec = 5 }
    if ($null -eq $Body) { Invoke-RestMethod @taskArguments -Method Get }
    else { Invoke-RestMethod @taskArguments -Method Post -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 8 -Compress))) }
}
function Assert-ReadyBridge {
    $taskConnection = Wait-Until { Get-Connection } 'Local connection file was not created.'
    $taskState = Request-Bridge $taskConnection '/v1/setup'
    if (-not $taskState.appReady -or $taskState.chatConnected -or $taskState.guidanceDelivered) { throw 'Unexpected app or AI connection state.' }
    return $taskConnection
}
function Invoke-Recall($Original, [long]$Handle, [string]$Step) {
    $taskDuplicate = Start-Process -FilePath $taskApp -PassThru -WindowStyle Hidden
    if (-not $taskDuplicate.WaitForExit(10000) -or $taskDuplicate.ExitCode -ne 0) { throw 'Repeated launch did not exit normally.' }
    $Original.Refresh()
    if ($Original.HasExited -or @(Get-AppProcesses).Count -ne 1) { throw 'Repeated launch replaced or duplicated the original process.' }
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
    $taskQuit = Find-Button $Window $taskQuitName
    if (-not $taskQuit) { throw 'Quit button is missing.' }
    $taskScroll = $null
    if ($taskQuit.TryGetCurrentPattern([System.Windows.Automation.ScrollItemPattern]::Pattern, [ref]$taskScroll)) {
        ([System.Windows.Automation.ScrollItemPattern]$taskScroll).ScrollIntoView()
    }
    [void](Wait-Until {
        $taskBounds = $taskQuit.Current.BoundingRectangle
        $taskCenter = [Drawing.Point]::new([int]($taskBounds.X + $taskBounds.Width / 2), [int]($taskBounds.Y + $taskBounds.Height / 2))
        $taskWorkArea = [Windows.Forms.Screen]::FromHandle([IntPtr]$Window.Current.NativeWindowHandle).WorkingArea
        return (-not $taskQuit.Current.IsOffscreen -and $taskWorkArea.Contains($taskCenter))
    } 'Quit button could not be scrolled into the visible work area.' 10)
    Save-WindowImage $Window ($Step + '-button')
    $taskTimer = [Diagnostics.Stopwatch]::StartNew()
    Invoke-Button $taskQuit
    if (-not $Process.WaitForExit(10000)) { throw 'Exit button did not stop the app. Forced termination is not accepted.' }
    $taskTimer.Stop()
    if ($Process.ExitCode -ne 0 -or @(Get-AppProcesses).Count -ne 0) { throw 'App failed to exit normally.' }
    $taskPort = ([Uri]$Connection.baseUrl).Port
    [void](Wait-Until { Test-PortRefused $taskPort } 'Local bridge still accepts connections after app exit.' 10)
    if (Test-Path -LiteralPath $taskConnectionFile) { throw 'Normal exit left its connection file behind.' }
    $taskResult.steps += [pscustomobject]@{ step = $Step; invokedButton = 'AutoPets quit'; exitCode = $Process.ExitCode; seconds = [Math]::Round($taskTimer.Elapsed.TotalSeconds, 3); appProcessCount = 0; portClosed = $true; connectionFileRemoved = $true }
}
function Read-Fixture {
    $taskOutput = & $taskNode --no-warnings (Join-Path $env:GITHUB_WORKSPACE 'scripts/inspect-native-lifecycle-data.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Synthetic data verification failed.' }
    return $taskOutput
}

try {
    if (-not [Environment]::UserInteractive) { throw 'Runner has no interactive desktop; no GUI pass can be claimed.' }
    if ((Test-Path -LiteralPath $taskAppDirectory) -or (Test-Path -LiteralPath $taskDataDirectory) -or @(Get-AppProcesses).Count) { throw 'Runner is not fresh.' }
    if ((Get-FileHash -LiteralPath $Installer -Algorithm SHA256).Hash.ToLowerInvariant() -ne $taskResult.installerSha256) { throw 'Pinned installer hash mismatch.' }
    $taskInstalled = Start-Process -FilePath $Installer -ArgumentList '/S' -PassThru -Wait -WindowStyle Hidden
    if ($taskInstalled.ExitCode -ne 0) { throw 'Installer failed.' }
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
    $taskOriginal = Start-Process -FilePath $taskApp -PassThru -WindowStyle Normal
    $taskWindow = Wait-ReadyWindow $taskOriginal $true
    $taskStartTimer.Stop()
    $taskConnection = Assert-ReadyBridge
    $taskHandle = [long]$taskWindow.Current.NativeWindowHandle
    $taskResult.steps += [pscustomobject]@{ step = 'first-render'; seconds = [Math]::Round($taskStartTimer.Elapsed.TotalSeconds, 3); nativeWindowVisible = $true; renderedSetupHeadingFound = $true; quitButtonFound = $true }
    Save-WindowImage $taskWindow 'first-window'
    $taskWindow = Invoke-Recall $taskOriginal $taskHandle 'recall-while-visible'
    $taskCaptionClose = $taskWindow.FindFirst([System.Windows.Automation.TreeScope]::Descendants,
        [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty, 'Close'))
    Invoke-Button $taskCaptionClose
    [void](Wait-Until { -not [AutoPetsNativeCheck]::IsWindowVisible([IntPtr]$taskHandle) } 'Caption X did not hide the window.' 10)
    $taskOriginal.Refresh()
    if ($taskOriginal.HasExited) { throw 'Caption X unexpectedly exited the app.' }
    [void](Assert-ReadyBridge)
    $taskResult.steps += [pscustomobject]@{ step = 'caption-close'; hidden = $true; processAlive = $true; bridgeAlive = $true }
    $taskWindow = Invoke-Recall $taskOriginal $taskHandle 'recall-after-hide'
    Save-WindowImage $taskWindow 'reopened-window'
    # Synthetic protocol input, not a real AI connection or enabled hook.
    $taskFixtureDirectory = Join-Path $env:RUNNER_TEMP 'native-window-fixture'
    New-Item -ItemType Directory -Path $taskFixtureDirectory -Force | Out-Null
    [void](Request-Bridge $taskConnection '/v1/events' @{ eventId = 'gui-start'; sessionId = 'gui-fixture'; turnId = 'fixture-turn'; kind = 'turn_started'; cwd = $taskFixtureDirectory; timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() })
    [void](Request-Bridge $taskConnection '/v1/task-config' @{ requestId = 'gui-config'; sessionId = 'gui-fixture'; turnId = 'fixture-turn'; cwd = $taskFixtureDirectory; completionCriterion = 'GUI restart must preserve this test record'; interventionMode = 'milestones'; elapsedAlertMinutes = 7 })
    Quit-ThroughButton $taskWindow $taskOriginal $taskConnection 'normal-exit'
    $taskBeforeRestart = Read-Fixture
    $taskBeforeRestart | Set-Content -LiteralPath (Join-Path $taskOut 'before-restart.json') -Encoding UTF8
    $taskRestart = Start-Process -FilePath $taskApp -PassThru -WindowStyle Normal
    $taskWindow = Wait-ReadyWindow $taskRestart $false
    $taskConnection = Assert-ReadyBridge
    Save-WindowImage $taskWindow 'after-restart'
    $taskAfterRestart = Read-Fixture
    if ($taskBeforeRestart -cne $taskAfterRestart) { throw 'Logical records, settings or pet positions changed after restart.' }
    $taskAfterRestart | Set-Content -LiteralPath (Join-Path $taskOut 'after-restart.json') -Encoding UTF8
    $taskResult.steps += [pscustomobject]@{ step = 'restart'; dataPreserved = $true; settingsPreserved = $true; positionsPreserved = $true; integrity = 'ok' }
    Quit-ThroughButton $taskWindow $taskRestart $taskConnection 'normal-exit-after-restart'
    $taskResult.outcome = 'passed'
} catch {
    $taskResult.outcome = 'failed'
    $taskResult.failure = $_.Exception.Message
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
    $taskResult | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $taskOut 'result.json') -Encoding UTF8
}
