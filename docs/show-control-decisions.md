# Show Control Decision Matrix

This document tracks key architectural decisions, open questions, and recommended approaches for the Show Control integration.

## 1. High Priority Decisions (Immediate Impact)

### 1.1 Pre-Show Presentation Import
**Question:** How do we get presentation metadata (slides, videos) into the OnTime Rundown?

| Option | Description | Pros | Cons | Recommendation |
| :--- | :--- | :--- | :--- | :--- |
| **A. Auto-Create** | System automatically creates a Timer segment when a presentation is detected. | Zero friction. | Clutters rundown if multiple PPTs open. | |
| **B. Manual Import** | Operator sees "Presentation Detected" notification and clicks "Add to Rundown". | Deliberate; prevents clutter. | One extra click. | **✅ Recommended** |
| **C. Drag-and-Drop** | Operator drags PPT file into OnTime window. | Familiar workflow. | Requires file access; harder with open files. | |

**Decision:** **Option B (Manual Import).** The Companion detects the open presentation and offers it to the operator.

### 1.2 Cue Timing Model
**Question:** How do we track when a cue "should" happen within a segment?

| Option | Description | Pros | Cons | Recommendation |
| :--- | :--- | :--- | :--- | :--- |
| **A. Position-Based** | Trigger based on Slide Number (e.g., "Slide 5"). | Accurate; robust to pacing changes. | Hard to predict "Time until video". | |
| **B. Time-Based** | Trigger based on estimated time (e.g., "03:22"). | Good for planning/countdown. | Fails if speaker is fast/slow. | |
| **C. Hybrid** | Primary trigger is Position; Time is estimated for display only. | Best of both worlds. | Slightly more complex data model. | **✅ Recommended** |

**Decision:** **Option C (Hybrid).** We use `position` (Slide #) as the source of truth for triggering, but calculate `estimatedTime` for the UI.

### 1.3 External Video Playback (MVP)
**Question:** How do we handle videos played outside of PowerPoint?

| Option | Description | Pros | Cons | Recommendation |
| :--- | :--- | :--- | :--- | :--- |
| **A. File-Based** | Operator clicks Play; OnTime opens file & starts timer. | Simple; works with any default player. | No pause/seek detection. | **✅ Recommended (Phase 1)** |
| **B. Player Integration** | Monitor VLC/mpv via API. | Accurate state tracking. | High complexity; player-specific. | **Phase 2+** |
| **C. Built-in Player** | OnTime plays video in browser. | Perfect sync. | Performance heavy; codec limits. | |

**Decision:** **Option A (File-Based Countdown).** For MVP, we trust the operator's "Play" action and assume continuous playback.

## 2. Medium Priority Decisions (Future Phases)

### 2.1 Multi-Operator Permissions
**Question:** Who can control the Main Timer vs. Live Cues?
*   **Recommendation:** **Role-Based.**
    *   **Show Caller:** Full control (Main + Cues).
    *   **Tech/Graphics:** Read-only Main; Write access to Live Cues (via Companion).

### 2.2 Companion App UI
**Question:** Should the Companion App have a visible window?
*   **Recommendation:** **Headless (System Tray) for Phase 1.** Add a "Status/Debug Window" in Phase 2 for troubleshooting connection issues.

### 2.3 Slide Note Parsing
**Question:** Should we auto-create cues from slide notes (e.g., "CUE: Lights")?
*   **Recommendation:** **Phase 2 Feature.** Start with manual cue creation to ensure reliability, then add "Smart Parsing" as an opt-in feature.

## 3. Error Handling Strategies

| Scenario | Strategy |
| :--- | :--- |
| **Companion Disconnect** | **Fail-Safe:** Main Timer continues. Live Cue freezes/disappears. UI shows warning. Auto-reconnect. |
| **Multiple PPTs** | **Active Window:** Only track the presentation in the foreground. |
| **Slide Skip** | **Smart Match:** If video plays but slide # mismatch, match by filename. |
