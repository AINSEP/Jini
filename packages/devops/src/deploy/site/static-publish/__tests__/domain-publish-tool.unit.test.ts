import assert from 'node:assert/strict';
import { test } from 'vitest';
import type { ToolExecutionContext } from '@jini-ai/core';
import type { StaticPublishToolDeps } from '../../publish-tool-deps.js';
import { domainPublishTool } from '../domain-publish-tool.js';

test('the reviewed domain plan is confirmed by the person before agent execution', async () => {
  const events: string[] = [];
  const deps = { workspaceId: 'ws', clock: { nowMs: () => 0 }, gatedMutations: { gatewayDeps: {} },
    gatewayPlan: async () => { events.push('plan'); return { details: {}, planId: 'plan', planHash: 'hash' }; },
    gatewayConfirm: async ({ principalId, planId, planHash }: { principalId: string; planId: string; planHash: string }) => {
      assert.equal(planId, 'plan'); assert.equal(planHash, 'hash'); events.push(`confirm:${principalId}`); return { confirmationToken: 'token' };
    },
    gatewayExecute: async ({ principalId, confirmationToken }: { principalId: string; confirmationToken: string }) => {
      assert.equal(confirmationToken, 'token'); events.push(`execute:${principalId}`); return { jobId: 'job', status: 'running' };
    },
    checkToolPublishConsent: async () => null,
    approvalToolHandler: (steps: { prepare(input: { ctx: ToolExecutionContext }): Promise<unknown>; run(input: { ctx: ToolExecutionContext; prepared: unknown; confirmer: { id: string; kind: 'user' } }): Promise<unknown> }) => async (ctx: ToolExecutionContext) => {
      const prepared = await steps.prepare({ ctx }); assert.deepEqual(events, ['plan']);
      events.push('human-click'); return steps.run({ ctx, prepared, confirmer: { id: 'human', kind: 'user' } });
    },
  } as unknown as StaticPublishToolDeps;
  const handler = domainPublishTool({ deps, surfaces: {} as never, credentialSource: {} as never, historyStore: {} as never,
    config: { target: 'host', customDomain: 'example.com' }, projectName: 'Site' });
  assert.deepEqual(events, []);
  const ctx: ToolExecutionContext = { executionId: 'exec', principal: { id: 'agent' }, run: { id: 'run' }, input: {}, signal: new AbortController().signal };
  await handler(ctx);
  assert.deepEqual(events, ['plan', 'human-click', 'confirm:human', 'execute:agent']);
});
