---
Type: Deep Plan
Status: current
Owner: KDB
Last updated: 2026-08-26
Scope: ISSUE-002 remote PowerPoint publisher and read-only viewer surfaces.
---

# Downstage Remote PowerPoint Viewer — Deep Plan

## Goal

Extend the existing `apps/ppt-timer` PowerPoint countdown into read-only cloud
browser, shared desktop, and later LAN viewers without recreating its compact
charcoal timer UX or changing its local Windows/PowerPoint behavior. The single
visible timer remains the sole PowerPoint/COM/helper host; a hidden publisher
sidecar owns credentials, cloud/LAN publication, retry, links, and liveness.

The implementation contract is ready for bounded execution. All remote
surfaces remain Not-built; production Auth, TTL, rate-limit, 50-viewer load,
packaging, and real PowerPoint checks remain staging/release gates rather than
blockers to the first implementation slice.

## Ratified decisions

### D1 — one visible PPT Timer and one hidden publisher sidecar

- `apps/ppt-timer` is the only user-facing host and owns `ppt-probe`, COM,
  `PowerPointSession`, canonical `SessionHost`/`HostView`, local face, window,
  and explicit Share Remotely UI.
- An app-internal Electron `utilityProcess` owns Firebase authentication,
  publisher-device credentials, session/link callables, publication,
  heartbeat, retry/backoff, and later loopback Companion publication.
- The sidecar has no window, Start-menu identity, helper/COM access,
  presentation-selection logic, renderer action, or remote-control channel.
- Main sends only strict reconstructed snapshot candidates over a private
  inherited `MessagePort`; it never sends raw `HostView`, paths, process/COM
  identity, diagnostics, or credentials.
- This supersedes the proposed visible `apps/downstage-publisher`,
  `packages/powerpoint-host`, duplicated helper, cross-process COM lock, and
  mutually exclusive timer/publisher workflow.

### D2 — advisory cloud support target of 50 viewers

- V1 supports and load-tests 50 concurrent cloud viewers per presentation
  session. It does not reject viewer 51 through leases or admission counts.
- There are no `presentationViewerLeases`, viewer lease claims, renew/release
  calls, `activeViewerCount`, or lease reconciliation/rule lookups.
- The opaque link, separate viewer identity, `viewerGeneration`, 24-hour access
  window, seven-day cleanup, per-owner active-session cap, distributed abuse
  controls, monitoring, and staged cost/latency measurement remain.
- LAN retains its enforced 20-device limit.

## Current-state evidence

### Local host and security seams

- The helper is a persistent hidden child process with only `poll` and `exit`,
  bounded newline JSON, validation, single in-flight polling, timeout/restart,
  and bounded shutdown (`packages/ppt-bridge/src/process-client.ts:84-94,
  127-147,174-188,230-320,378-394`).
- `createSessionHost()` owns normalized PowerPoint polling and host projection;
  `SessionHostOptions.onView` fires only after replacing the immutable current
  view and revision (`apps/ppt-timer/src/main/session-host.ts:35-50,214-230,
  292-294`). This is the semantic publication seam, not a privacy boundary.
- Main discovers the one helper and creates the one host
  (`apps/ppt-timer/src/main/main.ts:160-174`), then sends renderer projections
  (`main.ts:217-219`). Current close behavior shuts down the host and quits
  (`main.ts:346-367`); sharing therefore needs an explicit hide-versus-quit
  lifecycle.
- Renderer IPC is locked to the exact expected `WebContents`, runtime-validates
  a closed action union, and exposes only get/subscribe/dispatch
  (`apps/ppt-timer/src/main/ipc.ts:14-28`; `shared/ipc-contract.ts:43-56,
  100-166`; `preload/preload.ts:1-22`). S-033 remains load-bearing.
- Current persistence is ordinary JSON (`settings-store.ts:51-86`) and cannot
  store credentials. Electron and electron-builder are exactly pinned at
  `43.2.0` and `26.11.1` (`apps/ppt-timer/package.json:24-29`). The packaged
  helper remains exactly `resources/bin/ppt-probe.exe`
  (`apps/ppt-timer/electron-builder.yml:35-61`).

### Viewer, cloud, and LAN gaps

- The existing `/room/:roomId/view` route uses room/timer contexts and the
  ordinary timer engine; it has no presentation-session credential or snapshot
  (`frontend/src/routes/AppRouter.tsx:74-98`; `ViewerPage.tsx:1-17,89-104,
  169-180`). A new session route must be independent.
- Current Functions export lock/operator operations only, and current public
  rules are room-scoped; no presentation session/link/publish/read contract
  exists (`functions/src/index.ts:1-23`; `firebase/firestore.rules:54-68,
  117-138`).
- Frontend emulator ports currently differ from `firebase.json`: 8080/5001 vs
  8081/5002 (`frontend/src/lib/firebase.ts:44-60`; `firebase.json:22-35`).
- Companion already enforces private-LAN pairing, role-bound JWTs, revocation,
  and a 20-device cap, but current `PRESENTATION_*` envelopes carry `LiveCue`
  without epoch/sequence/privacy isolation (`companion/src/main.ts:140-145,
  1632-1676,3727-3764`; `interface-contracts/src/live-cue-envelopes.ts:31-57`).

## Architecture and dependency boundaries

```text
ppt-probe -> ppt-bridge -> presentation-core -> createSessionHost()/HostView
  -> pure allowlist candidate adapter in ppt-timer main
  -> private MessagePort -> hidden publisher utilityProcess
  -> publishPresentationSnapshot callable -> top-level current snapshot
     OR later loopback REMOTE_SNAPSHOT_PUBLISH -> Companion
  -> strict viewer reducer -> PowerPoint display adapter -> TimerDisplayModel
  -> shared timer face in browser / Downstage View
```

The three contracts are:

1. `RemoteSnapshotV1`: source-extensible transport envelope and strict
   PowerPoint v1 payload, owned by pure `packages/remote-viewer-contracts`.
2. Pure viewer reducer/clock policy, in the same package.
3. Renderer-only `TimerDisplayModel`/DOM/CSS, owned by pure
   `packages/timer-face`; a PowerPoint adapter is the only bridge between wire
   payload and display model.

Pure packages import no Firebase, Electron, React, Socket.IO, app source,
`local-sync-arbitration`, denylisted contexts, or `companion/src/main.ts`
(`docs/rebuild-extraction-rules.md:61-84`). The sidecar is app-internal and may
use Firebase/network APIs but cannot import helper/host modules. Companion's
current CJS constraint means its later adapter remains app-internal until a
compatible contract build is available (`docs/rebuild-progress.md:91-95`).

## Wire contract

### Generic envelope and discriminated payload

```typescript
type RemoteSnapshotV1 = {
  schemaMajor: 1
  sourceKind: 'powerpoint'
  sourceMajor: 1
  sessionId: string
  epoch: number
  sequence: number
  observedAtMs: number
  observationAgeMs: number
  preCommitTransitMs: number
  publishedAtMs: number
  heartbeatIntervalMs: number
  staleAfterMs: number
  disconnectAfterMs: number
  availability: 'connecting' | 'active' | 'source-unavailable'
  payload: PowerPointPayloadV1 | null
}

type PowerPointPayloadV1 =
  | {
      reason: 'presentation'
      presentationState:
        | 'no-video'
        | 'timing-unavailable'
        | 'ready'
        | 'playing'
        | 'paused'
        | 'ended'
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
  | { reason: 'no-presentation' | 'no-slideshow' | 'helper-unavailable' }

type RemoteVideoRowV1 = {
  ordinal: number
  label?: string
  status: 'ready' | 'playing' | 'paused' | 'ended'
  durationMs: number | null
  elapsedMsAtObservation: number | null
  remainingMsAtObservation: number | null
  isFocus: boolean
}
```

The process-boundary candidate is deliberately smaller than the stored wire
snapshot:

```typescript
type RemoteSnapshotCandidateV1 = {
  schemaMajor: 1
  sourceKind: 'powerpoint'
  sourceMajor: 1
  observedAtMs: number
  availability: 'connecting' | 'active' | 'source-unavailable'
  payload: PowerPointPayloadV1 | null
}
```

Main reconstructs this candidate. The sidecar adds `sessionId`, durable
`epoch`, next `sequence`, `observationAgeMs`, and
`sentAtEstimatedServerMs` to the callable request. The server verifies and
reconstructs the candidate, assigns `publishedAtMs`, calculates bounded
`preCommitTransitMs`, and writes heartbeat/stale/disconnect policy values.
Separate candidate, request, and stored-snapshot parsers prevent any layer from
forwarding its input object.

`connecting` carries `payload: null`. `active` requires the presentation
variant. `source-unavailable` requires an unavailable reason and carries no
slide/headline/video/numeric timing. `stale`, `disconnected`, `ended`, and
`access-ended` are reducer/display states only. The strict parser reconstructs
a new object and rejects unknown keys, incompatible majors/source, invalid
numbers, and every invalid discriminant combination.

Exact host-state mapping is:

| `PowerPointViewState.kind` | Envelope | Payload |
|---|---|---|
| `connecting` | `connecting` | `null` |
| `unavailable` | `source-unavailable` | `{reason:'helper-unavailable'}` |
| `powerpoint_not_running` | `source-unavailable` | `{reason:'no-presentation'}` |
| `no_slideshow` | `source-unavailable` | `{reason:'no-slideshow'}` |
| `no_video` | `active` | presentation variant, `presentationState:'no-video'`, empty rows and no timing |
| `timing_unavailable` | `active` | presentation variant, `presentationState:'timing-unavailable'`; media identity may remain but numeric timing is `null` |
| `ready` / `playing` / `paused` / `ended` | `active` | matching `presentationState` and canonical host-resolved rows |

This makes timing unavailability explicit without falsely declaring the
slideshow unavailable. The remote adapter never reselects a headline or status
from raw video fields.

The parser requires every `playing` row to have finite non-negative duration,
elapsed, and remaining values; ready/paused/ended rows may use `null` only when
the host did not measure that scalar. `presentationState:'timing-unavailable'`
requires every numeric row field to be `null`, and `no-video` requires an empty
row list. These invariants make the interpolation formula total rather than
relying on nullable arithmetic.

### Observation-truth timing

The numeric rows are measured by the Windows host before the sidecar invokes a
callable. The plan never labels them as measured at server commit:

- `observedAtMs`: host-clock observation instant, provenance only.
- `observationAgeMs`: `hostClockAtPublishHandoff - observedAtMs`, clamped to
  `>= 0`; a same-clock-domain duration covering observation-to-handoff delay.
- `preCommitTransitMs`: server-calculated duration from the sidecar's
  `sentAtEstimatedServerMs` to `publishedAtMs`, clamped to
  `[0, staleAfterMs]`; covers network ingress and function/transaction time.
- `publishedAtMs`: server time assigned inside the epoch/sequence transaction;
  used for freshness, not as the measurement anchor.

Link resolve returns `serverNowMs`. At receipt, the viewer records a server
offset against its monotonic clock and computes:

```text
estimatedServerNowMs = monotonicNowMs + serverOffsetMs
sinceCommitMs = clamp(estimatedServerNowMs - publishedAtMs, 0, staleAfterMs)
advanceMs = max(0, observationAgeMs + preCommitTransitMs + sinceCommitMs)
elapsedNow = min(durationMs, elapsedMsAtObservation + advanceMs)
remainingNow = max(0, remainingMsAtObservation - advanceMs)
```

Only playing rows advance while the connection is live. Ready, paused, ended,
unavailable, stale, and disconnected rows do not. Local interpolation reaching
zero does not invent an `ended` status; a fresh host observation does. Client
wall time is never cross-subtracted from host/server instants. ±5-minute wall
skew fixtures must produce the same result.

The sidecar recomputes `observationAgeMs` and
`sentAtEstimatedServerMs` immediately before every material and heartbeat
call. It refreshes its server offset from midpoint measurements on successful
callable responses. The server rejects a future estimate beyond bounded clock
uncertainty and clamps excessive transit. If no reliable offset exists, it sets
`preCommitTransitMs = 0`, emits a metric, and conservatively under-advances
until the next acknowledged publish rather than inventing time.

### Material transitions, polls, heartbeat, and budget

The main allowlist adapter emits the newest host candidate at normal host poll
cadence. The sidecar keeps one latest candidate and publishes immediately when
availability/reason, slide identity/count, video set/order, focus/headline,
row status/duration, or sanitized label changes. A playing timing correction is
material when observed elapsed differs from its host-domain prediction by more
than `MATERIAL_TIMING_DELTA_MS = 750`.

Non-material polls replace the pending candidate but are not published. If no
material publish occurs within 10 seconds, the heartbeat publishes that latest
host observation with its real observed values and newly computed age/transit
inputs; it never restamps the last cloud-sent numbers. Every
accepted transition/heartbeat increments sequence.

Staging target: p95 host-observation-to-viewer-DOM paint ≤1,500 ms, including
poll edge, port, callable, Firestore, reducer, and paint. This is a measurement
gate, not a claimed result. Viewers become stale at 25 seconds and disconnected
at 60 seconds without a fresh publish; interpolation stops at stale.

Remote interpolation does not use `localAdvanceMs`, `PlaybackClock`,
`VideoClock`, or `PLAYBACK_DRIFT_THRESHOLD_MS`; those remain PowerPoint/local
poll policies (`renderer/view.ts:72,108-114`; `playback-clock-model.ts`).

### Ordering and epoch

- Same-epoch snapshots require `sequence == serverLastSequence + 1`; viewers
  independently reject `sequence <= lastAppliedSequence`.
- A transient network reconnect or reattached intact port keeps epoch and next
  sequence, then republishes the latest full snapshot.
- `apps/ppt-timer` main restart, sidecar crash/re-spawn, or server-declared
  publisher-device replacement increments the sealed durable epoch and resets
  sequence to one before publishing.
- A higher epoch clears all prior source/display state; a lower epoch is
  rejected. The first event after connect/reconnect must be a full snapshot.

## Privacy allowlist

| Viewer field | Canonical source | Decision |
|---|---|---|
| generic availability | map `PowerPointViewState.kind` | include only connecting/active/source-unavailable |
| PowerPoint reason | `BridgePollOutcome` → `PresentationSourceState` → `PowerPointViewState` | include discriminated reason |
| slide number/count | validated observation → `PresentationSnapshot` → `PowerPointViewPresentation` | include nullable integers |
| display title | `displayTitle()` / basename projection | sanitize separators/control characters/length; disclosure only |
| video ordinal | host tile order | include; raw COM/media ID excluded |
| video label | host-resolved tile label | sanitize; disclosure only |
| status/timing | `resolveVideoStatus()` and projected tile | include canonical finite values/null only |
| focus/headline | host focus tracker and `selectPlayingHeadline()` | include resolved ordinal/modes; viewers never reselect |
| epoch/sequence/times | publisher/server | include; never add to helper/core |
| full filename/deck path | helper/core internal | exclude |
| `instanceId`, process counts/PIDs/COM affinity | helper diagnostics | exclude |
| protocol/product/helper path/warnings/extensions/observation metadata | validator/host diagnostics | exclude |
| edit-slide videos, raw selected media ID | local internals | exclude |
| window/display geometry and renderer actions | Electron | exclude |
| credentials, link tokens/hashes | sidecar/cloud | never enter snapshot/logs |

Golden fixtures seed every forbidden field and prove reconstruction rather
than forwarding. Title/label adversarial cases include `/`, `\\`, UNC prefix,
control characters, misleading extensions, and over-length values.

## Sidecar process, protocol, and secure storage

### Process and channel

Electron's documented `utilityProcess.fork()` provides a Node child and
transferable `MessagePortMain`; it is available from main after `app.ready`.
The compiled sidecar entry is explicitly included by electron-builder inside
the existing product, without another installer identity. Implementation must
verify the exact pinned 43.2.0 behavior and packaged path before S6a exits.

Main creates a per-spawn nonce and channel. `HELLO/READY` negotiates protocol
major, capabilities, maximum message size, and nonce before other messages.
Both ends reject unknown kinds/keys, wrong nonce, incompatible major, and
oversize payloads. Lifecycle messages are `SHARE_START`, `SHARE_STOP`,
`END_SESSION`, `SHUTDOWN`; data is `SNAPSHOT_CANDIDATE`; safe outputs are
`AUTH_REQUIRED`, `SHARE_STATE`, `PUBLISH_STATUS`, `VIEWER_LINK`, `SAFE_ERROR`,
`ACK/NACK`, and `SHUTDOWN_COMPLETE`. Storage brokerage uses opaque
`SEAL_REQUEST`, `UNSEAL_REQUEST`, `CLEAR_SEALED`, and response bytes.

One publish may be in flight and one latest candidate may wait. New candidates
replace the waiting candidate. Port teardown cancels timers, retries, and
pending state. The protocol contains no viewer-to-PowerPoint or helper-control
message. Import/bundle tests deny sidecar access to `ppt-bridge`, helper
discovery, presentation host, renderer IPC, and `child_process`.

### Credential lifecycle

Publisher approval uses the system browser and a registered app callback URI.
`beginPresentationPublisherAuth` creates a five-minute PKCE/state challenge;
the authenticated owner approves in the web app; completion verifies callback
scheme, state, verifier, expiry, owner binding, and one-time consumption.
Success mints a dedicated publisher-device principal, not the owner's normal
session.

The sidecar owns credential meaning. Electron main is the only `safeStorage`
broker and seals/unseals versioned opaque bytes stored in a dedicated atomic
credential file under user data. It never interprets secret fields. Bytes do
not enter JSON settings, preload/renderer IPC, logs, snapshots, approval URLs,
or viewer links. Electron's `safeStorage` encrypt/decrypt calls are synchronous,
so the broker bounds payload size and keeps them off the host polling path;
credential-file replacement remains asynchronous and atomic. On Windows the
encryption is DPAPI-backed. If encryption is unavailable, corrupted, or
temporarily unavailable, sharing is disabled with a redacted actionable error;
there is no plaintext fallback and the local countdown remains operational.

Refresh updates sealed state atomically. Sign-out ends active sharing, revokes
the device's refresh tokens, clears sealed bytes, and leaves other owner
sessions untouched. The account UI lists/revokes devices for lost-device
recovery; server-side device status/generation blocks further session calls.

### Lifecycle table

| Event | Host/main | Sidecar/cloud | Viewer |
|---|---|---|---|
| share start | keep existing host; spawn/handshake sidecar; send latest candidate | authenticate/create or resume; publish full snapshot | resolves link and bootstraps |
| hide/minimize | keep host and sidecar running; never cover show output | unchanged | remains live |
| explicit stop sharing | local host/countdown continues | stop heartbeat/retry, end or pause remote session per explicit UI choice, ACK then idle/exit | ended/access-ended or stales only if network failure |
| sidecar/network failure | show safe retry state; never stop host | latest-only retry; crash re-spawn increments epoch | live→stale→disconnected until recovery |
| app quit/OS shutdown | stop UI actions; request sidecar shutdown; always close host/helper within bounded shutdown | bounded final semantic publish, cancel retry, flush sealed state, ACK; killed after deadline | ended when final end succeeds, otherwise freshness states |
| app update | stop sharing and sidecar before installer handoff | revoke no credentials unless sign-out; resume explicitly after update | ended/disconnected as declared by UI |

Existing single-instance behavior, context isolation, blocked navigation/
popups, S-033 sender identity, package-content tests, helper cleanup, and Store
boundaries must remain green. Hiding is distinct from close/quit; any expansion
of `window-all-closed` is narrow, explicit, and covered by S6d/S7.

## Cloud, browser, and LAN contracts

The exact data, callable, rate-limit, rule, IPC, browser, and LAN matrices are
canonical in
`docs/spec/downstage-remote-powerpoint-viewer.endpoints.md`.

Key invariants:

- callables reconstruct the allowlist and atomically enforce device ownership,
  epoch, exact next sequence, `viewerGeneration`, status, and 24-hour window;
- publish stores a canonical last-request hash/result in the session; because
  the sidecar allows one in-flight sequence, an identical lost-response retry
  returns the stored result while a mismatched same-sequence retry fails;
- durable `/presentationRequestResults` makes lost-response retries for the
  other `clientRequestId` operations safe; publish uses its session-local
  sequence/hash/result transaction instead;
- Firestore-backed fixed-window buckets provide distributed rate limits;
- sensitive auth/link resolution fails closed on limiter failure, while active
  publication may proceed with an alert so infrastructure failure does not
  disconnect a show;
- all snapshot/client writes are denied; matching viewers read only safe state
  and current snapshot through one session-document rules lookup;
- top-level TTL documents plus scheduled cleanup avoid cascade assumptions;
- `/session/:sessionId/view#token=...` uses a dedicated hook/reducer and never
  imports current room/timer contexts;
- route teardown detaches state then snapshot listeners, cancels all clocks,
  clears credentials, and has no lease timer/release;
- later LAN adds independently typed `REMOTE_SNAPSHOT_PUBLISH` and
  `REMOTE_SNAPSHOT`, with a loopback-only publisher role and the existing
  private-LAN trust/pairing/revocation/20-device policy.

## Source-neutral face extraction

| Current symbol/surface | Destination | Rule |
|---|---|---|
| `formatTime`, timer-fit DOM, accessibility announcement, compact palette/stack/time CSS | `packages/timer-face` | pure display-model input; exact output/DOM characterization |
| `RenderModel`/`VideoRowModel` | reshape to `TimerDisplayModel`/`DisclosureRow` | no PowerPoint/Firebase/Electron types |
| `describeView`, PowerPoint status/badge/disclosure-row mapping | PowerPoint adapter | maps host/remote PowerPoint state only |
| `renderPowerPointPanel`/`renderVideoList` | split shared face mount from adapter rows | preserve compact face and list behavior |
| `localAdvanceMs`, `PlaybackClock`, `VideoClock`, `clockValue` | local PowerPoint adapter | never remote/generic timing |
| `PanelSessionState`, auto-open/Escape | PowerPoint disclosure UX | characterize before any shared state |
| PowerPoint options/diagnostics | local PowerPoint UI | absent from read-only viewers |
| native window controls, `mountApp`, preload/actions | Electron wrapper | absent from browser shell |

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

The local app is adapted only after characterization and must retain the
existing status copy, compact geometry, hover controls, disclosure ownership,
focus restoration, and timing. A future stage-timer fixture proves the shell
has no PowerPoint dependency but does not implement a sender.

## Bounded execution index

S0–S10 remain immutable parent IDs. The old S2 owner gate is complete and the
old lease/independent-publisher definitions are superseded. Suffixes split
multi-owner/XL work into exclusive checkpoints.

| ID | Goal / done when | Owner and exclusive paths | Dependencies | Size |
|---|---|---|---|---|
| S0 | Emulator ports configurable and default to `firebase.json`; focused tests green | Mac: `frontend/src/lib/firebase.ts`, `.env.example`, config test | none | S |
| S1a | Strict envelope/payload/sanitizer/parser package | Mac: `packages/remote-viewer-contracts` schema/parser/fixtures | S0 | M |
| S1b | Reducer, observation timing, comparator, skew, freshness fixtures | Mac: same package reducer/clock tests; serialized after S1a | S1a | M |
| S2 | **Complete:** D1/D2 recorded; old gate superseded | docs only | none | — |
| S3a | Publisher-device auth, challenges, device lifecycle, active-session cap, idempotency | Mac: Functions presentation auth/session modules and tests | S1a | M |
| S3b | Viewer links, generation, read authorization/rules | Mac: link Functions, rules, emulator tests | S3a | M |
| S3c | Publish transaction/current snapshot/viewer state | Mac: publish Function and focused tests | S1b,S3b | M |
| S3d | Cleanup, TTL/indexes, rate limits, monitoring and 50-viewer load plan | Mac: cleanup/limiter/config/tests | S3c | M |
| S4a | Characterize and create source-neutral timer face | Mac: `packages/timer-face`; no local app edit | S1a | M |
| S4b | Adapt existing ppt-timer and remote PowerPoint fixtures without UX change | Windows: `apps/ppt-timer/src/renderer/{view.ts,powerpoint-panel.ts,styles.css,main.ts}` and focused tests | S4a,S1b | M |
| S5a | Browser session route/link resolve/subscription/reducer | Mac: new session route/hook/link helper | S3c,S4a | M |
| S5b | Browser teardown/access states/user testing/build | Mac: session-viewer components/tests | S5a | S |
| S6a | Utility-process protocol, broker interface, lifecycle harness; no cloud | Windows: `apps/ppt-timer/src/main/publisher-sidecar/{protocol.ts,launcher.ts,lifecycle.ts,*.test.ts}` and `apps/ppt-timer/src/main/main.ts` | S1b | M |
| S6b | System-browser device auth and encrypted persistence | Windows: `apps/ppt-timer/src/main/publisher-sidecar/{auth.ts,credential-store.ts,*.test.ts}` | S6a,S3a | M |
| S6c | Cloud publication, heartbeat, retry, epoch and session UI state | Windows: `apps/ppt-timer/src/main/publisher-sidecar/{publisher.ts,retry.ts,heartbeat.ts,*.test.ts}`, `apps/ppt-timer/src/{main/main.ts,shared/ipc-contract.ts,preload/preload.ts,renderer/main.ts,renderer/panel-options.ts}` | S6b,S3c,S4b | M |
| S6d | Packaged worker, close/hide/update/shutdown/crash behavior and S-033 audit | Windows: `apps/ppt-timer/{electron-builder.yml,package.json}`, `src/main/{main.ts,package-content.test.ts,main.lifecycle.test.ts}` | S6c | M |
| S7 | Live Windows/PowerPoint/Presenter View acceptance | Windows: evidence docs only after packaged build | S6d | M |
| S8a | Shared desktop viewer wrapper and renderer integration | Mac: `apps/downstage-view/src/{main,preload,renderer,shared}/**`, `package.json`, tests | S5b | M |
| S8b | macOS packaging/notarization-ready named tester build | Mac: `apps/downstage-view/electron-builder.yml` macOS block and macOS package tests | S8a | S |
| S8c | Windows viewer packaging and no-helper bundle audit | Windows: `apps/downstage-view/electron-builder.yml` Windows block and Windows package tests, serialized after S8b | S8a,S8b | S |
| S9a | Independent LAN envelopes and loopback publisher admission | Mac: `packages/interface-contracts/src/remote-snapshot-envelopes.ts`, barrel/tests; `companion/src/remote-snapshot.ts` and registration tests | S1b,S6c | M |
| S9b | LAN cache/bootstrap/broadcast/viewer integration and 20-device proof | Mac: `companion/src/remote-snapshot.ts`, focused Companion tests, and viewer LAN adapter/tests | S9a,S5b | M |
| S10 | Frozen future stage-timer sender/control | none | future issue | — |

## Slice verification, rollback, and stop rules

| Slice group | Automated commands / PASS definition | Manual gate | Rollback / stop |
|---|---|---|---|
| S0 | frontend config test; frontend lint/typecheck/test; rules/join emulator suites | none | revert config; stop if production connects to emulator without flag |
| S1a–b | remote-contract tests/typecheck + guardrails | none | delete unused package; stop on permissive parser/forbidden import/unknown-key pass |
| S3a–d | Functions build; presentation emulator/rules tests; guardrails | staging Auth, TTL, limiter, cold/warm latency, 50 viewers for 30 minutes with p95/reads/cost | disable exports/rules; revoke generations; stop on direct write or non-transactional ordering |
| S4a–b | timer-face tests/typecheck; full ppt-timer suite/typecheck; DOM before/after; guardrails | local visual regression smoke | retain old local renderer shim; stop on timing/UX change or generic PowerPoint import |
| S5a–b | frontend test/lint/typecheck/build; listener/timer leak assertions | Chrome/Safari/Firefox screenshots plus console/network audit | remove route; stop on token in URL/log or room-context import |
| S6a–d | ppt-timer tests/typecheck/build; protocol/import/package-content/lifecycle/crash tests; guardrails | live Windows auth/share/stop/crash/update/quit | feature flag/remove sidecar; stop if second helper, plaintext secret, local countdown interruption, or S-033 regression |
| S7 | targeted host/bridge/core/timer suites rerun on exact source plus packaged manual matrix | PowerPoint/Presenter View/confidence monitor, sleep/wake/network loss | do not release; local app remains authoritative |
| S8a–c | desktop tests/typecheck/build/package-content | macOS and Windows compact/disclosure/access-ended workflows | withdraw viewer package; cloud browser remains |
| S9a–b | interface-contract and Companion tests/build; cloud/LAN parity; unauthorized publish/device-21 denial | private LAN HTTPS/WSS pairing/trust | disable LAN registration; cloud remains |

All commands are **NOT RUN (documentation-only)** in this revision. Every new
production file stays below 400 lines unless the documented pure-wiring
exception applies. No two concurrent slices own the same rules, package,
renderer, sidecar, packaging, or Companion file.

## Scenario and conformance mapping

`docs/spec/downstage-remote-powerpoint-viewer.conformance.md` is canonical and
marks RPV-001 through RPV-010 Not-built. Closing mappings are:

- RPV-001: S6a–S7; RPV-002: S4a–S4b/S8; RPV-003: S3/S5;
- RPV-004: S9; RPV-005: S4/S5/S8; RPV-006: S1/S4/S6;
- RPV-007: S1/S3c/S5/S6c/S9; RPV-008: S1/S4/S5/S6;
- RPV-009: S5/S9; RPV-010: S3/S5/S6a/S9.

The matrix names exact automated and manual evidence. No row changes on an
agent report alone.

### Readiness traceability

| Scenario | Lowest faithful test layer | Why |
|---|---|---|
| RPV-001 | provider/entrypoint integration + Windows smoke | process ownership and show-output behavior cross Electron/COM boundaries |
| RPV-002 | component + desktop integration | shared face is deterministic; platform window behavior is not |
| RPV-003 | service/database integration + browser smoke | callables/rules/listeners plus rendered URL journey |
| RPV-004 | wire-format/adapter integration + LAN smoke | pairing, JWT role, socket admission and HTTPS trust are transport behavior |
| RPV-005 | dependency/package audit + platform smoke | absence from imports/bundles plus launch without PowerPoint |
| RPV-006 | unit/core + component | headline/focus mapping and disclosure are pure deterministic behavior |
| RPV-007 | unit reducer + database/wire integration + Windows smoke | epoch/sequence is pure; bootstrap/restart spans transports/processes |
| RPV-008 | unit fake-clock + component | availability/freshness/no-advance outcomes are deterministic |
| RPV-009 | wire integration + component parity | identical validated events must reduce/render identically |
| RPV-010 | rules/socket integration + live smoke | server permissions and absence of show-side effects both matter |

| Task | Scenarios / explicit rationale |
|---|---|
| S0 | infrastructure prerequisite; claims no scenario behavior |
| S1a | RPV-003–RPV-010 |
| S1b | RPV-002, RPV-003, RPV-006–RPV-009 |
| S2 | completed documentation decision gate; no runtime behavior |
| S3a | RPV-003, RPV-007, RPV-010 |
| S3b | RPV-003, RPV-007, RPV-010 |
| S3c | RPV-001, RPV-003, RPV-006–RPV-010 |
| S3d | RPV-003, RPV-007, RPV-008, RPV-010 |
| S4a | RPV-002, RPV-003, RPV-005, RPV-008, RPV-009 |
| S4b | RPV-001, RPV-002, RPV-006, RPV-008 |
| S5a–S5b | RPV-003, RPV-007–RPV-010 |
| S6a | RPV-001, RPV-005, RPV-008, RPV-010 |
| S6b | RPV-001, RPV-003, RPV-010 |
| S6c | RPV-001–RPV-003, RPV-006–RPV-010 |
| S6d–S7 | RPV-001, RPV-005, RPV-007, RPV-008, RPV-010 |
| S8a–S8c | RPV-002, RPV-005, RPV-009 |
| S9a–S9b | RPV-004, RPV-005, RPV-007–RPV-010 |
| S10 | frozen future issue; no ISSUE-002 implementation |

## Risks and rollback

| Risk | Prevention/detection | Rollback |
|---|---|---|
| privacy leakage | reconstruct in main and callable; adversarial fixtures; redacted logs | disable publish/link resolution; revoke generations |
| sidecar crosses helper boundary | import/package tests and no control message | remove/feature-disable sidecar; local host unchanged |
| credential leakage/storage failure | opaque bounded safeStorage broker kept off the host polling path; atomic file replacement; no JSON/renderer/log fallback | revoke device, delete sealed file, disable remote sharing |
| observation/commit timing drift | observationAge duration + server freshness + skew fixtures | stop interpolation at stale; retain step snapshots while corrected |
| retry storm/lost response | one in-flight+latest, durable idempotency, fixed-window limiter | back off and render stale; never replay deltas |
| generation/expiry survives Auth token | live rules checks on session generation/status/window | increment generation/revoke session |
| TTL/orphan data | top-level TTL plus scheduled cleanup/metrics | bounded delete by session ID |
| callable latency/cost at 50 viewers | warm/cold and 30-minute load/cost gate | named-tester limit/disable remote; no hard lease retrofit |
| local UI/host regression | characterization, full timer suite, S-033/package tests, live Windows acceptance | revert adapter/sidecar; local baseline stays |
| Companion god-file growth | narrow adapter/registration and 400-line/denylist review | defer LAN; cloud unaffected |

## Readiness verdict

```text
verdict: implementable
owner_decisions:
  D1: resolved — one visible ppt-timer plus hidden utility-process sidecar
  D2: resolved — advisory 50-viewer cloud target, no viewer leases
implementation_start_blockers: []
staging_or_release_gates:
  - production publisher-device Auth refresh/revocation and browser callback
  - production Firestore TTL, distributed rate-limit fallback, indexes and cost
  - staged 50-viewer/30-minute load with p95 transition-to-render/read/cost evidence
  - packaged Windows sidecar lifecycle and Presenter View/confidence-monitor evidence
  - macOS/Windows viewer packaging, signing/notarization and user testing
scenario_to_test_map: docs/spec/downstage-remote-powerpoint-viewer.conformance.md
task_to_scenario_map: this plan, Bounded execution index
first_safe_task: S0 — align browser emulator configuration with checked-in firebase.json
```

S0 is infrastructure-only and claims no RPV conformance. S1a begins the first
behavior contract only after S0 passes. ISSUE-002's tracked status remains
unchanged because only the outer orchestrator may alter it.

## References

- `docs/spec/downstage-remote-powerpoint-viewer.spec.md`
- `docs/spec/downstage-remote-powerpoint-viewer.endpoints.md`
- `docs/spec/downstage-remote-powerpoint-viewer.conformance.md`
- `docs/plans/downstage-remote-powerpoint-viewer-2026-08-22.md`
- `docs/prompts/issue-002-deep-plan-revision-2026-08-26.md`
- `docs/rebuild-extraction-rules.md`
- `docs/timer-logic.md`
- `docs/interface.md`
- `docs/local-offline-lan-plan.md`
- [Electron utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process)
- [Electron parentPort](https://www.electronjs.org/docs/latest/api/parent-port)
- [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)
- [electron-builder application contents](https://www.electron.build/docs/contents/)
- [Firestore transactions](https://firebase.google.com/docs/firestore/manage-data/transactions)
- [Firestore Security Rules](https://firebase.google.com/docs/rules/)
- [Firestore realtime queries at scale](https://firebase.google.com/docs/firestore/real-time_queries_at_scale)
- [Firestore TTL](https://firebase.google.com/docs/firestore/ttl)
- [Firebase custom tokens](https://firebase.google.com/docs/auth/admin/create-custom-tokens)
- [Firebase custom claims](https://firebase.google.com/docs/auth/admin/custom-claims)
