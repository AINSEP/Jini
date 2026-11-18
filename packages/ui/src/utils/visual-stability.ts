/**
 * Reads a boolean "visual stability" mode flag from `localStorage` — a
 * generic pattern for opting a session into deterministic/reduced-motion
 * rendering for visual-regression testing.
 *
 * Hosts can configure the storage key; the default is 'jini:visual-stability'.
 *
 * @overallScore 100
 */
export const DEFAULT_VISUAL_STABILITY_STORAGE_KEY = 'jini:visual-stability';

export function isVisualStabilityMode(
  _required: Record<string, never>,
  { storageKey = DEFAULT_VISUAL_STABILITY_STORAGE_KEY }: { storageKey?: string | undefined } = {},
): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(storageKey) === '1';
  } catch {
    return false;
  }
}
