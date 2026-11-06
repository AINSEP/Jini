import { canonicalArgumentDigest } from '@jini-ai/core/records';
import { FormSchemaChangedError } from './errors.js';
import { FORM_SCHEMA_HASH_FIELD, matchesFormSchemaHash, resolvePortableFormField } from './portable-validation.js';
import { submissionEvidenceSchema } from './submission-evidence.js';
import type { FieldDescriptor, FormDefinitionRecord } from './types.js';

export type FormRetryAnswer = string | boolean | number | string[];
export interface FormRetryDraft { answers: Record<string, FormRetryAnswer>; truncated: boolean; truncatedFields: string[] }
const RESERVED: ReadonlySet<string> = new Set([FORM_SCHEMA_HASH_FIELD, '_hp', '_attempt']);
// Leave room for names repeated in the copy-only list; the entire draft stays below 64 KiB.
const MAX_DRAFT_BYTES = 30 * 1024;
const utf8Bytes = (value: string): number => new TextEncoder().encode(value).byteLength;

/** Keep only bounded non-file answers in this response; unknown control names remain copyable.
 * @complexity O(request bytes) time, O(64 KiB) retained space; no persistence or I/O. */
export function boundedFormRetryDraft({ body }: { body: Record<string, unknown> }, _optional = {}): FormRetryDraft {
  const answers: Record<string, FormRetryAnswer> = Object.create(null);
  let remaining = MAX_DRAFT_BYTES;
  const entries = Object.entries(body).filter(([key]) => !RESERVED.has(key));
  let truncated = entries.length > 100;
  const truncatedFields: string[] = [];
  for (const [name, value] of entries.slice(0, 100)) {
    const entry = prepareRetryAnswer({ name, value });
    if (!entry) continue;
    if (entry.cost <= remaining) {
      answers[entry.key] = entry.value;
      remaining -= entry.cost;
      if (entry.truncated) { truncated = true; truncatedFields.push(entry.key); }
    } else { truncated = true; }
  }
  return { answers, truncated, truncatedFields };
}
function prepareRetryAnswer({ name, value }: { name: string; value: unknown }): { key: string; value: FormRetryAnswer; cost: number; truncated: boolean } | undefined {
  if (!isDraftAnswer(value)) return undefined;
  const encoded = JSON.stringify(value);
  const fits = encoded.length <= 5000;
  const kept = fits ? value : shortenedDraftValue({ value, encoded });
  const key = name.slice(0, 200);
  return { key, value: kept, cost: utf8Bytes(JSON.stringify([key, kept])), truncated: !fits || name.length > 200 };
}
function shortenedDraftValue({ value, encoded }: { value: FormRetryAnswer; encoded: string }): string {
  return (typeof value === 'string' ? value : encoded).slice(0, 5000);
}
function isDraftAnswer(value: unknown): value is FormRetryAnswer {
  if (typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

/** Compare the already loaded authored schema before field checks, uploads, rate or acceptance.
 * Missing metadata preserves published legacy pages; duplicate/malformed hashes require review.
 * @throws FormSchemaChangedError with bounded text and current controls, never file bytes.
 * @complexity O(schema bytes + canonical key sorting + request bytes) time; bounded draft space, one local digest, no I/O. */
export async function assertCurrentFormSchema(
  { original, definition, body }: { original: FormDefinitionRecord & { html?: string }; definition: FormDefinitionRecord; body: Record<string, unknown> },
  _optional = {},
): Promise<void> {
  if (!Object.hasOwn(body, FORM_SCHEMA_HASH_FIELD)) return;
  const schemaHash = await canonicalArgumentDigest({ args: submissionEvidenceSchema({ definition: original }) });
  if (matchesFormSchemaHash({ present: true, submittedHash: body[FORM_SCHEMA_HASH_FIELD], schemaHash })) return;
  throw new FormSchemaChangedError({ fields: definition.fields, schemaHash, draft: boundedFormRetryDraft({ body }), ...(original.html === undefined ? {} : { html: original.html }) });
}

/** Repopulate only currently valid controls. Consent and files always require new action.
 * All authored defaults are cleared so old consent/default selections cannot reappear.
 * @complexity O(fields + answer bytes + choices) time/space, pure and bounded by the draft. */
export function formRetryFields(
  { fields, answers }: { fields: readonly FieldDescriptor[]; answers: Readonly<Record<string, FormRetryAnswer>> },
  { truncatedFields = [] }: { truncatedFields?: readonly string[] } = {},
): { fields: FieldDescriptor[]; retained: Record<string, FormRetryAnswer> } {
  const retained = { ...answers };
  const copyOnly = new Set(truncatedFields);
  const current = fields.map(field => {
    const empty = { ...field };
    delete empty.default;
    if (copyOnly.has(field.id) || ['file', 'checkbox', 'toggle'].includes(field.type)) return empty;
    const value = answers[field.id];
    const resolved = resolvePortableFormField({ field, value });
    if (resolved.kind !== 'accepted' || !isDraftAnswer(resolved.value)) return empty;
    delete retained[field.id];
    return { ...empty, default: resolved.value };
  });
  return { fields: current, retained };
}
