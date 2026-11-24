/**
 * @file Construction options for the disk-backed attachment store. The `AttachmentStore` port itself
 * is owned by `@jini-ai/core/contracts/site/daemon-http`.
 */
export interface CreateDiskAttachmentStoreOptions {
  /** Root directory this store owns outright — it is emptied on construction. */
  readonly uploadDirectory: string;
  /** Files per batch, i.e. per composer turn. Also caps one `claim()`. Defaults to 10. */
  readonly maxAttachments?: number;
  /** Total bytes per batch. Defaults to 50 MB. */
  readonly maxBatchBytes?: number;
  /** Tracked files across all batches. Defaults to 100. */
  readonly maxStoredAttachments?: number;
  /** Tracked bytes across all batches. Defaults to 200 MB. */
  readonly maxStoredBytes?: number;
  /** How long an unclaimed upload survives `pruneExpired`. Defaults to one hour. */
  readonly retentionMs?: number;
  /**
   * Adopts the uploads a previous process left behind instead of emptying the directory on
   * construction, so an attachment staged seconds before a restart is still there — and still
   * listable — afterwards.
   *
   * **Defaults to `false`, which is exactly this pack's pre-existing behavior.** Opting in is a
   * one-word change at the call site and reverting is deleting it; nothing about a store
   * constructed without this option differs in any way from before the option existed.
   *
   * Adoption is authenticated, not blind: see {@link loadPersistedAttachments}.
   */
  readonly retainAcrossRestarts?: boolean;
}
