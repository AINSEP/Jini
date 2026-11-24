import { useFabPosition as usePosition } from "../../../react/kit.js";
export type { FabPositionResult } from "../../../react/kit.js";
/** Must match the FAB CSS; Jini owns fractional persistence and pointer state. */
export const FAB_EDGE_MARGIN = 20;
/**
 * `storageKey` is required and host-supplied: it names the `localStorage` entry that already holds
 * every operator's saved FAB position, so the host keeps passing its existing key unchanged.
 */
export function useFabPosition(options: { dockOpen: boolean; avoidBottomPx: number; avoidRightPx?: number; storageKey: string }) {
 return usePosition({ ...options,
  storage: { getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) },
  viewport: window, pointerEvents: document, edgeMargin: FAB_EDGE_MARGIN, sizePx: 56, dragThresholdPx: 5,
 }, {});
}
