---
Type: Plan Critique
Status: draft
Owner: KDB
Last updated: 2026-08-26
Scope: Critique of docs/plans/downstage-remote-powerpoint-viewer-deep-plan-2026-08-26.md against the
  context_builder "## Generated Plan" baseline in
  prompt-exports/oracle-plan-2026-08-26-124151-issue-002-remote-vie-3022.md.
---

# Downstage Remote PowerPoint Viewer — Deep Plan Critique

## Context and scope

This critique compares the current Deep Plan against the generated-plan baseline (export sections 1–15
plus the two companion artifacts) and against the code the plan cites. It covers only the five requested
lenses: baseline content lost/weakened, under-specified/contradictory seams, details code or a simpler
design disproves, requirements absent from both, and questions that would change design or ordering. It
does not restate the plan, expand scope, or edit implementation source.

**Baseline = export text after `## Generated Plan` only.** The composed prompt, the "must be added"
kickoff notes, and the selected-file dump above that heading were treated as context, not baseline.

**Spot-checks performed (all confirmed).** `frontend/src/lib/firebase.ts:52,60` hardcodes emulator
`8080`/`5001`; `firebase.json:26,32` uses `8081`/`5002` — the S0 divergence is real. `apps/ppt-timer/src/renderer/view.ts:72`
defines `SMOOTHING_STALE_MS = 2_000` and `:108-114` the bounded `localAdvanceMs`. `apps/ppt-timer/src/main/session-host.ts:49,294`
are the `SessionHostOptions.onView` / `onView?.(currentView)` seam. `apps/ppt-timer/src/main/ipc.ts:15,21-23`
confirm the `isAllowedSender(sender === expected)` webContents lock labelled S-033.

Findings carry stable IDs (C-NNN). Severity: **P1** = blocks or corrupts a slice if unaddressed;
**P2** = material gap/ambiguity; **P3** = precision/traceability.

---

## 1. Baseline content missing, weakened, or generalized

### C-001 (P1) — `runningAnchor` interpolation contract dropped; remote path left with no interpolation mechanism
The export (§1.3) put `runningAnchor?: { serverMs: number; anchorEpochMs: number }` on every video row
*specifically to replace raw local extrapolation* — "The viewer interpolates only within the freshness
window and only for `status: 'playing'`" — and §5 stated "the shell uses `runningAnchor`+`localAdvanceMs`
only." The plan's `RemoteVideoRowV1` has **no** anchor field and replaces the mechanism with one vague
sentence: "The viewer records local receipt time and interpolates a playing row from its received values."
This removal is **not** listed under "Corrections applied to the planning baseline," so a load-bearing
payload element and its server-time anchoring were dropped silently.

Compounding it, the plan *also* removes `localAdvanceMs` from the remote path (moved to "local PowerPoint
adapter") **and** bans `PlaybackClock`/`VideoClock` from remote use. The result: the remote path now has
**zero** specified forward-interpolation algorithm — no formula for how `elapsedMs`/`remainingMs` advance
between the 10s snapshots, and no clamp. "A separate 25-second freshness-aware reducer" governs *when to
stop* (§Pure reducer contract: "stops interpolation … at stale"), not *how to advance while live*.
**Correction:** either restore an explicit server-anchored interpolation contract (the export's
`runningAnchor` or an equivalent `{ elapsedMs measured at publishedAtMs, advance by local monotonic delta,
clamp at remainingMs }`) and specify it in S1, or state that remote video time is step-only (no
interpolation) and accept 10s granularity. This must be pinned before S1/S4 tests are written.

### C-002 (P2) — Per-owner active-session cap generalized into a creation rate limit
Export `createPresentationSession` errors were `UNAUTHENTICATED, SESSION_LIMIT` — a cap on *concurrent
sessions per publisher*. The plan replaces this with "5/min/uid" + `resource-exhausted`, which bounds
creation *velocity*, not the number of live 24-hour sessions an owner accumulates. A max-active-sessions
-per-owner bound is now absent. Without it, one owner can hold unbounded live sessions (each carrying a
24h window, a snapshot doc, and viewer leases) — a cost/abuse surface the export had named.
**Correction:** restore an explicit concurrent-active-session cap per owner (enforced in the create
transaction), distinct from the per-minute rate limit.

### C-003 (P3) — S-033 security-baseline identifier dropped from the Option-2 warning
Export §4.1 tied "extend `apps/ppt-timer`" to weakening the **S-033** posture (the `window-all-closed`
hardwire and the webContents-locked IPC). The plan keeps both behavioral points but drops the S-033 label.
`ipc.ts:1-6,21` show S-033 is the real, cited baseline ID. Re-attach the identifier so the security
review scope stays traceable.

---

## 2. Under-specified seams, contradictions, incorrect references, missing dependencies

### C-004 (P1) — Contradiction: PowerPoint-specific `availability` values sit in the "source-neutral" envelope
Plan §Envelope types `availability: 'connecting' | 'presentation' | 'powerpoint-not-running' |
'no-slideshow' | 'helper-unavailable'` as a **Layer A envelope** field. Three of those values
(`powerpoint-not-running`, `no-slideshow`, `helper-unavailable`) are PowerPoint concepts. This directly
contradicts:
- the Settled constraint that a later stage-timer source "reuses the envelope,"
- the Architecture note calling Layer A the "Transport-neutral envelope," and
- the plan's own §1-style three-contract split.

A stage-timer source has no slideshow and no helper, so it cannot reuse this envelope unchanged. The
export had this right: `availabilityKind` lived in the **payload** (Layer B). **Correction:** envelope
carries a generic availability (`connecting | active | source-unavailable`); the PowerPoint reason code
lives in `PowerPointPayloadV1`. Otherwise the "reuse the envelope for stage-timer" claim (and S10) is false.

### C-005 (P1) — Contradiction: does a transport reconnect bump epoch?
§Publisher "Option 1 implementation shape" says: "On reconnect the publisher resumes/replaces the lease,
receives a new epoch, resets sequence to one, and publishes full state." But the Failure table
"Network loss" row says: keep only the latest full local state and the viewer stays "Live until 25s,
stale until 60s" — i.e. the same stream resumes with no epoch change. These disagree. Because the reducer
"accepts a higher epoch and clears all prior source/display state," bumping epoch on every socket blip
forces **every viewer to fully reset** (flicker/blank) even though the presentation was continuous and the
publisher lease was still valid. **Correction:** epoch increments only on publisher *process* restart or a
lost/taken lease; a transient reconnect with a still-valid lease republishes the current snapshot under the
existing epoch with the next sequence. Pin which of the two rules is authoritative — it changes reducer
behavior, viewer UX, and the S6 reconnect test.

### C-006 (P2) — `clientRequestId` idempotency has no specified store
Every callable is "Idempotent by `(uid, clientRequestId)`" with "retry only with same request ID," but
neither doc says where processed request IDs and their prior results are persisted, or how they expire.
Without a durable idempotency record, a retried `createPresentationSession` (e.g. after a lost response)
creates a **second** session. Specify the idempotency store (doc/subcollection keyed by `(uid,
clientRequestId)`, its returned-result caching, and its TTL) as part of S3.

### C-007 (P2) — One revocation counter, three names
The session doc field is `viewerGeneration`; the link/lease docs and callable responses use `generation`;
the viewer claim uses `viewerGeneration`. This is the exact field the entire revocation model turns on
(rules compare claim `viewerGeneration` to live session generation). Three names for one counter invites a
mismatch that would silently break revocation. Unify to one name across session doc, link doc, lease doc,
claim, and response.

### C-008 (P3) — Freshness thresholds frozen as wire literal types
The envelope types `heartbeatIntervalMs: 10_000`, `staleAfterMs: 25_000`, `disconnectAfterMs: 60_000` as
TypeScript **literal** types. If these are fixed policy, (a) carrying them in every snapshot is redundant
bytes, and (b) freezing them as literals makes any future retune a breaking `schemaMajor` bump. The export
kept `freshnessDeadlineMs: number` (tunable). **Correction:** make stale/disconnect viewer-side constants,
or type them `number` in the wire so tuning is not a schema break.

---

## 3. Details code disproves, the task doesn't require, or a simpler design replaces

The plan's "Corrections applied" section is mostly sound; four of its corrections are genuine improvements
over the export and should be **kept** (recorded here so they are not reverted by a later reader who trusts
the export):

### C-009 (KEEP, note the cost) — Callable `publishPresentationSnapshot` correctly replaces the export's "direct client write"
Export §3.3 *preferred* a direct client Firestore write with rules enforcing `sequence` (flagged as its own
Unknown #3). The plan is right to reject it: Firestore rules cannot robustly reject *unknown/forbidden
keys*, so a client-built payload cannot be trusted to exclude paths, COM identity, and diagnostics — the
core privacy requirement (RPV allowlist). Server-side allowlist reconstruction is the correct call.
**But** the plan does not acknowledge the trade it makes: routing *every* publish **and** every 10s
heartbeat through a Cloud Function adds invocation/cold-start latency that bears directly on the plan's own
S2 "p95 transition-to-render latency target." State that cost and the mitigation (min-instances / warm
function) so the S2 load test target is realistic.

### C-010 (KEEP) — Vite-env emulator config correctly replaces export's browser Hub discovery
Verified `firebase.ts:52,60` vs `firebase.json:26,32`. Export §3.4 told the **browser** file to adopt
Emulator Hub discovery (`joinAsOperator.emu.js:25-49`) — a Node-only pattern that fetches the hub over
HTTP and has no place in browser runtime code. The plan correctly rejects it for the browser and uses Vite
env defaults matching `firebase.json`. Keep.

### C-011 (KEEP) — Integer-ms wire time replaces the export's self-contradictory `FirestoreTimestamp`
The export's §1.5 banned Firebase types in the pure package, yet its own envelope typed
`publishedAt: FirestoreTimestamp`. The plan's `publishedAtMs: number` (with Firebase conversion pushed to
transport adapters) resolves that contradiction. Keep.

### C-012 (KEEP) — Top-level snapshot doc replaces the subcollection
`/presentationSessionSnapshots/{sessionId}` avoids the TTL-does-not-cascade problem the export itself
flagged for `.../snapshots/current`. Keep, together with the scheduled reconciler.

---

## 4. Requirements, edge cases, dependencies, and architecture absent from BOTH

### C-013 (P1) — Single-helper coexistence on the show machine is unaddressed (publisher ownership)
Both docs assume the publisher "starts the shared PowerPoint host" — i.e. spawns its **own** `ppt-probe`
helper and COM client. Neither says whether `apps/ppt-timer` (the local countdown the operator may already
be running) and `apps/downstage-publisher` can run **simultaneously** on one show PC. If they can, two
independent COM automation clients poll the same `PowerPoint.Application` — exactly the multi-instance
hazard the existing `processCount` / `selectedPid` / `comPid` / `affinityMismatch` diagnostics exist to
detect (allowlist audit rows). B1 as written only chooses the *code* boundary; it does **not** resolve the
*runtime* helper-sharing model. The plan must state whether the publisher replaces the local app, shares a
single helper, or is validated to coexist. This can invalidate the "Option 1 keeps `apps/ppt-timer`
untouched" premise.

### C-014 (P1) — Publisher owner authentication and its credential lifecycle are unspecified (secret lifecycle)
The publisher must authenticate as the Firebase "owner" to call `createPresentationSession` /
`resumeOrReplacePresentationPublisher` / link callables. Neither doc says **how** an Electron desktop app
performs interactive owner sign-in (Google OAuth in Electron needs external-browser + deep-link; embedded
webviews are blocked by Google), nor how the owner refresh token is stored, refreshed, or revoked.
`safeStorage` is specified only for the *session lease/epoch metadata* — the upstream owner credential is
missing. This is a hard S6 blocker and is distinct from B1/B2.

### C-015 (P2) — Hard-cap viewer count over-counts humans; "deterministic denial of viewer 51" is optimistic (lease rule behavior)
Viewers are anonymous (opaque link), so there is no stable identity across reloads. `activeViewerCount` is
derived from 90s leases reconciled lazily. Therefore: a viewer who reloads or briefly drops holds **two**
leases until the old expires; a closed tab keeps counting for up to 90s + reconciler lag. The S2 acceptance
"deterministic denial for viewer 51" is deterministic only w.r.t. *active leases*, which are an
over-estimate of real viewers — so a legitimate 51st viewer can be falsely denied, and the cap is not a
hard cap on people. Either accept these semantics explicitly (document the transient over-count and the
lease-expiry lag) or add per-viewer lease reuse (hard without an identity primitive). This changes the S3
lease/count design and the S2 load-test pass criteria.

### C-016 (P2) — Viewer subscription teardown / cancellation is unspecified (cancellation, testability)
The pure reducer is well-isolated and testable, but the **subscription layer** is not specified for
teardown: (a) detaching the viewer-state then snapshot listeners, (b) cancelling the clock-tick source that
drives stale/disconnected transitions, and (c) stopping the "renew every 30s" lease timer — all on unmount,
route change, or tab hide. Leaked listeners/intervals and continued lease renewal after the user leaves
inflate `activeViewerCount` (feeds C-015) and are a real testability gap. Specify listener detach,
interpolation-tick cancellation, and lease release/stop-renew on unmount; add a teardown test to S5.

### C-017 (P2) — LAN ingestion path (publisher → Companion) is never drawn
The viewer side shows "Firestore listener OR LAN `REMOTE_SNAPSHOT`," and S9 says "Companion emits validated
snapshots," but neither doc says how a snapshot **reaches** Companion in LAN mode: does the Windows
publisher dual-publish to Companion over WSS, or does Companion subscribe to cloud and mirror? This
ingestion source is a hard dependency for S9 and is absent from both. Resolve before S9 (it also affects
whether the publisher needs a Companion transport at all).

### C-018 (P3) — Rules cross-document `get()` cost of the generation model is unstated
The snapshot-read rule must `get()` the session doc (generation/status/window) and, in hard-cap mode, also
the lease doc — up to two `get()`s per snapshot-read evaluation, each billed as a read and counted against
the rules `get()` limit. Fine at 0.1 writes/s, but should be stated as the read-amplification cost of the
`viewerGeneration` design, especially at the 50-viewer target.

---

## 5. Questions whose answers would materially change design or implementation order

1. **Q1 (C-013):** Can `apps/ppt-timer` and the publisher run on the same show machine at once — one helper
   or two? This determines S6 architecture and whether B1 Option 1 is even sufficient. **Highest-leverage
   open question; larger than either B1 or B2 as currently framed.**
2. **Q2 (C-014):** How does the publisher desktop app authenticate the owner and persist/refresh that
   credential? Blocks S6; independent of B1/B2.
3. **Q3 (C-005):** Does a transient transport reconnect bump epoch, or only a process restart / lost lease?
   Changes the reducer reset behavior, viewer UX, and the S6 reconnect test.
4. **Q4 (C-001):** What exactly is the remote interpolation algorithm and clamp, now that `runningAnchor`
   and `localAdvanceMs` are both removed from the remote path? Changes the S1 payload contract and S4/S5
   tests; must be answered before S1.
5. **Q5 (C-015):** Is the 50 cap on humans or on leases, and is transient over-count acceptable? Changes S3
   lease/count design and S2 load-test pass criteria (part of B2 but not currently framed this way).
6. **Q6 (C-002):** Is there a maximum number of concurrent active sessions per owner, and where is it
   enforced?

## Summary

The plan is stronger than its baseline on the cloud-security spine — the callable-with-server-side-allowlist
(C-009), integer-ms wire time (C-011), top-level snapshot docs (C-012), the strict `sequence == last + 1`
transaction, and the `viewerGeneration` revocation model are real improvements and should be kept. The most
consequential problems are not in what the plan corrected but in three unresolved seams that sit *outside*
the two ratification gates it names: the single-vs-dual helper runtime model (C-013), publisher owner
authentication (C-014), and the now-unspecified remote interpolation contract left behind when
`runningAnchor` was silently dropped (C-001). The one internal contradiction that undermines the plan's own
stated architecture is the PowerPoint-specific `availability` enum living in the "source-neutral" envelope
(C-004), with the reconnect/epoch contradiction (C-005) close behind. Resolving C-001, C-004, C-005,
C-013, and C-014 before rerunning `spec-plan-readiness` would prevent the largest downstream rework.
