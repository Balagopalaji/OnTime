# OnTime

**Live event timer and presentation-follow app** — real-time multi-timer control with cloud and LAN viewer surfaces, an Electron desktop controller, and a Companion app for PowerPoint/local integration.

This is an advanced prototype and interview-demo project. The current branch intentionally narrows scope to stabilize the timer/viewer experience end-to-end, rather than ship a full show-control suite.

---

## What it does

- **Multi-timer rundown** — create, reorder, and run multiple countdown timers from a controller interface
- **Cloud viewer** — shareable public URL backed by Firestore; viewers see live timer state in real-time
- **LAN viewer** — served directly from the Companion app over HTTPS on the local network; no cloud dependency
- **Electron controller** — packaged desktop app wrapping the controller surface
- **Companion app** — local Electron bridge for PowerPoint slide/timing follow and LAN viewer hosting
- **Controller lock / takeover** — prevents concurrent edits; supports deliberate takeover flows
- **Sync arbitration** — robust client-side logic that reconciles cloud and local state with timestamp-based skew detection

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS |
| Realtime | Firebase Firestore (live listeners), Socket.IO |
| Auth / backend | Firebase Auth, Cloud Functions |
| Desktop | Electron (controller + Companion) |
| Testing | Vitest, Testing Library |

---

## Repo layout

```
frontend/     Web app — controller UI, viewer UI, shared context
companion/    Electron Companion app — LAN viewer server, PowerPoint bridge, local Socket.IO
controller/   Thin Electron wrapper for the controller surface
functions/    Firebase Cloud Functions
firebase/     Firestore security rules and emulator config
docs/         Architecture notes, PRDs, QA artifacts
```

---

## Architecture overview

```
Browser (controller)
  └── Firebase Firestore ──────────────────────────┐
                                                    │
Browser (cloud viewer)                              │  Firestore live listeners
  └── Firebase Firestore ──────────────────────────┤
                                                    │
Companion (Electron, local machine)                 │
  ├── Socket.IO server (:4000) ◄── controller ──── ┤
  ├── HTTPS viewer server (:4440)                   │
  │     └── Serves pre-built viewer bundle          │
  └── PowerPoint COM bridge (Windows) / AppleScript │
```

The frontend's `UnifiedDataContext` merges Firebase and Companion state using timestamp-based arbitration with a skew guard — preferring the most recent source and falling back gracefully when either is offline.

---

## Current demo scope

**Stable and demo-ready:**
- Multi-timer control with start / pause / reset / nudge / duration edit
- Public cloud viewer and LAN viewer (Companion-hosted, HTTPS)
- Controller lock and takeover flows
- PowerPoint slide follow via Companion (Windows and macOS)
- Companion pairing flow (LAN viewer access codes)
- Firestore security rules, token auth for Companion

**Intentionally out of scope for this demo cut:**
- Cue / show-control planner UI
- Broader phase-3 show-management surface area

---

## Local development

### Prerequisites

Copy the env template and fill in your Firebase project credentials:

```bash
cp frontend/.env.example frontend/.env.local
# edit frontend/.env.local with your VITE_FIREBASE_* values
```

### Frontend (web app)

```bash
cd frontend
npm install
npm run dev          # Vite dev server at localhost:5173
npm run test         # Vitest unit tests
npm run lint         # ESLint
npm run typecheck    # tsc strict check (some debt outside the demo cut)
```

### Companion (local bridge + LAN viewer)

```bash
cd companion
npm install
npm run dev          # Electron dev mode (hot reload)
```

> **Note:** `npm run dev` is fine for development iteration. For testing LAN viewer behavior end-to-end, use the packaged build (see below) — the viewer bundle path differs between dev and packaged modes.

---

## Build and deploy

### Hosted web app (Firebase Hosting)

The hosted app serves `frontend/dist` via Firebase Hosting.

```bash
cd frontend && npm run build
cd .. && firebase deploy --only hosting
```

### Companion (packaged desktop app)

The packaged Companion is the correct path for demo use — it bundles the LAN viewer at a versioned path, includes the PowerPoint bridge, and runs as a signed/self-contained app.

```bash
cd companion
npm run dist        # builds viewer bundle + TypeScript + electron-builder
                    # output: companion/dist_out/
```

> The LAN viewer is a **separate bundle** (`frontend/dist-viewer/`) built with a versioned base path. Running `npm run build` in `frontend/` does not update the LAN viewer — use `npm run dist` in `companion/` which handles both.

---

## Project status

This repo is a focused technical prototype demonstrating:

- Real-time state synchronization across multiple surfaces (cloud, LAN, local)
- Offline-tolerant client architecture with explicit arbitration
- Electron desktop packaging and local network integration
- Firebase security rules, token-based pairing, and role-aware viewer access

TypeScript strictness is enforced in the core data and context layers. There is acknowledged debt in peripheral areas outside the demo cut — `npm run typecheck` will surface it.
