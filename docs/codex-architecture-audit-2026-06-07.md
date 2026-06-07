# OnTime Architecture Audit - Codex Comparison

Audit date: 2026-06-07
Reviewer: Codex
Purpose: Independent comparison audit for Opus and future builder agents.

This audit evaluates the proposed suite direction as a product and architecture decision,
not as a binding decision from a prior builder discussion. Some suite ideas are strong;
some should stay optional until validated.

## Executive Verdict

OnTime should not continue as one shared runtime that contains cloud timers, offline LAN,
Companion, presentation probing, viewer display, locks, cache recovery, and cue/showcall
features inside the same React data provider.

The product can work well as a suite, but only if the split is based on real bounded
contexts:

- Cloud timer/rundown is the first-class core product.
- Viewer output is its own read-only surface.
- Offline local sync is an optional product capability, not the default architecture.
- Presentation/PPT timing is valuable and should be extracted.
- OSC/HTTP/MIDI cue control should be a separate app/product, not mixed into timer/rundown.
- Show-control/showcaller/cue-planner features should not remain in the core unless there
  is real demand.

The right move is a structured rewrite of the data/sync layer, not a cosmetic refactor of
`UnifiedDataContext.tsx`.

## Branch Context

Local verification:

- `stable-cloud` and `main` split at `e1c3fa963f8936abe01f4df879f66d988733b267`.
- Current local `stable-cloud` is 3 commits ahead and 50 commits behind `main`.
- `main` contains the more advanced phase-3/hardening behavior.
- `stable-cloud` is useful as a deployable/simple cloud reference, not the whole behavior
  source of truth.

Recommended branch interpretation:

- Use `main` as the behavioral baseline for hard-won fixes.
- Use `stable-cloud` as the cloud-only scope reference.
- Harvest `research/ppt-video-timing` for presentation/PPT module work.
- Review `fix/companion-cloud-issues` for authority handling before rebuilding sync.

## Product Suite Assessment

The proposed suite can be a good product if it stays modular and demand-led.

Suggested product lineup:

```text
OnTime Cloud       - Firebase-backed web timer/rundown subscription product
OnTime Local       - desktop/offline LAN app with Companion and sync arbitration
OnTime Viewer      - read-only viewer app, PWA first, Pi/kiosk-capable later
OnTime PPT         - standalone PowerPoint video countdown, free Windows funnel
OnTime Cue         - standalone OSC/HTTP/MIDI trigger/control engine
OnTime NDI         - broadcast output module, license-gated due to Vizrt NDI SDK
Show Controller    - optional future show-control/cue-planner app if demand appears
```

Important distinction: "suite" does not mean every app imports every package. Each product
should be independently buildable and testable.

## Arbitration Placement

I agree with the revised direction: arbitration should not be mandatory for OnTime Cloud.

Cloud-only mode does not need cloud-vs-local arbitration. It needs:

- deterministic timer runtime
- Firestore persistence
- public viewer reads
- controller lock/presence rules
- offline tolerance only in the basic browser/cache sense

True source arbitration belongs in the offline/local product because it only exists when
there are at least two authorities: cloud and local Companion.

Recommended package shape:

```text
packages/
  timer-core/
  cloud-model/
  cloud-adapter-firestore/
  viewer-renderer/
  local-sync-arbitration/
  local-companion-adapter/
  presentation-core/
  ppt-bridge/
  cue-engine/
```

`local-sync-arbitration` should ship with OnTime Local and any product that supports
online/offline handoff. OnTime Cloud should not depend on it unless the user enables local
sync.

This avoids making the cloud product pay complexity costs for a feature many customers may
never use.

## Current-Code Diagnosis

### 1. Core Timer Engine - Needs Work

The underlying state model is sound:

- `activeTimerId`
- `isRunning`
- `startedAt`
- `elapsedOffset`
- `currentTime`
- `lastUpdate`
- `progress`

That model can support cloud, local, and viewer display. The problem is consistency.

Timer transition logic exists in multiple places:

- `frontend/src/context/FirebaseDataContext.tsx`
- `frontend/src/context/UnifiedDataContext.tsx`
- `frontend/src/context/MockDataContext.tsx`
- `companion/src/main.ts`

Elapsed/display logic is also duplicated:

- `frontend/src/utils/timer-utils.ts`
- `frontend/src/hooks/useTimerEngine.ts`
- `frontend/src/context/MockDataContext.tsx`

Verdict: keep the model, rewrite the implementation around one pure `timer-core`.

### 2. UnifiedDataContext / Arbitration - Rewrite

`frontend/src/context/UnifiedDataContext.tsx` is not a sustainable module boundary. It
owns too much:

- Firestore reads/writes
- Socket.IO protocol
- cache merge
- tombstones
- room authority
- lock/pin/presence
- timer mutation
- live cue merging
- offline queues
- viewer/controller join intent

The arbitration helper in `frontend/src/lib/arbitration.ts` is a useful seed, but it is not
yet the actual canonical path. Several decisions still happen inline in
`UnifiedDataContext.tsx`, and non-room domains are not consistently routed through the
same arbitration engine.

Verdict: extract or rebuild as `local-sync-arbitration` plus transport adapters. Do not
keep expanding `UnifiedDataContext`.

### 3. Module Boundaries - Rewrite Data Layer

Cloud, Companion, and UI are currently too entangled.

Examples:

- `frontend/src/context/DataProvider.tsx` wraps the whole app in Companion and AppMode
  providers even for cloud-first flows.
- `frontend/src/routes/ViewerPage.tsx` uses both context data and direct Firestore hooks.
- `frontend/src/context/CompanionDataContext.tsx` is effectively a thin wrapper around
  `UnifiedDataProvider`, not a separate Companion data layer.

Verdict: rewrite provider boundaries so Cloud and Viewer can run without Companion/local
sync modules.

### 4. Cue / Showcall / Show Control - Remove From Core

The prior builder's instinct to drop cue/showcall from the core is correct unless there is
clear demand. It creates product and code complexity that competes with the core timer
value.

However, this does not mean OnTime can never support show control. It means show control
should be a separate suite app if it becomes valuable.

Recommended split:

- Delete cue/showcall from the cloud timer/rundown core.
- Keep `OnTime Cue` as a future separate trigger app.
- Keep `Show Controller` as a possible future product, not a current dependency.

Blast radius if removing from current code:

- `frontend/src/context/DataContext.tsx`
- `frontend/src/context/FirebaseDataContext.tsx`
- `frontend/src/context/UnifiedDataContext.tsx`
- `frontend/src/types/index.ts`
- `frontend/src/routes/ControllerPage.tsx`
- `frontend/src/components/controller/*`
- `companion/src/main.ts`
- docs and tests around cues/sections/segments

Verdict: remove from rebuild core; do not try to surgically untangle it inside the old
runtime unless needed for a transitional release.

### 5. PPT Probe / Presentation - Extract After Refactor

The PPT/presentation capability is worth keeping. The hard part is not the controller UI;
the hard part is detecting PowerPoint/video state on the presentation machine.

Useful current assets:

- `companion/ppt-probe/Program.cs`
- `companion/ppt-probe/ppt-probe.csproj`
- `docs/phase-3-standalone-ppt-timer.md`
- `research/ppt-video-timing` branch

Less reusable:

- presentation integration inside `companion/src/main.ts`
- presentation UI entangled into `ControllerPage.tsx`
- live cue metadata used as the presentation state model

Recommended normalized model:

```ts
type PresentationState = {
  source: 'powerpoint' | 'external_video' | 'pdf'
  bridgeId: string
  presentationId: string
  title: string
  filename?: string
  slide?: {
    number?: number
    total?: number
    notes?: string
  }
  media: Array<{
    id?: string | number
    name?: string
    durationMs?: number
    elapsedMs?: number
    remainingMs?: number
    status: 'ready' | 'playing' | 'paused' | 'ended' | 'unknown'
  }>
  capabilities: {
    slideTracking: boolean
    mediaTiming: boolean
  }
  updatedAt: number
}
```

Verdict: extract the probe and presentation state. Do not port the current controller
integration wholesale.

### 6. Viewer UI - Needs Work, Not Rewrite

The viewer has good ingredients:

- large timer display
- fullscreen support
- wake lock
- `FitText`
- cloud public route

But it is not yet a clean product surface:

- It still depends on the unified provider path.
- It mixes direct Firestore with context data.
- LAN pairing concerns are in the same route.
- Branding/white-label is not modeled as first-class viewer state.
- Kiosk/Pi behavior needs explicit no-interaction recovery paths.

Branding should be in the model from the beginning:

```ts
type ViewerTheme = {
  logoUrl?: string
  primaryColor?: string
  backgroundColor?: string
  textColor?: string
  accentColor?: string
  fontFamily?: string
  layoutPreset?: 'timer_only' | 'rundown' | 'message' | 'presentation'
}
```

Verdict: preserve visual ideas, rebuild the viewer as a standalone read-only app/PWA.

## What Should Be Canonical

These concepts must each have exactly one implementation:

| Concept | Canonical module |
|---|---|
| Timer elapsed and remaining math | `timer-core` |
| Timer transitions | `timer-core` reducer |
| Firestore schema mapping | `cloud-adapter-firestore` |
| Cloud-only room read model | `cloud-model` / `cloud-adapter-firestore` |
| Cloud/local arbitration | `local-sync-arbitration` |
| Offline cache merge | `local-sync-arbitration` or `local-cache` |
| Companion socket protocol | `local-companion-adapter` |
| Presentation state | `presentation-core` |
| PowerPoint probing | `ppt-bridge` |
| Viewer theming/rendering | `viewer-renderer` |

Rules that should never exist in multiple places again:

- how to compute elapsed
- how to start/pause/reset/set-active
- how cached progress merges with fresh data
- how cloud vs local authority is chosen
- how Firestore documents map to domain types
- how PowerPoint/video status maps to presentation state

## Product Viability Notes

### Cloud-first timer/rundown

Strong product. Churches and small venues understand this. It should be the easiest app to
explain and sell.

### Offline Local

Strong differentiator if reliable. Do not ship until handoff is boring under real venue
conditions: unstable Wi-Fi, browser refresh, Companion restart, two controllers, stale
cache, clock skew.

### OnTime PPT

Strong funnel product. Keep scope small: always-on-top slide/video countdown. Avoid
pulling in rooms, sockets, Firebase, or controller logic.

### OnTime Viewer

Strong product if it becomes appliance-grade. Raspberry Pi/kiosk support is plausible, but
requires a dedicated viewer app with autostart/recovery expectations.

### OnTime Cue

Good separate product. Do not confuse it with the current cue/showcall planner.

### NDI

Potentially useful for broadcast AV, but keep it later because licensing and deployment
complexity are real.

## Recommended Migration

### Stage 0 - Stabilize Current Active Line

Do this before major rebuild work:

- Commit the fresh-data-wins cached progress merge fix on the active branch.
- Remove or quarantine obsolete `applyNudge`.
- Make `useTimerEngine` call shared timer utilities instead of inlining elapsed math.
- Stop Mock from reimplementing timer math.
- Add regression tests around negative elapsed and cache progress priority.

### Stage 1 - Extract Timer Core

Create `timer-core` with pure functions:

- compute elapsed
- compute remaining
- start
- pause
- reset
- set active
- edit duration
- nudge duration

Adapters persist the reducer result. They do not compute transitions.

### Stage 2 - Build Clean Cloud Product

Create a cloud-only data path with:

- no Companion provider
- no local arbitration
- no offline queue
- no cue/showcall
- no presentation bridge

This validates the core commercial product.

### Stage 3 - Build Viewer App

Extract viewer to a standalone PWA/read-only app:

- cloud viewer
- branded viewer themes
- kiosk-safe reconnect
- Pi/Chromium assumptions documented and tested

### Stage 4 - Build Local Sync Product

Only now add:

- Companion adapter
- offline cache
- cloud/local arbitration
- reconnect reconciliation
- LAN viewer pairing

This is where `local-sync-arbitration` belongs.

### Stage 5 - Extract Presentation/PPT

Build `presentation-core` and `OnTime PPT`:

- standalone Windows MVP from `ppt-probe`
- bridge mode later to publish `PresentationState`
- controller-side presentation UI consumes normalized state

### Stage 6 - Optional Suite Apps

After core products prove demand:

- OnTime Cue
- Show Controller
- NDI output

## Critical Tests Before Shipping Rebuild

Timer:

- negative elapsed remains valid
- start/pause/reset/set-active tuple updates are complete
- duration edit resets progress
- nudge changes duration, not elapsed
- reset restores original duration

Cloud:

- viewer public read works unauthenticated
- controller write requires auth/lock where applicable
- refresh cannot let stale cache override fresh cloud progress

Local/offline:

- Companion connected, cloud drops, local continues
- Companion drops, cloud continues
- Companion reconnects and reconciles without stale override
- clock skew does not let stale local state win
- two controllers cannot both write

Viewer:

- PWA install/fullscreen/wake lock path
- no-interaction kiosk recovery
- branded theme rendering
- network reconnect without manual refresh

Presentation:

- no PowerPoint open
- slideshow active
- slide change
- video playing/paused/ended
- timing unavailable
- multi-video slide

## Final Recommendation

The suite idea is viable, but only if OnTime stops treating local/offline, presentation,
cue control, and viewer hardware as extensions of one controller runtime.

Build the cloud timer/rundown product first around a clean timer core. Make offline/local
sync a separate app capability with its own arbitration module. Make PPT and Cue separate
products. Keep show-control as an optional future app, not a dependency.

The current code contains valuable behavior and hard-won fixes, especially on `main`, but
the data layer should be structurally rewritten. Incremental refactor inside
`UnifiedDataContext.tsx` will keep reproducing the same class of bugs.
