import { expect, it } from 'vitest';
import { createBatchApprovalHandler, type ApprovalSteps } from '../approval.js';
import type { ToolExecutionContext } from '../tool-registry.js';

function fixture() {
  const events: string[] = [];
  let confirm = true;
  const steps: ApprovalSteps<string, string> = {
    prepare: async ({ ctx }) => {
      const id = (ctx.input as { id: string }).id;
      if (id === 'invalid') throw new Error('invalid target');
      events.push(`prepare:${id}`); return id;
    },
    describe: ({ prepared }) => ({ ask: true, description: prepared }),
    askHuman: async ({ description }) => { events.push(`ask:${description}`); return confirm ? { confirmed: true } : { confirmed: false, reason: 'declined' }; },
    run: async ({ prepared, confirmer }) => { events.push(`run:${prepared}:${confirmer.id}`); return prepared; },
    notConfirmed: ({ reason }) => ({ performed: false, reason }),
  };
  const handler = createBatchApprovalHandler({ steps, combineDescriptions: ({ descriptions }) => descriptions.join(',') });
  const ctx = (input: unknown): ToolExecutionContext => ({ input, executionId: 'exec', run: { id: 'run' }, principal: { id: 'owner' }, signal: new AbortController().signal });
  return { handler, ctx, events, decline: () => { confirm = false; } };
}

it('prepares the complete batch before one human approval, then executes the reviewed targets', async () => {
  const f = fixture();
  expect(await f.handler(f.ctx({ items: [{ id: 'a' }, { id: 'b' }] }))).toEqual({ batch: true, total: 2, results: ['a', 'b'] });
  expect(f.events).toEqual(['prepare:a', 'prepare:b', 'ask:a,b', 'run:a:owner', 'run:b:owner']);
});

it('preserves the scalar input and output contract', async () => {
  const f = fixture();
  expect(await f.handler(f.ctx({ id: 'a' }))).toBe('a');
  expect(f.events).toEqual(['prepare:a', 'ask:a', 'run:a:owner']);
});

it('cancellation denies the whole batch', async () => {
  const f = fixture(); f.decline();
  expect(await f.handler(f.ctx({ items: [{ id: 'a' }, { id: 'b' }] }))).toEqual({ performed: false, reason: 'declined' });
  expect(f.events).toEqual(['prepare:a', 'prepare:b', 'ask:a,b']);
});

it('a later invalid target prevents both approval and earlier effects', async () => {
  const f = fixture();
  await expect(f.handler(f.ctx({ items: [{ id: 'a' }, { id: 'invalid' }] }))).rejects.toThrow('invalid target');
  expect(f.events).toEqual(['prepare:a']);
});

for (const input of [
  { items: [] }, { items: 'a' }, { items: [null] }, { items: [{ items: [{}] }] },
  { items: [{ id: 'a', site: 's' }, { site: 's', id: 'a' }] },
  { items: Array.from({ length: 26 }, (_, id) => ({ id: String(id) })) },
]) it(`refuses malformed/duplicate/over-cap inputs before preparation: ${JSON.stringify(input)}`, async () => {
  const f = fixture();
  await expect(f.handler(f.ctx(input))).rejects.toThrow();
  expect(f.events).toEqual([]);
});

it('accepts the exact batch cap and isolates the confirmed selection from caller mutation', async () => {
  const f = fixture();
  const input = { items: Array.from({ length: 25 }, (_, id) => ({ id: String(id) })) };
  const pending = f.handler(f.ctx(input));
  input.items[0]!.id = 'forged';
  const result = await pending as { results: string[] };
  expect(result.results).toEqual(Array.from({ length: 25 }, (_, id) => String(id)));
  expect(f.events.filter(event => event.startsWith('ask:'))).toHaveLength(1);
});
