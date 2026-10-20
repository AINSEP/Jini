/**
 * @file `submit-service.ts` — the sole public submission write path (SPEC-010 REQ-05..09/16,
 * ADR-PIPE-010 C-008).
 *
 * Purpose:
 * `submitForm` deliberately bypasses `executeCommand` (no actor/permission fits an anonymous
 * visitor — ADR-PIPE-010 Pattern Evaluation); mirrors `routes/site/analytics-ingest.ts`'s
 * `ingestHit` shape. Order: resolve slug -> honeypot check -> validate -> rate-limit -> persist ->
 * enqueue `form.submission.received` -> return, WITHOUT awaiting outbox drainage.
 *
 * CRITICAL (INV-05/REQ-16/AC-24, tasks.md T023): the package kicks off the bound dispatcher without
 * awaiting it. An inline route drain may await delivery when its subscribers are cheap; that is
 * directly unacceptable here, where a subscriber calls `MailerPort.send()`. Copying that pattern
 * verbatim would silently reintroduce the exact response-blocking bug REQ-16/INV-05 forbid.
 * Do not await the dispatcher at the submission boundary — see T023/T049 for the standing
 * Code Review gate on this exact line.
 *
 * Double submit (2026-10-05): a double-clicked Send posts the same form twice and the rendered form
 * ships no script, so the dedupe is server-side — see `submission-attempts.ts` for the attempt token,
 * its cached/static fallback and why it lives in process memory. Ids are random; the submission row
 * and its event are written in one transaction, so a failed enqueue leaves nothing a retry could
 * mistake for a finished submission.
 */
import type { Logger } from "@jini-ai/core/primitives";
import { nowIso as kernelNowIso } from "@jini-ai/core/primitives";
/** Anonymous submission path: active lookup, honeypot, validation, rate check, persistence + event enqueue in one host transaction, then background dispatch. */
import { buildFormsRateLimitKey } from "./rate-limit-key.js";
import type { RateLimiterPort, FormOutboxPort, OutboxDispatcherPort, SubmissionTransactionPort } from "./ports.js";
import type { Clock, IdGenerator, UUID } from "@jini-ai/core/primitives";
import {
  FormDefinitionNotFoundError,
  FormRateLimitExceededError,
  FormSubmissionValidationError,
} from "./errors.js";
import { isHoneypotTripped, validateSubmissionPayload } from "./forms.js";
import type { FormDefinitionRepoPort, FormSubmissionRepoPort } from "./ports.js";
import type { FormDefinitionViewPort } from "./ports.js";
import { assertSubmissionEmails } from "./submission-email-validation.js";
import { DUPLICATE_ATTEMPT, FORM_ATTEMPT_FIELD, type SubmissionAttempts } from "./submission-attempts.js";
import { FORM_SUBMISSION_RECEIVED_EVENT, type FormSubmissionRecord, type FormFileStoragePort, type FormFileReference } from "./types.js";

const HONEYPOT_KEY = "_hp";

export interface SubmitFormDeps {
  definitionRepo: FormDefinitionRepoPort;
  submissionRepo: FormSubmissionRepoPort;
  outbox: FormOutboxPort;
  dispatcher: OutboxDispatcherPort;
  logger: Pick<Logger, 'warn'>;
  clock: Clock;
  idGen: IdGenerator;
  rateLimiter: RateLimiterPort;
  /** Anonymous uploads go through the host media owner only after validation/rate/dedupe. */
  files?: FormFileStoragePort;
  /** Omitted: the two writes run back to back with no rollback between them. */
  transaction?: SubmissionTransactionPort;
}

export interface SubmitFormInput {
  workspaceId: UUID;
  slug: string;
  body: Record<string, unknown>;
  sourceIp: string;
}

export interface SubmitFormRequired {
  deps: SubmitFormDeps;
  input: SubmitFormInput;
}

// Anonymous visitors have no actor/permission for an administrative command gateway; this public
// path instead owns validation, throttling and durable submission/event persistence directly.
/**
 * Binds the host's outbox delivery to Jini's anonymous submission service. The package awaits the
 * object-shaped limiter check and queues delivery without awaiting notifications.
 *
 * A repeat of an attempt accepted within the window (same token, or for a request without one the
 * same IP and body) is answered exactly like the original — `accepted` — with no row, no event and
 * no notification. It still passes the slug, honeypot, validation and rate checks first (and so
 * consumes a rate-limit slot, as any request does): the attempt is claimed only where the package
 * opens its persistence transaction, and a copy that must wait for the first copy waits there,
 * outside any database transaction. The `_attempt` field is removed from the body before
 * validation; it is never stored.
 * @returns Accepted for a valid submission, a duplicate, or a honeypot discard; package errors propagate.
 * @complexity O(f + k) package validation plus O(b log b) attempt hashing; fixed-count persistence
 * effects, background dispatch.
 * @example await submitForm({ deps, input: { workspaceId, slug, body, sourceIp } });
 */
export async function submitForm(required: SubmitFormRequired, optional: SubmitFormOptional = {}): Promise<{ status: "accepted" }> {
  const { deps } = required;
  let attemptToken: unknown;
  let input = required.input;
  if (optional.attempts) {
    const { [FORM_ATTEMPT_FIELD]: token, ...body } = input.body;
    attemptToken = token;
    input = { ...input, body };
  }

  // Missing and disabled slugs are deliberately indistinguishable to public callers.
  const stored = await deps.definitionRepo.findBySlug({ workspaceId: input.workspaceId, slug: input.slug });
  const definition = stored && optional.definitionView ? optional.definitionView({ definition: stored, body: input.body }) : stored;
  if (definition && optional.validateEmails) assertSubmissionEmails({ definition, body: input.body });
  if (!definition || definition.status !== "active") {
    throw new FormDefinitionNotFoundError({ message: `form '${input.slug}' was not found` });
  }

  // Discard before validation, rate limiting or writes; a bot sees the same accepted response
  // without consuming capacity or creating a submission/event.
  if (isHoneypotTripped({ hp: input.body[HONEYPOT_KEY] })) {
    return { status: "accepted" };
  }

  const validation = validateSubmissionPayload({ definition, body: input.body }, deps.files ? { files: deps.files } : {});
  if (!validation.valid) {
    throw new FormSubmissionValidationError({ message: "submission failed field validation", fieldErrors: validation.fieldErrors });
  }

  if (validation.files && !deps.transaction) {
    // Without rollback, a failed outbox write would leave a stored row pointing at compensated
    // files. Existing scalar-only hosts retain their legacy optional-transaction contract.
    throw new FormSubmissionValidationError({ message: "file submissions require transactional storage", fieldErrors: Object.keys(validation.files).map((field) => ({ field, reason: "file_storage_unavailable" })) });
  }

  // Scope by both IP and form so one client's different forms cannot cross-throttle each other.
  const rateLimitKey = buildFormsRateLimitKey({ sourceIp: input.sourceIp, formDefinitionId: definition.id });
  const rateLimitResult = await deps.rateLimiter.check({ key: rateLimitKey });
  if (!rateLimitResult.allowed) {
    throw new FormRateLimitExceededError({ message: `rate limit exceeded for form '${definition.id}'`, retryAfterSeconds: rateLimitResult.retryAfterSeconds });
  }

  const now = kernelNowIso({ clock: deps.clock });
  const submissionId = deps.idGen.newId();
  const submission: FormSubmissionRecord = {
    id: submissionId,
    workspaceId: input.workspaceId,
    formDefinitionId: definition.id,
    data: validation.data,
    sourceIp: input.sourceIp,
    submittedAt: now,
  };
  const event = {
    id: deps.idGen.newId(),
    name: FORM_SUBMISSION_RECEIVED_EVENT,
    occurredAt: now,
    workspaceId: input.workspaceId,
    aggregateId: submissionId,
    payload: { workspaceId: input.workspaceId, formDefinitionId: definition.id, submissionId },
  };
  // Only a persisted accepted submission gets this event; honeypot discards emit nothing. Row and
  // event commit together: a failed enqueue must not leave a stored submission nobody is told about.
  const transaction: SubmissionTransactionPort = deps.transaction ?? ((work) => work());
  const persist = async () => {
    // Blob backends cannot participate in a SQL transaction. Store within the dedupe claim,
    // then compensate only this attempt's new media assets when any upload/row/event write fails.
    // Byte buffers never reach data_json, notifications or the outbox payload.
    const uploaded: FormFileReference[] = [];
    try {
      for (const [fieldId, file] of Object.entries(validation.files ?? {})) {
        const reference = await deps.files!.store({ workspaceId: input.workspaceId, submissionId, fieldId, file });
        uploaded.push(reference);
        submission.data[fieldId] = reference;
      }
      await transaction(async () => {
        await deps.submissionRepo.create(submission);
        await deps.outbox.enqueue(event);
      });
    } catch (error) {
      for (const reference of uploaded) {
        try { await deps.files!.discard({ workspaceId: input.workspaceId, reference }); }
        catch (cleanupError) {
          // Retain the original submission failure; a failed cleanup is visible to operators.
          try { deps.logger.warn({ message: "form upload cleanup failed" }, { error: cleanupError }); } catch { /* Logging cannot replace the original error. */ }
        }
      }
      throw error;
    }
  };
  if (optional.attempts) {
    // The attempt is claimed only where persistence begins, after validation and rate limiting.
    // A copy waits outside the database transaction; failed first copies free the claim for retry.
    const outcome = await optional.attempts.once({
      key: optional.attempts.key({ input, attemptToken }),
      nowMs: () => deps.clock.nowMs(),
      submit: persist,
    });
    if (outcome === DUPLICATE_ATTEMPT) return { status: "accepted" };
  } else {
    await persist();
  }

  // Dispatch failures cannot affect an accepted submission or create an unhandled rejection.
  // Never await delivery here: a subscriber sends mail, so awaiting it would reintroduce the
  // response-blocking bug. Persistence/enqueue are awaited; outbox drainage remains background work.
  void Promise.resolve().then(() => (optional.dispatch ?? deps.dispatcher.dispatch.bind(deps.dispatcher))({})).catch((error: unknown) => {
    try { deps.logger.warn({ message: "form outbox dispatch failed" }, { error }); } catch { /* Logging must not reject background work. */ }
  });

  return { status: "accepted" };
}

/** All extensions are opt-in: omitted options preserve the original package submission behavior. */
export interface SubmitFormOptional {
  definitionView?: FormDefinitionViewPort;
  validateEmails?: boolean;
  dispatch?: OutboxDispatcherPort["dispatch"];
  attempts?: SubmissionAttempts;
}
