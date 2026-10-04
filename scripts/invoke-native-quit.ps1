param([Parameter(Mandatory=$true)][int]$AppProcessId, [Parameter(Mandatory=$true)][string]$MarkerFile)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:RUNNER_OS -ne 'Windows' -or $env:GITHUB_REPOSITORY -ne 'swaan-kim/autopets') { throw 'CI-only UI Automation worker.' }
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,WindowsBase
$taskTitle = [regex]::Unescape('AutoPets \u00b7 \uc791\uc740 \uc791\uc5c5 \ub3d9\ub8cc')
$taskQuitName = [regex]::Unescape('AutoPets \uc885\ub8cc')
$taskCondition = [System.Windows.Automation.AndCondition]::new([System.Windows.Automation.Condition[]]@(
    [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $AppProcessId),
    [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, $taskTitle)
))
$taskWindow = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $taskCondition)
if (-not $taskWindow) { throw 'Target app window is missing.' }
$taskCondition = [System.Windows.Automation.AndCondition]::new([System.Windows.Automation.Condition[]]@(
    [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button),
    [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, $taskQuitName)
))
$taskQuit = $taskWindow.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $taskCondition)
if (-not $taskQuit -or -not $taskQuit.Current.IsEnabled -or $taskQuit.Current.IsOffscreen) { throw 'Visible quit button unavailable.' }
$taskPattern = $null
if (-not $taskQuit.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$taskPattern)) { throw 'Quit button has no InvokePattern.' }
[IO.File]::WriteAllText($MarkerFile, [DateTime]::UtcNow.ToString('O'))
# Some providers can block here as their app exits. The parent observes the
# actual app PID/exit code/TCP independently and bounds this worker's lifetime.
([System.Windows.Automation.InvokePattern]$taskPattern).Invoke()
