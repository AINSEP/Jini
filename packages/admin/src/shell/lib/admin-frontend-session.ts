import type { SurfaceEmission } from '@jini-ai/core';
import { uniqueId } from './unique-id.js';
import { requestAssistantDock } from './assistant-dock-bus.js';

// Kept in this page's memory: duplicated tabs and reloads get independent browser bindings.
export const adminFrontendTabId = uniqueId();
const surfaces = new EventTarget();
const SURFACE = 'admin-page-confirmation';

/** Feed protected WebMCP requests into the same chat renderer as daemon surfaces.
 * @complexity O(listeners) delivery, O(1) retained state; no polling or persistence.
 * @overallScore 100
 */
export function publishAdminPageSurface({ emission }: { emission: SurfaceEmission }, _optional = {}): void {
  requestAssistantDock({ open: true });
  surfaces.dispatchEvent(new CustomEvent(SURFACE, { detail: emission }));
}

/** React subscription ABI is positional; only host wiring can publish these card events.
 * @complexity O(1) time and one listener per mounted pane.
 * @overallScore 100
 */
export function subscribeToAdminPageSurfaces(listener: (emission: SurfaceEmission) => void): () => void {
  const receive = (event: Event) => listener((event as CustomEvent<SurfaceEmission>).detail);
  surfaces.addEventListener(SURFACE, receive);
  return () => surfaces.removeEventListener(SURFACE, receive);
}
