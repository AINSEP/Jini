/**
 * @file Per-request render-theme override for one app instance (2026-10-08): an app built with
 * `createApp(deps, { themeIdOverride })` — only ever `RouteDeps.createSiteApp({ themeId })`'s
 * throwaway loopback app for `web_screenshot_page` — stamps that id on every request it serves, and
 * the site's page routes render through it instead of the stored active theme. Lets the agent SEE a
 * theme copy before the owner approves activating it.
 *
 * The enabled platform preview switcher also uses this request-local seam after checking its
 * workspace roster. Neither source changes the stored active theme.
 *
 * Framework-neutral: every function works over a {@link RequestLocalStore} (an Express `Response`
 * satisfies it structurally); the host keeps the `app.use` glue that stamps it.
 */

/** The request-local bag the override lives in (the host's per-response `locals`). */
export interface RequestLocalStore {
  readonly locals?: Record<string, unknown>;
}

/** Request-local, never a write to the presentation repository. */
const LOCAL_KEY = "renderThemeIdOverride";

/** Bind a validated preview choice to the existing renderer. */
export function setRequestRenderTheme(
  required: { response: { readonly locals: Record<string, unknown> }; themeId: string },
  _optional: Record<string, never> = {},
): void {
  required.response.locals[LOCAL_KEY] = required.themeId;
}

/**
 * True when this request carries a render-theme override (preview switcher or `themeId` loopback
 * app). Truthiness, not `typeof`: an empty-string override reads as "none" here while
 * {@link resolveRenderThemeId} still honours it — kept exactly as the consent middleware read it.
 */
export function hasRequestRenderTheme(required: { response: RequestLocalStore | undefined }, _optional: Record<string, never> = {}): boolean {
  return Boolean(required.response?.locals?.[LOCAL_KEY]);
}

/**
 * The theme id this request renders with: the app's override when it has one, else the workspace's
 * stored active theme, read through the injected `resolveStoredThemeId` (the host binds
 * `resolveActiveThemeId`, which carries its own "no settings row yet" fallback; this module sits in a
 * different domain from the presentation layer so it receives the reader instead of importing it).
 * @complexity O(1) plus one settings read when there is no override.
 */
export function resolveRenderThemeId(
  required: { response: RequestLocalStore; resolveStoredThemeId: () => Promise<string> },
  _optional: Record<string, never> = {},
): Promise<string> {
  const override = required.response.locals?.[LOCAL_KEY];
  return typeof override === "string" ? Promise.resolve(override) : required.resolveStoredThemeId();
}
