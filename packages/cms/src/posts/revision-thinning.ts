import type { CleanupPreviewStore } from '@jini-ai/core/contracts/storage';

type RevisionScope = { workspaceId: string; postId: string; kind: string };
type RevisionProtections = Record<'isPublished' | 'isRestoreTarget' | 'isRestoredFrom' | 'isUndoReferenced', (required: { scope: RevisionScope; id: string }, optional: Record<string, never>) => Promise<boolean>>;

/** The name of the first protection that holds (or throws, which counts as holding), else `undefined`. */
async function firstProtection(
  { protections, scope, id }: { protections: RevisionProtections; scope: RevisionScope; id: string },
): Promise<string | undefined> {
  for (const name of ['isPublished', 'isRestoreTarget', 'isRestoredFrom', 'isUndoReferenced'] as const) {
    try {
      if (await protections[name]({ scope, id }, {})) return name;
    } catch { return name; }
  }
  return undefined;
}

export function createRevisionThinning(
  { revisions, protections, previewStore }: {
    revisions: {
      withPostLock(required: { scope: { workspaceId: string; postId: string; kind: string }; run: () => Promise<void> }, optional: Record<string, never>): Promise<void>;
      listOldest(required: { scope: { workspaceId: string; postId: string; kind: string }; olderThan: number; limit: number }, optional: Record<string, never>): Promise<readonly { id: string }[]>;
      newestId(required: { scope: { workspaceId: string; postId: string; kind: string } }, optional: Record<string, never>): Promise<string | null>;
      deleteIds(required: { scope: { workspaceId: string; postId: string; kind: string }; ids: readonly string[] }, optional: Record<string, never>): Promise<void>;
    };
    protections: Record<'isPublished' | 'isRestoreTarget' | 'isRestoredFrom' | 'isUndoReferenced', (required: { scope: { workspaceId: string; postId: string; kind: string }; id: string }, optional: Record<string, never>) => Promise<boolean>>;
    previewStore: CleanupPreviewStore; clock: () => number;
  }, { limit = 500 } = {},
) {
  return {
    async preview({ principal, scope, olderThan }: { principal: string; scope: { workspaceId: string; postId: string; kind: string }; olderThan: number }, _optional = {}) {
      if (!scope?.workspaceId || !scope.postId || !scope.kind) throw new Error('Choose one workspace and one post or page.');
      const rows = await revisions.listOldest({ scope, olderThan, limit }, {});
      const ids = rows.map(row => row.id);
      const token = previewStore.put({ principal, kind: 'revision-thinning', scope: JSON.stringify([scope.workspaceId, scope.postId, scope.kind]), payload: { ids, olderThan } }, {});
      return { ids, count: ids.length, previewToken: token.token };
    },
    async apply({ principal, scope, previewToken, confirm }: { principal: string; scope: { workspaceId: string; postId: string; kind: string }; previewToken: string; confirm: boolean }, _optional = {}) {
      if (!scope?.workspaceId || !scope.postId || !scope.kind) throw new Error('Choose one workspace and one post or page.');
      if (confirm !== true) throw new Error('Confirm the revision preview first.');
      const taken = previewStore.take({ principal, kind: 'revision-thinning', scope: JSON.stringify([scope.workspaceId, scope.postId, scope.kind]), token: previewToken }, {});
      if (!taken) throw new Error('The revision preview expired.');
      const confirmed = new Set(taken.payload.ids as string[]);
      const deleted: string[] = [], kept: { id: string; reason: string }[] = [];
      await revisions.withPostLock({ scope, run: async () => {
        const rows = await revisions.listOldest({ scope, olderThan: taken.payload.olderThan as number, limit }, {});
        const newest = await revisions.newestId({ scope }, {});
        for (const { id } of rows) {
          if (!confirmed.has(id) || id === newest) { kept.push({ id, reason: id === newest ? 'newest' : 'unconfirmed' }); break; }
          const reason = await firstProtection({ protections, scope, id });
          // A gap in protection stops thinning so later snapshots cannot jump over retained history.
          if (reason) { kept.push({ id, reason }); break; }
          deleted.push(id);
        }
        if (deleted.length) await revisions.deleteIds({ scope, ids: deleted }, {});
      } }, {});
      return { deleted, kept };
    },
  };
}
