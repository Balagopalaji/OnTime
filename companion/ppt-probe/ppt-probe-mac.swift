import Foundation
import ApplicationServices
import AppKit

/**
 * PPT-PROBE-MAC
 * A high-performance native bridge for PowerPoint on macOS.
 */

struct VideoStatus: Codable {
    var name: String
    var duration: Int?
    var elapsed: Int?
    var playing: Bool = false
    var lastInteraction: Date?
}

struct PowerPointStatus: Codable {
    var state: String = "none"
    var instanceId: Int = 0
    var inSlideshow: Bool = false
    var slideNumber: Int?
    var totalSlides: Int?
    var pptPath: String?
    var videos: [VideoStatus] = []
}

var videoHistory: [String: VideoStatus] = [:]

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
    
    // Find all p:cNvPr tags with a name
    let namePattern = "name=\"([^\"]+)\""
    guard let nameRegex = try? NSRegularExpression(pattern: namePattern, options: []) else { return [:] }
    
    let matches = nameRegex.matches(in: xml, options: [], range: NSRange(location: 0, length: xml.count))
    for match in matches {
        guard let nameRange = Range(match.range(at: 1), in: xml) else { continue }
        let name = String(xml[nameRange])
        
        // Skip common non-video names
        if name.contains("Slide Number") || name.contains("TextBox") || name.contains("Title") { continue }
        
        // Find ID
        let searchRange = NSRange(location: 0, length: match.range.location)
        let idPattern = "id=\"([0-9]+)\""
        if let idRegex = try? NSRegularExpression(pattern: idPattern, options: []),
           let idMatch = idRegex.matches(in: xml, options: [], range: searchRange).last,
           let idValRange = Range(idMatch.range(at: 1), in: xml) {
            let shapeId = xml[idValRange]
            
            // Find duration for this shapeId
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

func crawlForData(_ element: AXUIElement, foundNames: inout Set<String>, isPlaying: inout Bool) {
    let role = getAXAttribute(element, kAXRoleAttribute) as? String ?? ""
    let title = getAXAttribute(element, kAXTitleAttribute) as? String ?? ""
    let desc = getAXAttribute(element, kAXDescriptionAttribute) as? String ?? ""
    let roleDesc = getAXAttribute(element, "AXRoleDescription" as String) as? String ?? ""
    let value = getAXAttribute(element, kAXValueAttribute) as? String ?? ""

    if (role == "AXLayoutArea" && roleDesc == "Video") && !title.isEmpty && !title.contains("Slide") {
        foundNames.insert(title)
    }
    
    if role == "AXButton" {
        // Log all buttons to stderr for debugging
        fputs("BUTTON DEBUG: Title='\(title)' Desc='\(desc)' RoleDesc='\(roleDesc)' Val='\(value)'\n", stderr)
        
        if desc == "Pause" || roleDesc == "Pause" || title == "Pause" || value == "Pause" {
            isPlaying = true
        }
    }

    var children: AnyObject?
    if AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &children) == .success {
        if let childrenArray = children as? [AXUIElement] {
            for child in childrenArray {
                crawlForData(child, foundNames: &foundNames, isPlaying: &isPlaying)
            }
        }
    }
}

func updateEstimation(status: inout PowerPointStatus, pptPath: String) {
    var updatedVideos: [VideoStatus] = []
    let now = Date()
    
    // Get all valid durations for this slide
    var durations: [String: Int] = [:]
    if let slideIdx = status.slideNumber, !pptPath.isEmpty {
        var finalPath = pptPath
        if pptPath.contains("https://") {
            let demoPath = "/Users/radhabalagopala/Dev/OnTime/companion/docs/temp/videotest-local.pptx"
            if FileManager.default.fileExists(atPath: demoPath) { finalPath = demoPath }
        }
        durations = getDurationsFromSlideXML(path: finalPath, slideIndex: slideIdx)
    }

    // If we have names from AX, use them. Otherwise, if we found durations in XML, assume those are the videos.
    var finalNamesInput = status.videos.map { $0.name }.filter { !$0.isEmpty && $0 != "active_video" }
    let isPlayingGlobal = status.videos.first?.playing ?? false
    
    if finalNamesInput.isEmpty && !durations.isEmpty {
        finalNamesInput = Array(durations.keys)
    }

    for name in finalNamesInput {
        var v = VideoStatus(name: name)
        v.playing = isPlayingGlobal
        v.duration = durations[name]
        
        let history = videoHistory[name]
        if v.playing {
            if let h = history, h.playing, let last = h.lastInteraction {
                let delta = Int(now.timeIntervalSince(last) * 1000)
                v.elapsed = (h.elapsed ?? 0) + delta
            } else {
                v.elapsed = (history?.elapsed ?? 0)
            }
            v.lastInteraction = now
        } else {
            v.elapsed = (history?.elapsed ?? 0)
            v.lastInteraction = nil
        }
        
        if let dur = v.duration, let elap = v.elapsed, elap > dur { v.elapsed = dur }
        videoHistory[name] = v
        updatedVideos.append(v)
    }
    
    if updatedVideos.isEmpty {
        // Fallback: at least report SOMETHING if isPlaying is true
        updatedVideos.append(VideoStatus(name: "unknown_video", playing: isPlayingGlobal))
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

func poll() {
    var status = PowerPointStatus()
    let apps = NSWorkspace.shared.runningApplications
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
            
            let appElement = AXUIElementCreateApplication(pptApp.processIdentifier)
            var windows: AnyObject?
            AXUIElementCopyAttributeValue(appElement, kAXWindowsAttribute as CFString, &windows)
            if let windowArray = windows as? [AXUIElement] {
                for window in windowArray {
                    crawlForData(window, foundNames: &foundNames, isPlaying: &isPlaying)
                }
            }
            
            // Temporary video state to pass to updateEstimation
            status.videos = [VideoStatus(name: "active_video", playing: isPlaying)]
            for name in foundNames {
                status.videos.append(VideoStatus(name: name, playing: isPlaying))
            }
            
            updateEstimation(status: &status, pptPath: pathStr)
        }
    }
    printStatus(status)
}

let pollInterval: TimeInterval = 0.5
while true {
    poll()
    Thread.sleep(forTimeInterval: pollInterval)
}
