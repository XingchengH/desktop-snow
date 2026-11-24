import ApplicationServices
import AppKit
import Foundation

let ownPID = Int(CommandLine.arguments[1])
let debugDesktop = ProcessInfo.processInfo.environment["DESKTOP_SNOW_DEBUG"] == "1"
var loggedDesktop = false
func axAttribute(_ element: AXUIElement, _ key: String) -> CFTypeRef? {
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, key as CFString, &value) == .success ? value : nil
}

func desktopIcons() -> [[String: Any]] {
    defer { loggedDesktop = true }
    if debugDesktop && !loggedDesktop {
        fputs("Finder accessibility trusted: \(AXIsProcessTrusted())\n", stderr)
    }
    guard AXIsProcessTrusted(),
          let finder = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.finder").first
    else { return [] }
    let app = AXUIElementCreateApplication(finder.processIdentifier)
    AXUIElementSetMessagingTimeout(app, 0.2)
    var result: [[String: Any]] = []
    var roles: [String: Int] = [:]
    func visit(_ element: AXUIElement, depth: Int) {
        guard depth < 6, result.count < 250 else { return }
        let role = axAttribute(element, kAXRoleAttribute) as? String
        if debugDesktop && !loggedDesktop { roles[role ?? "unknown", default: 0] += 1 }
        if role == "AXMenuBar" || role == "AXMenu" || role == "AXMenuItem" { return }
        let subrole = axAttribute(element, kAXSubroleAttribute) as? String
        let title = axAttribute(element, kAXTitleAttribute) as? String ?? ""
        if role == "AXWindow" && subrole != "AXDesktop" &&
            !["Desktop", "桌面"].contains(title) { return }
        if role == "AXImage" || role == "AXIcon" || subrole == "AXIcon" {
            guard let rawPosition = axAttribute(element, kAXPositionAttribute),
                  let rawSize = axAttribute(element, kAXSizeAttribute),
                  CFGetTypeID(rawPosition) == AXValueGetTypeID(),
                  CFGetTypeID(rawSize) == AXValueGetTypeID() else { return }
            var point = CGPoint.zero
            var size = CGSize.zero
            guard AXValueGetValue(rawPosition as! AXValue, .cgPoint, &point),
                  AXValueGetValue(rawSize as! AXValue, .cgSize, &size),
                  size.width >= 16, size.width <= 220, size.height >= 16, size.height <= 240
            else { return }
            // Finder exposes the icon tile, which is wider than its painted preview.
            let horizontalInset = min(12, size.width * 0.14)
            let topInset = min(6, size.height * 0.08)
            result.append(["id": -100000 - Int(CFHash(element) % 1_000_000_000),
                           "x": point.x + horizontalInset, "y": point.y + topInset,
                           "width": size.width - 2 * horizontalInset,
                           "height": size.height - topInset, "desktopItem": true,
                           "finderIcon": true])
            return
        }
        for child in axAttribute(element, kAXChildrenAttribute) as? [AXUIElement] ?? [] {
            visit(child, depth: depth + 1)
        }
    }
    visit(app, depth: 0)
    if result.isEmpty {
        for window in axAttribute(app, kAXWindowsAttribute) as? [AXUIElement] ?? [] {
            visit(window, depth: 0)
        }
    }
    if debugDesktop && !loggedDesktop { fputs("Finder roles: \(roles); icon surfaces: \(result.count)\n", stderr) }
    return result
}

var icons: [[String: Any]] = []
var nextIcons = Date.distantPast
while true {
    let windows = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID)
        as? [[String: Any]] ?? []
    let edges = windows.compactMap { window -> [String: Any]? in
        guard let layer = window[kCGWindowLayer as String] as? Int,
              window[kCGWindowOwnerPID as String] as? Int != ownPID,
              let id = window[kCGWindowNumber as String] as? Int,
              let bounds = window[kCGWindowBounds as String] as? [String: Any],
              let rect = CGRect(dictionaryRepresentation: bounds as CFDictionary) else { return nil }
        let owner = window[kCGWindowOwnerName as String] as? String ?? ""
        let widget = ["NotificationCenter", "Notification Center"].contains(owner)
            && layer < 0 && rect.width >= 80 && rect.width <= 520 && rect.height >= 70 && rect.height <= 520
        guard widget || (layer == 0 && rect.width >= 160 && rect.height >= 100) else { return nil }
        let surface = widget ? rect.insetBy(dx: 8, dy: 8) : rect
        return ["id": id, "x": surface.minX, "y": surface.minY,
                "width": surface.width, "height": surface.height, "desktopItem": widget]
    }
    if Date() >= nextIcons {
        icons = desktopIcons()
        nextIcons = Date().addingTimeInterval(1)
    }
    if let data = try? JSONSerialization.data(withJSONObject: edges + icons) {
        print(String(decoding: data, as: UTF8.self))
        fflush(stdout)
    }
    Thread.sleep(forTimeInterval: 0.12)
}
