# Local & Offline Strategy – Outline

This is a living outline of the ideas we discussed (no code yet). It captures the proposed local/offline approach, the companion, viewer options, and related feature ideas (show caller view, attachments/media). Treat it as a working plan.

## Goals
- Robust shows when internet is shaky: controller/viewer stay in sync on the same LAN.
- Keep core timers usable offline (single-device) via caching; multi-device offline via a lightweight LAN companion.
- Add simple media/attachment launching without overbuilding playback.

## Modes
- **Cloud (default):** controller/viewer use the cloud backend.
- **Local-only:** controller/viewer talk to the companion over LAN; queue sync to cloud when back online (optional).
- **Hybrid (recommended):** prefer companion if reachable; fall back to cloud if not. Explicit toggle + clear status badge.

## Companion (LAN helper)
- Runs a tiny HTTP/WebSocket relay for room state (controller/viewer connect via `ws://<local-ip>:port`).
- Opens local file attachments (via OS default app) when requested.
- Optional “collect files” action: copy referenced files into a portable `_collected` folder and update references (no auto-moving user files by default). If we ever add “move and relink,” it must be explicit/confirmed because moving originals can break workflows and be intrusive.
- Note on security/hardening: LAN relay should use a token/PIN, bind to chosen interfaces, and avoid split-brain by being the live authority when in local mode. LAN traffic is lower-latency and less internet-dependent, but hardening (auth + minimal surface) reduces risk on shared networks.
- Serves as a local backend for offline multi-device; can be offline itself.
- Security: token/PIN; bind to all interfaces; users choose the IP (Wi‑Fi vs wired). Bridging two distinct networks requires OS-level routing; not handled by the app.
- Future: simple status endpoint for “Companion connected” UI badge.
- Note on dual networks: most devices can do Wi‑Fi + wired simultaneously; two Wi‑Fi networks at once is uncommon. Bridging/routing between networks is user/OS territory, not app logic.

## Viewer options
- Same viewer URL reused for second-screen/comfort monitor. Controller offers “open viewer in new window” and operator drags to HDMI/SDI display. In local mode, it subscribes to the companion.
- Confidence monitor layout can stay identical for now.
- Role presets: viewer can accept role params (audio/vision/stagehand/lighting/show-caller), showing role-scoped notes/now-next. Second-screen mode is just another viewer mode.
- Nice-to-have: “Send to display X” to auto-open fullscreen on a chosen external display if OS/browser allows; fallback is open-in-new-window + manual drag.

## Attachments / Media
- Per-segment attachments: `{id, name, type, url?, path?, autoOpen?}`.
- Support both cloud URLs (open in new tab) and local paths (open via companion).
- Project root + relative paths: user sets a root; store paths relative to it so the bundle is portable (copy folder to USB, set root on another machine).
- Auto-open: at segment start, open the primary attachment if configured (via companion for local paths).
- Missing-file badge if companion reports not found.
- Timeline cues can also trigger an attachment open at start/T-minus; must go through the companion for local paths.
- Future: URL drop-to-download via companion into project root (public URLs only initially), then relink to local path. Cloud integrations (Drive/Dropbox/OneDrive) are scope-creep—start with pasted URLs.
- Collect vs move: default to copy/collect; a “move and relink” flow could be added later as an explicit, warned action (to reduce duplication while staying safe).

## Show caller & cues (future)
- Role-scoped views (audio/vision/stagehand/lighting/show-caller): now/next, per-role notes, broadcast messages, simple acks. Potential pre-production handoff between PCOs and AV: SSO/roles could give planners/operators scoped access and visibility.
- Cue timeline per segment: text/VOG/reminder cues relative to start/remaining; undoable; no media transport at first.
- Auto-follow and multi-timer support; robust undo.

## Offline behavior
- Same-device offline: service worker + IndexedDB to cache UI/state so controller/viewer load when offline; in-process updates.
- Multi-device offline: requires the companion as the local relay; controller/viewer point to it instead of cloud.
- Sync back to cloud when online (optional queue).

## Monetization (draft split)
- Free: single room, basic timers, manual edits, basic viewer, no attachments/auto-open, limited undo/history, no branding, no offline sync.
- Pro: multi-room, attachments (cloud + local with companion), auto-open, role views/notes/messaging, auto-follow/multi-timer, undo history, branding/themes, offline caching, companion support, export/share links.
- Enterprise add-ons: SSO/roles, audit logs, custom domains, support/SLAs, signed companion deployment.

## Open questions / next decisions
- Exact companion protocol (auth, events, room sync format).
- UI for local/hybrid toggle and companion detection flow.
- Scope of “collect files” (copy vs move) and default folder layout.
- How much branding/theming in Pro vs Enterprise.
- P2P/WebRTC not planned; stick to companion relay for LAN.
- Storage/duplication trade-offs: copying large files can be heavy; a “collect” step should be opt-in. If we ever add a “move and relink” flow, it should be explicit and user-driven to avoid unwanted duplication or disruption.
- Companion as live authority in local mode to avoid split-brain; mirror writes to cloud when reachable for persistence/logs.
- Transport selection: single active transport per session (cloud or companion) to keep multi-operator state consistent; status badge/toggle needed.
- Implementation sketch to add later: companion protocol (auth token, join, snapshot/delta events), transport abstraction, companion-hosted static app for cold offline start vs PWA caching (online once).

## Implementation hints (for future work)
- Companion protocol (strawman):
  - Auth: token/PIN in headers.
  - Connect: WebSocket `join` with room ID + token; receive snapshot (room state) then delta events.
  - Events: timer start/pause/reset/nudge, active/select changes, reorder, messages, attachment-open trigger.
  - REST: `/open?path=...` to open local files; `/collect` to copy referenced files into `_collected` and return updated relative paths; optional status endpoint for detection.
  - Mirror: when in local mode and cloud reachable, also POST events to cloud; if cloud unreachable, queue and replay on reconnection.

- Transport abstraction:
  - A data provider that can point to cloud or companion; single toggle in UI to choose; status badge shows which transport is live.
  - Single active transport at a time to avoid split-brain; companion preferred when present for LAN speed/reliability.

- Cold start offline options:
  - Option A: PWA/service worker caching (requires at least one online visit to cache assets).
  - Option B (better for venues): companion serves the static app bundle at `http://localhost:<port>` (or packaged desktop/PWA), enabling a fully offline first start.

- Viewer modes:
  - One viewer route with role params (audio/vision/stagehand/lighting/show-caller) and a second-screen/fullscreen mode.
  - Nice-to-have “send to display” helper; fallback is open-in-new-window + fullscreen.

## Modes/scope by user type
- Minimal/basic (free): single room, simple timer + viewer, minimal chrome, no companion, no attachments/roles/cues, limited undo/history.
- Attachments-only (no timers needed): allow attaching/opening files by segment/schedule without running timers; companion optional for local file open; useful for decks/handovers on non-show days.
- Pro/Show: advanced features (attachments, companion, auto-open, roles/notes, auto-follow/multi-timer, branding, offline caching, export).
- Enterprise: SSO/roles, audit/logs, custom domain, support/SLAs, signed companion deployment.

## Implementation pointers (where to wire things)
- Data/transport: `frontend/src/context/DataProvider.tsx` (and underlying contexts) would host the transport abstraction (cloud vs companion) and the queue/mirroring logic.
- Viewer modes: `frontend/src/routes/*` viewer route to accept role/second-screen params; add a mode param or query to switch layouts.
- Companion endpoints: new service (not yet in repo) for local WS/HTTP; hook in DataProvider. `/open`, `/collect`, status, and WS room channel for snapshot/deltas.
- Attachments model/UI: segment data structures (timers/segments in context) + controller UI; companion/open wired via data layer.
- Offline shell: add service worker caching; if using companion-hosted app, note the localhost entrypoint.

## Current state (as of last updates)
- Built: timer controller/viewer with rundown drag/drop, room custom sort, HH:MM:SS previews, QR sharing, undo flows, styling polish, column picker.
- Not built yet: companion/local transport, attachments/media (open/collect/move), role-based viewer modes, cue timeline/show-caller view, offline cold-start, monetization gates, local-first syncing.

## Doc discoverability
- Link this doc from a docs index or README so future contributors can find it quickly.
