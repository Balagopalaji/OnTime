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

## Open Design Choices
- Build target: reuse existing Vite build with viewer-only flag vs. separate viewer build target.
- Bundle location in Companion: packaged resources path vs. runtime directory.
- Serving mechanism: Express static middleware vs. dedicated route.
- Cache-busting/versioning: content hash filenames vs. query string versioning.

## Decision
- Build target: separate viewer-only build target (Vite) with `VITE_VIEWER_ONLY=true` to strip controller routes/features.
- Bundle location: packaged inside Companion resources under `resources/viewer/` and unpacked to a runtime cache on first launch.
- Serving mechanism: Express static middleware at `/viewer` with a versioned base path.
- Cache-busting: content-hash filenames plus versioned base path (e.g., `/viewer/v{appVersion}/`).

## Notes
- Keep bundle versioning tied to Companion app version for predictable updates.
- Avoid introducing new origins to reduce CORS/PNA complexity.
