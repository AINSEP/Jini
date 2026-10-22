/**
 * Per the task brief: "if RenderService genuinely can't be satisfied by
 * Tauri without more work than a spike warrants, implement a
 * clearly-marked NotImplementedError-throwing stub for just that port."
 * That's the case here — Tauri has no equivalent of Electron's
 * `webContents.printToPDF`/`capturePage` reachable from a narrow JS-side
 * spike; a real implementation would mean driving a headless-Chromium (or
 * wry/WebView2-native) rendering pipeline from the Rust side, which is
 * real work belonging to a follow-up task, not this one. This stub proves
 * the port boundary is honest (the type system still requires a
 * `RenderService`) without pretending Tauri rendering exists yet.
 */
import type { RenderService } from '../render-service.js';
import { NotImplementedError } from './not-implemented.js';

export { NotImplementedError };

function notImplemented(method: string): never {
  throw new NotImplementedError({ message: `RenderService.${method} is not implemented by the Tauri adapter — out of scope for the C7 narrow spike (sidecar/window/shutdown/single-instance/shell only)` });
}

export function createTauriRenderService(_requiredArgs: Record<string, never>): RenderService {
  return {
    async renderToPdf() {
      return notImplemented('renderToPdf');
    },
    async capture() {
      return notImplemented('capture');
    },
    async exportArtifact() {
      return notImplemented('exportArtifact');
    },
  };
}
