---
Type: Deep Plan
Status: draft
Owner: KDB
Last updated: 2026-08-26
Scope: ISSUE-002 remote PowerPoint publisher and read-only viewer surfaces.
---

# Downstage Remote PowerPoint Viewer: Deep Plan

## Goal

Extend the existing `apps/ppt-timer` PowerPoint countdown baseline into read-only cloud browser, shared desktop, and later LAN viewer surfaces without recreating its timer UX or changing its local Windows/PowerPoint behavior. The implementation adds a privacy-filtered remote session contract, a separately authorized publisher boundary, and a source-neutral timer face that preserves the existing compact charcoal face, canonical status label, hover controls, and disclosed video list.

This plan is implementation-ready except for the two owner decisions in [Open questions and readiness](#open-questions-and-readiness). No code may begin until those decisions are recorded and `spec-plan-readiness` returns `implementable`.

## Settled constraints

- `apps/ppt-timer` is the behavioral and visual baseline. Remote surfaces reuse its compact/expanded behavior; they do not introduce another timer design or permanently visible media-label panel.
- The helper remains local and transport-agnostic. Its stdin protocol stays `poll`/`exit`; no Firebase, HTTP/WSS, account, room, credential, or retry policy enters `ppt-probe`, `ppt-bridge`, or `presentation-core`.
- `SessionHostOptions.onView(view: HostView)` is the canonical publication seam. Remote code publishes the already host-resolved `PowerPointViewState`; it never recomputes focus, headline, status, or timer meaning.
- The ordinary viewer payload excludes paths, process/COM identity, helper diagnostics, window/display state, credentials, and control actions.
- Viewer links are opaque, session-scoped, read-only, active for 24 hours, rotatable/revocable, and independent from publisher credentials. Inactive session data is removed after seven days.
- Every publish is a complete current snapshot. Material PowerPoint transitions publish immediately; liveness republishes the complete snapshot every 10 seconds. Viewers become stale after 25 seconds and disconnected after 60 seconds.
- PowerPoint is the only v1 source. A later stage-timer source receives its own payload and adapter; it reuses the envelope, authorization, freshness reducer, and timer face.
- Existing room routes/documents and `LIVE_CUE_*` / `PRESENTATION_*` events never carry the new snapshot, even temporarily.
- Media-label behavior is settled: the collapsed face is status plus time; sanitized video titles are available only in the disclosure list.

## Background

### Existing PowerPoint host and renderer seams

- The Windows helper is a persistent STA process with only `poll`/`exit` commands and newline-delimited JSON responses (`packages/ppt-bridge/native/windows-ppt-probe/Program.cs:68-151`). `PptBridgeClientImpl` owns helper discovery, hidden child-process stdio, poll timeout, restart, and termination (`packages/ppt-bridge/src/process-client.ts:22-194,224-240`).
- `PowerPointSession` owns polling and state reduction; `createSessionHost()` adds status stabilization, focus history, settings reprojection, and immutable host-view publication (`packages/ppt-bridge/src/powerpoint-session.ts:36-208`; `apps/ppt-timer/src/main/session-host.ts:119-166,214-334`).
- The publish-ready seam is `SessionHostOptions.onView(view: HostView)`, called after `currentView` is replaced and the revision is incremented (`apps/ppt-timer/src/main/session-host.ts:30-45,276-321`).
- Main currently expands `HostView` into renderer-facing `AppView`, sends it over the `ppt-timer:view` IPC channel, and exposes only `getView`, `subscribe`, and validated `dispatch` through preload (`apps/ppt-timer/src/main/main.ts:217-240`; `apps/ppt-timer/src/preload/preload.ts:8-22`). `mountApp()` rejects revisions older than the last applied view (`apps/ppt-timer/src/renderer/main.ts:220-259,317-360`).
- Shutdown ends the host, polling, and helper; there is no tray/background publisher lifecycle (`apps/ppt-timer/src/main/main.ts:353-375`; `apps/ppt-timer/src/main/session-host.ts:323-334`). Persisted state is ordinary JSON window/UI settings, not secret storage (`apps/ppt-timer/src/main/settings-store.ts:15-61`).
- Packaging is Windows x64 and includes one helper at `resources/bin/ppt-probe.exe`; sandboxing, context isolation, blocked navigation/popups, and the narrow preload API are load-bearing (`apps/ppt-timer/electron-builder.yml:15-86`; `apps/ppt-timer/src/main/security.ts:13-43`).
- Canonical status labels and timer DOM live in `apps/ppt-timer/src/renderer/powerpoint-panel.ts:8-93`; the compact charcoal surface and quiet disclosure are defined in `apps/ppt-timer/src/renderer/styles.css:1-167`. Timer-only patches preserve keyboard focus and open controls (`apps/ppt-timer/src/renderer/main.ts:104-175,193-213,289-339`).

### Cloud, LAN, and authorization seams

- `/room/:roomId/view` is a public, timer-only route. It reads room/state/timer documents through `useRoom` and `useTimers`, then drives `useTimerEngine`; it has no PowerPoint session credential or snapshot (`frontend/src/routes/AppRouter.tsx:73-98`; `frontend/src/routes/ViewerPage.tsx:62-111,174-225`; `frontend/src/hooks/useRoom.ts:94-169`; `frontend/src/hooks/useTimers.ts:49-79`).
- Firestore rules make room, timer, v2 state, and lock reads public while `/liveCues` is authenticated and show-control-tier gated. Neither model is suitable for an opaque session viewer (`firebase/firestore.rules:50-125`).
- Cloud Functions export lock arbitration and operator joining only (`functions/src/index.ts:1-23`).
- Frontend emulator ports diverge from `firebase.json`: Firestore 8080 vs 8081 and Functions 5001 vs 5002 (`frontend/src/lib/firebase.ts:44-60`; `firebase.json:22-35`). Node emulator tests discover endpoints through the Emulator Hub, but the browser runtime does not (`firebase/tests/joinAsOperator.emu.js:25-49,92-131`).
- Companion provides reusable HTTPS/WSS, bundle serving, pairing, and socket admission seams, but its credentials and replay are room-scoped (`companion/src/main.ts:1280-1420,1422-1695,3072-3125,3626-3950`). Pairing codes last 10 minutes, viewer JWTs eight hours, and LAN remains capped at 20 devices (`companion/src/main.ts:140-143`).
- Existing `PRESENTATION_*` envelopes carry `LiveCue`, omit session epoch/sequence, and are applied without stale-generation rejection (`packages/interface-contracts/src/live-cue-envelopes.ts:20-59`; `packages/shared-types/src/index.ts:173-210`; `frontend/src/context/UnifiedDataContext.tsx:3778-3853`).

### External Firebase constraints

- Firestore documents no simple concurrent-listener ceiling appropriate as a product cap. The cloud limit is a support/cost/load-test policy, not a platform constant. One listener on one current-snapshot document minimizes fan-out and reads ([realtime queries at scale](https://firebase.google.com/docs/firestore/real-time_queries_at_scale)).
- A 10-second heartbeat is 0.1 writes/second/session. Sustainable update rate depends on contention and index fan-out rather than a current fixed one-write/second rule ([Firestore best practices](https://firebase.google.com/docs/firestore/best-practices)).
- A custom token is a sign-in credential. Its expiry does not terminate the resulting Firebase Auth session; custom-claim changes arrive on reauthentication/refresh. Immediate revocation therefore depends on mutable server state checked by rules, not token expiry alone ([custom tokens](https://firebase.google.com/docs/auth/admin/create-custom-tokens); [custom claims](https://firebase.google.com/docs/auth/admin/custom-claims)).
- Security Rules can compare one proposed write with the existing document, but Admin SDK writes bypass rules and rules are not a general sequencing engine. Server-side `{epoch, sequence}` enforcement must be transactional, and viewers still reject regressions ([rules conditions](https://firebase.google.com/docs/firestore/security/rules-conditions)).
- TTL deletion is asynchronous, commonly within 24 hours, does not cascade into subcollections, and is not an authorization boundary ([Firestore TTL](https://firebase.google.com/docs/firestore/ttl)).
- Emulator tests cover rules and realtime behavior but not production token expiry/signature validation, production rate limits, every transaction/index behavior, or proven TTL execution ([Firestore Emulator](https://firebase.google.com/docs/emulator-suite/connect_firestore)).

## Architecture overview

```text
ppt-probe
  -> @ontime/ppt-bridge
  -> @ontime/presentation-core
  -> shared PowerPoint host coordinator
  -> HostView / PowerPointViewState
  -> publisher allowlist adapter
  -> publishPresentationSnapshot callable transaction
  -> presentationSessionSnapshots/{sessionId}
  -> Firestore listener OR LAN REMOTE_SNAPSHOT
  -> validate/reduce epoch + sequence + freshness
  -> PowerPoint display adapter
  -> source-neutral TimerFace
```

The architecture has three contracts:

1. **Transport-neutral envelope** — session identity, source kind/version, server ordering, liveness policy, and availability.
2. **Strict PowerPoint v1 payload** — host-resolved slide, headline, video, and timing fields only.
3. **Source-neutral display model** — renderer input, never a wire payload.

`packages/remote-viewer-contracts` owns the first two plus pure validation/reduction. `packages/timer-face` owns the third plus framework-free DOM/CSS rendering. The PowerPoint adapter is the only module allowed to import both contracts.

## Corrections applied to the planning baseline

These changes replace earlier proposals because current code or Firebase behavior makes the replacement safer and simpler without losing coverage:

- The pure wire contract uses integer milliseconds, not Firebase `Timestamp` objects. Firebase conversion belongs in transport adapters.
- `publishPresentationSnapshot` is an authenticated callable, not a direct client write. The callable reconstructs the allowlist, sets authoritative server time, and checks epoch/sequence in one transaction; rules deny client writes.
- Browser emulator configuration uses Vite environment values with defaults matching `firebase.json`; Node-only Emulator Hub discovery is not copied into browser runtime code.
- Current snapshot/status/link/lease documents are top-level one-document-per-session records with their own cleanup fields. This avoids relying on TTL to cascade through subcollections.
- `localAdvanceMs()` remains local PowerPoint behavior because its two-second bound is tuned to the one-second COM poll cycle (`apps/ppt-timer/src/renderer/view.ts:108-114`). Remote interpolation uses a separate 25-second freshness-aware reducer.
- A separate publisher does not import an app-internal file or duplicate host selection logic. The pure host coordinator and its policies are extracted with characterization tests into `packages/powerpoint-host`, then both `apps/ppt-timer` and the publisher consume it.

## Remote contract

### Envelope

```typescript
type RemoteSnapshotV1 = {
  schemaMajor: 1
  sourceKind: 'powerpoint'
  sourceMajor: 1
  sessionId: string
  epoch: number
  sequence: number
  observedAtMs: number
  publishedAtMs: number
  heartbeatIntervalMs: number
  staleAfterMs: number
  disconnectAfterMs: number
  availability: 'connecting' | 'active' | 'source-unavailable'
  payload: PowerPointPayloadV1 | null
}
```

`publishedAtMs` is assigned inside the publish transaction. `observedAtMs` is advisory provenance only. The server writes the current policy values (10,000/25,000/60,000 ms); they remain numeric fields so a later policy retune is not a schema-major change. Every accepted transition or heartbeat increments `sequence` and writes a complete snapshot. `availability` remains source-neutral; PowerPoint-specific absence/failure reasons live in its payload. A source-unavailable snapshot may carry a reason-only payload but never stale numeric timing.

The validator rejects unknown top-level keys, incompatible majors, an unknown `sourceKind`, non-finite/negative timing, inconsistent availability/payload combinations, and nested unknown keys. It constructs a new allowlisted object rather than forwarding the input object.

### PowerPoint payload

```typescript
type PowerPointPayloadV1 = {
  reason:
    | 'presentation'
    | 'powerpoint-not-running'
    | 'no-slideshow'
    | 'helper-unavailable'
  slideNumber: number | null
  slideCount: number | null
  displayTitle?: string
  headline: {
    focusedOrdinal: number | null
    mode: 'longest-remaining' | 'latest-started'
    timingMode: 'remaining' | 'elapsed'
  }
  videos: RemoteVideoRowV1[]
}

type RemoteVideoRowV1 = {
  ordinal: number
  label?: string
  status: 'ready' | 'playing' | 'paused' | 'ended'
  durationMs: number | null
  elapsedMs: number | null
  remainingMs: number | null
  measuredAtPublishedMs: number
  isFocus: boolean
}
```

The callable stamps each row's `measuredAtPublishedMs` with the same authoritative `publishedAtMs` after reconstructing the payload. For a `playing` row, the viewer computes `advanceMs = min(max(0, estimatedServerNowMs - measuredAtPublishedMs), staleAfterMs)`; elapsed increases by `advanceMs` but never beyond finite duration, and remaining decreases by `advanceMs` but never below zero. Ready, paused, ended, stale, disconnected, and source-unavailable rows never advance. This is the explicit remote replacement for the baseline export's `runningAnchor`; it is separate from the local two-second `localAdvanceMs()` and `PlaybackClock` policies.

On cold bootstrap, link resolution supplies `serverNowMs`; the transport estimates server offset and rejects an already-old current snapshot. Subsequent receipt/renewal responses refine that estimate. `publishedAtMs` is never compared directly with an uncorrected client clock.

### Pure reducer contract

`reduceRemoteViewer(previous, event, clock)` accepts either a validated snapshot, a transport error, or a clock tick. `clock` supplies monotonic local time and estimated server time. It:

- accepts a higher epoch and clears all prior source/display state;
- rejects a lower epoch or a sequence less than or equal to the last sequence in the same epoch;
- refuses a non-full first snapshot after connect/reconnect;
- derives `live`, `stale`, and `disconnected` locally;
- applies the bounded playing-row interpolation formula above while live;
- stops interpolation and clears primary numeric time at stale;
- preserves only safe connection/status copy after disconnect;
- fails visibly on unknown schema/source major rather than using the PowerPoint adapter.

## Remote allowlist audit

| Viewer field | Raw/helper source | Validated/normalized source | Host-resolved source | Decision and rationale |
|---|---|---|---|---|
| envelope `availability` | none | none | publisher mapping | Emit only `connecting`, `active`, or `source-unavailable`; viewer alone derives stale/disconnected. |
| PowerPoint `reason` | helper outcome/state | `BridgePollOutcome`; `PresentationSourceState` | `PowerPointViewState.kind` | Map to PowerPoint-specific presentation/not-running/no-slideshow/helper-unavailable reasons inside the v1 payload. |
| `slideNumber`, `slideCount` | `slideNumber`, `totalSlides` | `PresentationSnapshot` | `PowerPointViewPresentation` | Include as nullable integers. |
| `displayTitle` | `title`, `filename` | normalized title/filename | `displayTitle()` / `filenameBasename` | Include only after separator/control-character/length sanitization; disclosure only. |
| video `ordinal` | video array order / raw id | normalized videos | `PowerPointVideoTile.ordinal` | Include ordinal; exclude raw COM id. |
| video `label` | video name | validated string | tile/display row | Include sanitized label in disclosure only. |
| video `status` | raw `status`/`playing` | `resolveVideoStatus()` | tile status | Include canonical status. |
| duration/elapsed/remaining | helper milliseconds | normalized/scalar fallback | tile milliseconds | Include finite non-negative values or null. |
| focus/headline | raw primary id/index | focus/status history | host-selected tile and headline mode | Include resolved ordinal/modes; never let viewers reselect. |
| envelope epoch/sequence/time | none | none | none | Publisher/server generated; never added to helper/core. |
| full `filename` / paths | helper | retained internally | basename/display helpers | Exclude. Sanitization creates a new optional label; it never forwards path fields. |
| `instanceId` | helper | retained internally | internal only | Exclude COM/process identity. |
| `processCount`, `selectedPid`, `comPid`, `affinityMismatch` | helper | diagnostics | multiple-instance warning | Exclude machine/affinity data. |
| `protocolVersion`, `productVersion`, `selectedMediaId`, observation metadata | helper/validator | diagnostics | `deriveObservationMeta()` | Exclude local diagnostics. |
| warnings/extensions/edit-slide videos | validator/helper | validation/fallback data | not required by view | Exclude. |
| window/display geometry and Electron actions | Electron main/IPC | n/a | renderer controls | Exclude. |
| credentials, link tokens, publisher lease | session services | n/a | n/a | Never enter a snapshot or logs. |

S1 golden fixtures must include every excluded field and prove that validation fails rather than silently forwarding it. Adversarial title fixtures cover `/`, `\\`, UNC prefixes, control characters, excessive length, and misleading extensions.

## Cloud data model

All paths are additive and separate from public room data:

| Path | Client access | Key fields | Cleanup |
|---|---|---|---|
| `/presentationSessions/{sessionId}` | deny viewer; owner reads through callables | `publisherUid`, `publisherLeaseHash`, `epoch`, `lastSequence`, `status`, `sourceKind`, `roomId?`, `viewerGeneration`, `activeWindowExpiresAtMs`, `lastPublishAtMs`, `activeViewerCount`, `cleanupAfterMs` | TTL on `cleanupAfterMs`; scheduled reconciler handles dependent top-level docs. |
| `/presentationSessionSnapshots/{sessionId}` | viewer read only; no client writes | validated `RemoteSnapshotV1`, `cleanupAfterMs` | TTL on `cleanupAfterMs`. |
| `/presentationSessionViewerStates/{sessionId}` | matching viewer generation read only | `status`, `sourceKind`, `viewerGeneration`, `activeWindowExpiresAtMs`, `lastPublishAtMs`, `cleanupAfterMs` | TTL on `cleanupAfterMs`. |
| `/presentationViewerLinks/{tokenHash}` | deny all clients; callable only | `sessionId`, `viewerGeneration`, `status`, `expiresAtMs`, `cleanupAfterMs` | TTL. Plain token never stored. |
| `/presentationViewerLeases/{leaseId}` | rules may `get`; no direct client read/write | `sessionId`, `viewerGeneration`, `status`, `expiresAtMs`, `cleanupAfterMs` | TTL plus scheduled count reconciliation. Created only if S2 ratifies hard-cap enforcement. |
| `/presentationRequestResults/{uid_requestId}` | deny all clients; callable only | operation, request hash, completed result/error, `cleanupAfterMs` | 24h TTL; durable idempotency for lost responses. |
| `/presentationPublisherAuthChallenges/{challengeId}` | deny all clients; auth callables only | hashed verifier, status, approved uid, expiresAtMs, `cleanupAfterMs` | Five-minute TTL; one-time system-browser sign-in exchange. |

No composite query is required for steady-state publish/read. Cleanup/reconciliation queries require single-field indexes on `cleanupAfterMs`, `sessionId`, `status`, and `expiresAtMs`; high-churn `sequence` and timestamp fields are exempted from unnecessary indexing. Callable idempotency is backed by `/presentationRequestResults`: the first transaction stores the normalized request hash and result, retries with the same request return that result, and reuse with a different request fails. Publisher authentication uses a system-browser approval route because embedded Google OAuth is not an accepted Electron boundary; the one-time challenge binds the browser-authenticated owner to the desktop app without exposing the refresh credential to the browser URL.

### Viewer-generation revocation

The opaque link resolves to a custom token with claims `{ role: 'presentation-viewer', sessionId, viewerGeneration, leaseId? }`. The field name `viewerGeneration` is identical in session, link, lease, claim, and response documents. Rules compare it to the live session document. Rotation or revocation increments the session generation, immediately invalidating existing claims on the next rules evaluation even though Firebase Auth remains signed in. Ending a session keeps the generation, writes viewer state `ended`, and denies snapshot reads; connected viewers can render the safe ended state. Link revocation increments generation, so the revoked viewer loses both snapshot and viewer-state access.

## Endpoint contract

All public secrets are accepted only over HTTPS. Viewer links use `/session/:sessionId/view#token=<opaque>` so the token is not sent in the HTTP path, query string, access logs, or referrer. Logs contain session ID, UID, epoch, sequence, error code, and latency only—never opaque tokens, hashes, display titles, or video labels.

| Operation | Route and authorization | Request → response | Transaction/data effects | Idempotency, limits, errors, retry | Verification |
|---|---|---|---|---|---|
| Begin publisher sign-in | callable `beginPresentationPublisherAuth`; unauthenticated publisher app with PKCE verifier | `{challenge,codeChallenge,callbackUri}` → `{challengeId,approvalUrl,expiresAtMs}` | Store five-minute one-time challenge hash. Publisher opens approval URL in the system browser. | 10/min/device/IP; `resource-exhausted`; retry creates a new challenge. | Emulator covers expiry/replay; desktop test proves system-browser launch and deep-link/loopback callback. |
| Approve/complete publisher sign-in | authenticated browser route approves; callable `completePresentationPublisherAuth` exchanges verifier | `{challengeId,codeVerifier,deviceId}` → `{customToken,serverNowMs}` | Bind challenge to signed-in owner, consume once, mint a dedicated publisher-device Firebase principal with claims `{role:'presentation-publisher',ownerUid,deviceId}`. Publisher signs in through a `safeStorage`-backed Auth persistence adapter. | One-time; `permission-denied`, `deadline-exceeded`, `already-exists`; never retry consumed exchange. | Staging uses real Google/Firebase approval, device-token refresh, sign-out, and refresh-token revocation scoped to the device principal rather than the owner's normal sessions. |
| Create session | callable `createPresentationSession`; authenticated publisher-device principal | `{clientRequestId, roomId?}` → `{sessionId, publisherLease, viewerUrl, epoch:1}` | Create session, viewer state, link hash; initialize viewer generation and 24h active window. Enforce max three active sessions/owner as a configurable abuse guardrail. | Idempotent through `/presentationRequestResults`; 5/min/uid; `unauthenticated`, `resource-exhausted`, `already-exists`; retry only with same request ID. | Emulator asserts active-session cap, durable idempotency, hashed-at-rest secrets, and distinct publisher/viewer credentials. |
| Resume/replace publisher | callable `resumeOrReplacePresentationPublisher`; owner auth + prior lease or explicit takeover confirmation | `{sessionId, clientRequestId, takeover}` → `{publisherLease, epoch, viewerUrl}` | Transaction checks owner/current lease, rotates lease, increments epoch, resets sequence, extends active window. | Idempotent by request ID; 10/min/uid; `permission-denied`, `not-found`, `failed-precondition`; retry same ID. Foreign/second publisher is rejected. | Concurrent emulator test proves one winner and stale lease rejection. |
| Issue/rotate link | callables `issuePresentationViewerLink`, `rotatePresentationViewerLink`; owner + publisher lease | `{sessionId, clientRequestId}` → `{viewerUrl, viewerGeneration, expiresAtMs}` | Store new token hash; rotate increments `viewerGeneration` and invalidates prior link/leases. | 10/min/session; `permission-denied`, `failed-precondition`; non-repeat request creates a new secret, so retry same ID. | Old link and established old generation lose read access after rotation. |
| Revoke link | callable `revokePresentationViewerLink`; owner + lease | `{sessionId, clientRequestId}` → `{revoked:true,viewerGeneration}` | Revoke link, increment `viewerGeneration`, mark leases revoked, update safe viewer state. | Idempotent; 10/min/session; safe retry. | Existing listener receives permission denial; resolving old token fails. |
| Resolve/admit viewer | HTTPS callable `resolvePresentationViewerLink`; unauthenticated opaque token | `{sessionId, token}` → `{customToken, leaseId?, serverNowMs, activeWindowExpiresAtMs}` | Hash token; verify active link/window/session. If hard cap, transactionally admit/renew a 90s lease and count. | 30/min/IP plus session cap; `permission-denied`, `resource-exhausted`, `not-found`; exponential backoff only for transient errors. | Production test covers real custom-token sign-in; emulator covers claims and denial paths but not signature/expiry. |
| Renew viewer lease | callable `renewPresentationViewerLease`; authenticated matching viewer | `{leaseId}` → `{expiresAtMs,serverNowMs}` | Extend 90s lease; reconcile count/status. Client renews every 30s. | 6/min/lease; idempotent per lease; stop retry after revoked/ended. | Hard-cap mode only: expiry/revocation removes access and count. |
| Publish snapshot | callable `publishPresentationSnapshot`; owner auth + publisher lease | `{sessionId,epoch,sequence,observedAtMs,availability,payload}` → `{acceptedSequence,publishedAtMs}` | Reconstruct strict allowlist; transaction checks active session, lease, epoch, and `sequence == lastSequence + 1`; set server time; write full snapshot, viewer state, last publish/cleanup. | Server cap 5 writes/sec/session; `invalid-argument`, `permission-denied`, `failed-precondition`, `aborted`; retry same sequence only on unknown outcome, treating already-accepted as success. | Emulator covers forbidden fields, foreign/stale publisher, duplicate/out-of-order, transition + heartbeat. |
| Bootstrap/subscribe | Firestore reads of viewer state + snapshot; custom-token claims and optional lease | no request body → two document listeners | No writes. Attach viewer-state listener first, then current snapshot; reducer requires a full snapshot before live. | SDK reconnects; permission loss is terminal until link is resolved again. | Rules tests deny unauthenticated/wrong-generation/expired/ended/lease-expired reads. |
| End session | callable `endPresentationSession`; owner + lease | `{sessionId,clientRequestId}` → `{ended:true}` | Transaction writes viewer state `ended`, session `ended`, revokes publisher lease, sets cleanup +7d. Snapshot reads become denied. | Idempotent; 10/min/session; safe retry. | Viewer renders ended from safe state; subsequent publish/read denied. |
| Cleanup | scheduled `cleanupExpiredPresentationSessions`; service account | internal batch → metrics | Reconcile expired leases/counts; delete dependent top-level docs; TTL remains a safety net. | Retry-safe by document ID; bounded batches; alarms on backlog. | Unit-test eligibility boundaries; staging verifies TTL/scheduler because emulator is insufficient. |
| Attach/detach room | callables `attachPresentationSessionRoom` / `detachPresentationSessionRoom`; owner | `{sessionId,roomId?,clientRequestId}` → `{roomId}` | Update optional room only; no link/claim/snapshot semantics change. | Idempotent; 10/min/session. Future slice, disabled in v1 UI. | Emulator proves room attachment grants no extra viewer/publisher authority. |
| LAN snapshot | Socket.IO server event `REMOTE_SNAPSHOT`; admitted LAN viewer JWT | full `RemoteSnapshotV1` | No cloud writes; Companion emits validated snapshots and bootstrap replay. | Same epoch/sequence reducer; existing 20-device cap, 10m pairing code, 8h JWT. | Contract parity fixtures produce identical display state over cloud and LAN. |

Routing every transition and heartbeat through a callable adds invocation and cold-start latency. Session creation/resume occurs before first publish and should warm the deployment; S3 also measures cold and warm `publishPresentationSnapshot` latency and records whether a production `minInstances` setting is required. That cost is included in the S2 service policy and staging load-test budget rather than hidden behind a Firestore-only p95 target.

### Rules predicates

Client writes to all five collections are denied. Callable/Admin writes must enforce their own transactions. Viewer reads require:

- authenticated claim role `presentation-viewer`;
- claim `sessionId` equals requested document ID;
- claim `viewerGeneration` equals the current private session generation;
- session is active and `request.time` is before the active window for snapshot reads;
- if hard-cap mode is ratified, the claim's lease exists, matches `sessionId` and `viewerGeneration`, is active, and has not expired.

The safe viewer-state document may remain readable to the matching current generation after `status: ended` so the UI can render an explicit end state. Rotation/revocation changes generation and removes that access. Existing public `/rooms` rules remain unchanged and never authorize these collections.

### Cloud viewer-cap decision

S2 must record both a number and enforcement mode:

- **Recommended:** support and hard-admit at most 50 concurrent viewer **leases**/session; lease 90 seconds, renew every 30 seconds. The number is a product/cost/load-test guardrail, not a Firestore limit or a count of unique humans.
- **Alternative:** a documented 50-viewer support target with monitoring only. This is simpler but cannot truthfully reject the 51st viewer.

If hard-cap mode is chosen, S3 implements leases, transactional `activeViewerCount`, expiry reconciliation, and rules checks. `sessionStorage` reuses a lease across same-tab reloads, but a closed tab or new tab may transiently consume another lease until the old 90-second lease expires; this bounded over-count is accepted and the cap is explicitly on active leases, not people. Acceptance requires a staged load test with 50 admitted leases receiving snapshots for 30 minutes, a p95 transition-to-render target recorded before the run, zero sequence regressions, and deterministic denial of lease 51 after bounded stale-lease reconciliation. A higher cap requires a new load-test result, not a constant-only edit. Each snapshot read performs one rules `get()` for session state and, in hard-cap mode, one for the lease; this read amplification is included in cost/load measurements.

## Publisher boundary and lifecycle

### Decision gate

1. **Separate `apps/downstage-publisher` (recommended).** Keeps Firebase, credentials, background lifecycle, link management, and retry policy out of `apps/ppt-timer`. A shared `packages/powerpoint-host` preserves the exact host-resolved semantics for both applications.
2. **Extend `apps/ppt-timer`.** Requires explicit approval to cross its content boundary, change `window-all-closed` behavior, add tray/background lifecycle, add Firebase dependencies, and broaden the S-033 IPC/security review (`apps/ppt-timer/src/main/ipc.ts:1-35`).
3. **Companion-hosted publisher (rejected).** It expands the denylisted `companion/src/main.ts` composition root and couples cloud session ownership to LAN room infrastructure.

The recommendation is Option 1 because it meets the explicit outer-publisher requirement, preserves the local app's packaging/security surface, and avoids inventing an out-of-process tap into IPC that is intentionally restricted to `mainWindow.webContents` (`apps/ppt-timer/src/main/ipc.ts:10-35`).

### Option 1 implementation shape

- Extract the app-neutral coordinator, focus tracker, status stabilizer, and adaptive poll policy into `packages/powerpoint-host`. Preserve public behavior with characterization tests before moving code. `apps/ppt-timer/src/main/session-host.ts` becomes a thin compatibility import/wrapper.
- `apps/downstage-publisher` imports `@ontime/powerpoint-host`, `@ontime/remote-viewer-contracts`, Firebase client auth/callables, and Electron. It owns no presentation normalization or focus logic.
- **One observer per show machine:** standalone `apps/ppt-timer` and Remote publisher mode are mutually exclusive. Both acquire the same Windows host lock from `packages/powerpoint-host` before spawning `ppt-probe`; the second process shows a deterministic "PowerPoint already in use by another Downstage host" state and does not start another helper/COM client. Remote publisher mode renders the shared compact timer face locally, so the operator does not need both apps running. Cross-process tests cover clean exit and stale-lock recovery after a crash.
- Owner sign-in uses the system-browser challenge flow in the endpoint table, reusing the existing web Google/Firebase authentication rather than embedding OAuth. Approval mints a dedicated publisher-device Firebase principal containing `ownerUid`, so revoking that device's refresh tokens does not sign the owner out elsewhere. The publisher uses a `safeStorage`-backed Firebase Auth persistence adapter and separately encrypts the publisher lease; only atomic non-secret metadata is stored beside them. Sign-out clears persistence and revokes the device principal. `settings-store.ts` is not reused.
- Startup loads encrypted state, authenticates or refreshes the owner, offers resume/replace or new session, obtains a new lease/epoch, acquires the single-host lock, then starts the shared PowerPoint host. Process restart or lost/taken lease increments epoch; a transient network reconnect with the same valid lease keeps the epoch and next sequence.
- Each `onView` event maps to an allowlisted full snapshot and publishes immediately. A 10-second scheduler republishes the latest complete snapshot with the next sequence.
- Network loss queues only the latest complete snapshot, never an unbounded delta log. A transient reconnect with the still-valid lease keeps the epoch and next sequence, then publishes the latest full state. Only process restart, lease replacement/takeover, or server-declared lease loss increments epoch and resets sequence to one.
- Shutdown stops new publishes, attempts one final unavailable/ended status only when semantically correct, waits a bounded network drain, then closes the shared host/helper. A failed final publish never delays helper shutdown indefinitely.

## Source-neutral timer-face extraction

### Boundary

`packages/timer-face` is a framework-free DOM/CSS package. It accepts only `TimerDisplayModel`; it imports no PowerPoint, Firebase, React, Electron, room, or control types. `apps/ppt-timer` supplies its existing PowerPoint adapter, the browser wraps the DOM mount in a React lifecycle component, and `apps/downstage-view` loads the same viewer bundle.

```typescript
type TimerDisplayModel = {
  connection: 'connecting' | 'live' | 'stale' | 'disconnected' | 'ended' | 'unavailable'
  timeText: string
  statusText: string
  messageText?: string
  badge?: 'playing' | 'paused' | 'retry' | 'warning'
  disclosureRows: DisclosureRow[]
}

type DisclosureRow = {
  key: string
  nameText: string
  statusText: string
  timeText: string
  isFocus: boolean
}
```

### Extraction map

| Symbol/surface | Current location | Destination/classification | Rule |
|---|---|---|---|
| `formatTime()` | `renderer/view.ts:91-102` | `timer-face` pure formatting | Preserve exact output and tests. |
| `RenderModel`, `VideoRowModel` | `renderer/view.ts:27-51` | reshape into display model/row | Remove PowerPoint state types from public surface. |
| `announcementFor()` | `renderer/view.ts:312+` | timer-face accessibility | Input is display model only. |
| `timerFitWidthCqw()`, `setTimerText()` | `renderer/powerpoint-panel.ts:38-52` | timer-face DOM utility | Preserve fit behavior. |
| compact `.status`, `.time`, palette, timer stack | `renderer/styles.css:1-167` | timer-face CSS | Preserve charcoal face and visual tokens. |
| `describeView()` | `renderer/view.ts:228+` | PowerPoint adapter | Converts host/remote PowerPoint semantics into display model. |
| `renderPowerPointPanel()`, `renderVideoList()` | `renderer/powerpoint-panel.ts:58-93` | split generic face mount from PowerPoint disclosure adapter | Rows stay adapter-provided; DOM is shared. |
| `localAdvanceMs()` | `renderer/view.ts:108-114` | remains local PowerPoint adapter | Two-second COM-poll bound is not remote freshness. |
| `PlaybackClock`, `VideoClock`, `clockValue()` | `renderer/playback-clock*.ts` | remains local PowerPoint-only | Never used for remote interpolation. |
| `PanelSessionState`, `reconcilePanelState()` | `renderer/panel-state.ts` | PowerPoint disclosure UX | Characterize auto-open/Escape behavior before deciding what shell state is shared. |
| `renderOptionStrip()` | `renderer/panel-options.ts` | PowerPoint-only options | Timing/headline/diagnostic controls do not enter read-only viewers. |
| `renderWindowControls()` | `renderer/panel-options.ts` | Electron wrapper | Not in browser shell. |
| `mountApp()`, `renderApp()`, `PreloadApi`, `RendererAction` | renderer main / IPC contract | Electron-only | Remain app wrappers. |

Characterization precedes extraction. `apps/ppt-timer` must pass its existing 430-test baseline plus targeted DOM snapshots before and after the move. Remote adapters get new fixtures for connecting, ready, playing, paused, ended, helper unavailable, stale, disconnected, multi-video disclosure, and source switching. Switching source/epoch recreates adapter state so no prior rows, clocks, titles, or focus leak.

## Surface flows

### Cloud browser

1. Publisher creates or resumes a session and receives a lease/epoch.
2. `onView` publishes a full snapshot; the 10-second heartbeat republishes full state.
3. Operator shares `/session/:sessionId/view#token=<opaque>`.
4. Viewer resolves the fragment token, receives a custom token/server time/optional lease, removes the token from browser history state, and signs in.
5. Viewer subscribes to safe viewer state, then current snapshot; it validates and reduces before adapting to `TimerDisplayModel`.
6. The existing timer face renders status/time; the disclosure reveals sanitized rows.
7. On route change/unmount, teardown detaches viewer-state then snapshot listeners, cancels the monotonic interpolation/freshness clock, stops lease renewal, and best-effort releases the lease. Tab visibility may reduce paint frequency but never renew after teardown.
8. Permission loss, stale/disconnect, end, and reconnect follow the failure table below.

`SessionViewerPage` is a new route. It does not import `useRoom`, `useTimers`, `useTimerEngine`, `UnifiedDataContext`, or `FirebaseDataContext`.

### Downstage View desktop

`apps/downstage-view` is a thin Electron wrapper around the same viewer-only frontend bundle. It adds platform window geometry, always-on-top, tray, deep-link handling, and secure storage for viewer credentials; it contains no helper, COM, PowerPoint observation, publisher, room editing, or timer-control dependency. Cloud and LAN adapters produce the same reducer events.

### LAN

S9 reuses Companion HTTPS/WSS, certificate trust, pairing-code/JWT lifecycle, and 20-device cap. It adds independently typed `REMOTE_SNAPSHOT_PUBLISH` and `REMOTE_SNAPSHOT` events in `packages/interface-contracts`, both carrying `RemoteSnapshotV1`. The Windows publisher connects to Companion over loopback as a new `presentation-publisher` role using a one-time, loopback-only token minted by Companion; Companion validates and caches the latest full snapshot by session, then bootstraps/broadcasts `REMOTE_SNAPSHOT` to admitted viewer roles. It never mirrors cloud state back into LAN and never accepts publication from a LAN viewer. A narrow Companion adapter imports the contract; pure packages never import `companion/src/main.ts`. Pairing remains room-scoped in the first LAN slice, while the event includes presentation `sessionId`. Existing `PRESENTATION_*` replay is untouched.

## Failure, expiry, and recovery

| Condition | Publisher/server behavior | Viewer behavior | Required proof |
|---|---|---|---|
| PowerPoint absent | Publish envelope `source-unavailable` with PowerPoint reason `powerpoint-not-running` and no slide/video timing. | Show explicit unavailable copy; no numeric timing. | Contract + adapter fixtures. |
| No slideshow | Publish envelope `source-unavailable` with reason `no-slideshow` and no slide/video timing. | Show canonical no-slideshow copy. | Fixture. |
| Helper failure | Publish envelope `source-unavailable` with reason `helper-unavailable` when host reports it. | Stop timing immediately. | Host/publisher integration. |
| Network loss | Keep only latest full local state; no delta queue. Reconnect with the same lease/epoch and next sequence; bump epoch only after process restart or lease loss. | Live until 25s, stale until 60s, then disconnected; same-epoch recovery avoids a full UI reset. | Fake-clock reducer + integration. |
| Publisher restart/sleep | Resume rotates lease and increments epoch; sequence restarts at one. | Higher epoch resets all state; lower epoch ignored. | Concurrent/ordering tests. |
| Duplicate/out-of-order | Transaction rejects non-next sequence; retry can confirm prior acceptance. | Reducer independently drops duplicates/regressions. | Function + pure tests. |
| Old bootstrap doc | `resolve` supplies server time; current snapshot carries server publish time. | Compute age using estimated server offset; start stale/disconnected if already old. | Skew fixtures. |
| Link rotation/revocation | Increment viewer generation and revoke leases. | Existing listener loses access; show access-ended, not stale PowerPoint. | Rules + real Auth staging. |
| Session end | Write safe state `ended`, then deny snapshot/publish. | Render ended from safe state and stop reconnecting. | Emulator ordering test + UI. |
| 24h window expiry | Rules/callables compare live session deadline. | Access-ended; token expiry is irrelevant. | Fake-time rules where possible + staging. |
| Seven-day inactivity | Set cleanup fields; scheduled cleanup and TTL remove top-level docs. | No access long before deletion. | Cleanup unit + staging TTL observation. |
| Unknown source/schema | Reject before adapter. | Visible unsupported state; never use PowerPoint fallback. | Validator/route tests. |
| Clock skew | Server assigns publish time; resolve returns server time. | Freshness uses estimated server time and local monotonic receipt time. | ±5-minute skew fixtures. |

## File-by-file impact

| Slice | Path | Operation/owner | Purpose |
|---|---|---|---|
| S0 | `frontend/src/lib/firebase.ts`, `frontend/.env.example`, focused config test | modify / Mac | Parameterize emulator ports; defaults match `firebase.json`. |
| S1 | `packages/remote-viewer-contracts/{package.json,tsconfig.json,src/**}` | create / Mac | Envelope, payload, sanitizer, reducer, fixtures. |
| S1 | `package.json`, dependency guardrails | modify / Mac | Register package and boundary checks. |
| S2 | `.agents/issues/ISSUE-002.md`, current spec and this plan | modify / owner | Record publisher/cap decisions and unblock conditions. |
| S3 | `functions/src/presentation-sessions.ts`, `functions/src/index.ts` | create/modify / Mac | Callables, rate limits, transactions, cleanup. |
| S3 | `firebase/firestore.rules`, `firebase/tests/presentationSessions.emu.js`, `firebase/package.json` | modify/create / Mac | Viewer reads, deny writes, auth/revocation tests and scripts. |
| S3 | Firestore indexes/TTL configuration | create/modify / Mac | Cleanup/reconciliation fields; exempt high-churn fields. |
| S4 | `packages/timer-face/**` | create / Mac | Source-neutral model, DOM renderer, CSS, accessibility. |
| S4 | `apps/ppt-timer/src/renderer/{view.ts,powerpoint-panel.ts,styles.css,main.ts}` and tests | modify / Windows owner | Characterize/extract shared surface with no behavior change. |
| S5 | `frontend/src/routes/SessionViewerPage.tsx`, `frontend/src/hooks/usePresentationSession.ts`, `frontend/src/components/session-viewer/**`, `AppRouter.tsx` | create/modify / Mac | Viewer link resolve, subscriptions, reducer adapter, route/UI. |
| S5 | `frontend/src/lib/viewer-links.ts` | modify / Mac | Generate session fragment URLs separately from room URLs. |
| S6 | `packages/powerpoint-host/**` and app-local host-policy files | create/move / Windows | Shared host-resolved publication semantics. |
| S6 | `apps/ppt-timer/src/main/session-host.ts` and tests | modify / Windows | Compatibility wrapper and regression proof. |
| S6 | `apps/downstage-publisher/**` | create / Windows | Remote publisher, secure state, lifecycle, packaging. |
| S7 | publisher Windows integration/manual evidence docs | modify/create / Windows | Remote host/Presenter View/sleep/reconnect acceptance. |
| S8 | `apps/downstage-view/**`, viewer-only frontend build wiring | create/modify / Mac+Windows | Shared desktop wrapper and packaging. |
| S9 | `packages/interface-contracts/src/remote-snapshot-envelopes.ts`, barrel/tests | create/modify / Mac | Typed publisher-ingest and viewer-delivery event wrappers around the remote contract. |
| S9 | `companion/src/remote-snapshot.ts`, bounded `main.ts` registration, tests | create/modify / Mac | Loopback publisher admission, latest-snapshot cache, LAN bootstrap/broadcast without LiveCue reuse. |
| S10 | none | frozen | Future stage-timer sender remains out of scope. |

## Stop conditions

Stop the active slice and return to planning if any of these occurs:

- a pure package imports Firebase, Socket.IO, React, Electron, Node process APIs, `local-sync-arbitration`, `UnifiedDataContext`, `FirebaseDataContext`, or `companion/src/main.ts`;
- a new production file under `packages/` or `apps/` exceeds 400 lines without the repository's explicit exception;
- remote code duplicates elapsed/headline/focus/status formulas instead of consuming the host-resolved contract;
- `apps/ppt-timer` visible behavior, helper lifecycle, S-033 IPC restriction, or packaging changes outside the characterized compatibility work;
- any cloud or LAN path carries `LiveCue`, full filenames/paths, process/COM identity, diagnostics, credentials, or control actions;
- a test/manual gate is reported PASS without being run and its evidence read;
- two concurrent slices need the same rules, package, interface-contract, packaging, or viewer file.

## Execution index

Stable IDs are identifiers, not execution order. S2 is a global decision gate and executes before any implementation despite its retained ID.

| ID | Goal | Done when | Key files | Dependencies | Size |
|---|---|---|---|---|---|
| S2 | Ratify publisher boundary and cloud cap/value/enforcement. | Decisions recorded in issue, spec, and plan; readiness rerun is implementable. | Issue/spec/plan | none | S |
| S0 | Make browser/emulator configuration authoritative. | Frontend ports are configurable and default to checked-in emulator ports; existing emulator suites pass. | Firebase config files | S2 | S |
| S1 | Create strict transport contract and reducer. | Allowlist, versioning, ordering, freshness, skew, and adversarial fixtures pass with clean boundaries. | remote-viewer-contracts | S0 | M |
| S3 | Build cloud session/auth/publish/read/cleanup plane. | All callables/rules/cleanup tests pass; production-only auth/TTL gaps are named. | Functions/rules/tests | S1 | XL |
| S4 | Extract and reuse the exact timer face. | Local app behavior is unchanged; browser-ready model/DOM/CSS and source-switch tests pass. | timer-face + ppt-timer renderer | S1 | L |
| S5 | Deliver browser viewer using fixtures then cloud. | New session route resolves link, subscribes, renders, stales, ends, and reconnects correctly. | frontend session viewer | S3,S4 | L |
| S6 | Deliver separate Windows publisher if recommended boundary is ratified. | Shared host semantics, secure persistence, create/resume/publish/heartbeat/reconnect work with live PowerPoint. | powerpoint-host + publisher | S3,S1 | XL |
| S7 | Validate Remote host behavior on show hardware. | Presenter View/confidence output stays clean through sleep/reconnect/end; evidence recorded. | publisher/manual evidence | S6 | M |
| S8 | Package Downstage View for macOS and Windows. | Same viewer bundle works over cloud and has no helper/COM dependency; platform user tests pass. | downstage-view | S5,S6 | XL |
| S9 | Add LAN transport after the contract/viewer are proven. | Same snapshot/reducer passes pairing, bootstrap, stale, revoke, and 20-device checks. | interface-contracts/Companion | S1,S4,S6 | L |
| S10 | Reserve future stage-timer publication. | No ISSUE-002 implementation; only the adapter seam is proven by S1/S4 fixtures. | none | future issue | — |

## Detailed work items and verification

### S2 — Owner decisions and readiness

- Record the publisher boundary, cloud cap number, and hard-vs-advisory enforcement.
- Update the endpoint/data sections if the selected cap changes lease documents or callables.
- Rerun `spec-plan-readiness`; a blocked verdict authorizes no test/code delegation.

### S0 — Emulator parity

- Add Vite emulator host/port variables and defaults matching Auth 9099, Firestore 8081, Functions 5002.
- Preserve production initialization and single-connect guards.
- Add a focused configuration test; do not attempt browser-side Emulator Hub discovery.
- Run:
  - `npm run test --workspace frontend`
  - `npm run test:rules --workspace ontime-firebase-rules`
  - `npm run test:join-operator --workspace ontime-firebase-rules`
  - `npm run lint --workspace frontend && npm run typecheck --workspace frontend`
- PASS: frontend and `firebase.json` agree, Node hub-discovery tests still pass, and no production emulator connection occurs without the flag.

### S1 — Contract, sanitizer, and reducer

- Create package scripts for `test`, `typecheck`, and CJS/ESM build only if consumers require both.
- Implement types, strict parsers, sanitizers, fake-clock reducer, golden fixtures, and import-boundary checks.
- Run:
  - `npm run test --workspace @ontime/remote-viewer-contracts`
  - `npm run typecheck --workspace @ontime/remote-viewer-contracts`
  - `npm run guardrails`
- PASS: every allowed/excluded field is covered, unknown keys fail, schema/source majors fail safely, epoch/sequence/freshness/skew cases pass, and the package imports no transport/UI/runtime framework.

### S3 — Cloud plane

- Implement the endpoint table exactly, including system-browser publisher authentication, durable request-result idempotency, hashing, transactions, viewer-generation revocation, safe viewer state, optional hard-cap leases, active-session cap, and cleanup metrics.
- Deny all client writes; permit only scoped viewer reads.
- Keep existing room rules unchanged.
- Run:
  - `npm run build --workspace functions`
  - `npm run test:rules --workspace ontime-firebase-rules`
  - new `npm run test:presentation-sessions --workspace ontime-firebase-rules`
  - `npm run guardrails`
- PASS: unauthenticated/wrong-session/wrong-generation/viewer writes fail; publisher conflicts, stale leases, duplicate/out-of-order sequences, idempotent lost-response retries, active-session cap, link rotation, revocation, end, expiry, and cleanup boundaries pass. A staging checklist remains required for real custom-token refresh/revocation, system-browser sign-in, rule re-evaluation, callable cold/warm latency, rate limits, and TTL.

### S4 — Timer-face extraction

- Add characterization tests before moving `formatTime`, display-model shapes, timer-fit DOM, accessibility text, and compact CSS.
- Keep PowerPoint selection, status stabilization, `localAdvanceMs`, `PlaybackClock`, options, and Electron actions outside the shared package.
- Adapt `apps/ppt-timer` through a compatibility layer; do not change visible copy, layout, disclosure, focus restoration, or timing.
- Run:
  - `npm run test --workspace @ontime/ppt-timer`
  - `npm run typecheck --workspace @ontime/ppt-timer`
  - `npm run test --workspace @ontime/timer-face`
  - `npm run typecheck --workspace @ontime/timer-face`
  - `npm run guardrails`
- PASS: the existing 430-test baseline remains green, before/after DOM fixtures match, the shared face has no PowerPoint/Electron/Firebase imports, and source/epoch switches leak no state.

### S5 — Browser viewer

- Build fixture-first route/component tests before connecting Firebase.
- Resolve fragment token, remove it from visible/history URL state, sign in, then attach safe-state and snapshot listeners in order.
- Treat rules denial/access end differently from stale publisher data.
- On unmount/route change, detach both listeners, cancel interpolation/freshness ticks, stop lease renewal, and best-effort release the lease; same-tab reload reuses the session-stored lease.
- Run:
  - `npm run test --workspace frontend`
  - `npm run lint --workspace frontend`
  - `npm run typecheck --workspace frontend`
  - `npm run build:viewer --workspace frontend`
- PASS: RPV-003/007/008/010 browser cases pass; teardown tests show zero remaining listeners/timers/renewals; no forbidden contexts/hooks are imported; stale time stops; compact/disclosure behavior matches the baseline; console/network contain no secrets.
- User-testing gate: exercise share-link resolve, compact/disclosure, publisher stop→stale/disconnected, reconnect, rotation, and end in current Chrome, Safari, and Firefox; capture screenshots plus console/network checks.

### S6 — Shared host and publisher

- Characterize app-local focus/status/poll policies, extract them with the coordinator, and keep `ppt-timer` behavior unchanged.
- Implement the shared single-host lock before helper spawn; deterministic second-host rejection and stale-lock recovery prevent dual COM observers.
- Implement system-browser owner authentication, `safeStorage` refresh-token/lease persistence, server revocation on sign-out, and atomic non-secret metadata.
- Implement latest-state-only retry, same-epoch transient reconnect, epoch reset only on restart/lease loss, bounded shutdown, and publish cadence.
- Run on Windows:
  - `npm run test --workspace @ontime/powerpoint-host`
  - `npm run typecheck --workspace @ontime/powerpoint-host`
  - `npm run test --workspace @ontime/ppt-timer`
  - `npm run typecheck --workspace @ontime/ppt-timer`
  - publisher `test`, `typecheck`, and `build` scripts added by the slice
  - `npm run guardrails`
- PASS: source-equivalent local tests stay green; a second local host cannot spawn a helper; live publish contains no excluded field; one publisher lease wins; heartbeat is 10s; transient reconnect preserves epoch/sequence continuity; restart or lease loss produces a new epoch/full snapshot; owner refresh and sign-out/revocation work; secrets never appear in JSON/logs.

### S7 — Windows acceptance

- Exercise real Remote host mode with slideshow and Presenter View, multiple videos, helper failure, PowerPoint close/reopen, network loss, sleep/wake, app close, session end, and packaged publisher.
- PASS: show and confidence outputs are never covered; local timer behavior stays intact; reconnect/end semantics match the plan; screenshots/log redaction evidence is attached.

### S8 — Downstage View

- Wrap the viewer-only bundle; keep geometry/always-on-top/deep-link/tray logic in Electron main/preload.
- Do not package `ppt-probe`, COM bindings, publisher code, controller code, or Firebase secrets.
- Run platform `test`, `typecheck`, `build`, and packaging scripts added by the slice plus `npm run guardrails`.
- PASS: cloud fixtures and live cloud work on macOS/Windows; user-testing screenshots prove compact/disclosure/access-ended states; bundles contain no helper/COM dependency.

### S9 — LAN adapter

- Add a new remote-snapshot envelope/event and narrow Companion registration; never wrap `LiveCue`.
- Admit `REMOTE_SNAPSHOT_PUBLISH` only from the loopback `presentation-publisher` role, validate/cache the full snapshot, then bootstrap `REMOTE_SNAPSHOT` to viewer roles; use the same reducer and freshness thresholds.
- Run:
  - `npm run test --workspace @ontime/interface-contracts`
  - `npm run test --workspace companion`
  - `npm run build --workspace ontime-companion`
  - `npm run guardrails`
- PASS: cloud/LAN fixtures reduce identically; non-loopback or viewer-role publication is rejected; viewer role cannot control; old/revoked tokens fail; device 21 is rejected; reconnect bootstraps full current state.

## RPV conformance plan

| Scenario | Closing slices | Required evidence before `Conformed` |
|---|---|---|
| RPV-001 | S6,S7 | Live Windows publisher plus Presenter View/confidence-monitor evidence. |
| RPV-002 | S4,S6,S8 | Shared face fixtures and desktop live countdown on both platforms. |
| RPV-003 | S3,S5 | Rules/callable emulator evidence and browser viewer workflow. |
| RPV-004 | S9 | LAN pairing/JWT/read-only/device-cap integration. |
| RPV-005 | S4,S5,S8 | Import/bundle proof that viewer surfaces contain no helper/COM dependency. |
| RPV-006 | S1,S4,S6 | Host-resolved headline fixture and adapter/disclosure rendering. |
| RPV-007 | S1,S3,S5,S9 | Higher-epoch reset, duplicate rejection, and full bootstrap over both transports. |
| RPV-008 | S1,S4,S5 | Fake-clock stale/disconnected tests and no-advance UI proof. |
| RPV-009 | S5,S9 | Identical snapshot fixtures yield identical display models over cloud/LAN. |
| RPV-010 | S3,S5,S9 | Rules/socket denial of all viewer writes/control and unchanged show authority. |

The implementation pass creates `docs/spec/downstage-remote-powerpoint-viewer.conformance.md` with every row initially `Not-built`. A row changes only after the named evidence is independently read; plan text or a delegated report is not evidence.

## Platform ownership

| Area | Mac owner | Windows owner | Shared-file rule |
|---|---|---|---|
| Remote contract/reducer | S1 | review fixtures | Mac owns package files. |
| Cloud Functions/rules/browser | S0,S3,S5 | Windows consumes contract | Mac owns cloud files. |
| Timer face | S4 package/browser | S4 local-app adapter | One owner per file; characterize before extraction. |
| PowerPoint host/publisher | contract review | S6,S7 | Windows owns host/local/publisher files. |
| Downstage View | shared renderer/macOS package | Windows package | Mac owns renderer; Windows owns platform packaging. |
| LAN adapter | S9 contract/Companion | live Windows LAN validation | Mac owns event/adapter files. |

No two concurrent slices edit packaging, rules, interface-contract, timer-face, or viewer files. Windows owns all changes that could alter local PowerPoint behavior.

## Risk and rollback register

| Risk | Prevention/detection | Rollback |
|---|---|---|
| Privacy field leakage | Reconstruct allowlist server-side; adversarial fixtures; redact logs. | Disable publisher callable/session route; no existing data touched. |
| Auth session survives token expiry | Live generation/status/window/lease checks in rules; staging revocation test. | Revoke generation and disable link resolution. |
| Hard-cap count drift/over-count | Short leases, same-tab reuse, transactional count, bounded expiry reconciliation, and lease-not-human semantics in UX/support docs. | Switch to documented advisory mode only through S2 decision update. |
| Rules read amplification | Measure session plus optional lease `get()` costs at the ratified cap; exempt unused indexes. | Use advisory cap/remove lease rule only through S2 decision update. |
| Emulator differs from production | Explicit staging gates for Auth refresh, rate limiting, rule re-evaluation, TTL. | Keep feature unavailable publicly. |
| Publisher epoch collision | Server increments epoch transactionally; durable state is advisory; transient reconnect does not bump. | Replace lease/epoch and force full snapshot. |
| Dual local COM observers | Shared cross-process host lock acquired before helper spawn; crash/stale-lock tests. | Stop second host; preserve the first observer. |
| Publisher owner/device credential leakage | System-browser one-time challenge, dedicated device principal, `safeStorage` Auth persistence, redacted logs, device-scoped refresh-token revocation. | Revoke the device principal and session lease; clear encrypted local state without signing out the owner's other clients. |
| Lost callable response duplicates work | Durable request-result documents keyed by owner/request ID and normalized request hash. | Return cached result; reject mismatched request reuse. |
| Host extraction regresses local app | Characterization-first extraction and full ppt-timer suite/manual smoke. | Revert extraction; publisher cannot ship until shared seam is restored. |
| Timer face drifts visually | DOM fixtures, screenshots, and local app reuse of shared package. | Keep old adapter/shim while correcting package. |
| Companion god-file growth | New narrow adapter; `main.ts` only registers it; review line budget. | Defer LAN or design separate relay; cloud remains unaffected. |
| TTL leaves orphaned data | Top-level TTL documents plus scheduled reconciler. | Scheduled delete by session ID; authorization already denies access. |
| Network retry storm | 5 writes/sec limit, latest-state-only queue, same-sequence acknowledgement. | Back off and render stale; never replay unbounded deltas. |

Cloud rollback is additive: disable new Function exports and viewer route, restore the rules block, revoke all generations, and delete presentation-session collections. Existing rooms, timers, locks, local app data, and helper behavior remain untouched.

## Open questions and readiness

### B1 — Publisher boundary

Owner must ratify either the recommended separate `apps/downstage-publisher` plus shared `packages/powerpoint-host` and mutually exclusive single-observer runtime, or an explicit extension of `apps/ppt-timer`. Companion-hosted publication is rejected. This decision changes S4/S6 file ownership, packaging, S-033 review, local-host locking, and rollback.

### B2 — Cloud viewer cap

Owner must ratify the cloud number and whether it is hard-admitted or advisory. Recommendation: hard cap 50 concurrent 90-second **leases**/session with 30-second renewals, accepting bounded reload/close over-count and validating 50 leases for 30 minutes in staging. LAN remains 20.

```text
verdict: BLOCKED
blocking_gaps:
  - B1 publisher boundary not ratified
  - B2 cloud viewer cap and enforcement not ratified
scenario_to_test_map: intentionally deferred until the decisions are recorded and spec-plan-readiness reruns
task_to_scenario_map: see RPV conformance plan
first_safe_task: omitted because blocked authorizes no implementation
```

After B1/B2 are recorded, materialize the endpoint and conformance companion specs from this plan, link them from ISSUE-002, rerun `spec-plan-readiness`, and begin with S0 only if the verdict is `implementable`.

## References

- `docs/spec/downstage-remote-powerpoint-viewer.spec.md`
- `docs/plans/downstage-remote-powerpoint-viewer-2026-08-22.md`
- `docs/prompts/issue-002-repoprompt-ce-planning-2026-08-25.md`
- `.agents/issues/ISSUE-002.md`
- `docs/progress/backlog-2026-08-25-issue-002-planning.md`
- `docs/interface.md`
- `docs/local-offline-lan-plan.md`
- `docs/rebuild-extraction-rules.md`
- [Firestore realtime queries at scale](https://firebase.google.com/docs/firestore/real-time_queries_at_scale)
- [Firestore best practices](https://firebase.google.com/docs/firestore/best-practices)
- [Firebase custom tokens](https://firebase.google.com/docs/auth/admin/create-custom-tokens)
- [Firebase custom claims](https://firebase.google.com/docs/auth/admin/custom-claims)
- [Firestore Security Rules conditions](https://firebase.google.com/docs/firestore/security/rules-conditions)
- [Firestore TTL](https://firebase.google.com/docs/firestore/ttl)
- [Firestore Emulator](https://firebase.google.com/docs/emulator-suite/connect_firestore)
