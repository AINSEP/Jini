/** HTML authoring adapter. Unsanitized, admin/owner trusted markup, like HTML Pages.
 * parse5 supplies real HTML semantics (comments/scripts are never mistaken for inputs).
 * Prototype belongs in @jini-ai/cms/forms later; its published release lacks HTML authoring. */
import { parseFragment, serialize, type DefaultTreeAdapterMap } from "parse5";
import { FormFieldValidationError } from "../errors.js";
import type { FieldDescriptor } from "../types.js";
import { FIELD_TYPE_REGISTRY } from "../field-registry.js";

type Node = DefaultTreeAdapterMap["childNode"];
type Element = DefaultTreeAdapterMap["element"];
import type { FormAuthoring, HtmlFormDefinitionRecord } from "../fields-json.js";
export { decodeFormFields, encodeFormFields, type FormAuthoring, type HtmlFormDefinitionRecord } from "../fields-json.js";
type HtmlFieldDescriptor = FieldDescriptor & { checkboxValue?: string };

function invalid(reason: string): never {
  throw new FormFieldValidationError({ message: reason, fieldErrors: [{ field: "html", reason }] });
}

function elements(nodes: readonly Node[]): Element[] {
  const found: Element[] = [];
  const stack = [...nodes].reverse();
  while (stack.length) {
    const node = stack.pop()!;
    if (!("tagName" in node)) continue;
    found.push(node);
    // Templates are inert and do not contribute successful controls.
    if (node.tagName !== "template") stack.push(...[...node.childNodes].reverse());
  }
  return found;
}

function attr(element: Element, name: string): string | undefined {
  return element.attrs.find((item) => item.name === name)?.value;
}

function labelText(node: Element): string {
  const stack: Node[] = [...node.childNodes].reverse();
  let text = "";
  while (stack.length) {
    const child = stack.pop()!;
    if ("value" in child) text += child.value;
    else if ("tagName" in child && !["input", "select", "textarea", "script", "style"].includes(child.tagName)) {
      stack.push(...[...child.childNodes].reverse());
    }
  }
  return text.trim();
}

/** Read only the nearest fieldset's direct legend; blank/missing text keeps control-label fallback.
 * No I/O or mutation; O(d + c + t) time for ancestor depth, fieldset children and legend text,
 * with labelText's O(t) traversal space. */
function groupLabel({ element }: { element: Element }, _optional = {}): string | undefined {
  for (let parent = element.parentNode; parent && "tagName" in parent; parent = parent.parentNode) {
    if (parent.tagName !== "fieldset") continue;
    const legend = parent.childNodes.find((child): child is Element => "tagName" in child && child.tagName === "legend");
    return legend ? labelText(legend) || undefined : undefined;
  }
  return undefined;
}

/** Keep the author's required-attribute spelling while retaining parser normalization that
 * discards dangling outer form closers. Both attribute ranges come from parse5, not a regex
 * that could mistake a script string for a control. No attribute value is synthesized here. */
function serializeAuthoredRequired({ fragment, html }: { fragment: DefaultTreeAdapterMap["documentFragment"]; html: string }): string {
  const required = elements(fragment.childNodes).filter((element) => attr(element, "required") !== undefined)
    .map((element) => element.sourceCodeLocation?.attrs?.required)
    .map((location) => location ? html.slice(location.startOffset, location.endOffset) : undefined);
  let output = serialize(fragment);
  const generated = elements(parseFragment(output, { sourceCodeLocationInfo: true }).childNodes)
    .filter((element) => attr(element, "required") !== undefined);
  for (let index = generated.length - 1; index >= 0; index--) {
    // The reverse loop indexes only elements in the generated array.
    const location = generated[index]!.sourceCodeLocation?.attrs?.required;
    if (location && required[index]) output = output.slice(0, location.startOffset) + required[index] + output.slice(location.endOffset);
  }
  return output;
}

/** Derives the submission allowlist at save time and removes server-owned transport overrides.
 * Parsing normalizes HTML syntax; scripts and authored styling remain unsanitized. */
export function deriveHtmlForm(
  { html }: { html: string },
  _optional: Record<string, never> = {},
): { mode: "html"; html: string; fields: FieldDescriptor[] } {
  if (typeof html !== "string" || html.length > 200_000) invalid("HTML must be a string of at most 200000 characters");
  const fragment = parseFragment(html, { sourceCodeLocationInfo: true });
  const all = elements(fragment.childNodes);
  const forms = all.filter((element) => element.tagName === "form");
  if (forms.length > 1) invalid("Use a form body or one outer form wrapper");
  for (const form of forms) {
    const parent = form.parentNode;
    if (!parent) continue;
    const index = parent.childNodes.indexOf(form);
    parent.childNodes.splice(index, 1, ...form.childNodes);
    for (const child of form.childNodes) child.parentNode = parent;
  }
  const fields = new Map<string, HtmlFieldDescriptor>();
  const labels = all.filter((element) => element.tagName === "label");
  for (const element of all) {
    // A submit button's overrides or a control's `form` attribute must not bypass our endpoint.
    for (const name of ["form", "formaction", "formmethod", "formenctype", "formtarget"]) {
      element.attrs = element.attrs.filter((attribute) => attribute.name !== name);
    }
    if (!["input", "textarea", "select", "button"].includes(element.tagName)) continue;
    if (element.tagName === "button") {
      element.attrs = element.attrs.filter((attribute) => attribute.name !== "name"); // Buttons are actions, not submission columns.
      continue;
    }
    const name = attr(element, "name");
    if (!name) continue;
    if (name === "_hp" || ["__proto__", "constructor", "prototype"].includes(name)) invalid(`Reserved field name '${name}'`);
    const inputType = (attr(element, "type") ?? "text").toLowerCase();
    if (element.tagName === "input" && ["submit", "reset", "button", "image"].includes(inputType)) {
      element.attrs = element.attrs.filter((attribute) => attribute.name !== "name");
      continue;
    }
    if (element.tagName === "input" && inputType === "password") invalid("Password fields are not supported");
    const existing = fields.get(name);
    if (existing) {
      // Radio/checkbox controls share a successful-control name by design; collect their allowed
      // values rather than admitting arbitrary strings as the old HTML compatibility view did.
      if (inputType === "radio" && existing.type === "radio" || inputType === "checkbox" && ["checkbox", "checkbox-group"].includes(existing.type)) {
        const value = attr(element, "value") ?? "on";
        if (existing.type === "checkbox") {
          existing.type = "checkbox-group";
          existing.options = [{ value: existing.checkboxValue ?? "on", label: existing.label }];
          // Seed option one before replacing its standalone label with the group's legend.
          existing.label = groupLabel({ element }) ?? existing.label;
          delete existing.checkboxValue;
        }
        existing.options!.push({ value, label: element.parentNode && "tagName" in element.parentNode && element.parentNode.tagName === "label" ? labelText(element.parentNode) || value : value });
        existing.required = existing.required || attr(element, "required") !== undefined;
        continue;
      }
      invalid(`Duplicate field name '${name}'`);
    }
    // Earlier Jini releases stored only boolean checkboxes and forced the native "on" wire value.
    // Record attribute presence instead: authored strings survive while no-value boxes stay boolean.
    const checkboxValue = inputType === "checkbox" ? attr(element, "value") : undefined;
    const id = attr(element, "id");
    const parentLabel = element.parentNode && "tagName" in element.parentNode && element.parentNode.tagName === "label"
      ? element.parentNode : undefined;
    const label = labels.find((item) => id !== undefined && attr(item, "for") === id) ?? parentLabel;
    const maxLength = attr(element, "maxlength");
    const type: FieldDescriptor["type"] = element.tagName === "select" ? (attr(element, "multiple") !== undefined ? "multi-select" : "select")
      : element.tagName === "textarea" ? "textarea"
      : inputType === "checkbox" && attr(element, "role") === "switch" ? "toggle"
      : (Object.entries(FIELD_TYPE_REGISTRY).find(([, kind]) => kind.control === "input" && kind.htmlType === inputType)?.[0] as FieldDescriptor["type"] | undefined) ?? (inputType === "radio" ? "radio" : "text");
    const choices = element.tagName === "select" ? elements(element.childNodes).filter((child) => child.tagName === "option").map((option) => ({ value: attr(option, "value") ?? labelText(option), label: labelText(option) })).filter((option) => option.value !== "")
      : inputType === "radio" ? [{ value: attr(element, "value") ?? "on", label: label ? labelText(label) || name : attr(element, "value") ?? "on" }] : undefined;
    const numeric = type === "number" || type === "range";
    const descriptor: HtmlFieldDescriptor = {
      id: name,
      label: (type === "radio" ? groupLabel({ element }) : undefined) ?? (label ? labelText(label) || name : attr(element, "aria-label") || name),
      type,
      required: attr(element, "required") !== undefined,
      ...(checkboxValue !== undefined && type === "checkbox" ? { checkboxValue } : {}),
      ...(maxLength !== undefined ? { maxLength: Number(maxLength) } : {}),
      ...(choices ? { options: choices } : {}),
    };
    for (const key of ["placeholder", "pattern"] as const) {
      const value = attr(element, key); if (value !== undefined) descriptor[key] = value;
    }
    for (const key of ["min", "max"] as const) {
      const value = attr(element, key); if (value !== undefined) descriptor[key] = numeric ? Number(value) : value;
    }
    const minLength = attr(element, "minlength"); if (minLength !== undefined) descriptor.minLength = Number(minLength);
    const step = attr(element, "step"); if (step !== undefined) descriptor.step = Number(step);
    const accept = attr(element, "accept"); if (accept !== undefined && type === "file") descriptor.accept = accept.split(",").map((item) => item.trim());
    fields.set(name, descriptor);
  }
  // Re-serialization also discards ignored/dangling </form> tokens: they must never close our
  // server-owned wrapper early. Raw-text script contents are preserved by the HTML serializer.
  return { mode: "html", html: serializeAuthoredRequired({ fragment, html }), fields: [...fields.values()] };
}
