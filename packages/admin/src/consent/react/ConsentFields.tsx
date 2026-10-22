import { useId, type ReactNode } from 'react';
import { defaultAdminTheme } from '@jini-ai/ui/theme';
import type { ConsentAppearanceView, ConsentFieldProblem, ConsentSettingsView } from './ConsentSettingsPanel.js';
import { pixelInputValue, problemsFor, useConsentSettingsPanel, usePolicyVersionInput } from './settings-panel.hooks.js';

/**
 * @file The consent settings split into the three sections a host can place on its own tabs:
 * Banner (copy and links), Look (placement and appearance) and Rules (on/off, region, version).
 * `ConsentSettingsPanel` stacks all three for hosts that want one screen. Every section is
 * controlled: it renders `value`, reports edits as patches and shows the host's `problems` next to
 * the field each one names. Hosts style the plain `jini-` classes.
 */

type TextKey = 'title' | 'message' | 'acceptLabel' | 'rejectLabel' | 'preferencesLabel' | 'privacyPolicyUrl' | 'secondaryLinkLabel' | 'secondaryLinkUrl';

export interface ConsentFieldsProps {
  value: ConsentSettingsView;
  onChange(required: { patch: Partial<ConsentSettingsView> }, optional?: Record<string, never>): void;
  disabled?: boolean | undefined;
  /** Server/engine problems; each one with a matching `field` renders under that control. */
  problems?: readonly ConsentFieldProblem[] | undefined;
  /** Host translations keyed by the exact fallback copy; unspecified entries use English. */
  dictionary?: Readonly<Record<string, string>> | undefined;
  /** Host max lengths per text field; the defaults are the engine's loosest bounds. */
  limits?: Readonly<Partial<Record<TextKey | 'policyVersion', number>>> | undefined;
}

const BANNER_FIELDS: readonly { key: TextKey; label: string; multiline?: boolean }[] = [
  { key: 'title', label: 'Banner title' }, { key: 'message', label: 'Banner message', multiline: true },
  { key: 'acceptLabel', label: 'Accept button text' }, { key: 'rejectLabel', label: 'Reject button text' },
  { key: 'preferencesLabel', label: 'Preferences label' }, { key: 'privacyPolicyUrl', label: 'Privacy policy page URL' },
  { key: 'secondaryLinkLabel', label: 'Second link text' }, { key: 'secondaryLinkUrl', label: 'Second link URL' },
];
const REGION_LABELS: Readonly<Record<ConsentSettingsView['regionMode'], string>> = {
  auto: 'Automatic (unknown region: opt-in)', 'opt-in': 'Opt-in everywhere (EU / UK)', 'opt-out': 'Opt-out everywhere (California)',
};
const PLACEMENT_LABELS: Readonly<Record<string, string>> = { 'bottom-bar': 'Bottom bar', 'bottom-left': 'Bottom left', 'bottom-right': 'Bottom right', 'top-bar': 'Top bar' };
// Native color inputs need concrete colors rather than CSS variable expressions.
const COLOR_TOKENS: readonly { key: keyof ConsentAppearanceView; label: string; fallback: string }[] = [
  { key: 'backgroundColor', label: 'Background', fallback: defaultAdminTheme.light.bg }, { key: 'textColor', label: 'Text', fallback: defaultAdminTheme.light.text }, { key: 'borderColor', label: 'Border', fallback: defaultAdminTheme.light.border },
];
/** The engine's own pixel bounds (`compileConsentCss`); out-of-range values come back as problems. */
const PIXEL_TOKENS: readonly { key: keyof ConsentAppearanceView; label: string; min: number; max: number }[] = [
  { key: 'borderRadius', label: 'Corner radius (px)', min: 0, max: 32 }, { key: 'padding', label: 'Padding (px)', min: 8, max: 32 },
  { key: 'fontSize', label: 'Text size (px)', min: 16, max: 24 }, { key: 'maxWidth', label: 'Max width (px)', min: 256, max: 960 },
];

function translator(dictionary: Readonly<Record<string, string>> = {}) {
  return (text: string) => dictionary[text] ?? text;
}

/** One field's problems, linked to its control through `aria-describedby`. */
function FieldProblems({ id, problems }: { id: string; problems: readonly ConsentFieldProblem[] }) {
  if (!problems.length) return null;
  return <span id={id} className="jini-consent-field-problems">{problems.map(problem => <span key={`${problem.code ?? ''}${problem.message}`} className="jini-hint jini-hint-error">{problem.message}</span>)}</span>;
}

type ControlAttributes = { id: string; 'aria-invalid'?: true; 'aria-describedby'?: string };

/** Label + control + problems. Problems sit outside the label so they never join the control's
 * name; they are its description and mark it invalid instead. */
function Field({ label, field, problems, children }: { label: string; field: string; problems?: readonly ConsentFieldProblem[] | undefined; children: (attributes: ControlAttributes) => ReactNode }) {
  const id = useId();
  const own = problemsFor({ problems, field });
  const attributes = own.length ? { id, 'aria-invalid': true as const, 'aria-describedby': `${id}-problems` } : { id };
  return <div className="jini-consent-settings-field"><label htmlFor={id} className="jini-field-label">{label}</label>{children(attributes)}<FieldProblems id={`${id}-problems`} problems={own} /></div>;
}

/** Banner copy and its links. Text is always plain text; the engine never renders it as HTML. */
export function ConsentBannerFields({ value, onChange, disabled = false, problems, dictionary, limits = {} }: ConsentFieldsProps) {
  const t = translator(dictionary);
  const handlers = useConsentSettingsPanel({ value, onChange });
  return <fieldset disabled={disabled} className="jini-consent-settings-fields"><legend>{t('Banner text')}</legend>
    {BANNER_FIELDS.map(({ key, label, multiline }) => <Field key={key} label={t(label)} field={key} problems={problems}>{aria => multiline
      ? <textarea className="jini-input" value={value[key] ?? ''} maxLength={limits[key] ?? 2000} rows={3} onChange={handlers.text(key)} {...aria} />
      : <input className="jini-input" type="text" value={value[key] ?? ''} maxLength={limits[key] ?? 2000} onChange={handlers.text(key)} {...aria} />}</Field>)}
    <p className="jini-hint">{t('Link a published privacy page, such as /privacy. The second link is optional.')}</p>
  </fieldset>;
}

/** On/off, region behavior and the policy version that re-asks visitors when it changes. */
export function ConsentRulesFields({ value, onChange, disabled = false, problems, dictionary, limits = {}, regionModes = ['auto', 'opt-in', 'opt-out'] }: ConsentFieldsProps & { regionModes?: readonly ConsentSettingsView['regionMode'][] }) {
  const id = useId();
  const t = translator(dictionary);
  const handlers = useConsentSettingsPanel({ value, onChange });
  const modes = regionModes.includes(value.regionMode) ? regionModes : [value.regionMode, ...regionModes];
  return <fieldset disabled={disabled} className="jini-consent-settings-fields"><legend>{t('Rules')}</legend>
    <button type="button" className={value.enabled ? 'jini-toggle-row on' : 'jini-toggle-row'} role="switch" aria-checked={value.enabled} aria-labelledby={`${id}-enabled`} aria-describedby={`${id}-hint`} onClick={handlers.toggle}>
      <span className="jini-toggle-row-text"><span id={`${id}-enabled`} className="jini-toggle-row-label">{t('Enable cookie consent on this site')}</span><span id={`${id}-hint`} className="jini-toggle-row-hint">{t('Applies to published site pages.')}</span></span><span className="jini-toggle-row-switch" aria-hidden="true" />
    </button>
    <Field label={t('Region mode')} field="regionMode" problems={problems}>{aria => <select className="jini-input" value={value.regionMode} onChange={handlers.region} {...aria}>
      {modes.map(mode => <option key={mode} value={mode}>{t(REGION_LABELS[mode])}</option>)}
    </select>}</Field>
    <p className="jini-hint">{t('California permits optional categories until opt-out. Global Privacy Control always disables analytics and marketing.')}</p>
    <Field label={t('Policy version')} field="policyVersion" problems={problems}>{aria => <PolicyVersionInput value={value.policyVersion} onChange={onChange} maxLength={limits.policyVersion ?? 128} aria={aria} />}</Field>
    <p className="jini-hint">{t('Change the policy version to ask visitors to choose again.')}</p>
  </fieldset>;
}

/** Placement, bounded appearance tokens and allowlisted custom CSS. The engine checks contrast and
 * CSS safety; its problems arrive on the `appearance` field and show under the custom CSS. */
export function ConsentLookFields({ value, onChange, disabled = false, problems, dictionary, placements = Object.keys(PLACEMENT_LABELS) }: ConsentFieldsProps & { placements?: readonly string[] }) {
  const t = translator(dictionary);
  const handlers = useConsentSettingsPanel({ value, onChange });
  const appearance = value.appearance ?? {};
  return <fieldset disabled={disabled} className="jini-consent-settings-fields"><legend>{t('Look & position')}</legend>
    <Field label={t('Position')} field="placement" problems={problems}>{aria => <select className="jini-input" value={value.placement ?? placements[0]} onChange={handlers.placement} {...aria}>
      {placements.map(placement => <option key={placement} value={placement}>{t(PLACEMENT_LABELS[placement] ?? placement)}</option>)}
    </select>}</Field>
    <div className="jini-consent-token-grid">
      {COLOR_TOKENS.map(token => <ColorToken key={token.key} label={t(token.label)} value={appearance[token.key]} fallback={token.fallback} resetLabel={t('Default')} onChange={handlers.token(token.key)} />)}
      {PIXEL_TOKENS.map(token => <Field key={token.key} label={t(token.label)} field={token.key}>{attributes =>
        <input className="jini-input" type="number" inputMode="numeric" min={token.min} max={token.max} step={1} placeholder={t('Default')} value={pixelInputValue({ value: appearance[token.key] })} onChange={event => handlers.token(token.key)(event.target.value === '' ? '' : `${event.target.value}px`)} {...attributes} />}</Field>)}
    </div>
    <Field label={t('Custom CSS')} field="appearance" problems={problems}>{aria => <textarea className="jini-input jini-consent-css" value={value.customCss ?? ''} rows={6} spellCheck={false} onChange={handlers.text('customCss')} {...aria} />}</Field>
    <p className="jini-hint">{t('Only banner selectors and safe properties are allowed. Text needs 4.5:1 contrast.')}</p>
  </fieldset>;
}

/** A native color picker; unset shows the shared theme default and offers no reset. */
function ColorToken({ label, value, fallback, resetLabel, onChange }: { label: string; value: string | undefined; fallback: string; resetLabel: string; onChange(next: string): void }) {
  const id = useId();
  return <div className="jini-consent-settings-field"><label htmlFor={id} className="jini-field-label">{label}</label>
    <span className="jini-consent-color-row">
      <input id={id} className="jini-consent-color" type="color" value={value ?? fallback} onChange={event => onChange(event.target.value)} />
      <code className="jini-hint">{value ?? resetLabel}</code>
      {value !== undefined && <button type="button" className="jini-btn-link" aria-label={`${resetLabel}: ${label}`} onClick={() => onChange('')}>{resetLabel}</button>}
    </span>
  </div>;
}

/** Keep transient empty edits local; only a valid policy version reaches autosave.
 * Native validity gives keyboard users an actionable error. @complexity O(version length), <=128. */
function PolicyVersionInput({ value, onChange, maxLength, aria }: Pick<ConsentFieldsProps, 'onChange'> & { value: string; maxLength: number; aria: object }) {
  const { draft, change, blur } = usePolicyVersionInput({ value, onChange });
  return <input className="jini-input" type="text" value={draft} required pattern={String.raw`.*\S.*`} maxLength={maxLength}
    onChange={change} onBlur={blur} {...aria} />;
}
