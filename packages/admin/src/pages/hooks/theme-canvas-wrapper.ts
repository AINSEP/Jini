import type { CanvasContentWrapperNode } from "../../react/kit.js";

/**
 * @file Derives the Interactive tab's canvas wrapper from a theme TEMPLATE's own raw markup — the
 * real ancestor chain a static theme wraps its `{"type":"content"}` marker in — instead of a
 * hardcoded class list. Themes are copied per-site and may come from third parties (see
 * `use-theme-canvas-styling.hooks.ts`'s own file header for the same "not fully trusted input"
 * framing), so a fixed `"post-detail wrap"` string would silently rot the moment a different theme,
 * or a future edit to this one, used a different wrapper.
 *
 * **The marker element itself survives as the innermost wrapper level, not just its ancestors.**
 * Confirmed live against the running dev server (`curl localhost:3000/contact`): `basic`'s
 * `render/pages/pages-default.html` (`page-shell.html` before the 2026-09-03 posts-* / pages-* rename)
 * marks its content with
 * `<div data-embed-config='{"type":"content"}'></div>`, and the PUBLISHED page renders that as a bare
 * `<div>` (attribute stripped, tag kept) directly around the page's real body HTML — matching
 * `Jini packages/cms/src/widgets/markers/marker.ts`'s `withInnerContentFinal`, which the server's `content`-marker splice
 * uses (`apps/website/src/server/inbound/public-http/routes/site/pages.ts`): "strips the marker's own `data-embed-config` attribute...
 * every other authored attribute survives". A derivation that stopped at the marker's PARENT (i.e.
 * treated the marker as pure scaffolding to be discarded) would silently drop that innermost level and
 * under-wrap the canvas relative to the real page.
 *
 * PURE — parses a string, returns a plain data structure. No fetch, no DOM mutation. The caller
 * (`use-theme-canvas-styling.hooks.ts`) owns fetching the template's markup and feeding it in; the
 * canvas package (`@jini-ai/ui/html-editor`'s `applyCanvasContentWrapper`) owns applying the result to
 * a live canvas. This module only answers "what does this template's own markup say the wrapper is".
 */

/**
 * `data-embed-config` values this module recognizes as THE content marker — mirrors
 * `Jini packages/cms/src/widgets/markers/marker.ts`'s own parse rules (valid JSON, a plain object, `type` present) so a
 * template that fails those same checks is treated the same way the server's marker scanner treats
 * it: not a usable marker, not a hard error. Re-implemented rather than imported because that module
 * is server/Node-only `core/` code (regex-based, source-offset-preserving) — this runs in the browser
 * against an already-parsed DOM and only needs the one predicate, not source-offset substitution.
 */
function isContentMarker(el: Element): boolean {
  // Only ever called on `querySelectorAll("[data-embed-config]")` matches (see
  // `deriveContentWrapperChain`), so the attribute is always present: no `null` check needed.
  const raw = el.getAttribute("data-embed-config") as string;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return false;
  return (parsed as Record<string, unknown>).type === "content";
}

/** Every attribute on `el`, as a plain object — `dropEmbedConfig: true` drops `data-embed-config`
 *  itself (the marker level only; every other level keeps every attribute untouched), matching what
 *  the real render pipeline leaves behind (see this file's header). */
function attributesOf(el: Element, options: { dropEmbedConfig: boolean }): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const attr of Array.from(el.attributes)) {
    if (options.dropEmbedConfig && attr.name === "data-embed-config") continue;
    attrs[attr.name] = attr.value;
  }
  return attrs;
}

/**
 * Finds the template's `{"type":"content"}` marker and walks UP from it (inclusive of the marker
 * itself) to, but not including, `<body>`, returning each level outermost-first — the exact shape
 * `@jini-ai/ui/html-editor`'s `applyCanvasContentWrapper` expects for `CanvasStyling.contentWrapper`.
 *
 * @param required.templateHtml - A theme template's raw HTML source, exactly as served from
 *   `/theme-assets/{themeId}/{pagesDir}/{templateChoice}` (see `templateMarkupUrl` in
 *   `use-theme-canvas-styling.hooks.ts`) — unresolved, marker still present. Works whether this is a
 *   full document (`<html>…<body>…`) or a bare fragment: `DOMParser` synthesizes the missing
 *   `<html>`/`<body>` either way, so the walk's stopping condition (`tagName === "BODY"`) is reached
 *   the same way in both cases.
 * @returns The ancestor chain, outermost first, always at least one node (the marker itself) when a
 *   marker was found. `null` when the template has no `{"type":"content"}` marker at all, or when
 *   more than one candidate is present and none is valid — the caller's documented signal to fall
 *   back to no wrapper rather than guess.
 * @complexity O(n + d) — n = template markup size (one parse), d = the marker's own ancestor depth
 *   (one full walk up, independent of the document's overall size).
 */
export function deriveContentWrapperChain({ templateHtml }: { templateHtml: string }, _options = {}): CanvasContentWrapperNode[] | null {
  const doc = new DOMParser().parseFromString(templateHtml, "text/html");
  const marker = Array.from(doc.querySelectorAll("[data-embed-config]")).find(isContentMarker);
  if (!marker) return null;

  const chain: CanvasContentWrapperNode[] = [];
  let current: Element | null = marker;
  while (current && current.tagName.toLowerCase() !== "body") {
    chain.unshift({
      tagName: current.tagName.toLowerCase(),
      attributes: attributesOf(current, { dropEmbedConfig: current === marker }),
    });
    current = current.parentElement;
  }
  return chain;
}
