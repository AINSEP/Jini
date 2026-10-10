import { useId } from 'react';
import { useConsentSettingsPanel, usePolicyVersionInput } from './settings-panel.hooks.js';

/** The host's settings controller uses its existing ledger lifecycle. */
export interface ConsentSettingsView {
  enabled: boolean;
  regionMode: 'auto' | 'opt-in' | 'opt-out';
  policyVersion: string;
  privacyPolicyUrl: string;
  title: string;
  message: string;
  acceptLabel: string;
  rejectLabel: string;
  preferencesLabel: string;
}

export interface ConsentSettingsPanelProps {
  value: ConsentSettingsView;
  onChange(required: { patch: Partial<ConsentSettingsView> }, optional?: Record<string, never>): void;
  loading: boolean;
  error: string | null;
  status: string;
  /** Host translations keyed by the exact fallback copy; unspecified entries use English. */
  dictionary?: Readonly<Record<string, string>>;
}

const TEXT_FIELDS = [
  ['title', 'Banner title', 2000], ['message', 'Banner message', 2000],
  ['acceptLabel', 'Accept button text', 2000], ['rejectLabel', 'Reject button text', 2000],
  ['preferencesLabel', 'Preferences label', 2000], ['policyVersion', 'Policy version', 128],
  ['privacyPolicyUrl', 'Privacy policy page URL', 2000],
] as const;

/** Shared jini settings classes keep the panel in the host's design language.
 * Native labels/selects/checkboxes support keyboard use at desktop and narrow widths. */
export function ConsentSettingsPanel({ value, onChange, loading, error, status, dictionary = {} }: ConsentSettingsPanelProps) {
  const id = useId();
  const t = (text: string) => dictionary[text] ?? text;
  const handlers = useConsentSettingsPanel({ value, onChange });
  return <section className="jini-settings-section" aria-labelledby={`${id}-heading`}>
    <div className="jini-section-head"><div><h4 id={`${id}-heading`}>{t('Site cookie consent')}</h4>
      <p className="jini-hint">{t('Provides the consent mechanism, not legal advice. Review your texts, categories, and privacy policy for your site.')}</p></div></div>
    <p className="jini-hint">{t('Off by default. In opt-in regions, optional scripts stay paused until a visitor chooses. Unclassified third-party scripts use the marketing category. Global Privacy Control disables analytics and marketing.')}</p>
    <button type="button" className={value.enabled ? 'jini-toggle-row on' : 'jini-toggle-row'} role="switch" aria-checked={value.enabled} aria-labelledby={`${id}-enabled`} aria-describedby={`${id}-hint`} disabled={loading} onClick={handlers.toggle}>
      <span className="jini-toggle-row-text"><span id={`${id}-enabled`} className="jini-toggle-row-label">{t('Enable cookie consent on this site')}</span><span id={`${id}-hint`} className="jini-toggle-row-hint">{t('Applies to published site pages.')}</span></span><span className="jini-toggle-row-switch" aria-hidden="true" />
    </button>
    <fieldset disabled={loading} className="jini-consent-settings-fields"><legend>{t('Banner settings')}</legend>
      <label className="jini-consent-settings-field"><span className="jini-field-label">{t('Region mode')}</span><select className="jini-input" value={value.regionMode} onChange={handlers.region}>
        <option value="auto">{t('Automatic (unknown region: opt-in)')}</option><option value="opt-in">{t('Opt-in everywhere (EU / UK)')}</option><option value="opt-out">{t('Opt-out everywhere (California)')}</option>
      </select></label>
      <p className="jini-hint">{t('Automatic uses a trusted request-region header when configured. California permits optional categories until opt-out; Global Privacy Control always disables analytics and marketing.')}</p>
      {TEXT_FIELDS.map(([key, label, maxLength]) => <label className="jini-consent-settings-field" key={key}><span className="jini-field-label">{t(label)}</span>
        {key === 'policyVersion' ? <PolicyVersionInput value={value.policyVersion} onChange={onChange} /> : key === 'message' ? <textarea className="jini-input" value={value[key]} maxLength={maxLength} rows={3} onChange={handlers.text(key)} /> : <input className="jini-input" type="text" value={value[key]} maxLength={maxLength} onChange={handlers.text(key)} />}
      </label>)}
      <p className="jini-hint">{t('Link a published privacy policy page with its URL, such as /privacy. Change the policy version to ask visitors to choose again.')}</p>
    </fieldset>
    {error && <p className="jini-hint jini-hint-error" role="alert">{error}</p>}
    <p className="jini-hint" role="status">{status}</p>
  </section>;
}

/** Keep transient empty edits local; only a valid policy version reaches autosave.
 * Native validity gives keyboard users an actionable error. @complexity O(version length), <=128. */
function PolicyVersionInput({ value, onChange }: Pick<ConsentSettingsPanelProps, 'onChange'> & { value: string }) {
  const { draft, change, blur } = usePolicyVersionInput({ value, onChange });
  return <input className="jini-input" type="text" value={draft} required pattern={String.raw`.*\S.*`} maxLength={128}
    onChange={change} onBlur={blur} />;
}
