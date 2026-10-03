import type { Logger } from "@jini-ai/core/primitives";
import { nowIso as kernelNowIso } from "@jini-ai/core/primitives";
/** Anonymous submission path: active lookup, honeypot, validation, rate check, persistence, event enqueue, then background dispatch. Persistence and enqueue remain separate awaited effects, matching the source contract. */
import { buildFormsRateLimitKey } from "./rate-limit-key.js";
import type { RateLimiterPort, FormOutboxPort, OutboxDispatcherPort } from "./ports.js";
import type { Clock, IdGenerator, UUID } from "@jini-ai/core/primitives";
import {
  FormDefinitionNotFoundError,
  FormRateLimitExceededError,
  FormSubmissionValidationError,
} from "./errors.js";
import { isHoneypotTripped, validateSubmissionPayload } from "./forms.js";
import type { FormDefinitionRepoPort, FormSubmissionRepoPort } from "./ports.js";
import type { FormSubmissionRecord } from "./types.js";

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
export async function submitForm(required: SubmitFormRequired): Promise<{ status: "accepted" }> {
  const { deps, input } = required;

  // Missing and disabled slugs are deliberately indistinguishable to public callers.
  const definition = await deps.definitionRepo.findBySlug({ workspaceId: input.workspaceId, slug: input.slug });
  if (!definition || definition.status !== "active") {
    throw new FormDefinitionNotFoundError({ message: `form '${input.slug}' was not found` });
  }

  // Discard before validation, rate limiting or writes; a bot sees the same accepted response
  // without consuming capacity or creating a submission/event.
  if (isHoneypotTripped({ hp: input.body[HONEYPOT_KEY] })) {
    return { status: "accepted" };
  }

  const validation = validateSubmissionPayload({ definition, body: input.body });
  if (!validation.valid) {
    throw new FormSubmissionValidationError({ message: "submission failed field validation", fieldErrors: validation.fieldErrors });
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
  await deps.submissionRepo.create(submission);

  // Only a persisted accepted submission gets this event; honeypot discards emit nothing.
  await deps.outbox.enqueue({
    id: deps.idGen.newId(),
    name: "form.submission.received",
    occurredAt: now,
    workspaceId: input.workspaceId,
    aggregateId: submissionId,
    payload: { workspaceId: input.workspaceId, formDefinitionId: definition.id, submissionId },
  });

  // Dispatch failures cannot affect an accepted submission or create an unhandled rejection.
  // Never await delivery here: a subscriber sends mail, so awaiting it would reintroduce the
  // response-blocking bug. Persistence/enqueue are awaited; outbox drainage remains background work.
  void Promise.resolve().then(() => deps.dispatcher.dispatch({})).catch((error: unknown) => {
    try { deps.logger.warn({ message: "form outbox dispatch failed" }, { error }); } catch { /* Logging must not reject background work. */ }
  });

  return { status: "accepted" };
}
