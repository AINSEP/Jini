/**
 * @file What `use-theme-canvas-styling.hooks.ts` needs from the outside world, as an interface rather
 * than a direct `fetch` call. Follows the `useX(dependencies)` / `useWiredX()` pair documented in
 * `development/docs/architecture/wired-hooks-convention.md`.
 *
 * Like `apps/admin/src/components/TemplateSource/template-source-port.hooks.ts` — and unlike most ports in this app — the real
 * implementation wraps the browser's global `fetch`, not `lib/api`'s `api` client: a theme's token
 * files are served as static assets under `/theme-assets/{themeId}/tokens.json`
 * (`theme-static-assets.ts`'s `express.static` mount, proxied through Vite in dev by
 * `apps/admin/vite.config.ts`), outside the JSON API entirely.
 */

/** One theme's design tokens exactly as `tokens.json` stores them: CSS custom property names
 *  (`--bg`, `--font-body`, …) mapped to their values. The key IS the property name — that is the
 *  theme contract every emitter relies on (`features/theme/static-render.ts`'s `tokensToRootCss`
 *  server-side, each theme's own `build-preview.mjs` at authoring time). */
export type ThemeTokens = Record<string, string>;

export interface ThemeCanvasPort {
  /** Fetches and parses the token map at `url` (built by `themeTokensUrl` in
   *  `use-theme-canvas-styling.hooks.ts`). Rejects on a non-OK HTTP response, a network failure, or
   *  unparseable JSON — the caller is what decides whether that is fatal (the theme's own
   *  `tokens.json`) or ignorable (the optional `tokens.light.json`). */
  fetchThemeTokens(required: { url: string }): Promise<ThemeTokens>;
  /** Fetches the raw HTML text at `url` (built by `templateMarkupUrl` in
   *  `use-theme-canvas-styling.hooks.ts`) — a theme template's own source, marker still present and
   *  unresolved. Rejects on a non-OK HTTP response or a network failure; the caller
   *  (`use-theme-canvas-styling.hooks.ts`) treats any rejection as "no wrapper for this canvas",
   *  never as fatal — a template a canvas can't derive a wrapper from is the pre-existing, fully
   *  working "no wrapper" behavior, not a load failure. */
  fetchTemplateMarkup(required: { url: string }): Promise<string>;
  /**
   * Best-effort request for `url` (built by `themeStylesheetUrl`) that exists ONLY to populate the
   * browser's HTTP cache before `@jini-ai/ui`'s `InteractiveHtmlEditor` links the same URL into its
   * GrapesJS canvas (Bug B, Slice B1, this repo's `pages-redo` plan — every Interactive mount re-links
   * that stylesheet fresh, and it is served `cache-control: public, max-age=0`, so each mount
   * revalidates through the dev proxy to the API). Its resolution value is never read and a rejection
   * must never fail canvas styling as a whole — the real port swallows every failure internally, and
   * the caller (`use-theme-canvas-styling.hooks.ts`) also guards the call, belt-and-braces, in case a
   * future port implementation forgets to.
   */
  warmStylesheet(required: { url: string }): Promise<void>;
}
