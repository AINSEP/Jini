/** HTML authoring adapter. Unsanitized, admin/owner trusted markup, like HTML Pages.
 * parse5 supplies real HTML semantics (comments/scripts are never mistaken for inputs).
 * Prototype belongs in @jini-ai/cms/forms later; its published release lacks HTML authoring. */
import { parseFragment, serialize, type DefaultTreeAdapterMap } from "parse5";
import { FormFieldValidationError } from "../errors.js";
import type { FieldDescriptor } from "../types.js";
import { FIELD_TYPE_REGISTRY } from "../field-registry.js";
export { decodeFormFields, encodeFormFields, type FormAuthoring, type HtmlFormDefinitionRecord } from "../fields-json.js";

type Node = DefaultTreeAdapterMap["childNode"];
type Element = DefaultTreeAdapterMap["element"];

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

/** Native `type="url"` refuses scheme-less domains (owner bug 2026-10-13); the registry's text control keeps URL hints. */
function toUrlTextControl(element: Element): void {
  for (const [name, value] of Object.entries({ type: FIELD_TYPE_REGISTRY.url.htmlType, ...FIELD_TYPE_REGISTRY.url.attributes })) {
    removeAttributes(element, [name]);
    element.attrs.push({ name, value });
  }
}

function labelText(node: Element): string {
  const stack: Node[] = [...node.childNodes].reverse();
  let text = "";
  while (stack.length) {
    const child = stack.pop()!;
    if ("value" in child) text += child.value;
    else if ("tagName" in child && !["input", "select", "textarea", "script", "style"].includes(child.tagName)) {
      stack.push(...[...child.childNodes].reverse());
    } else {
      // Controls, executable elements and non-text nodes do not contribute to a label.
    }
  }
  return text.trim();
}

/** Read only the nearest fieldset's direct legend; blank/missing text keeps control-label fallback.
 * No I/O or mutation; O(d + c + t) time for ancestor depth, fieldset children and legend text,
 * with labelText's O(t) traversal space. */
function groupLabel({ element }: { element: Element }): string | undefined {
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

/** Forms saved before 2026-10-13 store native `type="url"` controls, served as-is on the public page.
 * Upgrade them on read so bare domains stop being blocked without an owner re-save; other markup is untouched. */
export function upgradeLegacyUrlControls({ html }: { html: string }, _optional: Record<string, never> = {}): string {
  const fragment = parseFragment(html, { sourceCodeLocationInfo: true });
  const legacy = elements(fragment.childNodes).filter((element) => element.tagName === "input" && attr(element, "type")?.toLowerCase() === "url");
  if (legacy.length === 0) return html;
  legacy.forEach(toUrlTextControl);
  return serializeAuthoredRequired({ fragment, html });
}

/** Attributes that would let a submit button or a control bypass the server-owned endpoint. */
const TRANSPORT_OVERRIDES = ["form", "formaction", "formmethod", "formenctype", "formtarget"];
const CONTROL_TAGS = ["input", "textarea", "select", "button"];
const RESERVED_NAMES = ["_hp", "__proto__", "constructor", "prototype"];
const ACTION_INPUT_TYPES = ["submit", "reset", "button", "image"];
/** Existing field types a repeated control of this input type may join. A Map, not an object
 * literal, so an authored type such as "constructor" cannot reach Object.prototype. */
const GROUP_JOINS: ReadonlyMap<string, readonly string[]> = new Map<string, readonly string[]>([["radio", ["radio"]], ["checkbox", ["checkbox", "checkbox-group"]]]);

function removeAttributes(element: Element, names: readonly string[]): void {
  element.attrs = element.attrs.filter((attribute) => !names.includes(attribute.name));
}

function wrappingLabel(element: Element): Element | undefined {
  const parent = element.parentNode;
  return parent && "tagName" in parent && parent.tagName === "label" ? parent : undefined;
}

/** Spread helper: an absent attribute adds no descriptor key, so stored JSON keeps its old shape. */
function ifPresent(value: string | undefined, toFields: (value: string) => Partial<FieldDescriptor>): Partial<FieldDescriptor> {
  return value === undefined ? {} : toFields(value);
}

/** Lift the single optional outer `<form>` wrapper's children into its place; the server owns the real form. */
function unwrapOuterForm(all: readonly Element[]): void {
  const forms = all.filter((element) => element.tagName === "form");
  if (forms.length > 1) invalid("Use a form body or one outer form wrapper");
  const [form] = forms;
  if (!form) return;
  // elements() only returns nodes it found in a childNodes list, so a form always has a parent.
  const parent = form.parentNode!;
  parent.childNodes.splice(parent.childNodes.indexOf(form), 1, ...form.childNodes);
  for (const child of form.childNodes) child.parentNode = parent;
}

/** The submission column a control posts under, or undefined for non-controls, actions and unnamed
 * controls. Refuses reserved names and passwords; strips the name from actions so they never post. */
function columnName({ element, inputType }: { element: Element; inputType: string }): string | undefined {
  if (!CONTROL_TAGS.includes(element.tagName)) return undefined;
  if (element.tagName === "button") {
    removeAttributes(element, ["name"]); // Buttons are actions, not submission columns.
    return undefined;
  }
  const name = attr(element, "name");
  if (!name) return undefined;
  if (RESERVED_NAMES.includes(name)) invalid(`Reserved field name '${name}'`);
  if (element.tagName !== "input") return name;
  if (ACTION_INPUT_TYPES.includes(inputType)) {
    removeAttributes(element, ["name"]);
    return undefined;
  }
  if (inputType === "password") invalid("Password fields are not supported");
  return name;
}

/** Add a repeated radio/checkbox control to its existing field's options; any other repeat is refused. */
function addGroupOption({ element, inputType, existing, name }: { element: Element; inputType: string; existing: FieldDescriptor; name: string }): void {
  // Radio/checkbox controls share a successful-control name by design; collect their allowed
  // values rather than admitting arbitrary strings as the old HTML compatibility view did.
  if (!GROUP_JOINS.get(inputType)?.includes(existing.type)) invalid(`Duplicate field name '${name}'`);
  const value = attr(element, "value") ?? "on";
  if (existing.type === "checkbox") {
    existing.type = "checkbox-group";
    existing.options = [{ value: existing.checkboxValue ?? "on", label: existing.label }];
    // Seed option one before replacing its standalone label with the group's legend.
    existing.label = groupLabel({ element }) ?? existing.label;
    delete existing.checkboxValue;
  }
  const parentLabel = wrappingLabel(element);
  existing.options!.push({ value, label: (parentLabel && labelText(parentLabel)) || value });
  existing.required = existing.required || attr(element, "required") !== undefined;
}

/** Map a control to its registry type; URL-hinted text inputs count as URL fields. */
function controlType({ element, inputType }: { element: Element; inputType: string }): FieldDescriptor["type"] {
  if (element.tagName === "select") return attr(element, "multiple") !== undefined ? "multi-select" : "select";
  if (element.tagName === "textarea") return "textarea";
  if (inputType === "checkbox" && attr(element, "role") === "switch") return "toggle";
  if (inputType === "url" || inputType === "text" && attr(element, "inputmode") === FIELD_TYPE_REGISTRY.url.attributes.inputmode) return "url";
  return inputFieldType(inputType);
}

/** The first registry input kind with this native type; an unregistered radio stays "radio", anything else is text. */
function inputFieldType(inputType: string): FieldDescriptor["type"] {
  const registered = Object.entries(FIELD_TYPE_REGISTRY).find(([, kind]) => kind.control === "input" && kind.htmlType === inputType)?.[0];
  return (registered as FieldDescriptor["type"] | undefined) ?? (inputType === "radio" ? "radio" : "text");
}

/** The allowlist a select or radio control declares; other controls have none. */
function controlChoices({ element, inputType, label, name }: { element: Element; inputType: string; label: Element | undefined; name: string }): FieldDescriptor["options"] {
  if (element.tagName === "select") {
    return elements(element.childNodes).filter((child) => child.tagName === "option")
      .map((option) => ({ value: attr(option, "value") ?? labelText(option), label: labelText(option) }))
      .filter((option) => option.value !== "");
  }
  if (inputType !== "radio") return undefined;
  const value = attr(element, "value") ?? "on";
  return [{ value, label: label ? labelText(label) || name : value }];
}

/** A radio group's legend wins; then the control's label text, aria-label, and finally its name. */
function fieldLabel({ element, type, label, name }: { element: Element; type: FieldDescriptor["type"]; label: Element | undefined; name: string }): string {
  const legend = type === "radio" ? groupLabel({ element }) : undefined;
  return legend ?? ((label ? labelText(label) : attr(element, "aria-label")) || name);
}

/** Authored constraint attributes, in the key order earlier releases stored them. */
function constraintFields({ element, type }: { element: Element; type: FieldDescriptor["type"] }): Partial<FieldDescriptor> {
  const numeric = type === "number" || type === "range";
  const bound = (value: string): string | number => numeric ? Number(value) : value;
  return {
    ...ifPresent(attr(element, "placeholder"), (placeholder) => ({ placeholder })),
    ...ifPresent(attr(element, "pattern"), (pattern) => ({ pattern })),
    ...ifPresent(attr(element, "min"), (min) => ({ min: bound(min) })),
    ...ifPresent(attr(element, "max"), (max) => ({ max: bound(max) })),
    ...ifPresent(attr(element, "minlength"), (minLength) => ({ minLength: Number(minLength) })),
    ...ifPresent(attr(element, "step"), (step) => ({ step: Number(step) })),
    ...ifPresent(type === "file" ? attr(element, "accept") : undefined, (accept) => ({ accept: accept.split(",").map((item) => item.trim()) })),
  };
}

/** Describe a control's first occurrence. Converts URL controls to text controls in place. */
function describeControl({ element, inputType, name, labels }: { element: Element; inputType: string; name: string; labels: readonly Element[] }): FieldDescriptor {
  // Earlier Jini releases stored only boolean checkboxes and forced the native "on" wire value.
  // Record attribute presence instead: authored strings survive while no-value boxes stay boolean.
  const checkboxValue = inputType === "checkbox" ? attr(element, "value") : undefined;
  const id = attr(element, "id");
  const label = labels.find((item) => id !== undefined && attr(item, "for") === id) ?? wrappingLabel(element);
  const type = controlType({ element, inputType });
  // Keep URL validation on text controls, and remove legacy native scheme validation on save.
  if (type === "url") toUrlTextControl(element);
  const choices = controlChoices({ element, inputType, label, name });
  return {
    id: name,
    label: fieldLabel({ element, type, label, name }),
    type,
    required: attr(element, "required") !== undefined,
    ...(checkboxValue !== undefined && type === "checkbox" ? { checkboxValue } : {}),
    ...ifPresent(attr(element, "maxlength"), (maxLength) => ({ maxLength: Number(maxLength) })),
    ...(choices ? { options: choices } : {}),
    ...constraintFields({ element, type }),
  };
}

/** Derives the submission allowlist at save time and removes server-owned transport overrides.
 * Parsing normalizes HTML syntax; scripts and authored styling remain unsanitized.
 * @complexity O(n * l) for n elements and l labels (label lookup per control); O(n) space. */
export function deriveHtmlForm(
  { html }: { html: string },
  _optional: Record<string, never> = {},
): { mode: "html"; html: string; fields: FieldDescriptor[] } {
  if (typeof html !== "string" || html.length > 200_000) invalid("HTML must be a string of at most 200000 characters");
  const fragment = parseFragment(html, { sourceCodeLocationInfo: true });
  const all = elements(fragment.childNodes);
  unwrapOuterForm(all);
  const labels = all.filter((element) => element.tagName === "label");
  const fields = new Map<string, FieldDescriptor>();
  for (const element of all) {
    // A submit button's overrides or a control's `form` attribute must not bypass our endpoint.
    removeAttributes(element, TRANSPORT_OVERRIDES);
    const inputType = (attr(element, "type") ?? "text").toLowerCase();
    const name = columnName({ element, inputType });
    if (name === undefined) continue;
    const existing = fields.get(name);
    if (existing) addGroupOption({ element, inputType, existing, name });
    else fields.set(name, describeControl({ element, inputType, name, labels }));
  }
  // Re-serialization also discards ignored/dangling </form> tokens: they must never close our
  // server-owned wrapper early. Raw-text script contents are preserved by the HTML serializer.
  return { mode: "html", html: serializeAuthoredRequired({ fragment, html }), fields: [...fields.values()] };
}
