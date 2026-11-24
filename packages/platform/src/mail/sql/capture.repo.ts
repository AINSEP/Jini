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
  /** The owner's review of a clear: this workspace's capture ids, their summary, and the revision naming exactly that set. */
  reviewCaptured(required: { workspaceId: string }): Promise<CapturedMailReview>;
  /**
   * Deletes, in one transaction, only the reviewed `captureIds` of this workspace: a capture that
   * arrived after the review, or another workspace's, is never deleted. Send ledger and activity are untouched.
   */
  clearReviewedCaptures(required: { workspaceId: string; captureIds: readonly string[] }): Promise<{ deleted: number }>;
}

/** A reviewed set of captured test emails; `revision` changes whenever the set does (not only its count or newest time). */
export interface CapturedMailReview { plan: MailCaptureClearPlan; captureIds: readonly string[]; revision: string }

export const DEFAULT_CAPTURE_LIST = 50;
export const MAX_CAPTURE_LIST = 200;
/** Ids per `DELETE ... IN (...)`, under every dialect's bound-parameter limit. */
const CLEAR_CHUNK = 500;

type Row = { id: string; lane: MailDeliveryLane; idempotency_key: string; to_address: string; subject: string; payload_json: string; created_at: string };

const clampLimit = ({ limit }: { limit: number | undefined }, _optional = {}): number =>
  Math.min(MAX_CAPTURE_LIST, Math.max(1, Math.trunc(limit ?? DEFAULT_CAPTURE_LIST)));

/**
 * Stores sign-in captures whole only for trusted loopback origins, so local/desktop operators
 * can click their links. Public or missing origins retain routing metadata only: subject, body,
 * headers, names and attachments may all contain credentials and must never reach storage.
 * @complexity capture O(payload size); listCaptured O(returned payload size), with a bounded indexed row limit;
 *   reviewCaptured O(workspace captures) over the (workspace_id, created_at) index; clearReviewedCaptures
 *   O(reviewed ids) primary-key deletes in ceil(ids / 500) statements, one transaction.
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
      const rows = await db.query<{ id: string; created_at: string }>(sql`SELECT id, created_at FROM mail_capture WHERE workspace_id = ${workspaceId} ORDER BY id`);
      const captureIds = rows.map((row) => row.id);
      const newestAt = rows.reduce<string | null>((max, row) => (max === null || row.created_at > max ? row.created_at : max), null);
      return { plan: { count: rows.length, newestAt }, captureIds, revision: captureSetRevision({ workspaceId, captureIds }) };
    },
    clearReviewedCaptures: ({ workspaceId, captureIds }) => db.transaction(async () => {
      let deleted = 0;
      for (let at = 0; at < captureIds.length; at += CLEAR_CHUNK) {
        const ids = captureIds.slice(at, at + CLEAR_CHUNK);
        // RETURNING counts deleted rows the same way on SQLite and Postgres.
        const rows = await db.query<{ id: string }>(sql`DELETE FROM mail_capture WHERE workspace_id = ${workspaceId} AND id IN (${sql.join(ids)}) RETURNING id`);
        deleted += rows.length;
      }
      return { deleted };
    }),
  };
}

/**
 * The revision of one workspace's reviewed capture set: a digest of its sorted ids, so two different
 * sets with the same count and newest time never share a revision. @complexity O(ids).
 */
function captureSetRevision({ workspaceId, captureIds }: { workspaceId: string; captureIds: readonly string[] }, _optional: Record<string, never> = {}): string {
  const digest = createHash("sha256").update(workspaceId);
  for (const id of [...captureIds].sort()) digest.update("\n").update(id);
  return `captures-v1:${captureIds.length}:${digest.digest("base64url")}`;
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
