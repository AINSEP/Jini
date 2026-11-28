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

test('legacy protection stamps only privately-owned media, skips purged media and warns on unproven ownership', async () => {
  type Clause = [string, string, unknown];
  const media: Record<string, { id: string; source_metadata_json: string | null; source_sha256: string }> = {
    legacy: { id: 'legacy', source_metadata_json: null, source_sha256: 'sha-legacy' },
    shown: { id: 'shown', source_metadata_json: '{"private":false,"name":"upload-x"}', source_sha256: 'sha-shown' },
    owned: { id: 'owned', source_metadata_json: '{"private":true}', source_sha256: 'sha-owned' },
  };
  const submissions = [{ id: 's1', data_json: '{"a":{"mediaId":"purged"},"b":{"mediaId":"legacy"}}' }, { id: 's2', data_json: '{"c":{"mediaId":"shown"},"d":{"mediaId":"owned"}}' }];
  const updates: { table: string; set: unknown; where: Clause[] }[] = [];
  const mediaReads: Clause[][] = [];
  const builder = (table: string) => {
    const where: Clause[] = [];
    let set: unknown;
    const b = {
      select: () => b, orderBy: () => b, limit: () => b,
      where: (column: string, op: string, value: unknown) => { where.push([column, op, value]); return b; },
      set: (value: unknown) => { set = value; return b; },
      execute: async () => {
        if (table === 'blobs') { updates.push({ table, set, where }); return []; }
        const after = where.find(([column]) => column === 'id')?.[2];
        return after === undefined ? submissions : [];
      },
      executeTakeFirst: async () => { mediaReads.push(where); return media[String(where.find(([column]) => column === 'id')?.[2])]; },
    };
    return b;
  };
  type Kernel = Parameters<typeof protectExistingFormFiles>[0]['kernel'];
  const db = { selectFrom: (table: string) => builder(table), updateTable: (table: string) => builder(table) };
  const kernel: Kernel = { run: async work => work(db as unknown as Parameters<Parameters<Kernel['run']>[0]>[0]), transaction: async work => work() };
  const warnings: [string, string][] = [];
  const completion: string[] = [];
  await protectExistingFormFiles({
    kernel, workspaceId: 'ws-1', tables: { submissions: 'subs', media: 'media', assetBlobs: 'blobs' },
    readMarker: async () => { throw new Error('absent'); }, markComplete: async () => { completion.push('marked'); },
    warn: ({ submissionId, code }) => warnings.push([submissionId, code]), warnIncomplete: error => { throw error; },
  });
  assert.deepEqual(mediaReads.map(where => where.find(([column]) => column === 'id')?.[2]), ['purged', 'legacy', 'shown', 'owned']);
  assert.ok(mediaReads.every(where => where.some(([column, op, value]) => column === 'workspace_id' && op === '=' && value === 'ws-1')));
  assert.deepEqual(warnings, [['s1', 'attachment-owner-mismatch'], ['s2', 'attachment-owner-mismatch']]);
  assert.deepEqual(updates, [{ table: 'blobs', set: { document_owned: true }, where: [['workspace_id', '=', 'ws-1'], ['sha256', '=', 'sha-owned'], ['document_owned', '=', false]] }]);
  assert.deepEqual(completion, ['marked'], 'ownership warnings do not make the pass retry');
});
