/** @file SQL adapter for Jini's `MailSuppressionRepoPort` (migration 0023), one body for SQLite and Postgres. */
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import type { MailDeliveryLane, MailSuppressionRepoPort, MailSuppressionScope } from "../ports.js";
import type { MailRepoDeps, MailRepoOptions } from "./ledger.repo.js";

/** `transactional` is blocked only by `all` (a complainer still gets sign-in links); `bulk` by both. */
const BLOCKING_SCOPES: Readonly<Record<MailDeliveryLane, readonly MailSuppressionScope[]>> = {
  transactional: ["all"],
  bulk: ["all", "bulk"],
};

/** Addresses are keyed case-insensitively; callers normalize too, this keeps the key honest. */
const normalize = ({ address }: { address: string }, _optional = {}): string => address.trim().toLowerCase();

/**
 * The do-not-send list. Keyed by address and scope, never provider, so it survives a provider
 * switch. A repeat suppression keeps the first row (its reason and time).
 * @complexity O(1) primary-key lookups/inserts.
 * @example createMailSuppressionRepo({ db: kernel }).isSuppressed({ workspaceId, normalizedAddress, lane: "bulk" })
 */
export function createMailSuppressionRepo<DB>({ db }: MailRepoDeps<DB>, optional: MailRepoOptions = {}): MailSuppressionRepoPort {
  const nowIso = optional.nowIso ?? (() => new Date().toISOString());
  return {
    async isSuppressed({ workspaceId, normalizedAddress, lane }) {
      const scopes = sql.join(BLOCKING_SCOPES[lane].map((scope) => sql`${scope}`));
      const rows = await db.query(sql`SELECT 1 AS hit FROM mail_suppression
        WHERE workspace_id = ${workspaceId} AND normalized_address = ${normalize({ address: normalizedAddress })} AND scope IN (${scopes}) LIMIT 1`);
      return rows.length > 0;
    },
    async suppress({ workspaceId, normalizedAddress, scope, reason }) {
      await db.execute(sql`INSERT INTO mail_suppression (workspace_id, normalized_address, scope, reason, created_at, revision)
        VALUES (${workspaceId}, ${normalize({ address: normalizedAddress })}, ${scope}, ${reason}, ${nowIso()}, ${randomUUID()})
        ON CONFLICT (workspace_id, normalized_address, scope) DO NOTHING`);
    },
  };
}
