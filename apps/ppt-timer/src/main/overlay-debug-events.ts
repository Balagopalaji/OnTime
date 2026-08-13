/** Safe, pure decoding of the few own-window messages used by diagnostics. */
import type { AppDiagEvent } from './diagnostics.js'

export const WINDOW_MESSAGE_SPECS = [
  { code: 0x0006, message: 'WM_ACTIVATE' },
  { code: 0x001c, message: 'WM_ACTIVATEAPP' },
  { code: 0x0018, message: 'WM_SHOWWINDOW' },
  { code: 0x0046, message: 'WM_WINDOWPOSCHANGING' },
  { code: 0x0047, message: 'WM_WINDOWPOSCHANGED' },
  { code: 0x007d, message: 'WM_STYLECHANGED' },
] as const

type WindowMessageSpec = typeof WINDOW_MESSAGE_SPECS[number]

/** Read only a scalar low word from Electron's wParam; never retain pointers. */
function wParamLow32(wParam: Uint8Array): number {
  if (wParam.length < 4) return 0
  return (wParam[0] | (wParam[1] << 8) | (wParam[2] << 16) | (wParam[3] << 24)) >>> 0
}

/** Build a compact redacted event; only activation/show derive wParam state. */
export function windowMessageEvent(spec: WindowMessageSpec, wParam: Uint8Array): AppDiagEvent {
  const value = wParamLow32(wParam)
  if (spec.message === 'WM_ACTIVATE') {
    const state = value & 0xffff
    const activation = state === 0 ? 'inactive' : state === 1 ? 'active' : state === 2 ? 'click-active' : 'other'
    return { kind: 'debug_window_message', ...spec, activation }
  }
  if (spec.message === 'WM_ACTIVATEAPP') return { kind: 'debug_window_message', ...spec, appActive: value !== 0 }
  if (spec.message === 'WM_SHOWWINDOW') return { kind: 'debug_window_message', ...spec, shown: value !== 0 }
  return { kind: 'debug_window_message', ...spec }
}
