import { parseFragment, serialize, type DefaultTreeAdapterMap } from 'parse5';
import type { FieldDescriptor } from '../types.js';

type Element = DefaultTreeAdapterMap['element'];
type Node = DefaultTreeAdapterMap['childNode'];
const attribute = (element: Element, name: string): string | undefined => element.attrs.find(item => item.name === name)?.value;
function setAttribute(element: Element, name: string, value?: string): void {
  element.attrs = element.attrs.filter(item => item.name !== name);
  if (value !== undefined) element.attrs.push({ name, value });
}
function elements(nodes: readonly Node[]): Element[] {
  const stack = [...nodes]; const found: Element[] = [];
  while (stack.length) {
    const node = stack.pop()!;
    if (!('tagName' in node)) continue;
    found.push(node);
    if (node.tagName !== 'template') stack.push(...node.childNodes);
  }
  return found;
}
function optionText(element: Element): string {
  return element.childNodes.map(node => 'value' in node ? node.value : '').join('').trim();
}
function restoreSelect(element: Element, field: FieldDescriptor): void {
  const values = Array.isArray(field.default) ? field.default : [field.default];
  for (const option of elements(element.childNodes).filter(node => node.tagName === 'option')) {
    setAttribute(option, 'selected', values.includes(attribute(option, 'value') ?? optionText(option)) ? '' : undefined);
  }
  // A single select otherwise silently picks its first option when its former choice is gone.
  if (field.default === undefined && attribute(element, 'multiple') === undefined) {
    const placeholder = parseFragment('<option value="" selected>Choose an option</option>').childNodes[0]!;
    placeholder.parentNode = element;
    element.childNodes.unshift(placeholder);
  }
}
function restoreInput(element: Element, field: FieldDescriptor): void {
  const type = attribute(element, 'type')?.toLowerCase();
  if (type === 'file') { setAttribute(element, 'value'); return; }
  if (type === 'radio' || type === 'checkbox') {
    const values = Array.isArray(field.default) ? field.default : [field.default];
    setAttribute(element, 'checked', values.includes(attribute(element, 'value') ?? 'on') ? '' : undefined);
    return;
  }
  setAttribute(element, 'value', field.default === undefined ? undefined : String(field.default));
}
/** Keep current authored prose/layout while applying only the prevalidated retry defaults.
 * parse5 encodes text/attributes; visitor text is never parsed as markup. Consent/file defaults
 * were cleared by the domain retry decision and are cleared again at this output boundary.
 * @complexity O(HTML bytes + controls + choices) time/space; no I/O. */
export function repopulateFormRetryHtml(
  { html, fields }: { html: string; fields: readonly FieldDescriptor[] },
  _optional = {},
): string {
  const fragment = parseFragment(html);
  const byName = new Map(fields.map(field => [field.name ?? field.id, field]));
  for (const element of elements(fragment.childNodes)) {
    const field = byName.get(attribute(element, 'name') ?? '');
    if (!field) continue;
    if (element.tagName === 'input') restoreInput(element, field);
    else if (element.tagName === 'select') restoreSelect(element, field);
    else if (element.tagName === 'textarea') element.childNodes = [{ nodeName: '#text', value: String(field.default ?? ''), parentNode: element }];
    else { /* Named authored non-controls have no value to restore. */ }
  }
  return serialize(fragment);
}
