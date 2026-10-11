# Fills a native Windows file dialog (UI Automation, no focus/keystrokes) and presses its default button.
# Usage: powershell -File dialog.ps1 -Title "Save project" -Path "D:\ove-test\cache\x.ovep" [-Timeout 20]
param([string]$Title, [string]$Path, [int]$Timeout = 20)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$root = [Windows.Automation.AutomationElement]::RootElement
$end = (Get-Date).AddSeconds($Timeout); $dlg = $null
while ((Get-Date) -lt $end -and -not $dlg) {
  $c = New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::NameProperty, $Title)
  $dlg = $root.FindFirst([Windows.Automation.TreeScope]::Children, $c)
  if (-not $dlg) {
    # dialog may be owned by the app window
    $wins = $root.FindAll([Windows.Automation.TreeScope]::Children, [Windows.Automation.Condition]::TrueCondition)
    foreach ($w in $wins) { $d = $w.FindFirst([Windows.Automation.TreeScope]::Children, $c); if ($d) { $dlg = $d; break } }
  }
  Start-Sleep -Milliseconds 300
}
if (-not $dlg) { Write-Output "NO_DIALOG"; exit 2 }
$A = [Windows.Automation.AutomationElement]
$edit = $null
foreach ($id in '1001', '1148') {
  $cond = New-Object Windows.Automation.AndCondition((New-Object Windows.Automation.PropertyCondition($A::AutomationIdProperty, $id)), (New-Object Windows.Automation.PropertyCondition($A::ClassNameProperty, 'Edit')))
  $edit = $dlg.FindFirst([Windows.Automation.TreeScope]::Descendants, $cond); if ($edit) { break }
}
if (-not $edit) { Write-Output "NO_EDIT"; exit 3 }
Add-Type -Namespace W -Name U -MemberDefinition '[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, string l); [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);'
Add-Type -Namespace W -Name G -MemberDefinition '[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, System.Text.StringBuilder l);'
# Type the name as characters (WM_CHAR), not WM_SETTEXT: on a fresh profile the dialog ignores WM_SETTEXT text
# and saves its default name. A dialog still initialising can also overwrite the name; retry until it sticks.
$h = [IntPtr]$edit.Current.NativeWindowHandle
for ($i = 0; $i -lt 10; $i++) {
  [void][W.U]::SendMessage($h, 0x00B1, [IntPtr]0, [IntPtr](-1))   # EM_SETSEL all
  [void][W.U]::SendMessage($h, 0x0102, [IntPtr]8, [IntPtr]::Zero)  # WM_CHAR backspace
  foreach ($ch in $Path.ToCharArray()) { [void][W.U]::SendMessage($h, 0x0102, [IntPtr][int]$ch, [IntPtr]::Zero) }
  Start-Sleep -Milliseconds 400
  $sb = New-Object System.Text.StringBuilder 1024; [void][W.G]::SendMessage($h, 0x000D, [IntPtr]1024, $sb)   # WM_GETTEXT
  if ($sb.ToString() -eq $Path) { break }
}
if ($sb.ToString() -ne $Path) { Write-Output "TEXT_NOT_SET: $($sb.ToString())"; exit 5 }
$cond = New-Object Windows.Automation.AndCondition((New-Object Windows.Automation.PropertyCondition($A::AutomationIdProperty, '1')), (New-Object Windows.Automation.PropertyCondition($A::ClassNameProperty, 'Button')))
$btn = $dlg.FindFirst([Windows.Automation.TreeScope]::Descendants, $cond)
if (-not $btn) { Write-Output "NO_BUTTON"; exit 4 }
[void][W.U]::SendMessage([IntPtr]$btn.Current.NativeWindowHandle, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)  # BM_CLICK
Write-Output "OK"
