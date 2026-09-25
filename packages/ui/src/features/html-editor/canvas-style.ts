/**
 * @file Builds the `canvas.frameStyle` GrapesJS injects into its editing canvas, so a host that
 * supplies its own canvas styling is not silently overruled by GrapesJS's own defaults.
 *
 * GrapesJS injects `canvas.frameStyle` as a `<style>` element in the canvas document's **`<body>`**,
 * after everything `canvas.styles` puts in `<head>` — confirmed live in Chrome by reading
 * `iframe.contentDocument`: the head held only the host's `<link>`, and the `body { background-color:
 * #fff }` rule that beat it sat in a body-level `<style>`. Its default value therefore wins the
 * cascade against any host stylesheet that sets a body background, at equal specificity, purely on
 * document order. Left alone, a host loading a dark theme's stylesheet into the canvas gets that
 * theme's near-white `color` on GrapesJS's hardcoded white background — white-on-white text, which is
 * strictly worse than the unstyled canvas it replaced.
 *
 * So the white body background is emitted only when the host supplies no canvas styling of its own.
 * The scrollbar rules are kept either way: they are chrome for GrapesJS's own scrolling canvas, not a
 * statement about the edited document.
 */

/**
 * One level of a {@link CanvasStyling.contentWrapper} ancestor chain — a tag name plus the
 * attributes it carried in the host's real template, minus whatever marker attribute the host used
 * to find it (its own concern, not this module's — see `contentWrapper`'s own doc).
 */
export interface CanvasContentWrapperNode {
  /** Lowercase HTML tag name, e.g. `"main"`, `"article"`. */
  tagName: string;
  /** Attribute name/value pairs, e.g. `{ class: "post-detail wrap", "data-reveal": "" }`. Omitted or
   *  empty means a bare tag with no attributes. */
  attributes?: Readonly<Record<string, string>>;
}

/** What a host wants the canvas document styled with. All fields optional; supplying none is the
 *  "GrapesJS defaults" case. */
export interface CanvasStyling {
  /** Stylesheet URLs, appended to the canvas document's `<head>` as `<link>` elements by GrapesJS
   *  (`canvas.styles`). Not included in the editor's exported HTML. */
  stylesheets?: readonly string[];
  /** Raw CSS appended after the scrollbar rules, so it wins against them and against anything
   *  `stylesheets` loaded. For declarations that have no stylesheet to load from — a theme's design
   *  tokens, say. Not included in the editor's exported HTML. */
  css?: string;
  /**
   * The real DOM ancestor chain the host's own page template wraps the editable content in —
   * outermost element first — so the canvas centers/pads/backgrounds its content the same way the
   * published page does instead of rendering it full-bleed. E.g. `[{tagName: "main"}, {tagName:
   * "article", attributes: {class: "post-detail wrap", "data-reveal": ""}}]`.
   *
   * Applied to the LIVE canvas DOM only, after the editor has already parsed its initial
   * `components` — see `react/hooks/useInteractiveHtmlEditor.ts`'s `applyCanvasContentWrapper` call
   * and `canvas-content-wrapper.ts`'s own file header for why that ordering is what keeps this out of
   * `getHtml()`/`getCss()` by construction rather than by a strip-on-export step. Omit for the
   * pre-existing behavior: the editable content renders directly in the canvas body with no wrapper.
   */
  contentWrapper?: readonly CanvasContentWrapperNode[];
}

/** GrapesJS's own default scrollbar chrome for the canvas, restated verbatim from its
 *  `canvas.frameStyle` default so overriding that option does not silently drop it. */
const CANVAS_SCROLLBAR_STYLE = [
  "* ::-webkit-scrollbar-track { background: rgba(0, 0, 0, 0.1) }",
  "* ::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.2) }",
  "* ::-webkit-scrollbar { width: 10px }",
].join("\n");

/** The half of GrapesJS's default `canvas.frameStyle` this module conditionally drops — see the file
 *  header for why it cannot simply be left in place. */
const CANVAS_DEFAULT_BODY_BACKGROUND = "body { background-color: #fff }";

/**
 * CSS class the canvas body carries while `react/hooks/useInteractiveHtmlEditor.ts`'s
 * `revealCanvasWhenStylesheetsSettle` is still waiting on `canvas.styles`' `<link>` elements to settle
 * (Bug B, Slice B1, this repo's `pages-redo` plan): every Interactive mount re-fetches the theme
 * stylesheet (no browser cache short-circuit is guaranteed), and GrapesJS renders the canvas body
 * without waiting for it, so a slow or restarting API left the canvas showing raw browser-default
 * styling (Times New Roman, blue links) until the stylesheet arrived. Exported so the hook that
 * toggles this class on/off and this module's CSS rule for it never drift onto two different literal
 * strings.
 */
export const CANVAS_STYLES_PENDING_CLASS = "gjs-canvas-styles-pending";

/** The rule that makes {@link CANVAS_STYLES_PENDING_CLASS} actually hide the canvas. Unconditional —
 *  unlike {@link CANVAS_DEFAULT_BODY_BACKGROUND}, it doesn't depend on whether the host supplies its
 *  own styling, since the class is only ever present while a fetch is genuinely in flight. */
const CANVAS_STYLES_PENDING_RULE = `.${CANVAS_STYLES_PENDING_CLASS} { visibility: hidden }`;

/**
 * Whether the host has taken over the canvas document's appearance. Either input is enough: a
 * stylesheet alone is the common case (a real theme's CSS), and raw `css` alone is enough for a host
 * that only injects variables or a background.
 */
function hostStylesTheCanvas(styling: CanvasStyling): boolean {
  return (styling.stylesheets?.length ?? 0) > 0 || Boolean(styling.css);
}

/**
 * The value to pass as GrapesJS's `canvas.frameStyle` for the given host styling: the scrollbar
 * chrome, preceded by the default white body background only when the host styles nothing itself,
 * and followed by the host's raw `css` when supplied.
 */
function buildCanvasFrameStyle(styling: CanvasStyling): string {
  const rules = [CANVAS_SCROLLBAR_STYLE, CANVAS_STYLES_PENDING_RULE];
  if (!hostStylesTheCanvas(styling)) rules.unshift(CANVAS_DEFAULT_BODY_BACKGROUND);
  if (styling.css) rules.push(styling.css);
  return rules.join("\n");
}

/** The `canvas` slice of a GrapesJS editor config — structurally the subset of its `CanvasConfig`
 *  this module decides, kept as its own type so the builder is assertable without a live editor. */
export interface CanvasStyleConfig {
  styles: string[];
  frameStyle: string;
}

/**
 * Translates host canvas styling into the GrapesJS `canvas` config that applies it. The two halves
 * are decided together on purpose: whether the white body background is emitted depends on whether
 * any stylesheet was supplied, so splitting them would let a caller pass one without the other and
 * reintroduce the white-on-white failure this module exists to prevent.
 *
 * @param styling - See {@link CanvasStyling}. An empty object reproduces GrapesJS's own defaults.
 * @returns `styles` (stylesheet URLs GrapesJS links into the canvas `<head>`) and `frameStyle` (the
 *   CSS it injects into the canvas `<body>`). Neither appears in the editor's exported HTML.
 * @complexity O(n) in the number of stylesheets plus the length of `styling.css` — copies and joins,
 *   no parsing.
 */
export function buildCanvasStyleConfig(styling: CanvasStyling): CanvasStyleConfig {
  return { styles: [...(styling.stylesheets ?? [])], frameStyle: buildCanvasFrameStyle(styling) };
}
