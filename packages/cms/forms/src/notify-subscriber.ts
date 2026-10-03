import type { Logger } from "@jini-ai/core/primitives";
/** Notification subscriber with host sender, mail and logging ports. Each recipient receives a stable per-submission dedup key; delivery and repository failures never block sibling subscribers. */
import type { DomainEvent, EventBusPort } from "@jini-ai/cms/core";
import type { MailerPort,  EmailAddress } from "./ports.js";
import type { FormDefinitionRepoPort, FormSubmissionRepoPort } from "./ports.js";

// Domain behavior owns its event contract; reading a host manifest back would invert dependency flow.
const FORM_SUBMISSION_RECEIVED_TOPIC = "form.submission.received";

interface FormSubmissionReceivedPayload {
  workspaceId: string;
  formDefinitionId: string;
  submissionId: string;
}

export interface RegisterFormNotifySubscriberDeps {
  bus: EventBusPort;
  sender: EmailAddress;
  logger: Pick<Logger, 'warn'>;
  mailer: MailerPort;
  formDefinitionRepo: FormDefinitionRepoPort;
  formSubmissionRepo: FormSubmissionRepoPort;
}

export async function registerFormNotifySubscriber(
  deps: RegisterFormNotifySubscriberDeps
): Promise<() => Promise<void>> {
  return deps.bus.subscribe<FormSubmissionReceivedPayload>(
    { eventName: FORM_SUBMISSION_RECEIVED_TOPIC,
    handler: async (event: DomainEvent<FormSubmissionReceivedPayload>) => {
      try {
        const { workspaceId, formDefinitionId, submissionId } = event.payload;

        const definition = await deps.formDefinitionRepo.findById({ workspaceId, id: formDefinitionId });
        if (!definition || !definition.notify.enabled || definition.notify.recipients.length === 0) {
          return;
        }

        const submission = await deps.formSubmissionRepo.findById({ workspaceId, id: submissionId });
        if (!submission) return;

        for (const recipient of definition.notify.recipients) {
          try {
            const result = await deps.mailer.send({
              message: {
                workspaceId,
                to: { email: recipient },
                from: deps.sender,
                subject: `New submission: ${definition.name}`,
                text: JSON.stringify(submission.data),
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
            if (!result.ok) {
              warn(deps.logger,
                `[forms:notify] mail send failed for submission '${submissionId}' recipient '${recipient}': ${result.errorCode} (${result.message})`
              );
            }
          } catch (err) {
            // A send failure is terminal for this delivery: log, never retry inline or alter
            // the persisted submission, and continue so the other recipients can still receive it.
            warn(deps.logger,
              `[forms:notify] mail send threw for submission '${submissionId}' recipient '${recipient}':`,
              err
            );
          }
        }
      } catch (err) {
        // Repository failures must not escape the bus's subscriber loop and break sibling handlers.
        warn(deps.logger, "[forms:notify] subscriber failed:", err);
      }
    } }
  );
}

/** Failure reporting is isolated too: a logger cannot interrupt sibling event subscribers. */
function warn(logger: Pick<Logger, 'warn'>, message: string, error?: unknown): void {
  try { logger.warn({ message }, error === undefined ? {} : { error }); } catch { /* Host logging failure is terminal. */ }
}
