/** Public plugin fragments are HTML, never inline script (ADR-025). Use the existing HTML parser,
 * not regex sanitization: decoded attributes and foreign namespaces matter. */
import { parseFragment, serialize, type DefaultTreeAdapterMap } from 'parse5';
const ELEMENTS: ReadonlySet<string> = new Set(['div','span','p','br','hr','strong','em','b','i','small','h1','h2','h3','h4','h5','h6','ul','ol','li','dl','dt','dd','blockquote','pre','code','a','img','figure','figcaption','table','thead','tbody','tr','th','td','section','article','aside','header','footer','nav','form','label','input','textarea','select','option','button']);
const ATTRIBUTES: ReadonlySet<string> = new Set(['id','class','title','role','href','src','alt','width','height','action','method','name','value','type','required','disabled','checked','selected','multiple','placeholder','for','rows','cols','min','max','step','colspan','rowspan']);
const FRAME_ATTRIBUTES: ReadonlySet<string> = new Set(['src','title','loading','width','height','class','id']);
// Host-, editor- and consent-owned names stay out of reach of a template's own data attributes.
const RESERVED_DATA = /^data-(?:embed|agent|jini|consent|plugin|component|src$)/;
/** Extra markup only a declared plugin export may use; ordinary server widgets get neither. */
export interface WidgetFragmentAllowances { readonly frames?: boolean; readonly dataAttributes?: boolean }

/** URL-bearing attributes stay local or HTTP(S); everything else is rejected. */
function assertSafeUrl(value: string): void {
  // URL parsing catches entity-decoded schemes and embedded tab/newline obfuscation.
  if (/[\u0000-\u0020\\]/.test(value) || value.startsWith('//')) throw new Error('unsafe widget URL');
  const url = new URL(value, 'https://widget.invalid/');
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsafe widget URL');
}

function isAllowedData(name: string, allowed: WidgetFragmentAllowances): boolean {
  return allowed.dataAttributes === true && /^data-[a-z][a-z0-9-]*$/.test(name) && !RESERVED_DATA.test(name);
}

function assertAllowedAttribute(attr: DefaultTreeAdapterMap['element']['attrs'][number], allowed: WidgetFragmentAllowances): void {
  if (attr.namespace || (!ATTRIBUTES.has(attr.name) && !/^aria-[a-z-]+$/.test(attr.name) && !isAllowedData(attr.name, allowed))) throw new Error('executable or unsupported widget attribute');
  if (['href','src','action'].includes(attr.name)) assertSafeUrl(attr.value);
}

/** A frame carries only its own short attribute list, so srcdoc and sandbox escapes never parse through. */
function assertAllowedFrame(node: DefaultTreeAdapterMap['element']): void {
  if (!node.attrs.some(attr => attr.name === 'src') || node.attrs.some(attr => attr.namespace || (!FRAME_ATTRIBUTES.has(attr.name) && !/^aria-[a-z-]+$/.test(attr.name)))) throw new Error('unsupported widget frame');
  assertSafeUrl(node.attrs.find(attr => attr.name === 'src')!.value);
}

function assertAllowedNode(node: DefaultTreeAdapterMap['childNode'], allowed: WidgetFragmentAllowances): void {
  if (!('tagName' in node)) return;
  const isFrame = allowed.frames === true && node.tagName === 'iframe';
  if (node.namespaceURI !== 'http://www.w3.org/1999/xhtml' || (!ELEMENTS.has(node.tagName) && !isFrame)) throw new Error('executable or unsupported widget element');
  if (isFrame) assertAllowedFrame(node);
  else for (const attr of node.attrs) assertAllowedAttribute(attr, allowed);
  for (const child of node.childNodes) assertAllowedNode(child, allowed);
}

/** Reject executable/unsupported markup rather than quietly preserving a plugin's unsafe output.
 * URLs are local or HTTP(S); form submission remains native. No inline style, events, SVG,
 * script, srcdoc, data URLs or enhancement assets are admitted; a declared plugin export alone may
 * also carry frames and its own data attributes, through `allowed`. */
export function validateServerWidgetFragment(required: { html: string }, optional: { maxBytes?: number; allowed?: WidgetFragmentAllowances } = {}): string {
  if (new TextEncoder().encode(required.html).byteLength > (optional.maxBytes ?? 65536)) throw new Error('widget HTML exceeds its size cap');
  const root = parseFragment(required.html);
  for (const node of root.childNodes) assertAllowedNode(node, optional.allowed ?? {});
  return serialize(root);
}
