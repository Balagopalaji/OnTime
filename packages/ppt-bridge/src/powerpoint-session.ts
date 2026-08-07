import {
  createInitialPowerPointMachineState,
  reducePowerPointMachine,
  type PowerPointMachineResult,
  type PowerPointMachineState,
  type PresentationSnapshot,
  type PowerPointPollResult,
} from '@ontime/presentation-core'
import type { BridgePollOutcome, PowerPointObservation } from './protocol.js'

type EmptyDiagnostics = { warnings: []; extensions: { rootUnknownFieldCount: 0; videoUnknownFieldCount: 0; editSlideVideoUnknownFieldCount: 0 } }

export type PowerPointSessionTransport = {
  poll(): Promise<BridgePollOutcome | null>
  close?(): Promise<void> | void
}

export type PowerPointSessionOptions = {
  transport: PowerPointSessionTransport
  pollIntervalMs?: number
  /** Optional adaptive cadence used by standalone hosts; Companion keeps the default. */
  pollIntervalFor?: (outcome: BridgePollOutcome | null, nowMs: number) => number
  now?: () => number
  initialState?: PowerPointMachineState
  onTransition?: (result: PowerPointMachineResult) => void
}

const emptyDiagnostics = (): EmptyDiagnostics => ({
  warnings: [],
  extensions: { rootUnknownFieldCount: 0, videoUnknownFieldCount: 0, editSlideVideoUnknownFieldCount: 0 },
})

function projectObservation(observation: PowerPointObservation, inSlideshow?: boolean): PowerPointPollResult {
  return {
    state: observation.state,
    ...(observation.inSlideshow !== undefined || inSlideshow !== undefined ? { inSlideshow: inSlideshow ?? observation.inSlideshow } : {}),
    ...(observation.instanceId !== undefined ? { instanceId: observation.instanceId } : {}),
    ...(observation.slideNumber !== undefined ? { slideNumber: observation.slideNumber } : {}),
    ...(observation.totalSlides !== undefined ? { totalSlides: observation.totalSlides } : {}),
    ...(observation.protocolVersion !== undefined ? { protocolVersion: observation.protocolVersion } : {}),
    ...(observation.primaryVideoId !== undefined ? { primaryVideoId: observation.primaryVideoId } : {}),
    ...(observation.primaryVideoIndex !== undefined ? { primaryVideoIndex: observation.primaryVideoIndex } : {}),
    ...(observation.title !== undefined ? { title: observation.title } : {}),
    ...(observation.filename !== undefined ? { filename: observation.filename } : {}),
    ...(observation.editSlideVideos !== undefined ? { editSlideVideos: observation.editSlideVideos } : {}),
    ...(observation.videoDetected !== undefined ? { videoDetected: observation.videoDetected } : {}),
    ...(observation.videoPlaying !== undefined ? { videoPlaying: observation.videoPlaying } : {}),
    ...(observation.videoDuration !== undefined ? { videoDuration: observation.videoDuration } : {}),
    ...(observation.videoElapsed !== undefined ? { videoElapsed: observation.videoElapsed } : {}),
    ...(observation.videoRemaining !== undefined ? { videoRemaining: observation.videoRemaining } : {}),
    ...(observation.videos !== undefined ? { videos: observation.videos } : {}),
    ...(observation.videoTimingUnavailable !== undefined ? { videoTimingUnavailable: observation.videoTimingUnavailable } : {}),
  }
}

function outcomeToPoll(outcome: BridgePollOutcome): PowerPointPollResult | null | 'failure' {
  if (outcome.kind === 'observation') return projectObservation(outcome.observation)
  if (outcome.kind === 'powerpoint_not_running') return { state: 'none' }
  if (outcome.kind === 'no_slideshow') return projectObservation(outcome.observation, false)
  if (outcome.kind === 'closed') return null
  return 'failure'
}

function rawToOutcome(result: PowerPointPollResult): BridgePollOutcome {
  if (result.state === 'none') return { kind: 'powerpoint_not_running', ...emptyDiagnostics() }
  const observation: PowerPointObservation = { ...result, state: result.state }
  if (result.inSlideshow === false) {
    return { kind: 'no_slideshow', observation, ...emptyDiagnostics() }
  }
  return { kind: 'observation', observation, ...emptyDiagnostics() }
}

export class PowerPointSession {
  private readonly transport: PowerPointSessionTransport
  private readonly pollIntervalMs: number
  private readonly pollIntervalFor?: (outcome: BridgePollOutcome | null, nowMs: number) => number
  private readonly now: () => number
  private readonly onTransition?: (result: PowerPointMachineResult) => void
  private _state: PowerPointMachineState
  private timer: NodeJS.Timeout | null = null
  private polling = false
  private nextPollDelayMs: number
  private inFlight: Promise<void> | null = null
  private closed = false
  private closePromise: Promise<void> | null = null

  constructor(options: PowerPointSessionOptions) {
    this.transport = options.transport
    this.pollIntervalMs = options.pollIntervalMs ?? 1_000
    this.pollIntervalFor = options.pollIntervalFor
    this.now = options.now ?? Date.now
    this.onTransition = options.onTransition
    this._state = options.initialState ?? createInitialPowerPointMachineState()
    this.nextPollDelayMs = this.pollIntervalMs
  }

  get state(): PowerPointMachineState {
    return this._state
  }

  start(): void {
    if (this.closed || this.polling) return
    this.polling = true
    if (!this.pollIntervalFor) {
      // Preserve the established Companion cadence when no adaptive policy is
      // supplied. Only the standalone host opts into completion-based bursts.
      this.timer = setInterval(() => { void this.pollNow() }, this.pollIntervalMs)
      return
    }
    if (this.inFlight) return
    this.schedulePoll(this.pollIntervalMs)
  }

  stopPolling(): void {
    this.polling = false
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  isPolling(): boolean {
    return this.polling
  }

  pollNow(): Promise<void> {
    if (this.closed) return Promise.resolve()
    if (this.inFlight) return this.inFlight
    this.inFlight = this.transport.poll()
      .then((outcome) => {
        if (this.closed) return
        const nowMs = this.now()
        this.acceptOutcome(outcome, nowMs)
        this.nextPollDelayMs = this.nextPollDelay(outcome, nowMs)
      })
      .catch(() => {
        if (!this.closed) {
          const nowMs = this.now()
          this.dispatch({ type: 'operational_failure' })
          this.nextPollDelayMs = this.nextPollDelay(null, nowMs)
        }
      })
      .finally(() => {
        this.inFlight = null
        // `createSessionHost.start()` begins an immediate poll before starting
        // the adaptive session timer. Let that first response schedule its
        // burst instead of leaving the initial 1 s fallback armed.
        if (this.pollIntervalFor && this.polling && !this.timer) {
          this.schedulePoll(this.nextPollDelayMs)
        }
      })
    return this.inFlight
  }

  private schedulePoll(delayMs: number): void {
    if (this.closed || !this.polling || this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.pollNow().finally(() => {
        this.schedulePoll(this.nextPollDelayMs)
      })
    }, Math.max(0, delayMs))
  }

  private nextPollDelay(outcome: BridgePollOutcome | null, nowMs: number): number {
    if (!this.pollIntervalFor) return this.pollIntervalMs
    try {
      const delayMs = this.pollIntervalFor(outcome, nowMs)
      return Number.isFinite(delayMs) && delayMs >= 0 ? delayMs : this.pollIntervalMs
    } catch {
      return this.pollIntervalMs
    }
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise
    this.closed = true
    this.stopPolling()
    this.closePromise = Promise.resolve().then(() => this.transport.close?.()).then(() => undefined)
    return this.closePromise
  }

  acceptOutcome(outcome: BridgePollOutcome | null, nowMs = this.now()): PowerPointMachineResult {
    if (this.closed || outcome === null || outcome.kind === 'closed') return { state: this._state, action: null }
    const projected = outcomeToPoll(outcome)
    if (projected === null) return { state: this._state, action: null }
    if (projected === 'failure') return this.dispatch({ type: 'operational_failure' })
    return this.dispatch({ type: 'poll', result: projected, nowMs })
  }

  acceptPollResult(result: PowerPointPollResult | null, nowMs = this.now()): PowerPointMachineResult {
    if (this.closed || result === null) return { state: this._state, action: null }
    return this.acceptOutcome(rawToOutcome(result), nowMs)
  }

  acceptCandidate(snapshot: PresentationSnapshot | null, nowMs = this.now()): PowerPointMachineResult {
    if (this.closed) return { state: this._state, action: null }
    return this.dispatch({ type: 'candidate', snapshot, nowMs })
  }

  synchronizeCommittedSnapshot(snapshot: PresentationSnapshot | null): PowerPointMachineResult {
    if (this.closed) return { state: this._state, action: null }
    return this.dispatch({ type: 'synchronize_commit', snapshot })
  }

  private dispatch(event: Parameters<typeof reducePowerPointMachine>[1]): PowerPointMachineResult {
    const result = reducePowerPointMachine(this._state, event)
    this._state = result.state
    this.onTransition?.(result)
    return result
  }
}
