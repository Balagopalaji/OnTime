# Show Control Architecture (StageTime)

## 1. Overview
This document defines the architecture for integrating "Show Control" features (PowerPoint tracking, external video monitoring) into the OnTime ecosystem. The core principle is a **Dual-Timer System** where "Live Cues" from the environment run in parallel with the Main Stage Timer.

## 2. Core Concepts

### 2.1 Dual-Timer System
*   **Main Timer (Stage Focused):**
    *   Controlled by the Rundown.
    *   Displayed on the Main Stage View (for Speakers).
    *   Represents the "Session Time" (e.g., "Sermon: 45:00").
*   **Live Cue Timer (Tech Focused):**
    *   Driven by the Companion App (Sensors).
    *   Displayed on the Operator Dashboard (PiP) and Tech Viewers.
    *   Represents "Media Time" (e.g., "Intro Video: 2:34").

### 2.2 The Companion App
A lightweight desktop application (Electron) that runs on the operator's machine.
*   **Role:** Sensor & Bridge.
*   **Connectivity:** Runs a local WebSocket server (`ws://localhost:xxxx`).
*   **Responsibilities:**
    *   Monitor PowerPoint (COM API).
    *   Monitor Video Players.
    *   Emit standardized JSON events to the OnTime Web Client.

## 3. Data Model Updates

### 3.1 Room State Extension (Modular Design)
We separate **Room configuration** (tier, features) from **RoomState** (real-time timer data) to minimize unnecessary syncs.

**Room Configuration** (rarely updated): `/rooms/{roomId}`
```typescript
interface Room {
  id: string;
  name: string;
  ownerId: string;
  tier: 'basic' | 'show_control' | 'production';
  features: {
    localMode: boolean;
    showControl: boolean;
    powerpoint: boolean;
    externalVideo: boolean;
  };
}
```

**Room State** (updates every second): `/rooms/{roomId}/state/current`
```typescript
interface RoomState {
  // Core timer state (all tiers)
  activeTimerId: string | null;
  isRunning: boolean;
  currentTime: number;
  lastUpdate: number;

  // Lightweight reference (Show Control+ only)
  activeLiveCueId?: string;  // 10-50 bytes vs 2-5 KB for full object
}
```

**Live Cue Data (Subcollection): `/rooms/{roomId}/liveCues/{cueId}`**
```typescript
interface LiveCue {
  id: string;
  source: 'powerpoint' | 'external_video' | 'pdf';
  title: string;
  duration: number;
  startedAt: number;
  status: 'playing' | 'paused';
  
  config?: {
    warningSec?: number;
    criticalSec?: number;
  };
  
  metadata: {
    slideNumber?: number;
    totalSlides?: number;
    slideNotes?: string;
    filename?: string;
    player?: string;
    parentTimerId?: string;
    autoAdvanceNext?: boolean;
  };
}
```

**Sync Strategy:**
- `Room` config: Read once on page load (~200 bytes)
- `RoomState`: Updates every second (~100 bytes)
- `LiveCue`: Only queried when `activeLiveCueId` is set AND user has Show Control tier
- **Result:** Basic tier users sync ~100 bytes/sec vs ~5 KB/sec in monolithic design

### 3.2 Timer Schema Extension
We extend `Timer` to support pre-planned cues and specific configs.

```typescript
interface Timer {
  // ... existing fields

  // NEW: Optional per-timer config overrides
  config?: {
    warningSec?: number;
    criticalSec?: number;
  };
  
  // NEW: Associated media/cues for this segment
  cues?: {
    id: string;
    type: 'slide' | 'video' | 'note';
    position: number;              // Slide number or timestamp
    title: string;
    duration?: number;             // For videos
    notes?: string;
    autoTrigger?: boolean;
  }[];
}
```

## 4. WebSocket Event Schema

### 4.1 Live Cue Created (Video Started)
Sent when the Companion detects media playback.

```json
{
  "type": "LIVE_CUE_CREATE",
  "source": "powerpoint",
  "isMain": false,
  "parentTimerId": "timer-session-2",
  "cue": {
    "id": "ppt-video-slide5",
    "title": "Intro Video (Slide 5)",
    "duration": 154,
    "startedAt": 1234567890,
    "status": "playing",
    "config": {
      "warningSec": 30,
      "criticalSec": 10
    },
    "metadata": {
      "slideNumber": 5,
      "totalSlides": 67,
      "videoFilename": "intro.mp4",
      "slideNotes": "Cue lights down at video end"
    }
  }
}
```

### 4.2 Presentation Update (Slide Change)
Sent when the slide changes but no video is playing.

```json
{
  "type": "PRESENTATION_UPDATE",
  "parentTimerId": "timer-session-2",
  "data": {
    "currentSlide": 23,
    "totalSlides": 67,
    "slideTitle": "Main Point 2",
    "slideNotes": "Wait for applause",
    "upcomingCues": [
      {
        "slideNumber": 28,
        "type": "video",
        "title": "Testimony Video",
        "duration": 135,
        "slidesAway": 5
      }
    ]
  }
}
```

### 4.3 Presentation Loaded (Pre-Show)
Sent when a presentation is opened, allowing OnTime to pre-populate the rundown.

```json
{
  "type": "PRESENTATION_LOADED",
  "slides": [
    { "number": 1, "title": "Welcome", "hasVideo": false },
    { "number": 5, "title": "Intro", "hasVideo": true, "videoDuration": 154 }
  ]
}
```

## 5. Sync Strategy

### 5.1 Controller (Web Client)
*   Connects to Companion via `ws://localhost:xxxx`.
*   **Handshake:** Receives Companion mode and capabilities (see `websocket-protocol.md`).
*   **UI Adaptation:** Disables PowerPoint features if Companion is in Minimal Mode.
*   Receives `LIVE_CUE_*` events.
*   Updates local state immediately (optimistic UI).
*   **Writes to Firestore:** The Controller acts as the gateway, committing the `activeLiveCueId` to `/rooms/{roomId}/state/current`.

### 5.2 Tech Viewers (Remote)
*   Connect to Firestore (Cloud).
*   Receive `liveCue` updates via standard snapshot listeners.
*   Latency: ~300-500ms (Acceptable for warning lights and general countdowns).

### 5.3 Local Viewers (Optional/Future)
*   For frame-accurate sync, a local viewer could connect directly to the Companion's WebSocket, bypassing the cloud.

## 6. UI Integration

### 6.1 Expanded Segment View
In the Rundown, active segments expand to reveal:
*   **Slide Tracker:** Current/Total slides, Notes.
*   **Media Timeline:** Embedded countdown for the active Live Cue.
*   **Visibility:** Only shown when `room.features.showControl === true` (Show Control tier+).

### 6.2 Dual-Header
The Controller header displays:
1.  **Main Timer (Left):** Large, standard.
2.  **Live Cue (Right/PiP):** Smaller, appears only when active AND `room.tier !== 'basic'`.

### 6.3 Viewer Roles
*   `.../view`: Main Stage Timer (Clean).
*   `.../view?role=tech`: Main Timer + Live Cue Overlay + Tech Messages (requires Show Control tier+).

### 6.4 Simple Mode (Basic Tier)
When `room.tier === 'basic'`:
*   Hides dual-header, cue management UI
*   Shows only main timer controls
*   Displays "Upgrade to Show Control" badge for advanced features

## 7. Pre-Show Workflow

### 7.1 Presentation Import
1.  Operator opens PowerPoint presentation.
2.  Companion detects and scans presentation.
3.  Emits `PRESENTATION_LOADED` event with slide/video metadata.
4.  OnTime shows notification: "Sermon.pptx detected (67 slides, 2 videos)".
5.  Operator clicks "Add to Rundown" → Creates Timer with pre-populated `cues[]`.

### 7.2 Video Library (External Media)
1.  Operator drags video files into OnTime.
2.  OnTime reads metadata (duration, resolution) via browser File API.
3.  Videos stored in local state (not uploaded to cloud).
4.  Operator adds videos to rundown as separate cues.

### 7.3 Cue Assignment
*   **Automatic:** Videos detected in PowerPoint → auto-assigned to parent Timer.
*   **Manual:** Operator can add/edit/delete cues in expanded segment view.
*   **Smart Matching:** If video plays but slide number differs, match by filename.

## 8. Error Handling

### 8.1 Companion Disconnect
*   **UI Indicator:** Show "⚠️ Companion Disconnected" in header.
*   **Behavior:** Live Cue countdown freezes, Main Timer unaffected.
*   **Recovery:** Auto-reconnect on Companion restart.

### 8.2 Multiple Presentations
*   **Detection:** Monitor foreground window title.
*   **Behavior:** Only track the active (foreground) presentation.
*   **Switching:** If operator switches presentations, update `PRESENTATION_UPDATE` events.

### 8.3 Slide Skip/Reorder
*   **Detection:** Video plays but slide number doesn't match expected cue position.
*   **Fallback:** Match by video filename instead of slide number.
*   **Manual Override:** Operator can manually trigger any cue via "Force Trigger" button.

## 9. Development Phases (Draft)

### Phase 1: Foundation (Companion App)
- [ ] Create `docs/show-control-architecture.md` (Done).
- [ ] Implement `CompanionDataProvider` stub in frontend.
- [ ] Define `RoomState.liveCue` and `Timer.cues` types in `frontend/src/types`.

### Phase 2: Basic Show Control
- [ ] Implement `LIVE_CUE_CREATE` event handler in `CompanionDataProvider`.
- [ ] Update `FirebaseDataContext` to merge local live cues with Firestore state.
- [ ] Build "Dual Header" UI in Controller (Main Timer + Live Cue PiP).
- [ ] Implement Tech Viewer role (`/view?role=tech`).

### Phase 3: Enhanced Show Control
- [ ] Implement `PRESENTATION_LOADED` handler to pre-populate `Timer.cues`.
- [ ] Build "Expanded Segment View" in Rundown (Slide Tracker + Media Timeline).
- [ ] Add "Live Tracking" toggle (Green/Gray) to Controller.
