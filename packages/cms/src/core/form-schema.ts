import type { FormDefinitionRecord } from '../forms/types.js';
import type { FormSubmissionEvidence } from '../forms/submission-evidence.js';

/** Shared schema snapshot for native Widgets rendering and Forms submission evidence.
 * Both consumers hash the same declared fields and consent wording; capture/storage stays Forms-owned. */
/** Copies the published schema and exact consent labels; no visitor input or notification recipients.
 * @complexity O(schema bytes) time and space, pure.
 * @overallScore 98 — full HTML preserves otherwise unstructured consent prose at bounded storage cost. */
export function submissionEvidenceSchema(
  { definition }: { definition: Pick<FormDefinitionRecord, 'fields'> & { html?: string | undefined } },
  _optional: Record<string, never> = {},
): Pick<FormSubmissionEvidence, 'fields' | 'consent' | 'html'> {
  const fields = structuredClone(definition.fields);
  const consent = fields.filter(field => field.type === 'checkbox' || field.type === 'toggle').map(field => ({
    fieldId: field.id, wording: field.label, ...(field.helpText === undefined ? {} : { helpText: field.helpText }),
  }));
  return { fields, consent, ...(definition.html === undefined ? {} : { html: definition.html }) };
}

