import {
  MAX_REVOCATIONS,
  isRevoked,
  type PublishTrustRevocation,
  type PublishTrustRevocationPort,
  type RevocationRead,
  type RevocationWrite,
} from "./revocations.js";
import type { StorageKernel } from "@jini-ai/core/contracts/storage";
import type { Kysely } from "kysely";

/**
 * @file Durable deny store for zero-setup publishing authentication: one Kysely query body for
 * every dialect (storage plan §4, ADR-066) over `publish_trust_revocations`.
 *
 * The site content database is the only backing store deliberately selected here. Its loss is
 * already a visible content-loss outage, so no host can accidentally turn a deploy into a silent
 * reconnect by forgetting to mount a second directory. {@link SqlPublishTrustRevocationStore.assertAvailable}
 * proves the table is readable; a composition root runs it while booting (through
 * {@link publishTrustRevocationStoreFor}), before it can listen for publishes.
 *
 * `revoke`/`restore` read the list and write in one kernel transaction under
 * `lockKey("publish_trust_revocations")`, so the `MAX_REVOCATIONS` cap and the "already revoked"
 * check hold against a concurrent writer on every dialect.
 */

const LOCK_KEY = "publish_trust_revocations";

/** The boot-time "deny store unreadable" error. */
function publishTrustRevocationStoreUnavailable({ error }: { error: unknown }, _optional = {}): Error {
  return new Error(
    `publish trust revocation store is unavailable at boot: ${error instanceof Error ? error.message : "unknown error"}`
  );
}

export interface PublishTrustRevocationDatabase {
  publish_trust_revocations: { source_installation_id: string; revoked_at: string; note: string | null };
}

export class SqlPublishTrustRevocationStore<DB extends PublishTrustRevocationDatabase> implements PublishTrustRevocationPort {
  protected readonly kernel: StorageKernel<Kysely<PublishTrustRevocationDatabase>, unknown>;

  constructor({ kernel }: { kernel: StorageKernel<Kysely<DB>, unknown> }, _optional: Record<string, never> = {}) {
    this.kernel = kernel as unknown as StorageKernel<Kysely<PublishTrustRevocationDatabase>, unknown>;
  }

  /** Throws when the deny store cannot be read (missing table, closed database): boot must stop. */
  async assertAvailable(): Promise<void> {
    try {
      await this.kernel.run((db) => db.selectFrom("publish_trust_revocations").select("source_installation_id").limit(1).execute());
    } catch (error) {
      throw publishTrustRevocationStoreUnavailable({ error });
    }
  }

  private async read(): Promise<PublishTrustRevocation[]> {
    const rows = await this.kernel.run((db) =>
      db
        .selectFrom("publish_trust_revocations")
        .selectAll()
        .orderBy("revoked_at", "asc")
        .orderBy("source_installation_id", "asc")
        .execute()
    );
    return rows.map((row) => ({ sourceInstallationId: row.source_installation_id, revokedAt: row.revoked_at, note: row.note }));
  }

  async list(): Promise<RevocationRead> {
    try {
      const revocations = await this.read();
      if (revocations.length > MAX_REVOCATIONS) {
        return { ok: false, reason: `revocation list holds more than ${MAX_REVOCATIONS} records` };
      }
      return { ok: true, revocations };
    } catch (error) {
      return {
        ok: false,
        reason: `the list of disconnected computers could not be read: ${error instanceof Error ? error.message : "unknown error"}`,
      };
    }
  }

  async revoke(input: {
    readonly sourceInstallationId: string;
    readonly nowIso: string;
    readonly note?: string;
  }): Promise<RevocationWrite> {
    return this.kernel.transaction(async () => {
      await this.kernel.lockKey(LOCK_KEY);
      const current = await this.list();
      if (!current.ok) return current;
      if (isRevoked({ revocations: current.revocations, sourceInstallationId: input.sourceInstallationId })) {
        return { ok: true, revocations: current.revocations, changed: false };
      }
      if (current.revocations.length >= MAX_REVOCATIONS) {
        return { ok: false, reason: `this site already lists ${MAX_REVOCATIONS} disconnected computers` };
      }

      const revocation = { sourceInstallationId: input.sourceInstallationId, revokedAt: input.nowIso, note: input.note ?? null };
      try {
        await this.kernel.run((db) =>
          db
            .insertInto("publish_trust_revocations")
            .values({ source_installation_id: revocation.sourceInstallationId, revoked_at: revocation.revokedAt, note: revocation.note })
            .execute()
        );
        return { ok: true, revocations: [...current.revocations, revocation], changed: true };
      } catch (error) {
        return {
          ok: false,
          reason: `the disconnected-computer list could not be updated: ${error instanceof Error ? error.message : "unknown error"}`,
        };
      }
    });
  }

  async restore(input: { readonly sourceInstallationId: string }): Promise<RevocationWrite> {
    return this.kernel.transaction(async () => {
      await this.kernel.lockKey(LOCK_KEY);
      const current = await this.list();
      if (!current.ok) return current;
      if (!isRevoked({ revocations: current.revocations, sourceInstallationId: input.sourceInstallationId })) {
        return { ok: true, revocations: current.revocations, changed: false };
      }

      try {
        await this.kernel.run((db) =>
          db.deleteFrom("publish_trust_revocations").where("source_installation_id", "=", input.sourceInstallationId).execute()
        );
        return {
          ok: true,
          revocations: current.revocations.filter((revocation) => revocation.sourceInstallationId !== input.sourceInstallationId),
          changed: true,
        };
      } catch (error) {
        return {
          ok: false,
          reason: `the disconnected-computer list could not be updated: ${error instanceof Error ? error.message : "unknown error"}`,
        };
      }
    });
  }
}

/** The deny store on `kernel`'s database, whichever dialect, after proving it is readable. */
export async function publishTrustRevocationStoreFor<DB extends PublishTrustRevocationDatabase>({ kernel }: { kernel: StorageKernel<Kysely<DB>, unknown> }, _optional: Record<string, never> = {}): Promise<SqlPublishTrustRevocationStore<DB>> {
  const store = new SqlPublishTrustRevocationStore({ kernel });
  await store.assertAvailable();
  return store;
}
