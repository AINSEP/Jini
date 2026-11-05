import { canonicalArgumentDigest, isNonArrayRecord } from '@jini-ai/core/records';
import type { FieldDescriptor, FormDefinitionRecord } from './types.js';

/** Immutable form-owned context; answers remain in the existing answer map, never in evidence. */
export interface FormSubmissionEvidence {
  readonly version: 1;
  readonly fields: FieldDescriptor[];
  readonly consent: Array<{ fieldId: string; wording: string; helpText?: string }>;
  readonly schemaHash: string;
  readonly capturedAt: string;
  readonly source: 'native' | 'cloudflare';
  /** Complete authored body retains consent prose outside checkbox labels without guessing. */
  readonly html?: string;
}

const MAX_EVIDENCE_BYTES = 1024 * 1024;

/** Copies the published schema and exact consent labels; no visitor input or notification recipients.
 * @complexity O(schema bytes) time and space, pure.
 * @overallScore 98 — full HTML preserves otherwise unstructured consent prose at bounded storage cost. */
export function submissionEvidenceSchema(
  { definition }: { definition: FormDefinitionRecord & { html?: string | undefined } },
  _optional: Record<string, never> = {},
): Pick<FormSubmissionEvidence, 'fields' | 'consent' | 'html'> {
  const fields = structuredClone(definition.fields);
  const consent = fields.filter(field => field.type === 'checkbox' || field.type === 'toggle').map(field => ({
    fieldId: field.id, wording: field.label, ...(field.helpText === undefined ? {} : { helpText: field.helpText }),
  }));
  return { fields, consent, ...(definition.html === undefined ? {} : { html: definition.html }) };
}

/** Captures original descriptors/consent once; the digest excludes capture time and provenance.
 * @throws TypeError if serialized evidence exceeds 1 MiB; evidence is never silently truncated.
 * @complexity O(schema bytes + key sorting) time and O(schema bytes) space; one local digest.
 * @overallScore 98 — relies on the existing canonical JSON/WebCrypto owner. */
export async function captureSubmissionEvidence(
  { definition, capturedAt, source }: { definition: FormDefinitionRecord & { html?: string | undefined }; capturedAt: string; source: FormSubmissionEvidence['source'] },
  _optional: Record<string, never> = {},
): Promise<FormSubmissionEvidence> {
  const schema = submissionEvidenceSchema({ definition });
  const evidence: FormSubmissionEvidence = { version: 1, ...schema, schemaHash: await canonicalArgumentDigest({ args: schema }), capturedAt, source };
  assertEvidenceSize({ value: evidence });
  return evidence;
}

function assertEvidenceSize({ value }: { value: unknown }): void {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_EVIDENCE_BYTES) throw new TypeError('Form submission evidence exceeds 1 MiB.');
}

function isField(value: unknown): value is FieldDescriptor {
  if (!isNonArrayRecord({ value })) return false;
  const field = value as Record<string, unknown>;
  return typeof field.id === 'string' && typeof field.label === 'string' && typeof field.type === 'string'
    && typeof field.required === 'boolean' && (field.options === undefined || Array.isArray(field.options) && field.options.every(isOption));
}
function isOption(value: unknown): boolean {
  return isNonArrayRecord({ value }) && typeof (value as Record<string, unknown>).value === 'string' && typeof (value as Record<string, unknown>).label === 'string';
}
function isConsent(value: unknown): boolean {
  if (!isNonArrayRecord({ value })) return false;
  const consent = value as Record<string, unknown>;
  return typeof consent.fieldId === 'string' && typeof consent.wording === 'string'
    && (consent.helpText === undefined || typeof consent.helpText === 'string');
}

/** Validates persisted/trusted-destination evidence without reconstructing unknown history.
 * Missing evidence remains missing; malformed evidence refuses the import rather than acknowledging it.
 * @throws TypeError for malformed/oversized evidence, without embedding visitor content.
 * @complexity O(evidence bytes) time and space, pure.
 * @overallScore 97 — validates presentation data; the authenticated receiver establishes provenance. */
export function readSubmissionEvidence({ value }: { value: unknown }, _optional: Record<string, never> = {}): FormSubmissionEvidence | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isNonArrayRecord({ value })) throw new TypeError('Invalid form submission evidence.');
  const evidence = value as Record<string, unknown>;
  assertEvidenceHeader({ evidence });
  if (!Array.isArray(evidence.fields) || !evidence.fields.every(isField)) throw new TypeError('Invalid form submission evidence fields.');
  if (!Array.isArray(evidence.consent) || !evidence.consent.every(isConsent)) throw new TypeError('Invalid form submission evidence consent.');
  assertEvidenceSize({ value });
  return structuredClone(value) as unknown as FormSubmissionEvidence;
}

function assertEvidenceHeader({ evidence }: { evidence: Record<string, unknown> }): void {
  if (evidence.version !== 1 || typeof evidence.schemaHash !== 'string' || !/^[a-f0-9]{64}$/.test(evidence.schemaHash)
    || typeof evidence.capturedAt !== 'string' || !['native', 'cloudflare'].includes(String(evidence.source))
    || evidence.html !== undefined && typeof evidence.html !== 'string') throw new TypeError('Invalid form submission evidence header.');
}

/** Uses captured descriptors for delayed formatting; legacy callers keep their existing definition.
 * @complexity O(1) time/space, no mutation or I/O.
 * @overallScore 99 — old rows remain explicitly evidence-unavailable at display boundaries. */
export function submissionEvidenceDefinition(
  { definition, evidence }: { definition: FormDefinitionRecord; evidence?: FormSubmissionEvidence | undefined },
  _optional: Record<string, never> = {},
): FormDefinitionRecord {
  return evidence ? { ...definition, fields: evidence.fields } : definition;
}
