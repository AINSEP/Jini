/**
 * @file The host's design tokens for plugin surfaces: which `--jini-*` custom properties a host
 * shares with every surface frame, how it reads their current values, and the envelope that sends
 * a change after init.
 *
 * Why: a surface is a sandboxed frame without `allow-same-origin`, so it cannot see the admin's
 * stylesheets, and its CSP allows only its own files. Values posted in a message are the only way
 * its screens can match the admin and follow a light/dark or admin-theme change. The surface client
 * applies them as custom properties on its root (CSSOM, which the CSP allows; never a style
 * attribute or a stylesheet), so a surface writes `var(--jini-primary, <fallback>)` and looks right
 * with or without a host that sends tokens.
 *
 * Values are text a host computed from its own CSS; anything that could fetch (`url(`, `image-set(`)
 * or leave a declaration (`;`, braces) is dropped here and again in the surface client.
 */
import { ADMIN_SURFACE_PROTOCOL, ADMIN_SURFACE_PROTOCOL_VERSION } from './protocol.js';

/** The shared vocabulary: colours, type, radius, spacing, depth and focus. A host may send fewer. */
export const ADMIN_SURFACE_THEME_TOKENS = Object.freeze([
  '--jini-bg', '--jini-surface', '--jini-bg-subtle', '--jini-text', '--jini-text-muted',
  '--jini-border', '--jini-border-strong', '--jini-primary', '--jini-primary-ink', '--jini-link',
  '--jini-danger', '--jini-danger-bg', '--jini-success', '--jini-success-bg', '--jini-warning', '--jini-warning-bg',
  '--jini-font-ui', '--jini-font-mono', '--jini-font-size-xs', '--jini-font-size-sm', '--jini-font-size-base', '--jini-font-size-md',
  '--jini-radius-sm', '--jini-radius', '--jini-radius-md', '--jini-radius-pill',
  '--jini-space-1', '--jini-space-2', '--jini-space-3', '--jini-space-4',
  '--jini-shadow-xs', '--jini-shadow-sm', '--jini-control-bg', '--jini-control-border', '--jini-control-shadow-focus',
  '--jini-overlay-tooltip-bg', '--jini-overlay-tooltip-text', '--jini-overlay-tooltip-border',
] as const);

export type AdminSurfaceThemeToken = (typeof ADMIN_SURFACE_THEME_TOKENS)[number];
export type AdminSurfaceColorScheme = 'light' | 'dark';

/** What a surface receives: the scheme for native controls plus the token values. */
export interface AdminSurfaceTheme {
  readonly scheme: AdminSurfaceColorScheme;
  readonly tokens: Readonly<Partial<Record<AdminSurfaceThemeToken, string>>>;
}

/** Host page -> surface after init, whenever the admin's theme or colour scheme changes. */
export interface AdminSurfaceThemeMessage {
  readonly protocol: typeof ADMIN_SURFACE_PROTOCOL;
  readonly version: typeof ADMIN_SURFACE_PROTOCOL_VERSION;
  readonly kind: 'theme';
  readonly mountId: string;
  readonly theme: AdminSurfaceTheme;
}

const MAX_VALUE_LENGTH = 200;
const UNSAFE_VALUE = /url\(|image\(|image-set\(|[;{}<>\\@]/i;

/** Whether `value` is plain declaration text that cannot fetch anything or end its declaration.
 * @complexity O(n) in the value length. */
export function isSafeAdminSurfaceThemeValue(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_VALUE_LENGTH && !UNSAFE_VALUE.test(value);
}

/**
 * Reads the shared tokens from the host's computed style.
 * @param required.style - Usually `getComputedStyle(element)` for the element the admin theme is on.
 * @param optional.sources - Where to read a token when the host draws with its own name for it
 *   (e.g. `{ '--jini-text': '--fg' }`); unnamed tokens are read under their own name.
 * @returns Only the tokens with a safe, non-empty value.
 * @complexity O(t) tokens.
 */
export function readAdminSurfaceTheme(
  required: { readonly style: { getPropertyValue(name: string): string }; readonly scheme: AdminSurfaceColorScheme },
  optional: { readonly sources?: Readonly<Partial<Record<AdminSurfaceThemeToken, string>>> } = {},
): AdminSurfaceTheme {
  const tokens: Partial<Record<AdminSurfaceThemeToken, string>> = {};
  for (const token of ADMIN_SURFACE_THEME_TOKENS) {
    const value = required.style.getPropertyValue(optional.sources?.[token] ?? token).trim();
    if (isSafeAdminSurfaceThemeValue(value)) tokens[token] = value;
  }
  return { scheme: required.scheme, tokens };
}

/** Builds the envelope that sends a changed theme to one mount's frame.
 * @complexity O(1). */
export function adminSurfaceThemeMessage(required: { readonly mountId: string; readonly theme: AdminSurfaceTheme }, _optional: Record<string, never> = {}): AdminSurfaceThemeMessage {
  return { protocol: ADMIN_SURFACE_PROTOCOL, version: ADMIN_SURFACE_PROTOCOL_VERSION, kind: 'theme', mountId: required.mountId, theme: required.theme };
}
