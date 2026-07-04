import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createTokenHandler,
  startTokenServer,
  startSecureTokenServer,
  type TokenServerDeps,
  type TokenServerLifecycleDeps,
} from './token-server';

// ---------------------------------------------------------------------------
// Fakes that mirror the real main.ts predicates byte-for-byte (the shared auth
// helpers stay in main.ts per Appendix B; the tests inject equivalents so the
// handler's *usage* of the loopback/origin gate is mutation-bitten).
// ---------------------------------------------------------------------------

/** Mirrors main.ts `isLoopback` verbatim. */
function isLoopback(remoteAddress?: string | null): boolean {
  if (!remoteAddress) return false;
  const normalized = remoteAddress.replace(/^::ffff:/, '');
  return normalized === '127.0.0.1' || normalized === '::1' || normalized === '::ffff:127.0.0.1';
}

/** Mirrors main.ts `validateOrigin` for the cases the tests exercise. */
function validateOrigin(origin: string | undefined, allowedOrigins: string[]): boolean {
  if (!origin) return true; // allow CLI tools like curl without Origin
  try {
    const parsed = new URL(origin);
    const protocolOk = parsed.protocol === 'http:' || parsed.protocol === 'https:';
    const hostname = parsed.hostname;
    if (protocolOk && (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1')) {
      return true;
    }
  } catch {
    return false;
  }
  return allowedOrigins.includes(origin);
}

const ALLOWED_ORIGINS = ['https://stagetime.app'];

function makeDeps(overrides: Partial<TokenServerDeps> = {}): TokenServerDeps {
  return {
    token: 'tok-123',
    expiresAt: 9_999,
    isLoopback,
    parseAllowedOrigins: () => ALLOWED_ORIGINS,
    validateOrigin,
    ...overrides,
  };
}

/** Minimal fake IncomingMessage. */
function makeReq(overrides: Partial<{ url: string; method: string; headers: Record<string, string>; remoteAddress: string | null }> = {}) {
  return {
    url: overrides.url ?? '/api/token',
    method: overrides.method ?? 'GET',
    headers: overrides.headers ?? {},
    socket: { remoteAddress: overrides.remoteAddress === undefined ? '127.0.0.1' : overrides.remoteAddress },
  } as any;
}

/** Minimal fake ServerResponse that captures status, headers, and body. */
type CapturedResponse = {
  status: number | null;
  headers: Record<string, string | string[]>;
  body: string;
  ended: boolean;
};
function makeRes(): { res: any; captured: CapturedResponse } {
  const captured: CapturedResponse = { status: null, headers: {}, body: '', ended: false };
  const res: any = {
    writeHead(status: number, headers: Record<string, string | string[]> = {}) {
      captured.status = status;
      Object.assign(captured.headers, headers);
    },
    end(body?: string) {
      if (body !== undefined) captured.body = String(body);
      captured.ended = true;
    },
  };
  return { res, captured };
}

// ---------------------------------------------------------------------------
// createTokenHandler — `/api/token` characterization (Appendix B boundary tests)
// ---------------------------------------------------------------------------

test('createTokenHandler rejects non-loopback remote address on /api/token', () => {
  const handler = createTokenHandler(makeDeps());
  const { res, captured } = makeRes();
  handler(makeReq({ remoteAddress: '203.0.113.5' }), res);
  assert.equal(captured.status, 403);
  assert.deepEqual(JSON.parse(captured.body), { error: 'Forbidden' });
  assert.equal(captured.ended, true);
});

test('createTokenHandler rejects missing remote address on /api/token', () => {
  const handler = createTokenHandler(makeDeps());
  const { res, captured } = makeRes();
  handler(makeReq({ remoteAddress: null }), res);
  assert.equal(captured.status, 403);
  assert.deepEqual(JSON.parse(captured.body), { error: 'Forbidden' });
});

test('createTokenHandler accepts IPv4-mapped loopback (::ffff:127.0.0.1)', () => {
  const handler = createTokenHandler(makeDeps());
  const { res, captured } = makeRes();
  handler(makeReq({ remoteAddress: '::ffff:127.0.0.1' }), res);
  assert.equal(captured.status, 200);
  assert.deepEqual(JSON.parse(captured.body), { token: 'tok-123', expiresAt: 9_999 });
});

test('createTokenHandler rejects invalid origin on /api/token (loopback caller, bad origin)', () => {
  const handler = createTokenHandler(makeDeps());
  const { res, captured } = makeRes();
  handler(makeReq({ headers: { origin: 'https://evil.example' } }), res);
  assert.equal(captured.status, 403);
  assert.deepEqual(JSON.parse(captured.body), { error: 'Invalid origin' });
});

test('createTokenHandler allows missing origin (curl-style) on /api/token', () => {
  const handler = createTokenHandler(makeDeps());
  const { res, captured } = makeRes();
  handler(makeReq({ headers: {} }), res);
  assert.equal(captured.status, 200);
  assert.deepEqual(JSON.parse(captured.body), { token: 'tok-123', expiresAt: 9_999 });
});

test('createTokenHandler allows localhost origin on /api/token', () => {
  const handler = createTokenHandler(makeDeps());
  const { res, captured } = makeRes();
  handler(makeReq({ headers: { origin: 'http://localhost:5173' } }), res);
  assert.equal(captured.status, 200);
  assert.equal(captured.headers['Access-Control-Allow-Origin'], 'http://localhost:5173');
});

test('createTokenHandler allows an explicit allowed origin on /api/token', () => {
  const handler = createTokenHandler(makeDeps());
  const { res, captured } = makeRes();
  handler(makeReq({ headers: { origin: 'https://stagetime.app' } }), res);
  assert.equal(captured.status, 200);
  assert.equal(captured.headers['Access-Control-Allow-Origin'], 'https://stagetime.app');
});

test('createTokenHandler handles OPTIONS /api/token with 204 + CORS preflight headers', () => {
  const handler = createTokenHandler(makeDeps());
  const { res, captured } = makeRes();
  handler(makeReq({ method: 'OPTIONS', headers: { origin: 'http://localhost:5173' } }), res);
  assert.equal(captured.status, 204);
  assert.equal(captured.headers['Access-Control-Allow-Methods'], 'GET, POST, OPTIONS');
  assert.equal(
    captured.headers['Access-Control-Allow-Headers'],
    'Content-Type, Authorization, X-OnTime-Client-Id',
  );
  assert.equal(captured.headers['Access-Control-Allow-Private-Network'], 'true');
  assert.equal(captured.headers['Access-Control-Allow-Origin'], 'http://localhost:5173');
  assert.equal(captured.body, '');
});

test('createTokenHandler returns { token, expiresAt } JSON for valid loopback GET', () => {
  const handler = createTokenHandler(makeDeps({ token: 'abc', expiresAt: 42 }));
  const { res, captured } = makeRes();
  handler(makeReq(), res);
  assert.equal(captured.status, 200);
  assert.equal(captured.headers['Content-Type'], 'application/json');
  assert.equal(captured.headers['Access-Control-Allow-Private-Network'], 'true');
  assert.deepEqual(JSON.parse(captured.body), { token: 'abc', expiresAt: 42 });
});

test('createTokenHandler returns false (no response) for an unhandled path', () => {
  const handler = createTokenHandler(makeDeps());
  const { res, captured } = makeRes();
  const handled = handler(makeReq({ url: '/api/open' }), res);
  assert.equal(handled, false);
  assert.equal(captured.ended, false);
});

test('createTokenHandler returns false when req.url is not a string', () => {
  const handler = createTokenHandler(makeDeps());
  const { res, captured } = makeRes();
  const req = { ...makeReq(), url: undefined as unknown as string };
  const handled = handler(req, res);
  assert.equal(handled, false);
  assert.equal(captured.ended, false);
});

// ---------------------------------------------------------------------------
// createTokenHandler — safe `return=` HTML redirect (Appendix B)
// ---------------------------------------------------------------------------

test('createTokenHandler serves safe HTML redirect for http(s) return= on loopback GET', () => {
  const handler = createTokenHandler(makeDeps({ token: 't', expiresAt: 7 }));
  const { res, captured } = makeRes();
  handler(makeReq({ url: '/api/token?return=https://app.example/cb' }), res);
  assert.equal(captured.status, 200);
  assert.equal(captured.headers['Content-Type'], 'text/html; charset=utf-8');
  // The redirect target is embedded JSON-stringified (safe from attribute breakout).
  assert.match(captured.body, /https:\/\/app\.example\/cb/);
  // Both attribute and inline script embeddings are escaped/clean.
  assert.match(captured.body, /url=https:\/\/app\.example\/cb">/);
  assert.match(captured.body, /const target = "https:\/\/app\.example\/cb";/);
  // The token payload is rendered in the body for the user.
  assert.match(captured.body, /"token": "t"/);
  assert.match(captured.body, /"expiresAt": 7/);
});

test('createTokenHandler ignores non-http return= (no redirect, falls back to JSON)', () => {
  const handler = createTokenHandler(makeDeps({ token: 't', expiresAt: 7 }));
  const { res, captured } = makeRes();
  handler(makeReq({ url: '/api/token?return=javascript:alert(1)' }), res);
  assert.equal(captured.status, 200);
  assert.equal(captured.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(captured.body), { token: 't', expiresAt: 7 });
  // The dangerous scheme MUST NOT appear as a redirect anywhere in the body.
  assert.doesNotMatch(captured.body, /url=javascript:alert\(1\)/);
});

test('createTokenHandler escapes embedded double-quotes in the return= target', () => {
  const handler = createTokenHandler(makeDeps());
  const { res, captured } = makeRes();
  // A quote in the URL query value — the handler must escape it in the attribute.
  handler(makeReq({ url: '/api/token?return=https://app.example/cb%22inject' }), res);
  assert.equal(captured.status, 200);
  // The raw `"` must never reach the meta-refresh attribute unescaped.
  assert.doesNotMatch(captured.body, /url=https:\/\/app\.example\/cb"inject/);
});

// ---------------------------------------------------------------------------
// createTokenHandler — `/api/status-window` (only served when injected)
// ---------------------------------------------------------------------------

test('createTokenHandler skips /api/status-window when showStatusWindow is not injected', () => {
  const handler = createTokenHandler(makeDeps()); // no showStatusWindow
  const { res, captured } = makeRes();
  const handled = handler(makeReq({ url: '/api/status-window' }), res);
  assert.equal(handled, false);
  assert.equal(captured.ended, false);
});

test('createTokenHandler serves /api/status-window when showStatusWindow + isHeadlessMode are injected', () => {
  let shown: { token: string; expiresAt: number } | null = null;
  const handler = createTokenHandler(
    makeDeps({
      showStatusWindow: (token, expiresAt) => {
        shown = { token, expiresAt };
      },
      isHeadlessMode: () => false,
    }),
  );
  const { res, captured } = makeRes();
  handler(makeReq({ url: '/api/status-window' }), res);
  assert.equal(captured.status, 200);
  assert.deepEqual(JSON.parse(captured.body), { success: true, headless: false });
  assert.deepEqual(shown, { token: 'tok-123', expiresAt: 9_999 });
});

test('createTokenHandler suppresses Electron window in headless mode but still returns success', () => {
  let calls = 0;
  const handler = createTokenHandler(
    makeDeps({
      showStatusWindow: () => {
        calls += 1;
      },
      isHeadlessMode: () => true,
    }),
  );
  const { res, captured } = makeRes();
  handler(makeReq({ url: '/api/status-window' }), res);
  assert.equal(captured.status, 200);
  assert.deepEqual(JSON.parse(captured.body), { success: true, headless: true });
  assert.equal(calls, 0);
});

test('createTokenHandler rejects non-loopback on /api/status-window', () => {
  const handler = createTokenHandler(
    makeDeps({ showStatusWindow: () => {}, isHeadlessMode: () => false }),
  );
  const { res, captured } = makeRes();
  handler(makeReq({ url: '/api/status-window', remoteAddress: '8.8.8.8' }), res);
  assert.equal(captured.status, 403);
  assert.deepEqual(JSON.parse(captured.body), { error: 'Forbidden' });
});

// ---------------------------------------------------------------------------
// startTokenServer / startSecureTokenServer — lifecycle (no real ports bound)
// ---------------------------------------------------------------------------

type FakeServer = {
  handler: (req: any, res: any) => void;
  listenCalls: Array<{ port: number; host?: string; options?: Record<string, unknown> }>;
  closed: boolean;
};
function makeFakeServerFactory(captured: FakeServer[]) {
  return (handler: (req: any, res: any) => void): any => {
    const srv: FakeServer = { handler, listenCalls: [], closed: false };
    const api: any = {
      listen(port: number, hostOrCb?: string | (() => void), maybeCb?: () => void) {
        if (typeof hostOrCb === 'function') {
          srv.listenCalls.push({ port });
          hostOrCb();
        } else {
          srv.listenCalls.push({ port, host: hostOrCb as string | undefined });
          maybeCb?.();
        }
      },
      close() {
        srv.closed = true;
      },
    };
    // Support the `listen({ port, host, ipv6Only }, cb)` options-object overload.
    api.listen = (port: any, hostOrCb?: any, maybeCb?: any) => {
      if (typeof port === 'object' && port !== null) {
        srv.listenCalls.push({
          port: port.port,
          host: port.host,
          options: { ipv6Only: port.ipv6Only },
        });
        if (typeof hostOrCb === 'function') hostOrCb();
        return;
      }
      if (typeof hostOrCb === 'function') {
        srv.listenCalls.push({ port });
        hostOrCb();
      } else {
        srv.listenCalls.push({ port, host: hostOrCb as string | undefined });
        maybeCb?.();
      }
    };
    captured.push(srv);
    return api;
  };
}

function makeHttpsFakeServerFactory(captured: FakeServer[]) {
  const base = makeFakeServerFactory(captured);
  return (options: { key: string; cert: string }, handler: (req: any, res: any) => void): any =>
    base(handler);
}

test('startTokenServer starts IPv4 + IPv6 HTTP servers on port 4001 with loopback hosts', () => {
  const httpCaptured: FakeServer[] = [];
  const lifecycle: TokenServerLifecycleDeps = {
    createServer: makeFakeServerFactory(httpCaptured),
    createHttpsServer: makeHttpsFakeServerFactory([]),
    log: () => {},
  };
  const handler = (_req: any, _res: any) => {};
  const handles = startTokenServer(handler, lifecycle);

  assert.equal(httpCaptured.length, 2);
  // Two servers created, both wired with the SAME handler.
  assert.equal(httpCaptured[0].handler, handler);
  assert.equal(httpCaptured[1].handler, handler);

  // IPv4 listen call: (4001, '127.0.0.1', cb).
  const v4Listen = httpCaptured[0].listenCalls[0];
  assert.equal(v4Listen.port, 4001);
  assert.equal(v4Listen.host, '127.0.0.1');

  // IPv6 listen call: ({ port: 4001, host: '::1', ipv6Only: true }, cb).
  const v6Listen = httpCaptured[1].listenCalls[0];
  assert.equal(v6Listen.port, 4001);
  assert.equal(v6Listen.host, '::1');
  assert.equal((v6Listen.options as { ipv6Only: boolean } | undefined)?.ipv6Only, true);

  // Returned handles are the createServer() return values and close without
  // touching any room/socket store (they only call close() on the fake server).
  assert.equal(handles.v4, handles.v4);
  handles.v4.close();
  handles.v6.close();
  assert.equal(httpCaptured[0].closed, true);
  assert.equal(httpCaptured[1].closed, true);
});

test('startSecureTokenServer starts IPv4 + IPv6 HTTPS servers on port 4441 with loopback hosts and tls options', () => {
  const httpsCaptured: FakeServer[] = [];
  const lifecycle: TokenServerLifecycleDeps = {
    createServer: makeFakeServerFactory([]),
    createHttpsServer: makeHttpsFakeServerFactory(httpsCaptured),
    log: () => {},
  };
  const tls = { key: 'k', cert: 'c' };
  const handler = (_req: any, _res: any) => {};
  const handles = startSecureTokenServer(handler, lifecycle, tls);

  assert.equal(httpsCaptured.length, 2);
  const v4Listen = httpsCaptured[0].listenCalls[0];
  assert.equal(v4Listen.port, 4441);
  assert.equal(v4Listen.host, '127.0.0.1');
  const v6Listen = httpsCaptured[1].listenCalls[0];
  assert.equal(v6Listen.port, 4441);
  assert.equal(v6Listen.host, '::1');
  assert.equal((v6Listen.options as { ipv6Only: boolean } | undefined)?.ipv6Only, true);

  // Closing the returned handles does not throw and only touches the fake servers.
  assert.doesNotThrow(() => {
    handles.v4.close();
    handles.v6.close();
  });
  assert.equal(httpsCaptured[0].closed, true);
  assert.equal(httpsCaptured[1].closed, true);
});

test('startTokenServer lifecycle wires the same handler instance into both IPv4/IPv6 servers', () => {
  // Mutation guard: a refactor that accidentally creates two different handler
  // closures (and thus two token values) would slip a runtime divergence past tsc.
  const httpCaptured: FakeServer[] = [];
  const lifecycle: TokenServerLifecycleDeps = {
    createServer: makeFakeServerFactory(httpCaptured),
    createHttpsServer: makeHttpsFakeServerFactory([]),
    log: () => {},
  };
  const handler = (_req: any, _res: any) => {};
  startTokenServer(handler, lifecycle);
  assert.strictEqual(httpCaptured[0].handler, httpCaptured[1].handler);
});
