/**
 * @module react/mcp-ui/useHostSurfaceTokens
 *
 * The live half of `features/mcp-ui/surfaces/host-theme.ts`: reads the host's resolved `--jini-*`
 * theme where a surface is mounted, and reads it again whenever the theme can have changed, so an
 * accent picked in a host's appearance settings reaches the cards already on screen.
 */
import { useLayoutEffect, useState, type RefObject } from 'react';
import { readHostSurfaceTokens, type HostSurfaceTokens } from '../../features/mcp-ui/surfaces/host-theme.js';

/**
 * The attributes a host switches a theme with: an inline `--jini-theme-*` input (`style`), a theme
 * class, or one of the scheme attributes `variables.css` keys on. Watched on every ancestor, not the
 * whole subtree — a streaming transcript changes attributes constantly, and none of those can move
 * a value this card inherits.
 */
const THEME_ATTRIBUTES = ['style', 'class', 'data-theme', 'data-color-scheme', 'data-admin-theme'];

/**
 * @param ref - The element the surface is mounted in; its computed style is where the host theme is read.
 * @returns The host tokens, or `undefined` until the first read — a caller holds the surface back
 * until then, so a themed card never mounts first in the default palette and then again in the host's.
 */
export function useHostSurfaceTokens(ref: RefObject<HTMLElement | null>): HostSurfaceTokens | undefined {
  const [tokens, setTokens] = useState<HostSurfaceTokens>();
  useLayoutEffect(() => {
    const element = ref.current;
    const view = element?.ownerDocument.defaultView;
    if (element === null || element === undefined || view === null || view === undefined) {
      setTokens({});
      return;
    }
    let last: string | undefined;
    const read = () => {
      const next = readHostSurfaceTokens(view.getComputedStyle(element));
      const key = JSON.stringify(next);
      if (key === last) return;
      last = key;
      setTokens(next);
    };
    read();
    const observer = new view.MutationObserver(read);
    for (let node = element.parentElement; node !== null; node = node.parentElement) {
      observer.observe(node, { attributes: true, attributeFilter: THEME_ATTRIBUTES });
    }
    return () => observer.disconnect();
  }, [ref]);
  return tokens;
}
