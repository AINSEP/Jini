import { useId } from 'react';
import { ConsentBannerFields, ConsentLookFields, ConsentRulesFields, type ConsentFieldsProps } from './ConsentFields.js';

/** Bounded appearance tokens, as the engine accepts them: opaque hex colors and `Npx` lengths. */
export interface ConsentAppearanceView {
  backgroundColor?: string;
  textColor?: string;
  borderColor?: string;
  borderRadius?: string;
  padding?: string;
  fontSize?: string;
  maxWidth?: string;
}

/** The host's consent configuration. The look fields are optional so older hosts stay valid. */
export interface ConsentSettingsView {
  enabled: boolean;
  /** Optional for older hosts; omitted means the dynamic code exception is off. */
  allowUnsafeEval?: boolean;
  regionMode: 'auto' | 'opt-in' | 'opt-out';
  policyVersion: string;
  privacyPolicyUrl: string;
  title: string;
  message: string;
  acceptLabel: string;
  rejectLabel: string;
  preferencesLabel: string;
  placement?: string;
  secondaryLinkLabel?: string;
  secondaryLinkUrl?: string;
  appearance?: ConsentAppearanceView;
  customCss?: string;
}

/** One validation result. `field` names the setting it belongs to; field-less problems are the host's to show. */
export interface ConsentFieldProblem {
  message: string;
  field?: string;
  code?: string;
}

export interface ConsentSettingsPanelProps extends Pick<ConsentFieldsProps, 'problems' | 'limits'> {
  value: ConsentSettingsView;
  onChange(required: { patch: Partial<ConsentSettingsView> }, optional?: Record<string, never>): void;
  loading: boolean;
  error: string | null;
  status: string;
  /** Host translations keyed by the exact fallback copy; unspecified entries use English. */
  dictionary?: Readonly<Record<string, string>>;
}

/** The composed default for hosts that want one screen: Rules, Banner and Look stacked.
 * Shared jini settings classes keep the panel in the host's design language.
 * Native labels/selects/checkboxes support keyboard use at desktop and narrow widths. */
export function ConsentSettingsPanel({ value, onChange, loading, error, status, dictionary = {}, problems, limits }: ConsentSettingsPanelProps) {
  const id = useId();
  const t = (text: string) => dictionary[text] ?? text;
  const fields = { value, onChange, disabled: loading, problems, dictionary, limits };
  return <section className="jini-settings-section" aria-labelledby={`${id}-heading`}>
    <div className="jini-section-head"><div><h4 id={`${id}-heading`}>{t('Site cookie consent')}</h4>
      <p className="jini-hint">{t('Provides the consent mechanism, not legal advice. Review your texts, categories, and privacy policy for your site.')}</p></div></div>
    <p className="jini-hint">{t('Off by default. In opt-in regions, optional scripts stay paused until a visitor chooses. Unclassified third-party scripts use the marketing category. Global Privacy Control disables analytics and marketing.')}</p>
    <ConsentRulesFields {...fields} />
    <ConsentBannerFields {...fields} />
    <ConsentLookFields {...fields} />
    {error && <p className="jini-hint jini-hint-error" role="alert">{error}</p>}
    <p className="jini-hint" role="status">{status}</p>
  </section>;
}
