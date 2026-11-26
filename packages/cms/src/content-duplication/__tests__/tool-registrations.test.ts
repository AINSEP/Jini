import assert from 'node:assert/strict';
import { test } from 'vitest';
import type { ToolExecutionContext } from '@jini-ai/core';
import type { DuplicateResourceHandlerContributor } from '@jini-ai/core/contracts/site/assistant-tool-contributions';
import { buildContentDuplicationAgentToolCatalog } from '../agent-tools.js';
import { contributeContentDuplicationTools, type ContentDuplicationToolDeps } from '../tool-registrations.js';

const ctx: ToolExecutionContext = { executionId: 'exec', principal: { id: 'agent' }, run: { id: 'run' }, signal: new AbortController().signal, input: { resource: 'form', id: 'source' } };

test('resources registered after contribution are discovered at build', async () => {
  const registered: DuplicateResourceHandlerContributor<ContentDuplicationToolDeps>[] = [];
  const contributor = contributeContentDuplicationTools({ listResourceHandlers: () => registered,
    catalog: buildContentDuplicationAgentToolCatalog({ readToolName: 'content_read' }), withPluginHookRefusals: ({ handlers }) => handlers });
  registered.push({ resource: 'form', build: () => ({ permission: 'form.write', duplicate: async input => ({ copied: input.id }) }) });
  const [tool] = contributor.build({ workspaceId: 'ws', authorize: async () => ({ allowed: true, reason: 'fixture' }) }, undefined);
  assert.ok(tool);
  assert.deepEqual(await tool.handler(ctx), { copied: 'source' });
});

test('denied resources never enter their duplicate callback', async () => {
  let copies = 0;
  const contributor = contributeContentDuplicationTools({ listResourceHandlers: () => [{ resource: 'form', build: () => ({ permission: 'form.write', duplicate: async () => { copies++; return {}; } }) }],
    catalog: buildContentDuplicationAgentToolCatalog({ readToolName: 'content_read' }), withPluginHookRefusals: ({ handlers }) => handlers });
  const [tool] = contributor.build({ workspaceId: 'ws', authorize: async () => ({ allowed: false, reason: 'denied' }) }, undefined);
  assert.ok(tool);
  await assert.rejects(tool.handler(ctx), /form.write/);
  assert.equal(copies, 0);
});
