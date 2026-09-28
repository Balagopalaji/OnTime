---
Type: Progress
Status: current
Owner: Loop orchestrator
Last updated: 2026-09-28
Issue: ISSUE-002
Spec: docs/spec/downstage-remote-powerpoint-viewer.spec.md
Endpoint contract: docs/spec/downstage-remote-powerpoint-viewer.endpoints.md
Plan: docs/plans/downstage-remote-powerpoint-viewer-deep-plan-2026-08-26.md
Conformance: docs/spec/downstage-remote-powerpoint-viewer.conformance.md
---

# Downstage remote PowerPoint viewer — Loop progress

```json
{
  "branch": "backlog/ISSUE-002-downstage-remote-viewer",
  "worktree": "/Users/radhabalagopala/Dev/onTime2/.repoprompt-worktrees/OnTime/rp-agent-176d035b-backlog-issue-002-downstage-remo-f2ad72f2",
  "baseBranch": "codex/issue-002-remote-viewer",
  "baseSha": "7533c67bfeaea1fc41288e63ea6182feea3dbcda",
  "loopSession": "176D035B-3F92-4E16-B33E-C49FC150E1ED",
  "phase": "Implement: S4a verified",
  "currentTask": "S4b — next",
  "worktreeStateAtPreflight": "clean",
  "reviewCycleCounts": {"S0": 2, "S1a": 1, "S1b": 1, "S3a": 1, "S3b": 2, "S3c": 2, "S3d": 4, "S4a": 1},
  "stableFindingSignatures": [
    "P2|frontend/src/lib/firebase.ts|invalid emulator port override|S0",
    "P2|frontend/src/lib/firebase.test.ts|ambient Vite env leakage|S0",
    "P2|frontend/src/lib/firebase.test.ts|copied default port literals|S0",
    "P2|packages/remote-viewer-contracts/src/sanitize.ts|bidi/format/lone-surrogate characters survive|S1a",
    "P2|packages/remote-viewer-contracts/src/parse-payload.ts|presentationState not tied to row playback|S1a",
    "P2|packages/remote-viewer-contracts/src/parse-payload.ts|intra-row timing arithmetic unchecked|S1a",
    "P3|packages/remote-viewer-contracts/src/parse-payload.ts|sparse videos array compacted|S1a",
    "P3|packages/remote-viewer-contracts/src/parse-payload.ts|unavailable payload read before shape check|S1a",
    "P3|packages/remote-viewer-contracts/src/strict.ts|negative zero passes through|S1a",
    "P3|packages/remote-viewer-contracts/src/sanitize.ts|ZWJ/ZWNJ stripped; slash over-stripping|S1a",
    "P2|packages/remote-viewer-contracts/src/viewer-session.ts|old observation shown live and over-advanced|S1b",
    "P2|packages/remote-viewer-contracts/src/ordering.ts|non-playing timing changes never material|S1b",
    "P3|packages/remote-viewer-contracts/src/ordering.ts|remaining drift ignored|S1b",
    "P3|packages/remote-viewer-contracts/src/ordering.ts|previous vs last-published ambiguity|S1b",
    "P3|packages/remote-viewer-contracts/src/timing.ts|viewer clock ignores round trip|S1b",
    "P3|packages/remote-viewer-contracts/src/parse-snapshot.ts|unbounded freshness policy|S1b",
    "P1|functions/src/presentation/device-auth.ts|attacker-started approval completes for victim owner|S3a",
    "P2|functions/src/presentation/device-auth.ts|revoked device sessions hold cap and stay live|S3a",
    "P2|functions/src/presentation/sessions.ts|secret rotation breaks link update/retry|S3a",
    "P2|functions/src/presentation/callers.ts|owner check is a role denylist|S3a",
    "P3|functions/src/presentation/idempotency.ts|retryable errors persisted|S3a",
    "P3|functions/src/presentation/sessions.ts|replay returns rotated-away URL|S3a",
    "P3|functions/src/presentation/idempotency.ts|request-result ID collision|S3a",
    "P3|functions/src/presentation/device-auth.ts|unauthenticated write amplification / dead begin field|S3a",
    "P2|functions/src/presentation/links.ts|secret rotation yields unresolvable issued/replayed URLs|S3b",
    "P2|functions/src/{lock,operators}.ts|presentation principals accepted by room/lock callables|S3b",
    "P3|functions/src/presentation/links.ts|issue/rotate return already-expired links|S3b",
    "P3|functions/src/presentation/links.ts|missing link doc becomes internal error|S3b",
    "P3|firebase/firestore.rules|attached listeners after revoke untested|S3b",
    "P3|firebase/firestore.rules|isSignedIn role denylist vs owner allowlist|S3b",
    "P3|functions/src/presentation/links.ts|one shared viewer principal per generation|S3b",
    "P3|functions/src/presentation/links.ts|secret rotation revokes previously shared URLs on next issue|S3b",
    "P2|functions/src/presentation/publish.ts|retry hash includes recomputed timing inputs|S3c",
    "P2|functions/src/presentation/publish.ts|undifferentiated failed-precondition blocks resync|S3c",
    "P3|functions/src/presentation/sessions.ts|snapshot outlives session end|S3c",
    "P3|functions/src/presentation/publish.ts|transit clamp literal|S3c",
    "P3|packages/remote-viewer-contracts/package.json|types condition points at CJS build|S3c",
    "P3|functions/src/presentation/publish.ts|replay after window expiry/end returns rejection|S3c",
    "P3|functions/src/presentation/publish.ts|sequence-conflict next step undefined|S3c",
    "P3|packages/remote-viewer-contracts/package.json|exports lacks default condition|S3c",
    "P1|functions/src/presentation/{links,publish}.ts|limits charged before authorization exhaust owner budget|S3d",
    "P2|functions/src/presentation/links.ts|resolve per-session/IP limits block valid viewers|S3d",
    "P2|functions/src/presentation/rate-limit.ts|spoofable/IPv6/missing client IP scope|S3d",
    "P2|functions/src/presentation/cleanup.ts|cleanup stalls; orphaned ppv_ users|S3d",
    "P2|firebase/firestore.indexes.json|session TTL races cascade|S3d",
    "P2|functions/src/presentation/cleanup.ts|backlog alert fires hourly on rate buckets|S3d",
    "P3|functions/src/presentation/cleanup.ts|revoked device ppd_ users orphaned|S3d",
    "P3|functions/src/presentation/rate-limit.ts|publish limiter contention/alert rate|S3d",
    "P3|docs/qa/presentation-remote-viewer-load-plan.md|load plan not a completed gate|S3d",
    "P2|functions/src/presentation/cleanup.ts|deleteUsers quota per session|S3d",
    "P3|functions/src/presentation/rate-limit.ts|fail-closed on missing IP availability|S3d",
    "P3|firebase/firestore.indexes.json|rate buckets pay unused indexes|S3d",
    "P2|functions/src/presentation/cleanup.ts|one failing uid blocks all cleanup|S3d",
    "P2|functions/src/presentation/cleanup.ts|head-of-line/timeout loses progress|S3d",
    "P2|functions/src/presentation/cleanup.ts|narrow throttle detection; overcounted metric|S3d",
    "P2|functions/src/presentation/cleanup.ts|cursor advances past failed chunk|S3d",
    "P2|packages/timer-face/src/render.ts|stateKey can hide stale styling|S4a",
    "P2|packages/timer-face/src/model.ts|isFocus required but unrendered|S4a",
    "P2|packages/timer-face/src/announce.ts|zero-row videoText announcement fallback dropped|S4a",
    "P2|packages/timer-face/src/render.ts|fixed element IDs in reusable face|S4a"
  ]
}
```

## Metadata

- Branch: `backlog/ISSUE-002-downstage-remote-viewer`
- Worktree: `/Users/radhabalagopala/Dev/onTime2/.repoprompt-worktrees/OnTime/rp-agent-176d035b-backlog-issue-002-downstage-remo-f2ad72f2`
- Base branch: `codex/issue-002-remote-viewer`
- Base SHA: `7533c67bfeaea1fc41288e63ea6182feea3dbcda`
- Loop session: `176D035B-3F92-4E16-B33E-C49FC150E1ED`
- Issue: `ISSUE-002` (outer Backlog layer owns status and closure)
- PR: not opened; outer Backlog layer owns push/PR/merge
- Current phase: Implement mode; S1a, S1b, S3a–S3d, S4a verified; S4b next

## Readiness gate

- Inline verdict: **implementable**. RPV-001 through RPV-010 have observable outcomes; the endpoint/process Proposed Surface is explicit; S0–S10 are ordered and dependency-mapped; test layers, success criteria, validation, risk, rollback, and stop rules are present; deferred production/platform choices are explicit non-blocking gates.
- Oracle verdict (`new-chat-E83A12`): **implementable**; `blocking_gaps: []`; spec quality passed.
- Scenario-to-test map: `docs/spec/downstage-remote-powerpoint-viewer.conformance.md` plus the Deep Plan readiness traceability table.
- Task-to-scenario map: Deep Plan `Scenario and conformance mapping` and `Readiness traceability` sections.
- First safe task: **S0 — align frontend emulator configuration with `firebase.json`**.
- Non-blocking checks to perform in owning slices: revalidate plan line references against live code; empirically verify Electron 43.2.0 utility-process port/package behavior in S6a; retain Auth/TTL/rate-limit/load/Presenter View checks as staging or release gates.

## Task ledger

| Task | Deep Plan item | Scenarios | Files/surfaces | Owner/session | Tests | Status | Evidence |
|---|---|---|---|---|---|---|---|
| S0 | Emulator port configuration | Infrastructure prerequisite; no scenario claim | `frontend/src/lib/firebase.ts`, `.env.example`, config test; emulator harness cleanup | GPT-6 Sol in existing worktree | focused config 8/8; frontend 248/248, lint/typecheck; rules 6/6; join exits 0 | verified | Firestore/Functions defaults match `firebase.json` (8081/5002); invalid overrides fall back; `deleteApp(app)` closes join harness resources. |
| S1a | Strict envelope/payload/parser package | RPV-003–RPV-010 (contract layer only) | `packages/remote-viewer-contracts` (types, sanitizer, candidate/request/snapshot parsers), CI wiring, lockfile workspace entry | Claude Opus 5.5 orchestrator (direct; see context exceptions) | 246 unit tests: sanitizer table/idempotence; per-parser reconstruction, forbidden-field golden rejects, version/source, availability/payload, payload invariants | verified | red 230/230 `not implemented`; green 246/246; typecheck; guardrails + boundaries pass; Oracle review no P0/P1. |
| S1b | Reducer/timing/comparator/freshness | RPV-002,003,006–009 (contract layer only) | `packages/remote-viewer-contracts` `timing.ts`, `ordering.ts`, `viewer-session.ts` | Claude Opus 5.5 orchestrator (direct) | 72 new unit tests: transit/offset/advance/interpolation, ±5 min skew, order comparator, material comparator, reducer ordering/terminal/incompatible, fake-clock freshness 25 s/60 s, RPV-009 identical projection | verified | red 44 `not implemented` then 12 review-fix reds; green 318/318; typecheck; guardrails pass; Oracle review no P0/P1. |
| S2 | Ratified D1/D2 decision gate | no runtime claim | docs | complete before Loop | n/a | complete | Deep Plan records supersession. |
| S3a | Publisher-device auth/session creation | RPV-003,007,010 (server layer) | `functions/src/presentation/{config,crypto,requests,callers,idempotency,device-auth,sessions,firestore,index}.ts`, `functions/src/index.ts`, `firebase/tests/{emu-harness,presentation-auth-session.emu}.js`, `firebase/package.json` `test:presentation`, functions `test` script + tsconfig test exclude | Claude Opus 5.5 orchestrator (direct) | unit 17 (RFC 7636 vector, canonical hash, link derivation, strict requests); emulator 9 cases | verified | red: callables `not-found` 6/6, then 7/9 review-fix reds; green emulator 9/9, unit 17/17; functions build; rules + join-operator regressions pass; guardrails pass. |
| S3b | Viewer links/generation/rules | RPV-003,007,010 (server/rules layer) | `functions/src/presentation/{links,sessions,callers,crypto,index}.ts`, `functions/src/{lock,operators}.ts` (principal guard), `firebase/firestore.rules`, `firebase/tests/{presentation-harness,presentation-links.emu,presentation-auth-session.emu}.js` | Claude Opus 5.5 orchestrator (direct) | emulator 12 cases (resolve claims, viewer read-only + RPV-010 denials incl. room create and room/lock callables, rotate/revoke/issue generations, attached-listener revocation, expiry, ended); unit +1 (secret rotation) | verified | red 0/10 (`not-found`), review-fix red 3/12 + unit 1; green S3a 9/9, S3b 12/12, unit 18/18, rules suite exit 0, join-operator exit 0, guardrails pass; Oracle re-review closed all S3b findings. |
| S3c | Publish transaction/current state | RPV-001,003,006–010 (server layer) | `functions/src/presentation/{publish,sessions,idempotency,index}.ts`, contracts CJS build (`tsconfig.cjs.json`, `build:cjs`, `smoke:cjs`, exports), functions dependency/prebuild, `.gitignore`, `firebase/tests/presentation-publish.emu.js` | Claude Opus 5.5 orchestrator (direct) | emulator 9 cases (stamped parser-valid snapshot, viewer read, identical/recomputed-timing retry, conflict/gap/regression reasons, heartbeat, sanitization, forbidden/server-owned keys, null/future send estimate, unavailable, foreign device/owner user, epoch reset, end + snapshot deletion) | verified | red 0/9 (`not-found`), review-fix red 4/9; green S3a 9/9, S3b 12/12, S3c 9/9; contracts 318/318 + CJS smoke; functions unit 18/18; rules + join-operator exit 0; guardrails pass; Oracle re-review closed all. |
| S3d | Cleanup/TTL/indexes/rate limit/load plan | RPV-003,007,008,010 (server layer; staging gates open) | `functions/src/presentation/{rate-limit,cleanup,crypto,links,publish,sessions,device-auth,index}.ts`, unit tests `{rate-limit,cleanup,firestore-config}.test.ts`, `firebase/firestore.indexes.json`, `firebase.json`, `firebase/tests/{presentation-limits.emu.js,run-presentation-emu.mjs,presentation-harness.js}`, `docs/qa/presentation-remote-viewer-load-plan.md` | Claude Opus 5.5 orchestrator (direct) | unit 53 (limiter windows/keys/limits/fail modes, IP normalization, TTL/index config, paced/isolated/cursor Auth deletion); unscaled emulator 7 (publish 5/s, begin 10/min, resolve 30/min, caller-scoped revoke, cleanup cascade + principals, cursor resume, 520 links, backlog, rate buckets TTL-only) | verified (emulator); staging gates NOT RUN → blocked | reds observed per review round (P1 case confirmed failing against old scope); green unit 53/53; emulator 9/9, 12/12, 9/9, 7/7; rules/join exit 0; guardrails pass; Oracle re-review rounds 2–4 closed all but N-7, fixed with red→green unit test. |
| S4a | Source-neutral timer face | RPV-002,003,005,008,009 (face layer) | `packages/timer-face/{package.json,tsconfig.json,src/{model,format,render,announce,index}.ts,src/timer-face.css,test/goldens.ts}`, CI wiring, lockfile workspace entry | Claude Opus 5.5 orchestrator (direct) | 28 happy-dom tests: 9 exact outerHTML/announcement goldens captured from the unmodified ppt-timer renderer (temporary capture test, not committed), formatTime/fit tables, stage-timer model, data-connection hook, import purity, patch-in-place, CSS rules | verified | red: module absent, then 4 review-fix reds; green 28/28; typecheck; guardrails pass; no app file changed. |
| S4b | Adapt local PPT UI/remote fixtures | RPV-001,002,006,008 | ppt-timer renderer/tests | unassigned | full ppt-timer + DOM parity | pending | Depends on S4a,S1b. |
| S5a | Browser route/resolve/subscription/reducer | RPV-003,007–010 | frontend session route/hook/helper | unassigned | frontend integration | pending | Depends on S3c,S4a. |
| S5b | Browser teardown/access states | RPV-003,007–010 | frontend viewer components/tests | unassigned | leak/teardown/build + user test | pending | Depends on S5a. |
| S6a | Sidecar protocol/broker/lifecycle harness | RPV-001,005,008,010 | ppt-timer publisher-sidecar/main | unassigned | protocol/import/lifecycle | pending | Depends on S1b. |
| S6b | Device auth/encrypted persistence | RPV-001,003,010 | publisher-sidecar auth/store | unassigned | auth/storage tests | pending | Depends on S6a,S3a. |
| S6c | Cloud publish/heartbeat/retry/epoch/UI | RPV-001–003,006–010 | sidecar + app IPC/UI | unassigned | publication/heartbeat/retry suites | pending | Depends on S6b,S3c,S4b. |
| S6d | Package/lifecycle/crash/S-033 | RPV-001,005,007,008,010 | app package/main lifecycle | unassigned | package/full app/guardrails | pending | Depends on S6c. |
| S7 | Live Windows/PowerPoint acceptance | RPV-001,005,007,008,010 | evidence docs | platform hand-off | exact-source suites + manual matrix | pending platform gate | Depends on S6d. |
| S8a | Shared desktop viewer | RPV-002,005,009 | `apps/downstage-view` | unassigned | desktop tests/typecheck/build | pending | Depends on S5b. |
| S8b | macOS packaging | RPV-002,005,009 | desktop packaging | unassigned | macOS package audit/manual | pending platform gate | Depends on S8a. |
| S8c | Windows packaging/no-helper audit | RPV-002,005,009 | desktop packaging | unassigned | Windows package audit/manual | pending platform gate | Depends on S8a,S8b. |
| S9a | LAN envelopes/admission | RPV-004,005,007–010 | interface-contracts + Companion adapter | unassigned | role/contract/admission tests | pending | Depends on S1b,S6c. |
| S9b | LAN cache/bootstrap/parity/cap | RPV-004,005,007–010 | Companion + viewer LAN adapter | unassigned | cache/broadcast/parity/device-21 | pending | Depends on S9a,S5b. |
| S10 | Future stage-timer sender/control | no ISSUE-002 implementation | none | frozen | n/a | frozen | Future issue. |

## Review and escape ledger

Inspected `frontend/src/lib/firebase.ts`, `firebase.test.ts`,
`frontend/.env.example`, `firebase/tests/joinAsOperator.emu.js`, and the
S0 diff. No P0/P1 finding remains.

| Signature | Status | Evidence |
|---|---|---|
| `P2|frontend/src/lib/firebase.ts|invalid emulator port override|S0` | fixed | `parseEmulatorPort` rejects non-integer/out-of-range values; six invalid-value cases pass in the focused 8/8 suite. |
| `P2|frontend/src/lib/firebase.test.ts|ambient Vite env leakage|S0` | fixed | each test stubs both port env values to empty before import; focused and full frontend suites pass. |
| `P2|frontend/src/lib/firebase.test.ts|copied default port literals|S0` | fixed | expected default ports are parsed from checked-in `firebase.json`; focused and full frontend suites pass. |
| `P2|packages/remote-viewer-contracts/src/sanitize.ts|bidi/format/lone-surrogate characters survive|S1a` | fixed | class now `\p{Cc}\p{Cf}\p{Cs}\p{Co}` (u flag); U+061C/U+2060/U+00AD/lone surrogate/private-use rows pass. |
| `P2|packages/remote-viewer-contracts/src/parse-payload.ts|presentationState not tied to row playback|S1a` | fixed | `assertStateMatchesRows`; four contradiction cases pass. S6 adapter must run presentation-core fixtures through projection→adapter→parser to prove no real host state is rejected. |
| `P2|packages/remote-viewer-contracts/src/parse-payload.ts|intra-row timing arithmetic unchecked|S1a` | false_positive (declined) | Plan: ready/paused/ended scalars may be independently null when unmeasured; helper reports remaining separately; enforcing elapsed+remaining≈duration could reject real host data. Interpolation clamps (S1b). |
| `P3|packages/remote-viewer-contracts/src/parse-payload.ts|sparse videos array compacted|S1a` | fixed | indexed loop; sparse-hole test rejects `payload.videos.1`. |
| `P3|packages/remote-viewer-contracts/src/parse-payload.ts|unavailable payload read before shape check|S1a` | fixed | `expectRecord` before discriminant read; getter-not-touched and unknown-key-first tests pass. |
| `P3|packages/remote-viewer-contracts/src/strict.ts|negative zero passes through|S1a` | fixed | numeric helpers normalize `-0`; `Object.is` test passes. |
| `P3|packages/remote-viewer-contracts/src/sanitize.ts|ZWJ/ZWNJ stripped; slash over-stripping|S1a` | fixed (joiners) / accepted trade-off (slash) | joiners preserved by test; `AC/DC`→`DC` documented privacy-over-fidelity. |
| `P2|packages/remote-viewer-contracts/src/viewer-session.ts|old observation shown live and over-advanced|S1b` | fixed | observation-age freshness + capped advance; stale-old-observation and boundary tests pass. |
| `P2|packages/remote-viewer-contracts/src/ordering.ts|non-playing timing changes never material|S1b` | fixed | paused scrub/jitter/timing-appearing cases pass. |
| `P3|packages/remote-viewer-contracts/src/ordering.ts|remaining drift ignored|S1b` | fixed | remaining-correction test passes. |
| `P3|packages/remote-viewer-contracts/src/ordering.ts|previous vs last-published ambiguity|S1b` | fixed | parameter `lastPublished` + doc; accumulation test passes. |
| `P3|packages/remote-viewer-contracts/src/timing.ts|viewer clock ignores round trip|S1b` | fixed | `createServerClock` uses the midpoint sample; skew test passes. |
| `P3|packages/remote-viewer-contracts/src/parse-snapshot.ts|unbounded freshness policy|S1b` | fixed | upper bounds at 10/25/60 s; inflated-policy rejects and tightened-policy accept pass. |
| `P1|functions/src/presentation/device-auth.ts|attacker-started approval completes for victim owner|S3a` | fixed | one-time callback code required; phished-approval case (guessed/missing code) rejected; emulator 9/9. |
| `P2|functions/src/presentation/device-auth.ts|revoked device sessions hold cap and stay live|S3a` | fixed | revoke ends sessions; viewer state `ended`; replacement device creates immediately. |
| `P2|functions/src/presentation/sessions.ts|secret rotation breaks link update/retry|S3a` | fixed | `viewerLinkDocId` stored; resume updates by ID; replay checks recomputed hash. |
| `P2|functions/src/presentation/callers.ts|owner check is a role denylist|S3a` | fixed | allowlist; publisher-token approve denied. |
| `P3|functions/src/presentation/idempotency.ts|retryable errors persisted|S3a` | fixed | `resource-exhausted`/`not-found` not persisted. |
| `P3|functions/src/presentation/sessions.ts|replay returns rotated-away URL|S3a` | fixed | `assertReplayCurrent` (status, nonce, hash, epoch). |
| `P3|functions/src/presentation/idempotency.ts|request-result ID collision|S3a` | fixed | hashed doc ID. |
| `P3|functions/src/presentation/device-auth.ts|unauthenticated write amplification / dead begin field|S3a` | fixed (begin idempotent; not-found not persisted) / deferred (rate limits → S3d) | begin idempotency case passes. |
| `P2|functions/src/presentation/links.ts|secret rotation yields unresolvable issued/replayed URLs|S3b` | fixed | `isCurrentLinkNonce` guards issue/replay/resume; unit swap-secret test passes; Oracle re-review closed. |
| `P2|functions/src/{lock,operators}.ts|presentation principals accepted by room/lock callables|S3b` | fixed | `rejectPresentationPrincipal` in both `requireAuthUid`; viewer/device joinAsOperator + acquireLock denied in emulator. |
| `P3|functions/src/presentation/links.ts|issue/rotate return already-expired links|S3b` | fixed | expired issue/rotate → failed-precondition case passes. |
| `P3|functions/src/presentation/links.ts|missing link doc becomes internal error|S3b` | false_positive | `.data()` is undefined for a missing doc; branch is guarded. |
| `P3|firebase/firestore.rules|attached listeners after revoke untested|S3b` | fixed | attached-listener rotation case passes (state immediate, snapshot next write). |
| `P3|firebase/firestore.rules|isSignedIn role denylist vs owner allowlist|S3b` | fixed | `!('role' in request.auth.token)`; rules suite passes. |
| `P3|functions/src/presentation/links.ts|one shared viewer principal per generation|S3b` | accepted (deliberate) | S3d owns IP/session-scoped limits and `ppv_` cleanup. |
| `P3|functions/src/presentation/links.ts|secret rotation revokes previously shared URLs on next issue|S3b` | accepted (documented cost) | fails safe; recorded for conformance. |
| `P2|functions/src/presentation/publish.ts|retry hash includes recomputed timing inputs|S3c` | fixed | `publishIdentityHash`; recomputed-timing retry returns stored result. |
| `P2|functions/src/presentation/publish.ts|undifferentiated failed-precondition blocks resync|S3c` | fixed | `details.reason` asserted for all six reasons; clock-future carries serverNowMs. |
| `P3|functions/src/presentation/sessions.ts|snapshot outlives session end|S3c` | fixed | end deletes snapshot; asserted. |
| `P3|functions/src/presentation/publish.ts|transit clamp literal|S3c` | false_positive | code uses imported `STALE_AFTER_MS`. |
| `P3|packages/remote-viewer-contracts/package.json|types condition points at CJS build|S3c` | fixed | per-condition types. |
| `P3|functions/src/presentation/publish.ts|replay after window expiry/end returns rejection|S3c` | accepted | next step is resume/stop. |
| `P3|functions/src/presentation/publish.ts|sequence-conflict next step undefined|S3c` | fixed | `details.acceptedSequence` asserted; S6c policy recorded. |
| `P3|packages/remote-viewer-contracts/package.json|exports lacks default condition|S3c` | accepted | matches sibling packages; boundaries pass. |
| `P1|functions/src/presentation/{links,publish}.ts|limits charged before authorization exhaust owner budget|S3d` | fixed | caller-scoped buckets; emulator case fails against old scope, passes now; Oracle closed. |
| `P2|functions/src/presentation/links.ts|resolve per-session/IP limits block valid viewers|S3d` | fixed (session) / blocked (shared NAT → staging) | failed-only session charging; NAT in load plan. |
| `P2|functions/src/presentation/rate-limit.ts|spoofable/IPv6/missing client IP scope|S3d` | fixed in code / blocked (XFF trust → staging) | 8 normalization cases. |
| `P2|functions/src/presentation/cleanup.ts|cleanup stalls; orphaned ppv_ users|S3d` | fixed | chunked, principals first, 520-link case. |
| `P2|firebase/firestore.indexes.json|session TTL races cascade|S3d` | fixed | config test. |
| `P2|functions/src/presentation/cleanup.ts|backlog alert fires hourly on rate buckets|S3d` | fixed | rate buckets TTL-only; emulator asserts. |
| `P3|functions/src/presentation/cleanup.ts|revoked device ppd_ users orphaned|S3d` | fixed | devices no TTL; ppd_ deletion asserted. |
| `P3|functions/src/presentation/rate-limit.ts|publish limiter contention/alert rate|S3d` | blocked (staging) | load plan item. |
| `P3|docs/qa/presentation-remote-viewer-load-plan.md|load plan not a completed gate|S3d` | blocked (staging) | recorded NOT RUN. |
| `P2|functions/src/presentation/cleanup.ts|deleteUsers quota per session|S3d` | fixed | shared paced chunks; unit asserts sleeps. |
| `P3|functions/src/presentation/rate-limit.ts|fail-closed on missing IP availability|S3d` | accepted + staging | paging alert in load plan. |
| `P3|firebase/firestore.indexes.json|rate buckets pay unused indexes|S3d` | fixed | config test. |
| `P2|functions/src/presentation/cleanup.ts|one failing uid blocks all cleanup|S3d` | fixed | per-user isolation unit test; Oracle closed. |
| `P2|functions/src/presentation/cleanup.ts|head-of-line/timeout loses progress|S3d` | fixed | per-unit processing, cursor emulator case, 540 s; Oracle closed. |
| `P2|functions/src/presentation/cleanup.ts|narrow throttle detection; overcounted metric|S3d` | fixed | too-many-requests defers; `authUsersProcessed`; Oracle closed. |
| `P2|functions/src/presentation/cleanup.ts|cursor advances past failed chunk|S3d` | fixed (red→green unit; fresh review deferred to final full-diff review) | clean-prefix cursor test. |
| `P2|packages/timer-face/src/render.ts|stateKey can hide stale styling|S4a` | fixed | `data-connection` for stale/disconnected; CSS matched in DOM test with stateKey playing. |
| `P2|packages/timer-face/src/model.ts|isFocus required but unrendered|S4a` | accepted | plan-defined field; documented as semantic, not styled. |
| `P2|packages/timer-face/src/announce.ts|zero-row videoText announcement fallback dropped|S4a` | fixed | `announceDetail`; ninth golden (`Playing — Intro.mp4`) passes. |
| `P2|packages/timer-face/src/render.ts|fixed element IDs in reusable face|S4a` | accepted (documented) | one face per document; lookups scoped to root. |

The existing join-operator test asserted success but previously hung because
Firebase app resources remained open. A `finally` block now calls
`deleteApp(app)`; the emulator command exits 0 and shuts down all emulators.

## Validation and resume log

- 2026-09-28 (S1a): `npm install` in the worktree (stale ignored `frontend/node_modules` symlink tree removed first; main checkout verified intact). Only lockfile change kept: the new workspace entries; the directory-derived root `name` churn was reverted.
- 2026-09-28 (S1a): red `npm run test --workspace @ontime/remote-viewer-contracts` 230 failed, all `Error: not implemented`; typecheck PASS.
- 2026-09-28 (S1a): green 246/246 after review fixes; `npm run typecheck --workspace @ontime/remote-viewer-contracts` PASS; `npm run guardrails` PASS (static + boundaries, 287 modules).
- 2026-09-28 (S1b): red 44 new failures (`not implemented`), typecheck PASS; review-fix red 12; green `npm run test --workspace @ontime/remote-viewer-contracts` 318/318; typecheck PASS; `npm run guardrails` PASS (293 modules).
- 2026-09-28 (S3a): `npm run test:presentation --workspace ontime-firebase-rules` red 0/6 (`not-found`), review-fix red 2/9, green 9/9; `npm run test --workspace functions` 17/17; `npm run build --workspace functions` PASS; `test:rules` exit 0; `test:join-operator` exit 0; guardrails PASS. Build output in tracked `functions/lib` is restored after each emulator run (it was already stale vs `src` before ISSUE-002; not committed). Pure helpers (crypto/requests) were written before their unit tests; all callable behavior was red-first via the emulator suite.
- 2026-09-28 (S3b): `npm run test:presentation --workspace ontime-firebase-rules` S3a 9/9 + S3b 12/12; `npm run test --workspace functions` 18/18; `test:rules` exit 0; `test:join-operator` exit 0; guardrails PASS.
- 2026-09-28 (S3c): `npm run test:presentation --workspace ontime-firebase-rules` 9/9 + 12/12 + 9/9; `npm run smoke:cjs --workspace @ontime/remote-viewer-contracts` PASS; contracts 318/318; functions unit 18/18; rules/join exit 0; guardrails PASS.
- 2026-09-29 (S3d): `npm run test --workspace functions` 53/53; `npm run test:presentation --workspace ontime-firebase-rules` (runner: scaled 9/9 + 12/12 + 9/9, unscaled 7/7); `test:rules` exit 0; `test:join-operator` exit 0; guardrails PASS.
- `functions/lib` decision: the tracked build output was last committed at 4172fbf and was already stale versus `functions/src` before ISSUE-002; `firebase.json` has no predeploy build, so the repo does not keep lib in sync with src. Emulator runs rebuild lib; after each run the tracked `functions/lib/{index,lock,operators}.js` are restored with `git checkout --` and the generated `functions/lib/presentation/` is removed. No build output is committed. Deploy packaging (build + workspace contracts bundle) is a release gate in the load plan.
- 2026-09-29 (S4a): `npm run test --workspace @ontime/timer-face` 28/28; `npm run typecheck --workspace @ontime/timer-face` PASS; guardrails PASS. Goldens captured by a temporary `apps/ppt-timer/src/renderer/zz-golden-capture.test.ts` that was deleted immediately (app tree unchanged).
- S4a interpretations: `TimerDisplayModel`/`DisclosureRow` add optional adapter hooks `stateKey` (`data-state`), `alertText`, `announceDetail`, row `ordinal` (`data-ordinal`) and `announceLabel`; `messageText` is announced, not rendered; `data-connection` is rendered only for stale/disconnected (local DOM unchanged); `isFocus` kept (plan type) but unstyled; `.videos/.video-row` classes and `#badge/#message/#time/#videos` IDs kept for zero-diff S4b adoption (one face per document). S4b done-criteria: delete the app copies of `formatTime`, the fit helpers, and duplicated CSS rules, and import the package.
- S3d interpretations/divergences (closeout doc sync): limits keyed per (session, caller) for link mutation/end/publish; resolve-session counts failed resolutions only; IP scope = HMAC of normalized IP (IPv4, v4-mapped→v4, IPv6 /64), missing IP fails closed except in the emulator (loopback); emulator-only `PRESENTATION_EMULATOR_RATE_LIMIT_MULTIPLIER` for multi-case suites (unscaled suite proves defaults). No TTL on sessions/devices (sweep owns cascade + Auth principals); rate buckets TTL-only with no index. Cleanup: unit-by-unit, paced shared 1000-uid Auth chunks (20/run), persisted `viewerAuthCleanedThrough` cursor over a clean prefix, throttling defers as backlog, per-unit failures isolated with alerts, `timeoutSeconds: 540`. Staging gates (NOT RUN → blocked): 50-viewer/30-min load, p95, cost, TTL deploy, client-IP trust, shared NAT, limiter contention, Auth quota, deploy packaging.
- S3c interpretations/divergences (closeout doc sync): snapshot doc is `{snapshot: RemoteSnapshotV1, cleanupAfterMs}` (nested so viewers run the strict parser on `snapshot`; S5 rejects any other wrapper key). Publish idempotency hash excludes `observationAgeMs`/`sentAtEstimatedServerMs`. Publish rejections are `failed-precondition` with `details.reason` ∈ `window-expired | epoch-mismatch | sequence-conflict (+acceptedSequence) | sequence-gap | clock-future (+serverNowMs) | session-ended`. S6c policy: `sequence-conflict` → publish latest at `acceptedSequence + 1`; `sequence-gap`/`epoch-mismatch` → resume; `clock-future` → resync offset from `serverNowMs`; `window-expired` → resume; `session-ended` → stop. Replay of a lost response works only while the session/window are live (accepted: next step resume/stop makes it moot). Ending a session deletes the snapshot doc. Contracts `exports` have no `default` condition (matches sibling packages).
- S3b interpretations/divergences (closeout doc sync): revoke's "safe access-ended state" is the `viewerGeneration` increment — existing viewers' `viewerState` listener is denied at once (client renders access-ended), snapshot listener on the next write; no `access-ended` status value is written. `issue` returns the current link, or mints one at the current generation after a revoke or a server-secret rotation (rotation therefore revokes previously shared URLs on the next issue — accepted cost). `issue`/`rotate` require an unexpired window (`failed-precondition`, resume first). `resume` returns `viewerUrl: null` when the link was revoked or the secret rotated. One viewer principal per session generation (`ppv_<hash>`); S3d must rate-limit resolve by HMAC-IP/session and delete `ppv_` users in cleanup. Firestore `isSignedIn()` now excludes any role-bearing token and all lock/operator callables reject role-bearing principals (RPV-010).
- S3a interpretations/divergences (closeout doc sync): `completePresentationPublisherAuth` additionally requires `authorizationCode` and `approvePresentationPublisherAuth` returns `{status:'approved', callbackUrl}` (`<scheme>://publisher-auth?challenge=…&code=…`) — P1 anti-phishing binding; the one-time code is useless without the PKCE verifier. Revoking a device ends its active sessions. Owner = no role claim and provider not custom/anonymous. Viewer-link token = HMAC(serverSecret, sessionId|nonce); session stores `viewerLinkNonce` + `viewerLinkDocId`; plaintext token never stored. Request-result doc ID = sha256(scope, clientRequestId); `resource-exhausted`/`not-found` outcomes are not persisted. Additive session fields: `viewerLinkNonce`, `viewerLinkDocId`, `createdAtMs`, `endedAtMs`. Cap uses a query read inside the transaction; concurrent-create safety relies on Firestore serializable transactions and is a staging check. Web approval page (`/publisher/device/approve`) is not owned by any slice; scheduled with S5 (frontend). Production deploy of Functions with the workspace contracts package is a release gate.
- S1b interpretations: `PublishSnapshotRequestV1.sentAtEstimatedServerMs` is `number | null` (null = no reliable offset ⇒ server transit 0, metric); freshness (live/stale/disconnected) is judged on observation age (`observationAgeMs + preCommitTransitMs + max(0, now − publishedAtMs)`) and the advance is capped at `staleAfterMs` — a refinement of the plan's since-commit-only clamp so a re-published old observation cannot look live (≤ ~1 s earlier stale in normal operation); v1 policy fields may be tightened but not loosened past 10/25/60 s; `MAX_CLOCK_UNCERTAINTY_MS = 2000`; material comparator compares against the last *published* candidate and treats non-playing elapsed/remaining changes >750 ms (or null↔value) as material; viewer and sidecar share one midpoint offset model.
- S1a interpretations (to reconcile in closeout doc sync, not auto-edited): publish request carries `schemaMajor/sourceKind/sourceMajor` although the endpoints table omits them (plan: server "verifies and reconstructs the candidate"); `timing-unavailable` allows playing-status rows whose numerics are all null; every non-`no-video` state needs ≥1 row; `headline.focusedOrdinal` must equal the single `isFocus` row; unknown/forbidden keys are rejected (not dropped); sanitizer is path-basename + Unicode Cc/Cf/Cs/Co removal (ZWJ/ZWNJ kept) + repeated known-extension strip + 80-code-point cap, idempotent; constants `MAX_VIDEO_ROWS=64`, `MAX_DISPLAY_TEXT_LENGTH=80`, `SESSION_ID_PATTERN=[A-Za-z0-9_-]{1,128}`.

- 2026-08-26: Preflight confirmed clean authorized worktree and branch at `7533c67bfeaea1fc41288e63ea6182feea3dbcda`.
- 2026-08-26: Inline readiness passed; independent Oracle `new-chat-E83A12` returned `implementable`, no blockers, first safe task S0.
- 2026-09-28: S0 focused test `npm run test --workspace frontend -- src/lib/firebase.test.ts` **PASS**, 1 file/8 tests.
- 2026-09-28: `npm run test --workspace frontend` **PASS**, 26 files/248 tests; `npm run lint --workspace frontend` **PASS**; `npm run typecheck --workspace frontend` **PASS**.
- 2026-09-28: `npm run test:rules --workspace ontime-firebase-rules` **PASS**, 6/6 tests and clean exit.
- 2026-09-28: `npm run test:join-operator --workspace ontime-firebase-rules` **PASS**, success assertion, exit 0, and emulator shutdown.
- Verification used the existing dependency installation at the main checkout
  through a temporary root `node_modules` symlink. That symlink and the
  generated Firestore debug log were removed after testing; the worktree is
  clean. A future test run in this worktree needs dependencies installed or a
  temporary link to the existing installation.
- No RPV scenario is claimed by S0. The conformance matrix remains 10/10 Not-built. No UI/user test is required for S0.
- Last safe checkpoint: S0 verified. Next safe Deep Plan slice is **S1a**, the strict remote envelope/payload/sanitizer/parser package. Stop here for handoff to Claude Opus 5.5; use this same worktree and branch.

## Context exception log

- 2026-09-28: `agent_run start` is unavailable in this resumed session ("Sub-agents cannot start additional agent runs"). The orchestrator therefore authors tests and implementation directly, slice by slice, and uses the Oracle (`ask_oracle` review mode) as the independent reviewer. The Oracle reads the main checkout rather than this worktree, so review requests paste the slice source inline; its two ledger findings in chat `untitled-chat-BDB681` were against the stale main-checkout ledger and are recorded as false positives.
