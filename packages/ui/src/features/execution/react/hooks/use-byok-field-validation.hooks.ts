import { useState } from 'react';
import { isBaseUrlInvalid, missingRequiredFields } from '../../rules.js';
import type { ByokConfig, ProviderPreset } from '../../types.js';

type Field = 'apiKey' | 'baseUrl' | 'model';

/** Keeps required-field gates immediate while optionally waiting for blur to paint errors.
 * Stored keys satisfy only the key requirement; touching one provider never marks another.
 * @complexity Time/space: O(1), bounded by the three required fields.
 */
export function useByokFieldValidation(
  required: { config: ByokConfig; preset: ProviderPreset | null; apiKeyStoredExternally: boolean },
  optional: { deferMissingFeedback?: boolean } = {},
) {
  const { config, preset, apiKeyStoredExternally } = required;
  const [touched, setTouched] = useState<{ providerId: ByokConfig['providerId']; fields: Set<Field> }>(
    { providerId: config.providerId, fields: new Set() },
  );
  const missing = new Set(missingRequiredFields(config, preset));
  if (apiKeyStoredExternally) missing.delete('apiKey');
  const baseUrlInvalid = isBaseUrlInvalid(config);

  return {
    missing,
    baseUrlInvalid,
    isMissing: ({ field }: { field: Field }, _options: Record<string, never> = {}) => {
      const invalid = missing.has(field) || (field === 'baseUrl' && baseUrlInvalid);
      if (!invalid || !optional.deferMissingFeedback) return invalid;
      return touched.providerId === config.providerId && touched.fields.has(field);
    },
    markTouched: ({ field }: { field: Field }, _options: Record<string, never> = {}) => {
      setTouched(current => ({
        providerId: config.providerId,
        fields: new Set([...(current.providerId === config.providerId ? current.fields : []), field]),
      }));
    },
  };
}
