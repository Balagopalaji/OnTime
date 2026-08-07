---
Type: Plan
Status: current
Owner: KDB
Last updated: 2026-08-07
Scope: Productize the extracted timer and PowerPoint capabilities into reusable local, LAN, cloud, controller, clean-output, and future NDI surfaces.
---

# PowerPoint Capability and Timer Display Roadmap

## Purpose and relationship to current plans

This is the productization continuation of the rebuild, not a replacement for it.

- `docs/rebuild-plan.md` remains authoritative for god-file decomposition, package homes, boundaries, and extraction mechanics.
- `docs/rebuild-extraction-rules.md` remains authoritative for characterization-first moves and PR scope.
- `docs/spec/standalone-powerpoint-video-timer.spec.md` remains the release contract for the local standalone PowerPoint timer.
- `docs/local-offline-lan-plan.md` and `docs/interface.md` remain authoritative for LAN security, pairing, roles, and wire contracts.
- This roadmap owns the product sequence that reuses the extracted capabilities across the standalone app, a lightweight remote surface, the full OnTime controller, general timer viewers, clean outputs, and future NDI.

The standalone PowerPoint timer is the first usable product created directly from the extraction work. A new app or view is a composition of shared capabilities, not a new implementation of timer or PowerPoint logic.

## Locked product decisions

1. **One PowerPoint capability, multiple shells.** `ppt-bridge` owns the local PowerPoint adapter; `presentation-core` owns normalized presentation state and projection. Neither the lightweight app nor the full controller may reimplement those rules.
2. **The same PowerPoint panel is embedded.** A reusable PowerPoint countdown/control component is used by both the lightweight PowerPoint app and the full OnTime controller.
3. **The show laptop is authoritative.** Only the computer running PowerPoint runs the COM probe. Remote computers consume authenticated state and optionally send authorized commands.
4. **Read and control are separate permissions.** Read-only viewers cannot acquire slide or media control. Commands require an operator/controller role and explicit acknowledgement.
5. **Distribute state, not pixels.** Local Electron, browser, full-controller, key/fill, and future NDI outputs render the same state/view model locally.
6. **Share display primitives without erasing domains.** A generic `TimerDisplay` presents time/status/labels. A PowerPoint-specific panel adds slide, media, multi-video, and transport semantics.
7. **One lightweight codebase, selectable role.** The lightweight desktop product should support a local "PowerPoint runs here" mode and a remote "connect to a show computer" mode unless packaging evidence later justifies separate installers.
8. **Controls are staged.** Read-only remote monitoring precedes slide navigation; slide navigation precedes explicit media play/pause/stop. Seek remains deferred until PowerPoint behavior is independently characterized.
9. **NDI is an output adapter and remains deferred.** Planning for deterministic fixed-resolution rendering is in scope; implementing the NDI SDK is not part of standalone or rebuild completion.
10. **The full Show Controller remains a north star, not a dependency.** Rundowns, cues, and show-caller workflows can later compose the same PowerPoint panel, but they do not block the focused timer products.

## Product composition

### PowerPoint capability

- Local native PowerPoint observation and future command adapter: `packages/ppt-bridge`.
- Normalization, focus/identity policy, and presentation view projection: `packages/presentation-core`.
- Versioned LAN/cloud observation and command envelopes: `packages/interface-contracts`.
- Shared PowerPoint countdown/control UI: future reusable viewer/panel module; it must not import Electron, COM, Firebase, or Companion server internals.

### Generic timer display

A future shared display module accepts a small view model: primary time, mode, status, label, secondary text, urgency, connection state, and optional message. It is used by:

- the PowerPoint panel;
- a compact LAN/cloud OnTime timer viewer;
- fullscreen browser and Electron viewers;
- clean HDMI/keying output;
- a future offscreen NDI renderer.

PowerPoint-specific slide/video details remain in the PowerPoint panel rather than bloating the generic timer display.

### Shells and outputs

- **Standalone local PowerPoint timer:** probe plus frameless always-on-top local display.
- **Lightweight remote PowerPoint monitor/controller:** paired LAN client using the same PowerPoint panel.
- **Full OnTime controller:** embeds the same panel beside timers, rundowns, messages, and later cues/show-caller functions.
- **Compact regular timer viewer:** LAN or cloud source; frameless always-on-top desktop mode plus fullscreen clean output.
- **Browser viewers:** LAN/cloud read-only views through existing viewer delivery.
- **Clean/key output:** fixed background or supported transparency for capture through HDMI/switchers.
- **Future NDI output:** consumes the shared display projection; it owns frame transport, not timer math.

## Immediate stabilization gate: 2026-08-07 stress findings

Do not begin the frameless implementation until these findings are characterized and resolved or explicitly accepted:

1. **Slow launch and duplicate instances.** The installed app took long enough to appear that repeated clicks opened multiple app instances. Multiple instances also multiply native probes and likely contributed to CPU/fan load. Add a process-level single-instance lock, focus/show the existing window on a second launch, and measure cold/warm launch-to-visible time.
2. **High startup CPU.** Measure process count, helper count, CPU, and memory for one launch and repeated launch attempts. Prove that only one app and one owned helper remain.
3. **Single-video wrong initial anchor/correction.** A 33-second video repeatedly displayed about 24 seconds, counted, then jumped back to about 30 seconds. This is a release-blocking correctness defect. Capture raw per-video samples and renderer anchor/correction decisions for the affected slide; add a deterministic regression sequence before changing the algorithm.
4. **Playback-start delay.** Record perceived start-to-visible timing separately from `poll_slow`, which measures helper poll duration only.

Positive evidence from the same run:

- Five-video playback appeared smooth.
- Leaving and returning to media slides recovered from `--:--` to durations.
- Closing PowerPoint produced "PowerPoint is not running".
- PowerPoint open without a slideshow produced "No slideshow running".
- Starting the existing controller alongside the timer appeared fine, but sustained coexistence remains to be tested.

## Milestones and gates

### M0 — Preserve and characterize the current standalone

- Review the dirty working tree and separate intended standalone changes from unrelated work.
- Commit a recoverable checkpoint before new behavior or visual work.
- Add single-instance behavior and launch diagnostics.
- Reproduce and fix the 33-second video anchor/correction defect using captured raw sequences and tests.
- Run the agreed one/two/five-video, state-transition, recovery, display/DPI, coexistence, and soak matrix.

**Exit:** no duplicate instances/helpers; launch timing is measured; no unexplained countdown rewind; automated gates pass; installed build is retested.

### M1 — Frameless charcoal standalone design

- Design compact single-video, multi-video, ready/paused/ended, unavailable/reconnecting, and settings states.
- The collapsed surface is an exact minimalist contract: one status label, one
  focused countdown, and a bottom-right disclosure caret. Video/deck/slide
  identity, warnings, secondary videos, window controls, display settings, and
  diagnostics do not appear until expanded.
- Use a `190 × 80` frameless compact window and a two-stage, content-sized
  `260`-pixel-wide tray. The first stage contains only secondary video rows and
  shows at most three before scrolling. The second adds one compact action
  strip for timing mode, always-on-top, diagnostics copy, minimize, and close.
  A single-video slide skips the empty video stage. Expansion grows down when
  space permits, otherwise grows up while retaining the compact bottom edge;
  collapse restores the captured compact position. Tray geometry is never
  persisted as compact geometry.
- Do not show a nonfunctional remote toggle. Remote state/control appears only
  after M3 supplies an actionable authenticated transport.
- Use an explicit drag region, retained resize affordance, accessible in-app
  minimize/close controls, keyboard-accessible expansion/collapse, and a subtle
  dark edge. Pre-M1 beta geometry receives one schema migration to the compact
  surface; subsequent custom sizing is respected.
- Do not mix renderer-clock changes into the visual implementation.

**Exit:** visual review at compact/large/custom sizes, 100/125/150% scaling, light/dark slide backgrounds, and Presenter View; no regression to always-on-top or focus behavior.

### M2 — Shared display and PowerPoint panel boundaries

- Extract or build a framework-neutral timer display/view-model boundary.
- Extract the accepted frameless compact shell as a reusable content-slot frame
  so the regular always-on-top timer viewer can host the generic stage timer in
  the same window behavior without importing PowerPoint semantics.
- Build the reusable PowerPoint countdown panel on top of it.
- Keep source adapters and commands outside the components.
- Prove the standalone consumes the shared panel without changing established timing behavior.

**Exit:** one PowerPoint component and one generic timer-display implementation, each independently tested and boundary-checked.

### M3 — Versioned remote PowerPoint observation

- Define complete, idempotent PowerPoint snapshots with protocol version, source/session identity, monotonic sequence, observation time, slide fields, videos, focus, availability, and timing anchors.
- Reuse existing HTTPS/WSS, private-subnet, pairing, token, and revocation policy.
- On reconnect, send a fresh full snapshot before deltas/events.
- Keep the local show agent authoritative; remote deterministic display must tolerate network jitter without inventing PowerPoint state.

**Exit:** a paired read-only remote client survives disconnect, duplicate/out-of-order messages, show-app restart, and laptop sleep/resume.

### M4 — Lightweight and full-controller composition

- Add remote mode to the lightweight PowerPoint app.
- Embed the exact same PowerPoint panel/client in the full OnTime controller.
- Keep the full controller's rundown/timer/cue responsibilities outside the PowerPoint module.

**Exit:** light and full surfaces render identical PowerPoint state from the same session without duplicated domain logic.

### M5 — Compact regular OnTime timer viewer

- Reuse the generic timer display with LAN and cloud room-source adapters.
- Provide frameless always-on-top, fullscreen, and clean-output desktop modes.
- Keep existing full-screen browser viewers; do not require Electron where always-on-top is unnecessary.
- Add configurable solid backgrounds suitable for switcher keying before relying on desktop alpha capture.

**Exit:** the same active OnTime timer can be shown in the full browser viewer and the compact desktop viewer over LAN or cloud with deterministic timer agreement.

### M6 — Remote controls

- Add explicit `slide.previous`, `slide.next`, and `slide.goto(number)` commands first.
- Add explicit `media.play(videoId)`, `media.pause(videoId)`, and `media.stop(videoId)` second.
- Use command IDs, source/session preconditions, explicit video identity, authorized roles, acknowledgement, and subsequent observed-state confirmation.
- Do not implement a network `toggle` as the canonical command; it is race-prone.
- Characterize seek against real PowerPoint before deciding whether to offer relative skip, absolute seek, rehearsal-only seek, or no seek.

**Exit:** commands are idempotent where possible, never target an ambiguous video, and do not report success solely because a COM call returned.

### M7 — Clean output and future NDI

- Stabilize explicit-resolution clean/key layouts and configurable frame rate.
- Keep render cadence separate from source observation cadence.
- Validate HDMI/switcher keying workflows first.
- Later, add NDI as an offscreen output adapter consuming the same view projection.

**Exit for current roadmap:** clean/key output is stable. NDI remains a separately approved implementation phase with SDK/licensing/performance work.

## Delivery discipline

- Do not mix clock/probe fixes, visual redesign, extraction, networking, and controls in one change.
- Characterize behavior before moving or rewriting it.
- Every new package/module names its final destination and obeys `docs/rebuild-extraction-rules.md`.
- Update the standalone spec only for standalone release behavior; update `docs/interface.md` for wire contracts; update this roadmap for product sequencing.
- Record live Windows evidence in the Stage 7 handoff, not only in chat.

## Git, commit, and cross-machine continuity

The Windows standalone branch is the implementation branch for ISSUE-001. Git,
not chat history, is the baton between the Windows and macOS workstations.

### Immediate documentation checkpoint

- Commit this roadmap, its planning links, current standalone spec/conformance,
  and the Stage 7 evidence as a documentation-only commit.
- Push the feature branch after that commit so a macOS agent can fetch and read
  the plans without receiving any uncommitted Windows working-tree state.
- Do not claim that uncommitted source is available on the Mac merely because
  its behavior is described in a pushed document.

### Source commit sequence

Before staging, audit the dirty tree and map every file to one behavior slice.
Prefer the following commits only where each intermediate commit builds and its
targeted tests pass:

1. Native warm-cache observation and its bridge/native tests.
2. Standalone adaptive polling plus per-video status stabilization and tests.
3. Deterministic renderer playback clocks and tests.
4. Process-client diagnostics extraction and tests.
5. Single-instance launch behavior and launch diagnostics.
6. The characterized 33-second initial-anchor/correction fix and regression.
7. Frameless charcoal visual redesign after M0 acceptance.

If files are genuinely cross-coupled and an intermediate split would not build,
combine the coupled behavior into one honest tested commit rather than creating
artificial or failing history. Never sweep unrelated dirty files into a commit.

### Push and ownership policy

- Push after each accepted, buildable slice. The remote feature branch is the
  recoverable checkpoint and the source a Mac agent may inspect.
- During ISSUE-001, Windows owns `apps/ppt-timer`, the Windows native probe, and
  the standalone Stage 7 handoff. A Mac-side rebuild task must not edit those
  paths concurrently without an explicit baton handoff.
- macOS rebuild work may continue on its own branch/worktree. It can inspect the
  Windows branch with `git fetch`/`git show` or a read-only checkout; do not merge
  unfinished standalone source into the rebuild branch merely to read plans.
- Planning changes that must become globally authoritative before ISSUE-001 is
  complete may later be split into a docs-only PR, but only with an explicit
  decision to avoid conflicting edits on both machines.

### Pull-request boundaries

- ISSUE-001 ends in one standalone PowerPoint timer PR after M0 stability, M1
  visual acceptance, packaging, and the agreed Windows acceptance evidence.
- Remote observation/API, lightweight remote mode, full-controller embedding,
  generic timer viewer, media controls, and NDI each start from the merged base
  in later bounded branches/PRs. They do not accumulate on the standalone branch.
- A draft PR is optional after M0 if cross-machine review is useful; it must not
  be presented as release-ready before M1 and packaging acceptance.
