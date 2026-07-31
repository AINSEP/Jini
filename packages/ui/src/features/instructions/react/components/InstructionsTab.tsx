import { useT } from '../../../i18n/index.js';

export interface InstructionsTabProps {
  value: string;
  /**
   * Fires on every keystroke with the raw textarea value, except an
   * all-empty textarea reports `undefined` rather than `''` — matching the
   * origin's `event.target.value || undefined` collapse (`SettingsDialog.tsx`
   * `customInstructions: event.target.value || undefined`), so a host
   * persisting straight through to a nullable `customInstructions?: string`
   * field never stores a distinguishable "empty string" state.
   */
  onChange: (value: string | undefined) => void;
  title?: string;
  description?: string;
  placeholder?: string;
  rows?: number;
  maxLength?: number;
}

/**
 * A plain textarea bound to a free-text "custom instructions" string.
 * Origin: the inline `instructions` tab body in `SettingsDialog.tsx` —
 * GENERIC, the simplest tab in the whole sweep (no state beyond the bound
 * value, no branching, no side effects).
 */
export function InstructionsTab({
  value,
  onChange,
  title,
  description,
  placeholder,
  rows = 5,
  maxLength = 5000,
}: InstructionsTabProps) {
  const t = useT();
  const resolvedTitle = title ?? t('Custom instructions');
  const resolvedDescription =
    description ?? t('Extra instructions applied to every conversation, in addition to any per-project instructions.');
  const resolvedPlaceholder = placeholder ?? t('e.g. Always respond concisely and avoid unnecessary caveats.');

  return (
    <section className="jini-settings-section jini-settings-section-card jini-instructions-section">
      <div className="jini-field-block jini-instructions-card">
        <div className="jini-block-head">
          <div>
            <h4>{resolvedTitle}</h4>
            <p className="jini-hint">{resolvedDescription}</p>
          </div>
        </div>
        <textarea
          className="jini-custom-instructions-input jini-instructions-input"
          rows={rows}
          maxLength={maxLength}
          placeholder={resolvedPlaceholder}
          aria-label={resolvedTitle}
          value={value}
          onChange={(event) => onChange(event.target.value || undefined)}
        />
      </div>
    </section>
  );
}
