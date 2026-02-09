import { evaluateForceTakeoverDecision } from './lock';

const NOW_MS = 1_700_000_000_000;

const assertTrue = (value: boolean, message: string) => {
  if (!value) {
    throw new Error(message);
  }
};

const assertFalse = (value: boolean, message: string) => {
  if (value) {
    throw new Error(message);
  }
};

const run = (name: string, fn: () => void) => {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
};

const baseInput = () => ({
  nowMs: NOW_MS,
  authTime: null as unknown,
  reauthRequired: false,
  pinMatches: false,
  isStale: false,
  request: null as any,
  callerUserId: 'user-a',
  callerClientId: 'client-a',
});

run('fresh auth_time accepted when reauth path is required', () => {
  const input = baseInput();
  input.reauthRequired = true;
  input.authTime = Math.floor(NOW_MS / 1000) - 120;
  const result = evaluateForceTakeoverDecision(input);
  assertTrue(result.authorized, 'expected authorization for fresh auth_time');
  assertTrue(result.reauthVerified, 'expected reauthVerified=true');
});

run('stale auth_time denied', () => {
  const input = baseInput();
  input.reauthRequired = true;
  input.authTime = Math.floor(NOW_MS / 1000) - 301;
  const result = evaluateForceTakeoverDecision(input);
  assertFalse(result.authorized, 'expected authorization denial for stale auth_time');
  assertFalse(result.reauthVerified, 'expected reauthVerified=false');
});

run('missing auth_time denied', () => {
  const input = baseInput();
  input.reauthRequired = true;
  input.authTime = undefined;
  const result = evaluateForceTakeoverDecision(input);
  assertFalse(result.authorized, 'expected denial for missing auth_time');
  assertFalse(result.reauthVerified, 'expected reauthVerified=false');
});

run('non-numeric auth_time denied', () => {
  const input = baseInput();
  input.reauthRequired = true;
  input.authTime = '1700000000';
  const result = evaluateForceTakeoverDecision(input);
  assertFalse(result.authorized, 'expected denial for non-numeric auth_time');
  assertFalse(result.reauthVerified, 'expected reauthVerified=false');
});

run('timeout takeover allowed only for matching requester identity', () => {
  const input = baseInput();
  input.request = {
    status: 'pending',
    requesterId: 'user-a',
    requesterClientId: 'client-a',
    requestedAt: { toMillis: () => NOW_MS - 30_000 },
  };
  const result = evaluateForceTakeoverDecision(input);
  assertTrue(result.requestTimedOut, 'expected requestTimedOut=true for matching requester');
  assertTrue(result.authorized, 'expected authorization via timeout for matching requester');
});

run('timeout takeover denied for non-matching authenticated caller', () => {
  const input = baseInput();
  input.request = {
    status: 'pending',
    requesterId: 'user-b',
    requesterClientId: 'client-b',
    requestedAt: { toMillis: () => NOW_MS - 30_000 },
  };
  const result = evaluateForceTakeoverDecision(input);
  assertFalse(result.requestTimedOut, 'expected requestTimedOut=false for non-matching requester');
  assertFalse(result.authorized, 'expected authorization denial for non-matching requester');
});

run('timeout takeover denied when requesterClientId is missing even if requesterId matches', () => {
  const input = baseInput();
  input.request = {
    status: 'pending',
    requesterId: 'user-a',
    requestedAt: { toMillis: () => NOW_MS - 30_000 },
  };
  const result = evaluateForceTakeoverDecision(input);
  assertFalse(result.requestTimedOut, 'expected requestTimedOut=false without requesterClientId');
  assertFalse(result.authorized, 'expected authorization denial without requesterClientId');
});

run('timeout takeover allowed when requesterClientId matches and requesterId is absent', () => {
  const input = baseInput();
  input.request = {
    status: 'pending',
    requesterClientId: 'client-a',
    requestedAt: { toMillis: () => NOW_MS - 30_000 },
  };
  const result = evaluateForceTakeoverDecision(input);
  assertTrue(result.requestTimedOut, 'expected requestTimedOut=true with matching requesterClientId');
  assertTrue(result.authorized, 'expected authorization with matching requesterClientId');
});

run('PIN path still works', () => {
  const input = baseInput();
  input.pinMatches = true;
  const result = evaluateForceTakeoverDecision(input);
  assertTrue(result.authorized, 'expected authorization via matching PIN');
});

run('stale-lock path still works', () => {
  const input = baseInput();
  input.isStale = true;
  const result = evaluateForceTakeoverDecision(input);
  assertTrue(result.authorized, 'expected authorization via stale-lock fallback');
});
