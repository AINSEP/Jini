import { CUSTOM, usePluginProviderChoice } from "./PluginProviderSettingField.hooks.js";
import { agentHandle } from "@jini-ai/core/agent-handles";

import { SecretInput } from "../../shell/components/SecretInput/SecretInput.js";
import type { AdminPluginProviderSettingField } from "./api/plugins-api.types.js";

import { interpolate } from '@jini-ai/core/text';
/**
 * @file One declared provider setting on `PluginProviderSettingsDialog` (2026-10-25 redesign): label
 * above a full-width control, the manifest's hint below in muted text. The control is whatever the
 * plugin declared — a select of its `options` (with "Custom…" free text when `allowCustom`), a
 * masked secret (the shared `components/SecretInput`, eye inside its right edge), or plain text.
 * No vendor knowledge here: every label, hint, default and option comes from the plugin's manifest.
 */

export interface ProviderSettingFieldProps {
  readonly field: AdminPluginProviderSettingField;
  readonly id: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** Agent handle for the control (`<base>-setting-<field words>`). */
  readonly handle: string;
  readonly pluginName: string;
  readonly t: (key: string) => string;
}

/** A select of the declared options; "Custom…" (when allowed) reveals a text input for any other value. */
function ChoiceControl({ field, id, value, onChange, t, controlAttrs, usePluginProviderChoice: usePluginProviderChoiceHook = usePluginProviderChoice }: Omit<ProviderSettingFieldProps, "handle" | "pluginName"> & { controlAttrs: Record<string, unknown>; usePluginProviderChoice?: typeof usePluginProviderChoice; }) {
  const { options, listed, custom, choose } = usePluginProviderChoiceHook({ field, value, onChange });
  return (
    <>
      <select id={id} value={custom ? CUSTOM : value} onChange={(event) => choose({ next: event.target.value })} {...controlAttrs}>
        {!custom && !listed ? <option value="">—</option> : null}
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        {field.allowCustom ? <option value={CUSTOM}>{t("Custom…")}</option> : null}
      </select>
      {custom ? (
        <input type="url" className="provider-settings-custom" autoComplete="off" spellCheck={false} value={value} placeholder="https://"
          aria-label={interpolate({ template: t("Custom {label}"), vars: { label: field.label } })} onChange={(event) => onChange(event.target.value)} />
      ) : null}
    </>
  );
}

/** The control's shared attributes: hint link, required (a saved secret may stay blank), agent handle. */
function controlAttrsOf({ field, hintId, handle, pluginName }: { field: AdminPluginProviderSettingField; hintId: string; handle: string; pluginName: string }) {
  return {
    "aria-describedby": field.hint ? hintId : undefined,
    "aria-required": field.required && !(field.secret && field.saved) ? true : undefined,
    ...agentHandle({ handle }, { role: "field", label: `${pluginName} setting: ${field.label}` }),
  };
}

/** Whatever the plugin declared: a select of its options, a masked secret, or plain text. */
function FieldControl({ field, id, value, onChange, t, controlAttrs }: Omit<ProviderSettingFieldProps, "handle" | "pluginName"> & { controlAttrs: Record<string, unknown> }) {
  if (field.options?.length) return <ChoiceControl field={field} id={id} value={value} onChange={onChange} t={t} controlAttrs={controlAttrs} />;
  const textProps = { id, value, onChange: (event: { target: { value: string } }) => onChange(event.target.value), ...controlAttrs };
  // `new-password`, not `off`: Chrome ignores `off` on password inputs and would autofill a saved login here.
  if (field.secret) return <SecretInput {...textProps} autoComplete="new-password" label={field.label} placeholder={field.saved ? t("Saved — leave blank to keep") : ""} />;
  return <input type="text" autoComplete="off" {...textProps} />;
}

export function ProviderSettingField({ field, id, value, onChange, handle, pluginName, t }: ProviderSettingFieldProps) {
  const hintId = `${id}-hint`;
  return (
    <div className="field provider-settings-field">
      <label className="field-label" htmlFor={id}>
        {field.label}
        {field.required ? <span className="provider-settings-required" aria-hidden="true"> *</span> : null}
      </label>
      <FieldControl field={field} id={id} value={value} onChange={onChange} t={t} controlAttrs={controlAttrsOf({ field, hintId, handle, pluginName })} />
      {field.hint ? <p className="field-hint" id={hintId}>{field.hint}</p> : null}
    </div>
  );
}
