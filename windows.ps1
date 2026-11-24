param([int]$OverlayPid, [switch]$Check)
$ErrorActionPreference = 'Stop'
$references = 'UIAutomationClient', 'UIAutomationTypes', 'WindowsBase' | ForEach-Object {
    (Add-Type -AssemblyName $_ -PassThru | Select-Object -First 1).Assembly.Location
}
Add-Type -ReferencedAssemblies $references @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Windows.Automation;
public static class WindowEdges {
    public class Edge { public long id; public int x, y, width, height; public bool desktopItem, finderIcon; }
    private struct Rect { public int Left, Top, Right, Bottom; }
    private delegate bool Visitor(IntPtr window, IntPtr data);
    [DllImport("user32.dll")] private static extern bool EnumWindows(Visitor visitor, IntPtr data);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string className, string title);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] private static extern int GetWindowTextLength(IntPtr window);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out int pid);
    [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(IntPtr window, int attribute, out Rect rect, int size);
    [DllImport("dwmapi.dll", EntryPoint="DwmGetWindowAttribute")] private static extern int GetCloaked(IntPtr window, int attribute, out int value, int size);
    public static List<Edge> Read(int overlayPid) {
        var edges = new List<Edge>();
        EnumWindows((window, data) => {
            int pid, cloaked;
            GetWindowThreadProcessId(window, out pid);
            if (pid == overlayPid || !IsWindowVisible(window) || IsIconic(window) ||
                GetWindowTextLength(window) == 0 ||
                (GetCloaked(window, 14, out cloaked, 4) == 0 && cloaked != 0)) return true;
            Rect rect;
            if (DwmGetWindowAttribute(window, 9, out rect, 16) != 0) return true;
            int width = rect.Right - rect.Left, height = rect.Bottom - rect.Top;
            if (width >= 160 && height >= 100)
                edges.Add(new Edge { id = window.ToInt64(), x = rect.Left, y = rect.Top, width = width, height = height });
            return true;
        }, IntPtr.Zero);
        return edges;
    }

    public static List<Edge> ReadDesktop() {
        var edges = new List<Edge>();
        IntPtr desktop = IntPtr.Zero;
        EnumWindows((window, data) => {
            var host = FindWindowEx(window, IntPtr.Zero, "SHELLDLL_DefView", null);
            if (host == IntPtr.Zero) return true;
            var list = FindWindowEx(host, IntPtr.Zero, "SysListView32", null);
            if (list == IntPtr.Zero || !IsWindowVisible(list)) return true;
            desktop = list;
            return false;
        }, IntPtr.Zero);
        if (desktop == IntPtr.Zero) return edges;
        try {
            var root = AutomationElement.FromHandle(desktop);
            var items = root.FindAll(TreeScope.Children,
                new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.ListItem));
            for (int i = 0; i < items.Count && edges.Count < 300; i++) {
                try {
                    var item = items[i];
                    if (item.Current.IsOffscreen) continue;
                    var tile = item.Current.BoundingRectangle;
                    if (tile.IsEmpty || tile.Width < 12 || tile.Height < 12) continue;
                    // Explorer exposes a tile including the label; use its upper icon area.
                    double iconWidth = Math.Min(tile.Width, tile.Height * 0.72);
                    double insetX = (tile.Width - iconWidth) * 0.5;
                    double insetY = Math.Min(tile.Height * 0.06, 6);
                    long id = -17;
                    foreach (int part in item.GetRuntimeId()) id = unchecked(id * 31 - part);
                    edges.Add(new Edge {
                        id = -10000 - (id & 0x7FFFFFFF),
                        x = (int)Math.Round(tile.X + insetX),
                        y = (int)Math.Round(tile.Y + insetY),
                        width = (int)Math.Round(iconWidth),
                        height = (int)Math.Round(tile.Height - insetY),
                        desktopItem = true,
                        finderIcon = true
                    });
                } catch (ElementNotAvailableException) {}
            }
        } catch (ElementNotAvailableException) {}
          catch (InvalidOperationException) {}
          catch (COMException) {}
        return edges;
    }
}
'@
if ($Check) {
    [void][WindowEdges]::Read($OverlayPid)
    [void][WindowEdges]::ReadDesktop()
    return
}
$icons = @()
$lastRead = [DateTime]::MinValue
while ($true) {
    $now = [DateTime]::UtcNow
    if (($now - $lastRead).TotalMilliseconds -ge 750) {
        $icons = @([WindowEdges]::ReadDesktop())
        $lastRead = $now
    }
    $edges = @([WindowEdges]::Read($OverlayPid)) + $icons
    [Console]::WriteLine((ConvertTo-Json -InputObject $edges -Compress))
    Start-Sleep -Milliseconds 120
}
