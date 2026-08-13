# Standalone PowerPoint Video Timer — Spec-Plan Readiness Gate

- **Date:** 2026-07-27
- **Tracking:** `ISSUE-001`
- **Spec:** `docs/spec/standalone-powerpoint-video-timer.spec.md`
- **Deep Plan:** `docs/plans/standalone-powerpoint-video-timer-2026-07-23.md`
- **Baseline SHA:** `fceb200b05c8f3bf7253ac0b3a91d613cc0bd305`
- **Gate discipline:** `spec-plan-readiness` (deterministic go/no-go)

---

## Verdict

**`implementable`**

Both required inputs are readable. All 33 scenarios (S-001…S-033) carry observable Then outcomes; the Proposed Surface is sufficient to implement and test every user-facing state, setting, diagnostic, link, and installer behavior; the Deep Plan is ordered (Stages 0–8 / handoffs H1–H6), dependency-aware, and each stage names expected files, validation commands, stop gates, and non-goals. Every scenario traces to at least one planned stage and every stage traces to at least one scenario or an explicit release-mechanics rationale. No spec-plan contradictions were found. The four Open Questions (OQ-1…OQ-4) are each explicitly scoped by both spec and plan to named **release gates** with defined fallbacks, not to implementation start.

`blocking_gaps` is therefore empty. Implementation may begin at the first safe task (Stage 0). This authorizes Stage 0 only; each later stage's own stop gate governs continuation.

### Grounding performed (load-bearing claims verified against the tree)

- Root `package.json`: scripts `guardrails` (→ `guardrails:static` + `boundaries`), `ci-local`, `fast-lane` exist; workspaces = `frontend, companion, controller, functions, firebase, packages/*`. `apps/*` is **not** yet a workspace — correctly listed as a Stage 1/5 root-`package.json` change, not a false assumption.
- `.dependency-cruiser.cjs` **already** contains the `ppt-timer-standalone` boundary rule (lines 54–62) forbidding `apps/ppt-timer` → firebase/cloud/local-sync/companion/frontend/functions, plus `no-package-runtime-frameworks` forbidding `packages/*/src` → electron/react/firebase/socket.io. The Stage 1/5 guardrail claims are real and enforceable today.
- `packages/presentation-core/package.json` currently exports only ESM `./src/index.ts` and has no `build:cjs` script — consistent with the plan explicitly *adding* the compiled CommonJS `require` export in Stage 3 (§7.6). Not a contradiction.
- Behavior constants match the spec Constraints exactly: `PPT_POLL_INTERVAL_MS = 1000`, `PPT_DEBOUNCE_MS = 600`, `PPT_VIDEO_CLEAR_POLLS = 2`, `>200 ms` playing inference — all present in `companion/src/presentation-candidate.ts`.
- Characterization oracles exist where the plan freezes them: C-labels in `companion/src/main.presentation.test.ts`; D1–D12 in `companion/src/main.ppt-status.test.ts`; lifecycle suite present. The 250 ms end-inference threshold lives in the Controller `PresentationStatusPanel` (as the plan attributes), not in the candidate reducer.

---

## Blocking gaps

None. (`blocking_gaps: []` — required for an `implementable` verdict.)

### Non-blocking observations (recorded, do not gate implementation)

These are **not** blocking gaps. They are release-gate preconditions or minor plan-hygiene notes; none prevents starting Stage 0 or reliably mapping scenarios to tests.

- **N1 — OQ-1 canonical OnTime website URL (S-033).** Value unknown, but the *allowlist mechanism* (open exactly one build-time-constant URL; deny all others; deny new windows) is fully implementable and testable with a config constant. Spec OQ-1 and plan §16.1 both defer the *actual URL* to the private-beta release gate with a defined fallback (hide/disable the link). Blocks Stage 7 beta distribution, not Stage 5 code.
- **N2 — OQ-2 Office x86 support.** QA-matrix outcome (plan §11); does not block code. Beta may scope x64-only in release notes if x86 fails.
- **N3 — OQ-3 / OQ-4 Windows 10 wording & public signing identity.** Documentation/procurement decisions bound to Stage 7 (wording) and Stage 8 (signing) release gates only.
- **N4 — Plan lacks an explicit S-NNN task-to-scenario table.** The plan predates the numbered spec and maps behavior structurally (esp. §8 probe-output-to-UI table, which mirrors S-001…S-013). The mapping is reconstructible with high confidence and is completed below; substance is reliable, so this is hygiene, not a blocker. Recommend adding scenario IDs to the §15 handoff table opportunistically.

---

## Scenario-to-test map

No repo test taxonomy doc (`docs/spec/test.md`) exists; layers are chosen per `test-quality` "lowest faithful layer." Compatible scenarios are grouped where the same test vehicle faithfully covers them.

| Scenarios | Recommended layer | Why |
|---|---|---|
| S-005, S-006, S-007, S-008, S-009, S-010, S-011, S-015, S-017 | **unit/core** — `@ontime/presentation-core` pure reducer/view tests | Normalization, debounce/cache/clear, primary-video projection, remaining/elapsed projection, "ended"/250 ms, "N videos", carry-forward, and no-local-extrapolation are pure functions over `(state, pollResult, nowMs)`. Faithfully oracle-able below any UI. |
| S-002, S-013, S-027 | **unit/core (bridge) + component (poll controller)** — `ppt-bridge` validator/process-client fake-helper tests plus `apps/ppt-timer` poll-controller | Failure typing (missing/timeout/crash/invalid/COM-unavailable), same-update numeric removal (no stale intermediate frame), and bounded-backoff restart/recovery are deterministic at the process-client seam with a fake helper; the "no stale numeric on failure" assertion belongs in the poll-controller/view. |
| S-001, S-003, S-004, S-012, S-014, S-016 | **component** — `apps/ppt-timer` renderer view-state tests | UI-state precedence (connecting/not-running/no-slideshow), multiple-instance overlay, remaining↔elapsed toggle without re-poll, and basename-only path rendering are view-mapping assertions over immutable view state. |
| S-018, S-019, S-020, S-021, S-022, S-023 | **component/service** — `settings-store` + `window-placement` tests (Electron `screen` faked) | Defaults/min-size/presets, always-on-top default, move-to-display recenter, full round-trip persistence, off-screen clamp/recenter on display/DPI change, and `.corrupt-<timestamp>` recovery + atomic write are service behaviors with controlled `screen`/fs. |
| S-024 | **component** — main-process lifecycle test | Closing the only window terminates helper and exits; assert helper `close()` invoked and no orphan/tray. |
| S-025, S-026 | **unit/core** — diagnostics redaction + ring-buffer tests | Redaction (basenames only; no contents/env/tokens/usernames/other product state) and last-100 event keying are pure over an event buffer; highest-value low-layer assertion. |
| S-033 | **provider/adapter** — IPC/link-policy tests | `will-navigate`/`new-window` denial and single-allowlisted-URL open are main-process wiring assertions (URL as injected constant per N1). |
| S-028, S-029 | **integration (fixture-parity) + suite regression** | Companion event-sequence/payload identity vs frozen Stage 0 fixtures, plus the unchanged Companion C1–C16/D1–D12 suites running green; coexistence (two concurrent helpers) covered by fixture replay + manual matrix row. |
| S-030, S-031, S-032 | **end-to-end/manual (clean-VM matrix)** | Fresh install, in-place upgrade with settings preserved, and settings-preserving uninstall are installer behaviors only faithfully provable on a clean Windows VM (plan §11); `deleteAppDataOnUninstall: false` is the code-level anchor. |

If any earlier gate had blocked, this map would be empty; it is populated because the verdict is `implementable`.

---

## Task-to-scenario map

Stages map to handoffs H1–H6 (plan §15); Stage 0 is the prerequisite evidence task under H1.

| Task (stage / handoff) | Scenarios | Notes |
|---|---|---|
| **Stage 0 — Freeze contract & pin tooling** (H1) | S-028, S-029 (characterization baseline); underpins S-002/S-005–S-017/S-027 via captured native fixtures | Records C1–C16/D1–D12 baseline, captures native JSON + event-sequence fixtures, pins supported Electron/electron-builder. No production move. |
| **Stage 1 — Seed `@ontime/ppt-bridge`** (H1) | S-002, S-013, S-027 (failure typing, restart, no-stale) | Validator + fake-helper process client (timeout/crash/late/restart/close/orphan); CJS export; guardrails prove isolation. |
| **Stage 2 — Move native helper atomically** (H2) | S-028 (one canonical helper; no regression) — G1 | Byte-faithful move; no COM/protocol/runtime change; Companion resource repopulated via shim. |
| **Stage 3 — Graduate pure normalization to `presentation-core`** (H3) | S-005, S-006, S-007, S-008, S-009, S-010, S-011, S-015, S-017, S-028, S-029 | Pure reducer/view with explicit `nowMs`; ports every C/D oracle unchanged; primary-video reference + protocol-v0 fallback. |
| **Stage 4 — Companion adopts shared bridge/session** (H4) | S-028, S-029 | `PowerPointSession` around injected `pollOnce`; preserves fallback order, emitters, `LiveCue`, macOS. |
| **Stage 5 — First runnable standalone app** (H5) | S-001, S-002, S-003, S-004, S-006, S-007, S-008, S-009, S-010, S-011, S-012, S-013, S-014, S-015, S-016, S-017, S-018, S-019, S-020, S-021, S-022, S-023, S-024, S-025, S-026, S-027, S-033 | Hardened Electron main/preload/plain renderer; all UI states, settings, display placement, diagnostics redaction, link allowlist, recovery, shutdown. (S-033 URL per N1.) |
| **Stage 6 — Windows installer + net10 parity** (H6) | S-024, S-030, S-031, S-032 | NSIS per-user, stable app ID `com.ontime.ppttimer`, `deleteAppDataOnUninstall:false`; isolated net10 self-contained retarget diffed vs Stage 0. |
| **Stage 7 — Private-beta validation & docs** (H6) | S-025, S-026, S-030, S-031, S-032 + full matrix verification; resolves N1/N2/N3 | Executes §11 matrix, confirms URL/support/privacy/checksums. Release gate. |
| **Stage 8 — Public signed release** (H6) | (no new scenarios) — signed-artifact form of S-030–S-032; resolves N3/N4 | Release mechanics only; explicit non-implementation rationale (signing/reputation/distribution). |

Coverage proof: every S-001…S-033 appears in at least one row; every stage maps to scenarios or an explicit release-mechanics rationale (Stage 8). No unmapped task and no unmapped scenario → no `source: both` gap.

---

## First safe task

**Stage 0 — Freeze the working contract and pin supported tooling** (plan §9, executed under handoff H1).

Rationale it is the earliest dependency-satisfied, fully mappable task:

- **Prerequisites satisfied now:** operates at baseline `fceb200`; the native PowerPoint journey and Companion→Controller flow are the proven baseline (feasibility is not re-litigated). The characterization sub-tasks — record C1–C16/D1–D12 baseline counts, capture event-sequence fixtures from existing suites, pin a supported Electron/electron-builder pair — start immediately and are cross-platform via `npm run test --workspace companion`.
- **Affected areas known and non-destructive:** test-only additions beside `main.presentation.test.ts` / `main.ppt-status.test.ts` / `main.lifecycle.test.ts` and captured JSON fixtures under the future `packages/ppt-bridge/test/fixtures`; **no production move** in this stage.
- **Validation defined:** `npm run test --workspace companion` passes unchanged; fixtures reproduce current `LiveCue`/`PRESENTATION_*` payloads and order; a supported Electron "hello window" packages on Windows.
- **Stop gate defined:** stop only if supported Electron/electron-builder cannot package, baseline tests are already red, or the native/Companion contract cannot be captured deterministically — resolve the evidence/tooling gap only; do not reopen PowerPoint feasibility.
- **Test layer known:** integration fixture-parity + existing-suite regression (S-028/S-029 characterization).

**Precondition to *complete* (not to begin):** the native-JSON fixture capture and the single manual Windows 11 + Microsoft 365 x64 run require a Windows/PowerPoint environment (plan §14 "Blockers before implementation"). The baseline-count and event-sequence-fixture capture from existing suites, plus Electron pinning, proceed without it; sequence the Windows-only capture when that environment is available.

---

## Gate summary

| Checklist item | Result |
|---|---|
| Spec & Deep Plan readable | check |
| Open Questions resolved or explicitly non-blocking | check (OQ-1…OQ-4 bound to release gates) |
| Every scenario has observable Then | check (S-001…S-033) |
| Proposed Surface sufficient | check |
| Plan ordered & dependency-aware | check (Stages 0–8 / H1–H6) |
| Each task names affected files/surfaces | check |
| Each task has validation/tests/success criteria | check |
| Risk/rollback for triggering tasks | check (per-stage Stop gates; §12 rollback; §14 risk register) |
| Task-scenario bidirectional traceability | check (table above; no unmapped item) |
| No spec-plan contradiction | check |
| Test layers from taxonomy/`test-quality` | check (no repo taxonomy doc; lowest-faithful applied) |
| First safe task dependency-satisfied & mappable | check (Stage 0) |

**Authorization:** `implementable` — Stage 0 (H1) may proceed. This gate does not authorize any stage beyond Stage 0; each subsequent stage is governed by its own stop gate and the H2/H3/H4 regression-review and H5 user-testing / H6 artifact-verification requirements in plan §15.
