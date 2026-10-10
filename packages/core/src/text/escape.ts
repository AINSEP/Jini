/**
 * @file The one HTML/XML text escaper. A leaf module with NO imports, on purpose: the old copies
 * lived inside `render.ts`, `form-render.ts` and `static-render.ts` and were duplicated rather than
 * shared because importing them would have closed a runtime import cycle. A module that imports
 * nothing can be imported from anywhere.
 *
 * `&` is replaced first: it is the escape character for every entity after it, so replacing any
 * other character first would double-escape the `&` that replacement introduced. The apostrophe
 * becomes the numeric `&#39;` in HTML, because `&apos;` is undefined in HTML4/XHTML1.
 */

const HTML_ENTITIES: Readonly<Record<string, string>> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const XML_ENTITIES: Readonly<Record<string, string>> = { ...HTML_ENTITIES, "'": "&apos;" };
const SPECIAL = /[&<>"']/g;

/** Escapes `& < > " '` for HTML text or a quoted attribute value. @complexity O(text length). */
export function escapeHtml({ text }: { text: string }, _optional = {}): string {
  return text.replace(SPECIAL, (char) => HTML_ENTITIES[char] ?? char);
}

/** {@link escapeHtml} with the XML named entity `&apos;` for the apostrophe (sitemap and feed XML).
 *  @complexity O(text length). */
export function escapeXml({ text }: { text: string }, _optional = {}): string {
  return text.replace(SPECIAL, (char) => XML_ENTITIES[char] ?? char);
}
