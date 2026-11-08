import type { MailAdapterCredential, MailAdapterKit, MailAdapterCreateContext, MailAdapterModule } from '@jini-ai/core/contracts/mail';
export type { MailAdapterCredential, MailAdapterKit, MailAdapterCreateContext, MailAdapterModule } from '@jini-ai/core/contracts/mail';
import type { HttpClientPort } from "@jini-ai/core/primitives";
import type { MailerPort } from "./ports.js";

/**
 * Normalize a host's module context without inspecting settings or replacing its guarded ports.
 * The optional fields on {@link MailAdapterCreateContext} preserve legacy direct create calls;
 * hosts use this boundary to supply both defaults before invoking a provider module.
 * @param required Sending credential and guarded adapter kit, passed through unchanged.
 * @param optional Clock and opaque per-install settings. Only undefined selects a default.
 * @returns A context with a live clock and settings (a fresh empty object when omitted).
 * @complexity O(1) time and space; does not sample the clock or perform I/O.
 * @example provider.create(createMailAdapterContext({ credential, kit }, { now, settings }));
 */
export function createMailAdapterContext(
  required: { credential: MailAdapterCredential; kit: MailAdapterKit },
  { now = () => new Date(), settings = {} }: Pick<MailAdapterCreateContext, "now" | "settings"> = {},
): Required<MailAdapterCreateContext> {
  return { credential: required.credential, kit: required.kit, now, settings };
}
