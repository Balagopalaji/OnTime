# macOS PowerPoint Video Timing Plan (Draft)

## Goal
Provide a reliable operator workflow for macOS PowerPoint video timing in a remote Companion setup, while acknowledging AX signal limitations.

## Current Constraints
- AX signals (Play/Pause, Time Display, Timeline) are intermittent and not universal.
- Multi-video slides lack reliable per-video motion anchors; Play/Pause appears global.
- PPTX duration is sometimes missing (`duration=-1`), especially with cloud paths.
- Background/foreground transitions can drop AX anchors.

## Known Problems & Unreliabilities
- Play/Pause AXButton does not always appear for click/space/arrow starts.
- AX Time Display and Timeline signals can be absent or delayed, especially with hidden controls.
- Multi-video slides cause global start/stop events that apply to all videos at once.
- Video elements can disappear from the AX tree mid-play, triggering fallback and frozen elapsed.
- Duration parsing fails when the PPTX file is inaccessible (cloud/OneDrive paths).
- Slide changes can interrupt AX signals before a Pause flip is observed.

## Proposed Strategy (Operator-First)
1. **Operator controls are primary**:
   - Manual play/pause button in Companion is the authoritative timer control.
   - AX signals are best-effort only and must not override operator intent.
2. **Keypress as candidate only**:
   - Space/arrow/clicker events are treated as candidate starts.
   - Confirm start only if AX Play/Pause flips or Time Display changes within a short window.
   - Keypress alone is not a valid start signal.
3. **Single-video focus (for now)**:
   - Single-video slides can use Play/Pause as a state anchor when present.
   - Multi-video slides should not attempt per-video elapsed timing.

## Data to Show Operators
- List detected video names on the current slide.
- Display durations when PPTX XML provides them.
- For multi-video slides: provide name + duration only; no elapsed unless a per-video motion anchor exists.

## Slide State Rules (macOS)
- Slide change = hard stop and reset of any local stopwatch.
- If video element disappears, freeze elapsed and wait to rebind.

## Remote Workflow Context
- Show laptop: PowerPoint is always foreground during presentation.
- Operator laptop: Remote Companion view controls timer and uses video list/durations as guidance.

## Open Questions to Finalize
- Confirmation window size for keypress + AX (suggest 250–500ms).
- Whether to allow tentative start if AX confirm is missing.
- How to signal "best-effort" vs "operator-controlled" state in UI/logs.
