import { useEffect, useState, type ChangeEvent, type FocusEvent } from 'react';
import type { ConsentAppearanceView, ConsentFieldProblem, ConsentSettingsPanelProps, ConsentSettingsView } from './ConsentSettingsPanel.js';

/** Keep value conversions and toggle behavior out of the view. React owns event signatures. */
export function useConsentSettingsPanel({ value, onChange }: Pick<ConsentSettingsPanelProps, 'value' | 'onChange'>, _options = {}) {
  return {
    toggle: () => onChange({ patch: { enabled: !value.enabled } }),
    region: (event: ChangeEvent<HTMLSelectElement>) => onChange({ patch: { regionMode: event.target.value as ConsentSettingsView['regionMode'] } }),
    placement: (event: ChangeEvent<HTMLSelectElement>) => onChange({ patch: { placement: event.target.value } }),
    text: (key: keyof ConsentSettingsView) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange({ patch: { [key]: event.target.value } }),
    /** Empty input unsets the token so the engine default applies again. */
    token: (key: keyof ConsentAppearanceView) => (next: string) => onChange({ patch: { appearance: withAppearanceToken({ appearance: value.appearance, key, value: next }) } }),
  };
}

/** A new token object with `key` set, or removed when `value` is empty. Never mutates the input.
 * @complexity O(t), t <= 7 tokens. */
export function withAppearanceToken({ appearance = {}, key, value }: { appearance?: ConsentAppearanceView | undefined; key: keyof ConsentAppearanceView; value: string }, _options = {}): ConsentAppearanceView {
  const next = { ...appearance };
  if (value === '') delete next[key];
  else next[key] = value;
  return next;
}

/** `"12px"` → `"12"` for a number input; unset or hand-written values read empty. */
export function pixelInputValue({ value }: { value: string | undefined }, _options = {}): string {
  return /^(\d+(?:\.\d+)?)px$/.exec(value ?? '')?.[1] ?? '';
}

/** The problems a host attached to one field, in their original order. O(p). */
export function problemsFor({ problems = [], field }: { problems?: readonly ConsentFieldProblem[] | undefined; field: string }, _options = {}): ConsentFieldProblem[] {
  return problems.filter(problem => problem.field === field);
}

/** Keep transient empty edits local; only a valid policy version reaches autosave.
 * Native validity gives keyboard users an actionable error. Valid edits save before navigation.
 * @complexity O(version length), <=128. */
export function usePolicyVersionInput({ value, onChange }: Pick<ConsentSettingsPanelProps, 'onChange'> & { value: string }, _options = {}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return {
    draft,
    change: (event: ChangeEvent<HTMLInputElement>) => {
      const next = event.currentTarget.value;
      setDraft(next);
      if (event.currentTarget.checkValidity()) onChange({ patch: { policyVersion: next } });
    },
    blur: (event: FocusEvent<HTMLInputElement>) => {
      if (!event.currentTarget.checkValidity()) event.currentTarget.reportValidity();
    },
  };
}

export type ConsentPreviewWidth = 'phone' | 'desktop';

/** The preview's own phone/desktop switch; the host never needs to own it. */
export function useConsentPreviewWidth({ initial = 'desktop' }: { initial?: ConsentPreviewWidth } = {}, _options = {}) {
  const [width, setWidth] = useState<ConsentPreviewWidth>(initial);
  return { width, setWidth };
}
