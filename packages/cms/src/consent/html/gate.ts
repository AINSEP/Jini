import { parse, serializeOuter, type DefaultTreeAdapterMap } from 'parse5';
import { escapeHtml } from '@jini-ai/core/text';
import { type ConsentConfig, type ConsentRecord, type ConsentRegionMode } from '../types.js';
import { renderConsentHead, renderConsentUi } from './render.js';
import { CONSENT_CLIENT } from './client.js';

type Node = DefaultTreeAdapterMap['childNode'];
type Edit = { start: number; end: number; text: string };
/** Exact host manifest entries, never declarations taken from page HTML. */
export interface ConsentGateOptions {
  nonce?: string;
  runtimeToken?: string;
  /** Host-reviewed theme origins allowed by the pre-consent resource policy. */
  resourceOrigins?: readonly string[];
  necessaryScripts?: readonly ({ src: string; content?: never } | { content: string; src?: never })[];
}

/** Relative resources belong to the host. A base element is removed before delivery.
 * @complexity O(URL length). Unknown schemes and protocol-relative URLs are external. */
function external({ url }: { url: string }, _options = {}): boolean {
  // Browsers normalize backslashes and embedded ASCII URL whitespace before fetching.
  const normalized = url.trim().replace(/[\t\r\n]/g, '').replace(/\\/g, '/');
  return !/^(?:[?#]|\/(?!\/)|\.?\.?\/|[a-zA-Z0-9_-]+(?:[./?#]|$))/.test(normalized) || /^[a-z][a-z0-9+.-]*:|^\/\//i.test(normalized);
}

/** Gate delivered HTML using the existing parser, including no-JS and non-script requests.
 * Only host allowlisted scripts are necessary. JSON/JSON-LD and authored templates stay inert.
 * Resource hints are removed so browsers cannot fetch before consent. Source offsets preserve
 * unrelated markup byte-for-byte; wrapping a parent consumes its subtree without overlapping edits.
 * @complexity O(n + s log s + a*k) time/O(n) space: n bytes, s edits, a scripts, k manifest entries. */
export function gateConsentHtml({ html, config, record, regionMode, gpc, endpoint }: { html: string; config: ConsentConfig; record: ConsentRecord | null; regionMode: ConsentRegionMode; gpc: boolean; endpoint: string }, options: ConsentGateOptions = {}): string {
  if (!config.enabled) return html;
  const document = parse(html, { sourceCodeLocationInfo: true, scriptingEnabled: false });
  const stack: Node[] = [...document.childNodes];
  const edits: Edit[] = [];
  let headStart: number | undefined, htmlStart: number | undefined, bodyStart: number | undefined;
  let doctypeEnd = 0;
  while (stack.length) {
    const node = stack.pop()!;
    if (node.nodeName === '#documentType') doctypeEnd = node.sourceCodeLocation?.endOffset ?? 0;
    if (!('tagName' in node)) continue;
    const location = node.sourceCodeLocation;
    const attrs = new Map(node.attrs.map(attr => [attr.name, attr.value]));
    if (node.tagName === 'html' && location?.startTag) htmlStart = location.startTag.endOffset;
    if (node.tagName === 'head' && location?.startTag) headStart = location.startTag.endOffset;
    if (node.tagName === 'body' && location?.startTag) bodyStart = location.startTag.endOffset;
    const text = node.childNodes.filter(child => child.nodeName === '#text').map(child => 'value' in child ? child.value : '').join('');
    // A marker exempts only our exact runtime in this response, never the surrounding page.
    const runtime = node.tagName === 'script' && options.runtimeToken !== undefined && attrs.get('data-jini-consent-runtime') === options.runtimeToken && text === CONSENT_CLIENT;
    const necessary = node.tagName === 'script' && (runtime || options.necessaryScripts?.some(entry => entry.src !== undefined ? attrs.get('src') === entry.src : !attrs.has('src') && text === entry.content));
    const reserved = runtime ? [] : node.attrs.filter(attr => attr.name.startsWith('data-jini-consent-') || (attr.name === 'id' && ['jini-consent', 'jini-consent-config', 'jini-consent-preferences'].includes(attr.value)));
    // Authored markers cannot become another release owner or shadow our UI/state IDs.
    node.attrs = node.attrs.filter(attr => !reserved.includes(attr));
    const rel = (attrs.get('rel') ?? '').toLowerCase().split(/\s+/);
    if (location && (node.tagName === 'base' || (node.tagName === 'meta' && attrs.get('http-equiv')?.toLowerCase() === 'refresh') || (node.tagName === 'link' && rel.some(value => ['preload', 'modulepreload', 'prefetch', 'prerender', 'preconnect', 'dns-prefetch'].includes(value))))) {
      // An as=fetch preload can fetch the same optional script URL, so remove all resource hints.
      edits.push({ start: location.startOffset, end: location.endOffset, text: '' });
      continue;
    }
    const type = (attrs.get('type') ?? '').trim().toLowerCase();
    // Default deny includes legacy JavaScript MIME types, import maps and speculation rules.
    const dataScript = node.tagName === 'script' && ['application/json', 'application/ld+json', 'text/plain', 'text/template', 'text/x-template'].includes(type);
    const remote = (attrs.has('srcset') && /(?:^|[,\s])(?:https?:|\/\/)/i.test(attrs.get('srcset')!)) || ['src', 'href', 'poster', 'data', 'srcset', 'background'].some(key => attrs.has(key) && external({ url: attrs.get(key)! }));
    const cssRequests = (node.tagName === 'style' && /url\s*\(|(?:-webkit-)?image-set\s*\(|@import|\\/i.test(text));
    const resource = ['iframe', 'frame', 'object', 'embed', 'video', 'audio', 'source', 'track', 'noscript'].includes(node.tagName)
      || (['img', 'image', 'input'].includes(node.tagName) && (remote || attrs.has('data-consent-category') || attrs.get('width') === '1' || attrs.get('height') === '1'))
      || (remote && !['a', 'area', 'form', 'html', 'head', 'body', 'script'].includes(node.tagName)) || cssRequests
      || (attrs.has('data-consent-category') && !['html', 'head', 'body', 'script'].includes(node.tagName));
    const declared = attrs.get('data-consent-category');
    // Page labels may select optional categories; they can never grant necessity.
    const category = declared === undefined || declared === 'necessary' ? (remote || resource ? 'marketing' : 'functional') : ['functional', 'analytics', 'marketing'].includes(declared) ? declared : 'blocked';
    if (location && ((node.tagName === 'script' && !dataScript && !necessary) || resource)) {
      // Normalize ignored/misnested end tags so they cannot escape the new template boundary.
      const source = serializeOuter(node, { scriptingEnabled: false });
      // A template in SVG/MathML is not an inert HTML template. Remove foreign scripts/resources.
      const marker = node.tagName === 'script' ? 'data-jini-consent-script' : 'data-jini-consent-resource';
      edits.push({ start: location.startOffset, end: location.endOffset, text: node.namespaceURI === 'http://www.w3.org/1999/xhtml' ? `<template ${marker} data-category="${category}">${source}</template>` : '' });
      continue;
    }
    if (location?.startTag) {
      for (const attr of reserved) {
        const attrLocation = location.attrs?.[attr.name];
        if (attrLocation) edits.push({ start: attrLocation.startOffset, end: attrLocation.endOffset, text: '' });
      }
      const deferred: Record<string, string> = {};
      for (const attr of node.attrs) {
        const attrLocation = location.attrs?.[attr.name];
        if (!attrLocation) continue;
        if ((attr.name === 'background' && external({ url: attr.value })) || /^on/i.test(attr.name) || (['href', 'action', 'formaction'].includes(attr.name) && /^[\s\x00-\x20]*javascript:/i.test(attr.value)) || (attr.name === 'style' && /url\s*\(|(?:-webkit-)?image-set\s*\(|@import|\\/i.test(attr.value))) {
          deferred[attr.name] = attr.value;
          edits.push({ start: attrLocation.startOffset, end: attrLocation.endOffset, text: '' });
        }
      }
      if (Object.keys(deferred).length) edits.push({ start: location.startTag.endOffset - 1, end: location.startTag.endOffset - 1, text: ` data-jini-consent-attributes="${escapeHtml({ text: JSON.stringify(deferred) })}" data-jini-consent-category="${category}"` });
    }
    // Authored template contents are already inert; traversing them would release never-mounted code.
    if (node.tagName !== 'template') stack.push(...node.childNodes);
  }
  const bootstrapOffset = headStart ?? htmlStart ?? doctypeEnd;
  edits.push({ start: bootstrapOffset, end: bootstrapOffset, text: renderConsentHead({ record, gpc, regionMode }, options) });
  edits.push({ start: bodyStart ?? bootstrapOffset, end: bodyStart ?? bootstrapOffset, text: renderConsentUi({ config, record, regionMode, gpc, endpoint }) });
  edits.sort((a, b) => b.start - a.start);
  for (const edit of edits) html = html.slice(0, edit.start) + edit.text + html.slice(edit.end);
  return html;
}
