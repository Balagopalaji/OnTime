---
Type: Reference
Status: draft
Owner: KDB
Last updated: 2026-01-19
Scope: Phase 3 LAN viewer bundle build/serve strategy.
---

# Phase 3 LAN Viewer Bundle Strategy

## Constraints (from `docs/local-offline-lan-plan.md`)
- Viewer bundle must be served from the Companion origin for offline LAN use.
- HTTPS/WSS required for browser LAN clients; no HTTP fallback.
- Token endpoint remains loopback-only; viewer bundle can be public, data is gated by viewer tokens.

## Considered Options
- Build target: reuse existing Vite build with viewer-only flag vs. separate viewer build target.
- Bundle location in Companion: packaged resources path vs. runtime directory.
- Serving mechanism: Express static middleware vs. dedicated route.
- Cache-busting/versioning: content hash filenames vs. query string versioning.

## Decision
- Build target: separate viewer-only build target (Vite) with `VITE_VIEWER_ONLY=true` to strip controller routes/features.
- Bundle location: packaged inside Companion resources under `resources/viewer/` and unpacked to a runtime cache on first launch.
- Serving mechanism: Express static middleware at `/viewer` with a versioned base path.
- Cache-busting: content-hash filenames plus versioned base path (e.g., `/viewer/v{appVersion}/`).

## Build Target
- Add a dedicated viewer build script (e.g., `build:viewer`) that sets `VITE_VIEWER_ONLY=true`.
- Set Vite base to `/viewer/v{appVersion}/` so `index.html` resolves assets correctly.
- Output should include content-hash filenames (standard Vite behavior).

## Packaging + Runtime Cache
- Ship the viewer build output inside the Companion app at `resources/viewer/`.
- On Companion start, unpack to a writable runtime cache (for example `cache/viewer/v{appVersion}/`).
- If the cached version matches `appVersion`, reuse it; otherwise replace it and keep the previous version for one rollback window.

## Serving + Routing
- Serve from Companion origin at `/viewer/v{appVersion}/` using static middleware.
- Ensure `index.html` is served for deep links within the viewer app.
- Do not expose `/api/token` over LAN; viewer data access remains gated by viewer tokens.

## Cache-Busting + Versioning
- Versioned base path is the primary cache-buster (`/viewer/v{appVersion}/`).
- Content-hash filenames ensure browser caches invalidate on new builds.
- Keep the previous cached version for one rollback window; remove older versions after a successful unpack.

## Notes
- Keep bundle versioning tied to Companion app version for predictable updates.
- Avoid introducing new origins to reduce CORS/PNA complexity.
