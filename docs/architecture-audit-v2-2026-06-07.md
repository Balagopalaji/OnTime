---
Type: Reference
Status: current
Owner: KDB
Last updated: 2026-06-07
Scope: Full-repo architecture & product audit v2 (point-in-time 2026-06-07; the rebuild is the active successor).
---

# OnTime — Architecture & Product Audit v2 (Corrected, Full-Repo)

_Audit date: 2026-06-07 · Reviewer: deep full-repo audit · Supersedes
`docs/architecture-audit-2026-06.md` (v1) and reconciles with
`docs/codex-architecture-audit-2026-06-07.md`._

> **Why a v2.** v1 was scoped to the frontend data/sync layer + the `research/ppt-video-timing`
> diff. It **missed**: the second Electron app (`controller/`), the **C#/Windows PowerPoint
> probe** (`companion/ppt-probe/Program.cs`, the *production* probe), the **already-designed
> modular tier architecture** (`docs/archive/modularity-architecture.md`), the canonical
> protocol contract (`docs/interface.md` v1.4.0), the PRDs, and the LAN/offline plan. v1's
> **duplication findings remain correct**; its **product-decomposition section was
> under-informed**. This v2 is grounded in a full repository inventory and the design-doc
> corpus. Where v1 and v2 differ, **v2 wins.**

> **Corrections applied 2026-06-07 (post-review, git-verified).** Three load-bearing errors
> in the first v2 draft were fixed: (1) `stable-cloud` does **not** contain the progress fix
> and is **not** cue-free — both branch tips share the same buggy merge order, and the fix is
> only an uncommitted working-tree change (§8, §11); (2) `docs/archive/modularity-architecture.md`
> is **archived** and not authoritative per `AGENTS.md` — tier authority is `interface.md` /
> `app-prd.md` (§0); (3) Stage 0 / §8 reworded accordingly. **Rebuild vs. continue:** there is
> no clean branch to escape to — the rebuild *continues on `main`* (stabilize, then extract
> modules); it is not a from-scratch rewrite.

---

## 0. The single most important correction

**The modular suite is not a new idea to be invented — it is already designed, and partly
already built.** The implementation tangled it; the rebuild's job is to *realize the
existing design* with clean module boundaries, not to dream up a new product structure.

Evidence I had not read when writing v1 (authoritative = non-archived docs):
- `docs/interface.md` (v1.4.0) is a **canonical, versioned protocol contract** — Firestore
  schemas (incl. `tier` + `features` on `rooms`), Cloud Functions API, Companion WebSocket
  events, REST API, bridge protocol. **This is the authoritative tier/feature source.**
- `docs/app-prd.md` (current) defines the tiered modular product (timer core / show control /
  planner) and the gating in "Planned Phases."
- `docs/archive/modularity-architecture.md` describes the Basic/Show-Control/Production tier
  model and Companion `minimal/show-control/production` modes in detail — but it is
  **archived**. Per `AGENTS.md`, archive docs are historical only and **must not** be treated
  as source of truth; current docs win on conflict. Cite it as *evidence of prior design
  intent*, and confirm any specifics against `interface.md`/`app-prd.md` before relying on
  them.
- `docs/phase-3-standalone-ppt-timer.md` already specs a **standalone free Windows PPT
  timer as an upsell funnel** ("native helper already exists") — i.e. Codex's "OnTime PPT"
  product was already planned.
- `docs/phase-4-overview.md` already specs viewer **theming/branding**, native iOS/Android
  viewers, **remote-file-open on the show laptop**, and **modular packaging**.
- `docs/local-offline-lan-plan.md` (status: current) is a detailed **LAN/offline security
  spec** (HTTPS/WSS + trusted cert, PNA/CORS, loopback token endpoint, RFC1918 allowlist,
  cert SAN strategy, pairing TTLs, Companion cache as single source of truth).

**Consequence:** Codex's product framing felt stronger than v1's because it was *grounded in
these docs*; v1 reasoned from code alone. The decomposition below is anchored to the
existing tier model and `interface.md`, not reinvented.

---

## 1. Complete asset inventory (what actually exists)

| Asset | Path | State | Verdict |
|---|---|---|---|
| Web frontend (React SPA) | `frontend/` | Controller+Viewer+Dashboard in one app | Split by surface |
| **Controller desktop app** | `controller/` (Electron) | **Clean thin shell**: static-server frontend wrapper, window/session state, crash recovery, `ontime://` deep links, auto-updater, auth-popup handling. No timer/sync logic. | **KEEP — reusable packaging shell for any suite desktop app** |
| Companion desktop app | `companion/src/main.ts` (7,534 lines) | **God-file**: JWT/keychain auth, pairing, **PPT polling**, room-state mirror, lock/pin/presence, TLS serving, viewer hosting | **REWRITE/SPLIT** |
| **C# Windows PPT probe** | `companion/ppt-probe/Program.cs` (417 lines) | **Mature, production.** STA helper over PowerPoint COM (`SlideShowWindows`, `View.Player(id).CurrentPosition/State`, `MediaFormat.Length`) → slide #, per-video duration/elapsed/remaining/playing via stdin/stdout `poll` | **KEEP — core of `ppt-bridge` / OnTime PPT** |
| Swift macOS PPT probe | `companion/ppt-probe/ppt-probe-mac.swift` (692 lines, **research branch only**) | Experimental AX probe; best-effort (AX unreliable per plan doc) | KEEP as the macOS sibling; treat as best-effort |
| ffprobe fetch | `companion/scripts/fetch-ffprobe.js` | Video duration via ffprobe | KEEP for `ppt-bridge` file metadata |
| Cloud Functions | `functions/src/{lock,operators,index}.ts` (553 lines) | Server-authoritative lock/control/operator API | **KEEP — canonical control authority** |
| Security rules + schema | `firebase/firestore.rules` (186) + `docs/interface.md` (837) | Subcollection data model, tier gating, public viewer reads, lock-gated writes | **KEEP — the canonical bounded-context map** |
| Frontend data layer | `frontend/src/context/*` | God-module `UnifiedDataContext` (6,944 on main) | **REWRITE** |
| Shared timer math | `frontend/src/utils/timer-utils.ts` | Correct, but bypassed by duplicates | **KEEP — make canonical & enforced** |
| Arbitration engine | `frontend/src/lib/arbitration.ts` | Good seed, disabled for most domains | **KEEP — move into local-sync module** |

There are therefore **three runtime targets already** (web frontend, `controller/` Electron,
`companion/` Electron) — the suite is partially physically present, just not cleanly bounded.

---

## 2. The defining architectural decision: arbitration placement

`docs/app-prd.md` documents the **current official architecture** as "**Parallel Sync
Principles**":
> No single primary: Firebase and Companion are **equal** sources of truth. **Dual-write
> always.** Timestamp arbitration. Confidence window. Safe reconnect.

The rebuild direction (yours, Codex's, and v2's) **deliberately departs from this** for the
cloud product:

- **OnTime Cloud** becomes **single-source (Firestore)**. No dual-write, no cloud↔local
  arbitration, no offline queue. Control authority via the server lock (Cloud Functions).
- **Arbitration only exists where there are two authorities** — i.e. inside **OnTime Local**
  (cloud + local Companion). It ships in `local-sync-arbitration`, which the cloud product
  **does not import.**

This is the correct call (arbitration is the single largest source of the recurring bugs),
but it must be recorded as an **intentional principle change**, because `app-prd.md`,
`local-mode.md`, and `edge-cases.md` all currently assume "no single primary / dual-write
always." Those docs need updating when this lands. **Do not let a future agent "restore"
dual-write into cloud thinking it's fixing a regression.**

---

## 3. Bounded contexts (anchored to the existing tier model + `interface.md`)

| # | Context | Owns | Maps to tier / schema |
|---|---|---|---|
| 1 | **Timer runtime** | active-timer state machine, elapsed/remaining/nudge | `state/current`; all tiers |
| 2 | **Rundown definition** | rooms, timers, sections, segments, ordering | `rooms`, `timers`, `sections`, `segments` |
| 3 | **Cloud transport** | Firestore read/write, schema mapping | `interface.md` §2 |
| 4 | **Local sync** | Companion socket, cache, offline queue, tombstones, **arbitration** | `interface.md` §3, §5; Basic+ (localMode) |
| 5 | **Collaboration/Control** | lock, presence, pin, takeover, operators/invite/blocked | Cloud Functions, `lock/current`, `operators` |
| 6 | **Presentation** | normalized slide/video state; PPT/video probes | `liveCues`, `PRESENTATION_*` events; Show Control tier |
| 7 | **Cue/Show-planner** | manual cues, crew chat, showcaller | `cues`, `crewChat`; Production tier — **out of core** |
| 8 | **Viewer** | read-only render, theming, kiosk recovery | public reads; all tiers |

The Firestore subcollection layout **already separates these** (tier-gated in
`firestore.rules`). The decomposition follows the data model that exists.

---

## 4. Target suite (reconciled: Codex lineup + v2 grounding)

```text
apps/
  controller-web/      OnTime Cloud — Firestore-only, no arbitration, no cue core
  controller-desktop/  reuse existing controller/ Electron shell (KEEP)
  viewer/              OnTime Viewer — read-only PWA; ViewerTheme; kiosk/Pi recovery
  companion/           OnTime Local — bridge host (split from today's main.ts)
  presentation-bridge/ OnTime PPT — standalone; wraps ppt-probe (C# Win + Swift mac)
  cue-engine/          OnTime Cue — OSC/HTTP/MIDI (future, separate)

packages/
  timer-core/              pure reducer + timer-utils (ONE elapsed/transition impl)
  rundown-model/           room/timer/section/segment types + mappers (ONE mapRoom/mapTimer)
  cloud-adapter-firestore/ Firestore I/O + schema mapping (interface.md §2)
  local-sync-arbitration/  Companion adapter + cache + arbitration (interface.md §3/§5)
  collab-control/          lock/presence client; defers to Cloud Functions authority
  presentation-core/       normalized PresentationState + bridge contract
  ppt-bridge/              probe drivers (Program.cs Windows, swift mac, ffprobe)
  viewer-renderer/         FitText/timer display/theming
```

Rule (both audits agree): **suite ≠ every app imports every package.** OnTime Cloud depends
on `timer-core` + `cloud-adapter-firestore` + `collab-control` + `viewer-renderer` only.
`local-sync-arbitration` is opt-in.

---

## 5. Canonical implementations (the never-duplicate list)

| Concept | Canonical home | Today's duplicates to collapse |
|---|---|---|
| Elapsed/remaining/nudge math | `timer-core` (`timer-utils`) | `useTimerEngine:52` (clamps), `MockDataContext:202` (clamps), inline `now-startedAt` |
| Timer transitions | `timer-core` reducer | Firebase, Unified, Mock, **+ companion `main.ts`** (4 sites) |
| Firestore doc mapping | `cloud-adapter-firestore` | `FirebaseDataContext` + `useRoom` + `useTimers` (4 mappers) |
| Cloud↔local resolution | `local-sync-arbitration` (`arbitrate`) | `resolveRoomSource` fallback, `pickSource`, inline `mergeProgress` |
| Cached-progress merge | `local-sync-arbitration` | duplicated `mergeProgressFromCache` (`:2391`, `:4581`) |
| **Presentation-state merge** | `presentation-core` | `mergeCueVideos` empty-overwrite bug (edge-cases §7) |
| Control authority | Cloud Functions + `collab-control` client | client lock/hold logic re-deciding authority in Unified |
| Presentation status mapping | `presentation-core` | `LiveCue.metadata` grab-bag |

**New duplication found in this pass (presentation domain):** `edge-cases.md` §7 documents a
live flicker bug — a newer `liveCue` record with empty `videos[]` overwriting a populated
one, "fixed" by a metadata-preserving `mergeCueVideos`. **This is the same merge-priority bug
class as the cached-progress bug**, now in presentation state. It confirms the thesis:
merge-priority rules implemented ad-hoc, per-domain, keep reproducing the same defect.
`presentation-core` must own one "fresh wins, fill gaps, never blank populated media" rule.

**Dead code (Codex catch, confirmed):** `applyNudge` (`timer-utils.ts:75`) has **zero
non-test call sites** — the canonical nudge helper is bypassed by inline nudge logic. Delete
or wire it as the single nudge path in `timer-core`.

---

## 6. Keep / Extract / Rewrite / Delete (updated with full inventory)

**KEEP (reuse largely as-is):**
- `controller/` Electron shell — clean; becomes `controller-desktop` and a template for
  `viewer`/`companion` packaging (deep links, crash recovery, auto-update already solved).
- `functions/src/*` — server-authoritative lock/operator API; the canonical control plane.
- `firestore.rules` + `interface.md` — the bounded-context + protocol map.
- `companion/ppt-probe/Program.cs` (C# Windows) — the production presentation reader.
- `timer-utils.ts`, `arbitration.ts`, `AppModeContext`, `CompanionConnectionContext`,
  FitText / LiveTimerPreview / PresentationStatusPanel, viewer rendering.

**EXTRACT:**
- Timer transitions → `timer-core`; mappers → `rundown-model`/`cloud-adapter-firestore`;
  cache/queue/arbitration → `local-sync-arbitration`; PPT polling out of `companion/main.ts`
  → `ppt-bridge`; presentation status → `presentation-core`.

**REWRITE:**
- `UnifiedDataContext.tsx` (thin composition over packages), `companion/src/main.ts` (split
  into bridge host + presentation bridge), `MockDataContext` (→ fake transport adapter),
  `ViewerPage` data layer (single read-model).

**DELETE:**
- `resolveRoomSource` hand-rolled fallback, `ARBITRATION_FLAGS`, the two elapsed clamps, a
  duplicate `mergeProgressFromCache`, dead `applyNudge`, `CompanionDataContext` wrapper,
  duplicate `mapRoom`/`mapTimer`.
- **From the cloud core:** cue/showcall/sections/crew-chat (move to optional Show-Controller
  app; `stable-cloud` already dropped most of this — see §8).

---

## 7. Migration plan (reconciled; Codex ordering + v2 safety net)

- **Stage 0 — stabilize the active line (`main`):** the fresh-wins progress merge fix is
  currently **uncommitted in the working tree** (both branch tips still have the buggy
  `mergeProgress(roomProgress, cachedProgress)` order) — isolate it from the file's
  line-ending churn and **commit it on `main`**; kill the two elapsed clamps; remove dead
  `applyNudge`; make `useTimerEngine` + Mock call `timer-utils`; regression-test negative
  elapsed, cache priority, and the `mergeCueVideos` empty-overwrite case.
- **Stage 0.5 — lock the `main`-only fixes** (v1 §A.3 list: reauth/takeover contract,
  removed bundled TLS key, join-watchdog, takeover-arbitration regression, mode-flap loops,
  offline bootstrap) into a regression suite **before** extraction.
- **Stage 1 — `timer-core`:** pure reducer + math; adapters persist, never re-derive.
- **Stage 2 — OnTime Cloud:** Firestore-only path, no Companion/arbitration/queue/cue.
  Reuse `controller/` shell for desktop. Validates the commercial core. (Cue-free scope is a
  **deliberate rebuild decision**, not a property of any existing branch — see §8.)
- **Stage 3 — OnTime Viewer:** standalone read-only PWA; `ViewerTheme` first-class; kiosk/Pi
  recovery; reuse the public-read path.
- **Stage 4 — OnTime Local:** add `local-sync-arbitration` + Companion adapter + cache + LAN
  pairing (per `local-offline-lan-plan.md` security model). Arbitration lives **only** here.
- **Stage 5 — OnTime PPT / presentation:** `presentation-core` + `ppt-bridge`; standalone
  Windows MVP from `Program.cs` (per `phase-3-standalone-ppt-timer.md`); bridge mode
  publishes `PresentationState`.
- **Stage 6 — optional:** OnTime Cue (OSC/MIDI), Show-Controller (cues/showcaller), NDI.

---

## 8. The `stable-cloud` ↔ `main` synthesis (CORRECTED 2026-06-07)

> Earlier drafts of this section were wrong on two facts (caught in review, verified by git).
> Corrected below.

- **Both branch tips are essentially the same tangled code, and both carry the
  cached-progress bug.** `stable-cloud` tip and `main` tip both have
  `mergeProgress(roomProgress, cachedProgress)` (cache wins). There is **no clean branch**.
- **The fresh-wins progress fix is NOT committed on either branch.** It exists only as an
  **uncommitted change in the working tree** (inside a whole-file churn of
  `UnifiedDataContext.tsx`). It must be isolated from the line-ending churn and committed —
  right now it is one `git checkout` from being lost.
- **`stable-cloud` is NOT cue-free.** Its `firestore.rules` and `types/index.ts` still carry
  `sections`/`segments`/`cues`/`liveCues`. It is *not* a reduced "cloud-only scope" template;
  it is simply an older `main` (Feb-1 phase-3 tip) + a deploy workflow + a TS build fix.
- Therefore the OnTime Cloud **cue-free scope is a deliberate design decision to make during
  the rebuild**, not a property `stable-cloud` already has. Do not treat `stable-cloud` as a
  scope template — treat it only as a "this built and deployed" reference point.
- Behavioral source of truth = **`main`** (most hardening). The rebuild continues on `main`:
  commit the progress fix, then extract. Harvest `research/ppt-video-timing` (probe work) and
  preserve the `fix/companion-cloud-issues` authority *requirement* (§11).

---

## 9. Biggest risks

1. **Re-forking by splitting before collapsing.** Build `timer-core` and the canonical merge
   rules first; only then split apps. Otherwise every app inherits the duplicate bugs.
2. **Restoring dual-write into cloud.** The departure from "Parallel Sync Principles" (§2)
   must be documented in `app-prd.md`/`local-mode.md`, or it will be "fixed" back in.
3. **Merge-priority bugs are systemic, not incidental.** Progress merge *and* presentation
   `videos[]` merge already hit the same defect. One canonical "fresh-wins/fill-gaps" rule
   per domain, tested, is non-negotiable.
4. **Losing `main`'s hardening + the probes.** The reauth/takeover security contract, the
   C# Windows probe, and the Swift mac probe are hard-won and live in different
   branches/files. Inventory and regression-lock them before rewriting.
5. **LAN security surface.** OnTime Local carries real security weight (cert/trust, PNA,
   token scoping, RFC1918 allowlist per `local-offline-lan-plan.md`). It is a product, not a
   feature flag; do not ship until handoff is boring under bad Wi-Fi.

---

## 10. Coverage statement (honest)

**Read in full this pass:** `controller/src/main.ts` + `package.json`,
`companion/ppt-probe/Program.cs`, `functions/src/*`, `firestore.rules`, `interface.md`,
`app-prd.md`, `local-offline-lan-plan.md`, `edge-cases.md`,
`archive/modularity-architecture.md`, `phase-4-overview.md`,
`phase-3-standalone-ppt-timer.md` (head), `AppModeContext`, plus v1's full frontend/branch
audit. **Inventoried (not line-read):** full `companion/src/main.ts` body (7,534 lines —
concern-mapped), `companion/ppt-probe/ppt-probe-mac.swift` (header + output schema read),
the `.sdef`/dictionary XML artifacts. **Sampled, not full-read:** `cloud-lock-design.md`
(786), `phase-3-arbitration-research.md` (1,039), `local-mode.md` (614), the remaining PRDs —
their decisions are reflected via `interface.md`/`firestore.rules`/`functions`, but a builder
implementing collaboration/control or arbitration in depth should read those three directly.

**What v1 missed and v2 corrects:** the `controller/` app, the C# Windows probe, the
modularity/tier design, `interface.md`, the LAN/offline plan, and the standalone-PPT plan.
The conclusion is unchanged and stronger: **structurally rewrite around a pure core and
realize the already-designed modular suite; do not refactor `UnifiedDataContext` in place.**

---

## 11. Branch Ledger (canonical — do not treat old phase branches as rebuild sources)

_Verified 2026-06-07 against `origin/*` via `git rev-list --count <branch> --not origin/main`.
Reconciles v1 §A and the Codex second-run ledger. Add no other branch to the "source" set
without re-verifying unique commits here._

| Branch | Unique commits vs `main` | Role in rebuild |
|---|---:|---|
| **`main`** | — (baseline) | **Behavioral source of truth.** Phase-3 line + hardening (reauth/takeover, handshake, join-watchdog, offline bootstrap, selected-reset, demo stabilization, PPT restore). Architecturally tangled; behaviorally richest. Still carries the cached-progress merge bug; CI red. |
| **`stable-cloud`** | 2 ahead / 50 behind | **Deploy reference only.** The 2 commits = a Firebase deploy workflow + a TS build fix. **NOT cue-free** (rules/types still carry sections/segments/cues) and does **not** contain the progress fix (its tip has the same buggy merge order as `main`). Not newer, not cleaner, not a scope template. |
| **`research/ppt-video-timing`** | **11** | **Presentation salvage (informational, not a merge).** Keepers: `companion/ppt-probe/ppt-probe-mac.swift`, `companion/ppt-probe/diagnose-ax.swift`, `docs/ppt-video-macos-plan.md`, `docs/ppt-video-debug-macos.md`. Feeds `presentation-core`/`ppt-bridge`. Cumulative diff is noisy (forked before later `main` work) — harvest, don't merge wholesale. |
| **`fix/companion-cloud-issues`** | **1** (`b832ccc`, Jan 28) | **Preserve the requirement, not the code.** A 314-line rewrite of `UnifiedDataContext` authority handling — too far behind `main` to cherry-pick. Capture the *rule*: pending/Companion state must not casually override cloud authority when a cloud lock / online authority should hold. Encode as an **arbitration requirement** + test in `local-sync-arbitration`. |
| **`salvage-m1-passb-attempt`** | **1** (WIP) | Mostly superseded by `main`'s lock/takeover work. Only minor idea: room-ordering/reorder utilities (`reorderRoom.mock.test.tsx`). Not a primary salvage source. |
| `phase-3`, `phase-3-arbitration`, `phase-3-save-load-sessions`, `phase-3c`, `phase-2-implementation`, `parallel-sync-fix`, `ui-overhaul`, `connect-loop-debug-session` | **0 each** | **Fully contained by `main`.** Historical sequencing only — no unique code to harvest. Do not treat as competing sources of truth. |

**Source model for the rebuild:** behavior ← `main`; cloud scope ← `stable-cloud`;
presentation/probe ← `research/ppt-video-timing`; one authority rule ← `fix/companion-cloud-issues`
(as a requirement); everything else = historical context.
