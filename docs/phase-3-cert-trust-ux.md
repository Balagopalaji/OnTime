---
Type: Reference
Status: draft
Owner: KDB
Last updated: 2026-01-19
Scope: Phase 3 LAN viewer HTTPS/WSS trust UX.
---

# Phase 3 Cert Trust UX

## Constraints (from `docs/local-offline-lan-plan.md`)
- HTTPS/WSS required for any LAN client in a browser (mixed content blocked).
- LAN exposure is opt-in and private-subnet only.
- Cert hostname stability required; SANs must match chosen host/IP.

## First-Run UX Requirements
- Reuse the existing Companion controller trust flow (modal + trust page launch); extend it for LAN viewers instead of redesigning.
- Companion UI must surface a simple trust guide for the generated cert.
- Viewer load should detect cert errors and show a friendly "Trust Required" page with steps.
- Provide copy for Windows/macOS trust flows (browser + OS trust store as needed).
- Clarify that viewer-only displays typically have lower trust friction than controller actions.

## Known Limitations
- macOS installable cert works with Safari and Firefox; Chrome-based browsers may still warn.
- Windows (Edge/Chrome): trust flow requires Advanced → Proceed to localhost; no installable cert path confirmed yet.

## Fallbacks
- No HTTP fallback (explicitly disallowed by plan).
- BYO cert support path documented for venues with strict IT policies.

## Decision
- Trust guide location in Companion UI: LAN Viewers panel includes a "Trust Certificate" card with OS/browser-specific steps and a copyable LAN URL.
- Viewer-side trust screen behavior: if HTTPS fails, show a local "Trust Required" page with steps and a retry button; do not offer HTTP fallback.
- BYO cert UX surface: Companion Settings > LAN Viewers > "Use custom certificate" (advanced) with file picker for cert/key and SAN validation feedback.

## Notes
- Keep guidance consistent with PNA/CORS requirements and LAN allowlist enforcement.
- Reuse the existing Companion trust modal + trust-page launch flow; do not redesign. (UI reference: current Companion trust flow screenshots; code can be located by searching for "trust page" or "/companion/trust" in the frontend.)
