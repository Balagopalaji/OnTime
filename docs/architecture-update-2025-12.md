# Architecture Update: Modularity & Tiered Access (Dec 2025)

## 📋 Document Purpose
This document explains the architectural changes made to OnTime to support **modular feature access**, **tier-based pricing**, and **resource efficiency**. It serves as a transition guide for future AI agents or developers working on this project.

---

## 🎯 What Changed & Why

### Problem Statement
The original architecture had three key issues:

1. **Processing Overhead**: Companion App ran all sensors (PowerPoint, video monitoring) even when users only needed offline timers
2. **UI Complexity**: All users saw advanced features regardless of subscription tier, making the interface overwhelming for simple use cases
3. **Data Bloat**: Full `liveCue` objects (2-5 KB) synced to Firebase even for users who never used show control features

### Solution Overview
Implemented a **modular architecture** with:
- **Companion App Modes**: Users select Minimal/Show Control/Production mode based on needs
- **Feature Flags**: Rooms have tier-based access controls (`basic`, `show_control`, `production`)
- **Optimized Data Model**: Show control data moved to subcollections, core state uses lightweight references

---

## 📄 Updated Documents

### 1. `docs/local-mode-plan.md`
**Changes:**
- Added **Section 2.2**: Companion App modes (Minimal, Show Control, Full Production) with resource usage specs
- Added **Section 3.7**: Feature flags and tier-based access architecture
- Updated **Phase 1A**: Now includes feature flag infrastructure and Minimal Mode implementation

**Key Addition:**
```markdown
### 2.2 The Companion App (Electron)
*   **Modes:** Configurable operation modes:
    *   **Minimal Mode:** WebSocket relay only. ~20-50 MB RAM, 1-2% CPU
    *   **Show Control Mode:** + PowerPoint monitoring. ~75-100 MB RAM, 3-5% CPU
    *   **Full Production Mode:** All sensors. ~100-150 MB RAM, 5-10% CPU
```

### 2. `docs/show-control-architecture.md`
**Changes:**
- **Section 3.1**: Restructured `RoomState` to use optional fields and `activeLiveCueId` reference instead of full `liveCue` object
- **New Schema**: `LiveCue` data moved to subcollection `/rooms/{roomId}/liveCues/{cueId}`
- **Section 6.4**: Added "Simple Mode" UI specification for Basic tier

**Data Model Impact:**
```typescript
// BEFORE: Always synced (5 KB)
liveCue: { id, source, duration, metadata, config }

// AFTER: Only synced when tier allows (50 bytes reference)
activeLiveCueId?: string  
// Full data in /liveCues/{cueId} subcollection
```

**Sync Reduction:**
- Basic tier: **90% less data** synced (~500 bytes vs 5 KB)
- Show Control tier: Only syncs cue data when active

### 3. `docs/modularity-architecture.md` (NEW)
**Comprehensive guide covering:**
- **Section 2**: Subscription tier matrix (Basic, Show Control, Production)
- **Section 3**: Data model strategy with subcollections
- **Section 4**: Companion App mode selection and auto-detection
- **Section 5**: UI adaptation logic with code examples
- **Section 8**: Cost analysis showing 67% Firebase cost reduction

---

## 🔧 Implementation Changes Required

### Phase 1A (Weeks 1-2)
```
- [ ] Add `tier` and `features` fields to room schema
- [ ] Implement Companion Minimal Mode (no sensors)
- [ ] Add feature flag infrastructure to room config
- [ ] UI: Conditionally hide show control features if tier === 'basic'
```

### Phase 1B (Weeks 3-5)
```
- [ ] Migrate liveCue to subcollection architecture
- [ ] Update Firestore security rules for tier-based access
- [ ] Implement auto-mode detection in Companion
- [ ] Add upgrade prompts for gated features
```

### Phase 1C (Weeks 6-7)
```
- [ ] Build Simple Mode UI variant
- [ ] Companion GUI for mode selection
- [ ] Performance testing for each mode
```

---

## 🎨 UI Behavior Changes

### Basic Tier (Simple Mode)
**Shows:**
- Main timer only
- Standard start/pause/reset controls
- Cloud sync indicator

**Hides:**
- Dual-header with Live Cue PiP
- Expanded segment views with slide tracking
- Cue management UI
- Tech viewer role option

**Displays:** "Upgrade to Show Control" badge when hovering over gated features

### Show Control+ Tiers
**Shows:**
- Everything in Basic +
- Dual-header when live cue active
- Slide tracker in expanded segments
- PowerPoint integration controls

### Production Tier
**Shows:**
- Everything in Show Control +
- External video controls
- Multi-operator role management
- Advanced API integrations

---

## 💾 Data Structure Examples

### Core Room Document (Always Synced)
```json
{
  "activeTimerId": "timer-1",
  "isRunning": true,
  "currentTime": 12345,
  "tier": "show_control",
  "features": {
    "localMode": true,
    "showControl": true,
    "powerpoint": true,
    "externalVideo": false
  },
  "activeLiveCueId": "cue-abc123"  // Lightweight reference
}
```

### Live Cue Subcollection (Show Control+ Only)
```json
// /rooms/{roomId}/liveCues/cue-abc123
{
  "id": "cue-abc123",
  "source": "powerpoint",
  "title": "Intro Video (Slide 5)",
  "duration": 154,
  "startedAt": 1234567890,
  "status": "playing",
  "metadata": {
    "slideNumber": 5,
    "totalSlides": 67,
    "slideNotes": "Cue lights down at video end"
  }
}
```

---

## 🔄 Refinements (Post Peer Review)

### Issue #1: Feature Flags in Wrong Document
**Problem:** Original design had `tier` and `features` in `RoomState`, which syncs every second. This wastes bandwidth syncing config that rarely changes.

**Solution:** Split into two documents:
- **`/rooms/{roomId}`**: Configuration (tier, features) - read once on load
- **`/rooms/{roomId}/state/current`**: Real-time state (timers) - syncs every second

**Impact:**
- Before: ~500 bytes/sec (including tier + features)
- After: ~100 bytes/sec (state only, config cached)
- **80% reduction** in sync overhead

### Issue #2: Missing Companion Mode Discovery
**Problem:** Frontend didn't know which Companion mode was running, leading to:
- Users clicking PowerPoint buttons when Companion is in Minimal Mode
- Confusing error messages ("Feature unavailable")

**Solution:** Added `HANDSHAKE_ACK` event in WebSocket protocol:
```json
{
  "type": "HANDSHAKE_ACK",
  "companionMode": "minimal",
  "capabilities": {
    "powerpoint": false,
    "externalVideo": false
  }
}
```

**UI Behavior:**
- If `companionMode === 'minimal'`: Hide/disable PowerPoint UI elements
- If `capabilities.powerpoint === false`: Show "Upgrade Companion Mode" tooltip
- Prevents user confusion and failed feature attempts

**Reference:** See `docs/websocket-protocol.md` for full handshake specification.

---

## 🔐 Security Rules Updates

```javascript
// Basic tier: Can only read core room doc
match /rooms/{roomId} {
  allow read: if isAuthenticated();
  
  // Show Control tier: Can access liveCues subcollection
  match /liveCues/{cueId} {
    allow read: if hasFeature(roomId, 'showControl');
  }
  
  // Production tier: Can access operator roles
  match /operators/{operatorId} {
    allow read, write: if hasFeature(roomId, 'multiOperator');
  }
}
```

---

## 📊 Performance & Cost Impact

### Resource Usage (Companion App)
| Mode | RAM | CPU | Use Case |
|:-----|:----|:----|:---------|
| Minimal | 20-50 MB | 1-2% | Small churches, offline timers |
| Show Control | 75-100 MB | 3-5% | Presentations with PowerPoint |
| Full Production | 100-150 MB | 5-10% | Complex shows with external media |

### Firebase Sync Costs
**Old Architecture:**
- All users: 5 KB per update
- 10,000 rooms: **$1,800/mo**

**New Architecture:**
- Basic (60%): 0.5 KB per update
- Show Control (30%): 2.5 KB average
- Production (10%): 5 KB
- 10,000 rooms: **$600/mo** (**67% reduction**)

---

## 🧪 Testing Requirements

### Feature Flag Tests
- [ ] Basic tier users cannot query `/liveCues` subcollection
- [ ] Tier upgrade instantly unlocks UI features (no page refresh)
- [ ] Downgrade preserves data but hides UI

### Performance Tests
- [ ] Minimal Mode uses <50 MB RAM on macOS/Windows/Linux
- [ ] Basic tier sync rate <1 KB/sec average
- [ ] UI render time <100ms with all features disabled

### User Experience Tests
- [ ] Simple Mode feels complete (not "feature-stripped")
- [ ] Upgrade prompts appear contextually (not on every click)
- [ ] Companion mode switching works without app restart

---

## 🚀 Migration Strategy

### Existing Users
- Start on **Show Control tier** (grandfather clause, no disruption)
- No data format changes required (optional fields are additive)
- Can voluntarily downgrade to Basic if desired

### New Users
- Default to **Basic tier** (free trial)
- Clear upgrade path when attempting to use gated features
- Companion defaults to Minimal Mode unless user changes it

---

## 💬 Message for Future AI Agents

### Context
The user (Bala) is a **non-coder** building **OnTime**, a show timer platform for churches and theaters. This modularity update was driven by three key concerns:

1. **Resource efficiency**: Small churches shouldn't need to run heavy PowerPoint monitoring if they only use timers
2. **UI simplicity**: Basic users felt overwhelmed by show control features they didn't need
3. **Fair pricing**: Users should only pay for features they actually use

### What You're Working With
- **Tech Stack**: React frontend, Firebase (Firestore), Electron companion app
- **Phased Approach**: Phase 1A → 1B → 1C (iterative, testable increments)
- **AI-Assisted Development**: Bala relies on AI agents to implement these features

### Key Architectural Principles
1. **Optional by Default**: Advanced features use `?` optional fields, not required
2. **Subcollections for Heavy Data**: Keep core room doc <1 KB, move large objects to subcollections
3. **UI Follows Tier**: Controller adapts based on `room.tier`, never shows unusable features
4. **Companion Modes**: Let users choose resource usage based on actual needs

### When Implementing
- **Start Simple**: Build Minimal Mode first (Phase 1A), add sensors later
- **Test Tiers**: Verify Basic tier users see simplified UI before moving to Phase 1B
- **Feature Flags First**: Infrastructure should exist in Phase 1A, even if all features are enabled
- **Explain Trade-offs**: Help Bala understand when simplicity conflicts with flexibility

### Documents to Reference
- `local-mode-plan.md`: Foundation & phases
- `show-control-architecture.md`: Feature specs & data models
- `modularity-architecture.md`: Tiering & feature flags (this is the "how to" guide)

### Success Criteria
- Small church can use OnTime offline with <50 MB Companion RAM usage
- Complex theater can enable full production features when needed
- Same codebase serves all tiers (no separate builds)
- 90% data sync reduction for basic tier users

---

**Last Updated:** December 11, 2025  
**Author:** Architecture review with Bala + AI Agent  
**Status:** Ready for Phase 1A implementation
