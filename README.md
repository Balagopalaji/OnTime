# OnTime

**Live event timer and presentation-follow app** — real-time multi-timer control with cloud and LAN viewer surfaces, an Electron desktop controller, and a Companion app for PowerPoint/local integration.

This is an advanced prototype and active rebuild project. The current work is stabilizing the timer/viewer/Companion experience while extracting the large frontend and Companion god-files into tested packages and app-internal modules.

For the current rebuild state, start with:

- [`docs/rebuild-progress.md`](docs/rebuild-progress.md) — live rebuild ledger, landed PRs, next units, and baton policy
- [`docs/rebuild-extraction-rules.md`](docs/rebuild-extraction-rules.md) — extraction rules and stop conditions
- [`docs/rebuild-sixth-milestone-audit.md`](docs/rebuild-sixth-milestone-audit.md) — latest milestone audit snapshot

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
| Shared packages | npm workspaces under `packages/*` |
| Testing | Vitest, Testing Library |

---

## Repo layout

```
frontend/     Web app — controller UI, viewer UI, shared context
companion/    Electron Companion app — LAN viewer server, PowerPoint bridge, local Socket.IO
controller/   Thin Electron wrapper for the controller surface
functions/    Firebase Cloud Functions
firebase/     Firestore security rules and emulator config
packages/     Extracted shared packages and rebuild targets
docs/         Architecture notes, PRDs, QA artifacts
```

Current extracted packages include:

- `@ontime/timer-core`
- `@ontime/shared-types`
- `@ontime/local-sync-arbitration`
- `@ontime/interface-contracts`
- `@ontime/lock-view-model`
- `@ontime/presentation-core`

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

Install dependencies from the repository root so npm workspaces link the local packages:

```bash
npm install
```

Copy the env template and fill in your Firebase project credentials:

```bash
cp frontend/.env.example frontend/.env.local
# edit frontend/.env.local with your VITE_FIREBASE_* values
```

### Frontend (web app)

```bash
npm run dev --workspace frontend          # Vite dev server at localhost:5173
npm run test --workspace frontend         # Vitest unit tests
npm run lint --workspace frontend         # ESLint
npm run typecheck --workspace frontend    # TypeScript check
```

### Companion (local bridge + LAN viewer)

```bash
npm run dev --workspace companion         # Electron dev mode (hot reload)
npm run build --workspace companion       # TypeScript build
npm run test --workspace companion        # Build + node:test companion suite
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

The rebuild is currently in Stage 1b. Stage 1a extracted the first shared packages; Stage 1b is carving the remaining frontend and Companion logic into package-sized modules while keeping CI guardrails green. The two main files still being reduced are:

- `frontend/src/context/UnifiedDataContext.tsx`
- `companion/src/main.ts`

Before sharing rebuild work, run:

```bash
npm run guardrails
```

For frontend-touching changes, also run:

```bash
npm run lint --workspace frontend
npm run test --workspace frontend
```
