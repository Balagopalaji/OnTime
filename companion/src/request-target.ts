// rebuild-target: app-internal (apps/local-companion)
//
// Malformed HTTP request-target handling for the LAN-reachable request listeners.
// `new URL('//', base)` (and a bad percent-escape in the path) throws, which would be an
// uncaught exception in the Node request listener for any LAN peer sending such a target.

/** Parses a request target; null when it is not a well-formed URL path (never throws). */
export function parseRequestUrl(target: unknown): URL | null {
  if (typeof target !== 'string') return null;
  try {
    const url = new URL(target, 'http://localhost');
    decodeURIComponent(url.pathname);
    return url;
  } catch {
    return null;
  }
}

/** Wraps a request listener so a malformed request target is answered 400 before it runs. */
export function rejectMalformedTarget(handler: (req: any, res: any) => void): (req: any, res: any) => void {
  return (req, res) => {
    if (typeof req?.url === 'string' && !parseRequestUrl(req.url)) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: 'Bad Request' }));
      return;
    }
    handler(req, res);
  };
}
