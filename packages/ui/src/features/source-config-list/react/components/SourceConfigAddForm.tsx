import { useT } from '../../../i18n/index.js';
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
}

/**
 * The "add a source" form: one `SourceConfigField` per host-supplied field
 * spec, an optional trust selector (rendered only when `trustOptions` is
 * given — the origin MCP-server shape has no trust concept at all), an
 * optional test-before-save control, and a submit button. Dumb/
 * presentational — the draft state lives in `useSourceConfigAddForm`. Field
 * errors only render once a submit has been attempted, matching the origin
 * sources' "don't yell at the user before they've tried to submit" UX.
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
}: SourceConfigAddFormProps) {
  const t = useT();

  return (
    <form
      className="source-config-add-form"
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
          />
        );
      })}
      {trustOptions && trustOptions.length > 0 ? (
        <label className="source-config-field" htmlFor="source-config-add-form-trust">
          <span className="source-config-field-label">{t('Trust level')}</span>
          <select
            id="source-config-add-form-trust"
            value={trust ?? ''}
            disabled={submitting}
            aria-label={t('Trust level')}
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
        />
      ) : null}
      {submitError ? (
        <div className="source-config-add-form-error" role="alert">
          {t(submitError)}
        </div>
      ) : null}
      <button type="submit" className="source-config-add-form-submit" disabled={submitting}>
        {submitting ? t('Adding…') : addLabel ? t(addLabel) : t('Add source')}
      </button>
    </form>
  );
}
