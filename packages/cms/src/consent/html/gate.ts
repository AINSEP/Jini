import { defaultTreeAdapter, parse, serializeOuter, type DefaultTreeAdapterMap, type TreeAdapter } from 'parse5';
import { escapeHtml } from '@jini-ai/core/text';
import { type ConsentConfig, type ConsentRecord, type ConsentRegionMode } from '../types.js';
import { renderConsentHead, renderConsentUi, type ConsentCategoryOrigins } from './render.js';
import { CONSENT_CLIENT } from './client.js';
import { cssRequestsRemote, external } from './resources.js';

type Node = DefaultTreeAdapterMap['childNode'];
type Element = DefaultTreeAdapterMap['element'];
type Attribute = Element['attrs'][number];
type ElementLocation = NonNullable<Element['sourceCodeLocation']>;
type Edit = { start: number; end: number; text: string };
type Attrs = Map<string, string>;
/** Exact host manifest entries, never declarations taken from page HTML. */
export interface ConsentGateOptions {
  nonce?: string;
  /** Static pages need a native reopening control even when the host omitted its footer link. */
  ensureReopenLink?: boolean;
  /** Host-resolved page origin, used only to retain first-party preloads. */
  pageOrigin?: string;
  runtimeToken?: string;
  /** Host-reviewed theme origins allowed by the pre-consent resource policy. */
  resourceOrigins?: readonly string[];
  /** Host-reviewed origins each granted category may reach before a marketing grant. */
  categoryOrigins?: ConsentCategoryOrigins;
  necessaryScripts?: readonly ({ src: string; content?: never } | { content: string; src?: never })[];
}

const RESERVED_IDS = ['jini-consent', 'jini-consent-config', 'jini-consent-preferences'];
const RESOURCE_HINTS = ['preload', 'modulepreload', 'prefetch', 'prerender', 'preconnect', 'dns-prefetch'];
const METADATA_RELS = ['canonical', 'alternate', 'author', 'license'];
// These metadata rels make the browser fetch (icons, manifests, Firefox's rel=next prefetch), and
// the resource CSP has no manifest/prefetch directive, so only trusted URLs skip the resource policy.
const FETCHING_METADATA_RELS = ['icon', 'apple-touch-icon', 'manifest', 'next', 'prev'];
const PRELOAD_RELS = ['preload', 'modulepreload'];
const DATA_SCRIPT_TYPES = ['application/json', 'application/ld+json', 'text/plain', 'text/template', 'text/x-template'];
const URL_ATTRIBUTES = ['src', 'href', 'poster', 'data', 'srcset', 'background'];
const RESOURCE_TAGS = ['iframe', 'frame', 'object', 'embed'];
const IMAGE_TAGS = ['img', 'image', 'input'];
const NAVIGATION_TAGS = ['a', 'area', 'form', 'html', 'head', 'body', 'script'];
const STRUCTURAL_TAGS = ['html', 'head', 'body', 'script', 'noscript'];
const OPTIONAL_CATEGORIES = ['functional', 'analytics', 'marketing'];
const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

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
  return element.attrs.filter(attr => (attr.name.startsWith('data-jini-consent-') && attr.name !== 'data-jini-consent-open') || (attr.name === 'id' && RESERVED_IDS.includes(attr.value)));
}

/** @complexity O(rel tokens). */
function linkRels({ attrs }: { attrs: Attrs }): string[] {
  return (attrs.get('rel') ?? '').toLowerCase().split(/\s+/).filter(Boolean);
}

/** Relative URLs, the host-resolved page origin and host-reviewed resourceOrigins are first-party;
 * authored HTML never supplies trusted origins. @complexity O(URL length + trusted origins). */
function isTrustedUrl({ url }: { url: string }, { pageOrigin, resourceOrigins = [] }: ConsentGateOptions = {}): boolean {
  if (!external({ url })) return true;
  try {
    const origin = new URL(url, pageOrigin).origin;
    return (pageOrigin !== undefined && new URL(pageOrigin).origin === origin) || resourceOrigins.includes(origin);
  } catch { return false; }
}

/** A link fetches its href and, as an image preload, every imagesrcset candidate. Unparseable
 * candidates (e.g. data: URLs with commas) fail closed. @complexity O(URL length + trusted origins). */
function linkFetchesTrusted({ attrs }: { attrs: Attrs }, options: ConsentGateOptions = {}): boolean {
  const href = attrs.get('href');
  const candidates = (attrs.get('imagesrcset') ?? '').split(',').map(candidate => candidate.trim().split(/\s+/)[0]!).filter(Boolean);
  return Boolean(href) && [href!, ...candidates].every(url => isTrustedUrl({ url }, options));
}

/** Only first-party/trusted preloads survive; other hints can initiate uncontrolled requests.
 * @complexity O(rel tokens + URL length + trusted origins). */
function isAllowedPreload({ tagName, attrs }: { tagName: string; attrs: Attrs }, options: ConsentGateOptions = {}): boolean {
  const rels = tagName === 'link' ? linkRels({ attrs }) : [];
  return rels.length > 0 && rels.every(rel => PRELOAD_RELS.includes(rel)) && linkFetchesTrusted({ attrs }, options);
}

/** Metadata describes the page even when an author mistakenly labels it optional: crawlers never
 * consent. Mixed resource rels and untrusted fetching rels still follow the resource policy.
 * Meta refresh is removed before this check. @complexity O(rel tokens + URL length + trusted origins). */
function isMetadata({ tagName, attrs }: { tagName: string; attrs: Attrs }, options: ConsentGateOptions = {}): boolean {
  if (tagName === 'meta') return true;
  // HTML never executes this type, whatever its label, src or handlers (handlers are stripped).
  if (tagName === 'script') return (attrs.get('type') ?? '').trim().toLowerCase() === 'application/ld+json';
  const rels = tagName === 'link' ? linkRels({ attrs }) : [];
  if (!rels.length || !rels.every(rel => METADATA_RELS.includes(rel) || FETCHING_METADATA_RELS.includes(rel))) return false;
  return rels.every(rel => METADATA_RELS.includes(rel)) || linkFetchesTrusted({ attrs }, options);
}

/** Refresh/base can navigate; untrusted hints can fetch outside the resource policy.
 * @complexity O(rel tokens + trusted origins). */
function isRemovedElement({ tagName, attrs }: { tagName: string; attrs: Attrs }, options: ConsentGateOptions = {}): boolean {
  if (tagName === 'base') return true;
  if (tagName === 'meta') return attrs.get('http-equiv')?.toLowerCase() === 'refresh';
  const hint = tagName === 'link' && linkRels({ attrs }).some(value => RESOURCE_HINTS.includes(value));
  return hint && !isAllowedPreload({ tagName, attrs }, options);
}

/** Exempt markup must never carry executable attributes into the browser or a release payload.
 * @complexity O(attributes). */
function exemptEdits({ element, reserved, location }: { element: Element; reserved: Attribute[]; location: Element['sourceCodeLocation'] }, _options = {}): Edit[] {
  const unsafe = element.attrs.filter(attr => /^on/i.test(attr.name) || isDeferredAttribute(attr) || (URL_ATTRIBUTES.includes(attr.name) && isJavascriptUrl({ value: attr.value })));
  return removeAttributes({ element, attrs: [...reserved, ...unsafe], location });
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
  if (tagName === 'style' && cssRequestsRemote({ css: text })) return true;
  // noscript must stay visible without JavaScript; its children are gated by the same walk.
  return attrs.has('data-consent-category') && !STRUCTURAL_TAGS.includes(tagName);
}

/** Page labels may select optional categories; they can never grant necessity. @complexity O(1). */
function categoryFor({ declared, fetches }: { declared: string | undefined; fetches: boolean }): string {
  if (declared === undefined || declared === 'necessary') return fetches ? 'marketing' : 'functional';
  return OPTIONAL_CATEGORIES.includes(declared) ? declared : 'blocked';
}

/** Host-reviewed external exceptions retain exact matching. @complexity O(k) for k manifest entries. */
function isNecessaryScript({ attrs, text }: { attrs: Attrs; text: string }, { necessaryScripts = [] }: ConsentGateOptions): boolean {
  return necessaryScripts.some(entry => entry.src !== undefined ? attrs.get('src') === entry.src : !attrs.has('src') && text === entry.content);
}

/** Inline speculation rules stay gated: like the removed resource hints, they prefetch/prerender
 * other origins outside the resource CSP. @complexity O(URL length). */
function scriptFetches({ attrs, type }: { attrs: Attrs; type: string }): boolean {
  return type === 'speculationrules' || (attrs.has('src') && external({ url: attrs.get('src')! }));
}

/** Unlabelled inline/local code runs by default; explicit optional labels always win over host
 * exceptions. External code (including legacy MIME types/import maps) stays gated. @complexity O(k). */
function isOptionalScript({ element, attrs, text, runtime }: { element: Element; attrs: Attrs; text: string; runtime: boolean }, options: ConsentGateOptions): boolean {
  if (element.tagName !== 'script' || runtime) return false;
  const declared = attrs.get('data-consent-category');
  if (declared !== undefined && declared !== 'necessary') return true;
  const type = (attrs.get('type') ?? '').trim().toLowerCase();
  if (DATA_SCRIPT_TYPES.includes(type)) return false;
  return scriptFetches({ attrs, type }) && !isNecessaryScript({ attrs, text }, options);
}

/** @complexity O(subtree size). */
function wrapEdit({ element, location, category }: { element: Element; location: ElementLocation; category: string }): Edit {
  // Normalize ignored/misnested end tags so they cannot escape the new template boundary.
  const source = serializeOuter(element, { scriptingEnabled: false });
  // A template in SVG/MathML is not an inert HTML template. Remove foreign scripts/resources.
  const marker = element.tagName === 'script' ? 'data-jini-consent-script' : 'data-jini-consent-resource';
  return { start: location.startOffset, end: location.endOffset, text: element.namespaceURI === HTML_NAMESPACE ? `<template ${marker} data-category="${category}">${source}</template>` : '' };
}

/** Use the browser URL parser: HTML entities are already decoded by parse5, and URL parsing
 * removes embedded tabs/CR/LF as well as leading controls. @complexity O(URL length). */
function isJavascriptUrl({ value }: { value: string }): boolean {
  try { return new URL(value, 'https://consent.invalid/').protocol === 'javascript:'; }
  catch { return false; }
}

/** @complexity O(attribute length). */
function isDeferredAttribute({ name, value }: Attribute): boolean {
  if (name === 'background' && external({ url: value })) return true;
  if (['href', 'action', 'formaction'].includes(name)) return isJavascriptUrl({ value });
  return name === 'style' && cssRequestsRemote({ css: value });
}

/** Foreign content renames parsed attributes (viewbox→viewBox, xlink:href→prefix xlink + href);
 * source locations keep the tokenized spelling. The prefix is rejoined here; case adjustments
 * (viewBox, definitionURL) are not, because only reserved `data-jini-consent-*`/`id` and deferred
 * `on*`/`href`/`action`/`formaction`/`background`/`style` attributes are ever located, and parse5
 * adjusts the case of none of them. Should that set grow, a miss throws in removeAttributes and the
 * page is refused (fail closed), never delivered with the attribute intact. Elements the parser
 * synthesized (an adoption-agency clone of a misnested formatting element) have no start tag at
 * all and also miss. @complexity O(1). */
function attributeLocation({ attr, location }: { attr: Attribute; location: ElementLocation | null | undefined }) {
  const name = attr.prefix ? `${attr.prefix}:${attr.name}` : attr.name;
  return location?.startTag ? location.attrs?.[name] : undefined;
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
function attributeEdits({ element, location, reserved, category, declared }: { element: Element; location: Element['sourceCodeLocation']; reserved: Attribute[]; category: string; declared: string | undefined }): Edit[] {
  // UI handlers are first-party code. Only an explicit label defers them; remote-fetching
  // styles and javascript: navigation retain their existing restrictions.
  const labelled = declared !== undefined && declared !== 'necessary';
  const deferred = element.attrs.filter(attr => isDeferredAttribute(attr) || (labelled && /^on/i.test(attr.name)));
  const edits = removeAttributes({ element, attrs: [...reserved, ...deferred], location });
  const startTag = location?.startTag;
  if (!deferred.length || !startTag) return edits;
  const payload = escapeHtml({ text: JSON.stringify(Object.fromEntries(deferred.map(attr => [attr.name, attr.value]))) });
  return [...edits, { start: startTag.endOffset - 1, end: startTag.endOffset - 1, text: ` data-jini-consent-attributes="${payload}" data-jini-consent-category="${category}"` }];
}

/** Resolve metadata and trusted preload exceptions before resource/category classification.
 * Foreign scripts do not share HTML's inert data-script contract. @complexity O(attributes + origins). */
function gateExemptElement({ element, attrs, reserved, location }: { element: Element; attrs: Attrs; reserved: Attribute[]; location: Element['sourceCodeLocation'] }, options: ConsentGateOptions = {}): { edits: Edit[]; descend: boolean } | null {
  if (location && isRemovedElement({ tagName: element.tagName, attrs }, options)) {
    // An as=fetch preload can fetch the same optional script URL, so remove every untrusted resource hint.
    return { edits: [{ start: location.startOffset, end: location.endOffset, text: '' }], descend: false };
  }
  if (element.namespaceURI !== HTML_NAMESPACE) return null;
  if (!isMetadata({ tagName: element.tagName, attrs }, options) && !isAllowedPreload({ tagName: element.tagName, attrs }, options)) return null;
  return { edits: exemptEdits({ element, reserved, location }), descend: false };
}

/** Edits for one element, and whether its children still need gating.
 * @complexity O(attributes + text + k), plus O(subtree) when the element is wrapped. */
function gateElement({ element, inheritedCategory }: { element: Element; inheritedCategory: string | undefined }, options: ConsentGateOptions): { edits: Edit[]; descend: boolean } {
  const location = element.sourceCodeLocation;
  const attrs: Attrs = new Map(element.attrs.map(attr => [attr.name, attr.value]));
  // Noscript cannot itself be templated (no-JS visitors would lose the fallback), so its
  // optional category is carried into its descendants instead.
  if (inheritedCategory !== undefined && !attrs.has('data-consent-category')) attrs.set('data-consent-category', inheritedCategory);
  const text = directText({ element });
  const runtime = isRuntimeScript({ element, attrs, text }, options);
  const reserved = runtime ? [] : reservedAttributes({ element });
  element.attrs = element.attrs.filter(attr => !reserved.includes(attr));
  const exempt = gateExemptElement({ element, attrs, reserved, location }, options);
  if (exempt) return exempt;
  const remote = hasRemoteUrl({ attrs });
  const resource = isResource({ tagName: element.tagName, attrs, text, remote });
  const category = categoryFor({ declared: attrs.get('data-consent-category'), fetches: remote || resource });
  if (location && (resource || isOptionalScript({ element, attrs, text, runtime }, options))) return { edits: [wrapEdit({ element, location, category })], descend: false };
  // Authored template contents are already inert; traversing them would release never-mounted code.
  return { edits: attributeEdits({ element, location, reserved, category, declared: attrs.get('data-consent-category') }), descend: element.tagName !== 'template' };
}

/** Noscript passes its label to descendants. Document-root labels defer only their own handlers:
 * inheriting one would template the whole page. A necessary label grants nothing, so it is not
 * inherited either. @complexity O(attributes). */
function inheritedCategory({ element, category }: { element: Element; category: string | undefined }): string | undefined {
  if (element.tagName !== 'noscript') return category;
  const declared = element.attrs.find(attr => attr.name === 'data-consent-category')?.value;
  return declared === undefined || declared === 'necessary' ? category : declared;
}

/** Walk the document once, recording html/head/body start-tag ends for the bootstrap insertions.
 * @complexity O(n) nodes. */
function gateDocument({ document }: { document: DefaultTreeAdapterMap['document'] }, options: ConsentGateOptions = {}): { edits: Edit[]; startTagEnds: Record<string, number>; hasReopenLink: boolean } {
  const stack: { node: Node; category: string | undefined }[] = document.childNodes.map(node => ({ node, category: undefined }));
  const edits: Edit[] = [];
  const startTagEnds: Record<string, number> = {};
  let hasReopenLink = false;
  while (stack.length) {
    const { node, category } = stack.pop()!;
    if (!('tagName' in node)) continue;
    const startTag = node.sourceCodeLocation?.startTag;
    if (startTag && ['html', 'head', 'body'].includes(node.tagName)) startTagEnds[node.tagName] = startTag.endOffset;
    const gated = gateElement({ element: node, inheritedCategory: category }, options);
    edits.push(...gated.edits);
    if (gated.descend) {
      hasReopenLink ||= isReopenLink({ element: node });
      const childCategory = inheritedCategory({ element: node, category });
      stack.push(...node.childNodes.map(node => ({ node, category: childCategory })));
    }
  }
  return { edits, startTagEnds, hasReopenLink };
}

/** Only a retained native anchor counts; a link inside a gated template cannot reopen the UI.
 * @complexity O(attributes), using the document walk already owned by the HTML gate. */
function isReopenLink({ element }: { element: Element }): boolean {
  return element.tagName === 'a' && element.attrs.some(attr => attr.name === 'href' && attr.value === '#jini-consent') && element.attrs.some(attr => attr.name === 'data-jini-consent-open');
}

/** Count merged roots and ignored duplicate attributes through the existing parser.
 * Removing only the retained attribute's source span would expose its ignored duplicate when
 * the browser reparses it. Normalize the whole tree before any offset edits. @complexity O(n). */
function parseForNormalization({ html }: { html: string }): { document: DefaultTreeAdapterMap['document']; normalize: boolean } {
  let normalize = false;
  const treeAdapter: TreeAdapter<DefaultTreeAdapterMap> = { ...defaultTreeAdapter, adoptAttributes(recipient, attrs) { normalize = true; defaultTreeAdapter.adoptAttributes(recipient, attrs); } };
  const document = parse(html, { sourceCodeLocationInfo: true, scriptingEnabled: false, treeAdapter,
    onParseError(error) { if (error.code === 'duplicate-attribute') normalize = true; },
  });
  return { document, normalize };
}

/** parse5's serializer drops public/system doctype IDs, which can switch quirks mode. Keep the
 * original doctype token, including malformed legacy doctypes. @complexity O(n) document bytes. */
function serializePreservingDoctype({ html, document }: { html: string; document: DefaultTreeAdapterMap['document'] }): string {
  return document.childNodes.map(node => {
    const location = node.sourceCodeLocation;
    if (node.nodeName === '#documentType' && location) return html.slice(location.startOffset, location.endOffset);
    // Without scripting, noscript children are elements; serializing them as raw text changes them.
    return serializeOuter(node, { scriptingEnabled: false });
  }).join('');
}

/** A repeated html/body start tag has no element of its own: the parser merges its new attributes
 * into the first element, and a browser reparsing the delivered page merges them again. Offset
 * edits cannot remove them, even when the first tag already had the handler being removed.
 * Duplicate attributes likewise hide later source occurrences. Re-serialize the repaired tree
 * once so every retained attribute has one source location and edits cannot expose ignored code.
 * Byte preservation is given up only for malformed documents needing normalization.
 * @throws Error when the normalized document still contains ambiguous attributes. @complexity O(n). */
function locatedDocument({ html }: { html: string }): { html: string; document: DefaultTreeAdapterMap['document'] } {
  const parsed = parseForNormalization({ html });
  if (!parsed.normalize) return { html, document: parsed.document };
  const normalized = serializePreservingDoctype({ html, document: parsed.document });
  const reparsed = parseForNormalization({ html: normalized });
  if (reparsed.normalize) throw new Error('Consent could not normalize repeated root tags or duplicate attributes. Serve this page under the restrictive consent fallback.');
  return { html: normalized, document: reparsed.document };
}

/** Bootstrap goes first in head (else html, else after the doctype); the UI opens body. @complexity O(top-level nodes). */
function insertionOffsets({ document, startTagEnds }: { document: DefaultTreeAdapterMap['document']; startTagEnds: Record<string, number> }): { head: number; ui: number } {
  const doctypeEnd = document.childNodes.find(node => node.nodeName === '#documentType')?.sourceCodeLocation?.endOffset ?? 0;
  const head = startTagEnds.head ?? startTagEnds.html ?? doctypeEnd;
  return { head, ui: startTagEnds.body ?? head };
}

/** Gate delivered HTML using the existing parser, including no-JS and non-script requests.
 * Unlabelled inline/local code and media run by default; optional labels and external resources
 * remain gated. JSON/JSON-LD and authored templates stay inert.
 * Untrusted resource hints are removed so browsers cannot fetch before consent. Source offsets preserve
 * unrelated markup byte-for-byte (except repeated roots/duplicate attributes, see locatedDocument);
 * wrapping a parent consumes its subtree without overlapping edits.
 * @throws Error when an attribute that must change cannot be located; never returns it ungated.
 * @complexity O(n + s log s + a*k) time/O(n) space: n bytes, s edits, a scripts, k manifest entries. */
export function gateConsentHtml({ html, config, record, regionMode, gpc, endpoint }: { html: string; config: ConsentConfig; record: ConsentRecord | null; regionMode: ConsentRegionMode; gpc: boolean; endpoint: string }, options: ConsentGateOptions = {}): string {
  if (!config.enabled) return html;
  const located = locatedDocument({ html });
  const document = located.document;
  html = located.html;
  const { edits, startTagEnds, hasReopenLink } = gateDocument({ document }, options);
  const offsets = insertionOffsets({ document, startTagEnds });
  edits.push({ start: offsets.head, end: offsets.head, text: renderConsentHead({ record, gpc, regionMode, config }, options) });
  const reopenLink = options.ensureReopenLink && !hasReopenLink ? `<a href="#jini-consent" data-jini-consent-open>${escapeHtml({ text: config.preferencesLabel })}</a>` : '';
  edits.push({ start: offsets.ui, end: offsets.ui, text: reopenLink + renderConsentUi({ config, record, regionMode, gpc, endpoint }) });
  edits.sort((a, b) => b.start - a.start);
  for (const edit of edits) html = html.slice(0, edit.start) + edit.text + html.slice(edit.end);
  return html;
}
