import type { JsonObject, JsonValue } from "@jini-ai/core/primitives";
import { safeCssColor, safeCssFontFamily, safeCssLength } from "./style-values.js";
import { escapeHtml } from "@jini-ai/core/text";
import { isNonArrayRecord } from "@jini-ai/core/records";

// ---------------------------------------------------------------------------
// Content doc vocabulary (unchanged from the pre-theme renderer)
// ---------------------------------------------------------------------------

/**
 * `textStyle` mark renderer — `@tiptap/extension-text-style` (2026-08-11) — `Color`/`BackgroundColor`
 * are both `Extension`s that attach a global attribute to this ONE shared mark rather than marks of
 * their own (confirmed against the installed dist, not assumed: both literally call
 * `chain().setMark("textStyle", { color/backgroundColor })`), so a run of text with both picked
 * carries a SINGLE `textStyle` mark with both attrs, not two nested marks — the combined style string
 * below mirrors that, one `<span style="...">`, not two nested spans. Each value is independently
 * allowlisted ({@link safeCssColor}) before it reaches public HTML; an unsafe/malformed value for
 * either drops just that declaration rather than the whole style attribute (an author who picked a
 * valid text color but somehow got a corrupted background value keeps the text color). No attrs
 * surviving the allowlist (including the common case: a `textStyle` mark with neither attr set, e.g.
 * from `toggleTextStyle()` or some other extension using this same mark) renders no `<span>` at all —
 * an empty `style=""` wrapper would be pure noise.
 */
function renderTextStyleMark({ html, attrs }: { html: string; attrs: JsonObject }, _optional = {}): string {
  const styleParts: string[] = [];
  const color = safeCssColor({ value: attrs.color });
  if (color) styleParts.push(`color:${color}`);
  const backgroundColor = safeCssColor({ value: attrs.backgroundColor });
  if (backgroundColor) styleParts.push(`background-color:${backgroundColor}`);
  // Font family/size, line height (2026-08-11) — same shared `textStyle` mark, same
  // `chain().setMark("textStyle", {...})` shape confirmed against each extension's own
  // installed source (`FontFamily`/`FontSize`/`LineHeight`, `@tiptap/extension-text-style`).
  const fontFamily = safeCssFontFamily({ value: attrs.fontFamily });
  if (fontFamily) styleParts.push(`font-family:${fontFamily}`);
  const fontSize = safeCssLength({ value: attrs.fontSize });
  if (fontSize) styleParts.push(`font-size:${fontSize}`);
  const lineHeight = safeCssLength({ value: attrs.lineHeight });
  if (lineHeight) styleParts.push(`line-height:${lineHeight}`);
  return styleParts.length > 0 ? `<span style="${escapeHtml({ text: styleParts.join(";") })}">${html}</span>` : html;
}

/**
 * `highlight` mark renderer — `@tiptap/extension-highlight`, `multicolor: true` (2026-08-11) — the
 * admin toolbar button is a plain toggle (no color picker), so `attrs.color` is normally absent and
 * this renders a bare `<mark>`, styled by `.post-detail-body mark` (styles.css). A `color` attr from
 * anywhere else (pasted content, a future picker) still round-trips as an inline `background-color`
 * as long as it passes {@link safeCssColor}'s allowlist — an unsafe/malformed value degrades to the
 * bare `<mark>` rather than a malformed or unsafe style attribute.
 */
function renderHighlightMark({ html, attrs }: { html: string; attrs: JsonObject }, _optional = {}): string {
  const color = safeCssColor({ value: attrs.color });
  return color ? `<mark style="background-color:${escapeHtml({ text: color })}">${html}</mark>` : `<mark>${html}</mark>`;
}

function renderLinkMark({ html, attrs, toAllowedHref }: { html: string; attrs: JsonObject; toAllowedHref: (required: { rawHref: unknown }, optional?: Record<string, never>) => string }, _optional = {}): string {
  return `<a href="${escapeHtml({ text: toAllowedHref({ rawHref: attrs.href }) })}">${html}</a>`;
}

/** One renderer per mark `type`, keyed the same way {@link renderMarks} used to switch on the value
 *  inline — a lookup instead of an if/else-if chain so the chain's own length stops being the thing
 *  driving this function's complexity (see `renderMarks`'s own doc). Each entry receives the
 *  already-escaped/nested `html` so far and the mark's own `attrs` (defaulted to `{}` by the caller),
 *  same contract every branch of the old chain relied on. */
/**
 * Exported so a host's tool-schema test suite can gate its
 * published mark-type schema against this map's real keys instead of a hand-maintained copy going
 * stale again — no other behavior change; this map is still read only by {@link renderMarks} inside
 * this module.
 */
export const MARK_RENDERERS: Record<string, (required: { html: string; attrs: JsonObject; toAllowedHref: (required: { rawHref: unknown }, optional?: Record<string, never>) => string }, optional?: Record<string, never>) => string> = {
  bold: ({ html }) => `<strong>${html}</strong>`,
  italic: ({ html }) => `<em>${html}</em>`,
  code: ({ html }) => `<code>${html}</code>`,
  underline: ({ html }) => `<u>${html}</u>`,
  strike: ({ html }) => `<s>${html}</s>`,
  subscript: ({ html }) => `<sub>${html}</sub>`,
  superscript: ({ html }) => `<sup>${html}</sup>`,
  textStyle: renderTextStyleMark,
  highlight: renderHighlightMark,
  link: renderLinkMark,
};

export function renderMarks({ text, marks, toAllowedHref }: { text: string; marks: JsonValue[] | undefined; toAllowedHref: (required: { rawHref: unknown }, optional?: Record<string, never>) => string }, _optional = {}): string {
  let html = escapeHtml({ text });
  for (const mark of marks ?? []) {
    if (!isNonArrayRecord({ value: mark })) continue;
    const record = mark as JsonObject;
    const renderer = typeof record.type === "string" ? MARK_RENDERERS[record.type] : undefined;
    if (renderer) html = renderer({ html, attrs: isNonArrayRecord({ value: record.attrs }) ? record.attrs as JsonObject : {}, toAllowedHref });
  }
  return html;
}
