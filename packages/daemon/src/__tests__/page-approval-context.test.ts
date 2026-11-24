import { expect, test } from 'vitest';
import type { ToolExecutionContext } from '@jini-ai/core';
import type { ToolExecutor } from '../tool-executor-types.js';
import { createPageApprovalContext, pageApprovalOptions } from '../page-approval-context.js';

// Moved from the host's page-approval-context unit test; the host now injects its navigation query.
const navigationQuery = '__host_navigation_context__';
const ctx: ToolExecutionContext = {
  executionId: 'click', principal: { id: 'owner' }, run: { id: 'run' },
  input: { handle: 'opaque', __frontendNavigationRevision: 999 }, signal: new AbortController().signal,
};

test('only page.click receives a navigation context port during frontend composition', () => {
  const execute: ToolExecutor['execute'] = async () => { throw new Error('composition must not read the browser'); };
  expect(pageApprovalOptions({ toolId: 'page.click', execute, navigationQuery }).context).toBeTruthy();
  for (const toolId of ['page.find_elements', 'page.navigate', 'chat.open']) expect(pageApprovalOptions({ toolId, execute, navigationQuery })).toEqual({});
});

test('page approval captures one read with the original trusted owner and signal, then overwrites caller context', async () => {
  const calls: Parameters<ToolExecutor['execute']>[] = [];
  const context = createPageApprovalContext({ navigationQuery, execute: async (...args) => {
    calls.push(args);
    return { executionId: 'read', status: 'completed', output: { elements: [], navigationRevision: 0 } };
  } });
  const snapshot = await context.capture({ ctx });
  expect(snapshot).toBe(0);
  expect(calls).toEqual([[{
    principal: ctx.principal, run: ctx.run, toolId: 'page.find_elements', input: { query: navigationQuery },
  }, { signal: ctx.signal }]]);
  const prepared = context.prepare({ ctx, snapshot });
  expect(prepared.input).toEqual({ handle: 'opaque', __frontendNavigationRevision: 0 });
  expect(prepared.principal).toBe(ctx.principal);
  expect(prepared.signal).toBe(ctx.signal);
  expect(ctx.input).toEqual({ handle: 'opaque', __frontendNavigationRevision: 999 });
});

for (const revision of [undefined, null, -1, NaN, Infinity, 1.5, '1', Number.MAX_SAFE_INTEGER + 1]) {
  test(`an unusable navigation revision ${String(revision)} refuses before preparing an effect`, async () => {
    const context = createPageApprovalContext({ navigationQuery, execute: async () => ({ executionId: 'read', status: 'completed', output: { navigationRevision: revision } }) });
    await expect(context.capture({ ctx })).rejects.toThrow(/could not verify the current view/);
    expect(() => context.prepare({ ctx, snapshot: revision })).toThrow(/could not verify the current view/);
  });
}

test('a failed or malformed view read refuses with an actionable message', async () => {
  for (const result of [{ status: 'failed', error: 'offline' }, { status: 'completed', output: null }] as const) {
    const context = createPageApprovalContext({ navigationQuery, execute: async () => ({ executionId: 'read', ...result }) });
    await expect(context.capture({ ctx })).rejects.toThrow(/could not verify the current view/);
  }
});
