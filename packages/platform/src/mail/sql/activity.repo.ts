/**
 * @file Read projection over the send ledger joined with provider feedback (email phase 4): the
 * Email page's **Recent sends and failures** and `mail_list_activity`/`mail_get_activity`. One SQL
 * body for SQLite and Postgres; migrations 0029 and 0031 add the source and lookup indexes.
 *
 * Only body-free metadata leaves here: the ledger stores no subject, body or link, and this never
 * reads `mail_capture`. Outcomes are derived, never stored:
 *
 * - `sent` rows are `accepted` until feedback says more; the most severe event wins
 *   (complained > bounced > delivered), joined by the provider's message id.
 * - `failed` rows keep the policy's reason: `MAIL_RECIPIENT_SUPPRESSED` is `suppressed`,
 *   `MAIL_RATE_LIMITED` is `deferred`, anything else `failed`.
 * - `reserved` (in flight, or a crash mid-send) and `unknown` are `unknown`: the provider may have
 *   taken it, which is exactly why there is no general Resend.
 *
 * The observer persists use (purpose) from the idempotency key prefix each owner already writes
 * (`members:signin:`, `newsletter:confirm-email:`, `forms:notify:`, `newsletter:`, `mail:test:`).
 * Historical ledgers derive it within the recent window; any other key is `unknown` rather than
 * guessed.
 */
import { sql, type RawBuilder } from "kysely";
import type { MailActivityFilter, MailActivityPosition, MailActivityRecord, MailActivityRepo, MailFeedbackRecord } from "../activity/ports.js";
import type { MailActivityOutcome, MailActivityUse } from "../activity/vocabulary.js";
import type { MailRepoDeps } from "./ledger.repo.js";
import { MAIL_ACTIVITY_RETENTION_MS } from "./retention.js";

type Row = {
  activity_id: string; effective_recipient: string; delivery_mode: "off" | "capture" | "redirect"; idempotency_key: string; recipient: string; lane: "transactional" | "bulk"; provider_id: string; use_id: MailActivityUse;
  activity_outcome: MailActivityOutcome; provider_message_id: string | null; error_code: string | null; message: string | null; created_at: string; updated_at: string;
};

const USE_PREFIXES = [
  ["members:signin:", "sign_in"], ["newsletter:confirm-email:", "newsletter_confirmation"],
  ["forms:notify:", "form_notification"], ["mail:test:", "test"], ["newsletter:", "newsletter"],
] as const;

/** Classify an observation once, before writing it; unknown keys stay explicitly unknown. */
export function mailActivityUse({ idempotencyKey }: { idempotencyKey: string }, _optional: Record<string, never> = {}): MailActivityUse {
  return USE_PREFIXES.find(([prefix]) => idempotencyKey.startsWith(prefix))?.[1] ?? "unknown";
}

/** Historical ledgers predate the purpose column. Only their recent window is projected. */
function legacyUse(_required: Record<string, never> = {}, _optional: Record<string, never> = {}): RawBuilder<unknown> {
  const clauses = USE_PREFIXES.map(([prefix, use]) => {
    const pattern = `${prefix}%`;
    return sql`WHEN old.idempotency_key LIKE ${pattern} THEN ${use}`;
  });
  const joined = sql.join(clauses, sql` `);
  return sql`CASE ${joined} ELSE 'unknown' END`;
}

const feedbackExists = (kind: MailFeedbackRecord["kind"]) => sql`EXISTS (SELECT 1 FROM mail_feedback_inbox f
  WHERE f.workspace_id = l.workspace_id AND f.provider_message_id = l.provider_message_id AND f.provider_id = l.provider_id AND f.recipient = l.effective_recipient AND f.kind = ${kind} AND f.processed_at IS NOT NULL)`;

type SourceQuery = { workspaceId: string; cutoff: string; filter: MailActivityFilter & { before?: MailActivityPosition }; limit?: number; idempotencyKey?: string; effectiveOnly?: boolean };

/** Push non-derived predicates into each indexed source; outcome is resolved after feedback. */
function sourceConditions(required: SourceQuery & { legacy: boolean }, _optional: Record<string, never> = {}): RawBuilder<unknown> {
  const { filter, legacy } = required;
  const alias = legacy ? "old" : "a";
  const col = ({ name }: { name: string }, _optional = {}) => sql.ref(`${alias}.${name}`);
  const where = [sql`${col({ name: "workspace_id" })} = ${required.workspaceId}`, sql`${col({ name: "created_at" })} >= ${required.cutoff}`];
  if (filter.use) where.push(sql`${legacy ? legacyUse() : col({ name: "use_id" })} = ${filter.use}`);
  if (required.idempotencyKey) where.push(sql`${col({ name: "idempotency_key" })} = ${required.idempotencyKey}`);
  if (filter.recipient) where.push(recipientCondition({ ...required, recipient: filter.recipient }));
  if (filter.before) where.push(sql`(${col({ name: "created_at" })} < ${filter.before.createdAt} OR (${col({ name: "created_at" })} = ${filter.before.createdAt} AND ${col({ name: legacy ? "activity_id" : "id" })} < ${filter.before.key}))`);
  return sql.join(where, sql` AND `);
}

/** Exact effective-recipient lookup for details; list filters also match the original address. */
function recipientCondition(required: { legacy: boolean; recipient: string; effectiveOnly?: boolean }, _optional: Record<string, never> = {}): RawBuilder<unknown> {
  const address = required.recipient.trim().toLowerCase();
  const original = sql.ref(required.legacy ? "old.recipient" : "a.recipient");
  const effective = sql.ref(required.legacy ? "old.recipient" : "a.effective_recipient");
  return required.effectiveOnly ? sql`${effective} = ${address}` : sql`(${original} = ${address} OR ${effective} = ${address})`;
}

/** Limit each ordered source before the UNION/feedback work on ordinary page reads. */
function activitySources(required: SourceQuery, _optional: Record<string, never> = {}): RawBuilder<unknown> {
  const limit = required.limit === undefined ? sql`` : sql`LIMIT ${required.limit}`;
  return sql`SELECT * FROM (
    SELECT a.id AS activity_id, a.workspace_id, a.idempotency_key, a.recipient, a.effective_recipient, a.delivery_mode,
      a.lane, a.provider_id, a.outcome, a.provider_message_id, a.error_code, a.message, a.created_at, a.updated_at, a.use_id
      FROM mail_activity_attempts a WHERE ${sourceConditions({ ...required, legacy: false })}
      ORDER BY a.created_at DESC, a.id DESC ${limit}
    ) attempts
    UNION ALL SELECT * FROM (
      SELECT old.activity_id, old.workspace_id, old.idempotency_key, old.recipient, old.recipient AS effective_recipient, 'off' AS delivery_mode,
        old.lane, old.provider_id, old.outcome, old.provider_message_id, old.error_code, NULL AS message, old.created_at, old.updated_at, ${legacyUse()} AS use_id
      FROM mail_send_ledger old WHERE ${sourceConditions({ ...required, legacy: true })}
        AND old.activity_retained = 1 AND NOT EXISTS (SELECT 1 FROM mail_activity_attempts a
          WHERE a.workspace_id = old.workspace_id AND a.idempotency_key = old.idempotency_key AND a.recipient = old.recipient)
      ORDER BY old.created_at DESC, old.activity_id DESC ${limit}
    ) legacy`;
}

/** Feedback is probed only for candidate rows; the attempts' stored purpose remains indexable. */
function projection(required: SourceQuery, _optional: Record<string, never> = {}): RawBuilder<unknown> {
  return sql`SELECT l.*,
    CASE WHEN l.outcome = 'captured' THEN 'captured' WHEN l.outcome = 'sent' THEN
        CASE WHEN ${feedbackExists("complained")} THEN 'complained' WHEN ${feedbackExists("bounced")} THEN 'bounced'
          WHEN ${feedbackExists("delivered")} THEN 'delivered' ELSE 'accepted' END
      WHEN l.outcome = 'failed' THEN
        CASE WHEN l.error_code = 'MAIL_RECIPIENT_SUPPRESSED' THEN 'suppressed' WHEN l.error_code = 'MAIL_RATE_LIMITED' THEN 'deferred' ELSE 'failed' END
      ELSE 'unknown' END AS activity_outcome
    FROM (${activitySources(required)}) l`;
}

function toRecord(row: Row): MailActivityRecord {
  return {
    cursorKey: row.activity_id, idempotencyKey: row.idempotency_key, recipient: row.effective_recipient,
    ...(row.delivery_mode === "off" ? {} : { originalRecipient: row.recipient, deliveryMode: row.delivery_mode }), lane: row.lane, providerId: row.provider_id, use: row.use_id,
    outcome: row.activity_outcome, providerMessageId: row.provider_message_id, errorCode: row.error_code, message: row.message, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

/**
 * The activity reads. Newest first by creation, ties broken by the opaque activity id, so a page boundary
 * inside one timestamp is resumed by its keyset position without exposing a key or address in the cursor.
 * @complexity Ordinary lists merge at most two limit-sized indexed candidate pages, then probe
 * feedback at most three times per candidate. The legacy branch can scan the recent 30-day window
 * for purpose/duplicate exclusion. Outcome filters evaluate candidates in that window before LIMIT;
 * they are not constant-time indexed reads. Detail uses indexed identity/recipient predicates.
 * @example createMailActivityRepo({ db: kernel }).list({ workspaceId, limit: 26 }, { outcome: "bounced" })
 */
export function createMailActivityRepo<DB>({ db }: MailRepoDeps<DB>, optional: { now?: () => number } = {}): MailActivityRepo {
  const cutoff = () => new Date((optional.now ?? Date.now)() - MAIL_ACTIVITY_RETENTION_MS).toISOString();
  return {
    async list(required, optional = {}) {
      const source: SourceQuery = { workspaceId: required.workspaceId, cutoff: cutoff(), filter: optional, ...(optional.outcome ? {} : { limit: required.limit }) };
      const outcome = optional.outcome ? sql`WHERE a.activity_outcome = ${optional.outcome}` : sql``;
      const rows = await db.query<Row>(sql`SELECT * FROM (${projection(source)}) a ${outcome}
        ORDER BY a.created_at DESC, a.activity_id DESC LIMIT ${required.limit}`);
      return rows.map(toRecord);
    },
    async get({ workspaceId, idempotencyKey, recipient }) {
      const [row] = await db.query<Row>(sql`SELECT * FROM (${projection({ workspaceId, cutoff: cutoff(), filter: { recipient }, idempotencyKey, effectiveOnly: true, limit: 1 })}) a LIMIT 1`);
      if (!row) return null;
      const feedback = row.provider_message_id === null ? [] : await db.query<{ kind: MailFeedbackRecord["kind"]; hard_bounce: number; provider_id: string; occurred_at: string; received_at: string }>(
        sql`SELECT kind, hard_bounce, provider_id, occurred_at, received_at FROM mail_feedback_inbox
          WHERE workspace_id = ${workspaceId} AND provider_message_id = ${row.provider_message_id} AND provider_id = ${row.provider_id} AND recipient = ${row.effective_recipient} AND processed_at IS NOT NULL ORDER BY occurred_at, event_id`);
      return {
        record: toRecord(row),
        feedback: feedback.map((event) => ({ kind: event.kind, hardBounce: Number(event.hard_bounce) === 1, providerId: event.provider_id, occurredAt: event.occurred_at, receivedAt: event.received_at })),
      };
    },
  };
}
