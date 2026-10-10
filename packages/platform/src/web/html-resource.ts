/** Bound synchronous HTML parsers independently of the HTTP response byte limit. */
export const MAX_HTML_CHARS = 1_000_000;

/** Return a bounded prefix without splitting UTF-16; fetch projections expose its truncation flag.
 * The caller may supply a lower projection budget; direct conversion always has a fixed ceiling.
 * O(1) decision plus O(cap) prefix allocation; raw body output keeps its separate transport cap.
 */
export function boundHtml({ html }: { html: string }, { maxChars = MAX_HTML_CHARS }: { maxChars?: number } = {}) {
  const limit = Math.min(MAX_HTML_CHARS, maxChars);
  const end = /[\uDC00-\uDFFF]/.test(html[limit] ?? "") ? limit - 1 : limit;
  return html.length > limit ? { html: html.slice(0, end), truncated: true } : { html, truncated: false };
}
