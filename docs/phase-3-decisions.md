---
Type: Reference
Status: draft
Owner: KDB
Last updated: 2026-01-22
Scope: Phase 3 scope locks, assumptions, and open questions.
---

# Phase 3 Decisions

## Locked Decisions
- Phase 3 sequencing: 3A Show Controller definition, 3B LAN offline viewer infrastructure, 3C Show Controller build, 3D hardening/release.
- Cue ordering field: add optional `order` on `cues` for deterministic manual/sequential ordering within a segment/section; timed cues still sort by time.
- Custom role label: add optional `odRoleLabel` when `operators.odRole == 'custom'` to persist display text.
- Companion cue events: add explicit socket event payload schemas for cue CRUD/reorder/ack in `docs/interface.md` (Phase 3C Pass A).
- LAN offline viewer implementation follows `docs/local-offline-lan-plan.md` as the authoritative plan.
- Protocol/schema changes follow `docs/interface.md` (planned Phase 3 fields already defined there).
- Standalone PowerPoint video timer app is deferred until after Phase 3 core.
- Show Planner features are gated by room tier, not Companion mode. Companion modes remain Minimal/Show Control/Production.
- Cue authority model: Firestore is primary when online; Companion stores an offline cache and queues writes for replay on reconnect. Conflict resolution follows `docs/local-mode.md` timestamp arbitration, preferring local authority when the controller is local.
- Tier gating default: Basic = timers only; Show Control = sections/segments + live cues; Production = manual cues + crew chat + multi-room dashboard.
- Viewer access split: Cloud viewers are public/read-only via shareable link; LAN viewers require pairing and role-bound tokens.
- Operator access model: Invite code + approval list with blocklist for kicked users.
  - Owner generates room-specific invite code (e.g., `CREW-7X4M`).
  - Operators authenticate (Firebase Auth) + enter invite code → Cloud Function validates and creates `operators/{odUserId}`.
  - Operators self-select role (lx/ax/vx/sm/foh/custom); td/director reserved for owner only.
  - Owner can kick operators: removes from `operators`, adds to `blocked` → immediate revocation.
  - Kicked users cannot rejoin with same invite code; owner can unblock if mistake.
  - Firestore rules enforce: cue writes require (owner) OR (approved operator + role match) and blocklist check.
  - Schema: `rooms/{roomId}/operators/{odUserId}`, `rooms/{roomId}/blocked/{odUserId}`, `rooms/{roomId}/config/invite`.
- Cue queue implementation: Dedicated queue for cue events, separate from timer queue.
  - Initial cap: 150 events.
  - Storage key: `ontime:cueQueue:{roomId}`.
  - Same FIFO overflow and replay semantics as timer queue.
  - Rationale: Cue volume is higher than timer actions; isolation prevents cues from pushing out critical timer state.
- Cue authority mode transitions: Firestore remains canonical when online; Companion accepts cue writes offline and queues them for replay on reconnect.
  - Replay order is timestamp-ordered after per-type merge (match timer queue semantics in `docs/local-mode.md`).
  - Conflict resolution uses the existing timestamp arbitration rules; newest cue write wins.
  - Pending offline cues do not block cloud edits; on reconnect, queued writes apply on top of latest cloud state.
- Role storage is explicit only: authorization relies on `rooms/{roomId}/operators/{odUserId}` (plus owner implicit TD/Director); no role inference from connection source or client type.
- Bundle strategy: separate viewer-only Vite build (`VITE_VIEWER_ONLY=true`), packaged in `resources/viewer/`, unpacked to a runtime cache on launch, served at `/viewer/v{appVersion}/` with content-hash filenames. See `docs/phase-3-bundle-strategy.md`.
- Cert trust UX: trust guide in Companion LAN Viewers panel; viewer-side "Trust Required" screen with retry after proceeding past TLS warning; BYO cert in Settings (advanced); no HTTP fallback; recommend viewer-only Electron app to reduce trust friction. See `docs/phase-3-cert-trust-ux.md`.
- Pairing defaults: code TTL 10 min (not persisted across restart), viewer token TTL 8 hours (persisted), max 20 devices per room; tokens reusable until expiry unless revoked.
- Crew chat: operators can send to all or targeted roles; role-targeted messages are highlighted for that role.
- Crew chat channels: Phase 3 uses role-targeted audiences; named channels (saved role groups) are a Phase 4 enhancement.
- LAN-only operator join is deferred for Phase 3 core; offline LAN mode remains owner-only for operator actions.
- Phase 3B Pass B2 validation: verified BYO cert loads and viewer URL renders over HTTPS with custom cert.

## Proposed Decisions (Pending Confirmation)
- StageState payload (future/additive): add a compact “what’s on stage” payload (timer display + clock + message + connection flags) for viewers; operator viewers can embed StageState and layer role overlays later.
- Timeline targets: 3A (1 week), 3B (2–3 weeks), 3C (2–3 weeks), 3D (1 week).
  - Status: timeline targets remain proposed; confirmation deferred pending Phase 3B completion.

## Assumptions
- Electron controller remains the operator surface for offline use.
- LAN viewers are opt-in and restricted to private subnets with role-bound tokens.
- Viewer bundle is served from the Companion origin for offline LAN usage.

## Open Questions
- Phase 3 release window aligned to actual velocity.

## Notes
- Windows cert trust behavior: Edge/Chrome require Advanced → Proceed to localhost; no installable cert path confirmed.
- Optional hardening: document Windows cert install path during Phase 3D if feasible; otherwise defer to Phase 4.
- Phase 3B Pass B1 validation: verified self-signed SAN certs, LAN allowlist, and PNA/CORS on local + LAN scenarios.
- Phase 3B Pass C validation: LAN pairing QR/local flow, role-bound tokens, and revocation persistence verified.
- Phase 3B Pass D validation: viewer tokens cannot invoke REQUEST_CONTROL or FORCE_TAKEOVER; server returns PERMISSION_DENIED.

## Pass 3B E QA (Offline QA + Recovery)
-- Status: manual QA executed for core items; edge-case QA still pending (IPv6-only, Docker/VM bridges, multi-NIC).
- Trust flow: validated self-signed and BYO cert paths (LAN viewer loads after browser warning; no mixed content).
- LAN restrictions: confirmed allowlist blocks non-LAN access and allows RFC1918 LAN clients; PNA/CORS headers verified during LAN pairing and viewer loads.
- Bridge recovery: validated remote viewers stall when offline and resume read-only after reconnect with fresh snapshot.
- Cache/versioning: verified viewer bundle cache after Companion restart.
- Edge-case QA to run: IPv6-only LAN (ULA + link-local), Docker/VM bridge interfaces, and multi-NIC hosts (ensure cert SANs and allowlist accept chosen LAN host/IP).
- Observations (code review only): allowlist enforcement and cert SAN handling live in `companion/src/main.ts`; source arbitration/bridge sync live in `frontend/src/context/UnifiedDataContext.tsx`.

## Locked Decisions (Addendum)
- Mobile viewer apps (iOS/Android) deferred until after Phase 3 core; Phase 3 focuses on desktop viewers (web + viewer-only Electron).
- Viewer-only Electron app is Phase 3B (trust-bypass path).
- Controller second-display output is Phase 3C and is viewer-only (no edit controls; authority remains on primary controller).
