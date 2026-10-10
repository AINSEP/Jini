import { parse, type DefaultTreeAdapterMap } from 'parse5';

/** Static exports keep optional content inert, without forms posting to a nonexistent server.
 * The same parse5 owner supplies source locations; no competing HTML parsing lifecycle.
 * @complexity O(n + s log s) time/O(n) space for n bytes and s removed runtime elements. */
export function stripConsentRuntime({ html }: { html: string }, _options = {}): string {
  const stack: DefaultTreeAdapterMap['childNode'][] = [...parse(html, { sourceCodeLocationInfo: true, scriptingEnabled: false }).childNodes];
  const edits: { start: number; end: number }[] = [];
  while (stack.length) {
    const node = stack.pop()!;
    if (!('tagName' in node)) continue;
    const attrs = new Map(node.attrs.map(attr => [attr.name, attr.value]));
    const location = node.sourceCodeLocation;
    if (location && (attrs.get('id') === 'jini-consent' || attrs.get('id') === 'jini-consent-config' || attrs.has('data-jini-consent-runtime') || attrs.has('data-jini-consent-style'))) {
      edits.push({ start: location.startOffset, end: location.endOffset });
      continue;
    }
    if (node.tagName !== 'template') stack.push(...node.childNodes);
  }
  for (const edit of edits.sort((a, b) => b.start - a.start)) html = html.slice(0, edit.start) + html.slice(edit.end);
  return html;
}
