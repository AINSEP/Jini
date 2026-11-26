import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'vitest';
import type { AssistantSurfaceDeps } from '@jini-ai/core/contracts/site/daemon-surface-exchanges';
import type { ToolExecutionContext } from '@jini-ai/core';
import { buildFsFilesRegistrations, type FsFilesToolDeps } from '../tool-registrations.js';
import { getFsFilesAgentToolCatalog } from '../agent-tools.js';

function toolDeps(siteDir: string): FsFilesToolDeps {
  return { workspaceId: 'ws', siteBinding: { dir: siteDir }, authorize: async () => ({ allowed: true, reason: 'fixture' }),
    rootIds: ['site', 'custom'], readPermission: 'content.read',
    catalog: getFsFilesAgentToolCatalog({ FS_ROOT_IDS: ['site', 'custom'], FS_ROOT_DESCRIPTORS: [{ id: 'site', description: 'Site' }, { id: 'custom', description: 'Picked folder' }], MAX_FS_FILE_BYTES: 1000000, FS_FILES_READ_PERMISSION: 'content.read' }),
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
