import type { FormEditorFieldsBodyProps } from './FormEditorFieldsBody.js';

/** Runtime metadata owns choices and public fields. Missing discovery never rewrites the saved draft.
 * @complexity O(p + f) render time/space for provider and configuration field counts; no I/O. */
export function FormProviderSettings({ provider = { id: 'builtin', config: {} }, providers = [], providersError, onProviderChange, t }: FormEditorFieldsBodyProps) {
  const selected = providers.find(item => item.id === provider.id);
  const unavailable = providersError ?? (!selected || !selected.available ? selected?.message ?? t('Settings for this form provider are unavailable.') : null);
  return <div className="field-group">
    <label htmlFor="form-provider">{t('Where answers go')}</label>
    <select id="form-provider" value={provider.id} disabled={providers.length === 0} onChange={event => onProviderChange?.({ id: event.target.value, config: {} })}>
      {providers.map(item => <option key={item.id} value={item.id} disabled={!item.available}>{t(item.label)}</option>)}
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
