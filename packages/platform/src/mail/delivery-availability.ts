import type { MailerPort } from "./ports.js";
/** Reads adapter capabilities without sending a message. */
/** The console driver only logs messages locally, so it must never count as real delivery. */
export function isMailDeliveryAvailable({ mailer }: { mailer: MailerPort }): boolean {
  return mailer.capabilities({}).driver !== "console";
}
