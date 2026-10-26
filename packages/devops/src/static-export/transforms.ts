import { htmlUrlLocations } from './html-url-locations.js';
export { exportUrlLocations } from './html-url-locations.js';
import { ExportPathError } from './contracts.js';

function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!); }
function safeHref(value: string): string {
  const href = value.trim();
  if (href.startsWith('#') || /^https?:\/\//i.test(href) || /^mailto:/i.test(href)) return href;
  if (href.startsWith('/')) {
    // eslint-disable-next-line sonarjs/no-clear-text-protocols -- Reserved .invalid sentinel used only for local URL resolution/origin comparison; never fetched.
    try { if (new URL(href, 'http://export-safehref.invalid/').origin === 'http://export-safehref.invalid') return href; } catch { return '#'; }
  }
  return '#';
}
/** Normalize the optional output URL prefix; no product layout is implied. */
export function normalizeBasePath(required: { raw: string }): string {
  const trimmed = required.raw.trim().replace(/\/+$/, '');
  if (trimmed === '' || trimmed === '/') return '';
  if (/[\\\x00-\x20\x7f?#"'<>]/.test(trimmed) || trimmed.startsWith('//')) throw new ExportPathError('Invalid export base path.');
  const normalized = trimmed.startsWith('/') ? trimmed : '/' + trimmed;
  if (normalized.split('/').slice(1).some(segment => !segment || segment === '.' || segment === '..')) throw new ExportPathError('Invalid export base path.');
  return normalized;
}
function prefix(value: string, basePath: string): string {
  if (!basePath || !value.startsWith('/') || value.startsWith('//')) return value;
  if (value === basePath || value.startsWith(basePath + '/')) return value;
  return basePath + value;
}
/** First index at or after `index` whose character fails `test` (or the end of `value`). */
function skipWhile(value: string, index: number, test: (char: string) => boolean): number {
  while (index < value.length && test(value[index]!)) index++;
  return index;
}
function srcsetRanges(value: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  let index = 0;
  while (index < value.length) {
    const start = skipWhile(value, index, char => /[\s,]/.test(char));
    index = skipWhile(value, start, char => !/\s/.test(char));
    let end = index;
    while (end > start && value[end - 1] === ',') end--;
    if (end > start) ranges.push({ start, end });
    // A URL ending in commas ends its candidate; otherwise skip its descriptor up to the next comma.
    if (end === index) index = skipWhile(value, index, char => char !== ',');
  }
  return ranges;
}
/** One attribute's URL values: each srcset candidate URL, or the whole value for any other attribute. */
function attributeUrls(attribute: string, value: string): string[] {
  return attribute === 'srcset' ? srcsetRanges(value).map(({ start, end }) => value.slice(start, end)) : [value];
}
/** A route path naming a `.json` file (e.g. a see-more JSON batch): written as that file, not `<path>/index.html`. */
function isJsonRoute(path: string): boolean {
  return /\.json$/i.test(path.split(/[?#]/)[0]!);
}
/** JSON's link fields (`href`/`url`/`src` string values) get the base path, as HTML attributes do; a body that is not JSON is left as is. */
function rewriteJson(body: string, basePath: string): string {
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return body; }
  return JSON.stringify(parsed, (key, value: unknown) => (typeof value === 'string' && (key === 'href' || key === 'url' || key === 'src') ? prefix(value, basePath) : value));
}
function rewriteHtml(html: string, basePath: string): string {
  const output: string[] = [];
  let offset = 0;
  for (const { start, end, kind } of htmlUrlLocations({ html })) {
    if (kind === 'action') continue;
    let value = html.slice(start, end);
    if (kind === 'css') value = rewriteCss(value, basePath);
    else if (kind === 'srcset') {
      for (const range of srcsetRanges(value).reverse()) value = value.slice(0, range.start) + prefix(value.slice(range.start, range.end), basePath) + value.slice(range.end);
    } else value = prefix(value, basePath);
    output.push(html.slice(offset, start), value);
    offset = end;
  }
  output.push(html.slice(offset));
  return output.join('');
}
/** Root-relative CSS URLs keep working in inline styles and stylesheets under an export prefix. */
function rewriteCss(body: string, basePath: string): string {
  return body.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (_match, quote: string, value: string) => `url(${quote}${prefix(value.trim(), basePath)}${quote})`);
}
/** Same bounded text transforms as the exporter origin; crawl the raw body before applying these. */
export function rewriteRouteBodyForBasePath(required: { path: string; body: string; basePath: string }, _optional = {}): string {
  const { path, body, basePath } = required;
  if (!basePath || path === '/feed.xml') return body;
  if (path === '/sitemap.xml') return body.replace(/<((?:[\w-]+:)?loc)>([^<]*)<\/\1>/g, (_match, tag: string, value: string) => `<${tag}>${prefix(value, basePath)}</${tag}>`);
  if (path === '/robots.txt') return body.replace(/^Sitemap: (.*)$/gm, (_match, value: string) => `Sitemap: ${prefix(value.trim(), basePath)}`);
  if (isJsonRoute(path)) return rewriteJson(body, basePath);
  return rewriteHtml(body, basePath);
}
/** Rewrite asset output only; discovery still uses the raw stylesheet/manifest response. */
export function rewriteAssetBodyForBasePath(required: { body: string; contentType: string; basePath: string }): string {
  const { body, contentType, basePath } = required;
  if (!basePath) return body;
  if (/\bjson\b/.test(contentType)) return rewriteJson(body, basePath);
  if (!/^text\/css\b/.test(contentType)) return body;
  return rewriteCss(body, basePath);
}
type RedirectDecision = { kind: 'failed'; reason: string } | { kind: 'redirect-to'; location: string };
/** Live Location wins; a manifest target is a fallback only for a genuine 3xx. */
export function redirectOutcomeFor(required: { status: number; locationHeader: string | null }, optional: { manifestTarget?: string } = {}): RedirectDecision {
  if (required.status < 300 || required.status >= 400) return { kind: 'failed', reason: `expected a 3xx redirect response, got ${required.status}` };
  const location = required.locationHeader ?? optional.manifestTarget;
  if (!location) return { kind: 'failed', reason: 'redirect response carried no Location header' };
  return { kind: 'redirect-to', location };
}
/** Scheme-check before escaping all three URL sinks. Unsafe destinations degrade to '#'. */
export function renderRedirectStub(required: { location: string }, optional: { basePath?: string } = {}): string {
  const location = prefix(required.location, optional.basePath ?? '');
  const safeTarget = escapeHtml(safeHref(location));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=${safeTarget}"><link rel="canonical" href="${safeTarget}"><title>Redirecting…</title></head><body>Redirecting to <a href="${safeTarget}">${escapeHtml(location)}</a>.</body></html>\n`;
}
/** HTML URL attributes; form actions are diagnostic references, never crawled as assets. */
export function* extractHtmlReferences(required: { html: string }, _optional: Record<string, never> = {}): Generator<{ url: string; attribute: string }> {
  for (const { start, end, kind, attribute } of htmlUrlLocations(required)) {
    if (kind === 'css' || attribute?.startsWith('data-') || (start === end && kind !== 'action')) continue;
    for (const url of attributeUrls(kind, required.html.slice(start, end))) yield { url, attribute: attribute! };
  }
}
/** JSON manifests use parsed link values; prose resembling JSON never becomes an asset reference. */
function jsonUrls({ body }: { body: string }, _optional = {}): string[] {
  const urls: string[] = [];
  try {
    JSON.parse(body, (key, value: unknown) => {
      if (typeof value === 'string' && ['src', 'url', 'href'].includes(key)) urls.push(value);
      return value;
    });
  } catch { /* A non-JSON response has no manifest link positions. */ }
  return urls;
}
/** Format chooses the discovery positions before any prefix filtering. */
function assetCandidates(required: { html: string; prefixes: readonly string[] }, optional: { format?: 'html' | 'json' | 'xml' } = {}): string[] {
  if (optional.format === 'json') return jsonUrls({ body: required.html });
  if (optional.format === 'xml') return [...required.html.matchAll(/<(?:[\w-]+:)?(?:loc|url)>([^<]+)<\//g)].map(match => match[1]!);
  const candidates: string[] = [];
  for (const { start, end, kind } of htmlUrlLocations(required)) {
    const value = required.html.slice(start, end);
    if (kind === 'css') candidates.push(...extractCssUrls({ css: value, cssUrl: '/', prefixes: required.prefixes }));
    else if (kind !== 'action') candidates.push(...attributeUrls(kind, value));
  }
  return candidates;
}

/** Crawl only positions matching the response format; HTML text and script contents stay inert. */
export function extractAssetUrls(required: { html: string; prefixes: readonly string[] }, optional: { format?: 'html' | 'json' | 'xml' } = {}): string[] {
  const found = new Set<string>();
  for (const url of assetCandidates(required, optional)) {
    if (!url.startsWith('//') && required.prefixes.some(prefix => url.startsWith(prefix))) found.add(url.split('#')[0]!);
  }
  return [...found];
}
/** A single CSS hop, resolved against the stylesheet URL and restricted to the same synthetic origin. */
export function extractCssUrls(required: { css: string; cssUrl: string; prefixes: readonly string[] }): string[] {
  const found = new Set<string>();
  for (const match of required.css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) {
    const ref = match[2]!.trim();
    if (!ref || ref.startsWith('data:')) continue;
    let resolved: URL;
    // eslint-disable-next-line sonarjs/no-clear-text-protocols -- Reserved .invalid sentinel used only for local URL resolution/origin comparison; never fetched.
    try { resolved = new URL(ref, 'http://export-local.invalid' + required.cssUrl); } catch { continue; }
    // eslint-disable-next-line sonarjs/no-clear-text-protocols -- Reserved .invalid sentinel used only for local URL resolution/origin comparison; never fetched.
    if (resolved.origin !== 'http://export-local.invalid') continue;
    if (required.prefixes.some(prefix => resolved.pathname.startsWith(prefix))) found.add(resolved.pathname);
  }
  return [...found];
}
/** Reject path escapes and separators before HTTP or writing; returns forward-slash relative output. */
export function safeRelativeOutputFile(required: { value: string }): string {
  const { value } = required;
  if (!value || /[\\\x00-\x1f\x7f:]/.test(value) || value.startsWith('/')) throw new ExportPathError('Output path resolved outside the output directory — refused');
  if (value.split('/').some(segment => !segment || segment === '.' || segment === '..')) throw new ExportPathError('Output path resolved outside the output directory — refused');
  return value;
}
/** URL request path to portable artifact path, with decoded traversal refusal. */
export function outputFileForUrl(required: { url: string }, optional: { contentRoute?: boolean } = {}): string {
  if (!required.url.startsWith('/') || required.url.startsWith('//') || /[\\\x00-\x1f\x7f]/.test(required.url)) throw new ExportPathError('URL resolved outside the output directory — refused');
  let decoded: string;
  try { decoded = decodeURIComponent(required.url.split(/[?#]/)[0]!); } catch { throw new ExportPathError('Invalid URL encoding — refused'); }
  const relative = decoded.replace(/^\//, '').replace(/\/+$/, '');
  if (relative) safeRelativeOutputFile({ value: relative });
  const output = optional.contentRoute && !isJsonRoute(relative) ? (relative ? relative + '/index.html' : 'index.html') : relative;
  return safeRelativeOutputFile({ value: output });
}
