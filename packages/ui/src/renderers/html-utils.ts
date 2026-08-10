/**
 * Generic, framework-free string splices for injecting markup into an HTML
 * document without a full parse/re-serialize round-trip. Shared by
 * `sandboxed-document.ts` and `new-tab-preview.ts`.
 */

/** Escape a string for safe use inside a double-quoted HTML attribute value. */
export function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Insert `payload` immediately after the opening `<head ...>` tag, or prepend if there is no `<head>`. */
export function injectAfterHeadOpen(doc: string, payload: string): string {
  if (/<head[^>]*>/i.test(doc)) return doc.replace(/<head[^>]*>/i, (m) => `${m}${payload}`);
  return payload + doc;
}

/**
 * Insert `payload` immediately before the real closing `</head>` tag.
 * Finds the last `</head>` before `<body>` so a `</head>` literal inside an
 * earlier `<script>`/`<style>` block isn't mistaken for the real one. Falls
 * back to appending right after `<head ...>` when there's an open tag but no
 * closing one, then to prepending when there's no `<head>` at all.
 */
export function injectBeforeHeadEnd(doc: string, payload: string): string {
  const lower = doc.toLowerCase();
  const bodyStart = lower.indexOf('<body');
  const limit = bodyStart >= 0 ? bodyStart : lower.length;
  const idx = lower.lastIndexOf('</head>', limit - 1);
  if (idx >= 0) return doc.slice(0, idx) + payload + doc.slice(idx);
  if (/<head[^>]*>/i.test(doc)) return doc.replace(/<head[^>]*>/i, (m) => `${m}${payload}`);
  return payload + doc;
}

/**
 * Insert `payload` immediately before the real closing `</body>` tag,
 * finding the last `</body>` before `</html>` for the same reason
 * `injectBeforeHeadEnd` finds the last `</head>` before `<body>`. Falls back
 * to appending at the end of the document when there's no `<body>` at all.
 */
export function injectBeforeBodyEnd(doc: string, payload: string): string {
  const lower = doc.toLowerCase();
  const htmlEnd = lower.lastIndexOf('</html>');
  const limit = htmlEnd >= 0 ? htmlEnd : lower.length;
  const idx = lower.lastIndexOf('</body>', limit - 1);
  if (idx >= 0) return doc.slice(0, idx) + payload + doc.slice(idx);
  return doc + payload;
}
