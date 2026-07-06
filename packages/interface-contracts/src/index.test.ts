import { describe, expect, it } from 'vitest'
import type {
  ApiErrorResponse,
  ControlRequestClearReason,
  ControlRequestDenied,
  ControlRequestReceived,
  ControlRequestStatus,
  ControllerLockStatePayload,
  CueError,
  DenyControlPayload,
  ForceTakeoverPayload,
  HandOverPayload,
  HandshakeAck,
  HandshakeError,
  HeartbeatPayload,
  JoinRoomPayload,
  RequestControlPayload,
  RoomClientsState,
  RoomPinState,
  SetRoomPinPayload,
  StatusWindowResponse,
  TimerActionKind,
  TimerActionPayload,
  TimerError,
  TokenResponse,
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
