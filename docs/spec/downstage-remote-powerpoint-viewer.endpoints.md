---
Type: Spec
Status: current
Owner: KDB
Last updated: 2026-08-26
Scope: Cloud, private sidecar IPC, browser, and later-LAN operation contracts for ISSUE-002.
---

# Downstage Remote PowerPoint Viewer — Endpoint and Process Contracts

## Contract status

This document is the canonical operation matrix for ISSUE-002. It records the
ratified architecture: `apps/ppt-timer` is the only visible PowerPoint host; a
hidden publisher sidecar owns network/auth work; 50 cloud viewers per session
is an advisory support target, not hard admission. There are no viewer or
publisher leases in v1.

Direct client writes to the collections below are denied. Cloud callables
reconstruct a strict allowlist, apply server time, and enforce ownership,
generation, epoch, sequence, idempotency, and expiry transactionally. Existing
public `/rooms` reads do not authorize presentation-session data
(`firebase/firestore.rules:54-68,117-138`).

## Cloud data model

| Path | Client access | Required fields | Cleanup |
|---|---|---|---|
| `/presentationSessions/{sessionId}` | denied; owner/device operations use callables | `ownerUid`, `publisherDeviceUid`, `epoch`, `lastSequence`, `lastPublishRequestHash`, `lastPublishResult:{acceptedSequence,publishedAtMs}`, `status`, `sourceKind`, optional `roomId`, `viewerGeneration`, `activeWindowExpiresAtMs`, `lastPublishAtMs`, `cleanupAfterMs` | TTL on `cleanupAfterMs`; scheduled cleanup deletes dependants |
| `/presentationSessionSnapshots/{sessionId}` | matching viewer read; no client writes | validated `RemoteSnapshotV1`, `cleanupAfterMs` | top-level TTL plus scheduled cleanup |
| `/presentationSessionViewerStates/{sessionId}` | matching viewer-generation read | `status`, `sourceKind`, `viewerGeneration`, `activeWindowExpiresAtMs`, `lastPublishAtMs`, `cleanupAfterMs` | top-level TTL |
| `/presentationViewerLinks/{tokenHash}` | denied; callable only | `sessionId`, `viewerGeneration`, `status`, `expiresAtMs`, `cleanupAfterMs` | top-level TTL; plaintext token is never stored |
| `/presentationRequestResults/{uid_requestId}` | denied; callable only | `operation`, normalized request hash, completed result/error, `cleanupAfterMs` | 24-hour TTL |
| `/presentationPublisherAuthChallenges/{challengeId}` | denied; callable only | challenge hash, PKCE challenge, callback identity, status, approved owner, `expiresAtMs`, `cleanupAfterMs` | five-minute TTL; consumed once |
| `/presentationPublisherDevices/{deviceUid}` | denied; callable/owner account UI only | `ownerUid`, public device label, `status`, `createdAtMs`, `lastSeenAtMs`, `revokedAtMs?`, `cleanupAfterMs?` | revoked-device cleanup after audit window |
| `/presentationRateLimits/{bucketKey}` | denied; callable only | operation/scope hashes, `windowStartMs`, `windowMs`, `count`, `cleanupAfterMs` | short TTL after window |

`viewerGeneration` is the only generation name in documents, custom claims,
requests, and responses. Snapshot and status documents are top-level so TTL
does not have to cascade. TTL remains eventual cleanup, never authorization.

Required indexes are single-field indexes for `ownerUid`, `status`,
`cleanupAfterMs`, and `expiresAtMs`; high-churn `lastSequence`,
`lastPublishAtMs`, and snapshot timing fields are exempted where queries do not
need them. The implementation slice must publish the exact index/TTL config and
verify it in staging.

## Cloud callable matrix

All request objects reject unknown keys and have bounded string/byte lengths.
Logs contain operation, session/device UID, epoch, sequence, error code, and
latency only. They never contain link tokens/hashes, PKCE verifier, credentials,
titles, labels, or snapshot bodies.

| Operation | Route and authorization | Request → response | Atomic effects | Idempotency, distributed limit, retry and errors | Required evidence |
|---|---|---|---|---|---|
| Begin device approval | callable `beginPresentationPublisherAuth`; unauthenticated app | `{clientRequestId,codeChallenge,callbackScheme}` → `{challengeId,approvalUrl,expiresAtMs}` | create five-minute one-time challenge; callback scheme must equal the registered app scheme | 10/minute per HMAC-IP and per device-install ID; fail closed if limiter unavailable; `invalid-argument`, `resource-exhausted`, `unavailable` | emulator expiry/replay/CSRF tests; staging system-browser flow |
| Approve device | authenticated web route `/publisher/device/approve`; signed-in owner | `{challengeId,decision}` → browser result | transaction binds challenge to owner and records approval; no credential in URL | one decision; replay rejected | web integration and audit-log test |
| Complete device approval | callable `completePresentationPublisherAuth`; app proves PKCE verifier | `{clientRequestId,challengeId,codeVerifier,devicePublicKey}` → `{customToken,deviceUid,serverNowMs}` | consume challenge once, create dedicated publisher device principal and custom claims `{role:'presentation-publisher',ownerUid,deviceUid}` | durable request result; no retry after consumed mismatched verifier; `permission-denied`, `deadline-exceeded`, `already-exists` | emulator challenge tests; staging real Auth sign-in/refresh |
| Refresh/revoke device | `refreshPresentationPublisherDevice` / `revokePresentationPublisherDevice`; device or owner respectively | refresh token flow or `{deviceUid,clientRequestId}` → status | update last-seen or revoke Firebase refresh tokens and device status; active sessions become non-publishable | 30/minute/device refresh; revoke is idempotent | staging refresh, sign-out, lost-device revoke |
| Create session | callable `createPresentationSession`; active publisher device | `{clientRequestId,roomId?}` → `{sessionId,viewerUrl,viewerGeneration:1,epoch:1,activeWindowExpiresAtMs}` | create session, viewer state, hashed link; enforce configurable maximum three active sessions per owner | durable result; 5/minute/owner; fail closed on limiter error; `unauthenticated`, `resource-exhausted`, `already-exists` | emulator cap/idempotency/secret-separation tests |
| Resume session | callable `resumePresentationSession`; same active device/owner | `{sessionId,clientRequestId}` → `{epoch,viewerUrl,activeWindowExpiresAtMs}` | verify ownership/status, increment epoch, reset sequence, extend 24-hour window; reject foreign/second publisher | durable result; 10/minute/device; `permission-denied`, `failed-precondition`, `not-found` | concurrent transaction proves one owner and no stale device |
| Issue/rotate link | `issuePresentationViewerLink` / `rotatePresentationViewerLink`; owning device | `{sessionId,clientRequestId}` → `{viewerUrl,viewerGeneration,expiresAtMs}` | store new token hash; rotate increments `viewerGeneration` and revokes old links | durable result; 10/minute/session | old links and already signed-in old generation lose read access |
| Revoke link | callable `revokePresentationViewerLink`; owner/device | `{sessionId,clientRequestId}` → `{revoked:true,viewerGeneration}` | revoke active link, increment generation, write safe access-ended state | idempotent; 10/minute/session | listener denial and old-token resolve failure |
| Resolve viewer link | HTTPS callable `resolvePresentationViewerLink`; opaque token, no prior auth | `{sessionId,token}` → `{customToken,serverNowMs,activeWindowExpiresAtMs}` | hash token; verify session/link/status/window/generation; mint claim `{role:'presentation-viewer',sessionId,viewerGeneration}`; no lease/admission count | 30/minute per HMAC-IP and 60/minute/session; fail closed if limiter unavailable; `permission-denied`, `resource-exhausted`, `unavailable` | emulator denial paths; staging custom-token sign-in |
| Publish snapshot | callable `publishPresentationSnapshot`; matching active publisher device | `{sessionId,epoch,sequence,observedAtMs,observationAgeMs,sentAtEstimatedServerMs,availability,payload}` → `{acceptedSequence,publishedAtMs}` | reconstruct strict allowlist and compute its canonical hash; transaction requires active session/device/epoch. For `sequence == lastSequence + 1`, commit hash/time/snapshot. For `sequence == lastSequence`, return the stored result only when the hash matches; otherwise reject. Assign server `publishedAtMs` and bounded `preCommitTransitMs`; update snapshot/session/viewer state/cleanup | sidecar permits one in-flight sequence, so it cannot advance past an unacknowledged request; maximum 5 calls/second/session; limiter failure permits publish with alert; retry same sequence/hash is safe; mismatched duplicate is `failed-precondition` | forbidden-field, stale-device, epoch/sequence, identical/mismatched retry, heartbeat, lost-response tests; staging cold/warm latency |
| End session | callable `endPresentationSession`; owner/device | `{sessionId,clientRequestId}` → `{ended:true}` | transaction writes safe `ended` viewer state, marks session ended, rejects later publish and snapshot reads, and sets cleanup +7 days; the current viewer generation may still read the safe ended state | durable/idempotent; 10/minute/session | viewer renders ended while snapshot access is removed |
| Reserved attach/detach seam | future `attachPresentationSessionRoom` / `detachPresentationSessionRoom`; owner | `{sessionId,roomId?,clientRequestId}` → `{roomId}` | when a later issue implements it, update optional metadata only; never change link, generation, claims, or snapshot semantics | **not exported or implemented in ISSUE-002 v1**; contract reservation only | future issue must prove no room authority inheritance |
| Cleanup | scheduled `cleanupExpiredPresentationSessions`; service account | bounded batch → metrics | delete expired session, snapshot, state, links, request results/challenges/rate buckets; TTL remains safety net | retry-safe by document ID; alarm on backlog | unit eligibility tests; production TTL/scheduler gate |

There is no `renewPresentationViewerLease`, `releaseViewerLease`,
`presentationViewerLeases`, `activeViewerCount`, or lease claim/rule lookup.

## Distributed rate-limit contract

The implementation uses fixed-window Firestore buckets, not process memory.
`bucketKey` is a non-reversible HMAC of `operation | scope | windowStartMs`,
where scope is an authenticated UID/device/session or a server-secret HMAC of
the source IP. The callable transaction creates or reads the bucket, requires
the same window metadata, increments `count`, and either commits or returns
`resource-exhausted` with `retryAfterMs` at the next window. Expired buckets
have a short `cleanupAfterMs` TTL.

Limits are contractual defaults: publisher auth 10/minute/IP+install, session
creation 5/minute/owner, resume 10/minute/device, link mutation 10/minute/
session, resolution 30/minute/IP and 60/minute/session, publication 5/second/
session. A production config may lower them without a schema change. Sensitive
admission/auth operations fail closed on limiter unavailability. Publication
is allowed with a high-severity metric so a limiter outage does not falsely
disconnect active shows; retry/backoff still bounds the sidecar. Rate-limit
behavior, cost, and fallback are production release gates.

## Firestore rules contract

- Deny all client writes to all presentation collections.
- Snapshot read requires authenticated `presentation-viewer`, claim
  `sessionId` equal to the document ID, claim `viewerGeneration` equal to the
  live session, session `status == 'active'`, and `request.time` before the
  active-window deadline.
- Viewer-state read requires matching role/session/generation. The current
  generation may read a safe `ended` state long enough to render it; revoked
  generations cannot.
- Rules use one cross-document `get()` of the private session for each read.
  There is no lease `get()`. This billed read is included in the 50-viewer load
  measurement.
- Admin/callable writes bypass rules and therefore implement the same
  ownership/window/generation/epoch/sequence checks in transactions.
- Existing room/public viewer rules remain unchanged and never authorize these
  paths.

## Private sidecar IPC matrix

Electron 43.2.0 is pinned (`apps/ppt-timer/package.json:24-29`). Main starts a
hidden `utilityProcess` only after `app.ready`, creates a `MessageChannelMain`,
and transfers one port. No localhost listener is introduced. Both ends run the
same strict parser from an app-internal protocol module and terminate the
channel on incompatible version, wrong startup nonce, oversize payload, or
unknown kind.

| Message | Direction | Purpose and validation |
|---|---|---|
| `HELLO` / `READY` | main ↔ sidecar | protocol major, capabilities, random per-spawn nonce, maximum message size; no other message accepted first |
| `SHARE_START` | main → sidecar | explicit operator action; may include only non-secret presentation preferences |
| `SNAPSHOT_CANDIDATE` | main → sidecar | strict reconstructed `RemoteSnapshotCandidateV1`; no raw `HostView`, paths, process/COM identity, diagnostics, renderer action, or credential |
| `SHARE_STOP` / `END_SESSION` | main → sidecar | stop publication or end cloud session without stopping local host/countdown |
| `SEAL_RESULT` / `UNSEAL_RESULT` / `CLEAR_RESULT` | main → sidecar | correlated result with opaque versioned bytes or enumerated storage error; never renderer-visible or logged |
| `SHUTDOWN` | main → sidecar | bounded final drain and teardown |
| `AUTH_REQUIRED` | sidecar → main | validated HTTPS approval URL for `shell.openExternal`; no token/query secret |
| `SEAL_REQUEST` / `UNSEAL_REQUEST` / `CLEAR_SEALED` | sidecar → main | correlated request with opaque bytes/key slot only; main never interprets credential fields |
| `SHARE_STATE` / `PUBLISH_STATUS` | sidecar → main | safe connection/session status for the visible share UI |
| `VIEWER_LINK` | sidecar → main | validated viewer URL/QR material; only explicit share UI receives it |
| `SAFE_ERROR` | sidecar → main | enumerated redacted code and safe copy; no stack/body/token |
| `ACK` / `NACK` | either direction | correlates lifecycle commands and snapshot sequence |
| `SHUTDOWN_COMPLETE` | sidecar → main | confirms queues/timers/ports stopped |

Snapshot backpressure is one in-flight publish plus one latest replacement.
Each new normal poll replaces the pending candidate; no delta history is
queued. Material transitions publish immediately. If no material publish
occurs, the 10-second heartbeat publishes the current latest observation.

Protocol/import tests must prove the sidecar cannot import `ppt-bridge`,
`presentation-core` host/session modules, helper discovery, renderer IPC, or
`child_process`, and that it cannot dispatch any PowerPoint control. Only the
main process starts/stops `createSessionHost()` and `ppt-probe`
(`apps/ppt-timer/src/main/main.ts:160-174`; `session-host.ts:214-230`).

## Browser operation matrix

The route is `/session/:sessionId/view#token=<opaque>`. The fragment is removed
from history immediately after resolution and never reaches HTTP path/query,
referrer, analytics, or logs. `SessionViewerPage` uses a new
`usePresentationSession()` adapter and must not import `useRoom`, `useTimers`,
`useTimerEngine`, `UnifiedDataContext`, or `FirebaseDataContext`; the existing
room viewer does use those paths and is deliberately separate
(`frontend/src/routes/ViewerPage.tsx:1-17,89-104,169-180`).

1. Resolve link and establish server-clock offset from `serverNowMs`.
2. Sign in with the viewer custom token.
3. Attach safe viewer-state listener, then current-snapshot listener.
4. Require a complete validated snapshot before becoming live.
5. Reduce version/generation/epoch/sequence/freshness before adapting to the
   display model.
6. On unmount/route change/access end, detach both listeners, cancel the
   monotonic interpolation/freshness clock, clear credentials, and perform no
   lease release because no lease exists.

## Later LAN operation matrix

LAN reuses only Companion HTTPS/WSS, private-network admission, pairing/JWT,
revocation, and bundle-serving mechanics. Pairing remains 10 minutes, viewer
JWT eight hours, and the 20-device room cap remains enforced
(`docs/local-offline-lan-plan.md:19-37,53-61`).

| Operation | Route/event and role | Behavior |
|---|---|---|
| Create/status/revoke pairing | existing loopback controller endpoints | unchanged; viewer credentials remain read-only |
| Claim pairing | existing LAN-safe, origin-validated endpoint | unchanged private-subnet/HTTPS/PNA policy |
| Publisher admission | new loopback-only one-time token for role `presentation-publisher` | only the local ppt-timer sidecar may claim; no LAN viewer can publish |
| Publish | `REMOTE_SNAPSHOT_PUBLISH` | sidecar sends validated full `RemoteSnapshotV1` over loopback; Companion validates/caches latest per session |
| Bootstrap/broadcast | `REMOTE_SNAPSHOT` | Companion sends the full cached snapshot to admitted viewers and broadcasts later snapshots |
| Stop/revoke | session state event plus existing token revocation | viewer cannot control, use file APIs, or mint credentials |

`REMOTE_SNAPSHOT_*` is independently typed in `interface-contracts`; it never
wraps `LiveCue` or reuses `LIVE_CUE_*`/`PRESENTATION_*`. Companion never mirrors
cloud state back into LAN. The narrow adapter lives outside denylisted
`companion/src/main.ts`; main may only register it.

## Verification status

All runtime/emulator/staging/manual checks in this document are **NOT RUN
(documentation-only)**. Exact implementation commands and slice ownership are
in the Deep Plan. Production Auth refresh/revocation, rate limiting, TTL,
50-viewer load/cost/latency, and real Windows Presenter View remain release or
staging gates, not blockers to beginning the first bounded implementation
slice.
