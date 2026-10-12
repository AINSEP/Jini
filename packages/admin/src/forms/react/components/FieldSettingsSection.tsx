import { agentHandle } from '@jini-ai/agentic';
import { InfoTip } from '@jini-ai/ui/admin-widgets';
import type { AdminFormField } from '../../models.js';
import { MAX_UPLOAD_MB } from '../../field-settings.js';
import { useFieldSettingsView } from '../hooks/forms-view.hooks.js';
import type { FieldAttributesDialogController } from '../hooks/use-field-attributes-dialog.hooks.js';

export interface FieldSettingsSectionProps {
  field: AdminFormField;
  controller: FieldAttributesDialogController;
  t: (key: string) => string;
}

/**
 * The settings half of the field dialog: one label-beside-control row per setting the field's
 * registry kind supports (`field-settings.ts` decides which). Markup only; every handler comes from
 * `useFieldSettingsView`. Explanations are ⓘ tips so the rows stay one line each.
 *
 * Initial focus: the native dialog focuses the first `[data-jini-autofocus]`, so the first of the
 * placeholder, help-text and default inputs this type renders gets it. Without it, types with no
 * placeholder (slider, file…) focused the Help text ⓘ, whose tip opened half behind the dialog
 * (Chrome check, 2026-10-11). Focus must land on an input, never on an ⓘ.
 */
export function FieldSettingsSection({ field, controller, t }: FieldSettingsSectionProps, _optional: Record<string, never> = {}) {
  const view = useFieldSettingsView({ field, controller, t });
  const { settings, form } = view;
  return (
    <div className="field-settings" {...agentHandle({ handle: 'form-field-settings' }, { role: 'region', label: "This field's type-specific settings" })}>
      {settings.placeholder ? (
        <div className="field-settings-row">
          <label className="field-label" htmlFor="field-settings-placeholder">{t('Placeholder')}</label>
          <input id="field-settings-placeholder" data-jini-autofocus="" value={form.placeholder} onChange={view.onPlaceholder}
            {...agentHandle({ handle: 'form-field-settings-placeholder' }, { role: 'field', label: 'Hint text shown inside the empty control' })} />
        </div>
      ) : null}
      {settings.helpText ? (
        <div className="field-settings-row">
          <span className="field-settings-label">
            <label className="field-label" htmlFor="field-settings-help">{t('Help text')}</label>
            <InfoTip label={t('Shown under the field and read out by screen readers.')} />
          </span>
          <input id="field-settings-help" data-jini-autofocus="" value={form.helpText} onChange={view.onHelpText}
            {...agentHandle({ handle: 'form-field-settings-help' }, { role: 'field', label: 'Help text shown under this field' })} />
        </div>
      ) : null}

      {settings.options ? (
        <div className="field-settings-row field-settings-row--top">
          <span className="field-settings-label">
            <span className="field-label" id="field-settings-options-label">{t('Options')}</span>
            <InfoTip label={t('The label is what visitors see. The value is what the submission stores; it follows the label until you edit it.')} />
          </span>
          <div className="field-options" role="group" aria-labelledby="field-settings-options-label">
            <ol className="field-options-list">
              {view.options.map((row) => (
                <li key={row._rowId} className="field-option-row">
                  <input className="field-option-label" aria-label={row.labelAria} placeholder={t('Label')} value={row.label} onChange={row.onLabel}
                    {...agentHandle({ handle: `${row.handle}-label` }, { role: 'field', label: 'Option text visitors see' })} />
                  <input className="field-option-value" aria-label={row.valueAria} placeholder={t('Value')} value={row.value} onChange={row.onValue}
                    {...agentHandle({ handle: `${row.handle}-value` }, { role: 'field', label: 'Option value stored with each submission' })} />
                  {view.settings.multiple ? (
                    <label className="field-option-default">
                      <input type="checkbox" checked={row.isDefault} disabled={!row.value} onChange={row.onDefault} aria-label={row.defaultAria} />
                    </label>
                  ) : null}
                  <span className="field-option-actions">
                    <button type="button" className="btn-ghost field-option-btn" disabled={row.isFirst} onClick={row.onUp}
                      aria-label={row.upAria}>↑</button>
                    <button type="button" className="btn-ghost field-option-btn" disabled={row.isLast} onClick={row.onDown}
                      aria-label={row.downAria}>↓</button>
                    <button type="button" className="btn-ghost field-option-btn" onClick={row.onRemove}
                      aria-label={row.removeAria}
                      {...agentHandle({ handle: `${row.handle}-remove` }, { role: 'button', label: 'Remove this option' })}>×</button>
                  </span>
                </li>
              ))}
            </ol>
            <button type="button" className="btn-secondary field-settings-add" onClick={view.addOption}
              {...agentHandle({ handle: 'form-field-options-add' }, { role: 'button', label: 'Add another option to this choice field' })}>
              {t('Add option')}
            </button>
          </div>
        </div>
      ) : null}

      {settings.defaultKind === 'boolean' ? (
        <div className="field-settings-row">
          <span className="field-label">{t('Default')}</span>
          <label className="form-checkbox-field">
            <input type="checkbox" checked={form.defaultChecked} onChange={view.onDefaultChecked}
              {...agentHandle({ handle: 'form-field-settings-default-checked' }, { role: 'checkbox', label: 'Whether this box starts checked' })} />
            {t('Checked by default')}
          </label>
        </div>
      ) : null}
      {settings.defaultKind === 'choice' ? (
        <div className="field-settings-row">
          <label className="field-label" htmlFor="field-settings-default">{t('Default')}</label>
          <select id="field-settings-default" className="field-settings-compact" value={form.defaultChoices[0] ?? ''} onChange={view.onDefaultChoice}
            {...agentHandle({ handle: 'form-field-settings-default' }, { role: 'field', label: 'Which option starts selected — set with page.select_option' })}>
            <option value="">{t('None')}</option>
            {view.defaultChoices.map((choice) => <option key={choice.key} value={choice.value}>{choice.label}</option>)}
          </select>
        </div>
      ) : null}
      {view.defaultInputType ? (
        <div className="field-settings-row">
          <label className="field-label" htmlFor="field-settings-default">{t('Default')}</label>
          <input id="field-settings-default" data-jini-autofocus="" className={view.defaultClass} type={view.defaultInputType}
            value={form.defaultText} onChange={view.onDefaultText}
            {...agentHandle({ handle: 'form-field-settings-default' }, { role: 'field', label: 'The value this field starts with' })} />
        </div>
      ) : null}

      {settings.length ? (
        <div className="field-settings-row">
          <span className="field-label" id="field-settings-length-label">{t('Length')}</span>
          <span className="field-settings-pair" role="group" aria-labelledby="field-settings-length-label">
            <input type="number" min={0} className="field-settings-num" aria-label={t('Min length')} placeholder={t('Min')} value={form.minLength} onChange={view.onMinLength}
              {...agentHandle({ handle: 'form-field-settings-min-length' }, { role: 'field', label: 'Fewest characters accepted' })} />
            <span aria-hidden="true">–</span>
            <input type="number" min={1} className="field-settings-num" aria-label={t('Max length')} placeholder={t('Max')} value={form.maxLength} onChange={view.onMaxLength}
              {...agentHandle({ handle: 'form-field-settings-max-length' }, { role: 'field', label: 'Most characters accepted; blank means the default limit' })} />
          </span>
        </div>
      ) : null}
      {settings.pattern ? (
        <div className="field-settings-row">
          <span className="field-settings-label">
            <label className="field-label" htmlFor="field-settings-pattern">{t('Pattern')}</label>
            <InfoTip label={t('Optional. The whole answer must match it, e.g. [0-9]+ for digits only. Groups, | and repeating more than once are not supported.')} />
          </span>
          <input id="field-settings-pattern" className="field-settings-code" value={form.pattern} onChange={view.onPattern} spellCheck={false}
            {...agentHandle({ handle: 'form-field-settings-pattern' }, { role: 'field', label: 'Regular expression the whole answer must match' })} />
        </div>
      ) : null}
      {settings.bounds ? (
        <div className="field-settings-row">
          <span className="field-label" id="field-settings-bounds-label">{t('Range')}</span>
          <span className="field-settings-pair" role="group" aria-labelledby="field-settings-bounds-label">
            <input type={view.boundsType} className={view.boundsClass} aria-label={t('Min')} placeholder={t('Min')} value={form.min} onChange={view.onMin}
              {...agentHandle({ handle: 'form-field-settings-min' }, { role: 'field', label: 'Lowest value or earliest date/time accepted' })} />
            <span aria-hidden="true">–</span>
            <input type={view.boundsType} className={view.boundsClass} aria-label={t('Max')} placeholder={t('Max')} value={form.max} onChange={view.onMax}
              {...agentHandle({ handle: 'form-field-settings-max' }, { role: 'field', label: 'Highest value or latest date/time accepted' })} />
            {settings.step ? (
              <input type="number" min={0} step="any" className="field-settings-num" aria-label={t('Step')} placeholder={t('Step')} value={form.step} onChange={view.onStep}
                {...agentHandle({ handle: 'form-field-settings-step' }, { role: 'field', label: 'Increment between accepted values' })} />
            ) : null}
          </span>
        </div>
      ) : null}

      {settings.upload ? (
        <>
          <div className="field-settings-row">
            <span className="field-settings-label">
              <span className="field-label" id="field-settings-files-label">{t('Files')}</span>
              <InfoTip label={t('Leave all unticked to accept every safe type: images, video and PDF.')} />
            </span>
            <span className="field-settings-checks" role="group" aria-labelledby="field-settings-files-label">
              {view.uploads.map((choice) => (
                <label key={choice.value} className="form-checkbox-field">
                  <input type="checkbox" checked={choice.checked} onChange={choice.onToggle}
                    {...agentHandle({ handle: choice.handle }, { role: 'checkbox', label: `Accept ${choice.label} uploads` })} />
                  {t(choice.label)}
                </label>
              ))}
            </span>
          </div>
          <div className="field-settings-row">
            <label className="field-label" htmlFor="field-settings-max-size">{t('Max size (MB)')}</label>
            <input id="field-settings-max-size" type="number" min={0} max={MAX_UPLOAD_MB} step="any" className="field-settings-num" placeholder={String(MAX_UPLOAD_MB)}
              value={form.maxFileSizeMb} onChange={view.onMaxFileSize}
              {...agentHandle({ handle: 'form-field-settings-max-size' }, { role: 'field', label: 'Largest upload accepted, in megabytes' })} />
          </div>
        </>
      ) : null}
    </div>
  );
}
