/** @file SQL adapter for Jini's `MailSendLedgerPort` (migration 0023), one body for SQLite and Postgres. */
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import type { Kysely, RawBuilder } from "kysely";
import type { StorageKernel } from "@jini-ai/core/contracts/storage";
import type { MailDeliveryLane, MailLedgerOutcome, MailSendLedgerPort } from "../ports.js";

/** The content database kernel. Generic so a typed `ContentKernel` fits: these tables are raw SQL,
 * outside the generated Kysely types, so only `query`/`execute`/`transaction`/`lockKey` are used. */
export interface MailRepoDeps<DB = unknown> {
  db: MailSqlKernel<DB>;
}

/** Core's storage kernel over a Kysely handle, plus raw `sql` statements: `query` returns rows,
 * `execute` returns none. A host's Kysely-bound kernel (`@jini-ai/db/kernel`) fits structurally. */
export interface MailSqlKernel<DB = unknown> extends StorageKernel<Kysely<DB>, DB> {
  query<Row>(statement: RawBuilder<Row>): Promise<Row[]>;
  execute(statement: RawBuilder<unknown>): Promise<void>;
}

export interface MailRepoOptions {
  /** Injected ISO clock; defaults to the wall clock. */
  nowIso?: () => string;
}

type Key = { workspaceId: string; idempotencyKey: string; recipient: string };
type ReserveResult = Awaited<ReturnType<MailSendLedgerPort["reserve"]>>;
type StoredRow = { outcome: Exclude<MailLedgerOutcome, "failed">; payload_hash: string; provider_message_id: string | null };

/** One advisory lock per ledger identity: reserve's read-after-write and mark never interleave. */
function lockName({ workspaceId, idempotencyKey, recipient }: Key): string {
  return `mail-ledger:${workspaceId}:${idempotencyKey}:${recipient}`;
}

function existingOf(row: StoredRow): ReserveResult {
  return {
    status: "existing", outcome: row.outcome, payloadHash: row.payload_hash,
    ...(row.provider_message_id === null ? {} : { providerMessageId: row.provider_message_id }),
  };
}

/**
 * Reserve → send → mark ledger. `reserve` inserts-if-absent, then flips a `failed` row (or, with
 * `reclaimUnknown`, a same-content `unknown` row) back to `reserved` in one conditional UPDATE (a
 * definitive failure sent nothing, so a retry under the same identity is safe), else returns the
 * stored row. Both run under the identity's `lockKey`, so a
 * concurrent `mark` cannot turn the row `failed` between the flip and the read.
 * @complexity O(1) primary-key statements per call.
 * @example createMailSendLedgerRepo({ db: kernel }).reserve({ workspaceId, idempotencyKey, recipient, payloadHash, lane: "transactional", providerId: "smtp" })
 */
export function createMailSendLedgerRepo<DB>({ db }: MailRepoDeps<DB>, optional: MailRepoOptions = {}): MailSendLedgerPort {
  const nowIso = optional.nowIso ?? (() => new Date().toISOString());
  const where = ({ workspaceId, idempotencyKey, recipient }: Key) =>
    sql`workspace_id = ${workspaceId} AND idempotency_key = ${idempotencyKey} AND recipient = ${recipient}`;

  const reserve = async (required: Key & { payloadHash: string; lane: MailDeliveryLane; providerId: string; reclaimUnknown: boolean }, _optional = {}): Promise<ReserveResult> => {
    const { workspaceId, idempotencyKey, recipient, payloadHash, lane, providerId, reclaimUnknown } = required;
    await db.lockKey(lockName(required));
    const at = nowIso();
    const inserted = await db.query(sql`INSERT INTO mail_send_ledger (workspace_id, idempotency_key, recipient, payload_hash, lane, provider_id, outcome, created_at, updated_at, activity_id)
      VALUES (${workspaceId}, ${idempotencyKey}, ${recipient}, ${payloadHash}, ${lane}, ${providerId}, 'reserved', ${at}, ${at}, ${randomUUID()})
      ON CONFLICT (workspace_id, idempotency_key, recipient) DO NOTHING RETURNING outcome`);
    if (inserted.length > 0) return { status: "reserved" };
    // A corrected retry after a definitive failure may carry new content, so the hash moves with it.
    // A resendable `unknown` row is claimed only for the same content: the flip to `reserved` is the
    // claim, so of two concurrent retries exactly one re-sends and the other sees `reserved`.
    const unknown = reclaimUnknown ? sql`OR (outcome = 'unknown' AND payload_hash = ${payloadHash})` : sql``;
    const flipped = await db.query(sql`UPDATE mail_send_ledger SET outcome = 'reserved', payload_hash = ${payloadHash}, lane = ${lane},
      provider_id = ${providerId}, provider_message_id = NULL, error_code = NULL, updated_at = ${at}
      WHERE ${where(required)} AND (outcome = 'failed' ${unknown}) RETURNING outcome`);
    if (flipped.length > 0) return { status: "reserved" };
    const [row] = await db.query<StoredRow>(sql`SELECT outcome, payload_hash, provider_message_id FROM mail_send_ledger WHERE ${where(required)}`);
    // The INSERT conflicted under the identity lock, so the row exists and is not `failed`.
    return existingOf(row as StoredRow);
  };

  return {
    reserve: (required, optional = {}) => db.transaction(async () => reserve({ ...required, reclaimUnknown: optional.reclaimUnknown === true })),
    mark: (required) => db.transaction(async () => {
      await db.lockKey(lockName(required));
      await db.execute(sql`UPDATE mail_send_ledger SET outcome = ${required.outcome}, provider_message_id = ${required.providerMessageId ?? null},
        error_code = ${required.errorCode ?? null}, updated_at = ${nowIso()} WHERE ${where(required)}`);
    }),
  };
}
