import type { AppView } from '../shared/ipc-contract.js'
import {
  agreeingNonPlayingCorrection,
  asPresentation,
  clockFromFrozen,
  clockFromTile,
  clockValue,
  consistentCorrection,
  correctionEvidence,
  driftMs,
  endedClock,
  finite,
  hasComparableTiming,
  isImplausiblyAheadOfReady,
  isPresentation,
  PLAYBACK_DRIFT_THRESHOLD_MS,
  READY_START_GUARD_CONFIRM_MS,
  READY_START_GUARD_MAX_MS,
  READY_START_GUARD_SAMPLES,
  READY_START_STALE_THRESHOLD_MS,
  scalarDrift,
  scalarValue,
  scopeKey,
  tileKey,
  type ScalarClock,
  type VideoClock,
} from './playback-clock-model.js'

export { PLAYBACK_DRIFT_THRESHOLD_MS } from './playback-clock-model.js'

export type PlaybackClock = {
  accept(view: AppView, now: number): AppView
  current(now: number): AppView | null
}

class PlaybackClockImpl implements PlaybackClock {
  private latest: AppView | null = null
  private lastRevision = -1
  private scope: string | null = null
  private readonly videos = new Map<string, VideoClock>()
  private scalar: ScalarClock | null = null

  accept(view: AppView, now: number): AppView {
    if (view.revision < this.lastRevision) return this.current(now) ?? view

    const previous = this.latest
    const newRevision = view.revision > this.lastRevision
    const timingModeChanged = previous !== null && previous.timingMode !== view.timingMode
    const acceptsCorrectionEvidence = newRevision && !timingModeChanged
    this.lastRevision = Math.max(this.lastRevision, view.revision)
    this.latest = view

    if (!isPresentation(view.state) || view.state.kind === 'timing_unavailable') {
      this.resetAnchors()
      return this.current(now) ?? view
    }
    if (timingModeChanged) this.scalar = null

    const state = asPresentation(view.state)
    const nextScope = scopeKey(state)
    if (this.scope !== nextScope) {
      this.resetAnchors()
      this.scope = nextScope
    }

    const presentKeys = new Set<string>()
    for (const tile of state.videos) {
      const key = tileKey(nextScope, tile)
      presentKeys.add(key)
      const prior = this.videos.get(key)
      const observedDuration = finite(tile.durationMs)
      const durationChanged = prior !== undefined && observedDuration !== null && observedDuration !== prior.durationMs
      const nameChanged =
        prior?.lastKnownName !== null &&
        prior?.lastKnownName !== undefined &&
        tile.name !== undefined &&
        tile.name !== prior.lastKnownName
      const frozen = prior ? clockValue(prior, now) : null

      if (tile.status === 'ended') {
        this.videos.set(key, endedClock(tile, prior, frozen, now))
        continue
      }

      if (tile.status === 'playing') {
        if (!prior || durationChanged || nameChanged) {
          this.videos.set(key, clockFromTile(tile, now, nameChanged ? null : frozen, prior?.lastKnownName ?? null))
          continue
        }

        if (prior.status !== 'playing') {
          const transitionDrift = frozen ? driftMs(tile, frozen) : null
          const transitionIsStaleReadyPosition =
            prior.status === 'ready' &&
            transitionDrift !== null &&
            transitionDrift > READY_START_STALE_THRESHOLD_MS &&
            frozen !== null &&
            isImplausiblyAheadOfReady(tile, frozen, prior.lastObservedAt, now)
          if (transitionIsStaleReadyPosition && frozen) {
            // Player.State is useful immediately, but PowerPoint can pair its
            // first `playing` state with CurrentPosition left over from the
            // previous run. Start the deterministic clock from the trusted
            // stopped position and wait for COM timing to converge with the
            // new run instead of visibly jumping back.
            this.videos.set(
              key,
              clockFromFrozen(
                tile,
                prior,
                frozen,
                now,
                null,
                {
                  startedAt: now,
                  lastEvidence: correctionEvidence(tile, now),
                  consistentSamples: 1,
                },
              ),
            )
          } else {
            this.videos.set(key, clockFromTile(tile, now, frozen, prior.lastKnownName))
          }
          continue
        }

        const predicted = clockValue(prior, now)
        const drift = driftMs(tile, predicted)
        const corrected = drift !== null && drift > PLAYBACK_DRIFT_THRESHOLD_MS
        const evidence = corrected ? correctionEvidence(tile, now) : null
        if (prior.readyStartGuard) {
          const guardAge = now > prior.readyStartGuard.startedAt
            ? now - prior.readyStartGuard.startedAt
            : 0
          if (!corrected) {
            // Fresh timing has caught the deterministic start. Keep the
            // continuous local value and release the quarantine without a
            // visible correction.
            this.videos.set(key, {
              ...prior,
              lastKnownName: tile.name ?? prior.lastKnownName,
              durationMs: observedDuration ?? prior.durationMs,
              lastObservedAt: now,
              pendingCorrection: null,
              readyStartGuard: null,
            })
            continue
          }

          if (evidence !== null && acceptsCorrectionEvidence) {
            const agrees = consistentCorrection(prior.readyStartGuard.lastEvidence, evidence)
            const consistentSamples = agrees ? prior.readyStartGuard.consistentSamples + 1 : 1
            const confirmed =
              agrees &&
              consistentSamples >= READY_START_GUARD_SAMPLES &&
              guardAge >= READY_START_GUARD_CONFIRM_MS
            const expired = guardAge >= READY_START_GUARD_MAX_MS
            if (confirmed || expired) {
              // A genuinely late start or explicit reposition must not remain
              // pinned to the earlier ready value forever. A coherent stream
              // wins after a short quarantine; the hard deadline is the final
              // escape hatch for sparse or irregular COM samples.
              this.videos.set(key, clockFromTile(tile, now, null, prior.lastKnownName))
              continue
            }
            this.videos.set(key, {
              ...prior,
              lastKnownName: tile.name ?? prior.lastKnownName,
              durationMs: observedDuration ?? prior.durationMs,
              lastObservedAt: now,
              pendingCorrection: null,
              readyStartGuard: {
                ...prior.readyStartGuard,
                lastEvidence: evidence,
                consistentSamples,
              },
            })
            continue
          }

          this.videos.set(key, {
            ...prior,
            lastKnownName: tile.name ?? prior.lastKnownName,
            durationMs: observedDuration ?? prior.durationMs,
            lastObservedAt: now,
            pendingCorrection: null,
            readyStartGuard: guardAge >= READY_START_GUARD_MAX_MS ? null : prior.readyStartGuard,
          })
          continue
        }
        if (
          corrected &&
          acceptsCorrectionEvidence &&
          prior.pendingCorrection !== null &&
          evidence !== null &&
          consistentCorrection(prior.pendingCorrection, evidence)
        ) {
          this.videos.set(key, clockFromTile(tile, now, null, prior.lastKnownName))
        } else {
          this.videos.set(key, {
            ...prior,
            lastKnownName: tile.name ?? prior.lastKnownName,
            durationMs: observedDuration ?? prior.durationMs,
            lastObservedAt: now,
            pendingCorrection: acceptsCorrectionEvidence ? evidence : prior.pendingCorrection,
          })
        }
        continue
      }

      const timingAvailable = hasComparableTiming(tile)
      const priorHasComparableTiming = prior !== undefined && (prior.baseElapsedMs !== null || prior.baseRemainingMs !== null)
      const drift = frozen ? driftMs(tile, frozen) : null
      if (!prior || durationChanged || nameChanged || (timingAvailable && !priorHasComparableTiming)) {
        this.videos.set(key, clockFromTile(tile, now, nameChanged ? null : frozen, prior?.lastKnownName ?? null))
        continue
      }
      const materiallyDifferent = timingAvailable && drift !== null && drift > PLAYBACK_DRIFT_THRESHOLD_MS
      const evidence = materiallyDifferent ? correctionEvidence(tile, now) : null
      if (prior.status === 'ended' && timingAvailable) {
        // A terminal clock followed by a non-terminal timed state is a replay
        // or a new cue. The ended value is not a trustworthy frozen baseline.
        this.videos.set(key, {
          ...clockFromTile(tile, now, null, prior.lastKnownName),
          durationMs: observedDuration ?? prior.durationMs,
        })
        continue
      }
      if (prior.status !== tile.status) {
        // Status is authoritative immediately, but one late/contradictory
        // numeric sample cannot move the deterministic stop position.
        this.videos.set(
          key,
          clockFromFrozen(
            tile,
            prior,
            frozen!,
            now,
            acceptsCorrectionEvidence ? evidence : null,
          ),
        )
        continue
      }
      if (
        materiallyDifferent &&
        acceptsCorrectionEvidence &&
        prior.pendingCorrection !== null &&
        evidence !== null &&
        agreeingNonPlayingCorrection(prior.pendingCorrection, evidence)
      ) {
        this.videos.set(key, clockFromTile(tile, now, null, prior.lastKnownName))
        continue
      }
      this.videos.set(key, {
        ...prior,
        lastKnownName: tile.name ?? prior.lastKnownName,
        durationMs: observedDuration ?? prior.durationMs,
        lastObservedAt: now,
        pendingCorrection: acceptsCorrectionEvidence ? evidence : prior.pendingCorrection,
      })
    }
    for (const key of this.videos.keys()) {
      if (!presentKeys.has(key)) this.videos.delete(key)
    }

    if (state.videos.length === 0 && state.kind === 'playing' && state.timeMs !== null) {
      const observed = finite(state.timeMs)
      if (observed !== null) {
        if (!this.scalar || this.scalar.mode !== view.timingMode) {
          this.scalar = { baseMs: observed, anchoredAt: now, mode: view.timingMode }
        } else if (this.scalarDriftIsCorrection(observed, now)) {
          this.scalar = { baseMs: observed, anchoredAt: now, mode: view.timingMode }
        }
      }
    } else {
      this.scalar = null
    }

    return this.current(now) ?? view
  }

  current(now: number): AppView | null {
    if (!this.latest) return null
    if (!isPresentation(this.latest.state) || this.latest.state.kind === 'timing_unavailable') return this.latest

    const state = asPresentation(this.latest.state)
    const tiles = state.videos.map((tile) => {
      const clock = this.videos.get(tileKey(this.scope ?? scopeKey(state), tile))
      if (!clock) return tile
      const value = clockValue(clock, now)
      return {
        ...tile,
        durationMs: clock.durationMs ?? tile.durationMs,
        elapsedMs: value.elapsedMs ?? tile.elapsedMs,
        remainingMs: value.remainingMs ?? tile.remainingMs,
      }
    })
    const focus = tiles.find((tile) => tile.isFocus)
    const timeMs = focus
      ? this.latest.timingMode === 'remaining'
        ? focus.remainingMs
        : focus.elapsedMs
      : this.scalar
        ? scalarValue(this.scalar, now)
        : state.timeMs
    return { ...this.latest, state: { ...state, videos: tiles, timeMs } }
  }

  private scalarDriftIsCorrection(observed: number, now: number): boolean {
    return this.scalar !== null && scalarDrift(this.scalar, observed, now) > PLAYBACK_DRIFT_THRESHOLD_MS
  }

  private resetAnchors(): void {
    this.videos.clear()
    this.scalar = null
  }
}

export function createPlaybackClock(): PlaybackClock {
  return new PlaybackClockImpl()
}
