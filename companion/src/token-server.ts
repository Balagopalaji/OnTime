// rebuild-target: app-internal (apps/local-companion)
//
// Loopback token HTTP handler + IPv4/IPv6 server lifecycle, extracted from
// companion/src/main.ts as rebuild unit U3 (see docs/rebuild-plan.md §4 and
// docs/rebuild-companion-coupling.md Appendix B).
//
// This module owns ONLY the `/api/token` and (optionally) `/api/status-window`
// routes plus the IPv4/IPv6 server lifecycle. It does NOT own the shared auth
// helpers (`isLoopback`, `parseAllowedOrigins`, `validateOrigin`), pairing routes,
// viewer-token store, JOIN_ROOM, room cache, or file routes — those remain in
// main.ts and are passed in via the deps bag. The handler returns `true` when it
// wrote a response so the caller (main.ts) can fall through to file routes and
// the `404 Not found` sentinel exactly as before; the per-route bodies are
// byte-faithful with the pre-carve code.
//
// All injection is mandatory-by-construction: the deps bag is built once in
// main.ts (`buildTokenServerDeps`, wired from hoisted `function` declarations so
// the temporal-dead-zone is avoided — same pattern as `controlAuditDeps` /
// `pendingControlTimeoutDeps`).

import type { Server as HttpServer } from 'node:http';
import type { Server as HttpsServer } from 'node:https';
import type {
  ApiErrorResponse,
  StatusWindowResponse,
  TokenResponse,
} from '@ontime/interface-contracts';

/**
 * Loopback gate. Injected so the shared auth module (which also feeds JOIN_ROOM,
 * pairing, and file routes) stays in main.ts per Appendix B's hard boundary.
 */
export type IsLoopbackFn = (remoteAddress?: string | null) => boolean;

/** Returns the current CORS allow-list (env-overridable + LAN origins). */
export type ParseAllowedOriginsFn = () => string[];

/** Origin allow/normalize check used by every local HTTP route. */
export type ValidateOriginFn = (origin: string | undefined, allowedOrigins: string[]) => boolean;

/** Optional Electron UI hook for `/api/status-window`. When omitted, the route is skipped. */
export type ShowStatusWindowFn = (token: string, expiresAt: number) => void;

/** Headless-mode predicate used by `/api/status-window` to suppress the Electron window. */
export type IsHeadlessModeFn = () => boolean;

/** Factory for `node:http` `createServer` (injected so tests don't bind real ports). */
export type CreateServerFn = (handler: (req: any, res: any) => void) => HttpServer;

/** Factory for `node:https` `createHttpsServer` (injected so tests don't bind real ports). */
export type CreateHttpsServerFn = (
  options: { key: string; cert: string },
  handler: (req: any, res: any) => void,
) => HttpsServer;

/** Log sink for the "listening on …" lines (defaults to console.log). */
export type LogFn = (...args: unknown[]) => void;

/**
 * Deps for {@link createTokenHandler} / {@link startTokenServer} /
 * {@link startSecureTokenServer}. Everything that touches main.ts-owned state or
 * shared helpers is injected; nothing here reaches room/socket/pairing stores.
 */
export type TokenServerDeps = {
  token: string;
  expiresAt: number;
  isLoopback: IsLoopbackFn;
  parseAllowedOrigins: ParseAllowedOriginsFn;
  validateOrigin: ValidateOriginFn;
  /** When set, `/api/status-window` is served; when omitted, the route is skipped. */
  showStatusWindow?: ShowStatusWindowFn;
  /** Required iff `showStatusWindow` is set (matches pre-carve behavior). */
  isHeadlessMode?: IsHeadlessModeFn;
};

/** Deps for the IPv4/IPv6 server lifecycle. */
export type TokenServerLifecycleDeps = {
  createServer: CreateServerFn;
  createHttpsServer: CreateHttpsServerFn;
  log?: LogFn;
};

/** Bound ports + hosts — kept as constants so behavior matches pre-carve code exactly. */
const HTTP_PORT = 4001;
const HTTPS_PORT = 4441;
const HOST_V4 = '127.0.0.1';
const HOST_V6 = '::1';

/**
 * Builds the loopback token HTTP request handler. Byte-faithful with the
 * `/api/token` and `/api/status-window` branches of the original
 * `createTokenHandler` (companion/src/main.ts pre-U3). Returns `true` when a
 * response was written so the main.ts composition root can fall through to file
 * routes and the `404 Not found` sentinel unchanged. All other paths return
 * `false`.
 */
export function createTokenHandler(
  deps: TokenServerDeps,
): (req: any, res: any) => boolean {
  const {
    token,
    expiresAt,
    isLoopback,
    parseAllowedOrigins,
    validateOrigin,
    showStatusWindow,
    isHeadlessMode,
  } = deps;
  return (req: any, res: any): boolean => {
    const allowedOrigins = parseAllowedOrigins();
    const origin = req.headers.origin as string | undefined;
    const remoteAddress = req.socket?.remoteAddress;

    if (typeof req.url === 'string') {
      const url = new URL(req.url, 'http://localhost');

      if (url.pathname === '/api/token') {
        if (!isLoopback(remoteAddress)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          const body: ApiErrorResponse = { error: 'Forbidden' };
          res.end(JSON.stringify(body));
          return true;
        }

        if (!validateOrigin(origin, allowedOrigins)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          const body: ApiErrorResponse = { error: 'Invalid origin' };
          res.end(JSON.stringify(body));
          return true;
        }

        if (req.method === 'OPTIONS') {
          res.writeHead(204, {
            'Access-Control-Allow-Origin': origin ?? allowedOrigins[0],
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-OnTime-Client-Id',
            'Access-Control-Allow-Private-Network': 'true'
          });
          res.end();
          return true;
        }

        if (req.method === 'GET') {
          const returnTo = url.searchParams.get('return');
          const isHttp = (value: string) => value.startsWith('http://') || value.startsWith('https://');
          const safeReturn = returnTo && isHttp(returnTo) ? returnTo : null;
          if (safeReturn) {
            const escapeAttr = (value: string) => value.replace(/"/g, '&quot;');
            const redirectTarget = JSON.stringify(safeReturn);
            const escapedAttr = escapeAttr(safeReturn);
            const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Companion Trust</title>
  <meta http-equiv="refresh" content="0;url=${escapedAttr}">
</head>
<body style="font-family:system-ui;background:#0b1220;color:#e5e7eb;padding:24px;">
  <h1 style="font-size:18px;margin:0 0 12px;">Local Companion trusted</h1>
  <p style="margin:0 0 8px;">We fetched your Companion token on this device.</p>
  <pre style="white-space:pre-wrap;background:#0f172a;border:1px solid #1e293b;padding:12px;border-radius:8px;">${JSON.stringify({ token, expiresAt }, null, 2)}</pre>
  <p style="margin:12px 0 16px;">Redirecting you back to the app… If it doesn’t move, <a href="${escapedAttr}" style="color:#a5b4fc;">click here</a>.</p>
  <script>
    const target = ${redirectTarget};
    function go() {
      try { window.location.replace(target); } catch (err) { window.location.href = target; }
    }
    setTimeout(go, 60);
    setTimeout(() => { try { window.close(); } catch (err) {} }, 1600);
  </script>
</body>
</html>`;
            res.writeHead(200, {
              'Content-Type': 'text/html; charset=utf-8',
              'Access-Control-Allow-Origin': origin ?? allowedOrigins[0],
              'Access-Control-Allow-Private-Network': 'true'
            });
            res.end(html);
            return true;
          }
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': origin ?? allowedOrigins[0],
            'Access-Control-Allow-Private-Network': 'true'
          });
          const body: TokenResponse = { token, expiresAt };
          res.end(JSON.stringify(body));
          return true;
        }
      }

      if (url.pathname === '/api/status-window' && showStatusWindow && isHeadlessMode) {
        if (!isLoopback(remoteAddress)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          const body: ApiErrorResponse = { error: 'Forbidden' };
          res.end(JSON.stringify(body));
          return true;
        }

        if (!validateOrigin(origin, allowedOrigins)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          const body: ApiErrorResponse = { error: 'Invalid origin' };
          res.end(JSON.stringify(body));
          return true;
        }

        if (req.method === 'OPTIONS') {
          res.writeHead(204, {
            'Access-Control-Allow-Origin': origin ?? allowedOrigins[0],
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-OnTime-Client-Id',
            'Access-Control-Allow-Private-Network': 'true'
          });
          res.end();
          return true;
        }

        if (req.method === 'GET') {
          if (!isHeadlessMode()) {
            showStatusWindow(token, expiresAt);
          }
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': origin ?? allowedOrigins[0],
            'Access-Control-Allow-Private-Network': 'true'
          });
          const body: StatusWindowResponse = { success: true, headless: isHeadlessMode() };
          res.end(JSON.stringify(body));
          return true;
        }
      }
    }

    return false;
  };
}

/**
 * Starts the IPv4 + IPv6 loopback HTTP token servers on port 4001. Byte-faithful
 * with the original `startTokenServer` (lifecycle only — the handler is supplied
 * by the caller so main.ts can compose token + file routes). Returns the two
 * handles so the caller can `close()` them on `before-quit` (room/socket stores
 * stay untouched here).
 */
export function startTokenServer(
  handler: (req: any, res: any) => void,
  lifecycle: TokenServerLifecycleDeps,
): { v4: HttpServer; v6: HttpServer } {
  const { createServer, log = console.log } = lifecycle;

  const v4 = createServer(handler);
  const v6 = createServer(handler);

  v4.listen(HTTP_PORT, HOST_V4, () => {
    log(`[http] Token endpoint listening on http://${HOST_V4}:${HTTP_PORT}/api/token`);
  });

  v6.listen({ port: HTTP_PORT, host: HOST_V6, ipv6Only: true }, () => {
    log(`[http] Token endpoint listening on http://[${HOST_V6}]:${HTTP_PORT}/api/token`);
  });

  return { v4, v6 };
}

/**
 * Starts the IPv4 + IPv6 loopback HTTPS token servers on port 4441. Byte-faithful
 * with the original `startSecureTokenServer` (lifecycle only). Returns the two
 * TLS handles.
 */
export function startSecureTokenServer(
  handler: (req: any, res: any) => void,
  lifecycle: TokenServerLifecycleDeps,
  tls: { key: string; cert: string },
): { v4: HttpsServer; v6: HttpsServer } {
  const { createHttpsServer, log = console.log } = lifecycle;
  const v4 = createHttpsServer({ key: tls.key, cert: tls.cert }, handler);
  const v6 = createHttpsServer({ key: tls.key, cert: tls.cert }, handler);

  v4.listen(HTTPS_PORT, HOST_V4, () => {
    log(`[https] Token endpoint listening on https://${HOST_V4}:${HTTPS_PORT}/api/token`);
  });

  v6.listen({ port: HTTPS_PORT, host: HOST_V6, ipv6Only: true }, () => {
    log(`[https] Token endpoint listening on https://[${HOST_V6}]:${HTTPS_PORT}/api/token`);
  });

  return { v4, v6 };
}
