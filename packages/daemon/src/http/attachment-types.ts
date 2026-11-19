


/**
 * A staged upload as it crosses the wire and as `claim()` returns it.
 *
 * Deliberately declared here rather than imported from `@jini-ai/chat/core`, whose `ChatAttachment`
 * this mirrors field-for-field: the same reason `media.ts` declares its own `MediaTask`/
 * `MediaDispatchEngine` port types instead of depending on `@jini-ai/media`. A transport package
 * should not acquire a dependency on a *domain* package (`jini.domain: "chat"`) to describe an
 * upload that has nothing chat-specific about it. `attachments.test.ts` holds a compile-time
 * assignability check in both directions against the real `ChatAttachment`, so the mirror cannot
 * silently drift — the drift risk is paid for with a test rather than with a dependency edge.
 *
 * `path` means two different things at two different times, on purpose:
 * - as returned by `register()` / over the wire: an opaque `attachment:<uuid>` capability id;
 * - as returned by `claim()`: the real absolute filesystem path, server-side only.
 */
export interface StoredAttachment {
  path: string;
  name: string;
  kind: 'image' | 'file';
  size?: number;
  /**
   * User-visible ordering for the turn that carries this attachment. Present for exact structural
   * parity with `ChatAttachment`; this store never sets it, because display ordering is the
   * renderer's concern and nothing here would be able to reconstruct it.
   */
  order?: number;
}

/** What `claim()` hands back: trusted paths plus the one directory an agent may be granted. */
export interface AttachmentClaim {
  attachments: StoredAttachment[];
  /** Absent only for an empty claim — there is no directory to grant when nothing was claimed. */
  batchDirectory?: string;
}

/**
 * Registers, validates, and expires uploads staged for a run. `createDiskAttachmentStore` is the
 * implementation this package ships; a host with its own storage (object store, tmpfs, a quota
 * system of its own) can satisfy this port instead and keep the route pack.
 */
export interface AttachmentStore {
  /** Creates (idempotently) the private directory that holds one batch's files. */
  createBatchDirectory: ({ batchId }: { readonly batchId: string }, _optional?: Record<string, never>) => Promise<string>;
  /**
   * Takes ownership of an already-written file and returns its opaque capability record. Rejects —
   * and deletes the file — if it is not a canonical regular file directly inside its batch
   * directory, or if any quota would be exceeded.
   */
  register: (requiredArgs: {
    readonly input: {
      batchId: string;
      path: string;
      name: string;
      kind: StoredAttachment['kind'];
      size: number;
      /** See `AttachmentRecord.ownerId`'s own doc. Omitted by a host with no owner concept. */
      ownerId?: string;
    }
  }, optionalArgs?: Record<string, never>) => Promise<StoredAttachment>;
  /** Exchanges capability ids for real paths, exactly once, binding them to `runId`. */
  claim: ({ attachments, runId }: { readonly attachments: readonly StoredAttachment[]; readonly runId: string }, _optional?: Record<string, never>
  ) => Promise<AttachmentClaim>;
  /**
   * Resolves ONE still-known attachment to its real path for `runId`, without the "exactly once
   * across the whole batch" shape `claim()` has — the read-side counterpart for a caller that wants
   * to look up a single attachment it may or may not already own, rather than atomically reserving a
   * batch at run start.
   *
   * `ref` accepts either identifier a caller may actually be holding: the opaque `attachment:<uuid>`
   * capability id `register()` returned, or the real absolute path this run was already told about.
   * Both resolve to the same record. This dual form exists because `@jini-ai/daemon`'s
   * `image-prompt-delivery.ts` narrates the resolved PATH into the run's prompt text for an
   * already-claimed attachment — never the id — so a caller built from that prompt has the path, not
   * the id; a caller with the id (from the original upload response) can still use it directly.
   * Exact paths issued by `stageAttachmentClaim()` for this store's claim also resolve to the
   * original record, with the same run-ownership and integrity checks. Staging cleanup revokes
   * those aliases. No basename inference or caller-supplied filesystem path is read.
   *
   * Ownership is enforced here, which is new: an attachment nobody has claimed yet is claimed for
   * `runId` on this call (identical effect to `claim()`, same integrity re-check); an attachment
   * already claimed BY `runId` is simply re-verified and returned again (idempotent — a run may look
   * this up more than once); an attachment claimed by any OTHER run throws the same
   * `'attachment-unknown-or-claimed'` rejection `claim()` uses for a genuinely unknown id, so a
   * caller cannot distinguish "no such attachment" from "a different run owns this" — the same
   * non-disclosure `claim()` already practices for its own rejections. This is the run-ownership
   * check `claim()`'s own FIRST reservation does not have (see this module's trust-model doc on the
   * deliberate capability-bearer model for a brand-new claim); `resolveForRun` adds it for every
   * lookup made through this method, so a second run/session on this same daemon can never read an
   * attachment already bound to someone else's run by calling this method with a guessed or
   * overheard `ref`.
   *
   * Returns `undefined` only for a `ref` this store has never heard of (never uploaded, or its
   * record was already deleted by `cleanupRun`/`pruneExpired`/`dispose`).
   */
  resolveForRun: ({ ref, runId }: { readonly ref: string; readonly runId: string }, _optional?: Record<string, never>) => Promise<StoredAttachment | undefined>;
  /**
   * Lists unclaimed attachments registered with `ownerId`, plus attachments claimed by optional
   * `runId` when supplied — the discovery counterpart to
   * `resolveForRun`'s single-lookup: a caller that does not yet hold a specific ref at all (an
   * attachment uploaded in an earlier turn, never named in this run's prompt) has no id to look up
   * with `resolveForRun` in the first place. This is what makes that attachment findable.
   *
   * **This is the one method in this port that widens the trust model documented at the top of this
   * file.** `register()`/`claim()`/`resolveForRun` all work from a caller-supplied opaque id or path
   * — the "you must already hold the unguessable capability" property that makes an unauthenticated
   * `claim()` first-reservation safe. A listing necessarily hands back ids the caller never held, so
   * it can only be safe if it is scoped to something the caller is actually entitled to — here, the
   * same principal id a host recorded via `register()`'s `ownerId` for the ORIGINAL upload request.
   *
   * Two things make that scoping real rather than decorative:
   * - an attachment registered with NO `ownerId` (a host that never wired `resolveOwnerId`, or any
   *   attachment from before this method existed) is excluded from every caller's results, never
   *   just "unscoped" — this method is not callable with `ownerId: undefined`, so there is no input
   *   that could accidentally match an ownerless record;
   * - a claimed attachment is excluded unless the host supplies that exact claiming `runId` in
   *   the optional argument. Hosts must derive ownerId/runId from authenticated execution context,
   *   never tool input. Run startup claims ALL message attachments before tools execute; including
   *   that run's claims keeps image, video and generic file discovery available after delivery.
   *   Owner matching remains mandatory even for the matching run. Without runId, the original
   *   unclaimed-only behavior is unchanged. Listing never claims, releases, or reads a file; callers
   *   still use `resolveForRun` for integrity-checked bytes/promotion.
   *
   * What this does NOT scope by: batch, conversation, or run — none of those are recorded on an
   * `AttachmentRecord` today (except run ownership once claimed). Hosts restricting discovery to
   * an accepted message must also intersect these summaries with that message's refs. Without that
   * intersection, two different conversations run by the SAME `ownerId` will each see
   * the other's pending attachments through this method. A host for whom that is too wide needs a
   * finer-grained id than `ownerId` to pass into `register()` — this method does not itself assume
   * `ownerId` means "one admin account" rather than "one conversation, one composer, one browser
   * tab"; it only assumes the host's `ownerId` is something the CALLER of this method is authorized
   * to see everything under.
   *
   * Sorted oldest-first (`createdAt` ascending) — arrival order, matching how a person would expect
   * to review what is waiting.
   *
   * @complexity O(n) in the number of tracked records (bounded by `maxStoredAttachments`), matching
   * every other method on this port.
   */
  listPendingForOwner: ({ ownerId }: { readonly ownerId: string }, optional?: { readonly runId?: string }) => Promise<PendingAttachmentSummary[]>;
  /** Deletes the named still-unclaimed uploads, then the batch directory if it is now empty. */
  deleteUnclaimed: ({ batchId, paths }: { readonly batchId: string; readonly paths: readonly string[] }, _optional?: Record<string, never>) => Promise<void>;
  /** Deletes everything `runId` claimed. Safe to call for a run that claimed nothing. */
  cleanupRun: ({ runId }: { readonly runId: string }, _optional?: Record<string, never>) => Promise<void>;
  /** Deletes unclaimed uploads older than the retention window. */
  pruneExpired: (_required: Record<string, never>, optionalArgs?: { readonly now?: number | undefined }) => Promise<void>;
  /** Deletes every tracked upload. For host shutdown. */
  dispose: () => Promise<void>;
}

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

export interface AttachmentRecord {
  id: string;
  filePath: string;
  name: string;
  kind: StoredAttachment['kind'];
  size: number;
  batchId: string;
  batchDirectory: string;
  dev: number;
  ino: number;
  /** Absent only for legacy sidecars; filled after their first successful integrity check. */
  mtimeMs?: number;
  ctimeMs?: number;
  createdAt: number;
  claimedRunId?: string;
  /**
   * The principal a host's `AttachmentsHttpDeps.resolveOwnerId` reported for the request that
   * registered this attachment. Absent when the host supplies no `resolveOwnerId` (this pack's
   * behavior before ownership existed), which is why `listPendingForOwner` treats an absent
   * `ownerId` as "cannot be scoped" rather than as a wildcard match — see that method's own doc.
   */
  ownerId?: string;
}

/**
 * What `listPendingForOwner` hands back for an unclaimed or same-run claimed attachment: enough for a caller to
 * show a person what is waiting, and to name it again (`ref`) to `claim()`/`resolveForRun`.
 */
export interface PendingAttachmentSummary {
  /** The same opaque `attachment:<uuid>` id `register()` returned over the wire. */
  ref: string;
  name: string;
  kind: StoredAttachment['kind'];
  size: number;
  /** `Date.now()` at registration — when the file arrived, not when it was looked up. */
  createdAt: number;
}
