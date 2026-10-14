/**
 * The whole renderer-to-main surface of Downstage View. It exists only so the
 * local launcher page can hand a pasted link to the main process, which
 * validates it. There is deliberately no channel for timer, slide, media, file,
 * clipboard, shell, or any other action: the viewer has no control authority.
 */
import type { ViewerLinkRejection } from './viewer-link.js'

export const IPC_CHANNELS = {
  openLink: 'downstage-view:open-link',
  getLauncherInfo: 'downstage-view:get-launcher-info',
} as const

export type OpenLinkFailure = ViewerLinkRejection | 'malformed' | 'not-configured' | 'load-failed' | 'untrusted-sender'
export type OpenLinkResult = { ok: true } | { ok: false; code: OpenLinkFailure }

/** Non-secret launcher info: the configured viewer origin, or null when unconfigured. */
export type LauncherInfo = { webOrigin: string | null }

export interface PreloadApi {
  openLink(text: string): Promise<OpenLinkResult>
  getLauncherInfo(): Promise<LauncherInfo>
}

/** Longest link text the launcher may submit (a viewer URL is well under 400 characters). */
export const MAX_LINK_TEXT_LENGTH = 2048
