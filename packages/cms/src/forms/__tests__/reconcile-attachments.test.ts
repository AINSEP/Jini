import assert from 'node:assert/strict';
import { test } from 'vitest';
import { reconcileFormAttachments, type FormAttachmentCandidate } from '../reconcile-attachments.js';

const candidate: FormAttachmentCandidate = { mediaId: 'm', sha256: 'sha' };
function ports() {
  const effects: string[] = [];
  return { effects, workspaceId: 'w', readPage: async () => [candidate],
    inspect: async () => 'proven-orphan' as const,
    protect: async () => { effects.push('private'); }, cleanup: async () => { effects.push('cleanup'); } };
}
test('explicit preview proves eligibility without changing files; apply protects before cleanup', async () => {
  const deps = ports();
  assert.deepEqual((await reconcileFormAttachments(deps)).results, [{ mediaId: 'm', outcome: 'eligible', reason: 'proven-orphan' }]);
  assert.deepEqual(deps.effects, []);
  assert.deepEqual((await reconcileFormAttachments(deps, { apply: true })).results, [{ mediaId: 'm', outcome: 'queued', reason: 'proven-orphan' }]);
  assert.deepEqual(deps.effects, ['private', 'cleanup']);
});
test('missing evidence, restorable ownership and unknown checks keep files and explain', async () => {
  for (const reason of ['missing-evidence', 'owned', 'unknown'] as const) {
    const deps = ports();
    const result = await reconcileFormAttachments({ ...deps, inspect: async () => reason }, { apply: true });
    assert.deepEqual(result.results, [{ mediaId: 'm', outcome: 'kept', reason }]);
    assert.deepEqual(deps.effects, []);
  }
});
test('a failed ownership read keeps the file and does not hide later candidates', async () => {
  const deps = ports(); const rows = [candidate, { mediaId: 'n', sha256: 'other' }];
  const result = await reconcileFormAttachments({ ...deps, readPage: async () => rows,
    inspect: async ({ candidate: row }) => { if (row.mediaId === 'm') throw new Error('private data'); return 'proven-orphan'; } }, { apply: true });
  assert.deepEqual(result.results.map(row => [row.mediaId, row.outcome, row.reason]), [['m', 'kept', 'inspection-failed'], ['n', 'queued', 'proven-orphan']]);
  assert.deepEqual(deps.effects, ['private', 'cleanup']);
});
test('failed cleanup preserves the committed privacy step and reports a retryable candidate', async () => {
  const deps = ports();
  const result = await reconcileFormAttachments({ ...deps, cleanup: async () => { throw new Error('provider secret'); } }, { apply: true });
  assert.deepEqual(result.results, [{ mediaId: 'm', outcome: 'kept', reason: 'cleanup-failed' }]);
  assert.deepEqual(deps.effects, ['private']);
});
test('failed protection never permits cleanup', async () => {
  const deps = ports();
  const result = await reconcileFormAttachments({ ...deps, protect: async () => { throw new Error('database secret'); } }, { apply: true });
  assert.deepEqual(result.results, [{ mediaId: 'm', outcome: 'kept', reason: 'protection-failed' }]);
  assert.deepEqual(deps.effects, []);
});
test('one run reads at most 100 candidates and returns a resumable keyset cursor', async () => {
  const deps = ports(); const rows = Array.from({ length: 100 }, (_, i) => ({ mediaId: String(i).padStart(3, '0'), sha256: 'sha' }));
  const result = await reconcileFormAttachments({ ...deps, readPage: async input => { assert.deepEqual(input, { workspaceId: 'w', after: 'before', limit: 100 }); return rows.map(row => ({ ...row, mediaId: `z${row.mediaId}` })); } }, { after: 'before' });
  assert.equal(result.results.length, 100); assert.equal(result.nextAfter, 'z099'); assert.deepEqual(deps.effects, []);
});
test('oversized, repeated or non-increasing pages fail before any destructive effect', async () => {
  for (const rows of [Array.from({ length: 101 }, () => candidate), [candidate, candidate], [candidate, { mediaId: 'a', sha256: 'sha' }]]) {
    const deps = ports();
    await assert.rejects(reconcileFormAttachments({ ...deps, readPage: async () => rows }, { apply: true }));
    assert.deepEqual(deps.effects, []);
  }
});

test('only the exact durable terminal form-cleanup record proves an upload identity', async () => {
  const { matchesFormAttachmentCleanupEvidence } = await import('../reconcile-attachments.js');
  const event = { id: 'forms:file:cleanup:w:m', name: 'form.attachment.cleanup', workspaceId: 'w', aggregateId: 'm', payload: { workspaceId: 'w', sha256: 'sha' } };
  const matches = (value: unknown) => matchesFormAttachmentCleanupEvidence({ workspaceId: 'w', candidate, event: value });
  assert.equal(matches(event), true);
  for (const value of [null, {}, { ...event, id: 'unrelated' }, { ...event, workspaceId: 'other' }, { ...event, aggregateId: 'other' }, { ...event, name: 'media.uploaded' }, { ...event, payload: { workspaceId: 'other', sha256: 'sha' } }, { ...event, payload: { workspaceId: 'w', sha256: 'other' } }]) assert.equal(matches(value), false);
});

test('retained JSON detects escaped keys, nested references and URL identities; corrupt history fails closed', async () => {
  const { retainedJsonReferencesAttachment } = await import('../reconcile-attachments.js');
  const keys = ['media-id', 'old-slug'];
  assert.equal(retainedJsonReferencesAttachment({ json: '{"nested":[{"mediaId":"media-id"}]}', keys }), true);
  assert.equal(retainedJsonReferencesAttachment({ json: '{"bodyHtml":"<img src=\\"/m/old-slug/full/\\">"}', keys }), true);
  assert.equal(retainedJsonReferencesAttachment({ json: '{"mediaId":"media-\\u0069d"}', keys }), true);
  assert.equal(retainedJsonReferencesAttachment({ json: '{"other":[1,null,true,"unrelated"]}', keys }), false);
  assert.throws(() => retainedJsonReferencesAttachment({ json: '{bad', keys }));
});
