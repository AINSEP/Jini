import { useEffect, useRef, useState } from 'react';
import { useT } from '../../../i18n/index.js';
import { sourceConfigAgentProps } from '../../agent-handles.js';
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
  /**
   * This field's own agent handle — publishes the input/select/textarea to
   * `@jini-ai/agentic`'s `page.*` verbs as `<agentHandle>`, and the
   * `password`/`secret-textarea` show-hide toggle as `<agentHandle>-reveal`.
   * A plain string, not a per-element map: the caller names the field, this
   * component names its own parts and supplies each one's role and label,
   * because only it knows what its own toggle does. See
   * `../../agent-handles.ts` for the full scheme.
   *
   * Omit entirely and no `data-agent-*` markup is emitted at all — the
   * rendered DOM is byte-identical to before this prop existed.
   */
  agentHandle?: string;
}

/**
 * Renders one host-described field (`text`/`url`/`password`/`select`/
 * `textarea`) in the add-source form (or an item card's expand-to-edit
 * fields). Dumb/presentational — the draft value and validation live in
 * `useSourceConfigAddForm`/the caller. The `password` kind's show/hide
 * toggle is small local disclosure state (per the vertical-slice guardrail
 * allowing that in a leaf component), ported in spirit from the origin
 * `byok/ByokKeyField.tsx`.
 *
 * `secret-textarea`'s reveal gate (masked + read-only until "Show" is
 * clicked) only ever applies to a field that MOUNTED with an existing stored
 * value — see `isLockedSecret` below. A field with nothing to protect (a
 * brand-new/always-empty field, or one already cleared out) is immediately
 * editable with no reveal click required; there is no secret to guard, so
 * gating it would just block legitimate first-time entry.
 *
 * ## Agent handles
 *
 * Given `agentHandle="mcp-add-field-api-key"` this publishes:
 *
 * | element | handle | role |
 * |---|---|---|
 * | the input/select/textarea | `mcp-add-field-api-key` | `field` |
 * | the show-hide toggle | `mcp-add-field-api-key-reveal` | `button` |
 *
 * Note that publishing a handle is not the same as making a field writable:
 * `page.fill` independently refuses credential fields, so a `password`-kind
 * field is discoverable and readable-as-ontology but still only a human can
 * type into it. That refusal lives in `@jini-ai/agentic`'s own guards and is
 * not something this component either grants or can route around.
 */
export function SourceConfigField({ spec, value, error, disabled = false, idPrefix = 'source-config-field', agentHandle, onChange }: SourceConfigFieldProps) {
  const t = useT();
  const [revealed, setRevealed] = useState(false);

  // Whether THIS mount ever had a pre-existing secret to protect, captured
  // once rather than recomputed from `value` on every render. A plain
  // `Boolean(value)` gate would look right at first glance but re-locks the
  // field the instant a first-time entry stops being empty — i.e. after the
  // user's very first keystroke, since `value` goes from '' to non-empty as
  // a DIRECT RESULT of their own typing, not because a stored secret showed
  // up. A ref survives across renders without itself triggering one, so it
  // can be flipped on (below, in the empty-value effect) without disturbing
  // in-progress typing.
  const hadStoredSecretRef = useRef(spec.kind === 'secret-textarea' && Boolean(value));

  // Re-hide as soon as the field empties. The add form clears its values after a
  // successful submit but keeps this component mounted, so a `revealed` left on
  // from the previous entry meant the NEXT credential was typed into a visible
  // `type="text"` input — a plain shoulder-surfing exposure in the ordinary
  // add-several-sources flow, with nothing on screen to suggest it.
  //
  // For `secret-textarea` this also drops `hadStoredSecretRef`: once a field
  // is empty there is nothing left to protect, so it must never re-engage the
  // reveal gate again for the rest of this mount — whether that emptiness
  // came from a successful submit (this component reused for the next entry)
  // or from the user clearing an existing secret mid-edit to type a new one.
  useEffect(() => {
    if (!value) {
      setRevealed(false);
      hadStoredSecretRef.current = false;
    }
  }, [value]);
  const inputId = `${idPrefix}-${spec.key}`;
  const errorId = error ? `${inputId}-error` : undefined;
  const placeholder = spec.placeholder ? t(spec.placeholder) : undefined;
  // Gate (mask + block direct typing) only when there is an actual stored
  // secret still un-revealed. A field with nothing to protect — first-time
  // entry, or one already cleared out — is immediately editable, no
  // "Show"/reveal click required.
  const isLockedSecret = spec.kind === 'secret-textarea' && hadStoredSecretRef.current && !revealed;

  const fieldLabel = t(spec.label);
  const controlAgentProps = sourceConfigAgentProps(agentHandle, { role: 'field', label: fieldLabel });
  // Labelled by the field it reveals, not by the live "Show"/"Hide" on its face: an agent label is
  // stable page ontology, so it must not flip every time the toggle is clicked.
  const revealAgentProps = sourceConfigAgentProps(agentHandle, {
    role: 'button',
    label: t('Show or hide {label}', { label: fieldLabel }),
    action: 'reveal',
  });

  return (
    <label className="source-config-field" htmlFor={inputId}>
      <span className="source-config-field-label">
        {fieldLabel}
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
          {...controlAgentProps}
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
            value={isLockedSecret ? maskFieldValue(spec.kind, value) : value}
            placeholder={placeholder}
            // A masked textarea must not be typed into — the visible text is not
            // the real value, so an edit would commit the mask characters.
            // Revealing is the way in, exactly like the password field. Only
            // applies when there is a stored secret to protect — see
            // `isLockedSecret`.
            readOnly={isLockedSecret}
            disabled={disabled}
            aria-invalid={Boolean(error) || undefined}
            aria-describedby={errorId}
            {...controlAgentProps}
            onChange={(event) => onChange(event.target.value)}
          />
          {spec.kind === 'secret-textarea' ? (
            <button
              type="button"
              className="source-config-field-toggle"
              disabled={disabled}
              {...revealAgentProps}
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
            // `new-password`, NOT `off`: Chrome deliberately ignores `off` and fills a saved site
            // login into the first password input it finds (and the text input above it as the
            // username). A source's credential is never the operator's own login.
            autoComplete="new-password"
            value={value}
            placeholder={placeholder}
            disabled={disabled}
            aria-invalid={Boolean(error) || undefined}
            aria-describedby={errorId}
            {...controlAgentProps}
            onChange={(event) => onChange(event.target.value)}
          />
          <button
            type="button"
            className="source-config-field-toggle"
            disabled={disabled}
            {...revealAgentProps}
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
          {...controlAgentProps}
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
