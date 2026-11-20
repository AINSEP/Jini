import type { StorageKernel } from "@jini-ai/core/contracts/storage";
import type { Kysely } from "kysely";
import type { FormPullClaim, FormPullLeasePort, FormPullRefusal } from "../delivery/index.js";

interface PullRow { lease_token: string | null; lease_expires_at: string | null; last_started_at: string }
interface PullLeaseRow extends PullRow { workspace_id: string; receiver_key: string }

/** Why a claim at `nowMs` must wait, or null when it may start. An expired lease is free again,
 * which is how a pull that crashed mid-way recovers. `recentMs` 0 (manual) never refuses `recent`,
 * even when the clock moved back past the last start. */
function refusalOf({ row, nowMs, recentMs }: { row: PullRow | undefined; nowMs: number; recentMs: number }, _optional: Record<string, never> = {}): FormPullRefusal | null {
  if (!row) return null;
  // Claim and release always set or clear token and expiry together, so the expiry alone says "held".
  if (row.lease_expires_at !== null && Date.parse(row.lease_expires_at) > nowMs) return "already-running";
  if (recentMs > 0 && nowMs - Date.parse(row.last_started_at) < recentMs) return "recent";
  return null;
}

/** The lease end. A non-positive or non-finite `leaseMs` would grant a lease that is already
 * over, letting two pulls overlap, so it is refused instead of stored. */
function leaseExpiresAt({ nowIso, leaseMs }: { nowIso: string; leaseMs: number }, _optional: Record<string, never> = {}): string {
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(nowMs) || !Number.isFinite(leaseMs) || leaseMs <= 0) {
    throw new RangeError(`Form pull lease refused: nowIso must be an ISO time and leaseMs a positive finite number (got ${leaseMs}); pass the pull's bounded duration.`);
  }
  return new Date(nowMs + leaseMs).toISOString();
}

/**
 * The per-receiver pull lease. `leaseMs` comes from the caller, which owns the pull's page and time
 * bounds and must prove the lease outlasts the bounded pull (see `withFormPullLease`).
 */
export class SqlFormPullLeaseRepo implements FormPullLeasePort {
  private readonly required: { kernel: StorageKernel<Kysely<unknown>, unknown>; table: string };
  constructor(required: { kernel: StorageKernel<Kysely<unknown>, unknown>; table: string }, _optional: Record<string, never> = {}) {
    this.required = required;
  }

  /**
   * Atomic admission: under `lockKey` (Postgres advisory lock; SQLite's write transaction), reads
   * the receiver row, refuses with the reason, or records this start and lease in one upsert.
   * @throws RangeError when `nowIso` or `leaseMs` is unusable (before touching the database).
   * @complexity O(1): one primary-key read and one upsert.
   */
  async claim(
    required: { workspaceId: string; receiverKey: string; token: string; nowIso: string; recentMs: number; leaseMs: number },
    _optional: Record<string, never> = {},
  ): Promise<FormPullClaim> {
    const { kernel } = this.required;
    const { workspaceId, receiverKey, token, nowIso } = required;
    const expiresAt = leaseExpiresAt({ nowIso, leaseMs: required.leaseMs });
    return kernel.transaction(async () => {
      await kernel.lockKey(JSON.stringify(["form-receiver-pull", workspaceId, receiverKey]));
      const row = await kernel.run(db => db.withTables<Record<string, PullLeaseRow>>().selectFrom(this.required.table).select(["lease_token", "lease_expires_at", "last_started_at"])
        .where("workspace_id", "=", workspaceId).where("receiver_key", "=", receiverKey).executeTakeFirst());
      const reason = refusalOf({ row, nowMs: Date.parse(nowIso), recentMs: required.recentMs });
      if (reason) return { claimed: false, reason };
      const lease = { lease_token: token, lease_expires_at: expiresAt, last_started_at: nowIso };
      await kernel.run(db => db.withTables<Record<string, PullLeaseRow>>().insertInto(this.required.table).values({ workspace_id: workspaceId, receiver_key: receiverKey, ...lease })
        .onConflict(conflict => conflict.columns(["workspace_id", "receiver_key"]).doUpdateSet(lease)).execute());
      return { claimed: true };
    });
  }

  /** Clears the lease only while `token` still holds it, so a pull that outlived its lease cannot
   * free a newer holder; the last start stays for the `recent` check. @complexity O(1). */
  async release(required: { workspaceId: string; receiverKey: string; token: string }, _optional: Record<string, never> = {}): Promise<void> {
    await this.required.kernel.run(db => db.withTables<Record<string, PullLeaseRow>>().updateTable(this.required.table).set({ lease_token: null, lease_expires_at: null })
      .where("workspace_id", "=", required.workspaceId).where("receiver_key", "=", required.receiverKey)
      .where("lease_token", "=", required.token).execute());
  }
}
