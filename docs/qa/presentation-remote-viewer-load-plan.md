---
Type: QA plan
Status: current
Owner: KDB
Last updated: 2026-09-28
Scope: ISSUE-002 S3d staging gates — 50-viewer load, cost, latency, TTL, limiter, and monitoring.
---

# Remote PowerPoint viewer — staging load and monitoring plan

All checks below are **NOT RUN**. They are staging/release gates (Deep Plan
"Slice verification" S3a–d), not emulator evidence. Emulator coverage lives in
`npm run test:presentation --workspace ontime-firebase-rules`.

## 50-viewer / 30-minute load (D2 advisory target)

- **Setup:** one publisher device and session in staging; one scripted sidecar
  publishing material transitions plus the 10 s heartbeat; 50 headless browser
  viewers resolving the same link and holding both listeners for 30 minutes.
- **Measure:** p50/p95 host-observation → viewer DOM paint (target p95
  ≤ 1,500 ms); publish callable cold/warm latency; Firestore reads/writes per
  viewer-minute (snapshot + viewer-state listener reads and one rules `get()`
  per snapshot read); Functions invocations; projected cost per show-hour.
- **Pass:** p95 ≤ 1,500 ms; zero viewers stale while the publisher is live; no
  `resource-exhausted` on publish at normal cadence; cost within the agreed
  per-show budget. Failure falls back to a named-tester limit, not a lease
  retrofit.

## Production configuration to verify

- `firebase/firestore.indexes.json` deploys: TTL on `cleanupAfterMs` for all
  eight presentation collections; index exemptions on snapshot/session
  high-churn fields.
- `cleanupExpiredPresentationSessions` runs hourly; `cleanup-backlog` alert
  fires when a batch fills.
- Secrets/config: `PRESENTATION_SERVER_SECRET` (≥ 32 chars),
  `PRESENTATION_WEB_ORIGIN`, `PRESENTATION_CALLBACK_SCHEME`; production must
  never set `PRESENTATION_EMULATOR_RATE_LIMIT_MULTIPLIER` (ignored outside the
  emulator regardless).
- Functions deploy bundles the `@ontime/remote-viewer-contracts` workspace
  package (CommonJS build); a plain `firebase deploy` of `functions/` does not
  include workspace packages — packaging must be resolved before release.
- Publisher device Auth: custom-token sign-in, ID-token refresh, sign-out
  revocation, owner lost-device revoke.

## Rate-limit and cleanup staging checks

- **Client IP trust:** confirm production `rawRequest.ip` is present and is the
  address appended by the Google front end (right-most trusted hop), not a
  client-supplied `X-Forwarded-For` value (the Functions emulator enables
  `trust proxy` and supplies no address). A missing/unparseable address fails
  closed (`unavailable`, alert `rate-limiter-no-ip`) — page on this alert.
- **Shared NAT:** 50 viewers opening one link behind one venue/CGNAT address
  exceed the contract's 30 resolutions/min/IP; measure, confirm the viewer
  honors `retryAfterMs`, and decide whether the contract value must change.
- **Limiter contention:** measure publish latency added by the per-second
  bucket transaction under bursts; confirm the fail-open alert rate is
  acceptable (dedupe if not).
- **Auth deletion pacing:** confirm the Admin `deleteUsers` quota; cleanup
  paces shared 1,000-uid chunks at ~1 call/s (20 per run) and defers on
  `auth/quota-exceeded` as backlog.
- **Revoke/end abuse:** confirm per-(session, caller) scoping keeps an owner's
  revoke/end available while another principal is being throttled.

## Alerts

| Log message / field | Severity | Meaning |
|---|---|---|
| `presentation rate limiter unavailable` / `alert: rate-limiter-unavailable` | error | limiter store failed; publication proceeded (fail-open), auth/link calls returned `unavailable` |
| `presentation publish transit fallback` / `transit: no-offset or clamped` | warn | sidecar lacked a reliable clock offset or transit exceeded the stale window |
| `presentation cleanup` / `alert: cleanup-backlog` | warn | expired data exceeded one sweep batch, the Auth-deletion budget, or Auth throttled |
| `presentation cleanup` / `alert: cleanup-session-failed`, `cleanup-auth-failed` | error | a session's documents or Auth principals could not be deleted; retried next run |
| `presentation rate limiter missing client IP` / `alert: rate-limiter-no-ip` | error | resolve/begin/complete are failing closed |
