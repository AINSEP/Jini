import type { AdminCommentRepo, AdminCommentRepoFactory } from '../../../core/ports/comment-repo.js';
import type { AdminComment, AdminCommentsPort } from '../../../core/ports/comments.js';
import { createMemoryCommentsApi } from '../../adapters/memory.js';

/**
 * @file A fake of `AdminCommentRepo` for the memory adapter's tests: the three operations over an in-memory list, with the
 * behaviours the adapter relies on (keyset paging that survives its marker leaving the status, a version compare-and-set and
 * purge). Written from the port's contract, so admin's tests no longer import the comments domain's repository.
 */
type Row = AdminComment & { workspaceId: string };

// The adapter seeds whole comments with their workspace filled in; the guard checks the fields this fake reads.
const isRow = (value: unknown): value is Row => {
  const row = value as Partial<Row> | null;
  return typeof row === 'object' && row !== null && typeof row.id === 'string' && typeof row.workspaceId === 'string'
    && typeof row.status === 'string' && typeof row.version === 'number' && typeof row.createdAt === 'string';
};
const before = (a: Row, b: Row): number => (a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt.localeCompare(b.createdAt));

/** The keyset cursor names the last row's position, not a row to look up. */
const encode = ({ createdAt, id }: Row): string => `${createdAt}::${id}`;
function decode({ cursor }: { cursor: string }): { createdAt: string; id: string } {
  const at = cursor.indexOf('::');
  if (at < 0 || at + 2 >= cursor.length) throw new Error('invalid cursor');
  return { createdAt: cursor.slice(0, at), id: cursor.slice(at + 2) };
}

export const fakeCommentRepo = ({ initialComments }: { initialComments: readonly unknown[] }): AdminCommentRepo => {
  const rows: Row[] = initialComments.filter(isRow).map((row) => ({ ...row }));
  return {
    async listModerationQueue({ workspaceId, status, limit, cursor }) {
      const scoped = rows.filter((row) => row.workspaceId === workspaceId && row.status === status).sort(before);
      const marker = cursor ? decode({ cursor }) : null;
      const start = marker ? scoped.filter((row) => row.createdAt < marker.createdAt || (row.createdAt === marker.createdAt && row.id.localeCompare(marker.id) <= 0)).length : 0;
      const items = scoped.slice(start, start + limit);
      const last = items.at(-1);
      return { items, nextCursor: start + limit < scoped.length && last ? encode(last) : null };
    },
    async applyModeration({ workspaceId, id, expectedVersion, toStatus, at }) {
      const index = rows.findIndex((row) => row.workspaceId === workspaceId && row.id === id);
      const current = rows[index];
      if (!current) return { ok: false, reason: 'not-found' };
      if (current.version !== expectedVersion) return { ok: false, reason: 'conflict', currentVersion: current.version };
      rows[index] = { ...current, status: toStatus, updatedAt: at, version: current.version + 1 };
      return { ok: true };
    },
    async purge({ workspaceId, id }) {
      const index = rows.findIndex((row) => row.workspaceId === workspaceId && row.id === id);
      if (index < 0) return { ok: false, reason: 'not-found' };
      rows.splice(index, 1);
      return { ok: true };
    },
  };
};
export const fakeCommentRepoFactory: AdminCommentRepoFactory = (required) => fakeCommentRepo(required);

/** `createMemoryCommentsApi` over the fake repository: what every adapter test builds its API from. */
export function memoryCommentsApi(
  required: Omit<Parameters<typeof createMemoryCommentsApi>[0], 'repoFactory'>,
  optional: Parameters<typeof createMemoryCommentsApi>[1] = {},
): AdminCommentsPort {
  return createMemoryCommentsApi({ ...required, repoFactory: fakeCommentRepoFactory }, optional);
}
