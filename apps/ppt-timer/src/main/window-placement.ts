/**
 * Pure window/display placement (ISSUE-001 H5, S-018/S-020/S-022). No Electron
 * import: the main process maps Electron `screen` displays into
 * {@link DisplaySnapshot} and passes them here. All geometry is deterministic
 * and unit-tested without a window manager.
 *
 * Rules (plan §8 Window and settings):
 * - A saved window is substantially visible when an >=80x60 area intersects a
 *   current display work area; valid bounds are kept (clamped into that area).
 * - Off-screen / removed-display / DPI-changed bounds recenter onto the saved
 *   display if still present, otherwise the primary display.
 * - Dimensions clamp to the work area and enforce the compact minimum where the
 *   work area permits; presets preserve the current center.
 */
import { COMPACT_WINDOW_SIZE, MIN_WINDOW_SIZE, PRESET_SIZES, type WindowBounds } from './settings-schema.js'
import type { PanelMode, SizePreset } from '../shared/ipc-contract.js'

export type Rectangle = { x: number; y: number; width: number; height: number }
export type DisplaySnapshot = { id: string; label: string; workArea: Rectangle }

export const VISIBILITY_THRESHOLD = 80 * 60
export const PANEL_ROW_HEIGHT = 28
export const PANEL_NAV_HEIGHT = 22
export const PANEL_OPTIONS_HEIGHT = 28
export const PANEL_TRAY_PADDING = 8
export const PANEL_OPTIONS_GAP = 2

export function intersectArea(a: Rectangle, b: Rectangle): number {
  const xOverlap = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  const yOverlap = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  return xOverlap * yOverlap
}

export function isSubstantiallyVisible(bounds: Rectangle, workArea: Rectangle): boolean {
  return intersectArea(bounds, workArea) >= VISIBILITY_THRESHOLD
}

export function clampIntoWorkArea(bounds: Rectangle, workArea: Rectangle, minSize = MIN_WINDOW_SIZE): Rectangle {
  const minWidth = Math.min(minSize.width, workArea.width)
  const minHeight = Math.min(minSize.height, workArea.height)
  const width = Math.max(minWidth, Math.min(bounds.width, workArea.width))
  const height = Math.max(minHeight, Math.min(bounds.height, workArea.height))
  const maxX = workArea.x + workArea.width - width
  const maxY = workArea.y + workArea.height - height
  const x = Math.max(workArea.x, Math.min(bounds.x, maxX))
  const y = Math.max(workArea.y, Math.min(bounds.y, maxY))
  return { x, y, width, height }
}

export function centerOf(bounds: Rectangle): { x: number; y: number } {
  return { x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2) }
}

export function centerBounds(
  centerX: number,
  centerY: number,
  size: { width: number; height: number },
  workArea: Rectangle,
  minSize = MIN_WINDOW_SIZE,
): Rectangle {
  return clampIntoWorkArea(
    { x: Math.round(centerX - size.width / 2), y: Math.round(centerY - size.height / 2), width: size.width, height: size.height },
    workArea,
    minSize,
  )
}

export function findDisplay(id: string | null, displays: DisplaySnapshot[]): DisplaySnapshot | undefined {
  if (!id) return undefined
  return displays.find((display) => display.id === id)
}

/**
 * S-022 restore. Keeps saved bounds when they are substantially visible on any
 * current display; otherwise recenters onto the saved display if still present,
 * or the primary display. Falls back to the compact preset size when no saved
 * bounds exist.
 */
export function restoreBounds(params: {
  saved: WindowBounds | null
  savedDisplayId: string | null
  displays: DisplaySnapshot[]
  primary: DisplaySnapshot
}): Rectangle {
  const { saved, savedDisplayId, displays, primary } = params
  if (saved) {
    const visibleOn = displays.find((display) => isSubstantiallyVisible(saved, display.workArea))
    if (visibleOn) return clampIntoWorkArea(saved, visibleOn.workArea)
  }
  const target = findDisplay(savedDisplayId, displays) ?? primary
  const size = saved ? { width: saved.width, height: saved.height } : PRESET_SIZES.compact
  const center = centerOf(target.workArea)
  return centerBounds(center.x, center.y, size, target.workArea)
}

/** S-020 "Move to display": recenter on the target work area, keeping size. */
export function moveToDisplay(target: DisplaySnapshot, size: { width: number; height: number }): Rectangle {
  const center = centerOf(target.workArea)
  return centerBounds(center.x, center.y, size, target.workArea)
}

/** S-018 preset: preserve the current center, apply the preset size, then clamp. */
export function applyPreset(currentBounds: Rectangle, preset: Exclude<SizePreset, 'custom'>, workArea: Rectangle): Rectangle {
  const center = centerOf(currentBounds)
  return centerBounds(center.x, center.y, PRESET_SIZES[preset], workArea)
}

/**
 * Derive the trusted open-window size from the exact closed shell, mode, and
 * every video row. Opening the tray adds height only: it never changes the
 * user's timer width or timer-surface height. The final work-area clamp handles
 * surfaces wider or taller than the screen.
 */
export function panelSize(
  mode: Exclude<PanelMode, 'closed'>,
  totalVideoCount: number,
  collapsedWidth: number = COMPACT_WINDOW_SIZE.width,
  collapsedHeight: number = COMPACT_WINDOW_SIZE.height,
): { width: number; height: number } {
  const rows = Math.max(0, Math.trunc(totalVideoCount))
  const optionsHeight = mode === 'options' ? PANEL_OPTIONS_GAP + PANEL_OPTIONS_HEIGHT : 0
  return {
    width: collapsedWidth,
    height:
      collapsedHeight +
      PANEL_TRAY_PADDING +
      (rows * PANEL_ROW_HEIGHT) +
      PANEL_NAV_HEIGHT +
      optionsHeight,
  }
}

/** Opens a trusted, content-sized tray, growing down where possible and up near the work-area edge. */
export function expandPanelBounds(
  currentBounds: Rectangle,
  workArea: Rectangle,
  mode: Exclude<PanelMode, 'closed'>,
  totalVideoCount: number,
): Rectangle {
  const size = panelSize(mode, totalVideoCount, currentBounds.width, currentBounds.height)
  const workBottom = workArea.y + workArea.height
  const canExpandDown = currentBounds.y + size.height <= workBottom
  const y = canExpandDown
    ? currentBounds.y
    : Math.max(workArea.y, currentBounds.y + currentBounds.height - size.height)

  return clampIntoWorkArea(
    { x: currentBounds.x, y, ...size },
    workArea,
  )
}

/**
 * Preserve a user's drag while the tray is open. Programmatic upward expansion
 * is not a drag: when the live panel still matches the last requested panel
 * origin, the original compact anchor remains authoritative.
 */
export function reanchorCompactBounds(
  savedCompactBounds: Rectangle,
  currentPanelBounds: Rectangle,
  lastProgrammaticPanelBounds: Rectangle | null,
): Rectangle {
  if (
    lastProgrammaticPanelBounds !== null &&
    currentPanelBounds.x === lastProgrammaticPanelBounds.x &&
    currentPanelBounds.y === lastProgrammaticPanelBounds.y
  ) {
    return savedCompactBounds
  }
  return { ...savedCompactBounds, x: currentPanelBounds.x, y: currentPanelBounds.y }
}

/**
 * Closes the details drawer to the exact captured collapsed geometry, including
 * an intentional custom size. Only a changed display work area may clamp it.
 */
export function restoreCompactBounds(savedCompactBounds: Rectangle, workArea: Rectangle): Rectangle {
  return clampIntoWorkArea(savedCompactBounds, workArea)
}
