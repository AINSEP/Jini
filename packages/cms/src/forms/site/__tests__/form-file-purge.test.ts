import assert from 'node:assert/strict';
import { test } from 'vitest';
import { protectExistingFormFiles } from '../protect-existing-files.js';

test('a transient stamp failure leaves completion absent and the next owner start retries', async () => {
  let marked = false; let stamps = 0; let fail = true;
  const warnings: string[] = [];
  const query = {
    select: () => query, where: () => query, orderBy: () => query, limit: () => query,
    execute: async () => { stamps++; if (fail) throw new Error('stamp failed'); return []; },
    executeTakeFirst: async () => ({ id: 'media', source_metadata_json: '{"private":true}', source_sha256: 'sha' }),
    set: () => query,
  };
  let pages = 0;
  const submissionQuery = { select: () => submissionQuery, where: () => submissionQuery, orderBy: () => submissionQuery, limit: () => submissionQuery,
    execute: async () => ++pages % 2 === 1 ? [{ id: 'submission', data_json: '{"photo":{"mediaId":"media"}}' }] : [] };
  const db = { selectFrom: (table: string) => table === 'submissions' ? submissionQuery : query,
    updateTable: () => query };
  type Kernel = Parameters<typeof protectExistingFormFiles>[0]['kernel'];
  const kernel: Kernel = { run: async work => work(db as unknown as Parameters<Parameters<Kernel['run']>[0]>[0]), transaction: async work => work() };
  const required = { kernel, workspaceId: 'ws', tables: { submissions: 'submissions', media: 'media', assetBlobs: 'blobs' },
    readMarker: async () => { if (!marked) throw new Error('absent'); }, markComplete: async () => { marked = true; },
    warn: ({ code }: { submissionId: string; code: string }) => warnings.push(code), warnIncomplete: (error: unknown) => { throw error; } };
  await protectExistingFormFiles(required);
  assert.equal(marked, false); assert.equal(stamps, 1);
  assert.deepEqual(warnings, ['attachment-protection-failed']);
  fail = false;
  await protectExistingFormFiles(required);
  assert.equal(marked, true); assert.equal(stamps, 2);
  await protectExistingFormFiles(required);
  assert.equal(stamps, 2);
});

test('an unavailable submissions store reports failure and never marks legacy protection done', async () => {
  const failure = new Error('submissions store unavailable');
  const warnings: unknown[] = [];
  const completion: string[] = [];
  const kernel: Parameters<typeof protectExistingFormFiles>[0]['kernel'] = {
    run: async () => { throw failure; },
    transaction: async work => work(),
  };
  await protectExistingFormFiles({
    kernel, workspaceId: 'ws', tables: { submissions: 'submissions', media: 'media', assetBlobs: 'blobs' },
    readMarker: async () => { throw new Error('not yet done'); },
    markComplete: async () => { completion.push('marked'); },
    warn: diagnostic => { throw new Error(`Unexpected attachment warning: ${diagnostic.code}`); },
    warnIncomplete: error => { warnings.push(error); },
  });
  assert.deepEqual(warnings, [failure]);
  assert.deepEqual(completion, []);
});
