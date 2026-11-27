import assert from 'node:assert/strict';
import { test, expect, vi } from 'vitest';
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

function resourceFixture(resources: string[]) {
  const duplicate = vi.fn(async (input: unknown) => ({ saved: input }));
  const authorize = vi.fn<ContentDuplicationToolDeps["authorize"]>(async () => ({ allowed: true, reason: "fixture" }));
  const contributor = contributeContentDuplicationTools({
    listResourceHandlers: () => resources.map((resource) => ({ resource, build: () => ({ permission: `${resource}.write`, duplicate }) })),
    catalog: buildContentDuplicationAgentToolCatalog({ readToolName: "content_read" }), withPluginHookRefusals: ({ handlers }) => handlers,
  });
  const [tool] = contributor.build({ workspaceId: "ws-8", authorize }, undefined);
  if (!tool) throw new Error("content duplication registration missing");
  return { invoke: (input: unknown) => tool.handler({ ...ctx, input }), authorize, duplicate };
}

test("passes only requested overrides to the resource selected by name", async () => {
  const f = resourceFixture(["page", "form"]);
  const copied = { principalId: "agent", id: "source", overrides: { title: "Draft title", status: "draft" } };
  expect(await f.invoke({ resource: "form", id: "source", overrides: { title: "Draft title", status: "draft" } })).toEqual({ saved: copied });
  expect(f.duplicate.mock.calls).toEqual([[copied]]);
  expect(f.authorize.mock.calls).toEqual([[{ principalId: "agent", workspaceId: "ws-8", permission: "form.write", entityType: "form", entityId: "source" }]]);
});

test.each([
  [{ author: "agent" }, "unknown override 'author'"],
  [{ title: 91 }, "'overrides.title' must be a string"],
  [null, "'overrides' must be an object"],
  [[], "'overrides' must be an object"],
] as const)("reports malformed overrides %j as a caller error without duplication", async (overrides, message) => {
  const f = resourceFixture(["form"]);
  await expect(f.invoke({ resource: "form", id: "source", overrides })).rejects.toMatchObject({ name: "ToolInputError", message });
  expect(f.authorize.mock.calls).toEqual([]);
  expect(f.duplicate.mock.calls).toEqual([]);
});

test.each([
  [["page", "form"], "form, page"],
  [[], "(none registered)"],
] as const)("lists only the supported resource names when duplication is unavailable (%j)", async (resources, supported) => {
  const f = resourceFixture([...resources]);
  await expect(f.invoke({ resource: "article", id: "source" })).rejects.toThrow(
    `content_duplicate: cannot duplicate resource 'article'. Supported resources: ${supported}. No other resource can be duplicated by this tool — retrying with a different spelling will not help.`,
  );
  expect(f.authorize.mock.calls).toEqual([]);
  expect(f.duplicate.mock.calls).toEqual([]);
});
