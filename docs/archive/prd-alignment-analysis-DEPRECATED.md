# ⚠️ DEPRECATED – PRD Alignment Analysis (December 2025)

This document is preserved for historical reference only and is **not** a source of truth. Current architecture and planning are defined in `docs/local-mode-plan.md` and related Phase 1D documents.

---

# PRD Alignment Analysis (December 2025)

## Summary
Both `frontend-prd.md` and `backend-prd.md` describe the **current MVP** (Firebase-only, no Companion App). They are **accurate for the existing system** but do not reflect Phase 1+ architecture changes.

## Recommendation
✅ **Keep PRDs as-is** - They serve as documentation of the current working system.
✅ **Phase 1 architecture documents supersede PRDs** for new implementation work.

---

## Detailed Analysis

### frontend-prd.md ✅ Current MVP

**What it describes:**
- Firebase-only React app (no Companion App)
- Controller (`/room/:roomId/control`) + Viewer (`/room/:roomId/view`)
- Data flow: `FirebaseDataContext` subscribes to `/rooms/{roomId}` and `/rooms/{roomId}/timers`

**Alignment with Phase 1:**
| Feature | PRD Scope | Phase 1 Adds | Status |
|:--------|:----------|:-------------|:-------|
| Timer sync | Firestore snapshots | + WebSocket relay via Companion | ✅ Documented in `local-mode-plan.md` |
| Data provider | `FirebaseDataContext` only | + `CompanionDataProvider` | ✅ Documented in `local-mode-plan.md` § 3.2 |
| UI modes | Single controller | + Simple Mode (Basic tier) | ✅ Documented in `modularity-architecture.md` § 5 |
| Show control | Not mentioned | PowerPoint, live cues (Phase 2) | ✅ Documented in `show-control-architecture.md` |

**Gaps (expected):**
- No mention of Companion App (doesn't exist in MVP)
- No tier-based UI adaptation (added in Phase 1B)
- No offline queue (added in Phase 1B)

**Verdict:** ✅ **PRD is correct for current system**. Phase 1 docs extend, not replace.

---

### backend-prd.md ✅ Current MVP

**What it describes:**
- Firestore data model: `/rooms/{roomId}` (monolithic document)
- Security rules: Public viewer read, owner-only write
- Timer sync algorithm using `startedAt` + `elapsedOffset`

**Alignment with Phase 1:**
| Aspect | PRD Design | Phase 1 Changes | Status |
|:-------|:-----------|:----------------|:-------|
| **Room document** | Monolithic (`/rooms/{roomId}` has all fields) | Split into config + state subcollections | ⚠️ Breaking change in Phase 1A |
| **Security rules** | Public read, owner write | + Tier-based access to subcollections | ⚠️ Update required in Phase 1B |
| **Timer algorithm** | `startedAt`/`elapsedOffset` | Same algorithm, but state moves to subcollection | ✅ Algorithm unchanged |
| **Real-time sync** | Firestore snapshots | + WebSocket for local mode | ✅ Firestore remains available as fallback |

**Critical Breaking Change:**
```diff
// Current MVP (backend-prd.md)
/rooms/{roomId} {
  ownerId, title, timezone,
  activeTimerId, isRunning, startedAt, elapsedOffset,
  message: { ... }
}

// Phase 1 (modularity-architecture.md)
/rooms/{roomId} {
  ownerId, title, tier, features  // Config only
}
/rooms/{roomId}/state/current {
  activeTimerId, isRunning, currentTime, lastUpdate
}
```

**Security Rules Update Required:**
```diff
// Current (backend-prd.md § 6)
match /rooms/{roomId} {
  allow read: if true;
  allow write: if isOwner(roomId);
}

// Phase 1 (local-mode-plan.md § 5.1)
match /rooms/{roomId} {
  allow read: if isAuthenticated();
  allow write: if isOwner(roomId);
  
+ match /state/current {
+   allow read: if isAuthenticated();
+   allow write: if isOwner(roomId);
+ }
+
+ match /liveCues/{cueId} {
+   allow read: if hasShowControlTier(roomId);
+   allow write: if isOwner(roomId) && hasShowControlTier(roomId);
+ }
}
```

**Verdict:** ✅ **PRD is correct for current system**. Phase 1A requires **data migration**.

---

## Migration Strategy

### Option A: Parallel Systems (Recommended)
- Keep existing MVP running on current data model
- New users or migrated rooms use Phase 1 data model
- Frontend detects which model via `_version` field

**Pros:** Zero downtime, gradual rollout
**Cons:** Temporary code complexity

### Option B: Big Bang Migration
- Schedule maintenance window
- Migrate all `/rooms/{roomId}` documents to new structure
- Deploy updated frontend + Companion simultaneously

**Pros:** Clean cutover
**Cons:** Risk of data loss, all users impacted

### Recommendation: **Option A** with these steps:
1. **Phase 1A:** Add `_version: 2` field to new rooms
2. **Frontend:** `if (room._version === 2) { useModularDataModel() } else { useLegacyModel() }`
3. **Phase 1B:** Background job migrates old rooms (opt-in first, then auto)
4. **Phase 2:** Deprecate legacy model after 90% migration

---

## PRD Update Recommendation

### Do NOT update PRDs
**Reason:** They document the current working system. Changing them creates confusion about what's deployed.

### Instead: Add Migration Section to architecture-update-2025-12.md
```markdown
## Migration from MVP to Phase 1

### Data Model Changes
[Include the diff above]

### Frontend Changes
[Document CompanionDataProvider addition]

### Backward Compatibility
[Explain _version detection]
```

---

## Action Items for Phase 1A

- [ ] Add `_version: 2` field to Room schema (modularity-architecture.md)
- [ ] Implement version detection in FirebaseDataContext
- [ ] Create migration script (Cloud Function or manual CLI tool)
- [ ] Update Firestore rules per local-mode-plan.md § 5.1
- [ ] Test with both legacy and new data models in parallel

---

## ✅ Conclusion

**PRDs are aligned** - They accurately describe the current MVP.

**Phase 1 architecture is ready** - All breaking changes documented.

**No PRD updates needed** - Keep them as historical reference. Phase 1 docs are the new source of truth for implementation.

**Next step:** Implement version detection and migration script during Phase 1A.

---

**Last Updated:** December 11, 2025
**Status:** Ready for Phase 1A implementation