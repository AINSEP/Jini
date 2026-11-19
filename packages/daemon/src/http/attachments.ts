/**
 * @module attachments
 *
 * `POST /api/attachments`, `DELETE /api/attachments` — an HTTP route pack for user file/image
 * uploads staged for one agent run, over a narrow, transport-owned `AttachmentStore` port plus a
 * batteries-included disk implementation (`createDiskAttachmentStore`).
 *
 * **The capability this closes.** A chat composer that accepts drag-and-drop needs somewhere to put
 * the bytes, a way to hand the agent a path it is actually allowed to read, and a guarantee that
 * those bytes disappear when the run ends. That is three separate concerns (an upload endpoint, a
 * trusted-metadata registry, and a run-scoped lifetime) which every host would otherwise hand-roll.
 * This module owns all three; `@jini-ai/chat-react`'s `createDaemonAttachmentUploader` is the
 * matching client half.
 *
 * **Trust model.** A renderer supplies bytes, a filename, and a batch id. None of that is trusted:
 * - the filename is reduced to a basename over a conservative character allowlist
 *   (`sanitizeAttachmentName`) and is only ever used as *display* text plus a short extension
 *   suffix — never as the stored filename, which is a fresh `randomUUID()`;
 * - the `kind` (`'image' | 'file'`) is sniffed from the leading bytes (`detectAttachmentKind`),
 *   never taken from a renderer-controlled MIME type or file extension;
 * - the byte count is measured while streaming, never read from a client-supplied length;
 * - the returned `path` is an opaque `attachment:<uuid>` capability id, not a filesystem path, so a
 *   renderer never learns where the upload root is and cannot name a file it did not upload.
 *   `claim()` is what exchanges those ids for real paths, server-side.
 *
 * **What `claim()` guarantees.** Exactly once per registered attachment, and only if the file is
 * still the same file: `lstat` must report a regular non-symlink whose `dev`/`ino`/`size` and
 * recorded modification/change timestamps match, and `realpath` must equal the recorded path
 * (so neither the file nor any parent directory was swapped for a symlink between upload and run
 * start). Legacy sidecars establish their timestamp baseline on first verified read. Every
 * claimed attachment must belong to one batch, so the single `batchDirectory` a host grants the
 * agent read access to cannot be widened by mixing batches.
 *
 * **Ownership is opt-in and host-attached, not self-asserted.** `register()`'s optional `ownerId`
 * (and `listPendingForOwner`, the discovery method it enables) is never read from anything a
 * renderer sends — a host wires `AttachmentsHttpDeps.resolveOwnerId` to pull it from a channel IT
 * already trusts (its own session-verified principal header, say), never from `req` unauthenticated.
 * A store with no `resolveOwnerId` wired registers every attachment ownerless, and
 * `listPendingForOwner` never returns an ownerless record for any caller — see that method's own doc
 * for why an absent `ownerId` must never become a wildcard match.
 *
 * **Storage lifetime is daemon-lifetime by default, and opt-in restart-surviving.** With
 * `retainAcrossRestarts` left off (the default, and this pack's only behavior before that option
 * existed), `createDiskAttachmentStore` empties its upload directory on construction: files left
 * behind by an interrupted previous process cannot be authenticated against an in-memory registry
 * that no longer exists, so they are removed rather than adopted. Unclaimed uploads also expire by
 * TTL (`pruneExpired`), and a run's claimed files are deleted by `cleanupRun`.
 *
 * That default is wrong for any host whose process restarts while a person is still using the
 * composer. A file-watching dev server restarting the daemon on an unrelated source edit is not a
 * crash, but the construction wipe cannot tell the two apart, so it destroys uploads the user is
 * about to send — real data loss, not a tidy-up. `retainAcrossRestarts: true` replaces "wipe
 * everything, always" with "adopt exactly what can still be authenticated": see
 * {@link prepareAttachmentStorage} for the whole mechanism and {@link loadPersistedAttachments} for
 * why an adopted record is no less trusted than one this process registered itself.
 *
 * **This pack does not auto-wire itself into a run's lifecycle**, because no generic hook for that
 * exists — the same deliberate choice `@jini-ai/daemon`'s `createRunScopedContextStore` makes. A
 * host claims in its own `onRunStarted` and cleans up in a `finally`, roughly:
 *
 * ```ts
 * const store = await createDiskAttachmentStore({ uploadDirectory });
 * // ... httpExtensions: [(app, { adapter }) => registerAttachmentRoutes({ app, deps: { store }, adapter })]
 * onRunStarted: (context) => {
 *   void (async () => {
 *     try {
 *       const claimed = await store.claim({ attachments: attachmentRefsFrom(context.request), runId: context.run.id });
 *       await executor.run({
 *         runId: context.run.id,
 *         // ... prompt, cwd, agentId
 *       }, {
 *         ...(claimed.batchDirectory === undefined ? {} : {
 *           imagePaths: claimed.attachments.filter((a) => a.kind === 'image').map((a) => a.path),
 *           extraAllowedDirs: [claimed.batchDirectory],
 *           uploadRoot: claimed.batchDirectory,
 *         }),
 *       });
 *     } finally {
 *       await store.cleanupRun({ runId: context.run.id });
 *     }
 *   })();
 * }
 * ```
 *
 * `imagePaths`/`extraAllowedDirs`/`uploadRoot` are pre-existing `AgentExecutor.run()` options; this
 * module only produces real values for them.
 *
 * **Body-parser ordering (`POST` reads the raw request stream).** The upload route streams
 * `request` straight to disk, so any body-parsing middleware that has already consumed the stream
 * leaves nothing to write. The classic way to hit this is a JSON body parser mounted app-wide: a
 * user drops a `.json` file, the browser sets `content-type: application/json`, and
 * `express.json()` eats the body — which without a guard shows up as the deeply unhelpful
 * "attachment is empty". `attachmentUploadRoutes` detects an already-consumed stream up front (the host hands it no
 * body at all) and reports it as a host misconfiguration (`'attachment-body-consumed'`) instead of failing silently.
 * Mount this list before any global body parser, or scope the parser so it skips this path.
 *
 * **SEC-005 redaction**: a store failure can carry filesystem paths a caller must not see, so
 * anything that is not an explicitly-classified `AttachmentRejectedError` becomes a
 * correlation-id-bearing generic `INTERNAL_ERROR`, with the real error reaching a host-owned sink —
 * the same `reportInternalError` shape `media.ts`/`delegated-tools.ts` use.
 */
import type { CreateDiskAttachmentStoreOptions, AttachmentStore, AttachmentRecord } from './attachment-types.js';
import { mkdir, chmod, realpath } from 'node:fs/promises';
import { prepareAttachmentStorage } from './attachment-retention.js';
import { createAttachmentPersistence } from './attachment-sidecars.js';
import { createBatchDirectoryResolver, createAttachmentCreateBatchDirectoryMethod, createAttachmentRegisterMethod } from './attachment-registration.js';
import { createAttachmentRecordDeleter, createAttachmentDeleteUnclaimedMethod, createAttachmentCleanupRunMethod, createAttachmentPruneExpiredMethod, createAttachmentDisposeMethod } from './attachment-cleanup.js';
import { createAttachmentClaimMethod, createAttachmentResolveForRunMethod, createAttachmentListPendingForOwnerMethod } from './attachment-claims.js';


/**
 * The disk-backed `AttachmentStore` this package ships. Every default matches what a chat composer
 * needs out of the box; a host that wants different quotas passes them rather than reimplementing
 * the port.
 *
 * @complexity `register`/`claim` are O(n) in the number of tracked records (a small bounded number
 * — `maxStoredAttachments`), which is what keeps the quota decision synchronous; see `register`.
 */
export async function createDiskAttachmentStore(requiredArgs: Omit<CreateDiskAttachmentStoreOptions, 'maxAttachments' | 'maxBatchBytes' | 'maxStoredAttachments' | 'maxStoredBytes' | 'retentionMs' | 'retainAcrossRestarts'>, optionalArgs: Pick<CreateDiskAttachmentStoreOptions, 'maxAttachments' | 'maxBatchBytes' | 'maxStoredAttachments' | 'maxStoredBytes' | 'retentionMs' | 'retainAcrossRestarts'> = {}): Promise<AttachmentStore> {
  const {
    uploadDirectory,
    maxAttachments = 10,
    maxBatchBytes = 50 * 1024 * 1024,
    maxStoredAttachments = 100,
    maxStoredBytes = 200 * 1024 * 1024,
    retentionMs = 60 * 60 * 1_000,
    retainAcrossRestarts = false,
  }: CreateDiskAttachmentStoreOptions = { ...requiredArgs, ...optionalArgs };
  await mkdir(uploadDirectory, { recursive: true, mode: 0o700 });
  await chmod(uploadDirectory, 0o700);
  const canonicalUploadDirectory = await realpath(uploadDirectory);
  // Either empties the directory (the default — a file left by an interrupted previous process has
  // no record to authenticate it against) or adopts the previous process's authenticated survivors.
  // See `prepareAttachmentStorage`.
  const records = await prepareAttachmentStorage({ canonicalUploadDirectory, retainAcrossRestarts, retentionMs });
  const stagedPathsByRecord = new WeakMap<AttachmentRecord, Set<string>>();
  /** Only issued refs match; no caller-supplied path is opened. O(n) time for n stored records,
   * bounded by maxStoredAttachments, with no filesystem I/O. */
  const findRecord = ({ ref }: { readonly ref: string }, _optional: Record<string, never> = {}): AttachmentRecord | undefined =>
    records.get(ref) ?? [...records.values()].find((candidate) =>
      candidate.filePath === ref || stagedPathsByRecord.get(candidate)?.has(ref));
  const { persistRecord, forgetRecord } = createAttachmentPersistence(records, canonicalUploadDirectory, retainAcrossRestarts);
  const resolveBatchDirectory = createBatchDirectoryResolver(canonicalUploadDirectory);
  const deleteRecord = createAttachmentRecordDeleter(records, forgetRecord);
  return {
    createBatchDirectory: createAttachmentCreateBatchDirectoryMethod({ resolveBatchDirectory }),
    register: createAttachmentRegisterMethod({ resolveBatchDirectory, records, maxAttachments, maxBatchBytes, maxStoredAttachments, maxStoredBytes, persistRecord }),
    claim: createAttachmentClaimMethod({ records, maxAttachments, stagedPathsByRecord }),
    resolveForRun: createAttachmentResolveForRunMethod({ findRecord }),
    listPendingForOwner: createAttachmentListPendingForOwnerMethod({ records }),
    deleteUnclaimed: createAttachmentDeleteUnclaimedMethod({ resolveBatchDirectory, records, deleteRecord }),
    cleanupRun: createAttachmentCleanupRunMethod({ records, deleteRecord }),
    pruneExpired: createAttachmentPruneExpiredMethod({ records, deleteRecord, retentionMs }),
    dispose: createAttachmentDisposeMethod({ records, deleteRecord }),
  };
}
