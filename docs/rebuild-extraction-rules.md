---
Type: Reference
Status: current
Owner: KDB
Last updated: 2026-06-08
Scope: Rules governing Stage 1+ rebuild extraction work (prevent copying tangled legacy code into cleaner folders).
---

# OnTime Rebuild Extraction Rules

_Draft date: 2026-06-08._

These rules govern Stage 1 and later rebuild work. They exist to prevent builder agents
from copying tangled legacy code into cleaner-looking folders.

## 1. Core Rule

Legacy tangled code is reference material, not implementation material.

Builders may read legacy code to understand behavior and write characterization tests. They
may not move, paste, or import legacy god-files into new packages unless the source file is
explicitly allowlisted in this document.

## 2. Hard Denylist

The following files/modules must not be copied, moved, imported from new packages, or used as
the base for a "v2" implementation:

- `frontend/src/context/UnifiedDataContext.tsx`
- `frontend/src/context/FirebaseDataContext.tsx`
- `frontend/src/context/MockDataContext.tsx`, except as test reference
- `frontend/src/context/CompanionDataContext.tsx`
- `frontend/src/context/CompanionConnectionContext.tsx`, except as transport reference
- `companion/src/main.ts`
- any current mixed Cloud/Local/cue/show-control data flow

Forbidden outcomes:

- `UnifiedDataContextV2`
- a new single file that combines Firebase, Socket.IO, arbitration, queueing, locks, and UI
- a new Companion god-file that combines Electron, HTTP, Socket.IO, PPT, cache, JWT, and
  pairing
- moving existing app folders into `apps/` before packages/adapters exist

## 3. Allowlist

The following sources may be copied or extracted intentionally after review:

- `frontend/src/utils/timer-utils.ts` into `packages/timer-core`
- reviewed subsets of `frontend/src/types/index.ts` into `packages/shared-types`
- `frontend/src/lib/arbitration.ts` only into the Local-owned arbitration module, never
  into Cloud by default
- pure lock helper functions after tests prove they are display/request helpers, not
  enforcement authority
- `companion/ppt-probe/Program.cs` into the PPT bridge/product path
- selected Cloud Function authority patterns from `functions/src/lock.ts`
- selected Electron shell patterns from `controller/`, if relevant

Everything else starts as reference material.

## 4. Package Import Rules

Packages must be pure unless explicitly named as adapters.

General package bans:

- no imports from `frontend/src/context/*`
- no imports from `companion/src/main.ts`
- no imports from `apps/*`
- no React imports in pure packages
- no Firebase imports in pure packages
- no Socket.IO imports in pure packages
- no Electron imports in pure packages
- no direct `localStorage`/`sessionStorage` in pure packages; inject storage

Specific product rules:

- Cloud must not import `local-sync-arbitration`.
- Cloud must not import Companion server modules.
- Cloud must not import Cue/Show Controller runtime.
- Viewer must not import write/control/lock-takeover modules.
- Viewer must not import `local-sync-arbitration`.
- PPT Timer must not import rooms, Firebase, Companion sync, or Cloud code.
- Cloud Functions must not import `local-sync-arbitration` or client sync packages.

## 5. Local Sync / Arbitration Rules

`packages/local-sync-arbitration` is a separate module owned by Local/Companion.

It may own:

- source arbitration
- authority handoff
- reconnect reconciliation
- queue merge/replay
- progress cache merge
- tombstone handling
- cloud-lock/online-authority protection rules
- split-brain tests

It must not own:

- Cloud-only controller behavior
- Firebase security rules
- Cloud Function enforcement
- viewer rendering
- cue/show-control authoring

Any PR that causes Cloud-only code to import `local-sync-arbitration` fails review.

The current arbitration rollout state is frozen during extraction. If existing flags such
as `ARBITRATION_FLAGS` leave specific domains disabled, extraction must preserve that flag
state. Enabling additional arbitration domains is a later Local-module behavior PR, not part
of a move/extraction PR.

## 6. Banned Pattern Gates

These checks ship in `scripts/check-rebuild-guardrails.mjs` + `.dependency-cruiser.cjs` (landed
across #4/#34/#35/#41/#61/#64) and run in required CI:

```text
No imports from frontend/src/context/UnifiedDataContext into packages/
No imports from companion/src/main into packages/
No @ontime/local-sync-arbitration import from Cloud-only app code
No Firebase/Socket.IO/React/Electron imports in pure packages
No new file over 400 production lines without explicit approval
No new function that reimplements timer elapsed math outside timer-core
No mergeProgress(roomProgress, cachedProgress) cache-wins call
No Math.max(0, elapsed...) clamp in timer elapsed calculations
```

Notes on the gates (precise definitions):

- **400-line new-file cap:** the **D5 ≤500-line pure-wiring composition shim** is the one
  pre-approved exception (allowed only where a file must physically exist — React provider
  composition root / Electron entry — holding ZERO logic; see `rebuild-plan.md` D5). All other
  new files stay under 400 production lines unless explicitly approved. **CI scope:**
  `checkFileSizeCeilings()` enforces this cap only for `packages/` and `apps/` files; carves in
  `companion/src` and `frontend/src` are not size-gated by CI and must be checked in review.
- **`mergeProgress` cache-wins:** the banned pattern is the **reversed argument order**
  `mergeProgress(roomProgress, cachedProgress)` — cache as the priority (second) argument, so
  cache wins on key conflicts. The correct contract is
  `mergeProgress(cachedProgress, freshProgress)`: the fresh source wins and the cache only fills
  keys absent from the fresh source (`docs/timer-logic.md` §4 is authoritative). The guardrail
  greps for that exact reversed order.
- These began as grep checks; the import/boundary rules are now dependency-cruiser enforced.
  The duplicate-formula, clamp, and progress-merge-order checks remain grep tripwires — the
  timer test-net is the real guarantee against reordered/aliased forms.

## 7. Line-Ending Hygiene

TS/TSX/JS source files were normalized to LF in #86 and finished in #91 (D7), so the repo no
longer carries mixed line endings in source. Behavior PRs must still not include line-ending
normalization — keep it in dedicated hygiene PRs.

Before high-risk extraction from large files, add a separate hygiene PR if needed:

- `.gitattributes` policy
- mechanical line-ending normalization only
- no semantic changes
- no architecture changes

Extraction PRs must pass:

```text
git show --check HEAD
git diff --check main...HEAD
```

If those commands fail because of line endings, fix the extraction patch or split a hygiene
PR first.

## 8. Extraction Workflow

**Destination is mandatory:** state the §3/§4 target destination (package or `app-internal`)
in the PR description and ledger entry. A carve with no destination is not a valid unit
(guardrail G3; paired with the `// rebuild-target:` marker check, G1).

Every extraction PR must follow this order:

1. Identify the source behavior.
2. Add or move characterization tests.
3. Create the smallest package/module needed.
4. Copy only allowlisted pure logic or rewrite from tests.
5. Add a legacy re-export shim if needed.
6. Run targeted tests.
7. Run lint/typecheck.
8. Confirm boundary checks.
9. Document what was intentionally deferred.

If a Stage 1b behavior has no clean pure seam yet, use extract-in-place:

1. isolate the smallest legacy behavior where it currently lives
2. test it in place
3. move it only after the behavior is characterized
4. keep a legacy shim if existing callers still need it

Useful existing characterization baselines include:

- `frontend/src/context/UnifiedDataContext.test.ts`
- `frontend/src/__tests__/snapshotStale.test.ts`
- `frontend/src/__tests__/seedCompanionCache.test.ts`
- `frontend/src/__tests__/undoUpdates.test.ts`

No extraction PR may include:

- folder-wide app moves
- unrelated UI polish
- behavior changes not covered by tests
- broad formatting
- mixed Cloud/Local/Cue scope

## 9. Stage Gates

### Stage 0 To Stage 0.5

Required:

- PR #1 architecture audit docs reviewed/merged
- PR #2 timer stabilization reviewed/merged
- full known-failure baseline documented

### Stage 0.5 To Stage 1a

Required:

- `docs/rebuild-architecture.md` accepted
- `docs/rebuild-extraction-rules.md` accepted
- boundary check plan accepted
- no active branch mixing viewer polish with timer/core work

### Stage 1a

Allowed:

- clean pure module copy
- tests
- re-export shims

Not allowed:

- provider refactors
- app folder moves
- `UnifiedDataContext` surgery

### Stage 1b

Allowed only with heavier review:

- `interface-contracts` type carve-outs from god-files
- lock display helper carve-outs
- presentation merge rule extraction
- local sync queue/cache extraction

Required:

- characterization tests before extraction
- one concern per PR
- no file over 400 production lines unless approved
- no Cloud import of Local sync

## 10. Product Boundary Checklist

Before any PR that creates or modifies a package, reviewers must answer:

- Does this package know about a product it should not know about?
- Does Cloud import Local sync or arbitration?
- Does Viewer import control/write behavior?
- Does PPT import room/cloud/sync behavior?
- Does Cue/Show Controller leak into Cloud/core?
- Did the PR copy from a denylisted file?
- Are tests proving behavior rather than trusting moved code?
- Is this PR doing a folder move before tests?

If any answer is unsafe, stop the PR.

## 11. Rollback Conditions

Revert or stop extraction if:

- a boundary check fails
- timer behavior changes outside an approved Stage 0 fix
- Cloud-only code imports Local sync
- a builder copies denylisted code
- a package grows into a god-file
- full app behavior changes without an explicit product decision
- the PR becomes difficult to review because of formatting or line-ending churn

## 12. Instructions For Builder Agents

Use this exact instruction block for Stage 1+ builder prompts:

```text
You are working on the OnTime modular rebuild.

Do not use docs/archive as source of truth.
Do not copy or import UnifiedDataContext, FirebaseDataContext, MockDataContext, or companion/src/main.ts into new packages.
Do not move frontend/, companion/, or functions/ into apps/.
Do not make Cloud import local-sync-arbitration.
Do not mix viewer polish, timer fixes, and extraction in one PR.
Name your §3/§4 target destination in the PR; a carve with no destination is not a valid unit.
Every new or renamed module under companion/src/ or frontend/src/{context,lib,utils}/ must carry a `// rebuild-target: packages/<name>` or `// rebuild-target: app-internal (<app>)` header (guardrail G1); CI fails without it.

Your task is one package or one narrow boundary only.
First add/identify tests. Then extract or rewrite behind those tests.
If you need behavior from a denylisted file, read it as reference and write tests; do not paste it.
Stop and report if the requested work requires crossing these rules.
```
