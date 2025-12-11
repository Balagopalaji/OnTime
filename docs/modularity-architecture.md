# Modularity & Feature Flag Architecture

## 1. Overview

This document defines how OnTime implements **modular feature access** to support:
- **Resource efficiency**: Users only run/sync features they need
- **UI simplicity**: Interface adapts to subscription tier
- **Fair pricing**: Pay for what you use

## 2. Tiered Feature Access

### 2.1 Subscription Tiers

| Tier | Price | Features | Companion Mode | UI Complexity |
|:-----|:------|:---------|:---------------|:--------------|
| **Basic** | $0-19/mo | Core timers, offline sync, cloud backup | Minimal (optional) | Simple controller |
| **Show Control** | $49-99/mo | + PowerPoint, live cues, dual-header | Show Control | Advanced controller |
| **Production** | $199+/mo | + External video, multi-operator, integrations | Full Production | Full feature set |

### 2.2 Feature Matrix

```typescript
interface RoomFeatures {
  // Core (all tiers)
  timers: boolean;              // Always true
  cloudSync: boolean;           // Always true
  
  // Local Mode (Basic+)
  localMode: boolean;           // Companion app support
  offlineMode: boolean;         // Offline queue & sync
  
  // Show Control (Show Control+)
  showControl: boolean;         // Live cue system
  powerpoint: boolean;          // PowerPoint monitoring
  slideTracking: boolean;       // Slide notes & previews
  
  // Production (Production tier only)
  externalVideo: boolean;       // Video player monitoring
  multiOperator: boolean;       // Role-based permissions
  advancedIntegrations: boolean; // API webhooks, custom sensors
}
```

## 3. Data Model Strategy

### 3.1 Core vs. Optional Data

**Room Configuration** (rarely changes): `/rooms/{roomId}`
```typescript
interface Room {
  id: string;
  name: string;
  ownerId: string;
  createdAt: number;
  
  // Subscription tier & features (changes rarely)
  tier: 'basic' | 'show_control' | 'production';
  features: {
    localMode: boolean;
    showControl: boolean;
    powerpoint: boolean;
    externalVideo: boolean;
  };
}
```

**Room State** (real-time, syncs constantly): `/rooms/{roomId}/state/current`
```typescript
interface RoomState {
  // Core timer state (all tiers)
  activeTimerId: string | null;
  isRunning: boolean;
  currentTime: number;
  lastUpdate: number;
  
  // Lightweight reference (Show Control+ only)
  activeLiveCueId?: string;  // 10 bytes vs 2-5 KB
}
```

**Why This Matters:**
- `Room` document: Read once on load, ~200 bytes
- `RoomState`: Updates every second, ~100 bytes (vs 5 KB in old architecture)
- Firestore charges per document write, not per byte - but smaller writes = faster sync

**Show Control Subcollection** (only synced when tier ≥ show_control): `/rooms/{roomId}/liveCues/{cueId}`
```typescript
{
  id: string;
  source: 'powerpoint' | 'external_video';
  duration: number;
  startedAt: number;
  metadata: { /* heavy data */ };
  config: { /* warnings, thresholds */ };
}
```

**Benefits:**
- Room config: Read once per session (~200 bytes)
- RoomState updates: ~100 bytes/sec (vs 5 KB in monolithic design)
- Live cues: Only synced when tier allows and cue is active
- **90% reduction** in total sync overhead

### 3.2 Firestore Security Rules

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /rooms/{roomId} {
      // Core room data: all tiers can read
      allow read: if isAuthenticated();
      allow write: if canEditRoom(roomId);
      
      // Live cues subcollection: Show Control tier+
      match /liveCues/{cueId} {
        allow read: if hasFeature(roomId, 'showControl');
        allow write: if hasFeature(roomId, 'showControl') && canEditRoom(roomId);
      }
      
      // Production features: Production tier only
      match /operators/{operatorId} {
        allow read, write: if hasFeature(roomId, 'multiOperator');
      }
    }
  }
}
```

## 4. Companion App Modes

### 4.1 Mode Selection

Users launch Companion with a specific mode based on their needs:

```bash
# Command line flags (or GUI selection on startup)
ontime-companion --mode=minimal        # Timers only
ontime-companion --mode=show-control   # + PowerPoint
ontime-companion --mode=production     # All sensors
```

### 4.2 Resource Usage

| Mode | Features Active | RAM | CPU | Use Case |
|:-----|:----------------|:----|:----|:---------|
| **Minimal** | WebSocket relay, state cache | 20-50 MB | 1-2% | Small church, offline timers |
| **Show Control** | + PowerPoint COM API monitoring | 75-100 MB | 3-5% | Presentations, slides |
| **Full Production** | + Video player monitoring, file ops | 100-150 MB | 5-10% | Theater, complex shows |

### 4.3 Auto Mode Detection

Companion can auto-select mode based on room tier:

```typescript
// On connection, Companion receives room config
socket.on('ROOM_CONFIG', (config) => {
  if (config.tier === 'basic') {
    companion.switchMode('minimal');
  } else if (config.tier === 'show_control') {
    companion.switchMode('show-control');
  } else {
    companion.switchMode('production');
  }
});
```

## 5. UI Adaptation

### 5.1 Controller UI Modes

**Basic Tier:**
```
┌─────────────────────────────────────┐
│ Main Timer  [00:45:23]              │  ← Clean, simple
│ [Start] [Pause] [Reset]             │
└─────────────────────────────────────┘
```

**Show Control Tier:**
```
┌─────────────────────────────────────┐
│ Main Timer          Live Cue (PiP)  │  ← Dual header
│ [00:45:23]          [Slide 5/67]    │
│                     [Video: 2:34]   │
│ ───────────────────────────────────  │
│ ▶ Segment 1: Sermon                 │  ← Expanded view
│   └ Slide 23/67: "Main Point 2"    │     with slide tracker
└─────────────────────────────────────┘
```

### 5.2 Conditional Rendering

```typescript
// React component example
function ControllerHeader({ room }) {
  const showDualHeader = room.tier !== 'basic' && room.features.showControl;
  
  return (
    <Header>
      <MainTimer />
      {showDualHeader && room.activeLiveCueId && (
        <LiveCuePiP cueId={room.activeLiveCueId} />
      )}
    </Header>
  );
}
```

### 5.3 Feature Upgrade Prompts

```typescript
// When user tries to use advanced feature
if (!room.features.showControl) {
  showUpgradeModal({
    feature: 'PowerPoint Integration',
    currentTier: 'basic',
    requiredTier: 'show_control',
    ctaText: 'Upgrade to Show Control'
  });
}
```

## 6. Implementation Phases

### Phase 1A: Foundation
- [ ] Add `tier` and `features` fields to room schema
- [ ] Implement Companion Minimal Mode
- [ ] Basic UI hiding for show control features

### Phase 1B: Subcollections
- [ ] Migrate `liveCue` to subcollection architecture
- [ ] Update Firestore security rules for tier-based access
- [ ] Implement feature detection in Companion (auto-mode)

### Phase 1C: UI Polish
- [ ] Build Simple Mode UI (Basic tier)
- [ ] Add upgrade prompts and tier badges
- [ ] Companion GUI for mode selection

## 7. Migration Strategy

### 7.1 Existing Users
- All existing users start on **Show Control tier** (grandfather clause)
- No data migration needed (optional fields are additive)
- Can downgrade to Basic if desired

### 7.2 New Data Structure
```typescript
// Old (Phase 0)
rooms/abc123: {
  liveCue: { /* 5 KB object */ }  // Always synced
}

// New (Phase 1B)
rooms/abc123: {
  activeLiveCueId: "cue-1"        // 50 bytes
}
rooms/abc123/liveCues/cue-1: {
  /* 5 KB object */               // Only synced if tier allows
}
```

## 8. Cost Analysis

### 8.1 Firebase Costs (per 1000 updates)

**Old Architecture:**
- All users sync full state: 5 KB × 1000 = **5 MB** → **$0.18/mo**

**New Architecture:**
- Basic users (60%): 0.5 KB × 600 = 0.3 MB → $0.01/mo
- Show Control (30%): 2.5 KB × 300 = 0.75 MB → $0.03/mo
- Production (10%): 5 KB × 100 = 0.5 MB → $0.02/mo
- **Total: $0.06/mo** (67% reduction)

### 8.2 Scaling Benefits
At 10,000 active rooms:
- Old: **$1,800/mo** in Firestore costs
- New: **$600/mo** (saves $1,200/mo)

## 9. Testing & Validation

### 9.1 Feature Flag Tests
- [ ] Basic tier users cannot access show control subcollections
- [ ] Tier upgrade instantly unlocks new UI features
- [ ] Downgrade hides features but preserves data

### 9.2 Performance Tests
- [ ] Companion Minimal Mode uses <50 MB RAM
- [ ] Basic tier sync rate <1 KB/sec average
- [ ] UI renders in <100ms with all features disabled

### 9.3 User Experience Tests
- [ ] Simple Mode UI feels natural (not "stripped down")
- [ ] Upgrade prompts are helpful, not annoying
- [ ] Companion mode switching works without restart
