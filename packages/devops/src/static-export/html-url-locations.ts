import { parse, type DefaultTreeAdapterMap } from 'parse5';

type Node = DefaultTreeAdapterMap['node'];
type Element = DefaultTreeAdapterMap['element'];
export interface HtmlUrlLocation { start: number; end: number; kind: 'url' | 'srcset' | 'css' | 'action'; attribute?: string }
const URL_ATTRIBUTES: ReadonlySet<string> = new Set(['src', 'href', 'poster']);

/** The exact attribute value range, preserving quotes, spacing and all surrounding source bytes. */
function attributeLocation({ html, start, end, kind }: { html: string; start: number; end: number; kind: HtmlUrlLocation['kind'] }, _optional = {}): HtmlUrlLocation | undefined {
  const raw = html.slice(start, end);
  const prefix = /^[^\s=]+\s*=\s*/.exec(raw);
  if (!prefix) return undefined;
  const valueStart = start + prefix[0].length;
  const quoted = html[valueStart] === '"' || html[valueStart] === "'";
  return { start: valueStart + Number(quoted), end: end - Number(quoted), kind };
}

/** Only social-image metadata content carries a URL. */
function isImageMetadata({ element }: { element: Element }, _optional = {}): boolean {
  const property = element.attrs.find(attr => attr.name === 'property' || attr.name === 'name')?.value.toLowerCase();
  return property === 'og:image' || property === 'twitter:image';
}

/** Attribute kinds are shared by rewriting, crawling and diagnostic references. Script-read
 *  `data-*-href`/`-src` values (the see-more button's batch URL) are URLs too; references skip them. */
function attributeKind({ element, name }: { element: Element; name: string }, _optional = {}): HtmlUrlLocation['kind'] | undefined {
  const urlName = normalizedUrlAttribute(name);
  if (URL_ATTRIBUTES.has(urlName)) return 'url';
  if (urlName === 'srcset') return 'srcset';
  if (name === 'style') return 'css';
  if (name === 'action' && element.tagName === 'form') return 'action';
  if (name === 'content' && element.tagName === 'meta' && isImageMetadata({ element })) return 'url';
  return undefined;
}

function normalizedUrlAttribute(name: string): string {
  return /^data-(?:[\w-]*-)?(href|src|srcset|poster)$/.exec(name)?.[1] ?? name;
}

/** Style text is CSS; every other element's text remains untouched. */
function styleLocations({ element }: { element: Element }, _optional = {}): HtmlUrlLocation[] {
  if (element.tagName !== 'style') return [];
  return element.childNodes.flatMap(child => child.sourceCodeLocation
    ? [{ start: child.sourceCodeLocation.startOffset, end: child.sourceCodeLocation.endOffset, kind: 'css' as const }] : []);
}

/** Collect one element's real URL/style positions, excluding lookalike strings in text and scripts. */
function elementLocations({ element, html }: { element: Element; html: string }, _optional = {}): HtmlUrlLocation[] {
  const locations: HtmlUrlLocation[] = [];
  for (const attr of element.attrs) {
    const kind = attributeKind({ element, name: attr.name });
    const source = element.sourceCodeLocation?.attrs?.[attr.name];
    if (!kind || !source) continue;
    const location = attributeLocation({ html, start: source.startOffset, end: source.endOffset, kind });
    if (location) locations.push({ ...location, attribute: attr.name });
  }
  locations.push(...styleLocations({ element }));
  return locations;
}

/** Source ranges from the workspace's HTML parser; no serialization can alter article content.
 * @complexity O(n + a log a) in HTML bytes and source attributes; iterative traversal avoids recursion limits. */
export function htmlUrlLocations({ html }: { html: string }, _optional = {}): HtmlUrlLocation[] {
  const pending: Node[] = [parse(html, { sourceCodeLocationInfo: true })];
  const locations: HtmlUrlLocation[] = [];
  while (pending.length) {
    const node = pending.pop()!;
    if ('childNodes' in node) for (const child of node.childNodes) pending.push(child);
    if ('tagName' in node) locations.push(...elementLocations({ element: node, html }));
    if ('content' in node) pending.push(node.content);
  }
  return locations.sort((a, b) => a.start - b.start);
}


/** CSS, sitemap and manifest positions use their response format, never an HTML text scan. */
export function exportUrlLocations({ body, contentType }: { body: string; contentType: string }, _optional = {}): HtmlUrlLocation[] {
  if (/^text\/html\b/i.test(contentType)) return htmlUrlLocations({ html: body });
  if (/^text\/css\b/i.test(contentType)) return [...body.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)].map(match => ({ start: match.index!, end: match.index! + match[0].length, kind: 'css' }));
  if (/\bxml\b/i.test(contentType)) return [...body.matchAll(/<((?:[\w-]+:)?loc)>([^<]*)<\/\1>/g)].map(match => ({ start: match.index! + match[1]!.length + 2, end: match.index! + match[0].length - match[1]!.length - 3, kind: 'url' }));
  if (!/\bjson\b/i.test(contentType)) return [];
  try { JSON.parse(body); } catch { return []; }
  return [...body.matchAll(/"(?:href|src|url)"\s*:\s*("(?:[^"\\]|\\.)*")/g)].map(match => ({ start: match.index! + match[0].length - match[1]!.length + 1, end: match.index! + match[0].length - 1, kind: 'url' }));
}
