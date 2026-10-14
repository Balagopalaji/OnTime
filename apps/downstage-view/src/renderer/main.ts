import type { PreloadApi } from '../shared/ipc-contract.js'
import { mountLauncher } from './launcher.js'

declare global {
  interface Window {
    downstageView?: PreloadApi
  }
}

const root = document.getElementById('app')
if (root && window.downstageView) void mountLauncher(root, window.downstageView)
