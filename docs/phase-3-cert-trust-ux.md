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

## First-Run Flow (Operator)
1) Enable LAN viewers (opt-in) and select the LAN host/IP; SANs must match the chosen host/IP.
2) Generate or refresh the self-signed cert (default path) or choose BYO cert (advanced).
3) Launch the existing Companion trust page for controller trust; reuse the same flow for LAN viewers.
4) Copy the LAN viewer URL (host/IP + port + `/viewer/...`) and share via QR/manual entry.
5) If trust fails, re-check SANs and regenerate cert; do not switch to HTTP.

## Viewer Trust Flow
- First load hits the browser TLS warning (self-signed cert); user must proceed to continue.
- The "Trust Required" screen is shown after the user proceeds past the browser warning.
- Once trusted, Reload/Retry returns to the viewer UI without changing the URL.

## Operator Guidance Copy (Summary)
- macOS: add cert to Keychain and mark as "Always Trust"; Safari/Firefox accept; Chrome may still warn.
- Windows: Edge/Chrome require Advanced → Proceed anyway for self-signed; installable cert path is unconfirmed.
- Recommend viewer-only Electron app where available to avoid browser trust friction.

## Known Limitations
- macOS installable cert works with Safari and Firefox; Chrome-based browsers may still warn.
- Windows (Edge/Chrome): trust flow requires Advanced → Proceed anyway for the chosen host/IP; no installable cert path confirmed yet.

## Fallbacks
- No HTTP fallback (explicitly disallowed by plan).
- BYO cert support path documented for venues with strict IT policies.

## BYO Cert Renewal Guidance
- Replace both cert and key files together; keep paths stable so Companion can reload them on restart.
- Ensure the renewed cert SANs include `localhost` and the selected LAN host/IP entries; otherwise viewers will fail TLS checks.
- Restart Companion after updating files so HTTPS/WSS picks up the new cert.
- Renew before expiry (recommend 30+ days) to avoid viewer interruptions mid-show.

## BYO Cert Operational Notes (Current)
- Companion reads custom certs from settings (`tlsMode: "custom"`, `tlsCertPath`, `tlsKeyPath`) or env (`COMPANION_TLS_CERT`, `COMPANION_TLS_KEY`). Env vars take precedence if both are set.
- Invalid certs (missing SANs, mismatched key) fall back to the generated self-signed cert with a warning.

## Decision
- Trust guide location in Companion UI: LAN Viewers panel includes a "Trust Certificate" card with OS/browser-specific steps and a copyable LAN URL.
- Viewer-side trust screen behavior: if HTTPS fails, show a local "Trust Required" page with steps and a retry button; do not offer HTTP fallback.
- BYO cert UX surface: Companion Settings > LAN Viewers > "Use custom certificate" (advanced) with file picker for cert/key and SAN validation feedback.

## Notes
- Keep guidance consistent with PNA/CORS requirements and LAN allowlist enforcement.
- Reuse the existing Companion trust modal + trust-page launch flow; do not redesign. (UI reference: current Companion trust flow screenshots; code can be located by searching for "trust page" or "/companion/trust" in the frontend.)
