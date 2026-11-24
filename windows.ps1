param([int]$OverlayPid)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class WindowEdges {
    public class Edge { public long id; public int x, y, width, height; }
    private struct Rect { public int Left, Top, Right, Bottom; }
    private delegate bool Visitor(IntPtr window, IntPtr data);
    [DllImport("user32.dll")] private static extern bool EnumWindows(Visitor visitor, IntPtr data);
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
}
'@
while ($true) {
    $edges = @([WindowEdges]::Read($OverlayPid))
    [Console]::WriteLine((ConvertTo-Json -InputObject $edges -Compress))
    Start-Sleep -Milliseconds 120
}
