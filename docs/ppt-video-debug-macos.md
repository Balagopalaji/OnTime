# PowerPoint Video Timing Discovery (macOS)

## Purpose
Document the verified Accessibility (AX) signals in macOS PowerPoint for embedded video timing, and provide a reproducible audit trail. This is the source of truth for macOS discovery and should be used by agents to avoid drift.

## Scope
- Platform: macOS PowerPoint (slideshow playback)
- Goal: detect play/pause and derive elapsed time via stopwatch in `ppt-probe-mac.swift`
- Out of scope: Windows STA helper (`ppt-probe.exe`) and Windows COM shape enumeration

## Verified AX Signals (Hard Proof)
These signals are proven to exist in macOS PowerPoint via audited logs. Use them as anchors. Do not claim implementation usage unless verified in code.

### Hard Evidence (log lines)
- Play/Pause states observed: `AXButton` with `AXDescription` showing `Play` and `Pause` in separate log lines.
  - `ultimate_hawk.log:10` → `AXButton||Pause| -> VALUE: nil`
  - `ultimate_hawk.log:44` → `AXButton||Play| -> VALUE: nil`
- Timeline anchor: `AXScrollBar` with `AXDescription = "Timeline"`.
  - `ultimate_hawk.log:14` → `AXScrollBar||Timeline| -> VALUE: 0`
- Time Display: `AXStaticText` with `AXRoleDescription = "Time Display"` and `AXValue` containing elapsed seconds.
  - `role_desc_hunt.log:39` → `AXStaticText|Time Display||Rounded Rectangle|| -> VALUE: Elapsed Time: 0.00 seconds`
- Video container: `AXLayoutArea` with `AXRoleDescription = "Video"`.
  - `role_desc_hunt.log:33` → `AXLayoutArea|Video||3571264-uhd_3840_2160_30fps||`
- Disabled state: `AXEnabled = false` (corresponds to "disabled" text in Inspector).
  - `enabled_hunt.log:36` → `AXButton|||Play|| -> VALUE: nil|E:false`

### Evidence location
The logs used above should be regenerated via the steps below. Do not assume prior dumps exist in the workspace.

## Reproducibility (Hard Proof Audit)
Use these steps to reproduce the signals and capture auditable evidence:

### 1) Sign the Companion app (required for consistent AX access when using Applications build)
```
cd /Users/radhabalagopala/Dev/OnTime/companion
SIGN_IDENTITY="onTime Dev" npm run sign:installed
```

### 2) Build the probe helper
```
cd /Users/radhabalagopala/Dev/OnTime/companion
make clean && make
```

### 3) Run the hawk monitor (signal discovery)
```
PPT_HAWK_MODE=1 PPT_AX_DEBUG=1 PPT_HAWK_QUERY=play PPT_HAWK_ROLE=AXButton PPT_HAWK_DUMP=1 ./bin/ppt-probe-mac
```
Expected: HAWK output includes `AXDescription` changes from `Play` ↔ `Pause` with timestamps.

### 4) Run role-description discovery
```
PPT_AX_DEBUG=1 ./bin/ppt-probe-mac 2>&1 | grep -E "Time Display|Timeline|Video"
```
Expected: `AXStaticText|Time Display|...` and `AXScrollBar||Timeline|...` appear when video UI is visible.

### 5) Verify stopwatch behavior
```
PPT_AX_DEBUG=1 ./bin/ppt-probe-mac 2>&1 | grep -E "PROBE_EST: .*elapsed=|EVENT: START|EVENT: STOP"
```
Expected: `elapsed` increases while playing and holds when paused.

## Implementation Status (VERIFY IN CODE)
The logs prove the signals exist. Implementation usage must be verified in code at the time of review.

- **Locking on "Video"**: [L242](companion/ppt-probe/ppt-probe-mac.swift#L242)
- **Locking on "Time Display"**: [L260](companion/ppt-probe/ppt-probe-mac.swift#L260)
- **Locking on "Timeline"**: [L270](companion/ppt-probe/ppt-probe-mac.swift#L270)
- **Play/Pause Anchors**: [L300](companion/ppt-probe/ppt-probe-mac.swift#L300)

Do not assume full wiring without re-checking the current Swift helper implementation.

## Limitations & Proposed Resilience Strategy

### Observed Signal Behavior (Reactivity)
Observed in some runs (see Evidence): AX signals can be **reactive** and depend on the AX tree being "realized" by the system or user interaction.
- **Visible Controls**: Signals are most consistent when the mouse hovers and the video overlay is visible.
- **Hidden Controls**: If the video is playing but the overlay is hidden (common during spacebar or arrow-key interactions), `AXButton` and `Time Display` metadata can be absent from the tree.
- **State Reversion**: The probe can revert to `active_video` fallback when transient anchors disappear.

### Proposed Hybrid Resilience Model (Heuristic)
To improve robustness beyond reactive signals, the following strategy is proposed:

1. **Heuristic State Anchors**:
   - `Pause` button visible = treat as `isPlaying = true`.
   - `Play`/`Resume` button visible = treat as `isPlaying = false`.
2. **Supplemental Motion Anchors**:
   - `Time Display` value change = verify `isPlaying = true`.
   - `Timeline` scrollbar change = verify `isPlaying = true`.
3. **Slide State Fallback (Local Stopwatch)**:
   - On **Slide Change**: Reset stopwatch. If autoplay is suspected (via PPTX XML targets), start local estimation.
   - **Hard Stop**: Force `isPlaying = false` upon any detected slide transition.
4. **Drift Correction**:
   - Use `Time Display` values as anchor points to **correct** local stopwatch drift, rather than as the exclusive trigger.

### Caution
These behaviors are heuristic and not universal. Validate on the target deck and interaction path before relying on any single AX signal.

## Notes for Agents
- **Single-video slides only**: Current logic assumes one active video per slide. Multi-video behavior is not yet verified.
- Do not assume AX signals are universal. They are "Heuristic Anchors."
- Always verify the "Shy AX" paths: Spacebar start, Arrow-key advance, and Click-anywhere (off-control).
