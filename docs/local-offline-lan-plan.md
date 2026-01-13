---
Type: Plan
Status: current
Owner: KDB
Last updated: 2025-12-29
Scope: Local/offline and LAN viewer plan and constraints.
---

# Local/Offline + LAN Viewer Plan (Alignment Draft)

Audience: product + engineering. Captures decisions/constraints before PRD updates.

Goals
- Reliable local/offline show control (desktop controller + Companion), no internet required.
- Keep cloud-only path unchanged (hosted app + Firestore).
- Allow optional remote viewing when one internet-connected controller bridges to cloud.
- Treat LAN viewers as a gated, phase-2+ feature with strong security.

Constraints (non-negotiable)
- HTTPS/WSS + trusted cert required for any LAN client in a browser; http/ws will be blocked (mixed content).
- PNA/CORS: must return `Access-Control-Allow-Private-Network: true` and allowlisted origins.
- Token endpoint stays loopback-only by default; no open `/api/token` on LAN.
- Role-bound tokens: viewer tokens must never allow control actions; enforce controller-only events server-side.
- Offline controller UI is Electron-only (PWA offline caching for controllers is out of scope).
- Viewer UI delivery when offline must be explicit: default to Companion-served static viewer bundle; PWA caching is optional for hosted viewers.
- Companion-served viewer bundle requires explicit build/distribution/versioning work (Phase 2 engineering scope).
- Authority: when local/Companion is active, remote/cloud controllers are read-only unless explicit takeover.
- LAN exposure must be opt-in, restricted to private subnets, and never bind to public interfaces by default.
- LAN allowlist: RFC1918 (10/8, 172.16/12, 192.168/16), IPv4 link-local (169.254/16), and IPv6 ULA (fc00::/7) + link-local (fe80::/10).
- Cert hostname stability is required for LAN HTTPS; DHCP/mDNS churn must be addressed by pinning a stable host name or matching a chosen IP in SANs.
- Cert strategy supports both paths:
  - Default: self-signed SAN cert (localhost + chosen host/IP), reissued on SAN change or every 90 days; requires client re-trust.
  - BYO cert/key: preferred for strict venues to avoid recurring trust prompts; requires stable hostname/DNS and secure key handling.
- Local persistence must have a single source of truth (Companion cache is authoritative; controller cache is secondary).
- Companion cache must be versioned and migrated on app updates to avoid stale or incompatible state.
- If cache migration fails, fall back to last good backup if available; otherwise reset cache with an explicit warning to the user.
- LAN viewer tokens must not permit file APIs or any control paths; enforce role checks on socket and HTTP routes.

Phases (proposed)
1) Desktop controller (macOS/Windows, Electron) embedding current React app.
   - Modes: Cloud / Auto / Local. Works with Companion over loopback. Local persistence for restart.
   - Removes browser trust friction for operators; cloud path unchanged.
   - Phase 1 assumes Electron for offline availability; hosted app remains unchanged.
2) LAN viewers (opt-in, flag-gated, private subnets only).
   - Pairing/QR flow issues viewer-only, short-TTL tokens; keep token fetch loopback-only.
   - Cert strategy: default to self-signed SAN + guided trust; BYO cert/key supported for enterprise/venue needs.
   - Desktop LAN viewers first; mobile support only after trust flow is proven.
   - Discovery: manual host entry and/or QR; mDNS optional but may be blocked on some networks. The chosen hostname/IP must match cert SANs.
   - Default to Companion-served static viewer bundle for offline LAN clients (served from the Companion origin alongside sockets to minimize CORS). PWA cache is optional. This requires explicit engineering (build output, packaging, cache/versioning, wiring into token/CORS/trust flow). Bundle can be public; room data remains gated by viewer tokens.
3) Optional mobile/native viewers.
   - Only after cert/trust flow is solid; higher support cost, especially on iOS.

Authority/role rules
- Local/Companion controller is authoritative whenever Local/Auto is active (online or offline); bridge uploads snapshots to Firestore when online.
- Remote/cloud controllers default to read-only while local is authoritative; takeover must be explicit.
- Pairing tokens for LAN viewers must not elevate to controller.
- Pairing defaults (final): pairing codes TTL 10 minutes (not persisted across restart), viewer tokens TTL 8 hours, max 20 devices per room. Viewer tokens and revocation list persist in Companion cache; revocation enforced on reconnect and token validation.
- Pairing tokens are reusable until expiry (not single-use) unless explicitly revoked.
- UI should make read-only state explicit and provide a clear takeover path when allowed.
- Authority must be enforced server-side with a lock/heartbeat and explicit takeover semantics (not UI-only).
- Defaults: per-room lock, heartbeat every 30s, stale after 3 missed heartbeats (90s). Stale locks require explicit takeover (no auto-expire).
- Force takeover is allowed for owners/admins when the lock owner is unavailable; record audit details (who/when/device).
- Offline identity: when fully offline, cached owner/admin auth on the local controller counts for takeover; otherwise require a local admin credential (stored locally on the controller/Companion device, not cloud).
- If the bridge dies mid-lock, remote controllers remain read-only until explicit takeover or manual unlock by an authorized operator.

Bridge model
- One internet-connected controller runs Auto/Local+Cloud: connects to Companion + Firestore, publishes state to cloud.
- Remote web viewers use hosted URL via Firestore. If bridge drops, remote stalls; resumes on return with fresh snapshot.
- On bridge reconnect, explicitly push a fresh snapshot to re-sync cloud state (and optionally on a timer).
- Cloud edits are blocked while local is authoritative; the bridge is the sole writer to Firestore in this mode.
- Define a sync policy when cloud is newer than Companion (timestamp arbitration + conflict handling) for recovery scenarios.
- UI must surface read-only mode for remote controllers and provide a takeover flow with confirmation and audit trail (who can approve, and when).
- Default approval: only authenticated room owners/admins can initiate takeover; require explicit confirmation and record device + timestamp.

Open decisions to finalize
- Pricing/tier: Companion/local/offline + LAN viewer features as pro/venue tier.

Validation checklist (per phase)
- Phase 1: offline controller launch with no internet; restart preserves state; local control actions do not require cloud.
- Phase 2: LAN viewer trust flow on desktop succeeds; HTTPS/WSS cert SAN matches chosen host; PNA preflight observed; viewer assets load offline via the chosen delivery mechanism; viewer cannot perform control or file actions; pairing token expires and revocation works across Companion restart.
- Bridge: disconnect/reconnect internet; remote viewers stall then resume after snapshot; cloud writes blocked for non-bridge controllers; read-only UI visible to remote controllers.
- LAN binding: non-allowlisted clients are rejected (RFC1918/ULA only); allowlist enforcement verified on both socket and HTTP paths.

Next steps (no code)
- Ratify phases, authority rules, and cert strategy (defaults are set; confirm or adjust).
- Then update PRDs (backend/frontend/local-mode) to reflect the chosen path and milestones.
- Add tasks for the Companion-served viewer bundle (build, packaging, cache/versioning, and CORS/trust wiring).
