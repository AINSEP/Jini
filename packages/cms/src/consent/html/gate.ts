import { defaultTreeAdapter, parse, serialize, serializeOuter, type DefaultTreeAdapterMap, type TreeAdapter } from 'parse5';
import { escapeHtml } from '@jini-ai/core/text';
import { type ConsentConfig, type ConsentRecord, type ConsentRegionMode } from '../types.js';
import { renderConsentHead, renderConsentUi } from './render.js';
import { CONSENT_CLIENT } from './client.js';

type Node = DefaultTreeAdapterMap['childNode'];
type Element = DefaultTreeAdapterMap['element'];
type Attribute = Element['attrs'][number];
type ElementLocation = NonNullable<Element['sourceCodeLocation']>;
type Edit = { start: number; end: number; text: string };
type Attrs = Map<string, string>;
/** Exact host manifest entries, never declarations taken from page HTML. */
export interface ConsentGateOptions {
  nonce?: string;
  runtimeToken?: string;
  /** Host-reviewed theme origins allowed by the pre-consent resource policy. */
  resourceOrigins?: readonly string[];
  necessaryScripts?: readonly ({ src: string; content?: never } | { content: string; src?: never })[];
}

const RESERVED_IDS = ['jini-consent', 'jini-consent-config', 'jini-consent-preferences'];
const RESOURCE_HINTS = ['preload', 'modulepreload', 'prefetch', 'prerender', 'preconnect', 'dns-prefetch'];
const DATA_SCRIPT_TYPES = ['application/json', 'application/ld+json', 'text/plain', 'text/template', 'text/x-template'];
const URL_ATTRIBUTES = ['src', 'href', 'poster', 'data', 'srcset', 'background'];
const RESOURCE_TAGS = ['iframe', 'frame', 'object', 'embed', 'video', 'audio', 'source', 'track', 'noscript'];
const IMAGE_TAGS = ['img', 'image', 'input'];
const NAVIGATION_TAGS = ['a', 'area', 'form', 'html', 'head', 'body', 'script'];
const STRUCTURAL_TAGS = ['html', 'head', 'body', 'script'];
const OPTIONAL_CATEGORIES = ['functional', 'analytics', 'marketing'];
const CSS_REQUEST = /url\s*\(|(?:-webkit-)?image-set\s*\(|@import|\\/i;
const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

/** Relative resources belong to the host. A base element is removed before delivery.
 * @complexity O(URL length). Unknown schemes and protocol-relative URLs are external. */
function external({ url }: { url: string }, _options = {}): boolean {
  // Browsers normalize backslashes and embedded ASCII URL whitespace before fetching.
  const normalized = url.trim().replace(/[\t\r\n]/g, '').replace(/\\/g, '/');
  return !/^(?:[?#]|\/(?!\/)|\.?\.?\/|[a-zA-Z0-9_-]+(?:[./?#]|$))/.test(normalized) || /^[a-z][a-z0-9+.-]*:|^\/\//i.test(normalized);
}

/** Direct text children only, matching what a browser executes for an inline script. @complexity O(children). */
function directText({ element }: { element: Element }): string {
  return element.childNodes.filter((child): child is DefaultTreeAdapterMap['textNode'] => child.nodeName === '#text').map(child => child.value).join('');
}

/** A marker exempts only our exact runtime in this response, never the surrounding page. @complexity O(script length). */
function isRuntimeScript({ element, attrs, text }: { element: Element; attrs: Attrs; text: string }, { runtimeToken }: ConsentGateOptions): boolean {
  return element.tagName === 'script' && runtimeToken !== undefined && attrs.get('data-jini-consent-runtime') === runtimeToken && text === CONSENT_CLIENT;
}

/** Authored markers cannot become another release owner or shadow our UI/state IDs. @complexity O(attributes). */
function reservedAttributes({ element }: { element: Element }): Attribute[] {
  return element.attrs.filter(attr => attr.name.startsWith('data-jini-consent-') || (attr.name === 'id' && RESERVED_IDS.includes(attr.value)));
}

/** Elements that can fetch or navigate before consent with no content worth keeping. @complexity O(rel tokens). */
function isRemovedElement({ tagName, attrs }: { tagName: string; attrs: Attrs }): boolean {
  if (tagName === 'base') return true;
  if (tagName === 'meta') return attrs.get('http-equiv')?.toLowerCase() === 'refresh';
  return tagName === 'link' && (attrs.get('rel') ?? '').toLowerCase().split(/\s+/).some(value => RESOURCE_HINTS.includes(value));
}

/** @complexity O(attribute length). */
function hasRemoteUrl({ attrs }: { attrs: Attrs }): boolean {
  const srcset = attrs.get('srcset');
  if (srcset !== undefined && /(?:^|[,\s])(?:https?:|\/\/)/i.test(srcset)) return true;
  return URL_ATTRIBUTES.some(key => attrs.has(key) && external({ url: attrs.get(key)! }));
}

/** Labelled or 1px images are tracking pixels even when local. @complexity O(1). */
function isTrackingImage({ attrs }: { attrs: Attrs }): boolean {
  return attrs.has('data-consent-category') || attrs.get('width') === '1' || attrs.get('height') === '1';
}

/** @complexity O(text length). */
function isResource({ tagName, attrs, text, remote }: { tagName: string; attrs: Attrs; text: string; remote: boolean }): boolean {
  if (RESOURCE_TAGS.includes(tagName)) return true;
  if (IMAGE_TAGS.includes(tagName) && (remote || isTrackingImage({ attrs }))) return true;
  if (remote && !NAVIGATION_TAGS.includes(tagName)) return true;
  if (tagName === 'style' && CSS_REQUEST.test(text)) return true;
  return attrs.has('data-consent-category') && !STRUCTURAL_TAGS.includes(tagName);
}

/** Page labels may select optional categories; they can never grant necessity. @complexity O(1). */
function categoryFor({ declared, fetches }: { declared: string | undefined; fetches: boolean }): string {
  if (declared === undefined || declared === 'necessary') return fetches ? 'marketing' : 'functional';
  return OPTIONAL_CATEGORIES.includes(declared) ? declared : 'blocked';
}

/** Only host allowlisted scripts are necessary. @complexity O(k) for k manifest entries. */
function isNecessaryScript({ attrs, text }: { attrs: Attrs; text: string }, { necessaryScripts = [] }: ConsentGateOptions): boolean {
  return necessaryScripts.some(entry => entry.src !== undefined ? attrs.get('src') === entry.src : !attrs.has('src') && text === entry.content);
}

/** Default deny includes legacy JavaScript MIME types, import maps and speculation rules. @complexity O(k). */
function isOptionalScript({ element, attrs, text, runtime }: { element: Element; attrs: Attrs; text: string; runtime: boolean }, options: ConsentGateOptions): boolean {
  if (element.tagName !== 'script' || runtime) return false;
  const type = (attrs.get('type') ?? '').trim().toLowerCase();
  return !DATA_SCRIPT_TYPES.includes(type) && !isNecessaryScript({ attrs, text }, options);
}

/** @complexity O(subtree size). */
function wrapEdit({ element, location, category }: { element: Element; location: ElementLocation; category: string }): Edit {
  // Normalize ignored/misnested end tags so they cannot escape the new template boundary.
  const source = serializeOuter(element, { scriptingEnabled: false });
  // A template in SVG/MathML is not an inert HTML template. Remove foreign scripts/resources.
  const marker = element.tagName === 'script' ? 'data-jini-consent-script' : 'data-jini-consent-resource';
  return { start: location.startOffset, end: location.endOffset, text: element.namespaceURI === HTML_NAMESPACE ? `<template ${marker} data-category="${category}">${source}</template>` : '' };
}

/** @complexity O(attribute length). */
function isDeferredAttribute({ name, value }: Attribute): boolean {
  if (name === 'background' && external({ url: value })) return true;
  if (/^on/i.test(name)) return true;
  if (['href', 'action', 'formaction'].includes(name)) return /^[\s\x00-\x20]*javascript:/i.test(value);
  return name === 'style' && CSS_REQUEST.test(value);
}

/** Foreign content renames parsed attributes (viewbox→viewBox, xlink:href→prefix xlink + href);
 * source locations keep the tokenized spelling. @complexity O(1). */
function attributeLocation({ attr, location }: { attr: Attribute; location: ElementLocation | null | undefined }) {
  const name = attr.prefix ? `${attr.prefix}:${attr.name}` : attr.name;
  return location?.startTag ? location.attrs?.[name] ?? location.attrs?.[name.toLowerCase()] : undefined;
}

/** An attribute the gate must change but cannot address in the source would reach the browser
 * unchanged, so refuse the page instead (the HTTP adapter then serves its restrictive fallback).
 * @throws Error naming the attribute and element. @complexity O(attributes). */
function removeAttributes({ element, attrs, location }: { element: Element; attrs: Attribute[]; location: ElementLocation | null | undefined }): Edit[] {
  return attrs.map(attr => {
    const attrLocation = attributeLocation({ attr, location });
    if (!attrLocation) throw new Error(`Consent could not locate the "${attr.name}" attribute of <${element.tagName}> in the delivered HTML. Serve this page under the restrictive consent fallback.`);
    return { start: attrLocation.startOffset, end: attrLocation.endOffset, text: '' };
  });
}

/** Strip reserved markers and move fetching/executing attributes into a release payload.
 * @complexity O(attributes). */
function attributeEdits({ element, location, reserved, category }: { element: Element; location: Element['sourceCodeLocation']; reserved: Attribute[]; category: string }): Edit[] {
  const deferred = element.attrs.filter(isDeferredAttribute);
  const edits = removeAttributes({ element, attrs: [...reserved, ...deferred], location });
  const startTag = location?.startTag;
  if (!deferred.length || !startTag) return edits;
  const payload = escapeHtml({ text: JSON.stringify(Object.fromEntries(deferred.map(attr => [attr.name, attr.value]))) });
  return [...edits, { start: startTag.endOffset - 1, end: startTag.endOffset - 1, text: ` data-jini-consent-attributes="${payload}" data-jini-consent-category="${category}"` }];
}

/** Edits for one element, and whether its children still need gating.
 * @complexity O(attributes + text + k), plus O(subtree) when the element is wrapped. */
function gateElement({ element }: { element: Element }, options: ConsentGateOptions): { edits: Edit[]; descend: boolean } {
  const location = element.sourceCodeLocation;
  const attrs: Attrs = new Map(element.attrs.map(attr => [attr.name, attr.value]));
  const text = directText({ element });
  const runtime = isRuntimeScript({ element, attrs, text }, options);
  const reserved = runtime ? [] : reservedAttributes({ element });
  element.attrs = element.attrs.filter(attr => !reserved.includes(attr));
  if (location && isRemovedElement({ tagName: element.tagName, attrs })) {
    // An as=fetch preload can fetch the same optional script URL, so remove all resource hints.
    return { edits: [{ start: location.startOffset, end: location.endOffset, text: '' }], descend: false };
  }
  const remote = hasRemoteUrl({ attrs });
  const resource = isResource({ tagName: element.tagName, attrs, text, remote });
  const category = categoryFor({ declared: attrs.get('data-consent-category'), fetches: remote || resource });
  if (location && (resource || isOptionalScript({ element, attrs, text, runtime }, options))) return { edits: [wrapEdit({ element, location, category })], descend: false };
  // Authored template contents are already inert; traversing them would release never-mounted code.
  return { edits: attributeEdits({ element, location, reserved, category }), descend: element.tagName !== 'template' };
}

/** Walk the document once, recording html/head/body start-tag ends for the bootstrap insertions.
 * @complexity O(n) nodes. */
function gateDocument({ document }: { document: DefaultTreeAdapterMap['document'] }, options: ConsentGateOptions): { edits: Edit[]; startTagEnds: Record<string, number> } {
  const stack: Node[] = [...document.childNodes];
  const edits: Edit[] = [];
  const startTagEnds: Record<string, number> = {};
  while (stack.length) {
    const node = stack.pop()!;
    if (!('tagName' in node)) continue;
    const startTag = node.sourceCodeLocation?.startTag;
    if (startTag && ['html', 'head', 'body'].includes(node.tagName)) startTagEnds[node.tagName] = startTag.endOffset;
    const gated = gateElement({ element: node }, options);
    edits.push(...gated.edits);
    if (gated.descend) stack.push(...node.childNodes);
  }
  return { edits, startTagEnds };
}

/** Parse with a tree adapter that counts repeated html/body start tags. @complexity O(n). */
function parseCountingMerges({ html }: { html: string }): { document: DefaultTreeAdapterMap['document']; merges: number } {
  let merges = 0;
  const treeAdapter: TreeAdapter<DefaultTreeAdapterMap> = { ...defaultTreeAdapter, adoptAttributes(recipient, attrs) { merges++; defaultTreeAdapter.adoptAttributes(recipient, attrs); } };
  return { document: parse(html, { sourceCodeLocationInfo: true, scriptingEnabled: false, treeAdapter }), merges };
}

/** A repeated html/body start tag has no element of its own: the parser merges its new attributes
 * into the first element, and a browser re-parsing the delivered page merges them again, so
 * source-offset edits can neither defer nor strip them (even a handler the first tag already had
 * would return once the gate removes it there). Re-serialize the repaired tree once instead; it has
 * exactly one html and one body start tag, and every attribute has a source location.
 * Byte preservation is given up only for these malformed documents.
 * @throws Error when the normalized document still repeats a root tag. @complexity O(n). */
function locatedDocument({ html }: { html: string }): { html: string; document: DefaultTreeAdapterMap['document'] } {
  const parsed = parseCountingMerges({ html });
  if (parsed.merges === 0) return { html, document: parsed.document };
  // Without scripting, noscript children are elements; serializing them as raw text would change them.
  const normalized = serialize(parsed.document, { scriptingEnabled: false });
  const reparsed = parseCountingMerges({ html: normalized });
  if (reparsed.merges !== 0) throw new Error('Consent could not normalize repeated <html> or <body> start tags. Serve this page under the restrictive consent fallback.');
  return { html: normalized, document: reparsed.document };
}

/** Bootstrap goes first in head (else html, else after the doctype); the UI opens body. @complexity O(top-level nodes). */
function insertionOffsets({ document, startTagEnds }: { document: DefaultTreeAdapterMap['document']; startTagEnds: Record<string, number> }): { head: number; ui: number } {
  const doctypeEnd = document.childNodes.find(node => node.nodeName === '#documentType')?.sourceCodeLocation?.endOffset ?? 0;
  const head = startTagEnds.head ?? startTagEnds.html ?? doctypeEnd;
  return { head, ui: startTagEnds.body ?? head };
}

/** Gate delivered HTML using the existing parser, including no-JS and non-script requests.
 * Only host allowlisted scripts are necessary. JSON/JSON-LD and authored templates stay inert.
 * Resource hints are removed so browsers cannot fetch before consent. Source offsets preserve
 * unrelated markup byte-for-byte (except repeated html/body start tags, see locatedDocument);
 * wrapping a parent consumes its subtree without overlapping edits.
 * @throws Error when an attribute that must change cannot be located; never returns it ungated.
 * @complexity O(n + s log s + a*k) time/O(n) space: n bytes, s edits, a scripts, k manifest entries. */
export function gateConsentHtml({ html, config, record, regionMode, gpc, endpoint }: { html: string; config: ConsentConfig; record: ConsentRecord | null; regionMode: ConsentRegionMode; gpc: boolean; endpoint: string }, options: ConsentGateOptions = {}): string {
  if (!config.enabled) return html;
  const located = locatedDocument({ html });
  const document = located.document;
  html = located.html;
  const { edits, startTagEnds } = gateDocument({ document }, options);
  const offsets = insertionOffsets({ document, startTagEnds });
  edits.push({ start: offsets.head, end: offsets.head, text: renderConsentHead({ record, gpc, regionMode }, options) });
  edits.push({ start: offsets.ui, end: offsets.ui, text: renderConsentUi({ config, record, regionMode, gpc, endpoint }) });
  edits.sort((a, b) => b.start - a.start);
  for (const edit of edits) html = html.slice(0, edit.start) + edit.text + html.slice(edit.end);
  return html;
}
