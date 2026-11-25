import type { AdminSurfaceProtocolKit, AdminSurfaceTheme, AdminSurfaceThemeToken } from "../../react/kit-admin-surfaces.js";

/**
 * @file Reads the host's design tokens for plugin surfaces and watches for a new theme when the
 * person switches light/dark or the host theme. The host supplies which of its own custom properties
 * each shared `--jini-*` token is read from (`sources`) and the protocol's `readAdminSurfaceTheme`,
 * so this module names no host token and imports no plugin library.
 *
 * Why a map: the host draws with its own names, and a host theme may set those without touching the
 * `--jini-*` names, so reading the Jini names alone would give a surface colours the host does not
 * show. Tokens the host has no name for are read under their Jini name.
 */
export interface AdminThemeSources {
  /** The protocol's reader (the kit's `readAdminSurfaceTheme`). */
  readonly readAdminSurfaceTheme: AdminSurfaceProtocolKit["readAdminSurfaceTheme"];
  /** The host custom property each shared token is read from. */
  readonly sources: Readonly<Partial<Record<AdminSurfaceThemeToken, string>>>;
}

/** The host's current tokens (read from `body`, where the host theme's values resolve). @complexity O(t). */
export function readAdminTheme({ readAdminSurfaceTheme, sources }: AdminThemeSources, _optional: Record<string, never> = {}): AdminSurfaceTheme {
  const scheme = getComputedStyle(document.documentElement).colorScheme.includes("dark") ? "dark" : "light";
  return readAdminSurfaceTheme({ style: getComputedStyle(document.body), scheme }, { sources });
}

/**
 * Calls `onChange` with the new tokens after the host's theme attributes, its theme stylesheets or
 * the system colour scheme change (once per frame, and only when a value actually changed).
 * @returns The function that stops watching.
 */
export function watchAdminTheme(required: AdminThemeSources & { readonly onChange: (required: { theme: AdminSurfaceTheme }, optional?: Record<string, never>) => void }, _optional: Record<string, never> = {}): () => void {
  const { readAdminSurfaceTheme, sources } = required;
  let last = JSON.stringify(readAdminTheme({ readAdminSurfaceTheme, sources }));
  let scheduled = 0;
  const check = () => {
    scheduled = 0;
    const theme = readAdminTheme({ readAdminSurfaceTheme, sources });
    const text = JSON.stringify(theme);
    if (text !== last) { last = text; required.onChange({ theme }); }
  };
  const schedule = () => { if (scheduled === 0) scheduled = requestAnimationFrame(check); };
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { attributes: true });
  observer.observe(document.body, { attributes: true });
  observer.observe(document.head, { childList: true });
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", schedule);
  return () => {
    observer.disconnect();
    media.removeEventListener("change", schedule);
    if (scheduled !== 0) cancelAnimationFrame(scheduled);
  };
}
