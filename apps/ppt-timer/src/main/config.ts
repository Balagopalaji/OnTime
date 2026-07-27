// The single build-time OnTime website URL for the upsell link (S-033). Empty
// by default -> the CTA stays hidden/disabled until a canonical URL is chosen
// (spec OQ-1). Do NOT hardcode a placeholder or wildcard destination; H6/installer
// wiring may populate this constant for a release.
export const UPSELL_URL_CONSTANT = ''

// Application + canonical-capability versions surfaced in diagnostics (S-026).
export const APP_VERSION = '0.0.0-beta'
export const HELPER_VERSION = 'ppt-probe/native'
