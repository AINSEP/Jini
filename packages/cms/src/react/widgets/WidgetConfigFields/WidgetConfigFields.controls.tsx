import { agentHandle } from "@jini-ai/core/agent-handles";
import type { ContentTypeFieldKind } from "@jini-ai/core/contracts/content-types";
import { type Translate, interpolate } from "@jini-ai/core/text";
import { trimChars } from "@jini-ai/core/primitives";
import type { WidgetConfigFieldsProps } from "./WidgetConfigFields.js";
type CollectionOption = Awaited<ReturnType<WidgetConfigFieldsProps["port"]["listCollections"]>>[number];
export type DisplayableField = CollectionOption["fields"][number];

/** A displayable field of the chosen collection's content type (never `relation`/`json` — see
 *  `COLLECTION_DISPLAYABLE_FIELD_KINDS`), as the four sub-controls below need it. */

/** `base ? agentHandle(...) : {}`, factored out so `RecentEntriesConfigFields` (four fields of its
 *  own, on top of its four sub-components) doesn't count one branch per field for this — every
 *  other sub-component in this file still writes the ternary inline, since none of them repeats it
 *  often enough to threaten the complexity ceiling. */
export function maybeAgentHandle({ base, suffix, opts }: { base: string | undefined; suffix: string; opts: { role: "field" | "button"; label: string } }, _options: Record<string, never> = {}) {
  return base ? agentHandle({ handle: `${base}-${suffix}` }, opts) : {};
}

/** `collections?.find((ct) => ct.key === key) ?? null`, pulled out for the same reason as
 *  {@link maybeAgentHandle} — one call site, not two branches, in `RecentEntriesConfigFields`. */
export function findContentType({ collections, key }: { collections: CollectionOption[] | null; key: string }, _options: Record<string, never> = {}): CollectionOption | null {
  if (collections === null) return null;
  return collections.find((ct) => ct.key === key) ?? null;
}

/** A displayable field's name, reduced to what `agentHandle` actually accepts: lowercase letters
 *  and digits joined by single hyphens (`@jini-ai/agentic`'s `HANDLE_PATTERN`). Content-type field
 *  for the handle text; the visible label still goes through {@link humanizeFieldName}. */
function fieldHandleSegment({ name, rules }: { name: string; rules: WidgetConfigFieldsProps["rules"] }, _options: Record<string, never> = {}): string {
  return rules.asciiSlug({ text: name, trimChars });
}

/** The Collection `<select>` — its own component because the loading/error states from
 *  `useFetchedOptions` (mirrors `MenuConfigFields`) replace the whole field, label included, with
 *  a notice, the same shape `MenuConfigFields`/`ContactFormConfigFields` already use. */
export function CollectionSelect(props: {
  collections: CollectionOption[] | null;
  error: string | null;
  value: string;
  onChange: (value: string) => void;
  base?: string | undefined;
  t: Translate;
}) {
  if (props.error) return <div className="notice error">{props.error}</div>;
  return (
    <>
      <label htmlFor="widget-field-collection">{props.t("Collection")}</label>
      <select
        id="widget-field-collection"
        value={props.value}
        disabled={!props.collections}
        onChange={(e) => props.onChange(e.target.value)}
        {...(props.base ? agentHandle({ handle: `${props.base}-collection` }, { role: "field", label: "Collection" }) : {})}
      >
        <option value="">{props.t("All collections")}</option>
        {(props.collections ?? []).map((ct) => (
          <option key={ct.key} value={ct.key}>
            {ct.label}
          </option>
        ))}
      </select>
    </>
  );
}

/** Sort — the three built-in options plus ascending/descending per displayable field (empty
 *  before a collection is chosen, so it degrades to just the built-ins). */
export function SortSelect(props: { value: string; fields: readonly DisplayableField[]; onChange: (value: string) => void; base?: string | undefined; rules: WidgetConfigFieldsProps["rules"]; t: Translate }) {
  return (
    <>
      <label htmlFor="widget-field-sort">{props.t("Sort")}</label>
      <select
        id="widget-field-sort"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        {...(props.base ? agentHandle({ handle: `${props.base}-sort` }, { role: "field", label: "Sort" }) : {})}
      >
        <option value="">{props.t("Default (recently updated)")}</option>
        <option value="newest">{props.t("Newest first")}</option>
        <option value="oldest">{props.t("Oldest first")}</option>
        <option value="title">{props.t("Title (A–Z)")}</option>
        {props.fields.map((f) => (
          <option key={f.name} value={f.name}>
            {interpolate({ template: props.t("{field} (ascending)"), vars: { field: props.rules.humanizeFieldName({ name: f.name }) } })}
          </option>
        ))}
        {props.fields.map((f) => (
          <option key={`-${f.name}`} value={`-${f.name}`}>
            {interpolate({ template: props.t("{field} (descending)"), vars: { field: props.rules.humanizeFieldName({ name: f.name }) } })}
          </option>
        ))}
      </select>
    </>
  );
}

/** One checkbox per displayable field of the chosen collection, only rendered once one is chosen
 *  (there is no single field list to check boxes against for "All collections"). */
export function FieldsCheckboxes(props: {
  fields: readonly DisplayableField[];
  selected: readonly string[];
  onToggle: (name: string, checked: boolean) => void;
  base?: string | undefined;
  rules: WidgetConfigFieldsProps["rules"]; t: Translate;
}) {
  return (
    <fieldset className="widget-config-fields-checkboxes">
      <legend>{props.t("Fields to show")}</legend>
      {props.fields.map((f) => (
        <label key={f.name} htmlFor={`widget-field-field-${f.name}`}>
          <input
            id={`widget-field-field-${f.name}`}
            type="checkbox"
            checked={props.selected.includes(f.name)}
            onChange={(e) => props.onToggle(f.name, e.target.checked)}
            {...(props.base ? agentHandle({ handle: `${props.base}-field-${fieldHandleSegment({ name: f.name, rules: props.rules })}` }, { role: "field", label: `Show ${f.name}` }) : {})}
          />
          {props.rules.humanizeFieldName({ name: f.name })}
        </label>
      ))}
    </fieldset>
  );
}

/** The one supported filter row (field + value, plan A1) — the value input only appears once a
 *  field is picked, and its raw text is coerced against that field's own kind (boolean/number). */
export function FilterRow(props: {
  fields: readonly DisplayableField[];
  field: string;
  value: string;
  onFieldChange: (name: string) => void;
  onValueChange: (raw: string, kind: ContentTypeFieldKind | undefined) => void;
  base?: string | undefined;
  rules: WidgetConfigFieldsProps["rules"]; t: Translate;
}) {
  const kind = props.fields.find((f) => f.name === props.field)?.kind;
  return (
    <div className="widget-config-filter-row">
      <label htmlFor="widget-field-filter-field">{props.t("Filter")}</label>
      <select
        id="widget-field-filter-field"
        value={props.field}
        onChange={(e) => props.onFieldChange(e.target.value)}
        {...(props.base ? agentHandle({ handle: `${props.base}-filter-field` }, { role: "field", label: "Filter field" }) : {})}
      >
        <option value="">{props.t("No filter")}</option>
        {props.fields.map((f) => (
          <option key={f.name} value={f.name}>
            {props.rules.humanizeFieldName({ name: f.name })}
          </option>
        ))}
      </select>
      {props.field && (
        <>
          <label htmlFor="widget-field-filter-value">{props.t("Filter value")}</label>
          <input
            id="widget-field-filter-value"
            value={props.value}
            placeholder={props.t("Value")}
            onChange={(e) => props.onValueChange(e.target.value, kind)}
            {...(props.base ? agentHandle({ handle: `${props.base}-filter-value` }, { role: "field", label: "Filter value" }) : {})}
          />
        </>
      )}
    </div>
  );
}

