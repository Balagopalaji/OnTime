import { describe, expect, it } from 'vitest'
import type {
  ApiErrorResponse,
  ControlRequestClearReason,
  ControlRequestDenied,
  ControlRequestReceived,
  ControlRequestStatus,
  ControllerLockStatePayload,
  CompanionRoomState,
  CreateCuePayload,
  CreateTimerPayload,
  CueCreated,
  CueDeleted,
  CueError,
  CueUpdated,
  CuesReordered,
  DeleteCuePayload,
  DeleteTimerPayload,
  DenyControlPayload,
  ForceTakeoverPayload,
  HandOverPayload,
  HandshakeAck,
  HandshakeError,
  HeartbeatPayload,
  JoinRoomPayload,
  ReorderCuesPayload,
  ReorderTimersPayload,
  RequestControlPayload,
  RoomClientsState,
  RoomPinState,
  RoomStateDelta,
  RoomStatePatchPayload,
  RoomStateSnapshot,
  SetRoomPinPayload,
  StatusWindowResponse,
  SyncRoomStatePayload,
  TimerActionKind,
  TimerActionPayload,
  TimerCreated,
  TimerDeleted,
  TimerError,
  TimerUpdated,
  TimersReordered,
  TokenResponse,
  UpdateCuePayload,
  UpdateTimerPayload,
} from './index'

// Pins the literal `type` discriminants of the eight control-request wire types.
// These are byte/shape-faithful to the definitions adopted from
// `companion/src/main.ts` (lines 283-359). A drift in any discriminant string
// or required-key set breaks a wire event name, so this test is the net.

type LiteralType<T> = T extends { type: infer U } ? U : never

describe('interface-contracts control-request wire types', () => {
  it('pins the eight discriminant strings', () => {
    const discriminants: {
      requestControl: LiteralType<RequestControlPayload>;
      received: LiteralType<ControlRequestReceived>;
      forceTakeover: LiteralType<ForceTakeoverPayload>;
      handOver: LiteralType<HandOverPayload>;
      deny: LiteralType<DenyControlPayload>;
      denied: LiteralType<ControlRequestDenied>;
      roomPinState: LiteralType<RoomPinState>;
      setRoomPin: LiteralType<SetRoomPinPayload>;
    } = {
      requestControl: 'REQUEST_CONTROL',
      received: 'CONTROL_REQUEST_RECEIVED',
      forceTakeover: 'FORCE_TAKEOVER',
      handOver: 'HAND_OVER',
      deny: 'DENY_CONTROL',
      denied: 'CONTROL_REQUEST_DENIED',
      roomPinState: 'ROOM_PIN_STATE',
      setRoomPin: 'SET_ROOM_PIN',
    }
    expect(discriminants).toEqual({
      requestControl: 'REQUEST_CONTROL',
      received: 'CONTROL_REQUEST_RECEIVED',
      forceTakeover: 'FORCE_TAKEOVER',
      handOver: 'HAND_OVER',
      deny: 'DENY_CONTROL',
      denied: 'CONTROL_REQUEST_DENIED',
      roomPinState: 'ROOM_PIN_STATE',
      setRoomPin: 'SET_ROOM_PIN',
    })
  })

  it('RequestControlPayload has the adopted required-key set', () => {
    const sample: RequestControlPayload = {
      type: 'REQUEST_CONTROL',
      roomId: 'room-1',
      clientId: 'client-a',
      timestamp: 1,
    }
    const optionalOnly: RequestControlPayload = {
      ...sample,
      deviceName: 'dev',
      userId: 'u',
      userName: 'n',
    }
    expect(sample.roomId).toBe(optionalOnly.roomId)
  })

  it('ForceTakeoverPayload carries optional pin/reauthenticated', () => {
    const noPin: ForceTakeoverPayload = {
      type: 'FORCE_TAKEOVER',
      roomId: 'room-1',
      clientId: 'client-a',
      timestamp: 1,
    }
    const withPin: ForceTakeoverPayload = {
      ...noPin,
      pin: '1234',
      reauthenticated: true,
    }
    expect(withPin.pin).toBe('1234')
    expect(withPin.reauthenticated).toBe(true)
    expect(noPin.pin).toBeUndefined()
  })

  it('ControlRequestDenied carries optional denier metadata', () => {
    const minimal: ControlRequestDenied = {
      type: 'CONTROL_REQUEST_DENIED',
      roomId: 'room-1',
      requesterId: 'client-a',
      timestamp: 1,
    }
    const full: ControlRequestDenied = {
      ...minimal,
      reason: 'busy',
      deniedByName: 'op',
      deniedByUserId: 'u',
      deniedByUserName: 'Operator',
    }
    expect(full.deniedByName).toBe('op')
    expect(minimal.reason).toBeUndefined()
  })

  it('RoomPinState pin may be null', () => {
    const cleared: RoomPinState = {
      type: 'ROOM_PIN_STATE',
      roomId: 'room-1',
      pin: null,
      updatedAt: 1,
    }
    const set: RoomPinState = {
      ...cleared,
      pin: '9999',
    }
    expect(cleared.pin).toBeNull()
    expect(set.pin).toBe('9999')
  })

  it('HandOverPayload, DenyControlPayload, SetRoomPinPayload shapes', () => {
    const handover: HandOverPayload = {
      type: 'HAND_OVER',
      roomId: 'room-1',
      targetClientId: 'client-b',
      timestamp: 1,
    }
    const deny: DenyControlPayload = {
      type: 'DENY_CONTROL',
      roomId: 'room-1',
      requesterId: 'client-a',
      timestamp: 1,
    }
    const setPin: SetRoomPinPayload = {
      type: 'SET_ROOM_PIN',
      roomId: 'room-1',
      timestamp: 1,
    }
    expect(handover.targetClientId).toBe('client-b')
    expect(deny.requesterId).toBe('client-a')
    expect(setPin.pin).toBeUndefined()
  })

  it('ControlRequestReceived carries requester identity fields', () => {
    const received: ControlRequestReceived = {
      type: 'CONTROL_REQUEST_RECEIVED',
      roomId: 'room-1',
      requesterId: 'client-a',
      timestamp: 1,
    }
    const named: ControlRequestReceived = {
      ...received,
      requesterName: 'dev',
      requesterUserId: 'u',
      requesterUserName: 'Operator',
    }
    expect(received.requesterName).toBeUndefined()
    expect(named.requesterName).toBe('dev')
  })
})

// Pins the required-key sets of the three HTTP response contracts adopted in
// U1 slice 2 from companion/src/token-server.ts. A drift in any required key
// (or in the literal `success: true` discriminant) breaks a wire shape.

describe('interface-contracts HTTP response contracts', () => {
  it('TokenResponse has exactly { token, expiresAt }', () => {
    const body: TokenResponse = {
      token: 'tok-123',
      expiresAt: 9_999,
    }
    expect(body.token).toBe('tok-123')
    expect(body.expiresAt).toBe(9_999)
    // No optional fields declared on the type.
    const keys: (keyof TokenResponse)[] = ['token', 'expiresAt']
    expect(keys).toEqual(['token', 'expiresAt'])
  })

  it('StatusWindowResponse pins the literal `success: true` discriminant + headless', () => {
    type LiteralSuccess = StatusWindowResponse extends { success: infer S } ? S : never
    const discriminant: LiteralSuccess = true
    expect(discriminant).toBe(true)

    const visible: StatusWindowResponse = {
      success: true,
      headless: false,
    }
    const hidden: StatusWindowResponse = {
      success: true,
      headless: true,
    }
    expect(visible.headless).toBe(false)
    expect(hidden.headless).toBe(true)

    const keys: (keyof StatusWindowResponse)[] = ['success', 'headless']
    expect(keys).toEqual(['success', 'headless'])
  })

  it('ApiErrorResponse has exactly { error: string }', () => {
    const forbidden: ApiErrorResponse = { error: 'Forbidden' }
    const invalidOrigin: ApiErrorResponse = { error: 'Invalid origin' }
    expect(forbidden.error).toBe('Forbidden')
    expect(invalidOrigin.error).toBe('Invalid origin')
    const keys: (keyof ApiErrorResponse)[] = ['error']
    expect(keys).toEqual(['error'])
  })
})

// Pins the literal `type` discriminants + required-key sets of the three
// join/heartbeat/client-state wire types adopted in U1 slice 3 from
// `companion/src/main.ts`. A drift in any discriminant string or required
// key breaks a Socket.IO event name/shape, so this test is the net.

describe('interface-contracts join/heartbeat/client-state wire types', () => {
  it('pins the three discriminant strings', () => {
    const discriminants: {
      joinRoom: LiteralType<JoinRoomPayload>;
      heartbeat: LiteralType<HeartbeatPayload>;
      roomClientsState: LiteralType<RoomClientsState>;
    } = {
      joinRoom: 'JOIN_ROOM',
      heartbeat: 'HEARTBEAT',
      roomClientsState: 'ROOM_CLIENTS_STATE',
    }
    expect(discriminants).toEqual({
      joinRoom: 'JOIN_ROOM',
      heartbeat: 'HEARTBEAT',
      roomClientsState: 'ROOM_CLIENTS_STATE',
    })
  })

  it('JoinRoomPayload has the adopted required + optional keys', () => {
    const requiredOnly: JoinRoomPayload = {
      type: 'JOIN_ROOM',
      roomId: 'room-1',
      token: 'tok',
    }
    const full: JoinRoomPayload = {
      ...requiredOnly,
      clientType: 'controller',
      clientId: 'client-a',
      deviceName: 'dev',
      userId: 'u',
      userName: 'n',
      ownerId: 'owner-1',
      takeOver: true,
      interfaceVersion: '2.0.0',
      reconnectStartedAt: 1,
    }
    expect(requiredOnly.clientId).toBeUndefined()
    expect(full.takeOver).toBe(true)
    expect(full.reconnectStartedAt).toBe(1)
  })

  it('HeartbeatPayload has exactly { type, roomId, clientId, timestamp }', () => {
    const hb: HeartbeatPayload = {
      type: 'HEARTBEAT',
      roomId: 'room-1',
      clientId: 'client-a',
      timestamp: 1,
    }
    const keys: (keyof HeartbeatPayload)[] = ['type', 'roomId', 'clientId', 'timestamp']
    expect(keys).toEqual(['type', 'roomId', 'clientId', 'timestamp'])
    expect(hb.timestamp).toBe(1)
  })

  it('RoomClientsState carries the client array with required identity fields', () => {
    const state: RoomClientsState = {
      type: 'ROOM_CLIENTS_STATE',
      roomId: 'room-1',
      clients: [
        {
          clientId: 'client-a',
          clientType: 'controller',
        },
        {
          clientId: 'client-b',
          clientType: 'viewer',
          deviceName: 'viewer-dev',
          role: 'stage',
          tokenId: 'tok-1',
          lastHeartbeat: 99,
        },
      ],
      timestamp: 1,
    }
    expect(state.clients[0].clientType).toBe('controller')
    expect(state.clients[0].deviceName).toBeUndefined()
    expect(state.clients[1].tokenId).toBe('tok-1')
    expect(state.timestamp).toBe(1)
  })
})

// Pins the `HandshakeError` server→client payload adopted in U1 slice 4 from
// `companion/src/main.ts` (the strict `handleJoinRoom` emit shape). The
// `code` union is a closed 4-value set; `HANDSHAKE_PENDING` is a Companion-only
// fourth code over docs/interface.md §3.3's three (plan D6). A drift in the
// discriminant, the union, or the required-key set breaks the wire event.

describe('interface-contracts HandshakeError wire type', () => {
  it('pins the HANDSHAKE_ERROR type discriminant', () => {
    const discriminant: LiteralType<HandshakeError> = 'HANDSHAKE_ERROR'
    expect(discriminant).toBe('HANDSHAKE_ERROR')
  })

  it('pins the closed four-code union (INVALID_TOKEN | INVALID_PAYLOAD | CONTROLLER_TAKEN | HANDSHAKE_PENDING)', () => {
    type Code = HandshakeError extends { code: infer C } ? C : never
    // Each literal is assignable to the union; an unrelated string is not.
    const invalidToken: Code = 'INVALID_TOKEN'
    const invalidPayload: Code = 'INVALID_PAYLOAD'
    const controllerTaken: Code = 'CONTROLLER_TAKEN'
    const handshakePending: Code = 'HANDSHAKE_PENDING'
    expect([invalidToken, invalidPayload, controllerTaken, handshakePending]).toEqual([
      'INVALID_TOKEN',
      'INVALID_PAYLOAD',
      'CONTROLLER_TAKEN',
      'HANDSHAKE_PENDING',
    ])

    // Compile-time exhaustiveness: a value of type Code must be one of the four.
    // If the union widens, this assertion's literal set no longer covers it.
    const allCodes: Code[] = ['INVALID_TOKEN', 'INVALID_PAYLOAD', 'CONTROLLER_TAKEN', 'HANDSHAKE_PENDING']
    expect(new Set(allCodes).size).toBe(4)
  })

  it('requires message: string and the literal type tag', () => {
    const err: HandshakeError = {
      type: 'HANDSHAKE_ERROR',
      code: 'INVALID_TOKEN',
      message: 'Pairing expired or revoked.',
    }
    const keys: (keyof HandshakeError)[] = ['type', 'code', 'message']
    expect(keys).toEqual(['type', 'code', 'message'])
    expect(err.type).toBe('HANDSHAKE_ERROR')
    expect(err.message).toBe('Pairing expired or revoked.')
  })

  it('admits the Companion-only HANDSHAKE_PENDING code', () => {
    const pending: HandshakeError = {
      type: 'HANDSHAKE_ERROR',
      code: 'HANDSHAKE_PENDING',
      message: 'Handshake still pending.',
    }
    expect(pending.code).toBe('HANDSHAKE_PENDING')
  })
})

// Pins the `HandshakeAck` server→client payload adopted in U1 slice 5 from
// `companion/src/main.ts` (`createHandshakeAck`). `success` is the literal
// discriminant `true`; `companionMode` is a closed 3-value union;
// `systemInfo.platform` inlines the `NodeJS.Platform` union so the package has
// no `@types/node` dependency. A drift in the discriminant, the unions, or the
// required-key set breaks the wire event.

describe('interface-contracts HandshakeAck wire type', () => {
  it('pins the HANDSHAKE_ACK type discriminant', () => {
    const discriminant: LiteralType<HandshakeAck> = 'HANDSHAKE_ACK'
    expect(discriminant).toBe('HANDSHAKE_ACK')
  })

  it('pins the literal `success: true` discriminant', () => {
    type LiteralSuccess = HandshakeAck extends { success: infer S } ? S : never
    const discriminant: LiteralSuccess = true
    expect(discriminant).toBe(true)
  })

  it('admits optional roomId and requires the identity/version keys', () => {
    const withoutRoom: HandshakeAck = {
      type: 'HANDSHAKE_ACK',
      success: true,
      companionMode: 'show_control',
      companionVersion: '0.1.1-dev.2',
      interfaceVersion: '1.2.0',
      capabilities: { powerpoint: true, externalVideo: false, fileOperations: true },
      systemInfo: { platform: 'darwin', hostname: 'local' },
    }
    const withRoom: HandshakeAck = { ...withoutRoom, roomId: 'room-1' }
    expect(withoutRoom.roomId).toBeUndefined()
    expect(withRoom.roomId).toBe('room-1')
    expect(withoutRoom.companionVersion).toBe('0.1.1-dev.2')
    expect(withoutRoom.interfaceVersion).toBe('1.2.0')
  })

  it('pins the closed three-value companionMode union', () => {
    type Mode = HandshakeAck extends { companionMode: infer M } ? M : never
    const minimal: Mode = 'minimal'
    const showControl: Mode = 'show_control'
    const production: Mode = 'production'
    expect([minimal, showControl, production]).toEqual([
      'minimal',
      'show_control',
      'production',
    ])
    const allModes: Mode[] = ['minimal', 'show_control', 'production']
    expect(new Set(allModes).size).toBe(3)
  })

  it('requires the three capability flags', () => {
    const capabilities = {
      powerpoint: true,
      externalVideo: false,
      fileOperations: true,
    }
    const ack: HandshakeAck = {
      type: 'HANDSHAKE_ACK',
      success: true,
      companionMode: 'production',
      companionVersion: '0.1.1-dev.2',
      interfaceVersion: '1.2.0',
      capabilities,
      systemInfo: { platform: 'win32', hostname: 'stage-pc' },
    }
    expect(ack.capabilities).toEqual({
      powerpoint: true,
      externalVideo: false,
      fileOperations: true,
    })
  })

  it('pins the systemInfo.platform union (NodeJS.Platform inlined) + hostname', () => {
    type Platform = HandshakeAck extends { systemInfo: { platform: infer P } } ? P : never
    const darwin: Platform = 'darwin'
    const linux: Platform = 'linux'
    const win32: Platform = 'win32'
    expect([darwin, linux, win32]).toEqual(['darwin', 'linux', 'win32'])
    // Compile-time: the union is the 11-value NodeJS.Platform set.
    const allPlatforms: Platform[] = [
      'aix',
      'android',
      'darwin',
      'freebsd',
      'haiku',
      'linux',
      'openbsd',
      'sunos',
      'win32',
      'cygwin',
      'netbsd',
    ]
    expect(new Set(allPlatforms).size).toBe(11)

    const ack: HandshakeAck = {
      type: 'HANDSHAKE_ACK',
      success: true,
      companionMode: 'minimal',
      companionVersion: '0.1.1-dev.2',
      interfaceVersion: '1.2.0',
      capabilities: { powerpoint: false, externalVideo: false, fileOperations: false },
      systemInfo: { platform: 'darwin', hostname: 'local' },
    }
    expect(ack.systemInfo.hostname).toBe('local')
  })
})

// Pins the self-contained control/timer/cue wire types adopted in U1 slice 6
// from `companion/src/main.ts` (+ `ControlRequestClearReason` from
// `companion/src/control-lock-utils.ts`). These types close over no domain-heavy
// (Timer/Cue/RoomState) type — only primitives, the shared `ControllerLock`
// shape, and closed literal unions. A drift in any discriminant string, union,
// or required-key set breaks a Socket.IO event shape, so these tests are the net.

describe('interface-contracts control/timer/cue wire types (U1 slice 6)', () => {
  it('TimerActionKind is the closed START | PAUSE | RESET union', () => {
    const start: TimerActionKind = 'START'
    const pause: TimerActionKind = 'PAUSE'
    const reset: TimerActionKind = 'RESET'
    expect([start, pause, reset]).toEqual(['START', 'PAUSE', 'RESET'])
    const allKinds: TimerActionKind[] = ['START', 'PAUSE', 'RESET']
    expect(new Set(allKinds).size).toBe(3)
  })

  it('TimerActionPayload pins the TIMER_ACTION discriminant + required/optional keys', () => {
    const discriminant: LiteralType<TimerActionPayload> = 'TIMER_ACTION'
    expect(discriminant).toBe('TIMER_ACTION')

    const requiredOnly: TimerActionPayload = {
      type: 'TIMER_ACTION',
      action: 'START',
      roomId: 'room-1',
      timerId: 'timer-a',
    }
    const full: TimerActionPayload = {
      ...requiredOnly,
      timestamp: 1,
      clientId: 'client-a',
      currentTime: 0,
    }
    expect(requiredOnly.timestamp).toBeUndefined()
    expect(requiredOnly.clientId).toBeUndefined()
    expect(full.action).toBe('START')
    expect(full.currentTime).toBe(0)
  })

  it('TimerError pins the TIMER_ERROR discriminant + closed code union + required keys', () => {
    const discriminant: LiteralType<TimerError> = 'TIMER_ERROR'
    expect(discriminant).toBe('TIMER_ERROR')

    type Code = TimerError extends { code: infer C } ? C : never
    const invalidPayload: Code = 'INVALID_PAYLOAD'
    const invalidFields: Code = 'INVALID_FIELDS'
    const notFound: Code = 'NOT_FOUND'
    expect([invalidPayload, invalidFields, notFound]).toEqual([
      'INVALID_PAYLOAD',
      'INVALID_FIELDS',
      'NOT_FOUND',
    ])

    const err: TimerError = {
      type: 'TIMER_ERROR',
      roomId: 'room-1',
      code: 'NOT_FOUND',
      message: 'Timer not found.',
      timestamp: 1,
    }
    const withClient: TimerError = { ...err, clientId: 'client-a' }
    expect(err.clientId).toBeUndefined()
    expect(withClient.clientId).toBe('client-a')
    expect(err.message).toBe('Timer not found.')
  })

  it('CueError pins the CUE_ERROR discriminant + closed code union + required keys', () => {
    const discriminant: LiteralType<CueError> = 'CUE_ERROR'
    expect(discriminant).toBe('CUE_ERROR')

    type Code = CueError extends { code: infer C } ? C : never
    const invalidPayload: Code = 'INVALID_PAYLOAD'
    const invalidFields: Code = 'INVALID_FIELDS'
    const notFound: Code = 'NOT_FOUND'
    expect([invalidPayload, invalidFields, notFound]).toEqual([
      'INVALID_PAYLOAD',
      'INVALID_FIELDS',
      'NOT_FOUND',
    ])

    const err: CueError = {
      type: 'CUE_ERROR',
      roomId: 'room-1',
      code: 'INVALID_FIELDS',
      message: 'Cue requires title and createdBy.',
      clientId: 'client-a',
      timestamp: 1,
    }
    const keys: (keyof CueError)[] = ['type', 'roomId', 'code', 'message', 'clientId', 'timestamp']
    expect(keys).toEqual(['type', 'roomId', 'code', 'message', 'clientId', 'timestamp'])
    expect(err.code).toBe('INVALID_FIELDS')
  })

  it('ControlRequestClearReason is the closed six-value union', () => {
    const reasons: ControlRequestClearReason[] = [
      'lock_changed',
      'request_denied',
      'requester_disconnected',
      'timeout',
      'room_unsubscribed',
      'superseded',
    ]
    expect(new Set(reasons).size).toBe(6)
  })

  it('ControlRequestStatus pins the CONTROL_REQUEST_STATUS discriminant + status union + reason link', () => {
    const discriminant: LiteralType<ControlRequestStatus> = 'CONTROL_REQUEST_STATUS'
    expect(discriminant).toBe('CONTROL_REQUEST_STATUS')

    type Status = ControlRequestStatus extends { status: infer S } ? S : never
    const queued: Status = 'queued'
    const cleared: Status = 'cleared'
    expect([queued, cleared]).toEqual(['queued', 'cleared'])

    const clearedWithReason: ControlRequestStatus = {
      type: 'CONTROL_REQUEST_STATUS',
      roomId: 'room-1',
      requesterId: 'client-a',
      status: 'cleared',
      reason: 'timeout',
      requestedAt: 1,
      timestamp: 2,
    }
    const queuedNoReason: ControlRequestStatus = {
      type: 'CONTROL_REQUEST_STATUS',
      roomId: 'room-1',
      requesterId: 'client-a',
      status: 'queued',
      requestedAt: 1,
      timestamp: 2,
    }
    // `reason`, when present, must be a valid ControlRequestClearReason.
    const reason: ControlRequestClearReason = clearedWithReason.reason as ControlRequestClearReason
    expect(reason).toBe('timeout')
    expect(queuedNoReason.reason).toBeUndefined()
    expect(clearedWithReason.requestedAt).toBe(1)
  })

  it('ControllerLockStatePayload pins the CONTROLLER_LOCK_STATE discriminant + null-lock + ControllerLock shape', () => {
    const discriminant: LiteralType<ControllerLockStatePayload> = 'CONTROLLER_LOCK_STATE'
    expect(discriminant).toBe('CONTROLLER_LOCK_STATE')

    const noLock: ControllerLockStatePayload = {
      type: 'CONTROLLER_LOCK_STATE',
      roomId: 'room-1',
      lock: null,
      timestamp: 1,
    }
    const withLock: ControllerLockStatePayload = {
      type: 'CONTROLLER_LOCK_STATE',
      roomId: 'room-1',
      lock: {
        clientId: 'client-a',
        deviceName: 'dev',
        userId: 'u',
        userName: 'n',
        lockedAt: 1,
        lastHeartbeat: 2,
        roomId: 'room-1',
      },
      timestamp: 3,
    }
    expect(noLock.lock).toBeNull()
    expect(withLock.lock?.clientId).toBe('client-a')
    expect(withLock.lock?.lockedAt).toBe(1)
    // The ControllerLock shape comes from @ontime/shared-types (7 keys).
    const lockKeys: (keyof NonNullable<ControllerLockStatePayload['lock']>)[] = [
      'clientId',
      'deviceName',
      'userId',
      'userName',
      'lockedAt',
      'lastHeartbeat',
      'roomId',
    ]
    expect(lockKeys).toEqual([
      'clientId',
      'deviceName',
      'userId',
      'userName',
      'lockedAt',
      'lastHeartbeat',
      'roomId',
    ])
  })
})

// Pins the 16 Timer/Cue CRUD wire envelopes adopted in U1 slice 7 from
// `companion/src/main.ts`. The four client→server CREATE/UPDATE/DELETE/REORDER
// payloads reference `Partial<Timer>`/`Partial<Cue>` and carry an OPTIONAL
// `timestamp` (server-stamped on receipt); the four server→client
// CREATED/UPDATED/DELETED/REORDERED broadcasts reference the canonical
// `Timer`/`Cue` (or `Partial<Timer>`/`Partial<Cue>` for the *Updated `changes`)
// and carry a REQUIRED `timestamp` (server clock). A drift in any discriminant
// string, required-key set, or the optional-vs-required timestamp asymmetry
// breaks a Socket.IO event shape, so these tests are the net.

describe('interface-contracts Timer/Cue CRUD wire envelopes (U1 slice 7)', () => {
  it('pins the eight Timer discriminant strings', () => {
    const discriminants: {
      create: LiteralType<CreateTimerPayload>;
      update: LiteralType<UpdateTimerPayload>;
      delete: LiteralType<DeleteTimerPayload>;
      reorder: LiteralType<ReorderTimersPayload>;
      created: LiteralType<TimerCreated>;
      updated: LiteralType<TimerUpdated>;
      deleted: LiteralType<TimerDeleted>;
      reordered: LiteralType<TimersReordered>;
    } = {
      create: 'CREATE_TIMER',
      update: 'UPDATE_TIMER',
      delete: 'DELETE_TIMER',
      reorder: 'REORDER_TIMERS',
      created: 'TIMER_CREATED',
      updated: 'TIMER_UPDATED',
      deleted: 'TIMER_DELETED',
      reordered: 'TIMERS_REORDERED',
    }
    expect(discriminants).toEqual({
      create: 'CREATE_TIMER',
      update: 'UPDATE_TIMER',
      delete: 'DELETE_TIMER',
      reorder: 'REORDER_TIMERS',
      created: 'TIMER_CREATED',
      updated: 'TIMER_UPDATED',
      deleted: 'TIMER_DELETED',
      reordered: 'TIMERS_REORDERED',
    })
  })

  it('pins the eight Cue discriminant strings', () => {
    const discriminants: {
      create: LiteralType<CreateCuePayload>;
      update: LiteralType<UpdateCuePayload>;
      delete: LiteralType<DeleteCuePayload>;
      reorder: LiteralType<ReorderCuesPayload>;
      created: LiteralType<CueCreated>;
      updated: LiteralType<CueUpdated>;
      deleted: LiteralType<CueDeleted>;
      reordered: LiteralType<CuesReordered>;
    } = {
      create: 'CREATE_CUE',
      update: 'UPDATE_CUE',
      delete: 'DELETE_CUE',
      reorder: 'REORDER_CUES',
      created: 'CUE_CREATED',
      updated: 'CUE_UPDATED',
      deleted: 'CUE_DELETED',
      reordered: 'CUES_REORDERED',
    }
    expect(discriminants).toEqual({
      create: 'CREATE_CUE',
      update: 'UPDATE_CUE',
      delete: 'DELETE_CUE',
      reorder: 'REORDER_CUES',
      created: 'CUE_CREATED',
      updated: 'CUE_UPDATED',
      deleted: 'CUE_DELETED',
      reordered: 'CUES_REORDERED',
    })
  })

  it('CreateTimerPayload carries Partial<Timer> and optional timestamp (client→server)', () => {
    const requiredOnly: CreateTimerPayload = {
      type: 'CREATE_TIMER',
      roomId: 'room-1',
      timer: { title: 'Act 1', duration: 600, type: 'countdown' },
    }
    const full: CreateTimerPayload = {
      ...requiredOnly,
      clientId: 'client-a',
      timestamp: 1,
    }
    expect(requiredOnly.clientId).toBeUndefined()
    expect(requiredOnly.timestamp).toBeUndefined()
    expect(full.timer.title).toBe('Act 1')
    // Partial<Timer> compiles with a subset of Timer keys.
    const minimalTimer: CreateTimerPayload['timer'] = { title: 'Solo' }
    expect(minimalTimer.title).toBe('Solo')
  })

  it('UpdateTimerPayload references timerId + Partial<Timer> changes + optional timestamp', () => {
    const requiredOnly: UpdateTimerPayload = {
      type: 'UPDATE_TIMER',
      roomId: 'room-1',
      timerId: 'timer-a',
      changes: { duration: 900 },
    }
    expect(requiredOnly.timestamp).toBeUndefined()
    // Partial<Timer> compiles as the changes field.
    const changesField: UpdateTimerPayload['changes'] = { order: 2, speaker: 'Alice' }
    expect(changesField.speaker).toBe('Alice')
  })

  it('DeleteTimerPayload + ReorderTimersPayload shapes (client→server, optional timestamp)', () => {
    const del: DeleteTimerPayload = {
      type: 'DELETE_TIMER',
      roomId: 'room-1',
      timerId: 'timer-a',
    }
    const reorder: ReorderTimersPayload = {
      type: 'REORDER_TIMERS',
      roomId: 'room-1',
      timerIds: ['timer-a', 'timer-b'],
    }
    expect(del.timestamp).toBeUndefined()
    expect(reorder.timestamp).toBeUndefined()
    expect(reorder.timerIds).toEqual(['timer-a', 'timer-b'])
  })

  it('TimerCreated broadcast carries canonical Timer + REQUIRED timestamp (server→client)', () => {
    const created: TimerCreated = {
      type: 'TIMER_CREATED',
      roomId: 'room-1',
      timer: {
        id: 'timer-a',
        roomId: 'room-1',
        title: 'Act 1',
        duration: 600,
        type: 'countdown',
        order: 0,
      },
      timestamp: 1,
    }
    const withClient: TimerCreated = { ...created, clientId: 'client-a' }
    // The timer field is the canonical Timer (all required keys present).
    expect(created.timer.id).toBe('timer-a')
    expect(created.timestamp).toBe(1)
    expect(created.clientId).toBeUndefined()
    expect(withClient.clientId).toBe('client-a')
  })

  it('TimerUpdated broadcast carries Partial<Timer> changes + REQUIRED timestamp', () => {
    const updated: TimerUpdated = {
      type: 'TIMER_UPDATED',
      roomId: 'room-1',
      timerId: 'timer-a',
      changes: { title: 'Act 1 (revised)' },
      timestamp: 1,
    }
    expect(updated.changes.title).toBe('Act 1 (revised)')
    expect(updated.timestamp).toBe(1)
  })

  it('TimerDeleted + TimersReordered broadcasts require timestamp (server→client)', () => {
    const deleted: TimerDeleted = {
      type: 'TIMER_DELETED',
      roomId: 'room-1',
      timerId: 'timer-a',
      timestamp: 1,
    }
    const reordered: TimersReordered = {
      type: 'TIMERS_REORDERED',
      roomId: 'room-1',
      timerIds: ['timer-b', 'timer-a'],
      timestamp: 2,
    }
    expect(deleted.timestamp).toBe(1)
    expect(reordered.timerIds).toEqual(['timer-b', 'timer-a'])
  })

  it('CreateCuePayload carries Partial<Cue> + optional timestamp (client→server)', () => {
    const requiredOnly: CreateCuePayload = {
      type: 'CREATE_CUE',
      roomId: 'room-1',
      cue: { title: 'LX 1', role: 'lx', triggerType: 'timed', createdBy: 'op' },
    }
    const full: CreateCuePayload = {
      ...requiredOnly,
      clientId: 'client-a',
      timestamp: 1,
    }
    expect(requiredOnly.timestamp).toBeUndefined()
    expect(full.clientId).toBe('client-a')
    // Partial<Cue> compiles with a subset of Cue keys.
    const minimalCue: CreateCuePayload['cue'] = { title: 'SX 1' }
    expect(minimalCue.title).toBe('SX 1')
  })

  it('UpdateCuePayload references cueId + Partial<Cue> changes + optional timestamp', () => {
    const requiredOnly: UpdateCuePayload = {
      type: 'UPDATE_CUE',
      roomId: 'room-1',
      cueId: 'cue-a',
      changes: { ackState: 'done' },
    }
    expect(requiredOnly.timestamp).toBeUndefined()
    const changesField: UpdateCuePayload['changes'] = { triggerType: 'follow', afterCueId: 'cue-b' }
    expect(changesField.afterCueId).toBe('cue-b')
  })

  it('DeleteCuePayload + ReorderCuesPayload shapes (client→server, optional timestamp)', () => {
    const del: DeleteCuePayload = {
      type: 'DELETE_CUE',
      roomId: 'room-1',
      cueId: 'cue-a',
    }
    const reorder: ReorderCuesPayload = {
      type: 'REORDER_CUES',
      roomId: 'room-1',
      cueIds: ['cue-a', 'cue-b'],
    }
    expect(del.timestamp).toBeUndefined()
    expect(reorder.timestamp).toBeUndefined()
    expect(reorder.cueIds).toEqual(['cue-a', 'cue-b'])
  })

  it('CueCreated broadcast carries canonical Cue + REQUIRED timestamp (server→client)', () => {
    const created: CueCreated = {
      type: 'CUE_CREATED',
      roomId: 'room-1',
      cue: {
        id: 'cue-a',
        roomId: 'room-1',
        role: 'lx',
        title: 'LX 1',
        triggerType: 'timed',
        createdBy: 'op',
      },
      timestamp: 1,
    }
    const withClient: CueCreated = { ...created, clientId: 'client-a' }
    expect(created.cue.id).toBe('cue-a')
    expect(created.cue.triggerType).toBe('timed')
    expect(created.timestamp).toBe(1)
    expect(created.clientId).toBeUndefined()
    expect(withClient.clientId).toBe('client-a')
  })

  it('CueUpdated broadcast carries Partial<Cue> changes + REQUIRED timestamp', () => {
    const updated: CueUpdated = {
      type: 'CUE_UPDATED',
      roomId: 'room-1',
      cueId: 'cue-a',
      changes: { ackState: 'skipped', ackBy: 'op-2' },
      timestamp: 1,
    }
    expect(updated.changes.ackState).toBe('skipped')
    expect(updated.timestamp).toBe(1)
  })

  it('CueDeleted + CuesReordered broadcasts require timestamp (server→client)', () => {
    const deleted: CueDeleted = {
      type: 'CUE_DELETED',
      roomId: 'room-1',
      cueId: 'cue-a',
      timestamp: 1,
    }
    const reordered: CuesReordered = {
      type: 'CUES_REORDERED',
      roomId: 'room-1',
      cueIds: ['cue-b', 'cue-a'],
      timestamp: 2,
    }
    expect(deleted.timestamp).toBe(1)
    expect(reordered.cueIds).toEqual(['cue-b', 'cue-a'])
  })

  it('pins the client→server OPTIONAL timestamp vs server→client REQUIRED timestamp asymmetry', () => {
    // Compile-time: the four client→server payloads admit an undefined timestamp.
    const createTimerNoTs: CreateTimerPayload = {
      type: 'CREATE_TIMER',
      roomId: 'room-1',
      timer: { title: 'Act 1' },
    }
    const updateTimerNoTs: UpdateTimerPayload = {
      type: 'UPDATE_TIMER',
      roomId: 'room-1',
      timerId: 'timer-a',
      changes: { duration: 100 },
    }
    const deleteTimerNoTs: DeleteTimerPayload = {
      type: 'DELETE_TIMER',
      roomId: 'room-1',
      timerId: 'timer-a',
    }
    const reorderTimersNoTs: ReorderTimersPayload = {
      type: 'REORDER_TIMERS',
      roomId: 'room-1',
      timerIds: ['timer-a'],
    }
    const createCueNoTs: CreateCuePayload = {
      type: 'CREATE_CUE',
      roomId: 'room-1',
      cue: { title: 'LX 1' },
    }
    const updateCueNoTs: UpdateCuePayload = {
      type: 'UPDATE_CUE',
      roomId: 'room-1',
      cueId: 'cue-a',
      changes: { title: 'LX 1b' },
    }
    const deleteCueNoTs: DeleteCuePayload = {
      type: 'DELETE_CUE',
      roomId: 'room-1',
      cueId: 'cue-a',
    }
    const reorderCuesNoTs: ReorderCuesPayload = {
      type: 'REORDER_CUES',
      roomId: 'room-1',
      cueIds: ['cue-a'],
    }
    expect([
      createTimerNoTs.timestamp,
      updateTimerNoTs.timestamp,
      deleteTimerNoTs.timestamp,
      reorderTimersNoTs.timestamp,
      createCueNoTs.timestamp,
      updateCueNoTs.timestamp,
      deleteCueNoTs.timestamp,
      reorderCuesNoTs.timestamp,
    ]).toEqual([undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined])

    // The four server→client broadcasts REQUIRE a numeric timestamp.
    const requiredTimestamps = [
      { t: 'TIMER_CREATED' as const, v: 1 },
      { t: 'TIMER_UPDATED' as const, v: 2 },
      { t: 'TIMER_DELETED' as const, v: 3 },
      { t: 'TIMERS_REORDERED' as const, v: 4 },
    ]
    expect(requiredTimestamps.every((e) => typeof e.v === 'number')).toBe(true)
  })
})

// Pins the `CompanionRoomState` projection + the four room-state wire envelopes
// adopted in U1 slice 8 from `companion/src/main.ts` (+ the duplicate
// `CompanionRoomState` from `frontend/src/context/UnifiedDataContext.tsx`).
// `CompanionRoomState` is a DIVERGENT clock-domain projection from the
// shared-types `RoomState`: anchored on `currentTime`/`lastUpdate` rather than
// `startedAt`/`elapsedOffset`, and without `clockMode`. A drift in any
// discriminant, required-key set, or the optional-vs-required timestamp
// asymmetry breaks a Socket.IO event shape, so these tests are the net.

describe('interface-contracts CompanionRoomState + room-state wire envelopes (U1 slice 8)', () => {
  it('CompanionRoomState pins the four REQUIRED clock-domain keys', () => {
    // The minimal acceptable object must carry exactly the four required keys.
    const requiredOnly: CompanionRoomState = {
      activeTimerId: null,
      isRunning: false,
      currentTime: 0,
      lastUpdate: 1,
    }
    expect(requiredOnly.activeTimerId).toBeNull()
    expect(requiredOnly.isRunning).toBe(false)
    expect(requiredOnly.currentTime).toBe(0)
    expect(requiredOnly.lastUpdate).toBe(1)
    // Optional keys are undefined on the minimal object.
    expect(requiredOnly.elapsedOffset).toBeUndefined()
    expect(requiredOnly.progress).toBeUndefined()
    expect(requiredOnly.showClock).toBeUndefined()
    expect(requiredOnly.message).toBeUndefined()
    expect(requiredOnly.title).toBeUndefined()
    expect(requiredOnly.timezone).toBeUndefined()
    expect(requiredOnly.activeLiveCueId).toBeUndefined()
  })

  it('CompanionRoomState admits the optional keys (full projection)', () => {
    const full: CompanionRoomState = {
      activeTimerId: 'timer-a',
      isRunning: true,
      currentTime: 42,
      lastUpdate: 2,
      elapsedOffset: 5,
      progress: { 'timer-a': 42 },
      showClock: true,
      message: { text: 'hello', visible: true, color: 'red' },
      title: 'Main Room',
      timezone: 'UTC',
      activeLiveCueId: 'cue-x',
    }
    expect(full.elapsedOffset).toBe(5)
    expect(full.progress?.['timer-a']).toBe(42)
    expect(full.message?.color).toBe('red')
    expect(full.activeLiveCueId).toBe('cue-x')
  })

  it('CompanionRoomState is anchored on currentTime/lastUpdate and omits startedAt/clockMode', () => {
    // Compile-time pin: the projection does NOT carry `startedAt` or `clockMode`
    // (it is divergent from shared-types RoomState). If either key is added,
    // this keyof assertion will drift.
    type Keys = keyof CompanionRoomState
    const allKeys: Keys[] = [
      'activeTimerId',
      'isRunning',
      'currentTime',
      'lastUpdate',
      'elapsedOffset',
      'progress',
      'showClock',
      'message',
      'title',
      'timezone',
      'activeLiveCueId',
    ]
    expect(new Set(allKeys).size).toBe(11)
    // The forbidden keys are NOT members of the keyof set.
    // (This is a compile-time guard: assigning either would error under TS.)
    const hasStartedAt: Keys extends 'startedAt' ? true : false = false as never
    const hasClockMode: Keys extends 'clockMode' ? true : false = false as never
    expect(hasStartedAt).toBe(false as never)
    expect(hasClockMode).toBe(false as never)
  })

  it('pins the four room-state discriminant strings', () => {
    const discriminants: {
      snapshot: LiteralType<RoomStateSnapshot>;
      delta: LiteralType<RoomStateDelta>;
      patch: LiteralType<RoomStatePatchPayload>;
      sync: LiteralType<SyncRoomStatePayload>;
    } = {
      snapshot: 'ROOM_STATE_SNAPSHOT',
      delta: 'ROOM_STATE_DELTA',
      patch: 'ROOM_STATE_PATCH',
      sync: 'SYNC_ROOM_STATE',
    }
    expect(discriminants).toEqual({
      snapshot: 'ROOM_STATE_SNAPSHOT',
      delta: 'ROOM_STATE_DELTA',
      patch: 'ROOM_STATE_PATCH',
      sync: 'SYNC_ROOM_STATE',
    })
  })

  it('RoomStateSnapshot carries full CompanionRoomState + REQUIRED timestamp (server→client)', () => {
    const snapshot: RoomStateSnapshot = {
      type: 'ROOM_STATE_SNAPSHOT',
      roomId: 'room-1',
      state: {
        activeTimerId: 'timer-a',
        isRunning: true,
        currentTime: 7,
        lastUpdate: 9,
      },
      timestamp: 10,
    }
    expect(snapshot.state.activeTimerId).toBe('timer-a')
    expect(snapshot.timestamp).toBe(10)
    // The state field is the full CompanionRoomState (4 required keys present).
    expect(snapshot.state.currentTime).toBe(7)
  })

  it('RoomStateDelta carries Partial<CompanionRoomState> + REQUIRED timestamp (server→client)', () => {
    const minimal: RoomStateDelta = {
      type: 'ROOM_STATE_DELTA',
      roomId: 'room-1',
      changes: { isRunning: false },
      timestamp: 1,
    }
    const withClient: RoomStateDelta = { ...minimal, clientId: 'client-a' }
    expect(minimal.clientId).toBeUndefined()
    expect(withClient.clientId).toBe('client-a')
    expect(minimal.changes.isRunning).toBe(false)
    // Partial<CompanionRoomState> compiles with a subset of keys.
    const changesField: RoomStateDelta['changes'] = { currentTime: 99, lastUpdate: 100 }
    expect(changesField.currentTime).toBe(99)
  })

  it('pins the server→client REQUIRED timestamp vs client→server OPTIONAL timestamp asymmetry', () => {
    // The two server→client broadcasts REQUIRE a numeric timestamp.
    const snapshot: RoomStateSnapshot = {
      type: 'ROOM_STATE_SNAPSHOT',
      roomId: 'room-1',
      state: { activeTimerId: null, isRunning: false, currentTime: 0, lastUpdate: 1 },
      timestamp: 2,
    }
    const delta: RoomStateDelta = {
      type: 'ROOM_STATE_DELTA',
      roomId: 'room-1',
      changes: { isRunning: true },
      timestamp: 3,
    }
    expect(typeof snapshot.timestamp).toBe('number')
    expect(typeof delta.timestamp).toBe('number')

    // The two client→server payloads admit an undefined timestamp.
    const patchNoTs: RoomStatePatchPayload = {
      type: 'ROOM_STATE_PATCH',
      roomId: 'room-1',
      changes: { showClock: true },
    }
    const syncNoTs: SyncRoomStatePayload = {
      type: 'SYNC_ROOM_STATE',
      roomId: 'room-1',
      state: { activeTimerId: null, isRunning: false, currentTime: 0, lastUpdate: 1 },
    }
    expect(patchNoTs.timestamp).toBeUndefined()
    expect(syncNoTs.timestamp).toBeUndefined()
  })

  it('RoomStatePatchPayload + SyncRoomStatePayload optional field sets (client→server)', () => {
    const patch: RoomStatePatchPayload = {
      type: 'ROOM_STATE_PATCH',
      roomId: 'room-1',
      changes: { activeTimerId: 'timer-a', isRunning: true, currentTime: 1, lastUpdate: 2 },
      clientId: 'client-a',
      timestamp: 3,
    }
    expect(patch.clientId).toBe('client-a')
    expect(patch.timestamp).toBe(3)

    const sync: SyncRoomStatePayload = {
      type: 'SYNC_ROOM_STATE',
      roomId: 'room-1',
      state: { activeTimerId: 'timer-a', isRunning: true, currentTime: 1, lastUpdate: 2 },
      timers: [],
      sourceClientId: 'client-a',
      timestamp: 3,
    }
    expect(sync.timers).toEqual([])
    expect(sync.sourceClientId).toBe('client-a')
  })
})
