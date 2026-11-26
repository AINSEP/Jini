import type { BlobJournalIdentity, BlobPurgeReason, BlobStorageKeyFor } from "@jini-ai/core/contracts/blob-gc";
import type { AssetRenditionRecord } from "./types.js";

/**
 * @file The blob-GC journal's provenance contract (p11 J1c) as two pure functions: the purge-side
 * plan of which derived keys to journal, and the collector-side verdict of whether a journaled key
 * may ever be unlinked. Neither touches storage; nothing here schedules or performs a sweep.
 *
 * Why a rendition carries its OWN digest: a rendition's bytes are content-addressed by the output
 * hash, so the same bytes can be another asset's original or another rendition. Journaling a
 * derived key under its source media digest would make the collector's ownership re-check look at
 * the wrong bytes and could unlink a file a second owner still holds.
 */

const SHA256_HEX = /^[0-9a-f]{64}$/;
const REASONS: ReadonlySet<string> = new Set<BlobPurgeReason>(["owner-purge", "trash-ttl", "upload-rollback"]);
const ROLES: ReadonlySet<string> = new Set(["original", "rendition"]);

export interface RenditionJournalPlan {
  /** Distinct derived keys with a recorded own digest, ready to journal with the purge reason. */
  readonly renditions: BlobJournalIdentity[];
  /** Derived keys with no (or a conflicting) recorded digest: keep/report, never journaled eligible. */
  readonly unverifiedKeys: string[];
}

/** Groups rendition rows by key, dropping the original passthrough (it shares the original's key). */
function digestsByDerivedKey(originalKey: string, renditions: readonly Pick<AssetRenditionRecord, "storageKey" | "sha256">[]) {
  const byKey = new Map<string, Set<string | undefined>>();
  for (const row of renditions) {
    if (row.storageKey === originalKey) continue;
    const digests = byKey.get(row.storageKey) ?? new Set<string | undefined>();
    digests.add(row.sha256);
    byKey.set(row.storageKey, digests);
  }
  return byKey;
}

/**
 * Plan the rendition half of a purge/rollback journal write.
 * @returns one identity per distinct derived key whose rows agree on one valid digest; every other
 * derived key is listed as unverified. The `reason` is omitted (legacy, keep/report) when absent.
 * @complexity O(r) in the asset's rendition rows.
 * @example planRenditionJournal({ workspaceId, original: { storageKey }, reason: "owner-purge", renditions })
 */
export function planRenditionJournal(
  required: { workspaceId: string; original: { storageKey: string }; reason?: BlobPurgeReason | undefined; renditions: readonly Pick<AssetRenditionRecord, "storageKey" | "sha256">[] },
  _optional: Record<string, never> = {},
): RenditionJournalPlan {
  const plan: RenditionJournalPlan = { renditions: [], unverifiedKeys: [] };
  for (const [storageKey, digests] of digestsByDerivedKey(required.original.storageKey, required.renditions)) {
    const [sha256] = [...digests];
    if (digests.size !== 1 || sha256 === undefined || !SHA256_HEX.test(sha256)) {
      plan.unverifiedKeys.push(storageKey);
      continue;
    }
    plan.renditions.push({ workspaceId: required.workspaceId, storageKey, sha256, role: "rendition",
      ...(required.reason === undefined ? {} : { reason: required.reason }) });
  }
  return plan;
}

export type JournalKeepReason =
  | "legacy-no-reason" | "unknown-reason" | "unknown-role" | "invalid-digest"
  | "key-digest-mismatch" | "upload-rollback" | "trash-ttl-disabled";

export type JournalEntryVerdict = { readonly verdict: "candidate" } | { readonly verdict: "keep"; readonly why: JournalKeepReason };

/** Provenance-shape checks shared by every reason; `null` means the entry's shape is exact. */
function provenanceDefect(entry: Partial<BlobJournalIdentity> & { storageKey: string; sha256: string; workspaceId: string }, storageKeyFor: BlobStorageKeyFor): JournalKeepReason | null {
  if (entry.reason === undefined) return "legacy-no-reason";
  if (!REASONS.has(entry.reason)) return "unknown-reason";
  if (entry.role === undefined || !ROLES.has(entry.role)) return "unknown-role";
  if (!SHA256_HEX.test(entry.sha256)) return "invalid-digest";
  if (storageKeyFor({ workspaceId: entry.workspaceId, sha256: entry.sha256 }) !== entry.storageKey) return "key-digest-mismatch";
  return null;
}

/**
 * Whether a journaled key may become an unlink candidate. Only an exact, owner-confirmed purge of a
 * canonically keyed digest qualifies; a Trash-expiry entry qualifies only when the host opts in
 * (`allowTrashTtl`, default off — an open owner decision), and an upload rollback never does absent
 * a policy decision. A candidate is still not authority to unlink: the collector must re-read the
 * entry and current ownership inside the key fence immediately before removal.
 * @complexity O(1).
 * @example classifyJournalEntry({ entry, storageKeyFor }, {})
 */
export function classifyJournalEntry(
  required: { entry: Partial<BlobJournalIdentity> & { workspaceId: string; storageKey: string; sha256: string }; storageKeyFor: BlobStorageKeyFor },
  optional: { allowTrashTtl?: boolean } = {},
): JournalEntryVerdict {
  const defect = provenanceDefect(required.entry, required.storageKeyFor);
  if (defect !== null) return { verdict: "keep", why: defect };
  if (required.entry.reason === "upload-rollback") return { verdict: "keep", why: "upload-rollback" };
  if (required.entry.reason === "trash-ttl" && optional.allowTrashTtl !== true) return { verdict: "keep", why: "trash-ttl-disabled" };
  return { verdict: "candidate" };
}
