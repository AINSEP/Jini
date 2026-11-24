/** Body-free observation of every policy result, including preflight refusals and captures. */
import { safeMailProviderText } from "../provider-error.js";
import { laneForPurpose } from "../policy.js";
import { mailActivityUse } from "./activity.repo.js";
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import type { MailRepoDeps, MailRepoOptions } from "./ledger.repo.js";
import type { MailTestModeSetting } from "@jini-ai/core/contracts/mail";
import type { MailerSendOptions, MailerSendResult, OutboundEmail } from "../ports.js";

/** The delivery policy's per-result observer. Declared here (not in server/) so features never import server code. */
export type MailAttemptObserver = (required: { message: OutboundEmail; options: MailerSendOptions; providerId: string; mode: MailTestModeSetting; result: MailerSendResult }) => Promise<void>;

/** Upsert one request's latest result without changing its original position in activity history.
 * @complexity One indexed write; no subject, body or authentication link is stored; only a scrubbed failure diagnostic. */
export function createMailAttemptObserver<DB>({ db }: MailRepoDeps<DB>, options: MailRepoOptions & { newId?: () => string } = {}): MailAttemptObserver {
  const nowIso = options.nowIso ?? (() => new Date().toISOString());
  const newId = options.newId ?? randomUUID;
  return async ({ message, options: send, providerId, mode, result }) => {
    const at = nowIso();
    const recipient = message.to.email.trim().toLowerCase();
    const effective = mode.mode === "redirect" ? mode.to.trim().toLowerCase() : recipient;
    let outcome: string;
    if (result.ok) {
      outcome = result.providerMessageId.startsWith("captured:") || providerId === "console" ? "captured" : "sent";
    } else {
      outcome = result.unknown ? "unknown" : "failed";
    }
    await db.execute(sql`INSERT INTO mail_activity_attempts
      (id, workspace_id, idempotency_key, recipient, effective_recipient, delivery_mode, use_id, lane, provider_id, outcome, provider_message_id, error_code, message, created_at, updated_at)
      VALUES (${newId()}, ${send.workspaceId}, ${send.idempotencyKey}, ${recipient}, ${effective}, ${mode.mode}, ${mailActivityUse({ idempotencyKey: send.idempotencyKey })}, ${laneForPurpose({ purpose: send.purpose })}, ${providerId}, ${outcome}, ${result.ok ? result.providerMessageId : null}, ${result.ok ? null : safeMailProviderText({ text: result.errorCode })}, ${result.ok ? null : safeMailProviderText({ text: result.message })}, ${at}, ${at})
      ON CONFLICT (workspace_id, idempotency_key, recipient) DO UPDATE SET
        effective_recipient = excluded.effective_recipient, delivery_mode = excluded.delivery_mode, use_id = excluded.use_id,
        provider_id = excluded.provider_id, outcome = excluded.outcome, provider_message_id = excluded.provider_message_id,
        error_code = excluded.error_code, message = excluded.message, updated_at = excluded.updated_at`);
  };
}
