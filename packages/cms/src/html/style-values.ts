import type { JsonValue } from "@jini-ai/core/primitives";

/**
 * @file Allowlists for the few author-supplied strings a renderer interpolates directly into a
 * `style="…"` attribute rather than into ordinary HTML text/attribute content. HTML escaping stops
 * an attribute breakout; it does not stop a value that stays inside the quotes from adding a
 * second CSS declaration, because such a value is ordinary text to an HTML escaper. The only sound
 * rule for a value that will be read as CSS is an allowlist of the exact CSS values the renderer
 * means to support, not a character-level escape.
 *
 * Pure functions over already-extracted strings; no I/O.
 */

/** The `text-align` keywords a rich-text renderer's align features (`textAlign` attrs, table-cell
 *  `align`) ever intentionally emit. `"left"` is deliberately excluded: it is the CSS/HTML default,
 *  so {@link safeTextAlign} treats it the same as any other value this renderer doesn't recognize —
 *  the caller emits nothing rather than a redundant `text-align:left`. */
const TEXT_ALIGN_VALUES: ReadonlySet<string> = new Set(["center", "right", "justify"]);

/**
 * Validate a `textAlign`-shaped value against the fixed set of keywords the renderer ever means to emit
 * as an inline `text-align` declaration.
 *
 * @param required.value - The raw, author-controlled string (a doc node's `attrs.textAlign`/`attrs.align`).
 * @returns The value itself, narrowed, when it is exactly one of the three keywords; `null` for
 * `"left"`, any unrecognized keyword, and any value carrying extra CSS (`"center;position:fixed"`).
 * @complexity O(1).
 * @example safeTextAlign("center"); // => "center"
 * @example safeTextAlign("center;position:fixed"); // => null
 * @example safeTextAlign("left"); // => null (the default — the caller omits the attribute)
 */
export function safeTextAlign({ value }: { value: string }, _optional = {}): "center" | "right" | "justify" | null {
  return TEXT_ALIGN_VALUES.has(value) ? (value as "center" | "right" | "justify") : null;
}

/**
 * An `aspect-ratio` value shaped like CSS's own `<number> / <number>` (1 to 4 digits either side of
 * the slash, an optional 1-4 digit decimal fraction, optional whitespace around the slash). Anchored
 * at both ends so a value that starts with a legitimate ratio and then smuggles a second declaration
 * (`"1/1;position:fixed"`) fails the match as a whole, rather than matching a leading substring.
 */
const ASPECT_RATIO_PATTERN = /^\d{1,4}(\.\d{1,4})?\s*\/\s*\d{1,4}(\.\d{1,4})?$/;

/**
 * Validate an `aspect-ratio`-shaped value (for example a media placeholder's `ratio` prop).
 *
 * @param required.value - The raw, author-controlled string.
 * @returns The value unchanged when it matches {@link ASPECT_RATIO_PATTERN} in full; `null`
 * otherwise, including a value that merely starts with a valid ratio.
 * @complexity O(n) in the string length (regex match).
 * @example safeAspectRatio("4 / 3"); // => "4 / 3"
 * @example safeAspectRatio("1/1;position:fixed"); // => null
 */
export function safeAspectRatio({ value }: { value: string }, _optional = {}): string | null {
  return ASPECT_RATIO_PATTERN.test(value) ? value : null;
}

/**
 * Allowlisted CSS color forms an author-supplied `color` (highlight/text-color/background-color
 * marks, 2026-08-11) may take before it reaches public HTML inside a `style=""` attribute — the
 * same "collapse anything unrecognized rather than splice an arbitrary string into markup"
 * discipline a host href policy applies to links, adapted for CSS instead of a URL scheme.
 *
 * Accepts: 3/4/6/8-digit hex (`#abc`, `#aabbcc`, `#aabbccdd`); a bare alphabetic keyword up to 20
 * chars (`red`, `transparent`, `currentcolor` — an unrecognized keyword is simply invalid CSS the
 * browser ignores, not an injection vector, so this doesn't need a fixed keyword allowlist); or one
 * of the five functional notations Tiptap's own Color/Highlight pickers can produce (`rgb`/`rgba`/
 * `hsl`/`hsla`/`oklch`), with the characters INSIDE the parens restricted to digits/`%`/`.`/`,`/
 * whitespace/`/` (the last for `oklch(l c h / a)`'s alpha slot) — no nested `(`, no `url(`, no `;`,
 * no backslash, so nothing here can break out of the `style` attribute's value or smuggle a second
 * CSS declaration. Returns `null` (not `"#"` — there is no safe placeholder color to fall back to)
 * so every caller omits the attribute entirely on a rejected value, same as {@link renderImageTag}'s
 * own "omit rather than emit a malformed/placeholder attribute" rule.
 */
const CSS_COLOR_PATTERN = /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{1,20}|(?:rgb|rgba|hsl|hsla|oklch)\([0-9.%,\s/]{1,80}\))$/;

export function safeCssColor({ value }: { value: JsonValue | undefined }, _optional = {}): string | null {
  if (typeof value !== "string") return null;
  const color = value.trim();
  return CSS_COLOR_PATTERN.test(color) ? color : null;
}

/**
 * Allowlisted CSS `font-family` values (2026-08-11) — same "collapse anything unrecognized" rule
 * {@link safeCssColor} states for itself, adapted for a font stack instead of a color: the admin
 * toolbar's own control is a closed `<select>` of preset stacks, so this exists purely as
 * defense-in-depth against `bodyJson` written some other way. Restricted to letters/digits/
 * whitespace/comma/hyphen/single-or-double-quote — enough to express a real comma-separated font
 * stack with quoted multi-word names (`"Courier New", monospace`) but no `(`, `;`, `<`, `>`, or
 * backslash, so nothing here can break out of the `style=""` attribute value or smuggle a second
 * declaration. The value is ALSO run through {@link escapeHtml} at the call site (same double-layer
 * discipline the `link` case's `href` already gets) since a quoted font name legitimately contains
 * `"`, which must become `&quot;` to stay valid inside the double-quoted HTML attribute.
 */
const CSS_FONT_FAMILY_PATTERN = /^[a-zA-Z0-9\s,'".-]{1,200}$/;

export function safeCssFontFamily({ value }: { value: JsonValue | undefined }, _optional = {}): string | null {
  if (typeof value !== "string") return null;
  const fontFamily = value.trim();
  return fontFamily.length > 0 && CSS_FONT_FAMILY_PATTERN.test(fontFamily) ? fontFamily : null;
}

/**
 * Allowlisted CSS length values (2026-08-11) — `font-size`/`line-height`'s shared shape: a bare
 * unitless number (`line-height`'s own idiomatic form, e.g. `"1.5"`) or a number with one of a
 * small set of length units. Same defense-in-depth reasoning as {@link safeCssFontFamily} — the
 * toolbar's own controls are closed `<select>` presets.
 */
const CSS_LENGTH_PATTERN = /^\d{1,4}(\.\d{1,3})?(px|em|rem|%|pt|vh|vw)?$/;

export function safeCssLength({ value }: { value: JsonValue | undefined }, _optional = {}): string | null {
  if (typeof value !== "string") return null;
  const length = value.trim();
  return CSS_LENGTH_PATTERN.test(length) ? length : null;
}

/**
 * Allowlisted `language-*` class token for a `codeBlock` node's `attrs.language`
 * (`@tiptap/extension-code-block-lowlight`): store only the language name, emit it as a class,
 * without a server-side highlighter dependency. A theme may load a client-side highlighter that reads
 * this class, or may not — either way the code still renders as readable monospace. Not validated against lowlight's own
 * registered-language list (unlike the editor's language `<select>`, which only offers names
 * lowlight's `common` grammar set actually registers) — an unrecognized-but-safe token is harmless
 * here, it just never matches a highlighter's own CSS/JS on the public side. Restricted to
 * alphanumeric + hyphen only (matches every real `highlight.js` language/alias name, e.g.
 * `objective-c`, `python-repl`) purely to keep this an inert class token: nothing in this pattern
 * can carry a quote, space, or `<`/`>` that would break out of the `class=""` attribute.
 */
const LANGUAGE_CLASS_PATTERN = /^[a-zA-Z0-9-]{1,32}$/;

export function safeLanguageClass({ value }: { value: JsonValue | undefined }, _optional = {}): string | null {
  if (typeof value !== "string") return null;
  const language = value.trim();
  return LANGUAGE_CLASS_PATTERN.test(language) ? language : null;
}
