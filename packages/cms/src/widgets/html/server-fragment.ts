/** Public plugin fragments are HTML, never same-origin script (ADR-025). Use the existing
 * HTML parser, not regex sanitization: decoded attributes and foreign namespaces matter. */
import { parseFragment, serialize, type DefaultTreeAdapterMap } from 'parse5';
const ELEMENTS: ReadonlySet<string> = new Set(['div','span','p','br','hr','strong','em','b','i','small','h1','h2','h3','h4','h5','h6','ul','ol','li','dl','dt','dd','blockquote','pre','code','a','img','figure','figcaption','table','thead','tbody','tr','th','td','section','article','aside','header','footer','nav','form','label','input','textarea','select','option','button']);
const ATTRIBUTES: ReadonlySet<string> = new Set(['id','class','title','role','href','src','alt','width','height','action','method','name','value','type','required','disabled','checked','selected','multiple','placeholder','for','rows','cols','min','max','step','colspan','rowspan']);
/** Reject executable/unsupported markup rather than quietly preserving a plugin's unsafe output.
 * URLs are local or HTTP(S); form submission remains native. No inline style, events, SVG,
 * iframe, script, srcdoc, data URLs, or enhancement assets are admitted. */
export function validateServerWidgetFragment(required: { html: string }, optional: { maxBytes?: number } = {}): string {
  if (new TextEncoder().encode(required.html).byteLength > (optional.maxBytes ?? 65536)) throw new Error('widget HTML exceeds its size cap');
  const root = parseFragment(required.html);
  const visit = (node: DefaultTreeAdapterMap['childNode']): void => {
    if ('tagName' in node) {
      if (node.namespaceURI !== 'http://www.w3.org/1999/xhtml' || !ELEMENTS.has(node.tagName)) throw new Error('executable or unsupported widget element');
      for (const attr of node.attrs) {
        if (attr.namespace || (!ATTRIBUTES.has(attr.name) && !/^aria-[a-z-]+$/.test(attr.name))) throw new Error('executable or unsupported widget attribute');
        if (['href','src','action'].includes(attr.name)) {
          // URL parsing catches entity-decoded schemes and embedded tab/newline obfuscation.
          const value = attr.value;
          if (/[\u0000-\u0020\\]/.test(value) || value.startsWith('//')) throw new Error('unsafe widget URL');
          const url = new URL(value, 'https://widget.invalid/');
          if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsafe widget URL');
        }
      }
      for (const child of node.childNodes) visit(child);
    }
  };
  for (const node of root.childNodes) visit(node);
  return serialize(root);
}
