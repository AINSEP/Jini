import { useState } from 'react';

/**
 * @file The line-wrap toggle for read-only code viewers. A caller keyed by the file it shows
 * remounts on a file switch, so the toggle resets to wrapped instead of carrying a manual override
 * across files.
 */

export interface CodeWrapController {
  /** `true` by default: long lines stay readable without horizontal scrolling. */
  wrap: boolean;
  toggleWrap: () => void;
}

/**
 * @returns Whether the shown code wraps, and a toggle.
 * @complexity O(1).
 */
export function useCodeWrap(): CodeWrapController {
  const [wrap, setWrap] = useState(true);
  return { wrap, toggleWrap: () => setWrap((prev) => !prev) };
}
