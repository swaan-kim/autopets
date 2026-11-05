# Test helper: user idle time, and moving ONE process's window (by PID).
# Sends NO mouse or keyboard input; SetWindowPos uses SWP_NOACTIVATE.
param([Parameter(Mandatory)][ValidateSet('idle','move','rect')][string]$Op, [int]$ProcessId, [int]$X, [int]$Y)
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class WinPid {
  [StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO i);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int cx, int cy, uint f);
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  public struct RECT { public int L, T, R, B; }
  public static IntPtr Find(uint target) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); RECT r; if (p == target && IsWindowVisible(h) && GetWindowRect(h, out r) && r.R - r.L >= 50) { found = h; return false; } return true; }, IntPtr.Zero);
    return found;
  }
  public static uint IdleMs() { var i = new LASTINPUTINFO(); i.cbSize = (uint)Marshal.SizeOf(i); GetLastInputInfo(ref i); return (uint)Environment.TickCount - i.dwTime; }
}
"@
[WinPid]::SetProcessDPIAware() | Out-Null
switch ($Op) {
  'idle' { [WinPid]::IdleMs() }
  'rect' {
    $h = [WinPid]::Find($ProcessId)
    if ($h -eq [IntPtr]::Zero) { '{"window":null}'; break }
    $r = New-Object WinPid+RECT; [WinPid]::GetWindowRect($h, [ref]$r) | Out-Null
    '{{"x":{0},"y":{1},"w":{2},"h":{3}}}' -f $r.L, $r.T, ($r.R - $r.L), ($r.B - $r.T)
  }
  'move' {
    $h = [WinPid]::Find($ProcessId)
    if ($h -eq [IntPtr]::Zero) { 'no-window'; break }
    # SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE
    [WinPid]::SetWindowPos($h, [IntPtr]::Zero, $X, $Y, 0, 0, 0x1 -bor 0x4 -bor 0x10) | Out-Null
    'moved'
  }
}
