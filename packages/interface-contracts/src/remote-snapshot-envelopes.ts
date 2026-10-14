// rebuild-target: packages/interface-contracts

// Remote presentation snapshot wire envelopes for the LAN transport
// (ISSUE-002 S9a). Independently typed from the LiveCue-based
// `LIVE_CUE_*` / `PRESENTATION_*` envelopes: they never wrap `LiveCue`, and
// they carry the transport-neutral `RemoteSnapshotV1` unchanged so the cloud
// listener and the LAN socket feed the same viewer reducer.
//
// Types only (this package has no runtime schema library; see the barrel).
// Runtime validation lives with the consumers and always goes through the
// strict `parseRemoteSnapshotV1` of `@ontime/remote-viewer-contracts`:
// Companion validates every publish, and the viewer reducer re-parses every
// broadcast.
//
// Roles: only the local ppt-timer sidecar, admitted over loopback with a
// one-time token minted by Companion, may publish. LAN viewers (existing
// pairing JWTs) can only receive. `timestamp` is the sender's clock; on
// `REMOTE_SNAPSHOT*` it is the Companion clock, which is also the clock domain
// of the sidecar's `publishedAtMs` (the sidecar runs on the Companion host).

import type { RemoteSnapshotV1 } from '@ontime/remote-viewer-contracts';

/**
 * Loopback HTTP: `POST /api/remote-snapshot/publisher-token` response.
 * The request body is `{ roomId: string }`. The token is opaque, single use,
 * short lived, and only valid for the loopback socket admission below.
 */
export type RemotePublisherTokenResponse = {
  roomId: string;
  token: string;
  expiresAt: number;
};

/** Why Companion refused to admit a socket as the presentation publisher. */
export type RemotePublisherAdmitRejectCode =
  | 'NOT_LOOPBACK'
  | 'TOKEN_INVALID'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_REUSED'
  | 'ROOM_MISMATCH'
  | 'ALREADY_JOINED'
  | 'INVALID_PAYLOAD';

/**
 * Publisher -> Companion socket event `REMOTE_PUBLISHER_ADMIT`. Claims the
 * one-time token for `roomId` (the room whose paired viewers receive the
 * snapshots). Valid only from a loopback socket.
 */
export type RemotePublisherAdmitPayload = {
  type: 'REMOTE_PUBLISHER_ADMIT';
  roomId: string;
  token: string;
  timestamp: number;
};

/** Companion -> publisher socket event `REMOTE_PUBLISHER_ADMIT_RESULT`. */
export type RemotePublisherAdmitResult = {
  type: 'REMOTE_PUBLISHER_ADMIT_RESULT';
  roomId: string;
  timestamp: number;
} & (
  | { admitted: true }
  | { admitted: false; code: RemotePublisherAdmitRejectCode }
);

/**
 * Publisher -> Companion socket event `REMOTE_SNAPSHOT_PUBLISH`. A full
 * (never delta) snapshot; `roomId` must equal the admitted room.
 */
export type RemoteSnapshotPublishPayload = {
  type: 'REMOTE_SNAPSHOT_PUBLISH';
  roomId: string;
  snapshot: RemoteSnapshotV1;
  timestamp: number;
};

/** Why Companion refused a publish. */
export type RemoteSnapshotPublishRejectCode =
  | 'UNAUTHORIZED_ROLE'
  | 'NOT_LOOPBACK'
  | 'ROOM_MISMATCH'
  | 'INVALID_PAYLOAD'
  | 'INVALID_SNAPSHOT'
  | 'SESSION_BOUND_TO_OTHER_ROOM'
  | 'SESSION_ENDED'
  | 'DUPLICATE'
  | 'REGRESSION';

/** Companion -> publisher socket event `REMOTE_SNAPSHOT_PUBLISH_RESULT`. */
export type RemoteSnapshotPublishResult = {
  type: 'REMOTE_SNAPSHOT_PUBLISH_RESULT';
  roomId: string;
  sessionId?: string;
  timestamp: number;
} & (
  | { accepted: true; order: 'apply' | 'reset'; epoch: number; sequence: number }
  | {
      accepted: false;
      code: RemoteSnapshotPublishRejectCode;
      /** Last accepted position for the session when ordering was the reason. */
      lastEpoch?: number;
      lastSequence?: number;
    }
);

/**
 * Companion -> viewer socket event `REMOTE_SNAPSHOT`. Sent as the bootstrap
 * (the cached latest full snapshot) to each newly admitted client of the room,
 * and broadcast to the room on every accepted publish.
 */
export type RemoteSnapshotEnvelope = {
  type: 'REMOTE_SNAPSHOT';
  roomId: string;
  snapshot: RemoteSnapshotV1;
  timestamp: number;
};

/** Publisher -> Companion socket event `REMOTE_SNAPSHOT_END`: the operator stopped sharing. */
export type RemoteSnapshotEndPayload = {
  type: 'REMOTE_SNAPSHOT_END';
  roomId: string;
  sessionId: string;
  timestamp: number;
};

/**
 * Companion -> viewer socket event `REMOTE_SNAPSHOT_ENDED`. The session's cache
 * is dropped; viewers move to the ended state instead of waiting for stale.
 */
export type RemoteSnapshotEndedEnvelope = {
  type: 'REMOTE_SNAPSHOT_ENDED';
  roomId: string;
  sessionId: string;
  timestamp: number;
};
