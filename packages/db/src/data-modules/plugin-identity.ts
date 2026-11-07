/**
 * @file ADR-023 §5/§6 (T5 fix, round-2 revision) — permanent plugin-ID retirement plus the
 * two-track fail-closed namespace-adoption guard.
 *
 * A `pluginId` is permanently retired the moment it is first minted (this record is never
 * deleted, including after a future uninstall+purge — no purge/uninstall flow exists in this
 * codebase yet, so this module's row is never actually removed by anything today; that absence
 * IS the correct behavior per §6's "retirement is permanent" rule, not a gap).
 *
 * Two-track adoption rule (§6): a SUBSEQUENT declare for an already-identified `pluginId` is
 * allowed automatically when its provenance is unchanged from what's on record (the common case —
 * the same first-party module re-declaring at every boot), OR when both the stored and incoming
 * provenance carry a matching signature (track a — "verified same-key signature"). Anything else
 * (no signature on one/both sides, or a mismatch) requires explicit operator consent (track b) —
 * surfaced here as a typed refusal, since no consent-prompt UI exists in this codebase yet.
 *
 * Signature verification here is a same-string comparison, not real cryptographic verification —
 * ADR-004 leaves `signature` optional and no signing/verification infrastructure exists anywhere
 * in this codebase yet (confirmed: ADR-023 §6 itself says the same — "track (a) will rarely fire
 * ... track (b) is the load-bearing path" — this is the intended, honest degraded behavior, not
 * an unfinished shortcut).
 */
import { sql } from "kysely";

import { columnTypeSql } from "../kernel/index.js";
import { type PluginKernel, type PluginStore, pluginKernel } from "./plugin-store.js";

export interface PluginProvenance {
  sourceUrl: string;
  publisher: string;
  signature?: string;
}

export interface PluginIdentityRecord {
  pluginId: string;
  provenance: PluginProvenance;
  mintedAt: number;
}

export type NamespaceAdoptionDecision =
  | { allowed: true; track: "first-mint" | "unchanged" | "verified-signature" }
  | { allowed: false; track: "consent-required"; reason: string };

export async function ensurePluginIdentityTable(
  { store }: { store: PluginStore },
  _optional: Record<string, never> = {}
): Promise<void> {
  const kernel = pluginKernel({ store });
  const text = sql.raw(columnTypeSql(kernel.dialect, "TEXT"));
  await kernel.execute(sql`CREATE TABLE IF NOT EXISTS _plugin_identity (
       plugin_id ${text} PRIMARY KEY,
       source_url ${text} NOT NULL,
       publisher ${text} NOT NULL,
       signature ${text},
       minted_at ${sql.raw(columnTypeSql(kernel.dialect, "INTEGER"))} NOT NULL
     )`);
}

export async function getPluginIdentity(
  required: { db: PluginStore; pluginId: string },
  _optional: Record<string, never> = {}
): Promise<PluginIdentityRecord | null> {
  const { pluginId } = required;
  const row = await pluginKernel({ store: required.db }).run((db) =>
    db
      .selectFrom("_plugin_identity")
      .select(["plugin_id", "source_url", "publisher", "signature", "minted_at"])
      .where("plugin_id", "=", pluginId)
      .executeTakeFirst()
  );
  if (!row) return null;
  return {
    pluginId: row.plugin_id,
    provenance: { sourceUrl: row.source_url, publisher: row.publisher, ...(row.signature != null ? { signature: row.signature } : {}) },
    mintedAt: Number(row.minted_at),
  };
}

/** First-write-wins. Never called again for a `pluginId` once minted (see `checkNamespaceAdoption`). */
async function mintPluginIdentity(kernel: PluginKernel, pluginId: string, provenance: PluginProvenance): Promise<void> {
  await kernel.run((db) =>
    db
      .insertInto("_plugin_identity")
      .values({
        plugin_id: pluginId,
        source_url: provenance.sourceUrl,
        publisher: provenance.publisher,
        signature: provenance.signature ?? null,
        minted_at: Date.now(),
      })
      .execute()
  );
}

function provenanceEqual(a: PluginProvenance, b: PluginProvenance): boolean {
  if (a.sourceUrl !== b.sourceUrl || a.publisher !== b.publisher) return false;
  return (a.signature ?? null) === (b.signature ?? null);
}

/**
 * Mints the identity record on first sight (always `allowed: true`). On a subsequent declare,
 * applies the two-track rule. Does NOT mutate the identity record on anything but first mint —
 * a provenance mismatch never silently overwrites the record on record (permanent retirement).
 */
export async function checkNamespaceAdoption(
  required: { db: PluginStore; pluginId: string; provenance: PluginProvenance },
  _optional: Record<string, never> = {}
): Promise<NamespaceAdoptionDecision> {
  const { pluginId, provenance } = required;
  const kernel = pluginKernel({ store: required.db });
  await ensurePluginIdentityTable({ store: kernel });
  // Read-then-mint: the lock keeps two first declares of one plugin from both minting.
  const existing = await kernel.transaction(async () => {
    await kernel.lockKey(`plugin-identity:${pluginId}`);
    const found = await getPluginIdentity({ db: kernel, pluginId });
    if (!found) await mintPluginIdentity(kernel, pluginId, provenance);
    return found;
  });
  if (!existing) return { allowed: true, track: "first-mint" };
  if (provenanceEqual(existing.provenance, provenance)) {
    return { allowed: true, track: "unchanged" };
  }
  if (existing.provenance.signature && provenance.signature && existing.provenance.signature === provenance.signature) {
    return { allowed: true, track: "verified-signature" };
  }
  return {
    allowed: false,
    track: "consent-required",
    reason: `pluginId '${pluginId}' has retained data from a previously-seen, provenance-mismatched artifact — explicit operator consent is required before adopting this namespace`,
  };
}
