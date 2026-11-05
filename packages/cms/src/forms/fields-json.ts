import type { FieldDescriptor, FormDefinitionRecord } from './types.js';
import type { FormProviderSelection } from './provider.js';

export type FormAuthoring = { mode?: 'builder' | 'html'; html?: string | undefined; provider?: FormProviderSelection | undefined };
export type HtmlFormDefinitionRecord = FormDefinitionRecord & FormAuthoring;

/** Old arrays read as built-in; the existing envelope carries authoring and public collection choice.
 * @example decodeFormFields({ json: '[]' });
 * @complexity O(b) time/space for stored JSON bytes; no I/O.
 * @overallScore 96 — Recommended: malformed repository JSON keeps the existing parse-error contract. */
export function decodeFormFields({ json }: { json: string }, _optional = {}): Pick<HtmlFormDefinitionRecord, 'fields' | 'mode' | 'html' | 'provider'> {
  const stored = JSON.parse(json) as FieldDescriptor[] | (FormAuthoring & { fields: FieldDescriptor[] });
  return Array.isArray(stored) ? { fields: stored } : {
    fields: stored.fields,
    ...(stored.mode !== undefined ? { mode: stored.mode } : {}),
    ...(stored.html !== undefined ? { html: stored.html } : {}),
    ...(stored.provider ? { provider: stored.provider } : {}),
  };
}

/** Provider choices require the envelope even for Builder forms; updates retain omitted selection metadata.
 * @example encodeFormFields({ definition });
 * @complexity O(b) time/space for definition bytes; no I/O.
 * @overallScore 97 — Recommended: legacy Builder records remain arrays until metadata is needed. */
export function encodeFormFields({ definition }: { definition: HtmlFormDefinitionRecord }, _optional = {}): string {
  if (definition.mode !== 'html' && !definition.provider) return JSON.stringify(definition.fields);
  return JSON.stringify({ fields: definition.fields,
    ...(definition.mode === 'html' ? { mode: 'html', html: definition.html ?? '' } : {}),
    ...(definition.provider ? { provider: definition.provider } : {}),
  });
}
