# OnTime Rebuild Plan & Reconciliation

_Prepared 2026-07-04. Authored by a fresh-context Fable architect; load-bearing claims independently
verified against the repo by the Claude orchestrator; product decisions ratified by the owner (see
"Decisions", below). This is the authoritative next-phase plan — it operationalizes
`docs/rebuild-architecture.md` (the target) and does not replace it._

**Read order for any builder:** `docs/rebuild-architecture.md` (the target topology) → this file (reconciliation,
definition of done, sequence, decisions) → `docs/rebuild-extraction-rules.md` (constraints) →
`docs/rebuild-progress.md` (current state) → `docs/rebuild-companion-coupling.md` (companion coupling map).
Do not rely on chat history.

## Decisions (ratified 2026-07-04 by the product owner)

| ID | Decision | Ruling |
|---|---|---|
| **D1** | Cloud vs Local controller: separate builds or separate apps | **One codebase, two build targets.** Cloud-only vs Local-enabled differ by entry point/composition; dependency-cruiser enforces per-entry-point reachability (Cloud entry cannot reach `local-sync-arbitration`). Reversible to separate apps later if build-target enforcement proves leaky. (Aligns with the architecture doc's existing "Local-enabled build" language, §3/§5.) |
| **D5** | God-file end-state | **Complete deletion is the goal.** Both `frontend/src/context/UnifiedDataContext.tsx` and `companion/src/main.ts` are dismantled and their logic rewritten into their proper packages/modules. A ≤500-line composition shim is allowed ONLY where a file physically must exist (React provider composition root; Electron entry) and then holds ZERO logic — pure wiring. Where outright deletion is possible, delete. |
| **D2** | Native schema strategy | **Plain TS types only for now** inside `packages/interface-contracts` — no runtime schema lib (no zod/io-ts) in the package, to keep it pure. Structured so JSON-Schema generation can be added before any native viewer work. |
| **D3** | Cue / Show Controller product | **Deferred + waived from the Definition of Done.** Cue CRUD stays an in-app tier feature (current behavior). Cue *types* still go to `shared-types`/`interface-contracts`. Revisit if demand is proven. |
| **D4** | NDI + native controllers | **Waived from the Definition of Done** (cite §10). No near-term work; revisit post-Stage 3. |
| **D7** | Line-ending hygiene PR timing | **Land the mechanical CRLF/LF hygiene PR before the frontend arbitration carves (U4).** |
| **D6** | (standing) M-C takeover-policy docs reconciliation; M-2 branch protection | Still owner decisions; they gate docs/product PRs, not the carve sequence. `interface-contracts` (U1) encodes *current* behavior (PIN + 30s) and cites the pending reconciliation. |

---

## Headline finding (verified)

The carve program has been shrinking the wrong god-file toward no destination. Since #36, every
implementation carve (#47, #49, #56, #57) targeted `companion/src/main.ts` — overwhelmingly
`apps/local-companion` app-internal server code — while `frontend/src/context/UnifiedDataContext.tsx`,
which *originates five of the ten target packages*, has had exactly one carve (#36, landed app-side, not in a
package). `packages/` holds 3 of 10 target packages (shared-types, timer-core, local-sync-arbitration) and
**zero packages have been populated by any Stage-1b carve** — all four carve modules live in
`companion/src/*-utils.ts`. The work is competent (4th Fable audit GO, byte-faithful, ratcheted) but it is
line-shaving, not convergence. Root cause: no process step required a carve to name its §3/§4 destination,
and no doc defined a measurable "done". Verified this session: `ls packages/` = 3; god-files = 7,977 +
6,706 lines; `control-audit` never appears in `frontend/src` (audit is app-internal);
`frontend/src/context/control-lock-reducers.ts` is a pure display reducer (the readiest package graduation).

---

## 1. Reconciliation Matrix — Both God-Files

Target legend: a §3 `packages/*`, a §4 `apps/*`, **app-internal** (stays in the app even at Stage 4), or
**open-decision**.

### 1a. `companion/src/main.ts` (~7,977 lines)

| Region | Target destination | Landed / right place? |
|---|---|---|
| Socket payload & event types (~247–990) | **`packages/interface-contracts`** | Not landed. Largest package-bound region (~740 lines). |
| Timer clock/elapsed resolution (~521–741) | **`packages/timer-core`** (math) + app-internal (clock-authority policy) | Canonical formula in timer-core; companion CJS mirror deletion deferred pending CJS build. |
| Control-lock/takeover/pending handlers + stores | **app-internal** (§6: lock pkg must not be a 2nd enforcement impl) | Runtime stays — correct. |
| `control-lock-utils` / `control-audit-utils` / `pending-control-timeout-utils` / `lock-handshake-utils` | Mixed — see §2 verdicts | Landed app-internal with no declared destination. |
| Pairing routes + viewer tokens | **app-internal**; pairing *shapes* → `interface-contracts` | Not carved; coupling map "core-adjacent". |
| TLS/cert/trust; loopback/CORS helpers; tray/settings; bootstrap | **app-internal** | Fine. |
| Loopback token endpoint (`/api/token`, servers) | **app-internal** lifecycle; `{token,expiresAt}` schema → `interface-contracts` | Next companion unit (U3). |
| File routes + ffprobe | **app-internal** (file-ops adapter) | Correctly deferred. |
| PowerPoint/presentation detection (~92–246, 4053–5405, ~1,450 lines) | **`packages/presentation-core`** + **`packages/ppt-bridge`** (§7) | Not landed. `ppt-probe/Program.cs` allowlisted. |
| JOIN_ROOM/heartbeat/handshake | **app-internal**; payloads → `interface-contracts` | Characterized. |
| Timer/cue CRUD + sync handlers | **app-internal** runtime; types → `interface-contracts` | Characterized (#27/#38/#40/#51/#53/#54). |
| Disk room cache | **app-internal** persistence adapter (injected fs/clock) | Sequenced after token endpoint (U7). |
| JWT/keychain/token persistence | **app-internal** | Fine. |

### 1b. `frontend/src/context/UnifiedDataContext.tsx` (~6,706 lines) — the bigger reconciliation

| Region | Target destination | Landed / right place? |
|---|---|---|
| Reconciliation/authority pure helpers (`resolveRoomSource`, `isSnapshotStale`, `buildRoomFromCompanion`, `translateCompanionStateToFirebase`, `getConfidenceWindowMs`, `shouldBootstrapCachedSubscriptions`) | **`packages/local-sync-arbitration`** | Not landed. Package holds only `arbitrate()` today — a sliver of its charter. |
| Queue/cache/tombstone persistence + merge/replay (`mergeCueQueueEvents`, `loadQueue`/`saveQueue`/`mergeQueuedEvents`/`replayRoomQueue`, tombstones) | **`packages/local-sync-arbitration`** (storage injected — no localStorage in pkg) | Not landed. |
| Join queue / reconnect reconciliation | **`packages/local-sync-arbitration`** (pure decisions; socket plumbing app-internal) | Not landed. |
| Lock display/lifecycle reducers — `control-lock-reducers.ts` (#36) + normalizers/actions | **`packages/lock-view-model`** (pure reducers/normalizers); socket-emitting actions app-internal | **#36 landed app-side** — pure, correct seam, wrong home. Readiest graduation. |
| Socket event handlers (snapshot/delta/timer/cue/liveCue/presentation/lock) | Split: payload types → `interface-contracts`; apply/merge → `local-sync-arbitration`; Firestore write-through → `cloud-adapter-firestore`; wiring app-internal | Not landed. Highest-risk region; has char baseline (#24). |
| Read-side source merge (`pickSource`, `getRoom`, `mergeProgressFromCache`) | **`local-sync-arbitration`** | Not landed. |
| `mergeCueVideos` (live-cue `videos[]` merge) | **`packages/presentation-core`** (§7 names the deferred regression) | Not landed; long-deferred debt. |
| Timer/cue actions + write paths | Math → `timer-core` (landed); Firestore writes → `cloud-adapter-firestore` (fresh adapter, NOT copied from `FirebaseDataContext`); dual-write orchestration → **open, gated by D1** | timer-core correct; adapter is Stage-2. |
| Provider/context plumbing | **app-internal** — dies with the file (per D5) | n/a |
| Viewer display derivation (mostly outside this file) | **`packages/viewer-renderer`** | Not started. |

---

## 2. Drift Verdicts

| Item | Verdict | Reasoning |
|---|---|---|
| `control-lock-utils` predicates + `normalizeRoomPin` (#47) | **ACCEPT AS INTERNAL** — do NOT graduate to `lock-view-model` | These are *server* clear/supersede/PIN decisions. §3: `lock-view-model` must not own server enforcement; §6 forbids a 2nd enforcement impl. Sharing them with clients is the dual-enforcement smell. Caveat: two predicates have zero production callers (4th-audit LOW) → wire through inline sites or delete (U8). |
| `ControllerLock` type + `buildControllerLock` (#49) | **SPLIT → re-home type to `interface-contracts`** when it lands | `ControllerLock` is the wire shape emitted to and re-parsed by the frontend — an interface contract, currently defined independently on both sides. One definition, both import. Same for `CONTROL_REQUEST_STATUS` reason vocabulary that crosses the wire. |
| `control-audit-utils` (#56) | **ACCEPT AS INTERNAL** | Server-side store + cache scheduling; never crosses the wire (verified: 0 hits in `frontend/src`). |
| `pending-control-timeout-utils` (#57) | **ACCEPT AS INTERNAL** | Server 30s enforcement mechanics; correctly injected/testable. |
| `lock-handshake-utils` | **ACCEPT AS INTERNAL** | Server disconnect/transfer authority. |
| `frontend/src/context/control-lock-reducers.ts` (#36) | **RE-HOME → `packages/lock-view-model`** | This IS the charter verbatim: pure display derivation (`resolveControllerLockState` → authoritative/displaced/requesting/read-only) + lifecycle reducers, no enforcement, no transport. Allowlisted by extraction-rules §3. Landing app-side was reasonable staging; leaving it there is drift. |

**Systemic finding:** the drift is destination-blindness as *process*, not wrong-home-per-util. Fixed by §6 guardrails.

**Finding against the target doc (flag, not a rewrite):** `rebuild-architecture.md` §3 `lock-view-model` is ambiguous between *client* display lifecycle and *server* request lifecycle. Clarify to: **client-side display/request-lifecycle derivation only**; server clear/supersede/timeout decisions are app-internal to Companion and Cloud Functions. Also fold this plan's per-stage exit criteria (§3) into the architecture doc, whose §9 stages currently have none.

---

## 3. Definition of Done — Measurable

Every item is a mechanical check (grep / dep-cruiser / ratchet / CI), not a vibe.

### Rebuild-complete (Stage 4 exit) — ALL must hold
1. **God-files deleted (per D5)** or reduced to ≤500-line pure-wiring composition shims. Check: ratchet baselines ≤ 500 (or file absent); anti-dup + timer-formula greps green.
2. **Package population:** every §3 package either exists with ≥1 exported production symbol, ≥1 test, and passes the purity check, or is explicitly waived citing a decision (waivable: `cue-controller-core` D3; `ppt-bridge`/native `viewer-renderer` per D3/D4). Check: script enumerates §3 names vs `packages/*/src/index.ts` + waiver list.
3. **Zero duplicated core formulas:** companion CJS mirror `resolveCompanionElapsedForState` deleted; companion imports `@ontime/timer-core`. Check: grep = 0 production hits; anti-dup green.
4. **Single wire-shape definitions:** each `docs/interface.md` payload/response schema has exactly one type def, in `interface-contracts`. Check: grep for the type names outside the package = 0 (shims allowlisted).
5. **Boundary matrix green transitively** (dep-cruiser, #25 method): Cloud entry points cannot reach `local-sync-arbitration`/companion modules; viewer entry points cannot reach write/lock/arbitration; `cloud-functions` cannot reach client sync packages. Planted-violation test per rule.
6. **No denylisted copies:** no `packages/` file shares ≥N consecutive lines with the historical god-files (4th-audit CR-stripped line-set method, scripted); denylist import greps green.
7. **Timer behavior frozen:** full frontend suite + companion `node --test` green; timer/drift-guard tests unchanged-or-strengthened, never deleted.
8. **Apps in final topology:** `apps/` move done as a mechanical PR only after 1–7 (Stage 4).

### Per-stage exit criteria
- **Stage 1b exit:** `interface-contracts` and `lock-view-model` exist, pure, tested; `local-sync-arbitration` owns `resolveRoomSource`, `isSnapshotStale`, queue-merge helpers; `presentation-core` exists with `mergeCueVideos` + regression test; ratchets **`UnifiedDataContext.tsx` ≤ 5,200** and **`main.ts` ≤ 6,600**; every new `companion/src` / `frontend/src/context` module carries a destination marker (G1).
- **Stage 2 exit:** `cloud-adapter-firestore` exists; zero `firebase/firestore` imports in `frontend/src` outside `lib/firebase.ts` + adapter shim; companion persistence adapter behind injected fs/clock; timer-core CJS build executed (mirror deleted); ratchets ≤ 3,500 / ≤ 3,000.
- **Stage 3 exit:** standalone viewer-web builds with dep-cruiser proof it reaches no `frontend/src/context/*`; PPT app decision executed or waived; ratchets ≤ 1,500 each.
- **Stage 4 exit:** the rebuild-complete list above (god-files deleted per D5).

---

## 4. Re-Aimed Near-Term Sequence

Pending questions resolved: **(a)** `/api/token` is **app-internal** server lifecycle; its `{token,expiresAt}`
schema is owned by `interface-contracts` — it proceeds but is not package progress. **(b)** `control-lock-utils`
does **not** graduate; the graduation candidate is `control-lock-reducers.ts` → `lock-view-model`.

| # | Unit | Target | Char-first? | Lane | Why now |
|---|---|---|---|---|---|
| U1 | Seed `packages/interface-contracts`: core Socket.IO event types + `/api/token` schema (from `main.ts:247–990` + frontend counterparts); both sides import via shims. Split into package+companion then frontend adoption if large. | `interface-contracts` | N (types; `tsc --noEmit` + existing socket tests are the net) | Baton | Highest leverage: first new package, shrinks BOTH god-files, prereq for U2/U3/U6. |
| U2 | Graduate `frontend/src/context/control-lock-reducers.ts` → `packages/lock-view-model`; move needed types to `shared-types`/`interface-contracts`; app-side re-export shim. | `lock-view-model` | Already characterized (#36) — verify | Baton | After U1. Converts the one frontend carve into a populated package. |
| U3 | `/api/token` + token-server lifecycle carve (injected servers; loopback/origin tests; exclude pairing/file/status-window unless injected). | app-internal; schema from `interface-contracts` | Y | Baton | Keeps companion momentum, honestly labeled app-internal. |
| U4 | `local-sync-arbitration` wave 1: `resolveRoomSource`, `isSnapshotStale`, `getConfidenceWindowMs`, `shouldBootstrapCachedSubscriptions`, `resolveReconciledTimerTargetId`. | `local-sync-arbitration` | Y (extend `UnifiedDataContext.test.ts`) | Baton | After the CRLF hygiene PR (D7). First real payment on the package's charter. |
| U5 | `local-sync-arbitration` wave 2: queue/tombstone merge+replay with injected storage. | `local-sync-arbitration` | Y | Baton | After U4. |
| U6 | Seed `packages/presentation-core`: `mergeCueVideos` + its deferred regression test; optionally companion pure snapshot-equality helpers. | `presentation-core` | Y (the regression IS the characterization) | Baton | After U1. Closes a ledger debt; third new package. |
| U7 | Companion disk-cache persistence adapter over a `RoomCacheStores` bag + injected fs/clock. | app-internal | Y | Baton | After U3. |
| U8 | Wire the two zero-caller predicates through inline sites, or delete + relabel as test-mirrors (4th-audit LOW). | app-internal | Existing #53/#54 cover | Fast-lane | Anytime; removes a live drift hazard. |

Sequencing rationale: U1/U2/U6 move "packages populated" 3→6 in three units; U3/U7 continue the companion
program honestly labeled; U4/U5 start the frontend god-file's real decomposition where characterization
baselines already exist. `cloud-adapter-firestore` is Stage-2 and gated by D1 (now decided) — scheduled later.

---

## 5. Anti-Drift Guardrails

- **G1 — Destination marker check (the core fix).** Every non-test module under `companion/src/` and
  `frontend/src/{context,lib,utils}/` created/renamed after a cutoff commit must carry a header line:
  `// rebuild-target: packages/<§3-name>` or `// rebuild-target: app-internal (<§4-app>)`.
  `check-rebuild-guardrails.mjs` fails on new modules without it. Backfill the five existing carve modules per §2.
- **G2 — Package-population ratchet.** The guardrail script counts §3 packages with ≥1 exported production
  symbol + ≥1 test against a committed rising-only baseline (currently 3; U1/U2/U6 → 6). Makes convergence a
  printed CI number.
- **G3 — Ledger discipline:** every carve PR's ledger entry names its §3/§4 destination + ratchet/population
  deltas. Add to `rebuild-extraction-rules.md`: "State the target destination in the PR; a carve with no
  destination is not a valid unit."
- **G4 — Stage-exit checklist in the ledger:** paste §3 per-stage criteria as literal checkboxes; milestone
  audits verify claims against CI, not narrative.
- **G5 — One-definition wire-shape tripwire (after U1):** grep-fail on core payload type names defined outside
  `interface-contracts` (shim re-exports allowlisted).

_Not recommended: PR templates, new bots, per-PR architecture sign-off — the baton + milestone-audit cadence
already carries review weight; G1/G2 add the two missing measurements at near-zero ceremony._
