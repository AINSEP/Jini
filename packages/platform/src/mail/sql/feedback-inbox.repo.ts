/** @file SQL adapter for Jini's `MailFeedbackInboxPort` (migrations 0023, 0025), one body for SQLite and Postgres. */
import { sql } from "kysely";
import type { MailFeedbackInboxPort } from "../feedback.js";
import type { MailRepoDeps, MailRepoOptions } from "./ledger.repo.js";

/**
 * Provider feedback events, insert-if-absent on (provider, event id): a provider's replay of an
 * event it already delivered is reported `duplicate`, so suppression is written once.
 * Only a row whose `processed_at` is set (by `complete`, after suppression succeeded) counts as
 * delivered: a replay of an unprocessed row is reported `inserted` so the ingest re-applies it.
 * @complexity O(1) per event.
 * @example createMailFeedbackInboxRepo({ db: kernel }).record({ providerId: "<mail-provider-id>", event })
 */
export function createMailFeedbackInboxRepo<DB>({ db }: MailRepoDeps<DB>, optional: MailRepoOptions = {}): MailFeedbackInboxPort {
  const nowIso = optional.nowIso ?? (() => new Date().toISOString());
  return {
    async record({ providerId, event }) {
      const inserted = await db.query(sql`INSERT INTO mail_feedback_inbox
        (provider_id, event_id, workspace_id, recipient, kind, hard_bounce, provider_message_id, occurred_at, received_at)
        VALUES (${providerId}, ${event.eventId}, ${event.workspaceId}, ${event.recipient}, ${event.kind}, ${event.hardBounce ? 1 : 0},
          ${event.providerMessageId}, ${event.occurredAt}, ${nowIso()})
        ON CONFLICT (provider_id, event_id) DO NOTHING RETURNING event_id`);
      if (inserted.length > 0) return "inserted";
      const [row] = await db.query<{ processed_at: string | null }>(sql`SELECT processed_at FROM mail_feedback_inbox
        WHERE provider_id = ${providerId} AND event_id = ${event.eventId}`);
      // The INSERT conflicted, so the row exists; a workspace delete cascading in between is not retried.
      return (row as { processed_at: string | null }).processed_at === null ? "inserted" : "duplicate";
    },
    async complete({ providerId, eventId }) {
      await db.execute(sql`UPDATE mail_feedback_inbox SET processed_at = ${nowIso()} WHERE provider_id = ${providerId} AND event_id = ${eventId}`);
    },
  };
}
