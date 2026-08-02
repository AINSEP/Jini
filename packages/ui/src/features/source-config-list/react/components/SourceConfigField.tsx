import { useEffect, useState } from 'react';
import { useT } from '../../../i18n/index.js';
import { maskFieldValue } from '../../rules.js';
import type { SourceFieldSpec } from '../../types.js';

export interface SourceConfigFieldProps {
  spec: SourceFieldSpec;
  value: string;
  error?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  /**
   * Disambiguates the generated DOM id when more than one `SourceConfigField`
   * for the SAME `spec.key` can be mounted at once (e.g. the add form's URL
   * field and an item card's expand-to-edit URL field for the same
   * `fieldSpecs` — both render simultaneously once a card is in edit mode).
   * Defaults to `'source-config-field'` (the add form's own usage, unchanged
   * from before this prop existed).
   */
  idPrefix?: string;
}

/**
 * Renders one host-described field (`text`/`url`/`password`/`select`/
 * `textarea`) in the add-source form (or an item card's expand-to-edit
 * fields). Dumb/presentational — the draft value and validation live in
 * `useSourceConfigAddForm`/the caller. The `password` kind's show/hide
 * toggle is small local disclosure state (per the vertical-slice guardrail
 * allowing that in a leaf component), ported in spirit from the origin
 * `byok/ByokKeyField.tsx`.
 */
export function SourceConfigField({ spec, value, error, disabled = false, idPrefix = 'source-config-field', onChange }: SourceConfigFieldProps) {
  const t = useT();
  const [revealed, setRevealed] = useState(false);

  // Re-hide as soon as the field empties. The add form clears its values after a
  // successful submit but keeps this component mounted, so a `revealed` left on
  // from the previous entry meant the NEXT credential was typed into a visible
  // `type="text"` input — a plain shoulder-surfing exposure in the ordinary
  // add-several-sources flow, with nothing on screen to suggest it.
  useEffect(() => {
    if (!value) setRevealed(false);
  }, [value]);
  const inputId = `${idPrefix}-${spec.key}`;
  const errorId = error ? `${inputId}-error` : undefined;
  const placeholder = spec.placeholder ? t(spec.placeholder) : undefined;

  return (
    <label className="source-config-field" htmlFor={inputId}>
      <span className="source-config-field-label">
        {t(spec.label)}
        {spec.required ? (
          <span className="source-config-field-required" aria-label={t('required')}>
            *
          </span>
        ) : null}
      </span>
      {spec.kind === 'select' ? (
        <select
          id={inputId}
          value={value}
          disabled={disabled}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={errorId}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="" disabled hidden>
            {placeholder ?? t('Select…')}
          </option>
          {(spec.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {t(option.label)}
            </option>
          ))}
        </select>
      ) : spec.kind === 'textarea' || spec.kind === 'secret-textarea' ? (
        <span className="source-config-field-row">
          <textarea
            id={inputId}
            value={spec.kind === 'secret-textarea' && !revealed ? maskFieldValue(spec.kind, value) : value}
            placeholder={placeholder}
            // A masked textarea must not be typed into — the visible text is not
            // the real value, so an edit would commit the mask characters.
            // Revealing is the way in, exactly like the password field.
            readOnly={spec.kind === 'secret-textarea' && !revealed}
            disabled={disabled}
            aria-invalid={Boolean(error) || undefined}
            aria-describedby={errorId}
            onChange={(event) => onChange(event.target.value)}
          />
          {spec.kind === 'secret-textarea' ? (
            <button
              type="button"
              className="source-config-field-toggle"
              disabled={disabled}
              onClick={() => setRevealed((current) => !current)}
              title={revealed ? t('Hide') : t('Show')}
            >
              {revealed ? t('Hide') : t('Show')}
            </button>
          ) : null}
        </span>
      ) : spec.kind === 'password' ? (
        <span className="source-config-field-row">
          <input
            id={inputId}
            type={revealed ? 'text' : 'password'}
            value={value}
            placeholder={placeholder}
            disabled={disabled}
            aria-invalid={Boolean(error) || undefined}
            aria-describedby={errorId}
            onChange={(event) => onChange(event.target.value)}
          />
          <button
            type="button"
            className="source-config-field-toggle"
            disabled={disabled}
            onClick={() => setRevealed((current) => !current)}
            title={revealed ? t('Hide') : t('Show')}
          >
            {revealed ? t('Hide') : t('Show')}
          </button>
        </span>
      ) : (
        <input
          id={inputId}
          type={spec.kind === 'url' ? 'url' : 'text'}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={errorId}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {error ? (
        <span id={errorId} className="source-config-field-error" role="alert">
          {error}
        </span>
      ) : null}
    </label>
  );
}
