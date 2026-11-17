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
const TEXT_ALIGN_VALUES = new Set(["center", "right", "justify"]);

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
