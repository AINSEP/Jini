import { expect, it, vi } from 'vitest';
import type { PlannedDiskFile } from '../sources.js';
import { commitBackupPlan, initialPushProgress, uploadBackupPlan } from '../push-content.js';

const file: PlannedDiskFile = { path: 'themes/page.html', absPath: '/reviewed/page.html', root: '/reviewed', bytes: 4, mtimeMs: 1, identity: 'identity', nlink: 1, scope: 'themes' };

it('stale deferred input never builds a manifest', async () => {
  const plan = { files: [file], database: { bytes: new Uint8Array([1]) }, totalBytes: 5 };
  const buildManifest = vi.fn();
  const uploadBlob = vi.fn(async () => ({ ok: true as const, blobSha: 'blob' }));
  const result = await uploadBackupPlan({ plan, uploadBlob, signal: new AbortController().signal, progress: initialPushProgress({ plan }),
    databasePath: 'database/snapshot.db', readPlannedFile: async () => ({ ok: false, message: 'changed since review' }),
    buildManifest, cancelled: { ok: false, code: 'CANCELLED', message: 'stopped' },
  }, { concurrency: 1 });
  expect(result).toEqual({ ok: false, code: 'PLAN_STALE', message: 'changed since review' });
  expect(buildManifest).not.toHaveBeenCalled();
  expect(uploadBlob).toHaveBeenCalledTimes(1);
  expect(uploadBlob).toHaveBeenCalledWith({ path: 'database/snapshot.db', content: plan.database.bytes });
});

it('database is first and manifest is last', async () => {
  const plan = { files: [file], database: { bytes: new Uint8Array([1]) }, totalBytes: 5 };
  const order: string[] = [];
  const result = await uploadBackupPlan({ plan, signal: new AbortController().signal, progress: initialPushProgress({ plan }),
    databasePath: 'database/snapshot.db', readPlannedFile: async ({ file: input }) => { expect(input).toBe(file); order.push('read-disk'); return { ok: true, bytes: new Uint8Array([2]) }; },
    uploadBlob: async ({ path }) => { order.push(path); return { ok: true, blobSha: path }; },
    buildManifest: ({ entries }) => { expect(entries.map(entry => entry.path)).toEqual(['database/snapshot.db', file.path]); order.push('build-manifest'); return { path: 'manifest.json', content: new Uint8Array([3]) }; },
    cancelled: { ok: false, code: 'CANCELLED', message: 'stopped' },
  }, { concurrency: 1 });
  expect(order).toEqual(['database/snapshot.db', 'read-disk', file.path, 'build-manifest', 'manifest.json']);
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.entries.map(entry => entry.path)).toEqual(['database/snapshot.db', file.path, 'manifest.json']);
});

it('commit uses the reviewed parent and base tree', async () => {
  const commitBackupTree = vi.fn().mockResolvedValue({ ok: true, commitSha: 'commit', commitUrl: 'https://repo/commit' });
  const target = { baseUrl: 'https://repo', authorization: 'secret', owner: 'owner', repo: 'repo' };
  const plan = { owner: 'owner', repo: 'repo', folder: 'backup', commitMessage: 'Reviewed backup',
    repository: { branch: 'main', parentCommitSha: 'reviewed-parent', baseTreeSha: 'reviewed-tree', htmlUrl: 'https://repo', folderExists: true } };
  const entries = [{ path: 'file', bytes: 7, text: 'content', sha256: 'hash' }];
  const result = await commitBackupPlan({ provider: { commitBackupTree }, target, plan, entries });
  expect(commitBackupTree).toHaveBeenCalledWith({ ...target, branch: 'main', folder: 'backup', commitMessage: 'Reviewed backup',
    parentCommitSha: 'reviewed-parent', baseTreeSha: 'reviewed-tree', htmlUrl: 'https://repo', entries });
  expect(result).toEqual({ ok: true, result: { pushed: true, commitSha: 'commit', commitUrl: 'https://repo/commit',
    repository: 'owner/repo', branch: 'main', folder: 'backup', credentialWarnings: [], filesWritten: 1, totalBytes: 7 } });
});
