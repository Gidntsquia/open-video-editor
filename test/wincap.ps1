# Saves a window (by title substring, via PrintWindow, so it may sit behind others) and the taskbar strip as PNGs.
# Usage: wincap.ps1 -Title "<text>" -Out D:\path\prefix   -> prefix-window.png, prefix-titlebar.png, prefix-taskbar.png
param([string]$Title, [string]$Out)
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices; using System.Text;
public class WC {
  public delegate bool EP(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EP f, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out R r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint f);
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  [StructLayout(LayoutKind.Sequential)] public struct R { public int L, T, Ri, B; }
}
'@
[void][WC]::SetProcessDpiAwarenessContext([IntPtr]-4)
$script:hit = [IntPtr]::Zero
[void][WC]::EnumWindows({ param($h, $l) $sb = New-Object Text.StringBuilder 256; [void][WC]::GetWindowText($h, $sb, 256)
  if ([WC]::IsWindowVisible($h) -and $sb.ToString() -like "*$Title*") { $script:hit = $h; return $false }; return $true }, [IntPtr]::Zero)
if ($script:hit -eq [IntPtr]::Zero) { 'no window'; exit 1 }
$r = New-Object WC+R; [void][WC]::GetWindowRect($script:hit, [ref]$r); $w = $r.Ri - $r.L; $h = $r.B - $r.T
$bmp = New-Object Drawing.Bitmap $w, $h; $g = [Drawing.Graphics]::FromImage($bmp); $dc = $g.GetHdc()
[void][WC]::PrintWindow($script:hit, $dc, 2); $g.ReleaseHdc($dc); $g.Dispose()
$bmp.Save("$Out-window.png")
$tb = $bmp.Clone((New-Object Drawing.Rectangle 0, 0, ([Math]::Min(700, $w)), 60), $bmp.PixelFormat); $tb.Save("$Out-titlebar.png")
Add-Type -AssemblyName System.Windows.Forms; $sb = [Windows.Forms.Screen]::PrimaryScreen.Bounds
$t = New-Object Drawing.Bitmap $sb.Width, 60; $g = [Drawing.Graphics]::FromImage($t); $g.CopyFromScreen(0, $sb.Height - 60, 0, 0, $t.Size); $t.Save("$Out-taskbar.png")
"saved $w x $h"
