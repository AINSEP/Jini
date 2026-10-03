import { ExportPathError } from './contracts.js';

function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!); }
function safeHref(value: string): string {
  const href = value.trim();
  if (href.startsWith('#') || /^https?:\/\//i.test(href) || /^mailto:/i.test(href)) return href;
  if (href.startsWith('/')) {
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
function srcsetRanges(value: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  let index = 0;
  while (index < value.length) {
    while (index < value.length && /[\s,]/.test(value[index]!)) index++;
    const start = index;
    while (index < value.length && !/\s/.test(value[index]!)) index++;
    let end = index;
    while (end > start && value[end - 1] === ',') end--;
    if (end > start) ranges.push({ start, end });
    if (end < index) continue;
    while (index < value.length && value[index] !== ',') index++;
  }
  return ranges;
}
function rewriteHtml(html: string, basePath: string): string {
  if (!basePath) return html;
  return html.replace(/\b(href|src|srcset)=(["'])([^"']*)\2/g, (_match, attr: string, quote: string, value: string) => {
    if (attr !== 'srcset') return `${attr}=${quote}${prefix(value, basePath)}${quote}`;
    for (const { start, end } of srcsetRanges(value).reverse()) value = value.slice(0, start) + prefix(value.slice(start, end), basePath) + value.slice(end);
    return `${attr}=${quote}${value}${quote}`;
  });
}
/** Same bounded text transforms as the exporter origin; crawl the raw body before applying these. */
export function rewriteRouteBodyForBasePath(required: { path: string; body: string; basePath: string }): string {
  const { path, body, basePath } = required;
  if (!basePath || path === '/feed.xml') return body;
  if (path === '/sitemap.xml') return body.replace(/<loc>([^<]*)<\/loc>/g, (_match, value: string) => `<loc>${prefix(value, basePath)}</loc>`);
  if (path === '/robots.txt') return body.replace(/^Sitemap: (.*)$/gm, (_match, value: string) => `Sitemap: ${prefix(value.trim(), basePath)}`);
  return rewriteHtml(body, basePath);
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
/** Quoted href/src/srcset scan, preserving data-URL commas and ignoring external references. */
export function extractAssetUrls(required: { html: string; prefixes: readonly string[] }): string[] {
  const found = new Set<string>();
  for (const match of required.html.matchAll(/\b(href|src|srcset)=(["'])([^"']+)\2/g)) {
    const value = match[3]!;
    const values = match[1] === 'srcset' ? srcsetRanges(value).map(({ start, end }) => value.slice(start, end)) : [value];
    for (const url of values) if (!url.startsWith('//') && required.prefixes.some(prefix => url.startsWith(prefix))) found.add(url.split('#')[0]!);
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
    try { resolved = new URL(ref, 'http://export-local.invalid' + required.cssUrl); } catch { continue; }
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
  const output = optional.contentRoute ? (relative ? relative + '/index.html' : 'index.html') : relative;
  return safeRelativeOutputFile({ value: output });
}
