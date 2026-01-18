import Foundation
import ApplicationServices
import AppKit

func getAXAttribute(_ element: AXUIElement, _ attribute: String) -> AnyObject? {
    var value: AnyObject?
    AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
    return value
}

func dumpUI(_ element: AXUIElement, depth: Int = 0) {
    let role = getAXAttribute(element, kAXRoleAttribute) as? String ?? "Unknown"
    let title = getAXAttribute(element, kAXTitleAttribute) as? String ?? ""
    let desc = getAXAttribute(element, kAXDescriptionAttribute) as? String ?? ""
    let value = getAXAttribute(element, kAXValueAttribute)
    let enabled = (getAXAttribute(element, kAXEnabledAttribute) as? NSNumber)?.boolValue ?? true
    let identifier = getAXAttribute(element, "AXIdentifier") as? String ?? "None"
    let pressed = (getAXAttribute(element, "AXPressed") as? NSNumber)?.boolValue ?? false
    let selected = (getAXAttribute(element, "AXSelected") as? NSNumber)?.boolValue ?? false

    let indent = String(repeating: "  ", count: depth)
    let valueDesc = value != nil ? "\(value!)" : "nil"
    
    print("\(indent)[\(role)] title='\(title)' desc='\(desc)' identifier='\(identifier)' value='\(valueDesc)' enabled=\(enabled) pressed=\(pressed) selected=\(selected)")

    // Only dive deep into windows, groups, and playback-related containers
    var children: AnyObject?
    if AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &children) == .success {
        if let childrenArray = children as? [AXUIElement] {
            for child in childrenArray {
                dumpUI(child, depth: depth + 1)
            }
        }
    }
}

let apps = NSRunningApplication.runningApplications(withBundleIdentifier: "com.microsoft.Powerpoint")
guard let pptApp = apps.first else {
    print("Error: PowerPoint not running")
    exit(1)
}

print("--- DIAGNOSING POWERPOINT (PID: \(pptApp.processIdentifier)) ---")
let appElement = AXUIElementCreateApplication(pptApp.processIdentifier)

var windows: AnyObject?
if AXUIElementCopyAttributeValue(appElement, kAXWindowsAttribute as CFString, &windows) == .success {
    if let windowArray = windows as? [AXUIElement] {
        for (i, window) in windowArray.enumerated() {
            let winTitle = getAXAttribute(window, kAXTitleAttribute) as? String ?? "Untitled"
            print("\nWindow \(i): \(winTitle)")
            dumpUI(window)
        }
    }
} else {
    print("Error: Could not copy AXWindows. Check Accessibility permissions.")
}
