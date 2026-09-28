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
  "phase": "Implement: S1a verified",
  "currentTask": "S1b — next",
  "worktreeStateAtPreflight": "clean",
  "reviewCycleCounts": {"S0": 2, "S1a": 1},
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
    "P3|packages/remote-viewer-contracts/src/sanitize.ts|ZWJ/ZWNJ stripped; slash over-stripping|S1a"
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
- Current phase: Implement mode; S1a verified; S1b next

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
| S1b | Reducer/timing/comparator/freshness | RPV-002,003,006–009 | `packages/remote-viewer-contracts` | unassigned | fake-clock/skew/reducer tests | pending | Depends on S1a. |
| S2 | Ratified D1/D2 decision gate | no runtime claim | docs | complete before Loop | n/a | complete | Deep Plan records supersession. |
| S3a | Publisher-device auth/session creation | RPV-003,007,010 | Functions presentation modules/tests | unassigned | Functions build + emulator tests | pending | Depends on S1a. |
| S3b | Viewer links/generation/rules | RPV-003,007,010 | Functions link modules, rules/tests | unassigned | rules/emulator tests | pending | Depends on S3a. |
| S3c | Publish transaction/current state | RPV-001,003,006–010 | Functions publish modules/tests | unassigned | transaction/emulator tests | pending | Depends on S1b,S3b. |
| S3d | Cleanup/TTL/indexes/rate limit/load plan | RPV-003,007,008,010 | Functions/config/tests | unassigned | cleanup/limiter/config tests | pending | Depends on S3c. |
| S4a | Source-neutral timer face | RPV-002,003,005,008,009 | `packages/timer-face` | unassigned | DOM characterization/typecheck | pending | Depends on S1a. |
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

The existing join-operator test asserted success but previously hung because
Firebase app resources remained open. A `finally` block now calls
`deleteApp(app)`; the emulator command exits 0 and shuts down all emulators.

## Validation and resume log

- 2026-09-28 (S1a): `npm install` in the worktree (stale ignored `frontend/node_modules` symlink tree removed first; main checkout verified intact). Only lockfile change kept: the new workspace entries; the directory-derived root `name` churn was reverted.
- 2026-09-28 (S1a): red `npm run test --workspace @ontime/remote-viewer-contracts` 230 failed, all `Error: not implemented`; typecheck PASS.
- 2026-09-28 (S1a): green 246/246 after review fixes; `npm run typecheck --workspace @ontime/remote-viewer-contracts` PASS; `npm run guardrails` PASS (static + boundaries, 287 modules).
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
