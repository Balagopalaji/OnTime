# OnTime

OnTime is a live event timer and presentation-follow app built for controller/viewer workflows. The current interview-demo cut focuses on stable multi-timer control, viewer sharing, LAN viewer support, the Electron controller shell, and PowerPoint slide/timing follow via the local Companion app.

## Stack

- TypeScript
- React 19
- Vite
- Firebase / Firestore / Cloud Functions
- Socket.IO
- Electron
- Tailwind CSS
- Vitest + Testing Library

## Repo Layout

- `frontend/`: web app and shared controller/viewer UI
- `controller/`: Electron wrapper for the controller
- `companion/`: local Companion app for LAN/presentation integration
- `functions/`: Firebase Cloud Functions
- `firebase/`: Firestore rules and emulator tests
- `docs/`: PRDs, architecture notes, tasklists, and QA artifacts

## Current Demo Scope

- Multiple timers with controller lock/takeover flows
- Public cloud viewer and LAN viewer support
- Presentation status / PowerPoint slide follow
- Electron controller packaging

Temporarily de-emphasized in the current demo branch:

- Cue/show-control management UI
- Broader phase-3 show-planner surface area

## Local Development

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Useful commands:

```bash
cd frontend
npm run lint
npm run test
npm run build
npm run typecheck
```

### Controller

```bash
cd controller
npm install
npm run dev
```

### Companion

```bash
cd companion
npm install
npm run dev
```

## Firebase Hosting

Firebase Hosting serves `frontend/dist` using the project configured in `.firebaserc`.

Typical deploy flow:

```bash
cd frontend
npm run build
cd ..
firebase deploy --only hosting
```

## Notes

- The web bundle currently builds cleanly with `vite build`.
- There is still broader TypeScript strictness debt in parts of the repo outside the narrowed demo cut; use `npm run typecheck` to inspect that backlog separately.
