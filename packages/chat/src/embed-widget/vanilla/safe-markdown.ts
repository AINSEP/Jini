/**
 * Trusted markdown-to-HTML converter injected by the host (e.g. a micromark call). Contract —
 * the converter MUST:
 * - escape raw HTML in `content` rather than pass it through (never `allowDangerousHtml`);
 * - reject unsafe link/image protocols such as `javascript:` (never `allowDangerousProtocol`);
 * - return a complete HTML string for one message (no scripts, handlers or styles of its own).
 * The renderer does NOT sanitize HTML. On top of this contract it only removes images that would
 * leave the page's origin and hardens links; untrusted HTML through a weaker converter is unsafe.
 */
export type TrustedMarkdownToHtml = (args: { content: string }) => string;

/** The vanilla widget's `renderMarkdown` port (`MountVanillaChatArgs['renderMarkdown']`). */
export type VanillaMarkdownRenderer = (args: { content: string; element: HTMLElement }) => void;

/** Same-origin http(s) only; a missing or unparsable source is refused. */
function isSameOriginImage({ source, baseURI, origin }: { source: string | null; baseURI: string; origin: string | undefined }): boolean {
  if (!source || !origin) return false;
  try {
    // Resolve like the browser would (against the base URL), but authorize against the
    // document's own origin: a <base href> pointing elsewhere must not whitelist that host.
    const url = new URL(source, baseURI);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === origin;
  } catch {
    return false;
  }
}

/**
 * Builds the vanilla widget's `renderMarkdown` from a trusted converter: off-origin, data: and
 * unparsable images are dropped and links get `rel="noopener noreferrer"`.
 * @param origin - the origin images may load from; defaults to `document.location.origin`. A
 *   document with no location (e.g. `createHTMLDocument`) keeps no image at all.
 * @complexity O(nodes in the rendered message) per call.
 */
export function createSafeMarkdownRenderer({ toHtml, document }: { toHtml: TrustedMarkdownToHtml; document: Document },
  { origin = document.location?.origin }: { origin?: string | undefined } = {}): VanillaMarkdownRenderer {
  return ({ content, element }) => {
    const template = document.createElement('template');
    template.innerHTML = toHtml({ content });
    // Filter the detached fragment before insertion so an untrusted image never starts a request.
    for (const image of template.content.querySelectorAll<HTMLImageElement>('img')) {
      if (!isSameOriginImage({ source: image.getAttribute('src'), baseURI: document.baseURI, origin })) image.remove();
    }
    element.replaceChildren(template.content);
    for (const link of element.querySelectorAll<HTMLAnchorElement>('a[href]')) link.rel = 'noopener noreferrer';
  };
}
