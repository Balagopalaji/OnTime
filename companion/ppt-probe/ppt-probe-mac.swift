import Foundation
import ApplicationServices
import AppKit

/**
 * PPT-PROBE-MAC
 * A high-performance native bridge for PowerPoint on macOS.
 * Robustness Updated: Permission checking and prompting.
 */

struct VideoStatus: Codable {
    var name: String
    var duration: Int?
    var elapsed: Int?
    var playing: Bool = false
    var lastInteraction: Date?
    var lastSliderValue: Double?
    var lastTimeLabel: String?
    var noMotionCount: Int = 0
    var lastPauseSeen: Date?
    var wasPlayingMemory: Bool = false
}

struct PowerPointStatus: Codable {
    var state: String = "none"
    var instanceId: Int = 0
    var inSlideshow: Bool = false
    var slideNumber: Int?
    var totalSlides: Int?
    var pptPath: String?
    var videos: [VideoStatus] = []
    var error: String?
    var permissions: String = "unknown"
}

var videoHistory: [String: VideoStatus] = [:]
var hasPromptedForPermissions = false
let axDebugEnabled = ProcessInfo.processInfo.environment["PPT_AX_DEBUG"] == "1"
let hawkModeEnabled = ProcessInfo.processInfo.environment["PPT_HAWK_MODE"] == "1"

func getAllAttributes(_ element: AXUIElement) -> [String: String] {
    var results: [String: String] = [:]
    var names: CFArray?
    if AXUIElementCopyAttributeNames(element, &names) == .success, let nameArray = names as? [String] {
        for name in nameArray {
            var value: AnyObject?
            if AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success {
                results[name] = "\(value ?? "nil" as AnyObject)"
            }
        }
    }
    return results
}

func findHawkTarget(_ element: AXUIElement) -> AXUIElement? {
    var role: AnyObject?
    AXUIElementCopyAttributeValue(element, kAXRoleAttribute as CFString, &role)
    let roleStr = role as? String ?? ""
    
    var val: AnyObject?
    AXUIElementCopyAttributeValue(element, kAXValueAttribute as CFString, &val)
    let valueStr = val != nil ? "\(val!)" : "nil"
    
    if roleStr == "AXStaticText" && (
        valueStr.contains("Elapsed") || 
        valueStr.contains("0.0") || 
        valueStr.contains("0:0") ||
        valueStr.contains("/")
    ) {
        return element
    }

    var children: AnyObject?
    if AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &children) == .success {
        if let childrenArray = children as? [AXUIElement] {
            for child in childrenArray {
                if let found = findHawkTarget(child) { return found }
            }
        }
    }
    return nil
}

func normalizeAXText(_ text: String) -> String {
    return text.lowercased()
}

func parseDouble(_ value: AnyObject?, fallback: String) -> Double? {
    if let num = value as? NSNumber {
        return num.doubleValue
    }
    if let str = value as? String {
        return Double(str.replacingOccurrences(of: ",", with: "."))
    }
    return Double(fallback.replacingOccurrences(of: ",", with: "."))
}

func getAXBoolAttribute(_ element: AXUIElement, _ attribute: String) -> Bool? {
    var value: AnyObject?
    if AXUIElementCopyAttributeValue(element, attribute as CFString, &value) != .success {
        return nil
    }
    if let boolValue = value as? Bool {
        return boolValue
    }
    if let numValue = value as? NSNumber {
        return numValue.boolValue
    }
    if let strValue = value as? String {
        let normalized = strValue.lowercased()
        if normalized == "true" || normalized == "yes" || normalized == "1" { return true }
        if normalized == "false" || normalized == "no" || normalized == "0" { return false }
    }
    return nil
}

func getAXAttribute(_ element: AXUIElement, _ attribute: String) -> AnyObject? {
    var value: AnyObject?
    let result = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
    return (result == .success) ? value : nil
}

func shell(_ command: String) -> String? {
    let process = Process()
    process.launchPath = "/bin/zsh"
    process.arguments = ["-c", command]
    let pipe = Pipe()
    process.standardOutput = pipe
    process.launch()
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    return String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
}

func getDurationsFromSlideXML(path: String, slideIndex: Int) -> [String: Int] {
    let slideXmlPath = "ppt/slides/slide\(slideIndex).xml"
    let cmd = "unzip -p \"\(path)\" \"\(slideXmlPath)\" 2>/dev/null"
    guard let xml = shell(cmd) else { return [:] }
    
    var results: [String: Int] = [:]
    let namePattern = "name=\"([^\"]+)\""
    guard let nameRegex = try? NSRegularExpression(pattern: namePattern, options: []) else { return [:] }
    
    let matches = nameRegex.matches(in: xml, options: [], range: NSRange(location: 0, length: xml.count))
    for match in matches {
        guard let nameRange = Range(match.range(at: 1), in: xml) else { continue }
        let name = String(xml[nameRange])
        if name.contains("Slide Number") || name.contains("TextBox") || name.contains("Title") { continue }
        
        let searchRange = NSRange(location: 0, length: match.range.location)
        let idPattern = "id=\"([0-9]+)\""
        if let idRegex = try? NSRegularExpression(pattern: idPattern, options: []),
           let idMatch = idRegex.matches(in: xml, options: [], range: searchRange).last,
           let idValRange = Range(idMatch.range(at: 1), in: xml) {
            let shapeId = xml[idValRange]
            let durPattern = "dur=\"([0-9]+)\"((?!dur=).)*?<p:spTgt spid=\"\(shapeId)\""
            if let durRegex = try? NSRegularExpression(pattern: durPattern, options: [.dotMatchesLineSeparators]),
               let durMatch = durRegex.firstMatch(in: xml, options: [], range: NSRange(location: 0, length: xml.count)),
               let durValRange = Range(durMatch.range(at: 1), in: xml),
               let dur = Int(xml[durValRange]) {
                results[name] = dur
            }
        }
    }
    return results
}

func crawlForData(
    _ element: AXUIElement,
    foundNames: inout Set<String>,
    isPlaying: inout Bool,
    foundSliders: inout [Double],
    foundLabels: inout [String],
    sawPauseLabel: inout Bool,
    sawPlayLabel: inout Bool
) {
    let role = getAXAttribute(element, kAXRoleAttribute) as? String ?? ""
    let title = getAXAttribute(element, kAXTitleAttribute) as? String ?? ""
    let desc = getAXAttribute(element, kAXDescriptionAttribute) as? String ?? ""
    let roleDesc = getAXAttribute(element, "AXRoleDescription" as String) as? String ?? ""
    let subrole = getAXAttribute(element, kAXSubroleAttribute) as? String ?? ""
    let value = getAXAttribute(element, kAXValueAttribute)
    
    let valueStr = (value as? String) ?? ""
    let combinedText = [title, desc, valueStr].joined(separator: " ")

    // Video Shape Detection
    let isVideoShape = (role == "AXLayoutArea" && roleDesc == "Video") || 
                       (role == "AXImage" && roleDesc == "Video") ||
                       (role == "AXLayoutArea" && combinedText.contains("Video"))

    if isVideoShape && !title.isEmpty && !title.contains("Slide") {
        foundNames.insert(title)
    }
    
    if axDebugEnabled && isVideoShape {
        fputs("AX_VIDEO_SHAPE: role='\(role)' roleDesc='\(roleDesc)' title='\(title)' desc='\(desc)'\n", stderr)
    }
    
    // Slider detection: Heuristic for "playing"
    if role == "AXSlider" || role == "AXProgressIndicator" || role == "AXValueIndicator" {
        if let sliderVal = parseDouble(value, fallback: valueStr) {
            foundSliders.append(sliderVal)
            if axDebugEnabled {
                fputs("AX_SLIDER: role='\(role)' title='\(title)' desc='\(desc)' value=\(sliderVal)\n", stderr)
            }
        }
    }

    // Time label detection: "0:05 / 2:30" or just "0:05"
    if role == "AXStaticText" || role == "AXLabel" {
        if combinedText.contains(":") && combinedText.count >= 4 && combinedText.count <= 15 {
            foundLabels.append(combinedText)
            if axDebugEnabled {
                fputs("AX_LABEL: value='\(combinedText)' role='\(role)'\n", stderr)
            }
        }
    }
    
    if role == "AXButton" || subrole == "AXToggleButton" || role == "AXCheckBox" {
        let combined = normalizeAXText([title, desc, roleDesc, valueStr].joined(separator: " "))
        let isMedia = combined.contains("play") || combined.contains("pause") || combined.contains("resume") || combined.contains("video")
        
        if axDebugEnabled && (isMedia || role == "AXButton") {
            fputs("AX_DISCOVERY: role='\(role)' subrole='\(subrole)' roleDesc='\(roleDesc)' title='\(title)' desc='\(desc)' combined='\(combined)' value='\(valueStr)'\n", stderr)
        }

        if combined.contains("pause") {
            isPlaying = true
            sawPauseLabel = true
        } else if combined.contains("play") || combined.contains("resume") {
            sawPlayLabel = true
        }
    }

    var children: AnyObject?
    if AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &children) == .success {
        if let childrenArray = children as? [AXUIElement] {
            for child in childrenArray {
                crawlForData(
                    child,
                    foundNames: &foundNames,
                    isPlaying: &isPlaying,
                    foundSliders: &foundSliders,
                    foundLabels: &foundLabels,
                    sawPauseLabel: &sawPauseLabel,
                    sawPlayLabel: &sawPlayLabel
                )
            }
        }
    }
}

func updateEstimation(
    status: inout PowerPointStatus,
    pptPath: String,
    foundSliders: [Double],
    foundLabels: [String],
    sawPauseLabel: Bool,
    sawPlayLabel: Bool
) {
    var updatedVideos: [VideoStatus] = []
    let now = Date()
    
    if pptPath.hasPrefix("https") {
        status.error = "Cloud paths (OneDrive) not yet supported for duration extraction. Please use a local copy."
    }

    var durations: [String: Int] = [:]
    if let slideIdx = status.slideNumber, !pptPath.isEmpty && !pptPath.hasPrefix("https") {
        durations = getDurationsFromSlideXML(path: pptPath, slideIndex: slideIdx)
    }

    let isPlayingGlobal = status.videos.first?.playing ?? false
    let currentSlider = foundSliders.first
    let currentLabel = foundLabels.first
    let isForeground = status.state == "foreground"

    var finalNamesInput = status.videos.map { $0.name }.filter { !$0.isEmpty && $0 != "active_video" }
    
    if finalNamesInput.isEmpty && !durations.isEmpty {
        finalNamesInput = Array(durations.keys).sorted()
    } else if finalNamesInput.isEmpty {
        finalNamesInput = ["active_video"]
    }

    for name in finalNamesInput {
        var v = VideoStatus(name: name)
        v.duration = durations[name]
        
        let history = videoHistory[name]
        
        // --- Heuristic: Slider movement detection ---
        var sliderPlaying = false
        if let h = history, let lastVal = h.lastSliderValue, let currVal = currentSlider {
            if abs(currVal - lastVal) > 0.0001 {
                sliderPlaying = true
            }
        }
        
        // --- Heuristic: Label change detection ---
        var labelPlaying = false
        if let h = history, let lastLab = h.lastTimeLabel, let currLab = currentLabel {
            if lastLab != currLab {
                labelPlaying = true
            }
        }
        
        let motionDetected = sliderPlaying || labelPlaying
        let pauseSeenRecently = history?.lastPauseSeen != nil
          ? now.timeIntervalSince(history?.lastPauseSeen ?? now) < 5.0
          : false
        if !isForeground {
            // Focus Mirroring: PowerPoint pauses when backgrounded.
            // If we were playing, save memory to auto-resume later.
            if let h = history, h.playing {
                v.playing = false
                v.wasPlayingMemory = true
                if axDebugEnabled { fputs("PROBE_EST: \(name) Focus Mirroring (Pause on Background)\n", stderr) }
            } else {
                v.playing = false
                v.wasPlayingMemory = history?.wasPlayingMemory ?? false
            }
            v.noMotionCount = 0
        } else if sawPauseLabel || motionDetected || pauseSeenRecently {
            v.playing = true
            v.noMotionCount = 0
            if sawPauseLabel { v.lastPauseSeen = now }
            v.wasPlayingMemory = false // Manual or detected play resets memory
        } else if history?.wasPlayingMemory == true {
            // Focus Mirroring: Auto-resume on return to foreground
            v.playing = true
            v.wasPlayingMemory = false
            if axDebugEnabled { fputs("PROBE_EST: \(name) Focus Mirroring (Resume on Foreground)\n", stderr) }
        } else if history?.playing == true {
            v.noMotionCount = (history?.noMotionCount ?? 0) + 1
            if sawPlayLabel && v.noMotionCount >= 3 {
                v.playing = false
            } else {
                v.playing = v.noMotionCount < 3
            }
            v.wasPlayingMemory = false
        } else {
            v.playing = false
            v.noMotionCount = 0
            v.wasPlayingMemory = false
        }
        v.lastSliderValue = currentSlider ?? history?.lastSliderValue
        v.lastTimeLabel = currentLabel ?? history?.lastTimeLabel
        
        if axDebugEnabled {
            fputs("PROBE_EST: \(name) playing=\(v.playing) (global=\(isPlayingGlobal) slider=\(sliderPlaying) label=\(labelPlaying) pauseRecently=\(pauseSeenRecently) pauseNow=\(sawPauseLabel) playLabel=\(sawPlayLabel)) sliderVal=\(currentSlider ?? -1) label='\(currentLabel ?? "")'\n", stderr)
        }

        if v.playing {
            if let h = history, h.playing, let last = h.lastInteraction {
                let delta = Int(now.timeIntervalSince(last) * 1000)
                if delta > 10000 {
                    // Huge gap (>10s); probably app suspension/sleep.
                    // Keep previous elapsed.
                    v.elapsed = (h.elapsed ?? 0)
                    if axDebugEnabled { fputs("PROBE_EST: \(name) HUGE_DELTA(\(delta)), pausing timer\n", stderr) }
                } else {
                    v.elapsed = (h.elapsed ?? 0) + delta
                }
            } else {
                // Event: START
                if axDebugEnabled { fputs("EVENT: START name='\(name)' duration=\(v.duration ?? -1)\n", stderr) }
                
                // If we were stuck at duration, reset to 0 when we start playing again (loop/restart)
                if let h = history, let dur = v.duration, (h.elapsed ?? 0) >= dur {
                   v.elapsed = 0
                } else {
                   v.elapsed = (history?.elapsed ?? 0)
                }
            }
            v.lastInteraction = now
        } else {
            if let h = history, h.playing {
                // Event: STOP
                if axDebugEnabled { fputs("EVENT: STOP name='\(name)' elapsed=\(h.elapsed ?? 0)\n", stderr) }
            }
            v.elapsed = (history?.elapsed ?? 0)
            v.lastInteraction = nil
        }
        
        if let dur = v.duration, let elap = v.elapsed, elap >= dur {
            v.elapsed = v.playing ? 0 : dur
        }
        
        if axDebugEnabled {
            fputs("PROBE_EST: \(name) elapsed=\(v.elapsed ?? 0) duration=\(v.duration ?? -1)\n", stderr)
        }

        videoHistory[name] = v
        updatedVideos.append(v)
    }
    
    status.videos = updatedVideos
}

func printStatus(_ status: PowerPointStatus) {
    if let jsonData = try? JSONEncoder().encode(status),
       let jsonString = String(data: jsonData, encoding: .utf8) {
        print(jsonString)
        fflush(stdout)
    }
}

// --- Background Stdin Watcher (Zombie Protection) ---
let queue = DispatchQueue(label: "stdin-watcher", attributes: .concurrent)
queue.async {
    _ = fgetc(stdin)
    exit(0)
}

func checkPermissions() -> Bool {
    let trusted = AXIsProcessTrusted()
    if !trusted && !hasPromptedForPermissions {
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true]
        AXIsProcessTrustedWithOptions(options as CFDictionary)
        hasPromptedForPermissions = true
    }
    return trusted
}

func poll() {
    var status = PowerPointStatus()
    
    // Detect PowerPoint process first so we can report the PID even if permissions are missing.
    // This allows the Electron app to match the probe with the process and show proper errors.
    let apps = NSWorkspace.shared.runningApplications
    if let pptApp = apps.first(where: { $0.bundleIdentifier == "com.microsoft.Powerpoint" }) {
        status.instanceId = Int(pptApp.processIdentifier)
        status.state = pptApp.isActive ? "foreground" : "background"
    }
    
    status.permissions = checkPermissions() ? "granted" : "missing"
    if status.permissions == "missing" {
        status.error = "Accessibility permissions missing. Please grant them in System Settings."
        printStatus(status)
        return
    }

    guard let pptApp = apps.first(where: { $0.bundleIdentifier == "com.microsoft.Powerpoint" }) else {
        status.state = "none"
        printStatus(status)
        return
    }
    status.instanceId = Int(pptApp.processIdentifier)
    status.state = pptApp.isActive ? "foreground" : "background"
    
    let script = """
    tell application "Microsoft PowerPoint"
        try
            if (count of slide show windows) > 0 then
                set win to slide show window 1
                set v to slide show view of win
                set idx to current show position of v
                set total to count of slides of active presentation
                set pathStr to full name of active presentation
                return {true, idx, total, pathStr}
            else
                return {false, 0, 0, ""}
            end if
        on error err
            return {false, 0, 0, err}
        end try
    end tell
    """
    let appleScript = NSAppleScript(source: script)
    var error: NSDictionary?
    if let result = appleScript?.executeAndReturnError(&error) {
        status.inSlideshow = (result.atIndex(1)?.booleanValue ?? false)
        if status.inSlideshow {
            status.slideNumber = Int(result.atIndex(2)?.int32Value ?? 0)
            status.totalSlides = Int(result.atIndex(3)?.int32Value ?? 0)
            let pathStr = result.atIndex(4)?.stringValue ?? ""
            status.pptPath = pathStr
            
            var foundNames = Set<String>()
            var isPlaying = false
            var foundSliders: [Double] = []
            var foundLabels: [String] = []
            var sawPauseLabel = false
            var sawPlayLabel = false
            
            let appElement = AXUIElementCreateApplication(pptApp.processIdentifier)
            var windows: AnyObject?
            let result = AXUIElementCopyAttributeValue(appElement, kAXWindowsAttribute as CFString, &windows)

            if hawkModeEnabled {
                fputs("🎯 HAWK MODE: Searching for Timing Element...\n", stderr)
                var targetElement: AXUIElement?
                if result == .success, let windowArray = windows as? [AXUIElement] {
                    for window in windowArray {
                        if let found = findHawkTarget(window) {
                            targetElement = found
                            break
                        }
                    }
                }
                
                if let target = targetElement {
                    fputs("🎯 TARGET FOUND! Watching for ANY change in attributes. Start video now...\n", stderr)
                    var lastSnapshot = getAllAttributes(target)
                    while true {
                        let currentSnapshot = getAllAttributes(target)
                        for (name, val) in currentSnapshot {
                            if let lastVal = lastSnapshot[name], lastVal != val {
                                fputs("🔥 CHANGE DETECTED: [\(name)] OLD: \(lastVal) NEW: \(val)\n", stderr)
                            }
                        }
                        lastSnapshot = currentSnapshot
                        Thread.sleep(forTimeInterval: 0.1)
                    }
                } else {
                    fputs("❌ HAWK MODE: Could not find element with 'Elapsed Time' or '0.00'.\n", stderr)
                }
            }

            if result == .success, let windowArray = windows as? [AXUIElement], !windowArray.isEmpty {
                for window in windowArray {
                    crawlForData(
                        window,
                        foundNames: &foundNames,
                        isPlaying: &isPlaying,
                        foundSliders: &foundSliders,
                        foundLabels: &foundLabels,
                        sawPauseLabel: &sawPauseLabel,
                        sawPlayLabel: &sawPlayLabel
                    )
                }
            } else {
                // AX Blindness: If we can't see windows (app in background), trust the history.
                isPlaying = videoHistory.values.contains { $0.playing }
                if axDebugEnabled && isPlaying {
                    fputs("PROBE_POLL: AX Blindness (no windows), maintaining playing state\n", stderr)
                }
            }
            status.videos = []
            for name in foundNames {
                status.videos.append(VideoStatus(name: name, playing: isPlaying))
            }
            
            // Virtual Video Fallback: If we see media controls but no "Video" shape, insert a virtual one.
            if status.videos.isEmpty && (sawPauseLabel || sawPlayLabel || !foundSliders.isEmpty) {
                if axDebugEnabled { fputs("PROBE_POLL: No video shape found, inserting virtual 'active_video'\n", stderr) }
                status.videos.append(VideoStatus(name: "active_video", playing: isPlaying))
            }
            updateEstimation(
                status: &status,
                pptPath: pathStr,
                foundSliders: foundSliders,
                foundLabels: foundLabels,
                sawPauseLabel: sawPauseLabel,
                sawPlayLabel: sawPlayLabel
            )
        }
    }
    printStatus(status)
}

let pollInterval: TimeInterval = 0.5
while true {
    poll()
    Thread.sleep(forTimeInterval: pollInterval)
}
