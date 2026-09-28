/**
 * Compact PowerPoint panel over the shared source-neutral timer face
 * (`@ontime/timer-face`, ISSUE-002 S4b). This module only adapts the local
 * {@link RenderModel}; markup, fit sizing, and styling live in the package.
 * Electron window controls, IPC, probing, and networking stay in their host
 * adapters.
 */
import { renderDisclosureList, renderTimerFace, setTimerText, timerFitWidthCqw } from '@ontime/timer-face'
import { toDisclosureRow, toDisplayModel, type RenderModel, type VideoRowModel } from './view.js'

export { setTimerText, timerFitWidthCqw }

/** Render the always-visible focused timer surface. */
export function renderPowerPointPanel(model: RenderModel): HTMLElement {
  return renderTimerFace(toDisplayModel(model))
}

/** Render drawer-only video rows; callers decide which rows are secondary. */
export function renderVideoList(rows: VideoRowModel[]): HTMLElement | null {
  return renderDisclosureList(rows.map(toDisclosureRow))
}
