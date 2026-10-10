import { useEffect, useState, type ChangeEvent, type FocusEvent } from 'react';
import type { ConsentSettingsPanelProps, ConsentSettingsView } from './ConsentSettingsPanel.js';

/** Keep value conversions and toggle behavior out of the view. React owns event signatures. */
export function useConsentSettingsPanel({ value, onChange }: Pick<ConsentSettingsPanelProps, 'value' | 'onChange'>, _options = {}) {
  return {
    toggle: () => onChange({ patch: { enabled: !value.enabled } }),
    region: (event: ChangeEvent<HTMLSelectElement>) => onChange({ patch: { regionMode: event.target.value as ConsentSettingsView['regionMode'] } }),
    text: (key: keyof ConsentSettingsView) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange({ patch: { [key]: event.target.value } }),
  };
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
