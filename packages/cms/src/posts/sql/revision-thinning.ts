import type { CleanupPreviewStore } from "@jini-ai/core/contracts/storage";
import { createRevisionThinning } from "../revision-thinning.js";
import type { StorageKernel } from "@jini-ai/core/contracts/storage";
import type { Kysely } from "kysely";
import { requireInputRecord, ToolInputError, type ApprovalSteps, type ToolExecutionContext, type ToolHandler } from "@jini-ai/core";
import type { AssistantSurfaceDeps } from "@jini-ai/core/contracts/site/daemon-surface-exchanges";
import type { HumanConfirmSpec } from "@jini-ai/core/contracts/site/human-confirm";

type ContentKernel = StorageKernel<Kysely<unknown>, unknown>;
type ContentTables = {
  posts: { workspace_id: string; id: string; status: string; version: number };
  post_revisions: { workspace_id: string; post_id: string; id: string; seq: number; recorded_at: string; restored_from: string | null; state_json: string };
  change_sets: { id: string; workspace_id: string; status: string };
  change_set_items: { id: string; change_set_id: string; entity_id: string; before_revision_id: string | null; after_revision_id: string | null; inverse_payload_json: string | null };
};
/**
 * @file Host adapter for Jini's revision-thinning engine over `post_revisions`: a date-only
 * preview of ONE post or page, then an owner-confirmed apply that deletes at most the contiguous,
 * unprotected oldest run of snapshots under the post's revision fence ({@link postRevisionLockKey}).
 *
 * DISABLED (STOP 6): nothing registers this on a schedule or in the agent catalog. The pieces here
 * are only reachable through an explicit owner preview + confirm (route) or approval card (tool).
 * Activation waits until every reference writer (publish, restore, undo/change-set items) shares the
 * fence or has transactionally equivalent protection.
 *
 * `previousId` is NOT a column: `appendRevision` computes it at append time from the latest row by
 * `seq` and hands it to the change-set item, so thinning has no survivor row to "relink" — and must
 * not invent one. Survivors read exactly as before; the gap is visible as missing `seq` values.
 */

export type RevisionThinningScope = { workspaceId: string; postId: string; kind: string };
/** The revision row a reference probe sees, read from the table at apply time. */
export type ThinnedRevision = { id: string; seq: number; recordedAt: string; restoredFrom: string | null };
/** True when something outside `post_revisions` still points at this revision. A throw keeps it. */
export type RevisionRefProbe = (required: { scope: RevisionThinningScope; revision: ThinnedRevision }, optional?: Record<string, never>) => Promise<boolean>;

export interface RevisionThinningRequired {
  postRevisionLockKey: (scope: RevisionThinningScope, optional: Record<string, never>) => string;
  kernel: ContentKernel;
  /** The revision a published post currently serves (or a scheduled publish will). */
  publishedRefs: RevisionRefProbe;
  /** A revision a pending restore (Trash, version history) would read back. */
  restoreRefs: RevisionRefProbe;
  /** A revision a change-set item (`before_revision_id`/`after_revision_id`) or undo names. */
  undoRefs: RevisionRefProbe;
  previewStore: CleanupPreviewStore;
  /** Epoch ms; a cutoff date in the future is refused. */
  clock: () => number;
  /** Owner-only; throws to refuse. */
  authorize: (required: { principal: string; scope: RevisionThinningScope }) => Promise<void>;
}

const SCOPE_ERROR = "Choose one workspace and one post or page.";
const DATE_ERROR = "Choose a past date (YYYY-MM-DD) to thin revisions recorded before it.";

/** The cutoff as epoch ms at UTC midnight of a `YYYY-MM-DD` day no later than today. */
function readCutoff({ before, now }: { before: unknown; now: number }): number {
  const day = typeof before === "string" && /^\d{4}-\d{2}-\d{2}$/.test(before) ? Date.parse(`${before}T00:00:00.000Z`) : Number.NaN;
  if (!Number.isFinite(day) || day > now) throw new Error(DATE_ERROR);
  return day;
}

type Row = { id: string; seq: number; recorded_at: string; restored_from: string | null };
const toRevision = (row: Row): ThinnedRevision => ({ id: row.id, seq: row.seq, recordedAt: row.recorded_at, restoredFrom: row.restored_from });

/** The `revisions` port over the kernel. Reads are oldest-first by `seq` (then `recorded_at`, `id`
 *  so equal `seq` rows from a pre-fix rollback still have one order) and stop at the first row on
 *  or after the cutoff, so the run is contiguous even if a clock went backwards. */
function revisionsPort({ kernel, postRevisionLockKey }: Pick<RevisionThinningRequired, "kernel" | "postRevisionLockKey">, _optional = {}) {
  type Db = Parameters<Parameters<ContentKernel["run"]>[0]>[0];
  const rows = (db: Db, scope: RevisionThinningScope) => db.withTables<ContentTables>().selectFrom("post_revisions").select(["id", "seq", "recorded_at", "restored_from"])
    .where("workspace_id", "=", scope.workspaceId).where("post_id", "=", scope.postId);
  return {
    withPostLock: ({ scope, run }: { scope: RevisionThinningScope; run: () => Promise<void> }) =>
      kernel.transaction(async () => { await kernel.lockKey(postRevisionLockKey(scope, {})); await run(); }),
    listOldest: async ({ scope, olderThan, limit }: { scope: RevisionThinningScope; olderThan: number; limit: number }) => {
      const oldest = await kernel.run((db) => db.withTables<ContentTables>().selectFrom("post_revisions").select(["id", "recorded_at"])
        .where("workspace_id", "=", scope.workspaceId).where("post_id", "=", scope.postId)
        .orderBy("seq", "asc").orderBy("recorded_at", "asc").orderBy("id", "asc").limit(limit).execute());
      const end = oldest.findIndex((row) => !(Date.parse(row.recorded_at) < olderThan));
      return (end === -1 ? oldest : oldest.slice(0, end)).map((row) => ({ id: row.id }));
    },
    newestId: async ({ scope }: { scope: RevisionThinningScope }) => {
      const newest = await kernel.run((db) => db.withTables<ContentTables>().selectFrom("post_revisions").select("id")
        .where("workspace_id", "=", scope.workspaceId).where("post_id", "=", scope.postId)
        .orderBy("seq", "desc").orderBy("recorded_at", "desc").orderBy("id", "desc").limit(1).executeTakeFirst());
      return newest?.id ?? null;
    },
    deleteIds: async ({ scope, ids }: { scope: RevisionThinningScope; ids: readonly string[] }) => {
      await kernel.run((db) => db.withTables<ContentTables>().deleteFrom("post_revisions").where("workspace_id", "=", scope.workspaceId)
        .where("post_id", "=", scope.postId).where("id", "in", [...ids]).execute());
    },
    readRow: async ({ scope, id }: { scope: RevisionThinningScope; id: string }) => {
      const row = await kernel.run((db) => rows(db, scope).where("id", "=", id).executeTakeFirst());
      if (!row) throw new Error("revision vanished under the fence");
      return toRevision(row as Row);
    },
    isRestoredFrom: async ({ scope, id }: { scope: RevisionThinningScope; id: string }) =>
      (await kernel.run((db) => rows(db, scope).where("restored_from", "=", id).limit(1).executeTakeFirst())) !== undefined,
  };
}

/** The scope's kind must match the newest snapshot's own `kind`, so a page is never thinned as a post. */
async function requireScope({ kernel, scope }: { kernel: ContentKernel; scope: Partial<RevisionThinningScope> | undefined }): Promise<RevisionThinningScope> {
  if (!scope?.workspaceId || !scope.postId || (scope.kind !== "post" && scope.kind !== "page")) throw new Error(SCOPE_ERROR);
  const newest = await kernel.run((db) => db.withTables<ContentTables>().selectFrom("post_revisions").select("state_json").where("workspace_id", "=", scope.workspaceId!)
    .where("post_id", "=", scope.postId!).orderBy("seq", "desc").limit(1).executeTakeFirst());
  const kind = newest ? (JSON.parse(newest.state_json) as { kind?: string }).kind ?? "post" : undefined;
  if (kind !== scope.kind) throw new Error(SCOPE_ERROR);
  return { workspaceId: scope.workspaceId, postId: scope.postId, kind: scope.kind };
}

/**
 * Binds Jini's engine to this site's `post_revisions`. Each protection reads the row's actual
 * `seq`, `recorded_at` and `restored_from` under the fence before asking the host's probes.
 * @complexity preview O(limit); apply O(limit) rows, up to 4 probes each, one batched delete.
 */
export function bindRevisionThinning(required: RevisionThinningRequired, _optional: Record<string, never> = {}) {
  const { kernel, publishedRefs, restoreRefs, undoRefs, previewStore, clock, authorize } = required;
  const revisions = revisionsPort({ kernel, postRevisionLockKey: required.postRevisionLockKey });
  const probe = (refs: RevisionRefProbe) => async ({ scope, id }: { scope: RevisionThinningScope; id: string }) =>
    refs({ scope, revision: await revisions.readRow({ scope, id }) }, {});
  const engine = createRevisionThinning({
    revisions, previewStore, clock,
    protections: { isPublished: probe(publishedRefs), isRestoreTarget: probe(restoreRefs), isRestoredFrom: revisions.isRestoredFrom, isUndoReferenced: probe(undoRefs) },
  });
  return {
    async preview({ principal, scope, before }: { principal: string; scope: Partial<RevisionThinningScope>; before: unknown }, _options: Record<string, never> = {}) {
      const bound = await requireScope({ kernel, scope });
      await authorize({ principal, scope: bound });
      return engine.preview({ principal, scope: bound, olderThan: readCutoff({ before, now: clock() }) }, {});
    },
    async apply({ principal, scope, previewToken, confirm }: { principal: string; scope: Partial<RevisionThinningScope>; previewToken: string; confirm: boolean }, _options: Record<string, never> = {}) {
      const bound = await requireScope({ kernel, scope });
      await authorize({ principal, scope: bound });
      return engine.apply({ principal, scope: bound, previewToken, confirm }, {});
    },
  };
}

export type RevisionThinningBinding = ReturnType<typeof bindRevisionThinning>;
type Prepared = { scope: RevisionThinningScope; count: number; previewToken: string };

/**
 * The agent tool body: explicit preview in `prepare`, an owner approval card, then apply with the
 * previewed token. No `rememberKey`: every thinning permanently deletes history, so it always asks.
 * Not registered in the catalog while thinning is disabled (STOP 6).
 */
export function revisionThinningApprovalHandler(
  { binding, surfaces, workspaceId, approvalToolHandler, thinningCard }: {
    binding: RevisionThinningBinding; surfaces: AssistantSurfaceDeps; workspaceId: string;
    thinningCard: (required: { prepared: Prepared }) => HumanConfirmSpec;
    approvalToolHandler(required: {
      surfaces: AssistantSurfaceDeps;
      prepare: ApprovalSteps<Prepared, HumanConfirmSpec>["prepare"];
      describe: (required: { ctx: ToolExecutionContext; prepared: Prepared }) => HumanConfirmSpec | Promise<HumanConfirmSpec>;
      run: ApprovalSteps<Prepared, HumanConfirmSpec>["run"];
    }, optional: { flag: string; ask: (required: { prepared: Prepared }) => boolean }): ToolHandler;
  },
  _optional: Record<string, never> = {},
): ToolHandler {
  return approvalToolHandler({ surfaces,
    prepare: async ({ ctx }) => {
      const input = requireInputRecord({ input: ctx.input });
      const scope = { workspaceId, postId: input.postId as string, kind: input.kind as string };
      const preview = await binding.preview({ principal: ctx.principal.id, scope, before: input.before }, {}).catch((error: unknown) => {
        throw new ToolInputError({ message: error instanceof Error ? error.message : "Revision thinning refused." });
      });
      return { scope, count: preview.count, previewToken: preview.previewToken };
    },
    describe: thinningCard,
    run: async ({ ctx, prepared }) => ({ thinned: true, ...await binding.apply({ principal: ctx.principal.id, scope: prepared.scope, previewToken: prepared.previewToken, confirm: true }, {}) }),
  }, { flag: "thinned", ask: ({ prepared }) => prepared.count > 0 });
}

export function thinningCard({ prepared }: { prepared: Prepared }, _optional: Record<string, never> = {}): HumanConfirmSpec {
  return { toolId: "post_thin_revisions", errorCode: "POST", title: `Delete up to ${prepared.count} old revision${prepared.count === 1 ? "" : "s"} of this ${prepared.scope.kind}?`,
    details: [{ label: "Revisions in preview", value: String(prepared.count) }],
    warning: "This cannot be undone. The newest revision and any revision that is published, restorable or needed for undo is kept, and thinning stops there.",
    confirmLabel: "Delete old revisions" };
}

