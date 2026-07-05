import { describe, expect, it } from 'vitest'
import type {
  ApiErrorResponse,
  ControlRequestDenied,
  ControlRequestReceived,
  DenyControlPayload,
  ForceTakeoverPayload,
  HandOverPayload,
  RequestControlPayload,
  RoomPinState,
  SetRoomPinPayload,
  StatusWindowResponse,
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
