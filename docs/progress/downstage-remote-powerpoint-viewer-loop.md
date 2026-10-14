---
Type: Progress
Status: current
Owner: Loop orchestrator
Last updated: 2026-10-14
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
  "phase": "Implement: S6c verified (sidecar + main/IPC/renderer)",
  "currentTask": "S6d — packaged worker, lifecycle, S-033 audit",
  "worktreeStateAtPreflight": "clean",
  "reviewCycleCounts": {"S0": 2, "S1a": 1, "S1b": 1, "S3a": 1, "S3b": 2, "S3c": 2, "S3d": 4, "S4a": 1, "S4b": 1, "S5a": 3, "S5b": 1, "S6a": 1, "S6b": 1, "S6c": 2},
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
    "P2|packages/timer-face/src/render.ts|fixed element IDs in reusable face|S4a",
    "P1|packages/remote-viewer-contracts/package.json|server contracts depend on DOM face package|S4b",
    "P2|apps/ppt-timer/src/renderer/view.ts|local/remote copy duplicated with partial parity|S4b",
    "P2|apps/ppt-timer/src/renderer/main.ts|app re-implements face patch logic|S4b",
    "P2|apps/ppt-timer/src/renderer/styles.css|dead max-height media block restates face values|S4b",
    "P2|apps/ppt-timer/src/renderer/view.ts|stale comments and whitespace|S4b",
    "P1|frontend/src/lib/firebase.ts|viewer import initializes operator default app|S5a",
    "P2|frontend/src/routes/session-viewer/presentation-session-controller.ts|unbounded fixed-rate retries|S5a",
    "P2|frontend/src/routes/session-viewer/presentation-session-controller.ts|listener error never resubscribed|S5a",
    "P2|frontend/src/routes/session-viewer/SessionViewerPage.tsx|reload ends access|S5a",
    "P2|frontend/src/routes/session-viewer/usePresentationSession.ts|StrictMode double resolve|S5a",
    "P1|frontend/src/routes/session-viewer/presentation-session-controller.ts|reconnect path loops at base backoff|S5a",
    "P2|frontend/src/routes/session-viewer/presentation-session-controller.ts|throttled sign-in ends access|S5a",
    "P2|frontend/src/routes/session-viewer/presentation-session-controller.ts|release does not stop async continuations|S5a",
    "P2|frontend/src/routes/session-viewer/presentation-session-controller.ts|duplicate reconnects|S5a",
    "P2|frontend/src/lib/firebase.ts|emulator setting aliases and hard-coded auth port|S5a",
    "P1|frontend/src/routes/session-viewer/session-viewer.css|disclosure caret below the fold|S5b-usertest",
    "P1|frontend/src/routes/session-viewer/SessionViewerPage.tsx|re-issued link in same tab ignored|S5b-usertest",
    "P1|frontend/src/routes/session-viewer/presentation-session-controller.ts|ended session shown as access ended|S5b-usertest",
    "P3|frontend/src/routes/session-viewer/usePresentationSession.ts|StrictMode app-deleted warnings|S5b-usertest",
    "P3|frontend/src/routes/session-viewer/SessionViewerPage.tsx|terminal states show only small label|S5b-usertest",
    "P3|frontend/src/routes/PublisherDeviceApprovalPage.tsx|heading unchanged after approval|S5b-usertest",
    "P1|frontend/src/routes/session-viewer/presentation-session-controller.ts|duplicate app on fresh transport|S5b",
    "P1|frontend/src/routes/PublisherDeviceApprovalPage.tsx|any custom scheme callback opened|S5b",
    "P2|frontend/src/routes/session-viewer/SessionViewerPage.tsx|hashchange path untested|S5b",
    "P2|functions/src/presentation/links.ts|resolve reason set must stay closed|S5b",
    "P2|frontend/src/routes/session-viewer/session-viewer.css|reset skips pseudo-elements|S5b",
    "P1|apps/ppt-timer/src/main/publisher-sidecar/lifecycle.ts|stop/start race orphans a sidecar|S6a",
    "P1|apps/ppt-timer/src/main/publisher-sidecar/lifecycle.ts|refused SHARE_START hangs in starting|S6a",
    "P1|apps/ppt-timer/src/main/publisher-sidecar/protocol.ts|negotiated max size not enforced|S6a",
    "P2|apps/ppt-timer/src/main/publisher-sidecar/protocol.ts|size measured in UTF-16 units|S6a",
    "P2|apps/ppt-timer/src/main/publisher-sidecar/protocol.ts|stop/end commands lack nonce|S6a",
    "P2|apps/ppt-timer/src/main/publisher-sidecar/lifecycle.ts|shutdown without connection keeps stale status|S6a",
    "P2|apps/ppt-timer/src/main/publisher-sidecar/launcher.ts|main-side port never closed|S6a",
    "P2|apps/ppt-timer/src/main/publisher-sidecar/sidecar.test.ts|boundary scan misses package/dynamic imports|S6a",
    "P3|apps/ppt-timer/src/main/publisher-sidecar/lifecycle.ts|respawn budget never refreshes|S6a",
    "P1|apps/ppt-timer/src/main/publisher-sidecar/credential-store.ts|unserialized broker ops resurrect cleared credential|S6b",
    "P2|apps/ppt-timer/src/main/publisher-sidecar/sidecar-core.ts|oversize seal is a protocol violation (crash loop)|S6b",
    "P2|apps/ppt-timer/src/main/publisher-sidecar/sidecar-core.ts|storage request without reply hangs forever|S6b",
    "P2|apps/ppt-timer/src/main/publisher-sidecar/auth.ts|unvalidated completion persists unloadable credential|S6b",
    "P2|apps/ppt-timer/src/main/publisher-sidecar/sidecar-core.ts|approval waiter listener never removed|S6b-self",
    "P2|apps/ppt-timer/src/main/publisher-sidecar/auth.ts|approval wait mixes server expiry with local clock|S6b-self",
    "P3|apps/ppt-timer/src/main/publisher-sidecar/credentials.test.ts|console spies never restored|S6b",
    "P1|apps/ppt-timer/src/main/publisher-sidecar/share-session.ts|end/sign-out after respawn skip the cloud|S6c",
    "P1|apps/ppt-timer/src/main/publisher-sidecar/cloud-client.ts|ambiguous refresh failure wipes credential|S6c",
    "P1|apps/ppt-timer/src/main/publisher-sidecar/sidecar-core.ts|SHARE_START ignored after share ended itself|S6c",
    "P2|apps/ppt-timer/src/main/publisher-sidecar/share-session.ts|stale run halts newer run after persist failure|S6c",
    "P2|apps/ppt-timer/src/main/publisher-sidecar/cloud-client.ts|fetch has no timeout|S6c",
    "P3|apps/ppt-timer/src/main/publisher-sidecar/share-session.ts|late persist can rewrite sealed bytes after sign-out|S6c",
    "P3|apps/ppt-timer/src/main/publisher-sidecar/sidecar-core.ts|share used before declaration (TDZ)|S6c",
    "P2|apps/ppt-timer/src/main/publisher-sidecar/share-session.ts|failed end reported as ended and session forgotten|S6c",
    "P3|apps/ppt-timer/src/main/publisher-sidecar/share-session.ts|rotated refresh token persisted only on live transitions|S6c",
    "P2|apps/ppt-timer/src/main/remote-share.ts|stop during pending End drops final status|S6c-main",
    "P2|apps/ppt-timer/src/main/remote-share.ts|double End spawns two short-lived sidecars|S6c-main",
    "P2|apps/ppt-timer/src/main/remote-share.ts|sidecar crash during End respawns and resumes|S6c-main",
    "P2|apps/ppt-timer/src/main/single-instance.ts|callback relaunch steals focus from slideshow|S6c-main",
    "P3|apps/ppt-timer/src/main/remote-share.ts|shutdown does not await short-lived sidecar|S6c-main",
    "P3|apps/ppt-timer/src/main/remote-share.ts|stop sets paused from non-active states|S6c-main",
    "P3|apps/ppt-timer/src/main/controllers.ts|remote offer reads stale timing/headline mode|S6c-main"
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
- Current phase: Implement mode; S1a–S1b, S3a–S3d, S4a–S4b, S5a–S5b, S6a–S6b verified; S6c sidecar half verified, main/IPC/renderer next

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
| S4b | Adapt local PPT UI/remote fixtures | RPV-001,002,006,008 (face layer; live Windows remains S7) | `apps/ppt-timer/src/renderer/{view,powerpoint-panel,main}.ts`, `styles.css`, `face-adoption.test.ts`, app `package.json` (devDeps + build:cjs-deps); new `packages/powerpoint-display` (remote adapter + 17 tests); timer-face CJS build; `.dependency-cruiser.cjs` ppt-timer allowance; CI build/test steps | Claude Opus 5.5 orchestrator (direct) | app 441 (all pre-existing characterization unchanged + 11 adoption/parity); powerpoint-display 17; timer-face 28; contracts 318 + CJS smoke; functions 53 | verified | red 4 adoption tests (identity/CSS/toDisplayModel); green 441/441; typecheck; renderer build; headless-Chrome visual parity 11/11 pixel-identical vs pre-S4b build; guardrails pass; Oracle review closed. |
| S5a | Browser route/resolve/subscription/reducer | RPV-003,007–010 (browser layer; live browser matrix in S5b) | `frontend/src/routes/session-viewer/{presentation-session-controller,firebase-transport,usePresentationSession,session-link,SessionViewerPage,SessionViewerApp}.ts(x)`, `session-viewer.css`, `frontend/src/lib/firebase-config.ts` (side-effect-free), `lib/firebase.ts` (imports config), `frontend/src/main.tsx` (import()-split entries), `frontend/package.json` deps, `.dependency-cruiser.cjs` `session-viewer-no-room-contexts` | Claude Opus 5.5 orchestrator (direct) | 41 controller/link/page tests (listener order, server-clock interpolation, regression/wrapper rejection, stale/disconnected, ended/access-ended, window expiry, token absent/denied, retryAfter clamp, capped jittered backoff, sign-in classification, listener-error reconnect bounded, single reconnect, terminal release, stop during resolve/sign-in, fragment scrub, tab-scoped reload, StrictMode single resolve, disclosure, polite announcement) | verified | reds per review round (6, 2, 4); green frontend 289/289; lint; tsc -b; vite build (separate SessionViewerApp chunk); boundary rule mutation-checked; guardrails pass. |
| S5b | Browser teardown/access states | RPV-003,007–010 (browser layer; Safari/Firefox + production blocked) | `frontend/src/routes/session-viewer/*` (fresh transport per reconnect, resolve-reason classification, hashchange adoption, lazy transport, CSS box sizing), `frontend/src/routes/PublisherDeviceApprovalPage.tsx` + route, `functions/src/presentation/links.ts` (`details.reason: session-ended`), `firebase/tests/presentation-viewer-walkthrough.mjs` + `user-test:presentation-viewer`, `docs/user-testing/issue-002-s5b-cloud-viewer.md` + 19 evidence files | Claude Opus 5.5 orchestrator (direct) | frontend 305 (session viewer 44, approval page 13); links emulator 12 (+session-ended reason, revoked-after-end no reason); walkthrough 25 checks | verified (Chrome/emulator); Safari/Firefox blocked | user testing found 3 P1s (caret below fold, hash-only link, ended-as-access-ended) — each red-first then fixed; final walkthrough 25/25; emulator 9/9, 12/12, 9/9, 7/7; functions 53/53; rules exit 0; guardrails pass. |
| S6a | Sidecar protocol/broker/lifecycle harness | RPV-001,005,008,010 (process layer; live Windows is S7) | `apps/ppt-timer/src/main/publisher-sidecar/{protocol,port,sidecar-core,worker,launcher,electron-spawn,lifecycle,candidate-adapter}.ts` + tests; `apps/ppt-timer/test/publisher-sidecar-harness.ts`; main.ts wiring deferred to S6c (398/400 lines) | Claude Opus 5.5 orchestrator (direct) | 59 tests (protocol parsers; core handshake/terminate/latest-only/shutdown; launcher handshake/timeout/wrong nonce/violation/deadline kill; lifecycle coalescing, respawn+replay, budget/refresh, stop-start race, refused SHARE_START, idle on shutdown; import boundary incl. packages; candidate adapter host-state table, privacy, timing degrade, 4 H1 fixtures × 4 mode combos round-trip) | verified | red (modules absent; review round 4 reds); green ppt-timer 500/500; typecheck; guardrails; **empirical Electron 43.2.0 smoke (macOS arm64)**: utilityProcess.fork + MessageChannelMain handshake, share, candidate, forged-candidate termination, clean shutdown, lifecycle starting→sharing→stopping→idle. |
| S6b | Device auth/encrypted persistence | RPV-001,003,010 (sidecar/broker layer; main.ts callback/openExternal wiring is S6c; DPAPI on Windows is S7) | `apps/ppt-timer/src/main/publisher-sidecar/{auth,approval,credential-store}.ts`; protocol/sidecar-core/launcher extensions; `credentials.test.ts` | Claude Opus 5.5 orchestrator (direct) | 49 new/changed tests (broker: versioned header, no plaintext, no fallback, enumerated errors, oversize, rename failure keeps old file, ordered seal→clear, concurrent seals, no logging; approval-URL origin table; callback-URI table; PKCE S256; expiry; approval-rejected; invalid completion ×3; sealed credential over the real protocol; local too-large/invalid ×3 without protocol violation; broker reject/timeout → io; AUTH_REQUIRED/AUTH_CALLBACK relay with challenge mismatch; protocol kinds/keys) | verified | red (modules absent; review reds 9/9); green ppt-timer 549/549; typecheck; guardrails. |
| S6c | Cloud publish/heartbeat/retry/epoch/UI | RPV-001–003,006–010 | sidecar half: `publisher-sidecar/{publisher,retry,cloud-client,share-session}.ts`, protocol `PUBLISH_STATUS`/`VIEWER_LINK`/`SIGN_OUT`, worker cloud config, `firebase/tests/presentation-sidecar.emu.js`; remaining: `main.ts` wiring, IPC contract/preload, renderer share UI | Claude Opus 5.5 orchestrator (direct) | publisher 16, cloud-client 18, share-session 22, protocol +8, core +1; emulator e2e 5/5 | in progress (sidecar half verified) | red (modules absent; review reds 9/9); green ppt-timer 615/615; typecheck; guardrails; `npm run test:presentation-sidecar --workspace ontime-firebase-rules` 5/5. |
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
| `P1|packages/remote-viewer-contracts/package.json|server contracts depend on DOM face package|S4b` | fixed | adapter moved to `@ontime/powerpoint-display`; contracts have no dependencies; CJS smoke + functions 53/53. |
| `P2|apps/ppt-timer/src/renderer/view.ts|local/remote copy duplicated with partial parity|S4b` | fixed (parity for all shared states) | 9 parity cases pass. |
| `P2|apps/ppt-timer/src/renderer/main.ts|app re-implements face patch logic|S4b` | fixed | `patchTimers` → `patchTimerFace`; `patchControls` documented to mirror `renderDisclosureList`; 441/441. |
| `P2|apps/ppt-timer/src/renderer/styles.css|dead max-height media block restates face values|S4b` | fixed | deleted; 560×170/190 captures still pixel-identical. |
| `P2|apps/ppt-timer/src/renderer/view.ts|stale comments and whitespace|S4b` | fixed | header updated; blank runs collapsed. |
| `P1|frontend/src/lib/firebase.ts|viewer import initializes operator default app|S5a` | fixed | side-effect-free `firebase-config.ts`; `lib/firebase.ts` forbidden by boundary rule; `import()`-split entries; Oracle closed. |
| `P2|frontend/src/routes/session-viewer/presentation-session-controller.ts|unbounded fixed-rate retries|S5a` | fixed | backoff schedule, clamp, permanent-sign-in tests. |
| `P2|frontend/src/routes/session-viewer/presentation-session-controller.ts|listener error never resubscribed|S5a` | fixed | reconnect test. |
| `P2|frontend/src/routes/session-viewer/SessionViewerPage.tsx|reload ends access|S5a` | fixed | tab-scoped token recall test. |
| `P2|frontend/src/routes/session-viewer/usePresentationSession.ts|StrictMode double resolve|S5a` | fixed | StrictMode single-resolve test. |
| `P1|frontend/src/routes/session-viewer/presentation-session-controller.ts|reconnect path loops at base backoff|S5a` | fixed (red→green; fresh review deferred to final full-diff review) | backoff resets only on data delivery; >5 data-less reconnects end access; 30-min persistent-denial test resolves ≤6 times. |
| `P2|frontend/src/routes/session-viewer/presentation-session-controller.ts|throttled sign-in ends access|S5a` | fixed | too-many-requests/internal-error retry tests. |
| `P2|frontend/src/routes/session-viewer/presentation-session-controller.ts|release does not stop async continuations|S5a` | fixed | `release()` sets `stopped`. |
| `P2|frontend/src/routes/session-viewer/presentation-session-controller.ts|duplicate reconnects|S5a` | fixed | same-tick double error → one extra resolve. |
| `P2|frontend/src/lib/firebase.ts|emulator setting aliases and hard-coded auth port|S5a` | fixed | `emulatorSettings.*` used directly; shared `authPort`; Oracle verified in code. |
| `P1|frontend/src/routes/session-viewer/session-viewer.css|disclosure caret below the fold|S5b-usertest` | fixed | border-box; walkthrough asserts caret inside viewport. |
| `P1|frontend/src/routes/session-viewer/SessionViewerPage.tsx|re-issued link in same tab ignored|S5b-usertest` | fixed | hashchange test (red first) + W10. |
| `P1|frontend/src/routes/session-viewer/presentation-session-controller.ts|ended session shown as access ended|S5b-usertest` | fixed | fresh transport + resolve reason; controller + emulator tests (red first) + W10. |
| `P3|frontend/src/routes/session-viewer/usePresentationSession.ts|StrictMode app-deleted warnings|S5b-usertest` | fixed | single-transport StrictMode test. |
| `P3|frontend/src/routes/session-viewer/SessionViewerPage.tsx|terminal states show only small label|S5b-usertest` | open (UX follow-up) | recorded in user-test record. |
| `P3|frontend/src/routes/PublisherDeviceApprovalPage.tsx|heading unchanged after approval|S5b-usertest` | open (copy follow-up) | recorded. |
| `P1|frontend/src/routes/session-viewer/presentation-session-controller.ts|duplicate app on fresh transport|S5b` | false_positive | app names are `presentation-viewer-<ts>-<random>`. |
| `P1|frontend/src/routes/PublisherDeviceApprovalPage.tsx|any custom scheme callback opened|S5b` | fixed (downgraded to P2: server pins scheme) | exact configured scheme; ms-officecmd/https/javascript rejected. |
| `P2|frontend/src/routes/session-viewer/SessionViewerPage.tsx|hashchange path untested|S5b` | false_positive | page test "switches to a newly opened link in the same tab". |
| `P2|functions/src/presentation/links.ts|resolve reason set must stay closed|S5b` | fixed | revoked-after-end token gets no details (emulator). |
| `P2|frontend/src/routes/session-viewer/session-viewer.css|reset skips pseudo-elements|S5b` | fixed | ::before/::after included. |
| `P1|apps/ppt-timer/src/main/publisher-sidecar/lifecycle.ts|stop/start race orphans a sidecar|S6a` | fixed (defensive; race test passes; fresh review deferred to final) | synchronous detach via `retiring`; stop→start test. |
| `P1|apps/ppt-timer/src/main/publisher-sidecar/lifecycle.ts|refused SHARE_START hangs in starting|S6a` | fixed (red→green) | NACK test → failed + killed. |
| `P1|apps/ppt-timer/src/main/publisher-sidecar/protocol.ts|negotiated max size not enforced|S6a` | fixed (red→green) | 1 024-byte HELLO + 1 200-byte UTF-8 label terminates. |
| `P2|apps/ppt-timer/src/main/publisher-sidecar/protocol.ts|size measured in UTF-16 units|S6a` | fixed | TextEncoder byte length; same test. |
| `P2|apps/ppt-timer/src/main/publisher-sidecar/protocol.ts|stop/end commands lack nonce|S6a` | false_positive | key table requires `{kind, nonce, id}`; wrong-nonce test covers SHARE_START family. |
| `P2|apps/ppt-timer/src/main/publisher-sidecar/lifecycle.ts|shutdown without connection keeps stale status|S6a` | fixed (red→green) | restarting → shutdown → idle test. |
| `P2|apps/ppt-timer/src/main/publisher-sidecar/launcher.ts|main-side port never closed|S6a` | fixed | `finish` closes the port. |
| `P2|apps/ppt-timer/src/main/publisher-sidecar/sidecar.test.ts|boundary scan misses package/dynamic imports|S6a` | fixed | scans `import()`/`require()`; only `@ontime/remote-viewer-contracts`, which has no dependencies. |
| `P3|apps/ppt-timer/src/main/publisher-sidecar/lifecycle.ts|respawn budget never refreshes|S6a` | fixed (red→green) | stable-period refresh test. |
| `P1|apps/ppt-timer/src/main/publisher-sidecar/credential-store.ts|unserialized broker ops resurrect cleared credential|S6b` | fixed (red→green) | single promise queue + unique temp per write; seal-then-clear with deferred rename and concurrent-seals tests. |
| `P2|apps/ppt-timer/src/main/publisher-sidecar/sidecar-core.ts|oversize seal is a protocol violation (crash loop)|S6b` | fixed (red→green) | `sealedDataFits` (serialized UTF-8 ≤ 16 KiB) checked locally in the sidecar, in both parsers, and in the broker (seal + unseal); plain/escape-inflated tests, no exit. |
| `P2|apps/ppt-timer/src/main/publisher-sidecar/sidecar-core.ts|storage request without reply hangs forever|S6b` | fixed (red→green) | `STORAGE_TIMEOUT_MS` 10 s → `io`; launcher maps broker rejection to `io`; reject + never-answer test. |
| `P2|apps/ppt-timer/src/main/publisher-sidecar/auth.ts|unvalidated completion persists unloadable credential|S6b` | fixed (red→green) | `approveDevice` validates token/UID/clock (`approval-invalid`); `save` refuses what `load` cannot read (`corrupt`). |
| `P2|apps/ppt-timer/src/main/publisher-sidecar/sidecar-core.ts|approval waiter listener never removed|S6b-self` | fixed | listeners in a Set, removed on resolve and on timeout. |
| `P2|apps/ppt-timer/src/main/publisher-sidecar/auth.ts|approval wait mixes server expiry with local clock|S6b-self` | fixed | fixed local `APPROVAL_WAIT_MS` = 5 min (server still enforces expiry); test asserts the wait. |
| `P3|apps/ppt-timer/src/main/publisher-sidecar/credentials.test.ts|console spies never restored|S6b` | fixed | `afterEach(vi.restoreAllMocks)`. |
| `P1|apps/ppt-timer/src/main/publisher-sidecar/share-session.ts|end/sign-out after respawn skip the cloud|S6c` | fixed (red→green) | `ensureCredential` loads + restores before end/sign-out; respawn test. |
| `P1|apps/ppt-timer/src/main/publisher-sidecar/cloud-client.ts|ambiguous refresh failure wipes credential|S6c` | fixed (red→green) | only 400/401/403 with a Secure Token dead-token message is `unauthenticated`; portal/proxy/407 → `unavailable` (3 cases). |
| `P1|apps/ppt-timer/src/main/publisher-sidecar/sidecar-core.ts|SHARE_START ignored after share ended itself|S6c` | fixed (red→green) | core always delegates to `share.start()` (share owns idempotency); `not-configured` now finishes the run. |
| `P2|apps/ppt-timer/src/main/publisher-sidecar/share-session.ts|stale run halts newer run after persist failure|S6c` | fixed (red→green; mutation-checked) | run-token checked before `finish` in `start` and `open`. |
| `P2|apps/ppt-timer/src/main/publisher-sidecar/cloud-client.ts|fetch has no timeout|S6c` | fixed (red→green) | `CLOUD_REQUEST_TIMEOUT_MS` 15 s race → `unavailable`. |
| `P3|apps/ppt-timer/src/main/publisher-sidecar/share-session.ts|late persist can rewrite sealed bytes after sign-out|S6c` | fixed | all sealed writes/clears serialized; stale credential reassignment guarded. |
| `P3|apps/ppt-timer/src/main/publisher-sidecar/sidecar-core.ts|share used before declaration (TDZ)|S6c` | fixed | handler registered after share creation. |
| `P2|apps/ppt-timer/src/main/publisher-sidecar/share-session.ts|failed end reported as ended and session forgotten|S6c` | fixed (red→green) | non-gone end failure keeps the session and reports `paused`. |
| `P3|apps/ppt-timer/src/main/publisher-sidecar/share-session.ts|rotated refresh token persisted only on live transitions|S6c` | fixed (red→green) | cloud client `onRefreshTokenChanged` hook seals each rotation. |
| `P2|apps/ppt-timer/src/main/remote-share.ts|stop during pending End drops final status|S6c-main` | fixed (red→green) | Stop inert while a final command is pending; `RemoteShareView.busy` disables toggle/End/Sign out. |
| `P2|apps/ppt-timer/src/main/remote-share.ts|double End spawns two short-lived sidecars|S6c-main` | fixed (red→green) | `runFinal` single-flight; 3 dispatches → 1 launch. |
| `P2|apps/ppt-timer/src/main/remote-share.ts|sidecar crash during End respawns and resumes|S6c-main` | fixed (red→green) | exit/NACK during End cancels respawn (`stopSharing`) and fails fast as `failed`; no SHARE_START after End. |
| `P2|apps/ppt-timer/src/main/single-instance.ts|callback relaunch steals focus from slideshow|S6c-main` | fixed (red→green) | `isBackgroundLaunch(argv)` = `carriesCallbackUrl`; callback relaunch records diagnostics but never restores/focuses. |
| `P3|apps/ppt-timer/src/main/remote-share.ts|shutdown does not await short-lived sidecar|S6c-main` | fixed | lifecycle + temporary shutdowns awaited together; live/connecting/short-lived tests. |
| `P3|apps/ppt-timer/src/main/remote-share.ts|stop sets paused from non-active states|S6c-main` | fixed (red→green) | guarded by `ACTIVE`. |
| `P3|apps/ppt-timer/src/main/controllers.ts|remote offer reads stale timing/headline mode|S6c-main` | fixed (red→green) | settings persisted before the host republishes. |

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
- 2026-09-29 (S4b): `npm run test --workspace apps/ppt-timer` 441/441; `npm run typecheck --workspace apps/ppt-timer` PASS (after `npm run build:cjs-deps --workspace apps/ppt-timer`); `npm run build:renderer --workspace apps/ppt-timer` PASS; `@ontime/powerpoint-display` 17/17 + typecheck; `@ontime/timer-face` 28/28; `@ontime/remote-viewer-contracts` 318/318 + CJS smoke; functions 53/53; guardrails PASS.
- 2026-09-29 (S5a): `npm run test --workspace frontend` 289/289; `npm run lint --workspace frontend` PASS; `npm run typecheck --workspace frontend` PASS; `npm run build --workspace frontend` PASS; guardrails PASS. Session-viewer tests were authored alongside their modules for new files (module absent = red); every review fix was red first.
- 2026-09-29 (S5b): `npm run test --workspace frontend` 305/305; `npm run build --workspace frontend` PASS; `npm run test:presentation --workspace ontime-firebase-rules` 9/9, 12/12, 9/9, 7/7; `npm run user-test:presentation-viewer --workspace ontime-firebase-rules` 25/25 (headless Chrome 154 via CDP, emulators, Vite dev server; screenshots and logs in `docs/user-testing/assets/issue-002-s5b/`); `test:rules` exit 0; functions 53/53; guardrails PASS.
- 2026-09-30 (S6a): `npm run test --workspace apps/ppt-timer` 500/500; `npm run typecheck --workspace apps/ppt-timer` PASS; `npm run build:main --workspace apps/ppt-timer` PASS; guardrails PASS; Electron smoke `apps/ppt-timer/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron /tmp/sidecar-smoke.js` → handshake ok, share ok, candidate ok, forged candidate terminated the channel, shutdown clean, lifecycle `starting,sharing,stopping,idle`. The worktree's pinned Electron 43.2.0 binary had to be installed with `node install.js` (npm install scripts are blocked here); node_modules only.
- 2026-10-14 (S6b): `npm run test --workspace apps/ppt-timer` 549/549; `npm run typecheck --workspace apps/ppt-timer` PASS; `npm run guardrails` exit 0. Oracle review (inline sources) → 1 P1, 3 P2, 1 P3; all fixed red-first.
- S6b interpretations/divergences (closeout doc sync): protocol adds main→sidecar `AUTH_CALLBACK{challengeId, code}` to relay the one-time code from the app callback URI (required by the S3a anti-phishing `authorizationCode`; main parses only `<scheme>://publisher-auth?challenge=…&code=…`); `AUTH_REQUIRED.url` must be HTTPS (or loopback HTTP) `/publisher/device/approve?challenge=…` only, and main additionally pins the configured web origin before `shell.openExternal`. Storage results are `SEAL_RESULT`/`UNSEAL_RESULT`/`CLEAR_RESULT` correlated by `requestId`, with enumerated `StorageError` (`encryption-unavailable | not-found | corrupt | too-large | io`). Broker file = `ODPC1\n` + safeStorage ciphertext, atomic temp+rename, operations serialized; sealed data ≤ 16 KiB serialized UTF-8. Sealed credential `{v:1, deviceUid, devicePrivateKey, session}` (session = Firebase persistence, S6c); the device keypair is ed25519 generated per approval. Approval wait is a fixed local 5 min (server clock not used). Sign-out/revoke wiring and the redacted UI errors are S6c.
- 2026-10-14 (S6c sidecar half): ppt-timer 615/615; typecheck PASS; guardrails exit 0; `npm run test:presentation-sidecar --workspace ontime-firebase-rules` 5/5 (real compiled sidecar core + launcher + broker + REST client vs Auth/Functions/Firestore emulators: approval relay, sealed non-plaintext credential, create, viewer resolve + snapshot read, material publish seq 2, restart → resume epoch 2 without re-approval, end → viewer state ended, sign-out → device revoked + credential cleared). functions/lib restored; no debug logs committed. Oracle review now reads worktree files via `manage_selection` (verified by quoting a worktree-only line), so sources no longer need pasting.
- 2026-10-14 (S6c main/IPC/renderer half, cloud session orchestrating Sonnet sub-agents): WIP 01075cf green on arrival (ppt-timer 648/648). Independent review → 4 P2 + 4 P3 (one P3 merged into the crash finding); all fixed red-first in a870f00. ppt-timer 664/664; typecheck PASS; build:main/build:renderer PASS; guardrails exit 0 (422 modules). Interpretations: a final command (End/Sign out) owns the share until it settles — Stop is inert, repeats join it, and the renderer shows `busy`; a sidecar exit/NACK during End fails fast (`failed`, operator may retry End) rather than auto-retrying on a short-lived sidecar; a cold-start callback in `process.argv` is deliberately ignored (PKCE verifier dies with the previous sidecar); callback-scheme relaunches never take window focus. Not covered here: `installRemoteShare` Electron glue has no unit test (effectful only); live Windows approval/share is S7.
- S6c interpretations/divergences (closeout doc sync): the sidecar uses Firebase REST (Identity Toolkit `signInWithCustomToken`, Secure Token refresh, HTTPS callable protocol) over `fetch` instead of the Firebase JS SDK — no new runtime dependency, and the only sealed session state is the refresh token plus current `sessionId` (`session: {refreshToken, sessionId}`). Cloud target is non-secret startup data passed by main as `--cloud-config=<json>` (`{apiKey, projectId, region, emulatorHost}`; emulator host loopback only, ports 9099/5002); absent → `not-configured`. Publish spacing `MIN_PUBLISH_INTERVAL_MS` 250 (4/s < 5/s limit); backoff 1 s→30 s ×[0.5,1]; the first non-transient rejection retries immediately, later ones back off. `SHARE_STOP` = pause (session kept, viewers stale); restart/respawn resumes (server epoch+1, sequence 1); `END_SESSION` ends (failure → `paused`, session kept); `SIGN_OUT` (new main→sidecar command) self-revokes and clears. Protocol adds `PUBLISH_STATUS{status}` (10-value enum) and `VIEWER_LINK{url}` (https/loopback, `/session/<id>/view`, token only in fragment). `permission-denied`/dead refresh → `signed-out` (credential cleared).
- S6a interpretations: protocol size limit is the HELLO-negotiated `maxMessageBytes` capped at 64 KiB, in UTF-8 bytes; a protocol violation terminates the channel (sidecar exits 2; launcher kills); a refused `SHARE_START` is handled like a crash (bounded respawn); respawn budget (1 s/5 s/30 s) refreshes after 60 s of stable sharing; the candidate adapter publishes a slide whose playing row lacks timing as `timing-unavailable`; `main.ts` wiring, runtime dependency on the contracts package, and packaging are S6c/S6d.
- S5b user testing: record at `docs/user-testing/issue-002-s5b-cloud-viewer.md` — 12 workflows (open link, live compact face, countdown, disclosure, paused, source unavailable, stale 25 s / disconnected 60 s, resume new epoch, reload, revoke → access ended, new link → live, end → session ended, wrong token, owner device approval → app callback → completion) plus runtime checks (no unexpected console errors, no failed requests, token never in 331 request URLs, no room reads). Not tested (blocked): Safari/Firefox (no automation driver here; handed to user for the staging browser matrix), production Firebase/Google sign-in, native callback handler.
- S5b interpretations: emulator probe showed a denied snapshot target stalls the same Firestore client's viewer-state delivery (and `getDocFromServer`), so every reconnect uses a fresh isolated transport and a refused reconnect is classified by `resolvePresentationViewerLink` `details.reason: 'session-ended'` (only for the current link's holder; otherwise no details). The approval page opens only the configured `VITE_PRESENTATION_CALLBACK_SCHEME` (default `downstage-ppt-timer`); the server already pins the scheme at begin/complete.
- S5a interpretations: the viewer runs on its own named Firebase app with in-memory auth and mounts from an `import()`-split entry outside Auth/Data/room providers; the link token is scrubbed from the URL but kept in tab-scoped `sessionStorage` per session so a reload keeps working; resolve/sign-in/listener failures retry with capped jittered backoff (2 s → 60 s; `retryAfterMs` clamped to [1 s, 60 s]); permanent sign-in errors, a denied viewer state, window expiry, or more than 5 data-less listener reconnects end access; terminal states release listeners and credentials immediately.
- S4b user testing (UI slice): automated visual smoke — the pre-S4b renderer (files from `c23e1c4`) and the current renderer were Vite-built into `/tmp`, driven by an identical fake preload in headless Google Chrome, and screenshotted in 9 states at 560×170 (plus the auto-opened video tray at 560×300 and two states at 560×190); all 11 captures are pixel-identical (PIL diff bbox `None`) and were visually inspected (compact face, PAUSED/RETRYING labels, 1:03:20 fit, disclosure rows). Live Windows/PowerPoint use of the app remains the S7 platform gate (blocked here: no Windows host).
- S4b interpretations: the remote PowerPoint adapter is its own package `@ontime/powerpoint-display` (contracts stay free of DOM/face deps); timer-face and powerpoint-display get CJS builds because ppt-timer typechecks with node16 CommonJS resolution; ppt-timer consumes them as devDependencies (renderer is Vite-bundled), so the packaged runtime-dependency guard is unchanged; local/remote copy tables stay separate but parity is tested for every shared state (6 active + 3 unavailable); remote stale = frozen time + "Reconnecting"/warning, disconnected = `--:--` + "Disconnected"/warning, access-ended/session-ended/incompatible have explicit copy.
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
