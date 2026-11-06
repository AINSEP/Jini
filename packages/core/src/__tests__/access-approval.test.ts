import { expect, it, vi } from 'vitest';
import { createApprovalHandler, createBatchApprovalHandler, snapshotAccessApproval, type ApprovalPlan } from '../approval.js';
import type { ToolExecutionContext } from '../tool-registry.js';

const access = () => ({ resources: [{ id: 'source', label: 'Mail tools', scope: { personId: 'person', siteId: 'site', chatId: 'chat' }, previous: { allow: [] }, proposed: { allow: ['read'] }, revision: 'v1' }] });
const context = (): ToolExecutionContext => ({ executionId: 'exec', run: { id: 'run' }, principal: { id: 'person' }, input: { confirmed: true }, signal: new AbortController().signal });

it.each([false, true])('access always asks freshly even with malformed ask=%s and a remembered key', async ask => {
  const askHuman = vi.fn(async () => ({ confirmed: false as const, reason: 'declined' as const }));
  const run = vi.fn();
  const remembered = { has: vi.fn(async () => true), grant: vi.fn(async () => {}) };
  const handler = createApprovalHandler({
    prepare: async () => undefined,
    describe: () => ({ kind: 'access', ask, description: 'Access', access: access(), rememberKey: 'old' } as unknown as ApprovalPlan<string>),
    askHuman, run, notConfirmed: ({ reason }) => ({ reason }),
  }, { remembered });
  expect(await handler(context())).toEqual({ reason: 'declined' });
  expect(askHuman).toHaveBeenCalledOnce(); expect(run).not.toHaveBeenCalled();
  expect(remembered.has).not.toHaveBeenCalled(); expect(remembered.grant).not.toHaveBeenCalled();
});

it('accepted access runs once without creating reusable approval', async () => {
  const run = vi.fn(async () => 'applied');
  const remembered = { has: vi.fn(async () => true), grant: vi.fn(async () => {}) };
  const handler = createApprovalHandler({
    prepare: async () => undefined,
    describe: () => ({ kind: 'access' as const, ask: true as const, description: 'Access', access: access() }),
    askHuman: async () => ({ confirmed: true }), run, notConfirmed: () => 'closed',
  }, { remembered });
  expect(await handler(context())).toBe('applied'); expect(run).toHaveBeenCalledOnce();
  expect(remembered.has).not.toHaveBeenCalled(); expect(remembered.grant).not.toHaveBeenCalled();
});

it.each(['declined', 'expired', 'abandoned'] as const)('access %s performs no effect', async reason => {
  const run = vi.fn();
  const handler = createApprovalHandler({
    prepare: async () => undefined,
    describe: () => ({ kind: 'access' as const, ask: true as const, description: 'Access', access: access() }),
    askHuman: async () => ({ confirmed: false, reason }), run, notConfirmed: ({ reason: outcome }) => outcome,
  });
  expect(await handler(context())).toBe(reason); expect(run).not.toHaveBeenCalled();
});

it('detaches the access description before the host begins waiting', async () => {
  const original = { access: access(), note: 'original' };
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  let asked!: () => void;
  const started = new Promise<void>(resolve => { asked = resolve; });
  let shown: typeof original | undefined;
  const handler = createApprovalHandler({
    prepare: async () => undefined,
    describe: () => ({ kind: 'access' as const, ask: true as const, description: original, access: original.access }),
    askHuman: async ({ description }) => { shown = description; asked(); await wait; return { confirmed: true }; },
    run: async () => 'applied', notConfirmed: () => 'closed',
  });
  const pending = handler(context()); await started;
  original.access.resources[0]!.proposed.allow.push('write'); original.note = 'replacement';
  expect(shown?.access.resources[0]!.proposed.allow).toEqual(['read']); expect(shown?.note).toBe('original');
  release(); expect(await pending).toBe('applied');
});

it.each([0, 129])('refuses %s access resources before asking or applying', async count => {
  const askHuman = vi.fn(); const run = vi.fn();
  const handler = createApprovalHandler({
    prepare: async () => undefined,
    describe: () => ({ kind: 'access' as const, ask: true as const, description: 'Access', access: { resources: Array.from({ length: count }, () => access().resources[0]!) } }),
    askHuman, run, notConfirmed: () => 'closed',
  });
  await expect(handler(context())).rejects.toThrow('between 1 and 128');
  expect(askHuman).not.toHaveBeenCalled(); expect(run).not.toHaveBeenCalled();
});

it('bounds UTF-8 disclosure bytes rather than character count', async () => {
  const askHuman = vi.fn(); const run = vi.fn(); const proposal = access();
  proposal.resources[0]!.label = '界'.repeat(50_000);
  const handler = createApprovalHandler({
    prepare: async () => undefined,
    describe: () => ({ kind: 'access' as const, ask: true as const, description: 'Access', access: proposal }),
    askHuman, run, notConfirmed: () => 'closed',
  });
  await expect(handler(context())).rejects.toThrow('128 KiB');
  expect(askHuman).not.toHaveBeenCalled(); expect(run).not.toHaveBeenCalled();
});


it('accepts 128 resources and detaches their nested grants', () => {
  const proposal = { resources: Array.from({ length: 128 }, () => access().resources[0]!) };
  const snapshot = snapshotAccessApproval({ access: proposal });
  proposal.resources[0]!.proposed.allow.push('write');
  expect(snapshot.resources).toHaveLength(128);
  expect(snapshot.resources[0]!.proposed).toEqual({ allow: ['read'] });
});

it('one batched access plan forces a single fresh decision for the whole batch', async () => {
  const askHuman = vi.fn(async () => ({ confirmed: false as const, reason: 'declined' as const }));
  const run = vi.fn();
  const handler = createBatchApprovalHandler({
    steps: {
      prepare: async ({ ctx }) => ctx.input,
      describe: () => ({ kind: 'access', ask: false, description: 'Access', access: access() } as unknown as ApprovalPlan<string>),
      askHuman, run, notConfirmed: ({ reason }) => reason,
    },
    combineDescriptions: ({ descriptions }) => descriptions.join(', '),
  });
  expect(await handler({ ...context(), input: { items: [{ id: 'a' }, { id: 'b' }] } })).toBe('declined');
  expect(askHuman).toHaveBeenCalledOnce(); expect(run).not.toHaveBeenCalled();
});
