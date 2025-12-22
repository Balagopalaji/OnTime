> ⚠️ Deprecated
> Historical Phase 1 walkthrough. Do not use as source of truth. See `docs/local-mode-plan.md` for current parallel sync architecture.

# Phase 1D Walkthrough (Main UI Local Mode + CI Packaging)

Use this as a quick validation checklist for Phase 1D.

## 1) Local/Hybrid Mode UI
- Start frontend: `cd frontend && npm run dev`
- Start Companion (installed app)
- Open: `http://localhost:5173/dashboard`
- Use header **Connect Companion** → **Fetch Token** → **Connect**
- Open a room in **Local/Hybrid** (controller + viewer)

Expected:
- Controller works without Firebase login in Local/Hybrid mode
- Viewer shows timers/state using Companion (not Firestore)

## 1.5) Seamless Switching (No “Heart-Attack UX”)
- In **Cloud**: open a room with timers and start a countdown.
- Switch to **Hybrid/Local** while the timer is running.
- Switch back to **Cloud**.

Expected:
- Timers do not “disappear” during switching for the active room.
- A banner/indicator may show **“Syncing…”** until Cloud catches up.
- Running timer continues smoothly across switches (via `SYNC_ROOM_STATE`).

## 1.6) Companion Drop → Cloud Fallback
- While in Hybrid and online, quit Companion mid-session.

Expected:
- App detects Companion drop and falls back to Cloud within seconds (degraded banner).

## 2) Offline Behavior
- Turn Wi‑Fi off
- In controller: start/pause/reset timers; CRUD timers

Expected:
- Local sync continues
- No Firestore retry spam (Firestore write-through is skipped while offline)

## 3) File Ops Smoke (packaged app)
- Fetch token: `curl -s http://127.0.0.1:4001/api/token`
- Metadata: `curl -i --get http://127.0.0.1:4001/api/file/metadata -H "Authorization: Bearer $TOKEN" -H "Origin: http://localhost:5173" --data-urlencode "path=/Users/YOU/Downloads/video.mp4"`

Expected:
- `duration` and `resolution` returned (ffprobe bundled/used)

## 4) CI Packaging
- Trigger GitHub Actions workflow **Build Companion installers**

Expected artifacts:
- `companion-macos-latest`: `.dmg`
- `companion-windows-latest`: `.exe` (NSIS)
- `companion-ubuntu-latest`: `.AppImage`


