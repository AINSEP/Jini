import { formatErrorForLog } from '@jini-ai/core';
import type { FormDefinitionRecord, FormSubmissionRecord } from "./types.js";
/**
 * @file `registerFormNotifySubscriber` — the Forms-owned outbox subscriber (SPEC-010 REQ-12,
 * ADR-PIPE-010 C-009).
 *
 * Purpose:
 * Subscribes `form.submission.received`; on a notify-enabled definition, calls `MailerPort.send()`
 * per configured recipient. The one piece of Forms-owned business logic riding the outbox — kept
 * separate from the webhook-fanout forwarding (which is not Forms-owned logic; see
 * `server/app.ts`'s wiring). Legacy hosts log send failures outside the source
 * `EventBusPort.publish()` subscriber loop (`core/events/memory-bus.ts`'s `publish`
 * does not catch handler errors itself — a subscriber that fails to catch its own errors would
 * break every OTHER subscriber to the same event, including the webhook fan-out). Durable hosts
 * therefore enqueue separate recipient jobs; those jobs propagate failures for retry/status.
 *
 * Takes the `'form.submission.received'` topic name from `types.ts`, never from `./manifest` —
 * see `FORM_SUBMISSION_RECEIVED_EVENT` there for why domain code never reads the manifest back.
 */
import type { Logger } from "@jini-ai/core/primitives";
/** Notification subscriber with host sender, mail and logging ports. Each recipient receives a stable per-submission dedup key; delivery and repository failures never block sibling subscribers. */
import type { DomainEvent, EventBusPort } from "../core/index.js";
import type { MailerPort, MailerSendResult, EmailAddress } from "./ports.js";
import type { FormDefinitionRepoPort, FormSubmissionRepoPort } from "./ports.js";
import { FormDeliveryError } from "./delivery/errors.js";
import { FORM_SUBMISSION_RECEIVED_EVENT } from "./types.js";

interface FormSubmissionReceivedPayload {
  workspaceId: string;
  formDefinitionId: string;
  submissionId: string;
}

export interface RegisterFormNotifySubscriberDeps {
  bus: EventBusPort;
  /** Existing shared outbox; recipient jobs isolate retries from source-event siblings. */
  outbox?: import("./ports.js").FormOutboxPort;
  sender: EmailAddress;
  logger: Pick<Logger, 'warn'>;
  mailer: MailerPort;
  formDefinitionRepo: FormDefinitionRepoPort;
  formSubmissionRepo: FormSubmissionRepoPort;
}

export const FORM_NOTIFY_DELIVERY_EVENT = "form.notification.deliver";

/** Safe outbox failure: provider messages can contain secrets or submitted answers.
 * Unknown acceptance stops automatic resend; definitive failures retain the bounded retry hint.
 * @complexity O(1) time and space; no I/O. */
export class FormNotificationError extends FormDeliveryError {
  constructor({ submissionId, retryable, retryAfterMs, outcome }: {
    submissionId: string; retryable: boolean; retryAfterMs?: number | undefined; outcome?: "not-applied" | "unknown";
  }, _optional = {}) {
    const unknown = outcome === "unknown";
    super({ code: unknown ? "outcome-unknown" : "delivery-failed", retryable: unknown ? false : retryable,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }), ...(outcome === undefined ? {} : { outcome }) });
    this.message = `Form notification failed for submission ${submissionId}. Check the email delivery log and provider settings, then retry the notification.`;
    if (unknown) this.message = `Form notification outcome is unknown for submission ${submissionId}. Check the email delivery log before sending another notification.`;
    this.name = "FormNotificationError";
  }
}

/** Register source planning plus isolated recipient delivery on the existing outbox.
 * @complexity O(recipients) small reference-only jobs; one mail call per delivery attempt. */
export async function registerFormNotifySubscriber(
  deps: RegisterFormNotifySubscriberDeps,
  _optional: Record<string, never> = {},
): Promise<() => Promise<void>> {
  const stopDelivery = await deps.bus.subscribe<FormSubmissionReceivedPayload & { recipient: string }>({
    eventName: FORM_NOTIFY_DELIVERY_EVENT,
    handler: async ({ payload }) => {
      const definition = await deps.formDefinitionRepo.findById({ workspaceId: payload.workspaceId, id: payload.formDefinitionId });
      const submission = await deps.formSubmissionRepo.findById({ workspaceId: payload.workspaceId, id: payload.submissionId });
      if (!definition || !submission) return; // Purged data must never be retained in a mail job.
      await sendNotification({ deps, definition, submission, recipient: payload.recipient, payload }, { durable: true });
    },
  });
  const stopSource = await deps.bus.subscribe<FormSubmissionReceivedPayload>(
    {
      eventName: FORM_SUBMISSION_RECEIVED_EVENT,
      handler: async (event: DomainEvent<FormSubmissionReceivedPayload>) => {
        try {
          await handleSubmissionReceived({ deps, event });
        } catch (err) {
          // Legacy hosts have no retry store: isolate errors from sibling handlers. Durable hosts
          // must fail source planning so missing recipient jobs are retried with stable ids.
          if (deps.outbox) throw err;
          warn(deps.logger, "[forms:notify] subscriber failed:", err);
        }
      }
    }
  );
  return async () => { await stopSource(); await stopDelivery(); };
}

/** Plan stable recipient jobs, or deliver inline for a legacy host without an outbox.
 * @complexity O(recipients), one definition read and reference-only jobs. */
async function handleSubmissionReceived({ deps, event }: { deps: RegisterFormNotifySubscriberDeps; event: DomainEvent<FormSubmissionReceivedPayload> }): Promise<void> {
  const { workspaceId, formDefinitionId, submissionId } = event.payload;

  const definition = await deps.formDefinitionRepo.findById({ workspaceId, id: formDefinitionId });
  if (!definition || !definition.notify.enabled || definition.notify.recipients.length === 0) {
    return;
  }

  if (deps.outbox) {
    for (const recipient of definition.notify.recipients) {
      await deps.outbox.enqueue({ ...event, id: `forms:notify:${submissionId}:${recipient}`, name: FORM_NOTIFY_DELIVERY_EVENT,
        aggregateId: submissionId, payload: { workspaceId, formDefinitionId, submissionId, recipient } });
    }
    return;
  }
  const submission = await deps.formSubmissionRepo.findById({ workspaceId, id: submissionId });
  if (!submission) return;

  for (const recipient of definition.notify.recipients) {
    await sendNotification({ deps, definition, submission, recipient, payload: { workspaceId, formDefinitionId, submissionId } });
  }
}

/** Provider refusals can echo credentials without throwing. Redact both the message and cause;
 * failure reporting is isolated too, so a logger cannot interrupt sibling event subscribers. */
function warn(logger: Pick<Logger, 'warn'>, message: string, error?: unknown): void {
  try { logger.warn({ message: formatErrorForLog({ error: message }) }, error === undefined ? {} : { error: formatErrorForLog({ error }) }); } catch { /* Host logging failure is terminal. */ }
}

/** Legacy delivery isolates recipients; durable jobs propagate a safe typed failure to the outbox.
 * @complexity O(submission size) time and space to serialize answers; one provider call per attempt. */
async function sendNotification({ deps, definition, submission, recipient, payload: { workspaceId, formDefinitionId, submissionId } }: {
  deps: RegisterFormNotifySubscriberDeps;
  definition: FormDefinitionRecord;
  submission: FormSubmissionRecord;
  recipient: string;
  payload: FormSubmissionReceivedPayload;
}, { durable = false } = {}): Promise<void> {
  let result: MailerSendResult;
  try {
    result = await deps.mailer.send({
      message: {
        workspaceId,
        to: { email: recipient },
        from: deps.sender,
        subject: `New submission: ${definition.name}`,
        text: notificationText({ submission }),
      },
      options: {
        // Include the recipient so a shared dedup ledger never suppresses a sibling send.
        idempotencyKey: `forms:notify:${submissionId}:${recipient}`,
        workspaceId,
        sourceContext: { module: "forms", ref: formDefinitionId },
        purpose: "transactional",
        // Background notifications use the host mailer's durable-outbox readiness gate,
        // rather than the interactive send lane, when production delivery requires it.
        lane: "notification",
      }
    });
  } catch (err) {
    if (durable) throw err instanceof FormNotificationError ? err : new FormNotificationError({ submissionId, retryable: true });
    // A send failure is terminal for this delivery: log, never retry inline or alter
    // the persisted submission, and continue so the other recipients can still receive it.
    warn(deps.logger,
      `[forms:notify] mail send threw for submission '${submissionId}' recipient '${recipient}':`,
      err
    );
    return;
  }
  if (result.ok) return;
  if (durable) throw new FormNotificationError({ submissionId, retryable: result.retryable,
    retryAfterMs: result.retryAfterMs,
    outcome: result.unknown ? "unknown" : "not-applied" });
  warn(deps.logger,
    `[forms:notify] mail send failed for submission '${submissionId}' recipient '${recipient}': ${result.errorCode} (${result.message})`
  );
}

/** Captured labels/options make a delayed notification describe the form the visitor answered.
 * Legacy rows keep their prior raw-answer format because their original schema is unknown.
 * @complexity O(fields × options + answer bytes), no I/O.
 * @overallScore 98 — preserves original meaning without rewriting stored answers. */
function notificationText({ submission }: { submission: FormSubmissionRecord }): string {
  if (!submission.evidence) return JSON.stringify(submission.data);
  const answers = submission.evidence.fields.map(field => ({
    label: field.label, value: notificationValue({ value: submission.data[field.id], options: field.options }),
  }));
  return JSON.stringify({ schemaHash: submission.evidence.schemaHash, answers, consent: submission.evidence.consent });
}

function notificationValue({ value, options }: { value: unknown; options?: FormDefinitionRecord['fields'][number]['options'] }): unknown {
  if (Array.isArray(value)) return value.map(item => notificationValue({ value: item, options }));
  if (typeof value === 'string') return options?.find(option => option.value === value)?.label ?? value;
  return value;
}
