import type { FormProviderDescription } from "@jini-ai/cms/forms";
import type { FormEditorFieldsBodyProps } from './FormEditorFieldsBody.js';

/** Runtime metadata owns choices and public fields. Missing discovery never rewrites the saved draft.
 * @complexity O(p + f) render time/space for provider and configuration field counts; no I/O. */
export function FormProviderSettings({ provider = { id: 'builtin', config: {} }, providers, providersError, onProviderChange, t }: FormEditorFieldsBodyProps) {
  if (providers === undefined && !providersError) return <div className="field-group"><p role="status">{t('Loading form providers…')}</p></div>;
  const choices = providers ?? [];
  const selected = choices.find(item => item.id === provider.id);
  const unavailable = unavailableSettings({ selected, providersError, t });
  return <div className="field-group">
    <label htmlFor="form-provider">{t('Where answers go')}</label>
    <select id="form-provider" value={provider.id} disabled={choices.length === 0} onChange={event => onProviderChange?.({ id: event.target.value, config: {} })}>
      {choices.map(item => <option key={item.id} value={item.id} disabled={!item.available}>{t(item.label)}</option>)}
      {!selected ? <option value={provider.id}>{provider.id}</option> : null}
    </select>
    {unavailable ? <p>{unavailable}</p> : <>
      {selected!.fields.map(field => <div className="field" key={field.key}>
        <label htmlFor={`form-provider-${field.key}`}>{t(field.label)}</label>
        <input id={`form-provider-${field.key}`} type={field.type} value={provider.config[field.key] ?? ''} onChange={event => onProviderChange?.({ id: provider.id, config: { ...provider.config, [field.key]: event.target.value } })} />
        {field.helpText ? <p>{t(field.helpText)}</p> : null}
      </div>)}
      <p>{t(selected!.answers)}</p>
      <p>{t(selected!.validation)}</p>
      {selected!.helpText ? <p>{t(selected!.helpText)}</p> : null}
    </>}
    <p>{t('Switching providers preserves your existing definitions and submission history. Republish every static page containing this form after switching providers.')}</p>
  </div>;
}

/** Keep discovery failure separate from editable configuration without replacing either value. */
function unavailableSettings({ selected, providersError, t }: { selected: FormProviderDescription | undefined; providersError: string | null | undefined; t: (key: string) => string }): string | null {
  if (providersError) return providersError;
  if (!selected) return t('Settings for this form provider are unavailable.');
  if (selected.available) return null;
  return selected.message ?? t('Settings for this form provider are unavailable.');
}
