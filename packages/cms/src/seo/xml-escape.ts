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

const XML_ENTITIES: Readonly<Record<string, string>> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };
const SPECIAL = /[&<>"']/g;

/** {@link escapeHtml} with the XML named entity `&apos;` for the apostrophe (sitemap and feed XML).
 *  @complexity O(text length). */
// escapeHtml stays with the host renderer. A shared core owner for this leaf is a coordinator follow-up.
export function escapeXml(required: { text: string }, _optional: Record<string, never> = {}): string {
  return required.text.replace(SPECIAL, (char) => XML_ENTITIES[char] ?? char);
}
