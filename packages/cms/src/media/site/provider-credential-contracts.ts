import type { ISODateTime, UUID } from "@jini-ai/core/primitives";
import type { SealedSecret } from "@jini-ai/core/contracts/vault";
import type { VaultRepoPort } from "@jini-ai/core/contracts/vault";
type VaultPutRecord = Parameters<VaultRepoPort["put"]>[0]["record"];


/**
 * @file Per-workspace media-generation vendor credentials — what the admin's Media → "Media
 * providers" tab reads and writes. Backs the `MediaProvidersPort` contract in `@jini-ai/ui`
 * (`features/media-providers/ports.ts`), whose two methods this file's two functions answer.
 *
 * WORKSPACE-scoped, not per-principal like `assistant/execution-credential-store.ts`: generation
 * spends real money and publishes assets site-wide, so the install holds one vendor roster. See
 * `db/schema.sqlite.ts`'s `mediaProviderCredentials` header for the full reasoning.
 *
 * Two functions, matching the port exactly:
 * - {@link getMediaProviderCredentials} — read model only. Never decrypts (`keyTail` is a plain
 *   column computed at write time), so it cannot fail on a misconfigured site key.
 * - {@link saveMediaProviderCredentials} — WHOLE-MAP REPLACE, including deletion. The tab's
 *   `saveMediaProviders` sends its entire local map and treats an absent provider as a tombstone
 *   (see `useMediaProvidersTab`'s `flushNow`), so a provider missing from the payload must be
 *   deleted here, not merely left alone.
 *
 * Neither function ever returns key material. The response carries only `apiKeyConfigured` and
 * `apiKeyTail`, which is the "markers" half of the two-kinds-of-present distinction
 * `@jini-ai/ui`'s `types.ts` documents.
 *
 * {@link resolveMediaProviderCredential} — added 2026-09-02 for `media-generation/tool-registrations.ts`'s
 * `media_generate_asset`, the first real decrypting reader this table has ever had. Mirrors
 * `custom-credentials/store.ts`'s own `resolveCustomCredentialByLabel` exactly.
 *
 * Jini binds the workspace and vault identity before opening sealed JSON. Legacy AAD handling
 * lives exclusively in boot normalization/recovery; feature reads never try a legacy fallback.
 */

/** One provider's stored credential row. `sealed`/`keyTail` are both-null or both-set, enforced by
 *  the table's own CHECK — a row may legitimately hold only `baseUrl`/`model` with no key yet. */
export interface MediaProviderCredentialRecord {
  /** Private adapter context; non-enumerable and never part of the view. */
  readonly vaultRecord?: VaultPutRecord;
  workspaceId: UUID;
  providerId: string;
  baseUrl: string | null;
  model: string | null;
  sealed: SealedSecret | null;
  /** Safe last four characters, withheld for short/unknown-length tokens. */
  keyTail: string | null;
  /** Compatibility marker: 1 for a vault envelope, 0 for no envelope. Legacy versions are
   * normalized at boot; the Jini service alone determines AAD for all normal reads. */
  aadVersion: number;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}


/** Every write one whole-map replace performs, derived from the rows the replace itself just read. */
export interface MediaProviderCredentialReplacePlan {
  /** Rows to write, in submission order. Already merged against the rows the planner was handed. */
  upserts: readonly MediaProviderCredentialRecord[];
  /** Ids to delete — providers the payload omitted. May be empty. */
  tombstoneProviderIds: readonly string[];
}


/**
 * Turns the workspace's CURRENT rows into the writes that replace them.
 *
 * MUST be synchronous and free of I/O. That is the whole point: `replaceWorkspace` invokes this
 * between its own read and its own writes, inside an open transaction, so a planner that awaited
 * anything would hand the event loop back mid-transaction — which is precisely the defect this
 * signature exists to make unrepresentable (see {@link MediaProviderCredentialRepoPort.replaceWorkspace}).
 * The return type is not a promise, so an `async` planner cannot type-check.
 */
export type MediaProviderCredentialReplacePlanner = (
  required: { existing: readonly MediaProviderCredentialRecord[] },
  optional?: Record<string, never>
) => MediaProviderCredentialReplacePlan;


/** Workspace-scoped persistence for {@link MediaProviderCredentialRecord} (ADR-007 §1). Multi-row
 *  per workspace, unlike the two single-row credential stores, so the port needs a list read and a
 *  bulk delete rather than a single find and a `clearKey`. */
export interface MediaProviderCredentialRepoPort {
  readonly vault?: VaultRepoPort;
  listByWorkspaceId(required: { workspaceId: UUID }): Promise<MediaProviderCredentialRecord[]>;
  upsert(record: MediaProviderCredentialRecord): Promise<void>;
  /** Idempotent: ids with no row are skipped, not an error. A no-op on an empty list. */
  deleteByProviderIds(input: { workspaceId: UUID; providerIds: readonly string[] }): Promise<void>;
  /**
   * READ-PLAN-WRITE for the whole workspace, as one atomic unit: reads the workspace's current
   * rows, calls `plan` with them, then applies that plan's upserts and tombstone deletes. Commits
   * iff every step succeeds; rolls back and rethrows if `plan` throws or any write fails.
   *
   * The read lives INSIDE the boundary on purpose. `saveMediaProviderCredentials` merges each
   * submitted entry against the stored row (an entry with no `apiKey` keeps the stored key, and
   * `createdAt` is preserved), so a read taken before the boundary opens can be stale by the time
   * the merge is written: a concurrent rotation landing in that window would be silently reverted
   * by a metadata-only save that re-wrote the key it had read a moment earlier.
   *
   * `plan` is synchronous by type, which is the second half of the fix — see
   * {@link MediaProviderCredentialReplacePlanner}. Everything that must await (sealing a new key)
   * happens before this method is called.
   *
   * Not reentrant — callers invoke this exactly once, at the outermost level of their own body.
   *
   * @returns the rows written, with authoritative hints and private vault context.
   */
  replaceWorkspace(input: {
    workspaceId: UUID;
    plan: MediaProviderCredentialReplacePlanner;
  }): Promise<readonly MediaProviderCredentialRecord[]>;
}
