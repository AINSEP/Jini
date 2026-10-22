/**
 * @module react/mcp-ui/mcp-ui-host-frame
 *
 * Pure decisions behind `McpUiHost.tsx`'s chrome — which document a View is handed, which session
 * key it runs under, and how tall its frame is — kept out of the component so each rule is one
 * small, directly testable function. No protocol or sandbox decision lives here.
 */
import { applyHostSurfaceTokens, type HostSurfaceTokens } from '../../features/mcp-ui/surfaces/host-theme.js';

const DEFAULT_INITIAL_HEIGHT = 220;
const DEFAULT_MAX_HEIGHT = 720;

/** The document a View is mounted with, and the session key that remounts it when it changes. */
export interface ThemedViewSession {
  readonly html: string;
  readonly sessionKey: string;
}

/**
 * Writes the host's live theme into a Jini-built surface document and derives the session key.
 *
 * @param input - The caller's document, its optional session key, and the host's tokens
 *   (`undefined` until the wrapper has been measured).
 * @returns The document to mount and the key to mount it under.
 */
export function resolveThemedViewSession(input: {
  readonly html: string;
  readonly sessionKey: string | number | undefined;
  readonly hostTokens: HostSurfaceTokens | undefined;
}): ThemedViewSession {
  const { hostTokens } = input;
  const html = hostTokens === undefined ? input.html : applyHostSurfaceTokens(input.html, hostTokens);
  // Only a document the theme actually changed takes the theme into its key, so a third-party View
  // (left untouched) never remounts when the host's theme moves.
  const sessionKey = `${String(input.sessionKey ?? input.html)}${html === input.html ? '' : JSON.stringify(hostTokens)}`;
  return { html, sessionKey };
}

/**
 * The frame height: the View's reported height (clamped to `[1, maxHeight]`) while following it,
 * otherwise the fixed initial height.
 *
 * @param input - The height the View last reported, if any.
 * @param options - `initialHeight` (default 220), `autoResize` (default `true`), `maxHeight` (default 720).
 * @returns The frame height in pixels.
 */
export function resolveFrameHeight(
  input: { readonly reported: number | undefined },
  options: { readonly initialHeight?: number; readonly autoResize?: boolean; readonly maxHeight?: number | undefined } = {},
): number {
  const { initialHeight = DEFAULT_INITIAL_HEIGHT, autoResize = true, maxHeight = DEFAULT_MAX_HEIGHT } = options;
  const { reported } = input;
  return autoResize && reported !== undefined ? Math.min(Math.max(reported, 1), maxHeight) : initialHeight;
}
