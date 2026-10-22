/** SSR-safe detection of Mac/iOS navigator.platform values. */
export function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
}
