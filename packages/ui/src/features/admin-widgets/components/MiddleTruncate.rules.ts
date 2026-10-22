/** Longest trailing ".ext" still treated as an extension; a longer dotted tail is just text. */
const MAX_EXTENSION_CHARS = 10;

export interface MiddleTruncationParts {
  /** The part that shrinks with an ellipsis when space runs out. */
  head: string;
  /** The part that always stays visible: the extension plus a few characters before it. */
  tail: string;
}

/**
 * Splits a name so CSS can cut it in the MIDDLE: `head` ellipsizes, `tail` never shrinks, so
 * `woodnest-cabin-booking.mp4` narrows to `woodnest-cabin-bo…ing.mp4` and the extension stays
 * readable. CSS does the measuring, so the same split works at any card width.
 * @param required.text The full name.
 * @param optional.keepChars Characters of the stem kept beside the extension.
 * @complexity O(n) in the name's length.
 */
export function splitMiddleTruncation(
  { text }: { text: string },
  { keepChars = 3 }: { keepChars?: number } = {},
): MiddleTruncationParts {
  const dot = text.lastIndexOf(".");
  // A leading dot (".env") is a hidden-file name, not an extension.
  const extensionChars = dot > 0 && text.length - dot <= MAX_EXTENSION_CHARS ? text.length - dot : 0;
  const tailChars = extensionChars + keepChars;
  // No extension to protect, or a name too short to cut: one piece that ellipsizes at its end.
  if (extensionChars === 0 || text.length <= tailChars + 1) return { head: text, tail: "" };
  return { head: text.slice(0, text.length - tailChars), tail: text.slice(text.length - tailChars) };
}
