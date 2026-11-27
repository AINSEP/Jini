import { agentHandle, buildAgentListHandles } from "@jini-ai/core/agent-handles";
import type { ContentTypeFieldDef } from "@jini-ai/core/contracts/content-types";
import type { CollectionEntryEditorProps } from "./CollectionEntryEditor.js";

interface FieldControlProps {
  useJsonFieldControlHook: CollectionEntryEditorProps<unknown>["useJsonFieldControlHook"];
  inputId: string;
  value: unknown;
  onChange: (value: unknown) => void;
  agentHandleProps: ReturnType<typeof agentHandle>;
  /** This field's own schema name — only `JsonFieldControl` (M2) uses it, to key its parse-validity
   *  report; every other control ignores it. */
  fieldName: string;
  /** M2: forwarded straight through to `JsonFieldControl` — see that control's own comment. */
  setFieldValidity: (fieldName: string, valid: boolean) => void;
}

function makeNumberFieldControl(required: { step: string | undefined }, _optional: Record<string, never> = {}) {
  return function NumberFieldControl({ inputId, value, onChange, agentHandleProps }: FieldControlProps) {
    return (
      <input
        id={inputId}
        type="number"
        step={required.step}
        value={typeof value === "number" ? value : ""}
        onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
        {...agentHandleProps}
      />
    );
  };
}

function makeStringFieldControl(required: { type: "datetime-local" | undefined }, _optional: Record<string, never> = {}) {
  return function StringFieldControl({ inputId, value, onChange, agentHandleProps }: FieldControlProps) {
    return (
      <input
        id={inputId}
        type={required.type}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        {...agentHandleProps}
      />
    );
  };
}

const TextFieldControl = makeStringFieldControl({ type: undefined });
const DatetimeFieldControl = makeStringFieldControl({ type: "datetime-local" });
const IntegerFieldControl = makeNumberFieldControl({ step: "1" });
const RealFieldControl = makeNumberFieldControl({ step: undefined });

function BooleanFieldControl({ inputId, value, onChange, agentHandleProps }: FieldControlProps) {
  return (
    <input
      id={inputId}
      type="checkbox"
      checked={value === true}
      onChange={(e) => onChange(e.target.checked)}
      {...agentHandleProps}
    />
  );
}

/** `json`-kind field control: a raw-JSON textarea backed by `useJsonFieldControl` (state/parsing
 * lives there, not here — see that hook's own header). `aria-invalid` flags an unparseable buffer
 * without inventing new copy for it; the last value that DID parse is what stays in `extFields`
 * and what a save sends, regardless of how the buffer currently looks. */
function JsonFieldControl({ inputId, value, onChange, agentHandleProps, fieldName, setFieldValidity, useJsonFieldControlHook }: FieldControlProps) {
  const { text, parseError, handleTextChange } = useJsonFieldControlHook({ value, onChange, fieldName, setFieldValidity });
  return (
    <textarea
      id={inputId}
      value={text}
      aria-invalid={parseError}
      onChange={(e) => handleTextChange({ nextText: e.target.value })}
      {...agentHandleProps}
    />
  );
}

/** One control per `ContentTypeFieldDef.kind` (design-spec.md §1.5). A `Record` keyed by the
 * closed `kind` union rather than a switch/ternary chain — same exhaustiveness guarantee (add a
 * kind to the union and `tsc` rejects this object until a control is added for it), but as a flat
 * lookup instead of nested conditionals.
 *
 * `relation` deliberately reuses `TextFieldControl` rather than a same-shaped duplicate: it stores
 * a foreign entity id and shares `text`'s storage class server-side (`@jini-ai/cms`'s
 * `content-types/types.ts`), so a plain text input is a correct control for it, not a fallback. */
const FIELD_CONTROLS: Record<ContentTypeFieldDef["kind"], (props: FieldControlProps) => React.JSX.Element> = {
  text: TextFieldControl,
  integer: IntegerFieldControl,
  real: RealFieldControl,
  boolean: BooleanFieldControl,
  datetime: DatetimeFieldControl,
  relation: TextFieldControl,
  json: JsonFieldControl,
};

function DynamicField(props: {
  useJsonFieldControlHook: CollectionEntryEditorProps<unknown>["useJsonFieldControlHook"];
  field: ContentTypeFieldDef;
  value: unknown;
  onChange: (value: unknown) => void;
  /** This field's own distinct handle base — see `EntryFieldsSection`'s own comment for why it's
   *  computed once, up there (via `buildAgentListHandles`), rather than per-field here. */
  agentBase: string;
  /** M2: forwarded to `Control` as `setFieldValidity` — only `JsonFieldControl` uses it. */
  setFieldValidity: (fieldName: string, valid: boolean) => void;
}) {
  const { field, value, onChange, agentBase, setFieldValidity } = props;
  const inputId = `entry-field-${field.name}`;
  const Control = FIELD_CONTROLS[field.kind];

  return (
    <div className="collections-dynamic-field">
      <label htmlFor={inputId}>
        {field.name}
        {field.required ? " *" : ""}
      </label>
      <Control
        useJsonFieldControlHook={props.useJsonFieldControlHook}
        inputId={inputId}
        value={value}
        onChange={onChange}
        agentHandleProps={agentHandle({ handle: agentBase }, {
          role: field.kind === "boolean" ? "checkbox" : "field",
          label: `This content type's "${field.name}" field${field.required ? " (required)" : ""}`,
        })}
        fieldName={field.name}
        setFieldValidity={setFieldValidity}
      />
    </div>
  );
}

/** The dynamic-fields section (design-spec.md §1.5) — hidden entirely when the content type
 * defines no custom fields. */
export function EntryFieldsSection(props: {
  readStoredField: CollectionEntryEditorProps<unknown>["readStoredField"];
  useJsonFieldControlHook: CollectionEntryEditorProps<unknown>["useJsonFieldControlHook"];
  fields: ContentTypeFieldDef[];
  entry: { fieldsJson?: unknown } | null | undefined;
  extFields: Record<string, unknown>;
  onFieldChange: (name: string, value: unknown) => void;
  /** M2: forwarded to each `DynamicField`. */
  setFieldValidity: (fieldName: string, valid: boolean) => void;
  t: (required: { key: string }, optional?: Record<string, never>) => string;
}) {
  const { fields, entry, extFields, onFieldChange, setFieldValidity, t } = props;
  if (fields.length === 0) return null;

  // Field names are this content type's own schema keys, unique by construction (Collections.tsx's
  // `EditFieldsDialog` is where they're defined) — `buildAgentListHandles` still slugifies+dedupes
  // rather than assuming that, the same defensive stance every other list handle in this workstream
  // takes (a schema author is still free to pick a name that isn't already handle-shaped).
  const fieldHandles = buildAgentListHandles({ prefix: "entry-field", ids: fields.map((field) => field.name) }
  );

  return (
    <div className="collections-dynamic-fields">
      <h3>{t({ key: "Fields" })}</h3>
      {fields.map((field, index) => {
        const agentBase = fieldHandles[index];
        if (agentBase === undefined) throw new Error("entry field handle is missing");
        return (
        <DynamicField
          useJsonFieldControlHook={props.useJsonFieldControlHook}
          key={field.name}
          field={field}
          // An edited field shows its edit even when that edit is "cleared" (`undefined`), so the
          // input matches what a save sends instead of snapping back to the stored value.
          value={Object.hasOwn(extFields, field.name) ? extFields[field.name] : props.readStoredField({ fieldsJson: entry?.fieldsJson, name: field.name })}
          onChange={(value) => onFieldChange(field.name, value)}
          agentBase={agentBase}
          setFieldValidity={setFieldValidity}
        />
      ); })}
    </div>
  );
}

