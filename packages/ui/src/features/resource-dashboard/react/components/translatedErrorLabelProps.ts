import type { useT } from '../../../i18n/index.js';

/**
 * Translated labels for a view's LOAD failure (`error`) and its per-item
 * action failure (`actionError`), each forwarded only while that error is
 * set — shared by `ResourceBoard` and `ResourceRowList`, whose views both
 * fall back to the raw error string when no label is given.
 */
export function translatedErrorLabelProps({
  t,
  error,
  actionError,
}: {
  t: ReturnType<typeof useT>;
  error: string | null;
  actionError: string | null;
}): { errorLabel?: string; actionErrorLabel?: string } {
  return {
    ...(error ? { errorLabel: t(error) } : {}),
    ...(actionError ? { actionErrorLabel: t(actionError) } : {}),
  };
}
