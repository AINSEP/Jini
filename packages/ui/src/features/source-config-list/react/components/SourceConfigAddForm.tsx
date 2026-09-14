import { useT } from '../../../i18n/index.js';
import { sourceConfigActionHandle, sourceConfigAgentProps, sourceConfigFieldHandle } from '../../agent-handles.js';
import { issueForField } from '../../rules.js';
import type {
  SourceDraftValidation,
  SourceFieldSpec,
  SourceFieldValues,
  SourceTestResult,
  SourceTrustOption,
} from '../../types.js';
import { SourceConfigField } from './SourceConfigField.js';
import { SourceConfigTestControl } from './SourceConfigTestControl.js';

export interface SourceConfigAddFormProps {
  fieldSpecs: readonly SourceFieldSpec[];
  trustOptions?: readonly SourceTrustOption[];
  values: SourceFieldValues;
  trust?: string | undefined;
  validation: SourceDraftValidation;
  submitAttempted: boolean;
  submitting: boolean;
  submitError?: string | null | undefined;
  addLabel?: string;
  onFieldChange: (key: string, value: string) => void;
  onTrustChange: (value: string) => void;
  onSubmit: () => void;
  /**
   * Test-before-save (the origin BYOK `EntryShell.tsx`/`ByokConnectionTestControl`
   * "test before save" UX — see `ports.ts`'s `testSource` doc comment): only
   * rendered when the host's port implements `testSource` at all
   * (`capabilities.canTest`, mirrored here as `canTest` since this
   * presentational component never reads `capabilities` itself). Disabled
   * while the current draft fails required-field/URL validation, matching
   * the origin's own `canTestProvider`/`baseUrlValid` gate — testing an
   * incomplete draft isn't a meaningful connection test.
   */
  canTest?: boolean;
  testing?: boolean;
  testResult?: SourceTestResult;
  onTest?: () => void;
  /**
   * This form's own agent handle — publishes the form and everything in it to
   * `@jini-ai/agentic`'s `page.*` verbs. A plain string, not a per-element
   * map: the caller names the form, this component names its own parts and
   * supplies each one's role and label, because only it knows which controls
   * it renders for a given set of props. Omit and no `data-agent-*` markup is
   * emitted at all. See the table below and `../../agent-handles.ts`.
   */
  agentHandle?: string;
  /**
   * Renders a Cancel button beside submit when given. The host owns what
   * cancelling means (typically `useSourceConfigAddForm().reset()` plus closing
   * the form); omit it and no button renders, byte-identical to before.
   */
  onCancel?: () => void;
  /** Cancel button copy, translated. Defaults to `'Cancel'`. */
  cancelLabel?: string;
}

/**
 * The "add a source" form: one `SourceConfigField` per host-supplied field
 * spec, an optional trust selector (rendered only when `trustOptions` is
 * given — the origin MCP-server shape has no trust concept at all), an
 * optional test-before-save control, and a submit button. Dumb/
 * presentational — the draft state lives in `useSourceConfigAddForm`. Field
 * errors only render once a submit has been attempted, matching the origin
 * sources' "don't yell at the user before they've tried to submit" UX.
 *
 * ## Agent handles
 *
 * Given `agentHandle="mcp-add"` this publishes:
 *
 * | element | handle | role |
 * |---|---|---|
 * | the form | `mcp-add` | `form` |
 * | one field (per `spec.key`) | `mcp-add-field-<kebab-cased key>` | `field` |
 * | the trust selector | `mcp-add-trust` | `field` |
 * | the test control | `mcp-add-test` / `mcp-add-test-status` | `button` / `status` |
 * | the submit button | `mcp-add-submit` | `button` |
 *
 * The field set is whatever `fieldSpecs` currently is, so a host that varies
 * `fieldSpecs` in response to a draft change (a transport picker that reveals
 * URL-only fields, say) publishes the new fields as soon as they mount — a
 * caller's next `page.find_elements` sees them, because that verb re-queries
 * the DOM rather than replaying an earlier snapshot.
 */
export function SourceConfigAddForm({
  fieldSpecs,
  trustOptions,
  values,
  trust,
  validation,
  submitAttempted,
  submitting,
  submitError,
  addLabel,
  onFieldChange,
  onTrustChange,
  onSubmit,
  canTest = false,
  testing = false,
  testResult,
  onTest,
  agentHandle,
  onCancel,
  cancelLabel,
}: SourceConfigAddFormProps) {
  const t = useT();
  const submitLabel = addLabel ? t(addLabel) : t('Add source');
  const trustLabel = t('Trust level');
  const submitButton = (
    <button
      type="submit"
      className="source-config-add-form-submit"
      disabled={submitting}
      {...sourceConfigAgentProps(agentHandle, { role: 'button', label: submitLabel, action: 'submit' })}
    >
      {submitting ? t('Adding…') : submitLabel}
    </button>
  );

  return (
    <form
      className="source-config-add-form"
      {...sourceConfigAgentProps(agentHandle, { role: 'form', label: submitLabel })}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      {fieldSpecs.map((spec) => {
        const issue = submitAttempted ? issueForField(validation, spec.key) : undefined;
        return (
          <SourceConfigField
            key={spec.key}
            spec={spec}
            value={values[spec.key] ?? ''}
            disabled={submitting}
            onChange={(value) => onFieldChange(spec.key, value)}
            {...(issue ? { error: t(issue.message, { label: t(spec.label) }) } : {})}
            {...(agentHandle ? { agentHandle: sourceConfigFieldHandle(agentHandle, spec.key) } : {})}
          />
        );
      })}
      {trustOptions && trustOptions.length > 0 ? (
        <label className="source-config-field" htmlFor="source-config-add-form-trust">
          <span className="source-config-field-label">{trustLabel}</span>
          <select
            id="source-config-add-form-trust"
            value={trust ?? ''}
            disabled={submitting}
            aria-label={trustLabel}
            {...sourceConfigAgentProps(agentHandle, { role: 'field', label: trustLabel, action: 'trust' })}
            onChange={(event) => onTrustChange(event.target.value)}
          >
            {!trust ? (
              <option value="" disabled hidden>
                {t('Select…')}
              </option>
            ) : null}
            {trustOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.label)}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {canTest && onTest ? (
        <SourceConfigTestControl
          running={testing}
          disabled={submitting || !validation.ok}
          onTest={onTest}
          {...(testResult ? { result: testResult } : {})}
          {...(agentHandle ? { agentHandle: sourceConfigActionHandle(agentHandle, 'test') } : {})}
        />
      ) : null}
      {submitError ? (
        <div className="source-config-add-form-error" role="alert">
          {t(submitError)}
        </div>
      ) : null}
      {onCancel ? (
        <div className="source-config-add-form-actions">
          {submitButton}
          <button
            type="button"
            className="source-config-add-form-cancel"
            disabled={submitting}
            {...sourceConfigAgentProps(agentHandle, { role: 'button', label: t(cancelLabel ?? 'Cancel'), action: 'cancel' })}
            onClick={onCancel}
          >
            {t(cancelLabel ?? 'Cancel')}
          </button>
        </div>
      ) : (
        submitButton
      )}
    </form>
  );
}
