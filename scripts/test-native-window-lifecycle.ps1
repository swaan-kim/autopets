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
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class AutoPetsNativeCheck {
  [StructLayout(LayoutKind.Sequential)] private struct NativePoint { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] private struct NativeRect { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] private struct MouseInput { public int Dx, Dy; public uint MouseData, Flags, Time; public UIntPtr ExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] private struct NativeInput { public uint Type; public MouseInput Mouse; }
  public sealed class FixtureClickEvidence {
    public long Handle, HitHandle; public uint Owner, InputsSent; public int X, Y, ClientWidth, ClientHeight, LastError;
  }
  private delegate bool EnumWindowsProc(IntPtr handle, IntPtr parameter);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr parameter);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr handle, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr handle);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr handle);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr handle);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr handle);
  [DllImport("user32.dll")] private static extern bool GetClientRect(IntPtr handle, out NativeRect rect);
  [DllImport("user32.dll")] private static extern bool ClientToScreen(IntPtr handle, ref NativePoint point);
  [DllImport("user32.dll")] private static extern IntPtr WindowFromPoint(NativePoint point);
  [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr handle, uint flags);
  [DllImport("user32.dll")] private static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] private static extern bool GetCursorPos(out NativePoint point);
  [DllImport("user32.dll", SetLastError = true)] private static extern uint SendInput(uint count, NativeInput[] inputs, int size);
  public static uint WindowOwner(IntPtr handle) { uint owner; GetWindowThreadProcessId(handle, out owner); return owner; }
  public static FixtureClickEvidence ClickOwnedFixture(IntPtr handle, uint expectedOwner) {
    // This is test input on an empty, worker-owned form, never on product UI.
    if (Environment.GetEnvironmentVariable("GITHUB_ACTIONS") != "true" ||
        Environment.GetEnvironmentVariable("RUNNER_ENVIRONMENT") != "github-hosted" ||
        Environment.GetEnvironmentVariable("RUNNER_OS") != "Windows" ||
        Environment.GetEnvironmentVariable("GITHUB_REPOSITORY") != "swaan-kim/autopets")
      throw new InvalidOperationException("Fixture input is restricted to disposable Windows CI.");
    var title = new StringBuilder(128); GetWindowText(handle, title, title.Capacity);
    if (!IsWindow(handle) || !IsWindowVisible(handle) || IsIconic(handle) ||
        WindowOwner(handle) != expectedOwner || expectedOwner != (uint)System.Diagnostics.Process.GetCurrentProcess().Id ||
        title.ToString() != "AutoPets onboarding focus fixture")
      throw new InvalidOperationException("Fixture input target identity is invalid.");
    NativeRect rect;
    if (!GetClientRect(handle, out rect) || rect.Right - rect.Left < 40 || rect.Bottom - rect.Top < 40)
      throw new InvalidOperationException("Fixture client bounds are unavailable.");
    var point = new NativePoint { X = (rect.Left + rect.Right) / 2, Y = (rect.Top + rect.Bottom) / 2 };
    if (!ClientToScreen(handle, ref point)) throw new InvalidOperationException("Fixture client coordinates are unavailable.");
    var hit = GetAncestor(WindowFromPoint(point), 2);
    if (hit != handle || WindowOwner(hit) != expectedOwner)
      throw new InvalidOperationException("Fixture click point is covered by a different window: " + hit.ToInt64());
    if (!SetCursorPos(point.X, point.Y)) throw new InvalidOperationException("Fixture cursor placement failed.");
    NativePoint cursor; NativeRect currentRect;
    var currentCenter = new NativePoint { X = (rect.Left + rect.Right) / 2, Y = (rect.Top + rect.Bottom) / 2 };
    if (!GetCursorPos(out cursor) || cursor.X != point.X || cursor.Y != point.Y ||
        !GetClientRect(handle, out currentRect) || currentRect.Left != rect.Left || currentRect.Top != rect.Top ||
        currentRect.Right != rect.Right || currentRect.Bottom != rect.Bottom ||
        !ClientToScreen(handle, ref currentCenter) || currentCenter.X != point.X || currentCenter.Y != point.Y ||
        !IsWindow(handle) || !IsWindowVisible(handle) || WindowOwner(handle) != expectedOwner ||
        GetAncestor(WindowFromPoint(cursor), 2) != handle)
      throw new InvalidOperationException("Fixture click target changed before input; no click was sent.");
    var inputs = new[] {
      new NativeInput { Type = 0, Mouse = new MouseInput { Flags = 0x0002 } },
      new NativeInput { Type = 0, Mouse = new MouseInput { Flags = 0x0004 } }
    };
    var sent = SendInput(2, inputs, Marshal.SizeOf(typeof(NativeInput)));
    var error = sent == 2 ? 0 : Marshal.GetLastWin32Error();
    // Release only if Windows accepted the down event without its paired up.
    if (sent == 1) SendInput(1, new[] { inputs[1] }, Marshal.SizeOf(typeof(NativeInput)));
    return new FixtureClickEvidence { Handle = handle.ToInt64(), HitHandle = hit.ToInt64(), Owner = expectedOwner,
      X = point.X, Y = point.Y, ClientWidth = rect.Right - rect.Left, ClientHeight = rect.Bottom - rect.Top,
      InputsSent = sent, LastError = error };
  }
  public static long[] PetHandles(uint processId) {
    var result = new List<long>();
    var names = new[] { "AutoPets \u00b7 \ubaa8\uc2a4", "AutoPets \u00b7 \ub8e8\ub098", "AutoPets \u00b7 \ud1a0\ud53c" };
    EnumWindows((handle, parameter) => {
      uint owner; GetWindowThreadProcessId(handle, out owner);
      if (owner == processId) {
        var title = new StringBuilder(128); GetWindowText(handle, title, title.Capacity);
        if (Array.IndexOf(names, title.ToString()) >= 0) result.Add(handle.ToInt64());
      }
      return true;
    }, IntPtr.Zero);
    result.Sort();
    return result.ToArray();
  }
}
'@
# A real STA message loop keeps the fixture responsive while the worker reads
# product/UIA state. It is created only inside this GitHub-hosted-only script.
Add-Type -ReferencedAssemblies @([Windows.Forms.Form].Assembly.Location, [Drawing.Size].Assembly.Location) @'
using System;
using System.Threading;
using System.Windows.Forms;
public sealed class AutoPetsFocusFixture : IDisposable {
  private readonly ManualResetEventSlim ready = new ManualResetEventSlim(false);
  private readonly Thread thread;
  private Form form;
  private IntPtr handle;
  private Exception startupError;
  public IntPtr Handle { get { return handle; } }
  public AutoPetsFocusFixture() {
    thread = new Thread(new ThreadStart(Run));
    thread.IsBackground = true;
    thread.SetApartmentState(ApartmentState.STA);
    thread.Start();
    if (!ready.Wait(TimeSpan.FromSeconds(10))) throw new InvalidOperationException("Focus fixture message loop did not become ready.");
    if (startupError != null) throw new InvalidOperationException("Focus fixture failed to initialize.", startupError);
    if (handle == IntPtr.Zero) throw new InvalidOperationException("Focus fixture did not create a native window.");
  }
  private void Run() {
    try {
      form = new Form();
      form.Text = "AutoPets onboarding focus fixture";
      form.ShowInTaskbar = true;
      form.Width = 240;
      form.Height = 140;
      form.Shown += delegate { handle = form.Handle; ready.Set(); };
      Application.Run(form);
    } catch (Exception error) { startupError = error; ready.Set(); }
  }
  public void Activate() {
    if (form == null || form.IsDisposed) throw new InvalidOperationException("Focus fixture is unavailable.");
    form.BeginInvoke(new Action(delegate { form.WindowState = FormWindowState.Normal; form.Show(); form.Activate(); }));
  }
  public void RaiseForClick() {
    if (form == null || form.IsDisposed) throw new InvalidOperationException("Focus fixture is unavailable.");
    form.Invoke(new Action(delegate { form.WindowState = FormWindowState.Normal; form.TopMost = true; form.Show(); form.BringToFront(); }));
  }
  public void Dispose() {
    if (form != null && !form.IsDisposed) form.BeginInvoke(new Action(delegate { form.Close(); }));
    if (!thread.Join(3000)) throw new InvalidOperationException("Focus fixture message loop did not close.");
    ready.Dispose();
  }
}
'@
$taskAppDirectory = Join-Path $env:LOCALAPPDATA 'AutoPets'
$taskDataDirectory = Join-Path $env:LOCALAPPDATA 'local.autopets.desktop'
$taskApp = Join-Path $taskAppDirectory 'autopets.exe'
$taskNode = Join-Path $taskAppDirectory 'connector/runtime/node.exe'
$taskConnectionFile = Join-Path $taskDataDirectory 'connection.json'
$taskTitle = [regex]::Unescape('AutoPets \u00b7 \uc791\uc740 \uc791\uc5c5 \ub3d9\ub8cc')
$taskQuitName = [regex]::Unescape('AutoPets \uc885\ub8cc')
$taskReadyName = [regex]::Unescape('\uc774 \ud3ab\uc73c\ub85c \uc2dc\uc791')
$taskWindow = $null
$taskResult = [ordered]@{ outcome = 'incomplete'; harnessCommit = $env:GITHUB_SHA; installerSha256 = $ExpectedSha256; sourceCommit = $SourceCommit; environment = 'GitHub-hosted Windows'; automation = 'UI Automation InvokePattern'; forcedTerminationUsed = $false; screenshots = @(); steps = @() }
$taskOriginalPath = $env:PATH
. (Join-Path $PSScriptRoot 'native-install-state.ps1')
. (Join-Path $PSScriptRoot 'measure-native-resources.ps1')
. (Join-Path $PSScriptRoot 'native-bridge-readiness.ps1')

function Write-LifecycleCheckpoint([string]$Path, $Value, [int]$Depth = 10) {
    $taskJson = $Value | ConvertTo-Json -Depth $Depth
    # PowerShell 5.1 Set-Content may probe an existing BOM through a write-only
    # stream when a reader holds the file. This writer never reads the file.
    # Keep the UTF-8 BOM for Windows PowerShell readers. The watchdog retries
    # partial phase JSON while a checkpoint is being written.
    $taskStream = [IO.File]::Open($Path, [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::ReadWrite)
    $taskWriter = $null
    try {
        $taskWriter = [IO.StreamWriter]::new($taskStream, [Text.UTF8Encoding]::new($true))
        $taskWriter.Write($taskJson)
    } finally {
        if ($taskWriter) { $taskWriter.Dispose() } else { $taskStream.Dispose() }
    }
}
function Save-LifecycleResult {
    $taskPendingResult = Join-Path $taskOut 'result.pending.json'
    Write-LifecycleCheckpoint $taskPendingResult $taskResult
    Move-Item -LiteralPath $taskPendingResult -Destination (Join-Path $taskOut 'result.json') -Force
}
function Set-LifecyclePhase([string]$Name, [int]$Seconds = 30) {
    $taskPhase = [pscustomobject]@{ name = $Name; startedAt = [DateTime]::UtcNow.ToString('O'); timeoutSeconds = $Seconds }
    $taskResult.phase = $taskPhase
    Save-LifecycleResult
    Write-LifecycleCheckpoint (Join-Path $taskOut 'phase.json') $taskPhase
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
function Assert-NativeForeground([long]$Handle, [bool]$RequestActivation = $true) {
    $taskActivation = if ($RequestActivation) { [AutoPetsNativeCheck]::SetForegroundWindow([IntPtr]$Handle) } else { $null }
    $taskSamples = [Collections.Generic.List[object]]::new()
    $taskExpectedOwner = [AutoPetsNativeCheck]::WindowOwner([IntPtr]$Handle)
    $taskDeadline = [DateTime]::UtcNow.AddSeconds(10)
    $taskStableSamples = 0
    while ([DateTime]::UtcNow -lt $taskDeadline) {
        [Windows.Forms.Application]::DoEvents()
        $taskForeground = [AutoPetsNativeCheck]::GetForegroundWindow()
        $taskForegroundOwner = [AutoPetsNativeCheck]::WindowOwner($taskForeground)
        $taskSample = [pscustomobject]@{
            expectedHandle = $Handle; expectedOwner = $taskExpectedOwner
            expectedValid = [AutoPetsNativeCheck]::IsWindow([IntPtr]$Handle)
            expectedVisible = [AutoPetsNativeCheck]::IsWindowVisible([IntPtr]$Handle)
            actualHandle = $taskForeground.ToInt64(); actualOwner = $taskForegroundOwner
            actualIsPetWindow = @([AutoPetsNativeCheck]::PetHandles($taskForegroundOwner)) -contains $taskForeground.ToInt64()
        }
        $taskSamples.Add($taskSample)
        if ($taskSample.expectedValid -and $taskSample.expectedVisible -and $taskSample.actualHandle -eq $Handle -and $taskSample.actualOwner -eq $taskExpectedOwner) { $taskStableSamples++ }
        else { $taskStableSamples = 0 }
        if ($taskStableSamples -ge 5) {
            $taskResult.steps += [pscustomobject]@{ step = 'native-foreground-confirmed'; phase = $taskResult.phase.name; requestedActivation = $RequestActivation; activationReturned = $taskActivation; expectedHandle = $Handle; expectedOwner = $taskExpectedOwner; stableSamples = $taskStableSamples }
            return
        }
        Start-Sleep -Milliseconds 100
    }
    $taskResult.steps += [pscustomobject]@{ step = 'native-foreground-failed'; phase = $taskResult.phase.name; requestedActivation = $RequestActivation; activationReturned = $taskActivation; expectedHandle = $Handle; expectedOwner = $taskExpectedOwner; samples = $taskSamples.ToArray() }
    Save-LifecycleResult
    throw 'The expected native window did not remain the exact foreground window.'
}
function Wait-ReadyWindow($Process, [bool]$Fresh) {
    $taskFound = Wait-Until { Get-MainWindow $Process.Id } 'Main window was not exposed by UI Automation.' 60
    [void](Wait-Until {
        $taskHandle = [IntPtr]$taskFound.Current.NativeWindowHandle
        $taskQuit = Find-Button $taskFound $taskQuitName
        if ([AutoPetsNativeCheck]::IsWindowVisible($taskHandle) -and -not [AutoPetsNativeCheck]::IsIconic($taskHandle) -and $taskQuit -and $taskQuit.Current.IsEnabled) {
            # Fresh installs now open the pet start screen, not connection settings.
            # Observe its enabled control only; never configure the AI during lifecycle checks.
            if (-not $Fresh) { return $true }
            $taskReady = Find-Button $taskFound $taskReadyName
            if ($taskReady -and $taskReady.Current.IsEnabled -and -not $taskReady.Current.IsOffscreen) { return $true }
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
    Assert-NativeForeground ([long]$taskFound.Current.NativeWindowHandle)
    return $taskFound
}
function Assert-QuitVisible($Window) {
    $taskQuit = Find-Button $Window $taskQuitName
    $taskBounds = $taskQuit.Current.BoundingRectangle
    $taskRectangle = [Drawing.Rectangle]::new([int]$taskBounds.X, [int]$taskBounds.Y, [int]$taskBounds.Width, [int]$taskBounds.Height)
    $taskWorkArea = [Windows.Forms.Screen]::FromHandle([IntPtr]$Window.Current.NativeWindowHandle).WorkingArea
    if ($taskQuit.Current.IsOffscreen -or -not $taskWorkArea.Contains($taskRectangle)) { throw 'Quit button requires scrolling or extends outside the work area.' }
}
function Invoke-Button($Button, [switch]$Expand) {
    if (-not $Button -or -not $Button.Current.IsEnabled) { throw 'Required button is unavailable.' }
    $taskPattern = $null
    $taskButtonName = $Button.Current.Name
    $taskSupported = @($Button.GetSupportedPatterns() | ForEach-Object { $_.ProgrammaticName })
    if ($Button.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$taskPattern)) {
        $taskResult.steps += [pscustomobject]@{ step = 'accessible-button-action'; name = $taskButtonName; pattern = 'Invoke'; supportedPatterns = $taskSupported }
        Save-LifecycleResult
        ([System.Windows.Automation.InvokePattern]$taskPattern).Invoke()
        return
    }
    $taskPattern = $null
    # aria-expanded controls can expose ExpandCollapse without Invoke. Use it
    # only where the test explicitly opens a card; never replace a working Invoke.
    if ($Expand -and $Button.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$taskPattern)) {
        $taskExpandPattern = [System.Windows.Automation.ExpandCollapsePattern]$taskPattern
        $taskExpandState = $taskExpandPattern.Current.ExpandCollapseState
        $taskResult.steps += [pscustomobject]@{ step = 'accessible-button-action'; name = $taskButtonName; pattern = 'ExpandCollapse'; before = $taskExpandState.ToString(); supportedPatterns = $taskSupported }
        Save-LifecycleResult
        if ($taskExpandState -eq [System.Windows.Automation.ExpandCollapseState]::Collapsed) { $taskExpandPattern.Expand() }
        elseif ($taskExpandState -ne [System.Windows.Automation.ExpandCollapseState]::Expanded) { throw 'Required card cannot be expanded.' }
        $taskResult.steps += [pscustomobject]@{ step = 'open-accessible-card'; name = $taskButtonName; pattern = 'ExpandCollapse'; before = $taskExpandState.ToString() }
        return
    }
    $taskResult.steps += [pscustomobject]@{ step = 'button-pattern-unavailable'; name = $taskButtonName; type = $Button.Current.ControlType.ProgrammaticName; patterns = $taskSupported; requestedExpand = [bool]$Expand }
    Save-LifecycleResult
    throw ('Button has no suitable accessible action: ' + $taskButtonName)
}
function Assert-PetVisibility([int]$ProcessId, [int]$VisibleCount, [string]$Step) {
    $taskVisibility = Wait-Until {
        # UIA omits hidden top-level windows. Read only HWND visibility for the
        # three known pet windows owned by this exact disposable app process.
        $taskHandles = @([AutoPetsNativeCheck]::PetHandles([uint32]$ProcessId))
        if ($taskHandles.Count -ne 3) { return $null }
        $taskShown = @($taskHandles | Where-Object { [AutoPetsNativeCheck]::IsWindowVisible([IntPtr]$_) })
        if ($taskShown.Count -ne $VisibleCount) { return $null }
        return [pscustomobject]@{ handles = $taskHandles; visible = $taskShown }
    } ("Pet visibility mismatch: " + $Step) 10
    $taskResult.steps += [pscustomobject]@{ step = $Step; petWindowCount = @($taskVisibility.handles).Count; visiblePetCount = @($taskVisibility.visible).Count; observedVia = 'native HWND visibility' }
    return $taskVisibility
}
function Hide-MainByCaption($Window, [long]$Handle) {
    $taskClose = $Window.FindFirst([System.Windows.Automation.TreeScope]::Descendants,
        [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::AutomationIdProperty, 'Close'))
    Invoke-Button $taskClose
    [void](Wait-Until { -not [AutoPetsNativeCheck]::IsWindowVisible([IntPtr]$Handle) } 'Caption X did not hide the manager.' 10)
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
    $taskAdvancedNav = [regex]::Unescape('\uace0\uae09 \uae30\ub2a5')
    $taskRoleNav = [regex]::Unescape('\uc5ed\ud560\uacfc \ub0b4 \ud3ab')
    $taskRoleSave = [regex]::Unescape('\ub0b4 \ud3ab \uc800\uc7a5')
    $taskRoleSaved = [regex]::Unescape('\ub0b4 \ud3ab \ubcc0\uacbd \uc800\uc7a5')
    # The role editor remains available inside the initially collapsed advanced section.
    $taskAdvanced = Find-Name $Window $taskAdvancedNav
    if (-not $taskAdvanced) { throw 'Advanced navigation is missing.' }
    $taskExpand = $null
    if ($taskAdvanced.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$taskExpand)) {
        $taskExpansion = [System.Windows.Automation.ExpandCollapsePattern]$taskExpand
        if ($taskExpansion.Current.ExpandCollapseState -ne [System.Windows.Automation.ExpandCollapseState]::Expanded) { $taskExpansion.Expand() }
    } else {
        Invoke-Button $taskAdvanced
    }
    $taskRole = Wait-Until {
        $taskButton = Find-Button $Window $taskRoleNav
        if ($taskButton -and $taskButton.Current.IsEnabled -and -not $taskButton.Current.IsOffscreen) { return $taskButton }
        return $null
    } 'Expanded role navigation did not become visible.' 10
    Invoke-Button $taskRole
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

function Test-OnboardingPetVisibility($Window, $Process, [long]$Handle) {
    Set-LifecyclePhase 'onboarding-stored-pet-visibility' 60
    [void](Assert-PetVisibility $Process.Id 1 'role-view-restores-assigned-pet')
    Invoke-Button (Find-Button $Window ([regex]::Unescape('\ub098\uc758 \ud3ab')))
    [void](Wait-Until { Find-Button $Window ([regex]::Unescape('\ud3ab \uc900\ube44 \ub2eb\uae30')) } 'Open pet preparation guide was not restored.' 10)
    [void](Assert-PetVisibility $Process.Id 0 'onboarding-hides-assigned-pet')
    $taskBeforeSuppression = Read-Fixture
    # A fixture window owned by this CI worker stands in for another foreground
    # app. No Codex account, real chat or other user application is opened.
    $taskFocusFixture = [AutoPetsFocusFixture]::new()
    try {
        if ([AutoPetsNativeCheck]::WindowOwner($taskFocusFixture.Handle) -ne $PID) { throw 'Focus fixture is not owned by the lifecycle worker.' }
        $taskFocusFixture.Activate()
        $taskActivation = [AutoPetsNativeCheck]::SetForegroundWindow($taskFocusFixture.Handle)
        $taskResult.steps += [pscustomobject]@{ step = 'fixture-programmatic-activation'; activationReturned = $taskActivation; expectedHandle = $taskFocusFixture.Handle.ToInt64(); actualHandle = [AutoPetsNativeCheck]::GetForegroundWindow().ToInt64() }
        # Windows may deny foreground activation from this hidden worker. One
        # guarded click in the empty fixture provides ordinary input activation.
        # The helper refuses input unless the exact owned HWND is under the point.
        $taskFocusFixture.RaiseForClick()
        $taskClick = [AutoPetsNativeCheck]::ClickOwnedFixture($taskFocusFixture.Handle, [uint32]$PID)
        $taskResult.steps += [pscustomobject]@{ step = 'fixture-owned-client-click'; evidence = $taskClick; expectedOwner = $PID }
        Save-LifecycleResult
        if ($taskClick.InputsSent -ne 2) { throw 'Windows did not accept the paired fixture input events.' }
        Assert-NativeForeground ($taskFocusFixture.Handle.ToInt64()) $false
        [void](Assert-PetVisibility $Process.Id 1 'background-onboarding-restores-assigned-pet')
        # Showing the pet must not steal focus back from the fixture. This
        # second assertion observes only; it never reactivates the fixture.
        Assert-NativeForeground ($taskFocusFixture.Handle.ToInt64()) $false
    } finally {
        $taskFocusFixture.Dispose()
    }
    Assert-NativeForeground $Handle
    [void](Assert-PetVisibility $Process.Id 0 'foreground-onboarding-hides-assigned-pet')
    $taskWindowPattern = $null
    if (-not $Window.TryGetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern, [ref]$taskWindowPattern)) { throw 'Main window has no accessible WindowPattern.' }
    ([System.Windows.Automation.WindowPattern]$taskWindowPattern).SetWindowVisualState([System.Windows.Automation.WindowVisualState]::Minimized)
    [void](Wait-Until { [AutoPetsNativeCheck]::IsIconic([IntPtr]$Handle) } 'Manager did not minimize.' 10)
    [void](Assert-PetVisibility $Process.Id 1 'minimized-onboarding-restores-assigned-pet')
    $Window = Invoke-Recall $Process $Handle 'recall-minimized-onboarding'
    [void](Assert-PetVisibility $Process.Id 0 'restored-onboarding-hides-assigned-pet')
    Set-LifecyclePhase 'onboarding-caption-visibility' 45
    Hide-MainByCaption $Window $Handle
    [void](Assert-PetVisibility $Process.Id 1 'hidden-onboarding-restores-assigned-pet')
    $Window = Invoke-Recall $Process $Handle 'recall-hidden-onboarding'
    [void](Assert-PetVisibility $Process.Id 0 'reopened-onboarding-hides-assigned-pet')
    if ((Read-Fixture) -cne $taskBeforeSuppression) { throw 'Onboarding window transitions changed stored data or positions.' }

    # Exercise the real user's per-pet hide action. Onboarding and single-instance
    # recall must not silently reset it. No native test-only command is injected.
    Set-LifecyclePhase 'onboarding-hidden-pet-preference' 60
    Invoke-Button (Find-Button $Window ([regex]::Unescape('\ud3ab \uc900\ube44 \ub2eb\uae30')))
    $taskVisible = Assert-PetVisibility $Process.Id 1 'closed-guide-restores-assigned-pet'
    $taskPetHandle = [IntPtr]([long]$taskVisible.visible[0])
    [void][AutoPetsNativeCheck]::SetForegroundWindow($taskPetHandle)
    $taskPetWindow = [System.Windows.Automation.AutomationElement]::FromHandle($taskPetHandle)
    $taskMenuSuffix = [regex]::Unescape('\uc791\uc5c5 \uce74\ub4dc \uc5f4\uae30')
    $taskPetButton = Wait-Until {
        $taskButtons = $taskPetWindow.FindAll([System.Windows.Automation.TreeScope]::Descendants,
            [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button))
        for ($taskIndex = 0; $taskIndex -lt $taskButtons.Count; $taskIndex++) {
            if ($taskButtons[$taskIndex].Current.Name.EndsWith($taskMenuSuffix)) { return $taskButtons[$taskIndex] }
        }
        return $null
    } 'Assigned pet card button is unavailable.' 10
    Invoke-Button $taskPetButton -Expand
    $taskPetMenu = Wait-Until { Find-Button $taskPetWindow ([regex]::Unescape('\ud3ab \uce74\ub4dc \uba54\ub274')) } 'Pet card menu is unavailable.' 10
    Invoke-Button $taskPetMenu -Expand
    $taskHidePet = Wait-Until { Find-Button $taskPetWindow ([regex]::Unescape('\uc774 \ud3ab \uc228\uae30\uae30')) } 'Per-pet hide button is unavailable.' 10
    Invoke-Button $taskHidePet
    [void](Assert-PetVisibility $Process.Id 0 'user-hid-assigned-pet')
    $taskBeforeHidden = Read-Fixture
    Invoke-Button (Find-Button $Window ([regex]::Unescape('\ud3ab \uc900\ube44')))
    [void](Wait-Until { Find-Button $Window ([regex]::Unescape('\ud3ab \uc900\ube44 \ub2eb\uae30')) } 'Pet preparation did not reopen.' 10)
    Hide-MainByCaption $Window $Handle
    [void](Assert-PetVisibility $Process.Id 0 'hidden-manager-preserves-hidden-pet')
    $Window = Invoke-Recall $Process $Handle 'recall-with-user-hidden-pet'
    [void](Assert-PetVisibility $Process.Id 0 'recalled-manager-preserves-hidden-pet')
    Set-LifecyclePhase 'onboarding-restore-user-choice' 45
    Invoke-Button (Find-Button $Window ([regex]::Unescape('\ud3ab \uc900\ube44 \ub2eb\uae30')))
    [void](Assert-PetVisibility $Process.Id 0 'closed-guide-preserves-hidden-pet')
    if ((Read-Fixture) -cne $taskBeforeHidden) { throw 'Onboarding reset the hidden pet fixture or its positions.' }
    Invoke-Button (Find-Button $Window ([regex]::Unescape('\ubc14\ud0d5\ud654\uba74\uc5d0 \ubaa8\ub450 \ud45c\uc2dc \u2197')))
    [void](Assert-PetVisibility $Process.Id 1 'explicit-show-restores-assigned-pet')
    $taskResult.steps += [pscustomobject]@{ step = 'onboarding-overlay-regression'; storedSession = $true; foregroundSwitch = $true; minimizeRestore = $true; captionHideRecall = $true; userHiddenPreferencePreserved = $true; positionsAndDataPreserved = $true; aiConnectionConfigured = $false }
    return $Window
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
    $taskResult.steps += [pscustomobject]@{ step = 'first-render'; seconds = [Math]::Round($taskStartTimer.Elapsed.TotalSeconds, 3); nativeWindowVisible = $true; renderedPetStartControlFound = $true; quitButtonFound = $true }
    [void](Assert-PetVisibility $taskOriginal.Id 0 'first-onboarding-overlays-hidden')
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
    try {
        $taskWindow = Test-OnboardingPetVisibility $taskWindow $taskOriginal $taskHandle
    } catch {
        # Preserve a failed overlay check, but still exercise independent normal
        # shutdown and durable-data roundtrips. Never turn partial evidence green.
        $taskResult.onboardingFailure = [pscustomobject]@{ phase = $taskResult.phase.name; message = $_.Exception.Message }
        Save-LifecycleResult
        $taskWindow = Invoke-Recall $taskOriginal $taskHandle 'recover-for-independent-lifecycle'
    }
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
    $taskResult.independentLifecyclePassed = $true
    if ($taskResult.onboardingFailure) { throw 'Independent lifecycle completed, but onboarding verification failed; see onboardingFailure.' }
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
