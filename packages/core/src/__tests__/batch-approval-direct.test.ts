import { expect, it } from 'vitest';
import { createBatchApprovalHandler } from '../approval.js';
import type { ToolExecutionContext } from '../tool-registry.js';

it('a batch of actions needing no approval completes without opening a card', async () => {
  const events: string[] = [];
  const handler = createBatchApprovalHandler({
    steps: {
      prepare: async ({ ctx }) => String((ctx.input as { id: string }).id),
      describe: ({ prepared }) => ({ ask: false, description: prepared }),
      askHuman: async () => { events.push('card'); return { confirmed: false, reason: 'declined' }; },
      run: async ({ prepared }) => { events.push(prepared); return prepared; },
      notConfirmed: () => ({ executed: false }),
    },
    combineDescriptions: ({ descriptions }) => descriptions.join(','),
  });
  const ctx: ToolExecutionContext = { executionId: 'exec', run: { id: 'run' }, principal: { id: 'owner' },
    input: { items: [{ id: 'a' }, { id: 'b' }] }, signal: new AbortController().signal };
  expect(await handler(ctx)).toEqual({ batch: true, total: 2, results: ['a', 'b'] });
  expect(events).toEqual(['a', 'b']);
});

it('a mixed batch asks once before either the direct action or the replacement runs', async () => {
  const events: string[] = [];
  const handler = createBatchApprovalHandler({
    steps: {
      prepare: async ({ ctx }) => String((ctx.input as { id: string }).id),
      describe: ({ prepared }) => ({ ask: prepared === 'replace', description: prepared }),
      askHuman: async () => { events.push('card'); return { confirmed: false, reason: 'declined' }; },
      run: async ({ prepared }) => { events.push(prepared); return prepared; },
      notConfirmed: () => ({ executed: false }),
    },
    combineDescriptions: ({ descriptions }) => descriptions.join(','),
  });
  const ctx: ToolExecutionContext = { executionId: 'exec', run: { id: 'run' }, principal: { id: 'owner' },
    input: { items: [{ id: 'new' }, { id: 'replace' }] }, signal: new AbortController().signal };
  expect(await handler(ctx)).toEqual({ executed: false });
  expect(events).toEqual(['card']);
});
