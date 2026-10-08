import { agentHandle } from "@jini-ai/agentic";
import { MediaPickerBridge } from "./MediaPickerBridge.js";
import { useSeoCopy } from "../hooks/SeoPorts.hooks.js";
import { useWiredMediaRefField, useMediaRefPresentation, handleSpread } from "../hooks/MediaRefField.hooks.js";


/**
 * @file `MediaRefField` — a text input for an `{assetId}:{transformName}` media reference (or a
 * pasted absolute URL), plus a "Choose image" affordance that opens the existing
 * `MediaPickerDialog`, a thumbnail preview of the current value, and a Remove control.
 *
 * Built for `react/pages/SeoPage.tsx`'s `defaultOgImage`/`ogImage`/`twitterImage` fields (SPEC intent: "make the OG
 * image selectable, with a preview") — the text input keeps working unchanged (an addition, not a
 * replacement: anyone scripting or pasting a raw ref/URL still can), the picker is the new path.
 *
 * State — the dialog's open/closed flag, the selection handler, and the preview URL — lives in
 * `react/hooks/MediaRefField.hooks.ts`, split out the same way `MediaPickerDialog`/`MediaPickerDialog.hooks
 * .tsx` does; this file stays props-and-JSX only. `MediaPickerDialog` itself is reused unchanged
 * (`components/MediaPickerDialog/MediaPickerDialog.tsx`) — no fork, no new picker UI.
 */

export interface MediaRefFieldProps {
  locale: string;
  /** `<input id>`/`<label htmlFor>` pairing — same `getByLabelText`-friendly shape `react/pages/SeoPage.tsx`'s
   *  other explicit-`htmlFor` fields already use. */
  id: string;
  /** Forwarded to the `<input name>` only when set — `defaultOgImage` needs this (its `<form>` reads
   *  `FormData` by name on submit); the per-entry `ogImage`/`twitterImage` fields do not (they save
   *  through `fieldValue`/`setField`, never `FormData`), so it stays optional. */
  name?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** This field's own base handle — appended `-choose`/`-clear`/`-dialog` for its own controls, and
   *  forwarded as-is to the `<input>` itself. Omit to leave every element here untagged. */
  agentHandle?: string;
  /** Injectable seam for the picker's own state — same convention as `MediaPickerDialog`'s own
   *  `useDialog` prop. Defaults to the real {@link useWiredMediaRefField}. */
  useField?: typeof useWiredMediaRefField;
}

export function MediaRefField({
  locale,
  id,
  name,
  label,
  value,
  onChange,
  agentHandle: base,
  useField = useWiredMediaRefField,
}: MediaRefFieldProps, _optional: Record<string, never> = {}) {
  const t = useSeoCopy();
  const { Picker = MediaPickerBridge } = useMediaRefPresentation();
  const { pickerOpen, openPicker, closePicker, handleSelect, clear, previewUrl, accept } = useField({ value, onChange });

  return (
    <div className="field media-ref-field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="media-ref-field-row">
        <input
          id={id}
          name={name}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          {...(base ? agentHandle({ handle: base }, { role: "field", label }) : {})}
        />
        <button
          type="button"
          className="btn-secondary"
          onClick={openPicker}
          {...handleSpread({ ...(base === undefined ? {} : { base }), suffix: "choose", label: `Choose an image for: ${label}` })}
        >
          {t({ locale: locale, key: "Choose image" })}
        </button>
        {value ? (
          <button
            type="button"
            className="btn-secondary"
            onClick={clear}
            {...handleSpread({ ...(base === undefined ? {} : { base }), suffix: "clear", label: `Remove the selected image for: ${label}` })}
          >
            {t({ locale: locale, key: "Remove" })}
          </button>
        ) : null}
      </div>
      {previewUrl ? <img className="media-ref-field-preview" src={previewUrl} alt={`${label} preview`} /> : null}
      {pickerOpen ? (
        <Picker onSelect={handleSelect} onCancel={closePicker} accept={accept} agentHandle={base ? `${base}-dialog` : undefined} />
      ) : null}
    </div>
  );
}
