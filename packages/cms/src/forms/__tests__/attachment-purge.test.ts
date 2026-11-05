import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createFormAttachmentPurgeHooks } from '../attachment-purge.js';
const file = { mediaId: 'm', filename: 'photo.png', contentType: 'image/png', byteSize: 8 };
test('purge captures attachments before rows disappear, dedupes repeated refs and deletes only after success', async () => {
  const removed: unknown[] = [];
  const hooks = createFormAttachmentPurgeHooks({ readSubmissions: async ({ after }) => after ? [] : [{ id: 's', dataJson: JSON.stringify({ photo: file, repeated: file }) }], remove: async input => { removed.push(input); } });
  const priorState = await hooks.beforePurge!({ workspaceId: 'w', entityId: 'f' });
  assert.deepEqual(removed, []);
  await hooks.afterPurge!({ workspaceId: 'w', entityId: 'f', priorState });
  assert.deepEqual(removed, [{ workspaceId: 'w', submissionId: 's', mediaId: 'm' }]);
});
test('invalid-import envelopes work and a cleanup failure prevents purge from committing', async () => {
  const hooks = createFormAttachmentPurgeHooks({ readSubmissions: async ({ after }) => after ? [] : [{ id: 's', dataJson: JSON.stringify(['@jini/form-submission/v1', { photo: file }, { status: 'invalid', fieldErrors: [] }]) }], remove: async () => { throw new Error('storage unavailable'); } });
  const priorState = await hooks.beforePurge!({ workspaceId: 'w', entityId: 'f' });
  await assert.rejects(hooks.afterPurge!({ workspaceId: 'w', entityId: 'f', priorState }), /storage unavailable/);
});
test('form purge captures every keyset page with no 100-submission cap', async () => {
  const rows = Array.from({ length: 205 }, (_, i) => ({ id: String(i).padStart(4, '0'), dataJson: JSON.stringify({ photo: { ...file, mediaId: `m${i}` } }) }));
  const removed: string[] = []; const cursors: (string | undefined)[] = [];
  const hooks = createFormAttachmentPurgeHooks({ readSubmissions: async ({ after, limit }) => {
    cursors.push(after); return rows.filter(row => after === undefined || row.id > after).slice(0, limit);
  }, remove: async ({ mediaId }) => { removed.push(mediaId); } });
  const priorState = await hooks.beforePurge!({ workspaceId: 'w', entityId: 'f' });
  await hooks.afterPurge!({ workspaceId: 'w', entityId: 'f', priorState });
  assert.equal(removed.length, 205); assert.equal(new Set(removed).size, 205);
  assert.deepEqual(cursors, [undefined, '0099', '0199', '0204']);
});

test('legacy protection pages all submissions and stamps each reference before the next page', async () => {
  const { protectFormAttachments } = await import('../attachment-purge.js');
  const seen: unknown[] = [];
  const count = await protectFormAttachments({ workspaceId: 'w', readPage: async ({ after }) => after ? [] : [{ id: 's', dataJson: JSON.stringify({ photo: file }) }], protect: async input => { seen.push(input); } });
  assert.equal(count, 1); assert.deepEqual(seen, [{ workspaceId: 'w', submissionId: 's', mediaId: 'm' }]);
});

test('protection warns per corrupt row or mismatched asset and continues through later pages', async () => {
  const { protectFormAttachments } = await import('../attachment-purge.js');
  const warnings: unknown[] = [], protectedIds: string[] = [];
  const rows = [{ id: 'a', dataJson: '{bad' }, { id: 'b', dataJson: JSON.stringify({ photo: file }) }, { id: 'c', dataJson: JSON.stringify({ photo: { ...file, mediaId: 'ok' } }) }];
  const count = await protectFormAttachments({ workspaceId: 'w', readPage: async ({ after }) => after ? [] : rows,
    protect: async ({ mediaId }) => { if (mediaId === 'm') throw new Error('do not log submitted secret'); protectedIds.push(mediaId); },
    warn: warning => { warnings.push(warning); },
  });
  assert.equal(count, 1); assert.deepEqual(protectedIds, ['ok']); assert.equal(warnings.length, 2);
  assert.equal(JSON.stringify(warnings).includes('submitted secret'), false);
});

test('bulk purge prepares a transaction snapshot only once after capture succeeds', async () => {
  let preparations = 0; const removed: string[] = [];
  const hooks = createFormAttachmentPurgeHooks({ readSubmissions: async ({ after }) => after ? [] : [{ id: 's', dataJson: JSON.stringify({ a: file, b: { ...file, mediaId: 'm2' } }) }],
    prepareRemoval: async () => { preparations++; return async ({ mediaId }) => { removed.push(mediaId); }; },
  });
  const priorState = await hooks.beforePurge!({ workspaceId: 'w', entityId: 'f' });
  assert.equal(preparations, 0);
  await hooks.afterPurge!({ workspaceId: 'w', entityId: 'f', priorState });
  assert.equal(preparations, 1); assert.deepEqual(removed, ['m', 'm2']);
});

test('ownership mismatches have a distinct safe warning from retryable stamp failures', async () => {
  const { protectFormAttachments, FormAttachmentOwnerMismatchError } = await import('../attachment-purge.js');
  const warnings: unknown[] = [];
  await protectFormAttachments({ workspaceId: 'w', readPage: async ({ after }) => after ? [] : [{ id: 's', dataJson: JSON.stringify({ file }) }],
    protect: async () => { throw new FormAttachmentOwnerMismatchError(); }, warn: input => { warnings.push(input); } });
  assert.deepEqual(warnings, [{ submissionId: 's', code: 'attachment-owner-mismatch' }]);
});
