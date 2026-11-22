import { parseFragment, type DefaultTreeAdapterMap } from "parse5";

type Node = DefaultTreeAdapterMap["childNode"];
type Element = DefaultTreeAdapterMap["element"];
function attribute({ node, name }: { node: Element; name: string }, _optional = {}) { return node.attrs.find((attr) => attr.name === name)?.value; }
function traversableChildren({ node }: { node: Node }, _optional = {}): Node[] {
  if (!("tagName" in node) || ["input", "textarea", "select", "script", "style", "template"].includes(node.tagName)) return [];
  return [...node.childNodes].reverse();
}

function text(node: Node): string {
  let result = "";
  const stack: Node[] = [node];
  while (stack.length) {
    const current = stack.pop();
    if (!current) throw new Error("form validation text traversal has an empty stack");
    if (current.nodeName === "#text" && "value" in current) result += current.value;
    else stack.push(...traversableChildren({ node: current }));
  }
  return result;
}
function elements(nodes: readonly Node[]): Element[] {
  const found: Element[] = [];
  const stack = [...nodes].reverse();
  while (stack.length) {
    const node = stack.pop();
    if (!node) throw new Error("form validation element traversal has an empty stack");
    if (!("tagName" in node) || ["script", "style", "template"].includes(node.tagName)) continue;
    found.push(node);
    stack.push(...[...node.childNodes].reverse());
  }
  return found;
}

const CONTROL_TAGS = ["input", "textarea", "select"];

function wrappingLabel(control: Element): Element | undefined {
  for (let parent = control.parentNode; parent && "tagName" in parent; parent = parent.parentNode) {
    if (parent.tagName === "label") return parent;
  }
  return undefined;
}

/** aria-label wins, then label[for=id], then the closest wrapping label. */
function authoredLabel({ control, labels }: { control: Element | undefined; labels: readonly Element[] }, _optional = {}): string | undefined {
  if (!control) return undefined;
  const aria = attribute({ node: control, name: "aria-label" });
  if (aria) return aria;
  const id = attribute({ node: control, name: "id" });
  const linked = id ? labels.find((node) => attribute({ node, name: "for" }) === id) : undefined;
  const label = linked ?? wrappingLabel(control);
  return label && text(label);
}

/** Labels come from the actual server-rendered form, never visitor-controlled result params.
 * parse5 handles entities and label/control associations without treating scripts as controls. */
export function inspectFormLabels(
  { formHtml, fields }: { formHtml: string; fields: readonly string[] }, _optional = {},
) {
  const nodes = elements(parseFragment(formHtml).childNodes);
  const form = nodes.find((node) => node.tagName === "form");
  const labels = nodes.filter((node) => node.tagName === "label");
  const controls = new Map<string, { label?: string | undefined; type?: string | undefined; maxLength?: string | undefined }>();
  for (const field of fields) {
    const control = nodes.find((node) => CONTROL_TAGS.includes(node.tagName) && attribute({ node, name: "name" }) === field);
    if (control) controls.set(field, {
      label: authoredLabel({ control, labels }),
      type: attribute({ node: control, name: "type" }),
      maxLength: attribute({ node: control, name: "maxlength" }),
    });
  }
  return { formLocale: form && attribute({ node: form, name: "lang" }), controls };
}
