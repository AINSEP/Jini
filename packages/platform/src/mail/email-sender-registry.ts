import { createProviderRegistry, type ProviderRegistry } from "@jini-ai/core/provider-registry";
import { EmailSenderError, type EmailSender, type EmailSenderContext, type EmailSourceSummary } from "./email-sender.js";

/** Shares the existing keyed-registry admission rules; no plugin contribution category is added. */
export type EmailSenderRegistry = ProviderRegistry<EmailSender>;

/** Creates an isolated registry, throwing on invalid ids or duplicate built-in senders.
 * @complexity O(s) registrations for s senders; keyed lookup remains O(1). */
export function createEmailSenderRegistry(
  required: { readonly senders: readonly EmailSender[] }, _optional: Record<string, never> = {},
): EmailSenderRegistry {
  return createProviderRegistry({ contract: "email_sender" }, {
    seed: required.senders.map(sender => ({ id: sender.id, label: sender.label, provider: sender })),
  });
}

/** Lists configurable events across all registered senders, with each sender enforcing access.
 * Refuses a sender claiming another sender's sources. @complexity One list call per sender. */
export async function listEmailSources(
  required: EmailSenderContext & { readonly registry: EmailSenderRegistry }, _optional: Record<string, never> = {},
): Promise<readonly EmailSourceSummary[]> {
  const sources: EmailSourceSummary[] = [];
  for (const { id, provider } of required.registry.list({})) {
    const listed = await provider.listSources({ workspaceId: required.workspaceId, principalId: required.principalId });
    if (listed.some(source => source.senderId !== id)) throw new EmailSenderError({ code: "ownership" });
    sources.push(...listed);
  }
  return sources;
}
