# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OnTime is a show timer platform for churches and theaters with two apps:
- **Frontend**: React SPA for timer control and viewing
- **Companion**: Electron desktop app for local mode bridge

## Build & Run Commands

### Frontend (`/frontend`)
```bash
npm run dev        # Vite dev server (port 5173)
npm run build      # TypeScript + Vite production build
npm run lint       # ESLint
npm run test       # Vitest (run all tests)
npx vitest <file>  # Run single test file
```

### Companion (`/companion`)
```bash
npm run dev        # Electron dev mode
npm run build      # TypeScript compilation
npm run dist       # Package app (dmg/nsis/appimage)
```

## Architecture

### Operation Modes
The app supports three modes controlled by `AppModeContext`:
- **cloud**: Firebase only
- **local**: Companion app only
- **hybrid**: Companion preferred, Cloud fallback

### Data Flow
```
DataProvider
├── CompanionConnectionProvider  (WebSocket to localhost:4000)
├── AppModeProvider              (mode selection + cross-tab sync)
└── UnifiedDataProvider          (merges Cloud + Companion data)
    └── FirebaseDataProvider
```

`UnifiedDataContext` is the critical orchestration layer that:
- Tracks room authority (cloud/companion/pending)
- Caches room snapshots in localStorage (max 20 items)
- Queues events for offline support (max 100 items)
- Handles Socket.IO events from Companion

### Companion Communication
- WebSocket: `ws://localhost:4000` (Socket.IO)
- Token API: `http://127.0.0.1:4001/api/token` (loopback only)
- See `docs/websocket-protocol.md` for event specs

Key events: `JOIN_ROOM`, `TIMER_ACTION`, `ROOM_STATE_SNAPSHOT`, `ROOM_STATE_DELTA`, `CREATE_TIMER`, `UPDATE_TIMER`, `DELETE_TIMER`

### Firebase Structure
```
rooms/{roomId}/
├── timers/{timerId}
├── state/current
└── liveCues/{cueId}  (Show Control tier)
```

### Timer State Model
```typescript
// Time tracking uses elapsed offset + timestamp pattern:
currentTime: number    // elapsed ms at lastUpdate
lastUpdate: number     // timestamp when currentTime was recorded
startedAt: number      // when timer started (running only)
elapsedOffset: number  // base elapsed ms for paused state
```

## Timer Logic Guardrails
- `docs/timer-logic.md` is authoritative; align code and tests to it before changing timer behavior.
- Use shared helpers `frontend/src/utils/timer-utils.ts` for elapsed/nudge/progress; do not reimplement formulas or clamp elapsed (negative values represent bonus time).
- Timer actions (start/pause/reset/nudge/set active/duration edit) must update the full state tuple: `activeTimerId`, `isRunning`, `elapsedOffset/currentTime`, `startedAt`, `lastUpdate`, `progress`.
- Duration changes reset progress to `0` immediately (including active timer); rundown reorder must not alter elapsed.
- Run timer-focused tests (`useTimerEngine`, `snapshotStale`, related specs) plus `npm run lint && npm run test` before committing timer changes.

## Key Files

| Purpose | Location |
|---------|----------|
| Types (Timer, Room, RoomState) | `frontend/src/types/index.ts` |
| Firebase init | `frontend/src/lib/firebase.ts` |
| Data context interface | `frontend/src/context/DataContext.tsx` |
| Unified data orchestration | `frontend/src/context/UnifiedDataContext.tsx` |
| Companion connection | `frontend/src/context/CompanionConnectionContext.tsx` |
| Companion main process | `companion/src/main.ts` |
| Security rules | `firebase/firestore.rules` |

## Documentation

- Architecture overview: `docs/architecture-update-2025-12.md`
- WebSocket protocol: `docs/websocket-protocol.md`
- Product requirements: `docs/frontend-prd.md`, `docs/backend-prd.md`
- Local mode design: `docs/local-mode-plan.md`

## Environment Variables

Frontend (`.env.local`):
- `VITE_FIREBASE_*` - Firebase configuration
- `VITE_USE_FIREBASE_EMULATOR` - Enable emulator

Companion:
- `COMPANION_JWT_SECRET` - Override token secret
- `COMPANION_ALLOWED_ORIGINS` - CORS allowed origins

## Notes

- v2 is the current baseline (no v1 migration needed)
- Keep secrets in `.env.local`, never commit Firebase credentials
- Companion caches to `~/Library/Application Support/OnTime/cache/` (macOS)
