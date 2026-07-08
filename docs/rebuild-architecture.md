---
Type: Reference
Status: current
Owner: KDB
Last updated: 2026-07-08
Scope: Target architecture for the OnTime modular rebuild.
---

# OnTime Rebuild Architecture

_Draft date: 2026-06-08. Updated 2026-07-08._

This document defines the target architecture for the OnTime modular rebuild. It is based on
the current source-of-truth docs and the 2026-06 architecture audits. Archive docs are
historical only and are not used as authority.

## 1. Direction

OnTime should become a suite of standalone products that can run independently or together.
The rebuild should use the current repo as the reference and staging area, but it must not
copy the current tangled data layer into new folders.

The target products are:

| Product | Primary job | Shipping shape |
|---|---|---|
| OnTime Cloud | Hosted timer/rundown/control web product | Web app + Firebase + Cloud Functions |
| OnTime Local | Offline desktop/LAN app with optional cloud sync | Electron Companion + local server |
| OnTime Viewer Web | Browser/PWA viewer | Web app/PWA |
| OnTime Viewer iOS | Native mobile/tablet viewer | Native app, later |
| OnTime Viewer Android | Native mobile/tablet viewer and Pi-adjacent path if useful | Native app, later |
| OnTime PPT | Standalone PowerPoint video countdown | Windows-first app |
| OnTime Cue / Show Controller | OSC/HTTP/MIDI/show-control product | Separate app/module, optional |
| OnTime NDI | Broadcast output | Future product, depends on NDI SDK/licensing |
| Native Controller Apps | iOS/Android controller surfaces | Possible later products, not Stage 1 |

## 2. Non-Negotiable Principles

1. **Cloud is simple by default.** The Cloud product uses Firebase/Auth/Cloud Functions and
   does not own Local sync, offline arbitration, Companion queues, or LAN handoff.
2. **Local sync is a separate module.** Online/offline sync and arbitration are owned by
   the Local/Companion product as a distinct `local-sync-arbitration` module. Cloud must
   not import this module by default.
3. **Core has no product knowledge.** Timer core, shared types, and pure model packages do
   not know about Cloud, Local, Viewer, PPT, Cue, React, Firebase, Socket.IO, or Electron.
4. **Products compose packages.** Apps depend on shared packages. Packages do not depend on
   apps. Apps do not import from each other.
5. **Do not modularize by folder move.** The target `apps/` and `packages/` shape is a
   destination. Do not `git mv frontend/`, `companion/`, or `functions/` into `apps/`
   early. New packages are created beside existing folders first.
6. **Tangled code is evidence, not implementation.** `UnifiedDataContext` and
   `companion/src/main.ts` may be read to write tests and contracts. They must not be
   copied into new packages.
7. **Timer behavior is frozen during extraction.** `docs/timer-logic.md` and the Stage 0
   tests define the timer contract. Extraction must preserve behavior.
8. **Show-control is optional.** Cue/show-control logic must not be embedded in Cloud or
   core timer packages. It can become a separate product if demand is proven.

## 3. Target Package Topology

These package names describe ownership. They should be introduced gradually; do not create
empty packages just to make the tree look finished. Six of the ten are now **landed** (marked below);
the remaining four are still target-only.

| Package | Status | Owns | Must not own/import |
|---|---|---|---|
| `packages/shared-types` | landed | Room, timer, lock, cue, viewer, presentation, tier, and role types shared by apps | Runtime behavior, Firebase SDK, Socket.IO, React, Electron |
| `packages/interface-contracts` | landed | Firestore schema types, Cloud Function request/response types, Socket.IO payload types, read-side viewer schemas | Runtime behavior, Firebase SDK clients, Socket.IO clients/servers |
| `packages/timer-core` | landed | Pure timer math and state transitions from `docs/timer-logic.md` | UI, persistence, transport, Date.now hidden inside core functions |
| `packages/cloud-adapter-firestore` | target | Firestore read/write adapter, Cloud Function client calls, schema mapping | Local arbitration, Companion queueing, LAN state |
| `packages/local-sync-arbitration` | landed | Local/Companion-owned sync, authority switching, queue merge/replay, cloud/local reconciliation | Cloud-only UI, Firebase authority enforcement, viewer rendering |
| `packages/viewer-renderer` | target | Shared viewer display model and theme rendering contracts for web/native viewers | Controller actions, writes, lock control, arbitration |
| `packages/presentation-core` | landed | Normalized `PresentationState`, live cue video metadata, `videos[]` merge rules, probe output schema | PowerPoint COM/AX implementation, UI, transport |
| `packages/ppt-bridge` | target | Bridge contract and adapters around the Windows C# probe and future macOS probe | Core timer state, rooms, Cloud, Cue Controller |
| `packages/cue-controller-core` | target | Optional show-control domain model, triggers, OSC/HTTP/MIDI abstractions | Cloud timer core, Local sync authority, viewer rendering |
| `packages/lock-view-model` | landed | Pure **client-side** lock display/request-lifecycle derivation only (display-state + request lifecycle) | Server enforcement decisions (clear/supersede/timeout stay app-internal to Companion + Cloud Functions) |

### Local Sync Module

`packages/local-sync-arbitration` is deliberately separate from Cloud. It ships with
OnTime Local/Companion and any explicitly Local-enabled controller build. It owns:

- cloud/local source selection
- online/offline authority handoff
- pending/Companion state protection when cloud authority should hold
- reconnect reconciliation
- queue merge and replay
- cache freshness and tombstone handling
- split-brain prevention tests

It does not own Firebase security, Cloud Function lock enforcement, Cloud product UI, or
viewer display. If a Cloud-only customer never installs Local/Companion, this module is not
loaded.

## 4. Target App Topology

The app topology is a long-term shape. During early extraction, existing `frontend/`,
`companion/`, and `functions/` stay where they are.

| App | Owns | Allowed shared packages | Forbidden dependencies |
|---|---|---|---|
| `apps/cloud-web` | Cloud dashboard/controller/viewer routes for subscription product | `shared-types`, `interface-contracts`, `timer-core`, `cloud-adapter-firestore`, read-only viewer model | `local-sync-arbitration`, Companion server modules, Cue Controller runtime |
| `apps/local-companion` | Electron app, local server, LAN pairing, local cache, sync/arbitration module integration | `shared-types`, `interface-contracts`, `timer-core`, `local-sync-arbitration`, `presentation-core`, `ppt-bridge`, `lock-view-model` | Cloud-only UI ownership |
| `apps/viewer-web` | PWA/browser viewer, kiosk/Pi-compatible display | `shared-types`, `interface-contracts`, `timer-core`, `viewer-renderer`, read-side schema types | Writes, control, lock takeover, local sync arbitration |
| `apps/viewer-ios` | Native iOS viewer | `shared-types`, `interface-contracts`, `timer-core`, `viewer-renderer` via generated/bound contracts | Controller actions, Local sync internals |
| `apps/viewer-android` | Native Android viewer | `shared-types`, `interface-contracts`, `timer-core`, `viewer-renderer` via generated/bound contracts | Controller actions, Local sync internals |
| `apps/ppt-timer` | Standalone always-on-top PPT countdown | `presentation-core`, `ppt-bridge`, minimal formatting helpers | Rooms, Cloud, Firebase, Companion sync |
| `apps/cue-controller` | Optional OSC/HTTP/MIDI/show-control product | `shared-types`, `cue-controller-core`, selected presentation contracts | Core Cloud timer data layer, Local arbitration |
| `apps/cloud-functions` | Firebase Cloud Functions | `shared-types`, `interface-contracts` | `local-sync-arbitration`, client sync packages, React, Electron |
| `apps/controller-ios` | Possible native controller | TBD after Cloud/Local controller contracts are stable | Direct imports from web frontend/context |
| `apps/controller-android` | Possible native controller | TBD after Cloud/Local controller contracts are stable | Direct imports from web frontend/context |

## 5. Cloud Versus Local Controller Builds

The current frontend combines Cloud and Local behavior. The rebuild must split this by
capability.

Cloud-only controller:

- uses Firebase/Auth/Cloud Functions
- reads and writes through `cloud-adapter-firestore`
- uses `timer-core` for derived display and action math
- does not import `local-sync-arbitration`
- does not dual-write to Companion

Local-enabled controller:

- may run in the Local/Companion product or an explicitly Local-enabled build
- imports `local-sync-arbitration`
- can reconcile Cloud and Companion state
- owns online/offline handoff UX
- can queue and replay local writes

This split is the main architectural difference between the target product and the current
`UnifiedDataContext` behavior.

`packages/cloud-adapter-firestore` is a fresh adapter built from `docs/interface.md`,
`packages/interface-contracts`, and tests. It may use `FirebaseDataContext` as reference
material for behavior and mapping expectations, but it must not be copied from
`FirebaseDataContext`.

## 6. Authority And Locks

Cloud Functions remain the server authority for Cloud lock enforcement. A pure lock package
may provide display-state derivation and request lifecycle helpers, but it must not become a
second enforcement implementation.

Local/Companion may enforce local LAN control rules while offline. When Local reconnects to
Cloud, reconciliation is handled by `local-sync-arbitration`, not by Cloud.

## 7. Presentation And PPT

The Windows C# probe in `companion/ppt-probe/Program.cs` is a strong extraction candidate.
It should feed:

- `packages/presentation-core` for normalized `PresentationState`, slide/video timing, and
  live cue video metadata merge rules
- `packages/ppt-bridge` for the Windows probe adapter and future macOS Swift/AX adapter
- `apps/ppt-timer` for the standalone free app
- `apps/local-companion` when Local needs presentation state integration

`mergeCueVideos` now lives in `packages/presentation-core` (`mergeCueVideos`, `CueVideo`).

## 8. Viewer Products

Viewer rendering is a first-class product surface, not a controller side effect.

Web, iOS, and Android viewers should share:

- read-only room/timer/viewer state contracts
- theme/branding model
- display state derivation
- duration/remaining formatting through timer contracts

Viewers must not own:

- write operations
- controller locks
- room mutation
- Local sync arbitration
- cue/show-control authoring

Native viewer apps are not Stage 1 work. The architecture should reserve contracts for
them now so the web viewer is not designed as the only viewer implementation.

Native controller apps are also possible later, but only after controller capabilities are
formalized as contracts. Do not copy the current web context layer into native controller
planning.

## 9. Migration Stages

### Stage 0: Stabilize Current Behavior

PR #2 handles known timer/data stabilization. No architecture extraction belongs in Stage 0.

### Stage 0.5: Hygiene And Guardrails

Before serious extraction:

- land `docs/rebuild-architecture.md`
- land `docs/rebuild-extraction-rules.md`
- add boundary/grep checks
- add a separate line-ending hygiene PR if needed

### Stage 1a: Copy Already-Clean Pure Modules

Only modules already small and pure may be copied:

- timer helpers into `timer-core`
- reviewed shared types into `shared-types`
- reviewed pure arbitration helper only if it stays Local-owned and Cloud does not import it

Each copy gets tests and legacy re-export shims. No provider refactor.

### Stage 1b: High-Risk Carve-Outs

Anything carved from `UnifiedDataContext` or `companion/src/main.ts` is high risk and must
be done behind characterization tests:

- `interface-contracts` schema and event types
- lock view helpers
- presentation merge rules
- local sync queue/cache/reconciliation

These must be one-package-per-PR or smaller.

Some Stage 1b behavior has no clean pure seam yet because it is buried in React providers,
closures, or Companion process state. In those cases, use an extract-in-place pattern:

1. expose or isolate the smallest legacy behavior in place
2. add characterization tests against the legacy location
3. move the now-tested behavior into the new package
4. leave a legacy re-export or adapter shim

Do not skip characterization because the current code is hard to test.

### Stage 2: Adapter Boundaries

Introduce thin adapters while existing app folders remain in place:

- Cloud adapter
- Companion/local adapter
- viewer read adapter
- presentation bridge adapter

No `apps/` folder move yet.

### Stage 3: Product Splits

Only after packages and adapters are stable:

- create standalone viewer web app
- create standalone PPT app
- create Cue/Show Controller if still desired
- then consider native viewer/controller apps

### Stage 4: Late Folder Renames

Move existing app folders into final `apps/` topology only after the apps are already thin
and tests prove the boundaries. This is a late mechanical PR, not an architecture PR.

**Per-stage exit criteria:** each stage above has measurable exit gates (ratchet line ceilings,
package-population counts, boundary checks). Those gates are defined authoritatively in
`docs/rebuild-plan.md` §3 "Per-stage exit criteria" (Stage 1b / Stage 2 / Stage 3 / Stage 4
exits) and supersede any narrative "done" claim for a stage. The architecture doc does not
restate them inline to avoid drift; link to the plan for the current numbers.

## 10. Open Decisions

> The product-level questions below have all been **ratified** in `docs/rebuild-plan.md` §
> "Decisions" (D1–D4). They are retained here as the architectural framing and annotated with
> their ruling. The remaining process-gating item is D6 (takeover-policy docs reconciliation /
> branch protection). D7 (line-ending hygiene) is **DONE** — #86 + #91 normalized TS/TSX/JS source to LF
> (see `rebuild-extraction-rules.md` §7).

- Cloud vs Local controller — separate builds or separate apps? **Decided — see
  `rebuild-plan.md` Decisions (D1):** one codebase, two build targets.
- Native iOS/Android viewer schema source — generated TypeScript-derived or language-neutral?
  **Decided — see `rebuild-plan.md` Decisions (D2):** plain TS types in `interface-contracts`
  for now, structured so JSON-Schema generation can be added before any native viewer work.
- Native controller apps — commercial priority or later platform expansion? **Decided — see
  `rebuild-plan.md` Decisions (D4):** waived from the Definition of Done; revisit post-Stage 3.
- Cue/Show Controller — paid product, free tool, or deferred? **Decided — see
  `rebuild-plan.md` Decisions (D3):** deferred and waived from the Definition of Done; cue
  types still go to `shared-types` / `interface-contracts`.
- NDI — output package, separate app, or licensed plugin? **Decided — see `rebuild-plan.md`
  Decisions (D4):** waived from the Definition of Done; no near-term work.
