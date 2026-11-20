import type { Clock, IdGenerator } from "@jini-ai/core/primitives";
import { readSubmissionEvidence, submissionEvidenceDefinition } from "../submission-evidence.js";
import { retainedSubmissionIp } from "../submission-ip-retention.js";
import { validateSubmissionPayload, type FieldError } from "../forms.js";
import type { FormDefinitionRecord } from "../types.js";
import type { FormDefinitionRepoPort, FormOutboxPort, FormSubmissionRepoPort } from "../ports.js";
import { type FormAnswer } from "@jini-ai/core/contracts/forms";
import { htmlSubmissionDefinition } from "./html-submission-adapter.js";
import { FORM_LONG_TEXT_MAX_CHARS, capSubmissionFieldLengths, fieldMaxChars } from "../field-length-caps.js";

/**
 * @file Imports submissions a form destination stored where the host's server does not run (a static
 * export), into the same submissions store the live endpoint writes. Generic: no host is named here.
 * Each row is validated with the live endpoint's own validator. The store has no status column, so
 * an invalid row is still imported (its declared fields only, cut to the live text caps) and listed in
 * the result with its field errors rather than dropped. Classification also persists in the existing
 * data_json envelope, outside the answer map; it emits no `form.submission.received`, since
 * it was never an accepted submission (owner decision 2026-10-27, T9). A receipt keyed by (workspace, destination, remote id) makes the
 * import idempotent, and it outlives Trash and purge, so a retried pull never resurrects a deleted row.
 */

/** One stored remote submission, before validation. Structurally the deploy target's row shape. */
export interface RemoteSubmissionInput {
  readonly id: string;
  readonly evidence?: unknown;
  readonly formSlug: string;
  readonly answers: Readonly<Record<string, unknown>>;
  readonly submittedAt: string;
  readonly ip: string | null;
}

/** The dedupe receipt store. `claim` is atomic: false means this remote row was already imported. */
export interface FormSubmissionReceiptPort {
  claim(required: { workspaceId: string; destinationKey: string; remoteId: string; submissionId: string; importedAt: string }, optional?: Record<string, never>): Promise<boolean>;
}

export interface ImportRemoteSubmissionsDeps {
  readonly definitionRepo: Pick<FormDefinitionRepoPort, "findBySlug">;
  /** `transaction` must be the store's own: the receipt, the row and its event commit together. */
  readonly submissionRepo: Pick<FormSubmissionRepoPort, "create" | "transaction">;
  readonly receipts: FormSubmissionReceiptPort;
  readonly outbox: FormOutboxPort;
  readonly clock: Clock;
  readonly idGen: IdGenerator;
  /** Trusted destination adapter's consent evidence; never infer analytics consent from answers. */
  readonly readAnalyticsProvenance?: (required: { item: RemoteSubmissionInput }) => object | undefined;
}

export interface RemoteImportResult {
  /** Remote ids now durably in the host (new or already imported): safe to acknowledge at the host. */
  readonly committedIds: string[];
  readonly imported: number;
  readonly duplicates: number;
  /** Imported, but the live validator rejected them; review these in the admin. */
  readonly invalid: { remoteId: string; formSlug: string; submissionId: string; fieldErrors: FieldError[] }[];
  /** Not imported and not acknowledged (the form no longer exists); they stay at the host. */
  readonly skipped: { remoteId: string; formSlug: string; reason: "unknown_form" }[];
  /** The same rows counted per form slug, in first-seen order. */
  readonly forms: FormImportCounts[];
}

/** One form's rows in an import: new, already imported earlier, and rows naming a form that does not exist here. */
export interface FormImportCounts {
  readonly formSlug: string;
  imported: number;
  alreadyImported: number;
  unmapped: number;
}

type MutableImportResult = { -readonly [K in keyof RemoteImportResult]: RemoteImportResult[K] };

/** Count only committed rows; validation errors belong to new submissions, never duplicate receipts. */
function recordImportOutcome(
  { result, formCounts, item, outcome }: {
    result: MutableImportResult;
    formCounts: FormImportCounts;
    item: RemoteSubmissionInput;
    outcome: Awaited<ReturnType<typeof importOne>>;
  },
  _optional: Record<string, never> = {},
): void {
  result.committedIds.push(item.id);
  if (outcome.kind === "duplicate") {
    result.duplicates += 1;
    formCounts.alreadyImported += 1;
    return;
  }
  result.imported += 1;
  formCounts.imported += 1;
  if (outcome.fieldErrors) result.invalid.push({ remoteId: item.id, formSlug: item.formSlug, submissionId: outcome.submissionId, fieldErrors: outcome.fieldErrors });
}

/**
 * Imports one page of remote rows. A failure on one row propagates: rows committed earlier in the
 * page stay committed but are not acknowledged, so the next pull fetches them again and their
 * receipts count them as duplicates.
 * @complexity O(rows * fields), with one definition read and one transaction per row.
 */
export async function importRemoteFormSubmissions(
  required: { deps: ImportRemoteSubmissionsDeps; workspaceId: string; destinationKey: string; items: readonly RemoteSubmissionInput[] },
  _optional: Record<string, never> = {},
): Promise<RemoteImportResult> {
  const { deps, workspaceId, destinationKey, items } = required;
  const result: MutableImportResult = { committedIds: [], imported: 0, duplicates: 0, invalid: [], skipped: [], forms: [] };
  const definitions = new Map<string, FormDefinitionRecord | null>();
  // A Map, not an object: form slugs come from the receiver and may be any string.
  const counts = new Map<string, FormImportCounts>();
  for (const item of items) {
    if (!definitions.has(item.formSlug)) definitions.set(item.formSlug, await deps.definitionRepo.findBySlug({ workspaceId, slug: item.formSlug }));
    const definition = definitions.get(item.formSlug);
    const formCounts = countsFor({ counts, formSlug: item.formSlug });
    if (!definition) { result.skipped.push({ remoteId: item.id, formSlug: item.formSlug, reason: "unknown_form" }); formCounts.unmapped += 1; continue; }
    const outcome = await importOne({ deps, workspaceId, destinationKey, item, definition });
    recordImportOutcome({ result, formCounts, item, outcome });
  }
  result.forms = [...counts.values()];
  return result;
}

/** The slug's running counts, created at zero on first sight. @complexity O(1). */
function countsFor({ counts, formSlug }: { counts: Map<string, FormImportCounts>; formSlug: string }, _optional = {}): FormImportCounts {
  const existing = counts.get(formSlug);
  if (existing) return existing;
  const created = { formSlug, imported: 0, alreadyImported: 0, unmapped: 0 };
  counts.set(formSlug, created);
  return created;
}

/** Validate, then claim the receipt, write the row and, for a valid row, enqueue `form.submission.received`
 * in one transaction, the same event shape the live submit path emits, so notifications fire once.
 * @complexity O(fields). */
async function importOne(
  required: { deps: ImportRemoteSubmissionsDeps; workspaceId: string; destinationKey: string; item: RemoteSubmissionInput; definition: FormDefinitionRecord },
  _optional: Record<string, never> = {},
): Promise<{ kind: "duplicate" } | { kind: "imported"; submissionId: string; fieldErrors?: FieldError[] }> {
  const { deps, workspaceId, destinationKey, item } = required;
  // The live submit path's view (`forms/index.ts` definitionView): HTML-mode names plus the text caps.
  const evidence = readSubmissionEvidence({ value: item.evidence });
  const originalDefinition = submissionEvidenceDefinition({ definition: required.definition, evidence });
  const htmlView = htmlSubmissionDefinition({ definition: originalDefinition, body: { ...item.answers } });
  const definition = capSubmissionFieldLengths({ definition: htmlView, body: { ...item.answers } });
  const validation = validateSubmissionPayload({ definition, body: { ...item.answers } });
  const data = validation.valid ? validation.data : declaredAnswers({ definition: htmlView, answers: item.answers });
  const analyticsProvenance = deps.readAnalyticsProvenance?.({ item });
  const now = new Date(deps.clock.nowMs()).toISOString();
  const submissionId = deps.idGen.newId();
  const write = async (): Promise<boolean> => {
    if (!await deps.receipts.claim({ workspaceId, destinationKey, remoteId: item.id, submissionId, importedAt: now })) return false;
    await deps.submissionRepo.create({ id: submissionId, workspaceId, formDefinitionId: definition.id, data, ...(evidence ? { evidence } : {}), sourceIp: retainedSubmissionIp({ sourceIp: item.ip, submittedAt: submittedAt({ value: item.submittedAt, now }), now: deps.clock.nowMs() }), submittedAt: submittedAt({ value: item.submittedAt, now }), ...(validation.valid ? {} : { validation: { status: "invalid" as const, fieldErrors: validation.fieldErrors } }) });
    // An invalid row is kept for review only: notifications and webhooks fire for accepted submissions.
    if (validation.valid) await deps.outbox.enqueue({ id: deps.idGen.newId(), name: "form.submission.received", occurredAt: now, workspaceId, aggregateId: submissionId,
      payload: { workspaceId, formDefinitionId: definition.id, submissionId, deliveryMode: "remote_import", ...(analyticsProvenance ? { analyticsProvenance } : {}) } });
    return true;
  };
  // Called as a method, never detached: the SQL store's `transaction` reads `this.kernel`.
  const claimed = deps.submissionRepo.transaction ? await deps.submissionRepo.transaction(write) : await write();
  if (!claimed) return { kind: "duplicate" };
  return { kind: "imported", submissionId, ...(validation.valid ? {} : { fieldErrors: validation.fieldErrors }) };
}

/** An invalid row keeps only declared fields with text values, so stored answers never gain keys
 * the form does not define, and each value is cut to the field's live text cap (a choice field, which
 * live submits hold to its options, to the long-text cap) so an invalid row is never stored uncapped.
 * @complexity O(total answer length). */
function declaredAnswers({ definition, answers }: { definition: FormDefinitionRecord; answers: Readonly<Record<string, unknown>> }, _optional = {}): Record<string, FormAnswer> {
  const data: Record<string, FormAnswer> = {};
  for (const field of definition.fields) {
    const value = answers[field.id];
    const kept = cappedTextAnswer({ value, max: fieldMaxChars({ field }) ?? FORM_LONG_TEXT_MAX_CHARS });
    if (kept !== undefined) data[field.id] = kept;
  }
  return data;
}

/** A text or text-list answer cut to `max`; undefined for any other value. @complexity O(answer length). */
function cappedTextAnswer({ value, max }: { value: unknown; max: number }, _optional = {}): FormAnswer | undefined {
  if (typeof value === "string") return capped({ value, max });
  if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) return value.map((entry: string) => capped({ value: entry, max }));
  return undefined;
}

/** The first `max` code points, the unit the live caps count (an emoji counts once). @complexity O(n). */
function capped({ value, max }: { value: string; max: number }, _optional = {}): string {
  // UTF-16 units never undercount code points, so a short value is already within the cap.
  return value.length <= max ? value : [...value].slice(0, max).join("");
}

/** The host's receive time when it is a real timestamp; otherwise the import time. @complexity O(1). */
function submittedAt({ value, now }: { value: string; now: string }, _optional = {}): string {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : now;
}
