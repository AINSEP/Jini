import { agentHandle } from "@jini-ai/agentic";
import { interpolate } from "@jini-ai/ui/i18n";
import { MediaPickerBridge } from "./MediaPickerBridge.js";
import { useSeoCopy } from "../hooks/SeoPorts.hooks.js";
import { useWiredMediaRefField, useMediaRefPresentation, handleSpread } from "../hooks/MediaRefField.hooks.js";
import type { MediaRefFieldController } from "../hooks/MediaRefField.hooks.js";


/**
 * @file `MediaRefField` — an `{assetId}:{transformName}` media reference (or an absolute URL),
 * shown as the chosen file's thumbnail and name, plus a "Choose image" affordance that opens the existing
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
 *
 * 2026-10-08 polish: the original editable-input rationale above still applies to pasted URLs
 * and empty fields. A selected library reference now shows plain copy with its preview; Remove
 * returns to manual entry. A hidden input preserves the exact FormData value on defaults saves.
 * 2026-10-15: superseded — the input is removed entirely (owner: the read-only box "looks
 * useless"). An existing pasted URL still displays (by its file name) and still saves unchanged;
 * a new URL can no longer be typed here, only chosen from the library.
 */

export interface MediaRefFieldProps {
  locale: string;
  /** Base id: the caption is `{id}-label` and names the row's `role="group"`; the hidden input (when
   *  `name` is set) carries the id itself. Was an `<input id>`/`<label htmlFor>` pair until the text
   *  box was removed (2026-10-15). */
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
  /** Shown in the file slot while no image is set — for a field that inherits another field's
   *  image when empty (the X image falls back to the social preview image). */
  emptyHint?: string;
  /** The value comes from the site default or page content, with no SEO override of its own: the file
   *  shows muted as "Using site default: …" or "Using image from page content: …"; size and Remove
   *  are hidden — there is no SEO override to remove. "Choose image" is how an override starts
   *  (owner, 2026-10-15). */
  inherited?: false | 'default' | 'content';
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
  emptyHint,
  inherited = false,
  useField = useWiredMediaRefField,
}: MediaRefFieldProps, _optional: Record<string, never> = {}) {
  const t = useSeoCopy();
  const { Picker = MediaPickerBridge } = useMediaRefPresentation({ value });
  const { pickerOpen, openPicker, closePicker, handleSelect, clear, previewUrl, file, accept, onPreviewLoad, onPreviewError } = useField({ value, onChange });
  const labelId = `${id}-label`;

  /* One compact row: thumbnail, the file's name and size, then Choose/Remove kept together in their
     own group so a narrow column wraps the pair as one unit instead of stranding Remove on a line of
     its own (owner, 2026-10-15). The thumbnail used to sit under the row at 4rem, repeated per field.
     `warning` (share-image size/byte/HTTP diagnostics) is still computed by the hook but no longer
     painted: the owner called the yellow callout under every image "completely useless".
     2026-10-15 (round 3): the text box is gone — for a library pick it only ever said a read-only
     "Selected image" ("i can't change it and looks useless"), so the row names the file instead and
     the picker is the one way in. The exact value still rides a hidden input for FormData saves. */
  return (
    <div className="jini-field jini-media-ref-field">
      <span className="jini-field-label" id={labelId}>
        {label}
      </span>
      <div
        className="jini-media-ref-field-row"
        role="group"
        aria-labelledby={labelId}
        {...(base ? agentHandle({ handle: base }, { role: "region", label }) : {})}
      >
        <MediaRefFile file={file} emptyHint={emptyHint} label={label} locale={locale} t={t} inherited={inherited} previewUrl={previewUrl} onPreviewLoad={onPreviewLoad} onPreviewError={onPreviewError} />
        {name ? <input type="hidden" id={id} name={name} value={value} /> : null}
        <MediaRefActions label={label} locale={locale} t={t} base={base} value={value} inherited={inherited} openPicker={openPicker} clear={clear} />
      </div>
      {pickerOpen ? (
        <Picker onSelect={handleSelect} onCancel={closePicker} accept={accept} agentHandle={base ? `${base}-dialog` : undefined} />
      ) : null}
    </div>
  );
}

/** The translator `useSeoCopy` hands back, threaded to the row's parts. */
type SeoCopy = ReturnType<typeof useSeoCopy>;

type MediaRefFileProps = {
  previewUrl: string | null;
  onPreviewLoad: MediaRefFieldController["onPreviewLoad"] | undefined;
  onPreviewError: MediaRefFieldController["onPreviewError"] | undefined;
  file: MediaRefFieldController["file"];
  emptyHint: string | undefined;
  label: string;
  locale: string;
  t: SeoCopy;
  inherited: false | "default" | "content";
};

/** The chosen file: thumbnail, name (prefixed with its source when inherited) and, for an own
 *  override, its pixel size. With no file, the field's empty hint (if any) takes the slot. */
function MediaRefFile({ file, emptyHint, label, locale, t, inherited, previewUrl, onPreviewLoad, onPreviewError }: MediaRefFileProps, _optional: Record<string, never> = {}) {
  if (!file) return emptyHint ? <span className="jini-media-ref-field-empty">{emptyHint}</span> : null;
  return (
    <span className={inherited ? "jini-media-ref-field-file jini-media-ref-field-file-inherited" : "jini-media-ref-field-file"}>
      {previewUrl ? <img key={previewUrl} className="jini-media-ref-field-preview" src={previewUrl} alt={`${label} preview`} onLoad={onPreviewLoad} onError={onPreviewError} /> : null}
      <span className="jini-media-ref-field-name" title={file.name}>
        {inherited ? inheritedFileName({ name: file.name, inherited, locale, t }) : file.name}
      </span>
      {file.size && !inherited ? <span className="jini-media-ref-field-size">{file.size}</span> : null}
    </span>
  );
}

/** "Using site default: {name}" or "Using image from page content: {name}", translated. */
function inheritedFileName({ name, inherited, locale, t }: { name: string; inherited: "default" | "content"; locale: string; t: SeoCopy }, _optional: Record<string, never> = {}): string {
  const key = inherited === "content" ? "Using image from page content: {name}" : "Using site default: {name}";
  return interpolate({ template: t({ locale, key, vars: { name } }), vars: { name } });
}

type MediaRefActionsProps = Pick<MediaRefFieldController, "openPicker" | "clear"> & {
  label: string;
  locale: string;
  t: SeoCopy;
  base: string | undefined;
  value: string;
  inherited: false | "default" | "content";
};

/** Choose (always) and Remove (only for an own value), grouped so they wrap as one unit. */
function MediaRefActions({ label, locale, t, base, value, inherited, openPicker, clear }: MediaRefActionsProps, _optional: Record<string, never> = {}) {
  const handleBase = base === undefined ? {} : { base };
  return (
    <span className="jini-media-ref-field-actions">
      <button
        type="button"
        className="jini-btn jini-btn-secondary"
        onClick={openPicker}
        {...handleSpread({ ...handleBase, suffix: "choose", label: `Choose an image for: ${label}` })}
      >
        {t({ locale, key: "Choose image" })}
      </button>
      {value && !inherited ? (
        <button
          type="button"
          className="jini-btn jini-btn-secondary"
          onClick={clear}
          {...handleSpread({ ...handleBase, suffix: "clear", label: `Remove the selected image for: ${label}` })}
        >
          {t({ locale, key: "Remove" })}
        </button>
      ) : null}
    </span>
  );
}
