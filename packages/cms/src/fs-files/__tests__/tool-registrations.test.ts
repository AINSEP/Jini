import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test, vi } from 'vitest';
import type { AssistantSurfaceDeps } from '@jini-ai/core/contracts/site/daemon-surface-exchanges';
import { createApprovalHandler, ToolInputError, type ToolExecutionContext } from '@jini-ai/core';
import { buildFsFilesRegistrations, contributeFsFilesTools, describeWriteBatch, preparePickedFolderBatch, resolvePickedFolder, type FsFilesToolDeps } from '../tool-registrations.js';
import { writePreparedFiles } from '../write-files.js';
import { getFsFilesAgentToolCatalog } from '../agent-tools.js';

function toolDeps(siteDir: string): FsFilesToolDeps {
  return { workspaceId: 'ws', siteBinding: { dir: siteDir }, authorize: async () => ({ allowed: true, reason: 'fixture' }),
    rootIds: ['site', 'custom'], readPermission: 'content.read',
    catalog: getFsFilesAgentToolCatalog({ rootIds: ['site', 'custom'], rootDescriptors: [{ id: 'site', description: 'Site' }, { id: 'custom', description: 'Picked folder' }], maxFileBytes: 1000000 }),
    resolveFsRoots: () => ({ site: siteDir, custom: undefined }),
    resolveFsFilePath: ({ rootPath, relativePath }) => resolve(rootPath, relativePath),
    resolveSiteFileRequest: ({ relativePath }) => ({ rootPath: siteDir, relativePath: relativePath ?? '.' }),
    listFsFiles: () => ({ files: ['one.txt'], truncated: true, nextCursor: '1', remaining: 2 }),
    readFsFile: () => ({ content: 'fixture', bytes: 7 }), isShapeRejection: () => false,
    surfaces: {} as AssistantSurfaceDeps,
    approvalToolHandler: ({ prepare }) => async ctx => { await prepare({ ctx }, {}); return { applied: false, reason: 'declined' }; },
    refuseUnexpectedKeys: () => {}, writePreparedFiles: () => { assert.fail('declined writes must not reach the writer'); },
  };
}
const ctx = (input: unknown): ToolExecutionContext => ({ executionId: 'exec', principal: { id: 'agent' }, run: { id: 'run' }, signal: new AbortController().signal, input });

test('a truncated listing retains its truncation, cursor and remaining count', async () => {
  const tool = buildFsFilesRegistrations(toolDeps('/fixture/site')).find(item => item.descriptor.id === 'fs_list_files')!;
  assert.deepEqual(await tool.handler(ctx({ root: 'site' })), { root: 'site', path: '', files: ['one.txt'], truncated: true, nextCursor: '1', remaining: 2 });
});

test('a declined prepared write never calls the writer', async () => {
  const root = mkdtempSync(join(tmpdir(), 'fs-files-approval-'));
  const site = join(root, 'site'); const picked = join(root, 'picked');
  mkdirSync(site); mkdirSync(picked);
  try {
    const deps = { ...toolDeps(site), resolveRoots: () => ({ site, custom: picked }) };
    const tool = buildFsFilesRegistrations(deps).find(item => item.descriptor.id === 'fs_write_files')!;
    assert.deepEqual(await tool.handler(ctx({ files: [{ path: 'note.txt', content: 'hello' }] })), { applied: false, reason: 'declined' });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('picked-folder batches refuse parent and absolute paths before resolving or reading a target', () => {
  const root = mkdtempSync(join(tmpdir(), 'fs-files-containment-'));
  const site = join(root, 'site'); const picked = join(root, 'picked');
  mkdirSync(site); mkdirSync(picked);
  try {
    const routeDeps = { workspaceId: 'ws', siteBinding: { dir: site }, resolveFsRoots: () => ({ custom: picked }),
      resolveFsFilePath: () => { assert.fail('escaped target must be refused before target access'); } };
    assert.equal(resolvePickedFolder({ routeDeps }), picked);
    for (const path of ['../outside.txt', '/outside.txt']) {
      assert.throws(() => preparePickedFolderBatch({ routeDeps, files: [{ path, content: 'refused' }] }), /plain relative path/);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('read registration uses the authorized root, projects exact file contents and refuses unsupported input', async () => {
  const deps = toolDeps('/fixture/site');
  const authorize = vi.fn(deps.authorize);
  const resolveSiteFileRequest = vi.fn(deps.resolveSiteFileRequest);
  const readFsFile = vi.fn(deps.readFsFile);
  const routed = { ...deps, authorize, resolveSiteFileRequest, readFsFile };
  const tool = contributeFsFilesTools().build(routed, deps.surfaces).find(item => item.descriptor.id === 'fs_read_file')!;
  for (const root of [undefined, '', 7]) {
    await assert.rejects(tool.handler(ctx({ root, path: 'folder/README.md' })), (error: unknown) =>
      error instanceof ToolInputError && error.message.includes("'root' (non-empty string) is required. Choose one of: site, custom."));
  }
  await assert.rejects(tool.handler(ctx({ site: 'another', root: 'site', path: 'folder/README.md' })), {
    name: 'ToolInputError', message: 'Filesystem tools use only the active site; a site selector is not accepted',
  });
  assert.deepEqual(authorize.mock.calls, []);
  assert.deepEqual(resolveSiteFileRequest.mock.calls, []);
  assert.deepEqual(readFsFile.mock.calls, []);

  const input = { root: 'custom', path: 'folder/README.md' };
  assert.deepEqual(await tool.normalizeInput!({ input }), { input, notes: [] });
  assert.throws(() => tool.normalizeInput!({ input: { ...input, find: 'search phrase' } }), (error: unknown) =>
    error instanceof ToolInputError && error.message.includes('fs_read_file returns full file content and has no text-search parameter.'));
  assert.deepEqual(await tool.handler(ctx(input)), { root: 'custom', path: 'folder/README.md', content: 'fixture', bytes: 7 });
  assert.deepEqual(authorize.mock.calls, [[{ principalId: 'agent', permission: 'content.read', workspaceId: 'ws', entityType: 'fs-root', entityId: 'custom' }]]);
  assert.deepEqual(resolveSiteFileRequest.mock.calls, [[{ routeDeps: routed, root: 'custom', relativePath: 'folder/README.md' }, {}]]);
  assert.deepEqual(readFsFile.mock.calls, [[{ rootPath: '/fixture/site', relativePath: 'folder/README.md' }]]);
});

test('approved write card names the overwrite and byte counts before the exact files land', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'fs-files-confirm-')));
  const site = join(root, 'site');
  const picked = join(root, 'picked');
  mkdirSync(site); mkdirSync(picked);
  try {
    const target = join(picked, 'old.txt');
    writeFileSync(target, 'original');
    const reply = 'r'.repeat(1024);
    const descriptions: Awaited<ReturnType<typeof describeWriteBatch>>[] = [];
    const deps: FsFilesToolDeps = {
      ...toolDeps(site), resolveRoots: () => ({ site, custom: picked }), writePreparedFiles,
      approvalToolHandler: steps => createApprovalHandler({
        prepare: steps.prepare,
        describe: async ({ ctx, prepared }) => ({ ask: true, description: await steps.describe({ ctx, prepared }) }),
        askHuman: async spec => {
          descriptions.push(spec.description);
          assert.equal(readFileSync(target, 'utf8'), 'original');
          return { confirmed: true };
        },
        run: ({ ctx, prepared, confirmer }, options) => steps.run({ ctx, prepared, confirmer }, options),
        notConfirmed: () => ({ applied: false }),
      }),
    };
    const tool = buildFsFilesRegistrations(deps).find(item => item.descriptor.id === 'fs_write_files')!;
    assert.deepEqual(await tool.handler(ctx({ files: [{ path: 'old.txt', content: reply }, { path: 'new.txt', content: 'hi' }] })),
      { applied: true, written: ['old.txt', 'new.txt'], notWritten: [] });
    assert.deepEqual(descriptions, [{
      toolId: 'fs_write_files', errorCode: 'FS_WRITE', title: 'Write 2 file(s) to picked?',
      confirmLabel: 'Write files', warning: 'Replaces 1 existing file(s). There is no undo.', danger: true,
      details: [{ label: 'Folder', value: picked },
        { label: 'Files', value: 'overwrite     1.0 KB  old.txt\nnew              2 B  new.txt', format: 'code' },
        { label: 'Total', value: '1.0 KB' }],
    }]);
    assert.equal(readFileSync(target, 'utf8'), reply);
    assert.equal(readFileSync(join(picked, 'new.txt'), 'utf8'), 'hi');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a batch of only new files gets a plain card under the calling tool, with no overwrite warning', () => {
  assert.deepEqual(describeWriteBatch({ folder: '/fixture/picked', writes: [{ path: 'a.txt', bytes: Buffer.from('abc'), overwrite: false }] }, { toolId: 'image_transform' }), {
    toolId: 'image_transform', errorCode: 'FS_WRITE', title: 'Write 1 file(s) to picked?', confirmLabel: 'Write files',
    details: [{ label: 'Folder', value: '/fixture/picked' }, { label: 'Files', value: 'new              3 B  a.txt', format: 'code' }, { label: 'Total', value: '3 B' }],
  });
});

test('with no picked folder a batch is a tool input error, while an unexpected root-resolution fault is rethrown as-is', () => {
  const unpicked = { workspaceId: 'ws', siteBinding: { dir: '/fixture/site' }, resolveFsRoots: () => ({ site: '/fixture/site', custom: undefined }),
    resolveFsFilePath: () => assert.fail('no target is resolved without a folder') };
  const message = "No folder is picked — ask the person to pick one with the composer's folder button";
  assert.throws(() => resolvePickedFolder({ routeDeps: unpicked }), { name: 'FsWriteInputError', message });
  assert.throws(() => preparePickedFolderBatch({ routeDeps: unpicked, files: [{ path: 'a.txt', content: 'x' }] }), (error: unknown) => error instanceof ToolInputError && error.message === message);
  const fault = new Error('roots store offline');
  assert.throws(() => preparePickedFolderBatch({ routeDeps: { ...unpicked, resolveFsRoots: () => { throw fault; } }, files: [] }), (error: unknown) => error === fault);
});

test('a listing forwards its path, recursive depth, limit and cursor, and refuses an out-of-range limit before listing', async () => {
  const deps = toolDeps('/fixture/site');
  const listFsFiles = vi.fn(deps.listFsFiles);
  const tool = buildFsFilesRegistrations({ ...deps, listFsFiles }).find(item => item.descriptor.id === 'fs_list_files')!;
  assert.deepEqual(await tool.handler(ctx({ root: 'site', path: 'docs', recursive: true, limit: 5, cursor: 'c1' })),
    { root: 'site', path: 'docs', files: ['one.txt'], truncated: true, nextCursor: '1', remaining: 2 });
  await tool.handler(ctx({ root: 'site', path: 'docs', depth: 3 }));
  assert.deepEqual(listFsFiles.mock.calls, [
    [{ rootPath: '/fixture/site', relativePath: 'docs', depth: 12, limit: 5, cursor: 'c1' }],
    [{ rootPath: '/fixture/site', relativePath: 'docs', depth: 3, limit: 100 }],
  ]);
  for (const limit of [0, 101, 2.5]) {
    await assert.rejects(tool.handler(ctx({ root: 'site', limit })), { name: 'ToolInputError', message: 'limit must be an integer between 1 and 100' });
  }
  assert.equal(listFsFiles.mock.calls.length, 2);
});

test('list and read failures are offered to the shape-rejection check, which decorates a shape error with the tool schema', async () => {
  const deps = toolDeps('/fixture/site');
  const refusal = new Error('path is outside the root');
  const isShapeRejection = vi.fn(({ error }: { error: unknown }) => error === refusal);
  const tools = buildFsFilesRegistrations({ ...deps, isShapeRejection, resolveSiteFileRequest: () => { throw refusal; } });
  for (const [id, input] of [['fs_list_files', { root: 'site', path: '../up' }], ['fs_read_file', { root: 'site', path: '../up' }]] as const) {
    const tool = tools.find(item => item.descriptor.id === id)!;
    await assert.rejects(tool.handler(ctx(input)), (error: unknown) => error instanceof ToolInputError
      && error.message.startsWith('path is outside the root') && error.message.includes(`Schema for '${id}'`));
  }
  assert.deepEqual(isShapeRejection.mock.calls, [[{ error: refusal }], [{ error: refusal }]]);
});
