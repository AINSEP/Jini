/**
 * @file What `use-template-source.hooks.ts` needs from the outside world, as an interface rather
 * than a direct `fetch` call. Follows the `useX(dependencies)` / `useWiredX()` pair documented in
 * `development/docs/architecture/wired-hooks-convention.md`.
 *
 * Unlike most ports in this app, the real implementation wraps the browser's global `fetch`, not
 * `lib/api`'s `api` client — `TemplateSourceModal`'s template source is served as a static asset
 * under `/theme-assets/{themeId}/{pagesDir}/{templateFilename}` (`theme-static-assets.ts`'s
 * `express.static` mount), outside the JSON API entirely. The seam still matters for the same
 * reason every other port here exists: a test can describe "this template's source is X" (or "this
 * fetch fails with Y") without a real `fetch`/network round trip.
 *
 * Moved here from `features/posts/hooks/post-template-port.hooks.ts` (2026-09-24) once
 * `features/pages`' `PageEditor.tsx` grew the identical "View Template" affordance Posts already
 * had — one shared port both editors depend on, not two independently-named copies that could
 * drift apart. See `use-template-source.hooks.ts`'s own file header for the full history.
 */
export interface TemplateSourcePort {
  /** Fetches the raw template source at `url` (built by `templateAssetUrl` in
   *  `use-template-source.hooks.ts`) as plain text. Rejects on a non-OK HTTP response or a network
   *  failure — the caller (`useTemplateSource`) is what turns that into a describable message. */
  fetchTemplateSource(required: { url: string }): Promise<string>;
}
