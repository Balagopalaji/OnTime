import type { BrowserWindow, Event, Rectangle, WillResizeDetails } from 'electron'

import { centerCardinalEdgeResize } from './window-placement.js'

/**
 * Center Windows single-edge aspect-locked drags while compact. Electron does
 * not emit `will-resize` for the programmatic correction, so this cannot loop.
 */
export function attachCenteredEdgeResize(
  window: BrowserWindow,
  enabled: () => boolean,
): () => void {
  const onWillResize = (event: Event, proposed: Rectangle, details: WillResizeDetails): void => {
    if (!enabled()) return
    const centered = centerCardinalEdgeResize(window.getBounds(), proposed, details.edge)
    if (centered === proposed) return
    event.preventDefault()
    window.setBounds(centered)
  }
  window.on('will-resize', onWillResize)
  return () => window.off('will-resize', onWillResize)
}
