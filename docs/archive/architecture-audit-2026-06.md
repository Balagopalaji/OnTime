# OnTime — Architecture & Product Audit

_Audit date: 2026-06-05 · Reference branch: `stable-cloud` · Reviewer: deep code audit_

This document diagnoses the current architecture as it actually exists, decomposes the
product, proposes a target modular architecture, and gives a staged, low-risk migration
plan. It is deliberately opinionated. It does **not** assume the current architecture is
correct.

> **Read this first — §1–§9 were drafted against `stable-cloud`. `Addendum A` (added
> after a branch-by-branch verification pass) corrects the branch premise, enumerates the
> `main`-only fixes a rebuild must preserve, documents the `research/ppt-video-timing`
> salvage, and extends the diagnosis to the companion/functions/rules surfaces. Where §1–§9
> and Addendum A differ on branch framing, Addendum A wins.**

---

## 0. TL;DR (the conclusions, up front)

1. **The frontend has one god-module — `UnifiedDataContext.tsx` (6,192 lines)** — that
   simultaneously owns transport (Socket.IO + Firestore), arbitration, cache recovery,
   timer mutation, lock/pin/presence, queueing, and source-of-truth resolution. This is
   the single biggest architectural liability. It is not salvageable as-is; it should be
   decomposed into a domain core + transport adapters, not refactored in place.

2. **Timer state-transition logic is implemented three times** (Firebase, Unified,
   Mock), and **elapsed math is implemented three more times** (`timer-utils`,
   `useTimerEngine`, Mock's `captureProgress`). Two of those copies **clamp elapsed to
   `>= 0`**, which directly violates the documented "negative = bonus time" guardrail.
   This is the exact class of bug that already burned you.

3. **Source-of-truth resolution exists in ~4 competing forms**: the canonical
   `arbitrate()` engine, a hand-rolled fallback inside `resolveRoomSource()` gated behind
   a feature flag, `pickSource()`, and inline cache-merge priority rules
   (`mergeProgress`) duplicated in two places. Worse, **`arbitrate()` is disabled for
   `timer/cue/pin/liveCue`** (`ARBITRATION_FLAGS`), so timer arbitration silently runs on
   ad-hoc code paths instead of the engine you built to own exactly this.

4. **Room/timer Firestore reads are duplicated 4×**: `FirebaseDataContext`,
   `UnifiedDataContext`, `useRoom`, and `useTimers` each subscribe and each re-map docs
   with their own defaults. `ViewerPage` subscribes to the same room **twice** and merges
   the results with `??` in the component, while reaching past the `DataContext` contract
   with `(ctx as any)` casts.

5. **The product is really four products wearing one runtime**: cloud controller/rundown,
   viewer display, local Companion bridge, and presentation (PowerPoint/video) bridge.
   They should become separate apps/packages around a shared domain core. The viewer is
   already half-separated (`build:viewer` → `dist-viewer`); finish the job.

---

## 1. Current-state diagnosis

### 1.1 Module size & responsibility (the smell, quantified)

| File | Lines | Responsibilities crammed in |
|------|------:|------------------------------|
| `context/UnifiedDataContext.tsx` | 6,192 | Socket.IO transport, Firestore transport, arbitration, cache (localStorage) read/write/trim, tombstones, offline event queue, join queue, lock/pin/presence, heartbeats, timer mutation, progress merge, viewer pairing |
| `routes/ControllerPage.tsx` | 2,978 | UI + timer engine + lock UX + reauth + presentation status + share links + clock + mode switching |
| `context/MockDataContext.tsx` | 1,713 | A full **parallel reimplementation** of the entire data layer & timer logic |
| `routes/DashboardPage.tsx` | 1,722 | Room list UI + pinning + ordering + companion seeding |
| `context/FirebaseDataContext.tsx` | 1,471 | Firestore CRUD + timer mutation + room/timer mapping |
| `context/CompanionConnectionContext.tsx` | 744 | WebSocket lifecycle |

The shape of the dependency graph (`DataProvider → CompanionConnectionProvider →
AppModeProvider → UnifiedDataProvider → FirebaseDataProvider`) is fine. The problem is
that **`UnifiedDataProvider` does not delegate — it absorbs.** It wraps Firebase but then
reimplements timer mutation, room mapping, and arbitration rather than composing the
layer below it.

### 1.2 Layering violation: UI, domain, and transport are interleaved

- `ViewerPage.tsx` consumes **two independent data paths at once**: the unified context
  (`ctx.getRoom`) *and* direct Firestore (`useRoom` + `useTimers`), then reconciles them
  inline: `const room = ctx.getRoom(roomId) ?? publicRoom`. That `??` is an _ad-hoc
  fourth arbitration rule_ living in a view component.
- `ViewerPage` reaches around the public `DataContextValue` contract with
  `(ctx as typeof ctx & { getRoomAuthority?, subscribeToCompanionRoom?, addActiveRoomIntent? })`.
  When a component has to cast its context to reach undeclared methods, the abstraction
  has already leaked — the contract no longer describes what consumers actually need.
- `useTimerEngine` (a UI hook) recomputes elapsed from `startedAt`/`elapsedOffset`
  itself instead of consuming a resolved elapsed value, so display math and domain math
  can drift.

### 1.3 The five state categories are not separated

The PRD-level concepts you want kept distinct are physically fused in `Room['state']`:

| Concept | Where it should live | Where it lives today |
|---------|----------------------|----------------------|
| Timer **definition** (title, duration, type, order) | immutable-ish domain entity | `Timer` (ok-ish) but `originalDuration`/`adjustmentLog` mix runtime in |
| Timer **runtime** (active, running, startedAt, elapsedOffset, progress) | runtime reducer state | `RoomState` (cloud schema) — fused with message/clock |
| **Transport/sync** (authority, lastUpdate, source, confidence) | adapter metadata | smeared across `RoomAuthority`, `lastControllerWriteRef`, `companionHoldUntilRef`, `lastUpdate` |
| **Cached/offline** (snapshots, queue, tombstones) | a cache module | inline in `UnifiedDataContext` |
| **Presentation** (slides, video timing) | its own module | `LiveCue.metadata` grab-bag |

Because runtime and transport state share one object, every read path has to re-derive
"which `progress` do I trust" — and each derivation is a place a bug hides.

---

## 2. Duplicated logic & canonicalization findings (the core ask)

These are concrete, file:line-grounded cases where **one canonical implementation should
exist but several do**. This is the section to act on first.

### 2.1 Elapsed-time math — **3 implementations, 2 of them buggy**

| Impl | Location | Behavior |
|------|----------|----------|
| Canonical | `utils/timer-utils.ts:39` `computeElapsed` | `elapsedOffset + (now - startedAt)`, **no clamp** (correct) |
| Duplicate A | `hooks/useTimerEngine.ts:52` | `Math.max(0, timestamp - startedAt)` — **clamps, loses bonus time** |
| Duplicate B | `context/MockDataContext.tsx:202` `captureProgress` | `Math.max(0, elapsed)` — **clamps, loses bonus time** |

`docs/timer-logic.md` and `timer-utils.ts:7` both say elapsed must be allowed to go
negative. Two of the three live implementations break that rule. **Canonical: every
elapsed/remaining/progress/nudge calculation must go through `timer-utils.ts`.**
`useTimerEngine` should call `computeElapsed`/`computeRemaining`; Mock should call
`computeProgress`. No component or context may inline `now - startedAt` again.

### 2.2 Timer state-transition (start/pause/reset/setActive/nudge) — **3 implementations**

Each of these fully re-derives the state tuple (`activeTimerId`, `isRunning`,
`elapsedOffset/currentTime`, `startedAt`, `lastUpdate`, `progress`) independently:

- `FirebaseDataContext.tsx` (~lines 1060–1240): writes Firestore.
- `UnifiedDataContext.tsx`: `setActiveTimer:4777`, `nudgeTimer:5046`, `startTimer:5797`,
  `pauseTimer:5867`, `resetTimer:5922` — emits Companion + writes cache + optional cloud.
- `MockDataContext.tsx`: `setActiveTimer:1378`, `startTimer:1401`, `pauseTimer:1430`,
  `resetTimer:1457`, `nudgeTimer:1478`.

Three transition engines = three chances to forget a tuple field (exactly the guardrail
in CLAUDE.md). **Canonical: a single pure reducer** `timerReducer(state, action) →
state` in the domain core. Firebase/Companion/Mock become *adapters that persist the
reducer's output*, not re-deriving it. The reducer is the only place transition rules
exist.

### 2.3 Source-of-truth resolution — **4 competing forms**

1. `lib/arbitration.ts` `arbitrate()` — the intended canonical engine.
2. `UnifiedDataContext.resolveRoomSource:639` — calls `arbitrate()` **only if**
   `ARBITRATION_FLAGS.room`, else runs a **hand-rolled duplicate** of the same rules
   (`arbitration.ts` lines after the flag check).
3. `UnifiedDataContext.pickSource:4502` — a wrapper that computes tie-breakers/mode-bias
   *again* before delegating.
4. Inline `mergeProgress(cached, fresh)` priority — the "fresh cloud wins, cache fills
   gaps" rule — duplicated at `UnifiedDataContext.tsx:2391` **and** `:4581`
   (`mergeProgressFromCache`). This is the exact rule whose mis-ordering caused the
   stable-cloud cached-progress-overriding-fresh bug.

Plus: **`ARBITRATION_FLAGS` disables the engine for `timer`, `cue`, `pin`, `liveCue`**
(`lib/arbitration.ts:38`). So the domains most likely to conflict do **not** use your
arbitration engine at all — they use scattered `if` chains and ref-based holds
(`lastControllerWriteRef`, `companionHoldUntilRef`, `getHoldUntil`, `viewerSyncGuard`).

**Canonical: `arbitrate()` is the *only* place that decides cloud-vs-companion, for
*every* domain.** Delete the fallback branch in `resolveRoomSource`. Delete
`ARBITRATION_FLAGS` (or set everything true and keep it only as a kill-switch during
migration). The cache-merge priority rule must become a single named function (e.g.
`resolveProgress(fresh, cached)`) called from exactly one place.

### 2.4 Firestore room/timer mapping & subscription — **4 implementations**

- `mapRoom`: `FirebaseDataContext.tsx:99` **and** `useRoom.ts:50` (different defaults:
  e.g. features/tier handling differs).
- `mapTimer`: `FirebaseDataContext.tsx:159` **and** `useTimers.ts:15`.
- `onSnapshot` room/timer subscriptions in **4 files**: `FirebaseDataContext`,
  `UnifiedDataContext`, `useRoom`, `useTimers`.

`ViewerPage` therefore subscribes to the same room through both `useRoom` and the unified
context. **Canonical: one `mapRoom`/`mapTimer` in a `firestore-mappers` module and one
subscription source.** The viewer should read from a single read-model, not merge two.

### 2.5 MockDataContext — a parallel universe

`MockDataContext.tsx` (1,713 lines) reimplements the entire data layer including timer
math (with the clamping bug) and progress mutation. It is a maintenance multiplier: every
domain rule must be written twice and they already disagree. **It should not be a second
implementation of the domain — it should be a fake *transport adapter* over the same
domain core.**

---

## 3. Product decomposition — the real bounded contexts

There are **five** bounded contexts hiding in one app:

1. **Rundown** (definition): rooms, timers, sections/segments, cues, ordering. Pure
   data + editing rules. No sync, no clock.
2. **Show Runtime** (timer execution): the active-timer state machine, elapsed/remaining,
   nudge, progress. Pure, deterministic, clock-driven.
3. **Sync/Arbitration** (transport): cloud (Firestore) and companion (Socket.IO)
   adapters, authority, confidence windows, cache/offline queue, tombstones.
4. **Presentation** (external media status): normalized slide/video state, of which
   PowerPoint is **one bridge** among possible bridges (Keynote, ProPresenter, video).
5. **Collaboration/Control** (multi-operator): controller lock, room pin, presence,
   handover, requests.

Surfaces that consume these contexts:
- **Controller app** — Rundown + Runtime + Control + Presentation status (read).
- **Viewer app** — Runtime (read) + Presentation (read). Output-only surface.
- **Companion (local bridge)** — Sync adapter host + LAN serving.
- **Presentation bridge** — Presentation context producer (lives on the presentation
  laptop, since the controller laptop cannot read PowerPoint).

---

## 4. Target architecture

### 4.1 Canonical domain model

```ts
// Timer DEFINITION — what the timer is. Stored, edited, reordered.
type TimerDef = {
  id; roomId; title; durationMs; type: 'countdown'|'countup'|'timeofday';
  order; speaker?;
}

// Show RUNTIME state — the execution machine for one room. Never persisted raw to UI.
type RuntimeState = {
  activeTimerId: string | null
  isRunning: boolean
  startedAt: number | null      // wall clock when started
  elapsedOffset: number         // ms accumulated before start (may be negative)
  progress: Record<string, number> // per-timer parked elapsed (may be negative)
}

// One canonical reducer. The ONLY place transitions exist.
function timerReducer(s: RuntimeState, a: TimerAction): RuntimeState
type TimerAction =
  | {type:'SET_ACTIVE'; timerId} | {type:'START'} | {type:'PAUSE'}
  | {type:'RESET'} | {type:'NUDGE'; deltaMs} | {type:'SET_DURATION'; timerId; durationMs}

// SYNC envelope — transport metadata kept OUT of runtime/definition.
type SyncEnvelope<T> = {
  data: T; source: 'cloud'|'companion'; updatedAt: number; authority: 'cloud'|'companion'|'pending'
}

// PRESENTATION state — normalized; PowerPoint is one producer.
type PresentationState = {
  source: 'powerpoint'|'keynote'|'video'|'pdf'
  slide?: { index: number; total: number; notes?: string }
  media?: { playing: boolean; elapsedMs: number; durationMs: number; name?: string }
  status: 'idle'|'playing'|'paused'|'ended'
  updatedAt: number
}
```

Key rule: **definition, runtime, sync, cache, and presentation are five different types in
five different modules.** Nothing merges them into one `Room['state']` blob again.

### 4.2 Where logic lives

| Logic | Layer | Rule |
|-------|-------|------|
| Timer transitions, elapsed/remaining/nudge | **domain core** (pure, no React, no Firebase) | the single reducer + `timer-utils` |
| cloud↔companion decision, confidence windows, holds | **arbitration** (pure) | the single `arbitrate()`; every domain routes through it |
| Firestore/Socket.IO read+write, cache, queue, tombstones | **transport adapters** | adapters emit `SyncEnvelope`s; never compute timer math |
| Subscriptions → read-model | **read-model store** | one place maps docs/events → domain types |
| Rendering, fullscreen, fit-text, layout | **UI** | consumes resolved domain values; never recomputes elapsed |

### 4.3 Repo/app structure (if rebuilt as a suite)

```
packages/
  domain/            # pure: TimerDef, RuntimeState, timerReducer, timer-utils, presentation model
  arbitration/       # pure: arbitrate(), confidence windows  (the ONLY source-of-truth resolver)
  sync-core/         # SyncEnvelope, cache, offline queue, tombstones (adapter-agnostic)
  transport-cloud/   # Firestore adapter (mapRoom/mapTimer live here, once)
  transport-companion/ # Socket.IO client adapter
  ui-timer/          # viewer/controller timer presentation (FitText, TimerDisplay)
  ui-rundown/        # rundown/timer editing UX
  presentation/      # normalized PresentationState + bridge contract
apps/
  controller/        # cloud-first controller (uses domain + arbitration + transports)
  viewer/            # output-only surface (domain read-model + ui-timer); already has build:viewer
  companion/         # local bridge (hosts transport-companion + LAN serving)
  presentation-bridge/ # runs on presentation laptop; produces PresentationState (PowerPoint impl first)
```

### 4.4 Cloud-only mode isolation

Cloud-only must be a first-class product, not a degraded fallback. Concretely:

- The **controller app** depends on `transport-cloud` only. `transport-companion` is an
  **optional, lazily-loaded** adapter behind a capability boundary.
- `arbitrate()` with **no companion adapter present** collapses to a trivial "cloud wins"
  — but the code path is the *same* engine, not a separate `if (!isCompanionLive)` branch.
- No `(ctx as any)` companion methods in cloud surfaces; the cloud build literally does
  not import the companion adapter.

### 4.5 Presentation isolation

- `PresentationState` is normalized and source-agnostic. `LiveCue.metadata`'s grab-bag
  collapses into `slide`/`media`.
- The **bridge contract** is one interface: `produce(): PresentationState` + a transport
  to ship it (Socket.IO event today). PowerPoint polling (`companion/src/main.ts`
  `PowerPointPollState`/`PowerPointPollResult`) becomes **one implementation** of that
  contract, on the presentation laptop.
- The controller's `PresentationStatusPanel` already consumes a clean prop
  (`cue: LiveCue | null`) — it's close to the right shape; retarget it at
  `PresentationState`.

---

## 5. Keep / Extract / Rewrite / Delete

### KEEP (genuinely good, cheap to preserve)
- `utils/timer-utils.ts` — make it the *enforced* single source for all timer math.
- `lib/arbitration.ts` `arbitrate()` — good engine; promote to the *only* resolver.
- `components/core/FitText`, `components/controller/LiveTimerPreview`,
  `PresentationStatusPanel` — clean, prop-driven UI.
- Viewer presentation layout in `ViewerPage` (the rendering half, not the data half).
- Firebase data model shape (`rooms/{id}/timers`, `state/current`) — sound.
- `useTimerEngine`'s *display* concerns (status thresholds, formatting) — keep, but make
  it consume elapsed from `timer-utils` instead of recomputing.

### EXTRACT (good logic trapped in the wrong place)
- Timer transition logic from `FirebaseDataContext`/`Unified`/`Mock` → one `timerReducer`.
- `mapRoom`/`mapTimer` → one `firestore-mappers` module.
- Cache/queue/tombstone logic from `UnifiedDataContext` → `sync-core`.
- Companion Socket.IO handling from `UnifiedDataContext` → `transport-companion`.
- Rundown editing UX from `ControllerPage`/`RundownPanel` → `ui-rundown`.

### REWRITE (not worth preserving as-is)
- `UnifiedDataContext.tsx` — do **not** refactor in place. Re-derive it as a thin
  composition over domain core + adapters. Most of its 6k lines should not survive.
- `ViewerPage` data layer — replace dual-subscription + `??` merge with a single
  read-model; keep the rendering.
- `MockDataContext` — rewrite as a fake transport adapter, not a domain re-impl.

### DELETE
- The hand-rolled fallback branch in `resolveRoomSource` (post-flag-check code).
- `ARBITRATION_FLAGS` once everything routes through `arbitrate()`.
- The clamping elapsed math in `useTimerEngine` and `captureProgress`.
- One of the duplicate `mergeProgressFromCache` copies (keep a single `resolveProgress`).
- `CompanionDataContext.tsx` — near-dead wrapper; fold its disconnect callback elsewhere.
- Duplicate `mapRoom`/`mapTimer` in `useRoom`/`useTimers`.

---

## 6. Staged migration plan (lowest-risk ordering)

Each stage is independently shippable and reduces risk before the next.

**Stage 0 — Stop the bleeding (days, on `stable-cloud`).**
- Make `timer-utils` the only elapsed math: replace the clamps in `useTimerEngine:52` and
  `MockDataContext.captureProgress:202` with `computeElapsed`/`computeProgress`. Add a
  test asserting negative elapsed survives end-to-end (viewer + mock).
- Extract the cache-merge priority into one `resolveProgress(fresh, cached)` and call it
  from both `:2391` and `:4581`. Unit-test the "fresh wins, cache fills gaps" rule
  (regression lock for the bug you already hit).

**Stage 1 — Carve the pure domain core (low risk; pure code, no transport).**
- Create `packages/domain` with `timerReducer` + `timer-utils` + runtime types.
- Reroute `FirebaseDataContext`, `UnifiedDataContext`, and `Mock` timer mutations to call
  the reducer, then persist its output. No behavior change intended; tests pin it.

**Stage 2 — Unify arbitration.**
- Flip all `ARBITRATION_FLAGS` true; delete `resolveRoomSource`'s fallback branch.
- Route timer/cue/pin/liveCue decisions through `arbitrate()`. Keep the flag only as a
  temporary kill-switch; remove after a stable week.

**Stage 3 — Split transports out of `UnifiedDataContext`.**
- Move Socket.IO into `transport-companion`, Firestore into `transport-cloud`, cache/queue
  into `sync-core`. `UnifiedDataContext` becomes a thin composition (target < 600 lines).
- Collapse the 4 subscriptions / 4 mappers into one read-model.

**Stage 4 — Isolate the cloud-only product.**
- Make the companion adapter lazily-loaded behind a capability boundary. Ship a
  controller build that does not import it. Viewer build (`dist-viewer`) reads the
  single read-model only.

**Stage 5 — Normalize presentation + bridge.**
- Introduce `PresentationState`; retarget `PresentationStatusPanel`. Refactor
  `companion/src/main.ts` PowerPoint polling to implement the bridge contract. Stand up
  `apps/presentation-bridge` for the presentation laptop.

**Stage 6 — Promote to app suite (optional, once boundaries hold).**
- Split `apps/controller`, `apps/viewer`, `apps/companion`, `apps/presentation-bridge`
  over the shared `packages/*`.

Stages 0–2 are pure correctness/consolidation and can land on `stable-cloud` now. The app
split (4–6) only becomes safe *after* the duplication is collapsed — splitting first would
fork the bugs.

---

## 7. Biggest technical risks

1. **Re-forking during the split.** If you create `apps/*` before collapsing the duplicate
   timer/arbitration logic, you copy the bugs into every app. Collapse first (Stages 0–3),
   split later.
2. **Hidden coupling via `(ctx as any)`.** Several consumers (esp. `ViewerPage`) depend on
   undeclared `UnifiedDataContext` methods. Every such cast is an undocumented contract you
   can break silently during extraction. Make them explicit in the interface *before*
   moving code.
3. **Arbitration disabled today means untested transitions.** Turning on `arbitrate()` for
   `timer/pin/cue` (Stage 2) will change behavior in edge cases that currently run on the
   ad-hoc paths. Land it behind the kill-switch with arbitration debug logging
   (`VITE_DEBUG_ARBITRATION`) and a confidence-window test matrix.
4. **Cache/offline correctness.** The localStorage cache, offline queue, and tombstones are
   tightly bound to `UnifiedDataContext`'s internals. Extracting `sync-core` risks
   snapshot/queue regressions; pin the existing `snapshotStale`/`seedCompanionCache`/
   `undoUpdates` tests and expand them before moving code.
5. **Two clocks, one truth.** `useTimerEngine` ticks independently of the runtime state's
   `startedAt`. Until display math consumes `timer-utils`, viewer and controller can show
   different times for the same timer. Stage 0 closes this.

---

## 8. Direct answers to the specific questions

- **Bounded contexts:** Rundown, Show Runtime, Sync/Arbitration, Presentation,
  Collaboration/Control. (§3)
- **Canonical timer model:** `TimerDef` (definition) + `RuntimeState` (execution) + a
  single `timerReducer`; all math via `timer-utils`. (§4.1)
- **Domain vs transport vs UI:** transitions/elapsed = domain; cloud/companion decision +
  persistence + cache = transport; rendering = UI. UI never recomputes elapsed. (§4.2)
- **Cloud-only isolation:** companion is a lazily-loaded optional adapter; cloud build
  doesn't import it; `arbitrate()` degenerates to "cloud wins" via the same engine, not a
  branch. (§4.4)
- **Presentation modeling:** normalized `PresentationState`; PowerPoint is one bridge
  implementing a `produce()` contract. (§4.5)
- **Salvageable:** `timer-utils`, `arbitrate()`, FitText/LiveTimerPreview/
  PresentationStatusPanel, viewer rendering, Firebase data shape. **Not worth preserving:**
  `UnifiedDataContext` as-is, Mock as a domain re-impl, dual viewer subscription,
  `resolveRoomSource` fallback. (§5)
- **What's duplicated → one canonical:** elapsed math (→ `timer-utils`), timer transitions
  (→ `timerReducer`), source resolution (→ `arbitrate()`), progress-merge priority (→
  `resolveProgress`), room/timer mapping (→ `firestore-mappers`). (§2)
- **Competing sync/arbitration versions:** `arbitrate()` vs `resolveRoomSource` fallback
  vs `pickSource` vs inline `mergeProgress`; plus `ARBITRATION_FLAGS` disabling the engine
  for the domains that need it most. (§2.3)
- **Repo/app structure:** `packages/{domain,arbitration,sync-core,transport-*,ui-*,
  presentation}` + `apps/{controller,viewer,companion,presentation-bridge}`. (§4.3)
- **Lowest-risk migration:** Stages 0–2 (correctness/consolidation) on `stable-cloud`
  first; transport split next; app split last. (§6)

---

## 9. The one rule to enforce forever

> **Timer transition rules, elapsed math, and source-of-truth resolution may each exist in
> exactly one module. Any second implementation is a bug, regardless of how local or
> convenient it looks.** Adapters persist domain output; they never re-derive it. UI
> renders resolved values; it never recomputes them.

Every regression you've described traces back to violating this rule. Encode it as a
lint/review gate (e.g. forbid `now - startedAt` and inline `acceptSource` decisions outside
`packages/domain` and `packages/arbitration`).

---

# Addendum A — Branch reconciliation & verification pass

_Added 2026-06-05 after auditing branch topology and the companion/functions/rules
surfaces that §1–§9 had only inferred. This addendum supersedes §1–§9 on branch framing._

## A.1 Correction to the branch premise

§1–§9 reasoned "from `stable-cloud`" as instructed. The branch graph shows that framing is
incomplete in one important way:

- **Merge base of `main` and `stable-cloud` is `e1c3fa9` (2026-02-01)** — which is *also the
  tip of the `phase-3` branch*.
- **`stable-cloud` = phase-3 tip + 2 commits** (a TypeScript build fix + a Firebase deploy
  workflow) + the cached-progress merge fix. It is **phase-3 frozen at Feb 1, made
  deployable** — not a leaner evolution.
- **`main` = phase-3 tip + ~50 follow-on commits** of hardening/features. `phase-2`,
  `phase-3`, `phase-3-arbitration`, `phase-3c`, `phase-3-save-load-sessions`,
  `ui-overhaul`, and `parallel-sync-fix` all report **ahead 0** vs `main` — i.e. they are
  fully merged into it. **`main` is the genuine culmination of phases 2→3.**

**Consequence:** `main` is the *behavioral* source of truth; `stable-cloud` is a *scope*
reference for "simple cloud-only product." Neither dominates (see A.2). A rebuild should
extract its canonical domain core from `main`'s behavior, port `stable-cloud`'s progress
fix, and define minimal cloud scope against `stable-cloud`.

### Structural debt is identical or worse on `main`

The pure/shared files are **byte-identical** across both branches (`arbitration.ts`,
`timer-utils.ts`, `useTimerEngine.ts`, `useRoom.ts`, `ViewerPage.tsx`). Every §2 duplication
finding holds on `main` unchanged. The god-modules are **larger** on `main`
(UnifiedDataContext 6,193→6,944; ControllerPage 3,000→3,502; MockDataContext 1,713→1,988;
FirebaseDataContext 1,471→1,680). `main` did not refactor the core — it accreted onto it.

## A.2 Neither branch dominates — the divergence is two-directional

| Concern | `stable-cloud` | `main` |
|---|---|---|
| Cached-progress merge (`UnifiedDataContext`) | `mergeProgress(cached, fresh)` → **fresh wins (fixed)** | `mergeProgress(fresh, cached)` → **cache wins (BUG still live)** |
| ~50 hardening commits (reauth/takeover, watchdog, offline bootstrap, mode-flap loops) | **absent** | **present** |
| Sections / segments / cues / tiers (phase-3 rundown structure) | **reverted/absent** | **present** |
| CI status | green (build fix landed) | **red (1/8)** |

`stable-cloud` is not just "older" — it is **deliberately simpler** (sections/segments/cues
were dropped to get a clean cloud build out). That is a product-scope decision that aligns
with the "cloud-only as a first-class simple product" direction. The elapsed clamps and
`ARBITRATION_FLAGS` problems exist on **both** branches.

## A.3 `main`-only fixes a rebuild MUST preserve

Do not regress these when extracting the domain core (commit → intent):

**Security / auth (highest priority):**
- `6e9152b` fix(functions,frontend): **enforce secure reauth takeover contract** + canonical payload key
- `e6067cc` / `a7bc76b` fix(companion): **harden handshake pending & takeover authorization paths**
- `ddb0cda` / `8c89829` fix(companion): **remove bundled localhost private key fallback** (do not reintroduce a shipped TLS private key)

**Sync / arbitration correctness:**
- `294e398` stabilize auto authority & **join watchdog** (+regression tests)
- `3178dec` resolve **takeover arbitration regression** in unified data context
- `7f205f8` / `740b7ba` stop controller↔companion **join/rejoin loop on mode flaps**
- `d3169ec` handle **offline companion room bootstrap**
- `37786a1` harden **timer tuple migration & active-state writes**
- `4acbd4e` resolve **selected reset-timer targeting**

**Feature surface (only if cloud product keeps Show Control tier):**
- `b99f488` / `4821a12` / `0eccb9c` / `4e13271` sections & segments + tier-based features
- `31bd461` CuesPanel + drag/drop listener handling
- `958b525` don't auto-create default "Session 1" when sections exist

> A rebuild that starts from `stable-cloud` silently loses every item above. A rebuild that
> starts from `main` silently keeps the A.2 progress-merge bug. The canonical core must
> carry the **union** of fixes, regression-tested.

## A.4 `research/ppt-video-timing` salvage (the presentation module source)

An 11-commit research spike (Jan 16–18, branched *before* phase-3, never merged). ~11k LOC,
but most is reference artifacts. **Harvest these into the new `presentation` package /
`presentation-bridge` app; discard the rest.**

**Keep (high reuse):**
- `companion/ppt-probe/ppt-probe-mac.swift` (692 lines) — native macOS **Accessibility (AX)
  probe**: reads slide number/total, in-slideshow state, per-video list
  (`name/duration/elapsed/playing`), + PPTX XML duration discovery. This is the hard part
  and the literal "presentation laptop sends what the controller can't read" capability.
- `companion/ppt-probe/{ppt_sdef.xml, ppt_dictionary.xml}` + `docs/applescript` research —
  reference for the AppleScript/AX surface.
- `docs/ppt-video-macos-plan.md` — **the design contract:** operator's manual play/pause is
  authoritative; AX signals are best-effort hints that must never override operator intent;
  multi-video slides get name+duration only (no per-video elapsed); slide change = hard
  stop/reset. Adopt this as the presentation-module spec.
- The `PowerPointStatus` / `VideoStatus` `Codable` structs — a ready normalized schema; map
  onto the §4.1 `PresentationState`.
- `frontend/src/types/index.ts` presentation type additions (+71) and
  `PresentationStatusPanel` changes (+95).

**Discard:** the `ControllerPage.tsx` integration (1,131-line churn into the god-component),
build scaffolding tied to the old shape.

## A.5 Verification pass — surfaces §1–§9 had only inferred

### A.5.1 Cloud functions (`functions/src`, 553 lines) — KEEP, mostly clean
`lock.ts` (446) + `operators.ts` (84) + `index.ts` (re-export) implement the
**server-authoritative Collaboration/Control context**: `acquireLock`, `forceTakeover`,
`handoverLock`, `releaseLock`, `requestControl`, `denyControl`, `syncLockFromCompanion`,
`updateHeartbeat`, `joinAsOperator`. This is the correct home for control/lock authority and
is reasonably isolated already. It is the right server side for the `collaboration` context
in §4 — keep it, fold the reauth-takeover contract (`6e9152b`) in as the canonical path.

### A.5.2 `firestore.rules` (186 lines) — the REAL bounded-context boundary; KEEP as spec
The rules already encode the boundaries §3 argues for, server-enforced:
- **Viewer is a public surface:** `rooms`, `timers`, `state/current` are `allow read: if
  true`. This validates "viewer as its own app/output surface."
- **Single-writer via lock:** timer/state writes require `isLockHolderByUserId(roomId)` —
  the lock is the authority. **This server rule is the canonical control model; the
  client-side lock/hold/`lastControllerWrite` logic in `UnifiedDataContext` should defer to
  it, not re-decide it.**
- **Tier boundary is explicit:** `sections`, `segments`, `cues`, `crewChat`, `liveCues`
  require `hasShowControl`/`hasShowControlTier` (`features.showControl`). The
  basic-cloud-vs-show-control product split already exists in the data model. Use it as the
  module boundary: cloud-only product = rooms/timers/state; show-control adds the rest.
- `liveCues` are service-account/lock-holder writable and show-control-gated — the
  presentation/show-control data path is already access-scoped.

### A.5.3 `AppModeContext` (158 lines) — KEEP, but note a second decision point
Clean and cohesive: owns `mode` (auto/cloud/local), `effectiveMode` derivation, degraded
fallback (`triggerCompanionFallback`/`isDegraded`), cross-tab sync. **Caveat:**
`effectiveMode` is a *second* place that decides cloud-vs-local, separate from
`arbitrate()`. That is arguably legitimate (coarse transport-selection policy vs per-update
resolution), but the two must be kept consistent — feed `effectiveMode` into `arbitrate()`
as the `mode`/`preferSource` input (it already partly does) and never let a component branch
on mode independently. `reconnectChurn` (from CompanionConnection) widening the confidence
window is another coupling to keep explicit.

### A.5.4 `CompanionConnectionContext` (744 lines) — KEEP as transport-connection basis
Cohesive socket-lifecycle module: connect/disconnect, reconnect backoff + churn detection,
JWT decode/refresh, handshake status, capabilities/mode/systemInfo. This is the natural
seed for `transport-companion`'s connection layer. It is one of the healthier files; reuse
it largely as-is.

### A.5.5 `companion/src/main.ts` (7,534 lines) — a SECOND god-file; REWRITE/SPLIT
The Electron main process has the same disease as `UnifiedDataContext`: it interleaves
**auth** (JWT, keychain token service, pairing codes, viewer tokens, device caps),
**presentation** (PPT polling loop, video timing cache, debug logging), a **room-state
mirror** (`roomStateStore`/`roomTimersStore`/`roomCuesStore`/`liveCuesStore`),
**collaboration** (controller lock, room pin, room clients, handshake), and **transport/
serving** (Socket.IO, TLS/HTTPS, viewer hosting) in one file. Splitting this is exactly the
`apps/companion` (bridge host) + `apps/presentation-bridge` (PPT probe + timing) separation
in §4.3. The PPT polling is the cleanest seam to extract first; the room-state mirror should
become a thin relay over the shared domain core, not a third copy of room/timer state
(it is currently a fourth, after Firebase/Unified/Mock — see §2).

## A.6 Revised, prioritized next steps

1. **Stage 0 on `main`** (not just `stable-cloud`): port `stable-cloud`'s progress-merge
   fix to `main`, kill the two elapsed clamps, add regression tests. These are live bugs on
   the active line.
2. **Lock the `main`-only fixes (A.3)** into a regression suite before any extraction, so
   the rebuild cannot silently drop them.
3. **Harvest A.4** into the `presentation` package; adopt `ppt-video-macos-plan.md` as its
   spec.
4. Proceed with §6 Stages 1–6, treating `firestore.rules` (A.5.2) as the authoritative
   bounded-context map and the server lock (A.5.1) as the canonical control authority.

## A.7 Coverage statement

Audited in depth: the frontend data/context layer, timer/arbitration/cache logic, routes,
hooks, `functions/src`, `firestore.rules`, `AppModeContext`, `CompanionConnectionContext`,
companion `main.ts` (structure + concern map), and branch topology across all 17 branches.
Not line-by-line audited (low architectural risk): individual presentational components,
test files, and the full body of `companion/src/main.ts` (7.5k lines — concern-mapped, not
line-read). The conclusions do not depend on the un-read line detail.
