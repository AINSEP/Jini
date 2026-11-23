/**
 * @file The operator side of the do-not-send list and the feedback inbox (email phase 5, migration
 * 0030): list and search suppressions, remove one with an audit record, and read the newest
 * verified feedback event per provider. One SQL body for SQLite and Postgres.
 *
 * The send-time side stays `suppression.repo.ts` (Jini's `MailSuppressionRepoPort`), untouched: a
 * removal deletes the 0023 row so send-time checks remain one primary-key probe, and the audit row
 * written in the same transaction keeps what was removed, by whom, when and why.
 */
import { randomUUID } from "node:crypto";
import { sql, type RawBuilder } from "kysely";
import type { MailSuppressionScope } from "../ports.js";
import type { MailSuppressionAdminRepo, MailSuppressionEntry, MailSuppressionListFilter, MailSuppressionReason, MailSuppressionRemoval } from "../activity/ports.js";
import type { MailRepoDeps } from "./ledger.repo.js";

type Row = { normalized_address: string; scope: MailSuppressionScope; reason: MailSuppressionReason; created_at: string; revision: string };

const toEntry = (row: Row): MailSuppressionEntry => ({ address: row.normalized_address, scope: row.scope, reason: row.reason, createdAt: row.created_at, revision: row.revision });
const normalize = ({ address }: { address: string }, _optional = {}): string => address.trim().toLowerCase();
const likeLiteral = ({ term }: { term: string }, _optional = {}): string => {
  const escaped = normalize({ address: term }).replace(/[\\%_]/g, (c) => `\\${c}`);
  return `%${escaped}%`;
};

function conditions({ workspaceId }: { workspaceId: string }, optional: MailSuppressionListFilter): RawBuilder<unknown>[] {
  const where: RawBuilder<unknown>[] = [sql`workspace_id = ${workspaceId}`];
  if (optional.search) where.push(sql`normalized_address LIKE ${likeLiteral({ term: optional.search })} ESCAPE '\\'`);
  if (optional.scope) where.push(sql`scope = ${optional.scope}`);
  if (optional.reason) where.push(sql`reason = ${optional.reason}`);
  if (optional.before) where.push(sql`(created_at < ${optional.before.createdAt} OR (created_at = ${optional.before.createdAt} AND revision < ${optional.before.key}))`);
  return where;
}

/**
 * @complexity One indexed page read per list; O(1) primary-key statements per find/remove.
 * @example createMailSuppressionAdminRepo({ db: kernel }).list({ workspaceId, limit: 26 }, { search: "example.com" })
 */
export function createMailSuppressionAdminRepo<DB>({ db }: MailRepoDeps<DB>, optional: { nowIso?: () => string; newId?: () => string } = {}): MailSuppressionAdminRepo {
  const nowIso = optional.nowIso ?? (() => new Date().toISOString());
  const newId = optional.newId ?? randomUUID;
  const find: MailSuppressionAdminRepo["find"] = async ({ workspaceId, address, scope }) => {
    const [row] = await db.query<Row>(sql`SELECT normalized_address, scope, reason, created_at, revision FROM mail_suppression
      WHERE workspace_id = ${workspaceId} AND normalized_address = ${normalize({ address })} AND scope = ${scope}`);
    return row ? toEntry(row) : null;
  };
  return {
    async list(required, filter = {}) {
      const rows = await db.query<Row>(sql`SELECT normalized_address, scope, reason, created_at, revision FROM mail_suppression
        WHERE ${sql.join(conditions({ workspaceId: required.workspaceId }, filter), sql` AND `)}
        ORDER BY created_at DESC, revision DESC LIMIT ${required.limit}`);
      return rows.map(toEntry);
    },
    find,
    remove: (required) => db.transaction(async () => {
      await db.lockKey(`mail-suppression:${required.workspaceId}:${normalize({ address: required.address })}:${required.scope}`);
      // DELETE claims the reviewed incarnation. A replacement cannot inherit an old approval;
      // RETURNING also ensures only the winning transaction can write an audit record.
      const [row] = await db.query<Row>(sql`DELETE FROM mail_suppression
        WHERE workspace_id = ${required.workspaceId} AND normalized_address = ${normalize({ address: required.address })}
          AND scope = ${required.scope} AND revision = ${required.revision}
        RETURNING normalized_address, scope, reason, created_at, revision`);
      if (!row) return null;
      const entry = toEntry(row);
      const removal: MailSuppressionRemoval = {
        id: newId(), address: entry.address, scope: entry.scope, suppressionReason: entry.reason, suppressedAt: entry.createdAt,
        removalReason: required.removalReason, removedBy: required.removedBy, removedAt: nowIso(),
      };
      await db.execute(sql`INSERT INTO mail_suppression_removals (id, workspace_id, normalized_address, scope, suppression_reason, suppressed_at, removal_reason, removed_by, removed_at)
        VALUES (${removal.id}, ${required.workspaceId}, ${removal.address}, ${removal.scope}, ${removal.suppressionReason}, ${removal.suppressedAt}, ${removal.removalReason}, ${removal.removedBy}, ${removal.removedAt})`);
      return removal;
    }),
    async lastFeedbackEvent({ workspaceId, providerId }) {
      const [row] = await db.query<{ kind: "delivered" | "bounced" | "complained"; received_at: string }>(sql`SELECT kind, received_at FROM mail_feedback_inbox
        WHERE workspace_id = ${workspaceId} AND provider_id = ${providerId} AND processed_at IS NOT NULL ORDER BY received_at DESC, event_id DESC LIMIT 1`);
      return row ? { kind: row.kind, receivedAt: row.received_at } : null;
    },
  };
}
