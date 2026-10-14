import { describe, expect, it } from 'vitest'
import { parseRemoteSnapshotV1 } from '@ontime/remote-viewer-contracts'
import type { RemoteSnapshotV1 } from '@ontime/remote-viewer-contracts'
import type {
  LiveCueEventPayload,
  PresentationClearPayload,
  PresentationEventPayload,
  RemotePublisherAdmitPayload,
  RemotePublisherAdmitResult,
  RemotePublisherTokenResponse,
  RemoteSnapshotEndPayload,
  RemoteSnapshotEndedEnvelope,
  RemoteSnapshotEnvelope,
  RemoteSnapshotPublishPayload,
  RemoteSnapshotPublishResult,
} from './index'

function snapshot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaMajor: 1,
    sourceKind: 'powerpoint',
    sourceMajor: 1,
    observedAtMs: 1_790_000_000_000,
    availability: 'active',
    payload: {
      reason: 'presentation',
      presentationState: 'playing',
      slideNumber: 3,
      slideCount: 12,
      displayTitle: 'Sunday Service',
      headline: { focusedOrdinal: 0, mode: 'longest-remaining', timingMode: 'remaining' },
      videos: [
        {
          ordinal: 0,
          label: 'Walk-in loop',
          status: 'playing',
          durationMs: 120_000,
          elapsedMsAtObservation: 30_000,
          remainingMsAtObservation: 90_000,
          isFocus: true,
        },
      ],
    },
    sessionId: 'sess_Abc123',
    epoch: 2,
    sequence: 7,
    observationAgeMs: 40,
    preCommitTransitMs: 0,
    publishedAtMs: 1_790_000_000_300,
    heartbeatIntervalMs: 10_000,
    staleAfterMs: 25_000,
    disconnectAfterMs: 60_000,
    ...overrides,
  }
}

function strict(value: Record<string, unknown>): RemoteSnapshotV1 {
  const parsed = parseRemoteSnapshotV1(value)
  if (!parsed.ok) throw new Error(`fixture rejected: ${parsed.error.code} ${parsed.error.path}`)
  return parsed.value
}

describe('REMOTE_SNAPSHOT_PUBLISH / REMOTE_SNAPSHOT envelopes (ISSUE-002 S9a)', () => {
  it('both carry a RemoteSnapshotV1 that the strict contract parser accepts', () => {
    const value = strict(snapshot())
    const publish: RemoteSnapshotPublishPayload = {
      type: 'REMOTE_SNAPSHOT_PUBLISH',
      roomId: 'room-1',
      snapshot: value,
      timestamp: 1,
    }
    const broadcast: RemoteSnapshotEnvelope = {
      type: 'REMOTE_SNAPSHOT',
      roomId: 'room-1',
      snapshot: value,
      timestamp: 2,
    }
    expect(parseRemoteSnapshotV1(publish.snapshot).ok).toBe(true)
    expect(parseRemoteSnapshotV1(broadcast.snapshot).ok).toBe(true)
    // The same snapshot value crosses both hops unchanged (no wrapper keys, no re-shaping).
    expect(broadcast.snapshot).toEqual(publish.snapshot)
  })

  it('the strict parser keeps rejecting what the envelopes must never carry', () => {
    expect(parseRemoteSnapshotV1(snapshot({ fullName: 'C:\\Shows\\a.pptx' })).ok).toBe(false)
    expect(parseRemoteSnapshotV1(snapshot({ schemaMajor: 2 })).ok).toBe(false)
    expect(parseRemoteSnapshotV1({ roomId: 'room-1', snapshot: snapshot() }).ok).toBe(false)
  })

  it('uses its own discriminants, never LIVE_CUE_* or PRESENTATION_*', () => {
    const types: Array<
      | RemotePublisherAdmitPayload['type']
      | RemotePublisherAdmitResult['type']
      | RemoteSnapshotPublishPayload['type']
      | RemoteSnapshotPublishResult['type']
      | RemoteSnapshotEnvelope['type']
      | RemoteSnapshotEndPayload['type']
      | RemoteSnapshotEndedEnvelope['type']
    > = [
      'REMOTE_PUBLISHER_ADMIT',
      'REMOTE_PUBLISHER_ADMIT_RESULT',
      'REMOTE_SNAPSHOT_PUBLISH',
      'REMOTE_SNAPSHOT_PUBLISH_RESULT',
      'REMOTE_SNAPSHOT',
      'REMOTE_SNAPSHOT_END',
      'REMOTE_SNAPSHOT_ENDED',
    ]
    for (const type of types) {
      expect(type.startsWith('REMOTE_')).toBe(true)
      expect(type).not.toMatch(/LIVE_CUE|PRESENTATION_/)
    }
  })

  it('is structurally independent of the LiveCue-based presentation envelopes', () => {
    const live = null as unknown as PresentationEventPayload
    const clear = null as unknown as PresentationClearPayload
    const cue = null as unknown as LiveCueEventPayload
    // @ts-expect-error a LiveCue presentation payload is not a publish envelope
    const a: RemoteSnapshotPublishPayload = live
    // @ts-expect-error a LiveCue payload is not a broadcast envelope
    const b: RemoteSnapshotEnvelope = cue
    // @ts-expect-error a clear payload is not an end envelope
    const c: RemoteSnapshotEndPayload = clear
    // @ts-expect-error the reverse also does not hold
    const d: PresentationEventPayload = null as unknown as RemoteSnapshotEnvelope
    expect([a, b, c, d]).toHaveLength(4)
  })

  it('models admission and publish outcomes as discriminated results', () => {
    const admitted: RemotePublisherAdmitResult = {
      type: 'REMOTE_PUBLISHER_ADMIT_RESULT',
      roomId: 'room-1',
      admitted: true,
      timestamp: 1,
    }
    const denied: RemotePublisherAdmitResult = {
      type: 'REMOTE_PUBLISHER_ADMIT_RESULT',
      roomId: 'room-1',
      admitted: false,
      code: 'NOT_LOOPBACK',
      timestamp: 1,
    }
    const accepted: RemoteSnapshotPublishResult = {
      type: 'REMOTE_SNAPSHOT_PUBLISH_RESULT',
      roomId: 'room-1',
      sessionId: 'sess_Abc123',
      accepted: true,
      order: 'reset',
      epoch: 2,
      sequence: 7,
      timestamp: 1,
    }
    const rejected: RemoteSnapshotPublishResult = {
      type: 'REMOTE_SNAPSHOT_PUBLISH_RESULT',
      roomId: 'room-1',
      accepted: false,
      code: 'REGRESSION',
      lastEpoch: 2,
      lastSequence: 7,
      timestamp: 1,
    }
    const token: RemotePublisherTokenResponse = { roomId: 'room-1', token: 't', expiresAt: 5 }
    expect([admitted.admitted, denied.admitted, accepted.accepted, rejected.accepted]).toEqual([true, false, true, false])
    expect(token.expiresAt).toBe(5)
  })
})
