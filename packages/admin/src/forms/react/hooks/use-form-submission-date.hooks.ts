import { useFormsOptions } from "./FormsPorts.hooks.js";
import { formDateDisplay } from "../../rules.js";

/** Bind submission timestamps to the same operator locale and local time as the Forms list. */
export function useFormSubmissionDate(
  _required: Record<string, never>,
  { locale: localeOverride, timeZone }: { locale?: string; timeZone?: string } = {},
) {
  const { locale } = useFormsOptions();
  // One locale subscription per submissions panel, rather than one per timestamp cell.
  return ({ iso }: { iso: string }, _optional: Record<string, never> = {}) =>
    formDateDisplay({ iso, locale: localeOverride ?? locale }, timeZone === undefined ? {} : { timeZone });
}
