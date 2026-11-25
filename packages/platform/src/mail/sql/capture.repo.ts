/** @file SQL adapter for Jini's `MailCapturePort` (migration 0023): test/capture mode's message sink. */
import { isLoopbackHostname } from "@jini-ai/core/net";
import {
  OriginNotVerifiedError,
  type OriginRegistryPort,
} from "@jini-ai/core/contracts/server/verified-origin";
import { mailActivityUse } from "./activity.repo.js";
import { createHash, randomUUID } from "node:crypto";
import type { MailCaptureClearPlan } from "@jini-ai/core/contracts/mail";
import { sql } from "kysely";
import type { MailCapturePort, MailDeliveryLane, OutboundEmail } from "../ports.js";
import type { MailRepoDeps, MailRepoOptions } from "./ledger.repo.js";

export interface CapturedMail {
  id: string;
  lane: MailDeliveryLane;
  idempotencyKey: string;
  to: string;
  subject: string;
  message: OutboundEmail;
  createdAt: string;
}

export interface MailCaptureRepo extends MailCapturePort {
  /** Newest first. `limit` is clamped to 1..{@link MAX_CAPTURE_LIST}; default {@link DEFAULT_CAPTURE_LIST}. */
  listCaptured(required: { workspaceId: string }, optional?: { limit?: number }): Promise<readonly CapturedMail[]>;
  /**
   * The owner's review of a clear: this workspace's stored captures plus the activity rows the Email
   * Activity list shows as kept locally (`outcome = 'captured'`, which includes console-driver sends that
   * never store a copy), their summary, and the revision naming exactly that set. `plan.count` counts
   * distinct test emails (a test-mode capture and its activity row are one email).
   */
  reviewCaptured(required: { workspaceId: string }): Promise<CapturedMailReview>;
  /**
   * Deletes, in one transaction, only the reviewed `captureIds` and still-captured `attemptIds` of this
   * workspace, and retires the matching send-ledger rows from the activity projection so a cleared send
   * cannot resurface there. A capture that arrived after the review, or another workspace's, is never
   * deleted; the ledger rows themselves (duplicate protection) and real sends are untouched.
   * @returns `deleted`: the distinct test emails removed, counted like `plan.count`.
   */
  clearReviewedCaptures(required: { workspaceId: string; captureIds: readonly string[]; attemptIds: readonly string[] }): Promise<{ deleted: number }>;
}

/** A reviewed set of captured test emails; `revision` changes whenever the set does (not only its count or newest time). */
export interface CapturedMailReview { plan: MailCaptureClearPlan; captureIds: readonly string[]; attemptIds: readonly string[]; revision: string }

export const DEFAULT_CAPTURE_LIST = 50;
export const MAX_CAPTURE_LIST = 200;
/** Ids per `DELETE ... IN (...)`, under every dialect's bound-parameter limit. */
const CLEAR_CHUNK = 500;

/** The identity of one reviewed or deleted row: which test email it is, and when. */
type KeyedRow = { id: string; created_at: string; idempotency_key: string; recipient: string };
type Row = { id: string; lane: MailDeliveryLane; idempotency_key: string; to_address: string; subject: string; payload_json: string; created_at: string };

const clampLimit = ({ limit }: { limit: number | undefined }, _optional = {}): number =>
  Math.min(MAX_CAPTURE_LIST, Math.max(1, Math.trunc(limit ?? DEFAULT_CAPTURE_LIST)));

/**
 * Stores sign-in captures whole only for trusted loopback origins, so local/desktop operators
 * can click their links. Public or missing origins retain routing metadata only: subject, body,
 * headers, names and attachments may all contain credentials and must never reach storage.
 * @complexity capture O(payload size); listCaptured O(returned payload size), with a bounded indexed row limit;
 *   reviewCaptured O(workspace captures + captured attempts), two workspace-scoped reads; clearReviewedCaptures
 *   O(reviewed ids) primary-key deletes in ceil(ids / 500) statements per table plus one indexed ledger
 *   update per deleted attempt, one transaction.
 * @example createMailCaptureRepo({ db: kernel }).capture({ message, lane: "transactional", idempotencyKey })
 */
export function createMailCaptureRepo<DB>(
  { db, origin }: MailRepoDeps<DB> & { origin?: OriginRegistryPort },
  optional: MailRepoOptions & { newId?: () => string } = {},
): MailCaptureRepo {
  const nowIso = optional.nowIso ?? (() => new Date().toISOString());
  const newId = optional.newId ?? randomUUID;
  return {
    async capture({ message, lane, idempotencyKey }) {
      const stored = await capturePayload({ message, idempotencyKey, origin });
      const id = newId();
      await db.execute(sql`INSERT INTO mail_capture (id, workspace_id, lane, idempotency_key, to_address, subject, payload_json, created_at)
        VALUES (${id}, ${message.workspaceId}, ${lane}, ${idempotencyKey}, ${stored.to.email}, ${stored.subject}, ${JSON.stringify(stored)}, ${nowIso()})`);
      return { id };
    },
    async listCaptured({ workspaceId }, options = {}) {
      const rows = await db.query<Row>(sql`SELECT id, lane, idempotency_key, to_address, subject, payload_json, created_at FROM mail_capture
        WHERE workspace_id = ${workspaceId} ORDER BY created_at DESC, id DESC LIMIT ${clampLimit({ limit: options.limit })}`);
      return rows.map((row) => ({
        id: row.id, lane: row.lane, idempotencyKey: row.idempotency_key, to: row.to_address, subject: row.subject,
        message: JSON.parse(row.payload_json) as OutboundEmail, createdAt: row.created_at,
      }));
    },
    async reviewCaptured({ workspaceId }) {
      const captures = await db.query<KeyedRow>(sql`SELECT id, created_at, idempotency_key, to_address AS recipient FROM mail_capture WHERE workspace_id = ${workspaceId} ORDER BY id`);
      const attempts = await db.query<KeyedRow>(sql`SELECT id, created_at, idempotency_key, recipient FROM mail_activity_attempts
        WHERE workspace_id = ${workspaceId} AND outcome = 'captured' ORDER BY id`);
      const captureIds = captures.map((row) => row.id);
      const attemptIds = attempts.map((row) => row.id);
      const newestAt = [...captures, ...attempts].reduce<string | null>((max, row) => (max === null || row.created_at > max ? row.created_at : max), null);
      return { plan: { count: distinctEmails({ rows: [...captures, ...attempts] }), newestAt }, captureIds, attemptIds, revision: captureSetRevision({ workspaceId, captureIds, attemptIds }) };
    },
    clearReviewedCaptures: ({ workspaceId, captureIds, attemptIds }) => db.transaction(async () => {
      const removed: KeyedRow[] = [];
      for (let at = 0; at < captureIds.length; at += CLEAR_CHUNK) {
        const ids = captureIds.slice(at, at + CLEAR_CHUNK);
        // RETURNING reads deleted rows the same way on SQLite and Postgres.
        removed.push(...await db.query<KeyedRow>(sql`DELETE FROM mail_capture WHERE workspace_id = ${workspaceId} AND id IN (${sql.join(ids)})
          RETURNING id, created_at, idempotency_key, to_address AS recipient`));
      }
      for (let at = 0; at < attemptIds.length; at += CLEAR_CHUNK) {
        const ids = attemptIds.slice(at, at + CLEAR_CHUNK);
        // `outcome = 'captured'` again: an attempt upserted into a real send since the review is not a test email.
        const rows = await db.query<KeyedRow>(sql`DELETE FROM mail_activity_attempts WHERE workspace_id = ${workspaceId} AND outcome = 'captured' AND id IN (${sql.join(ids)})
          RETURNING id, created_at, idempotency_key, recipient`);
        // The activity list falls back to a retained ledger row when its attempt is missing; retire it (as retention does) so the cleared send stays gone.
        for (const row of rows) {
          await db.execute(sql`UPDATE mail_send_ledger SET activity_retained = 0 WHERE workspace_id = ${workspaceId} AND idempotency_key = ${row.idempotency_key} AND recipient = ${row.recipient}`);
        }
        removed.push(...rows);
      }
      return { deleted: distinctEmails({ rows: removed }) };
    }),
  };
}

/**
 * The revision of one workspace's reviewed capture set: a digest of its sorted ids, so two different
 * sets with the same count and newest time never share a revision. @complexity O(ids log ids).
 */
function captureSetRevision(required: { workspaceId: string; captureIds: readonly string[]; attemptIds: readonly string[] }, _optional: Record<string, never> = {}): string {
  const { workspaceId, captureIds, attemptIds } = required;
  const digest = createHash("sha256").update(workspaceId);
  for (const id of [...captureIds].sort()) digest.update("\nc:").update(id);
  for (const id of [...attemptIds].sort()) digest.update("\na:").update(id);
  return `captures-v2:${captureIds.length}:${attemptIds.length}:${digest.digest("base64url")}`;
}

/** One test email per (idempotency key, recipient): a test-mode capture and its activity row count once. @complexity O(rows). */
function distinctEmails({ rows }: { rows: readonly KeyedRow[] }, _optional: Record<string, never> = {}): number {
  return new Set(rows.map((row) => `${row.idempotency_key}\n${row.recipient.trim().toLowerCase()}`)).size;
}

/**
 * Redacts sign-in captures at the persistence boundary, before serialization. The activity owner
 * classifies the host's purpose keys; Jini owns loopback detection. Missing evidence fails closed.
 * @returns The original local/non-auth message, or an allowlisted public sign-in envelope.
 * @throws Unexpected origin/storage failures propagate; no unredacted fallback is persisted.
 * @complexity O(1), at most one origin read; redaction does not scan credential-bearing content.
 */
async function capturePayload(required: {
  message: OutboundEmail; idempotencyKey: string; origin?: OriginRegistryPort | undefined;
}, _options: Record<string, never> = {}): Promise<OutboundEmail> {
  const { message, idempotencyKey, origin } = required;
  if (mailActivityUse({ idempotencyKey }) !== "sign_in") return message;
  try {
    const canonical = await origin?.canonicalOrigin({ workspaceId: message.workspaceId });
    if (canonical && isLoopbackHostname({ hostname: canonical.host })) return message;
  } catch (err) {
    if (!(err instanceof OriginNotVerifiedError)) throw err;
  }
  return {
    workspaceId: message.workspaceId,
    to: { email: message.to.email },
    from: { email: message.from.email },
    subject: "Sign-in email (content redacted)",
    text: "Authentication content is not stored on public sites.",
  };
}
