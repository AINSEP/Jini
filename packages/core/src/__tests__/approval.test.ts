import { expect, it } from 'vitest';
import { createApprovalProposalStore, createApprovalHandler, resolveApproval, type ApprovalAnswer, type ApprovalSteps, type RememberedApprovalPort } from '../approval.js';
import type { ToolExecutionContext } from '../tool-registry.js';

const context = (signal = new AbortController().signal): ToolExecutionContext => ({ executionId: 'exec', run: { id: 'run' }, principal: { id: 'human' }, input: { target: 'original', decision: 'confirm' }, signal });
function harness(options: { answer?: ApprovalAnswer; ask?: boolean; remembered?: RememberedApprovalPort; key?: string } = {}) {
  const events: string[] = [];
  const steps: ApprovalSteps<unknown, string> = {
    prepare: async ({ ctx }) => { events.push('prepare'); return ctx.input; },
    describe: () => ({ ask: options.ask ?? true, description: 'public description', ...(options.key === undefined ? {} : { rememberKey: options.key }) }),
    askHuman: async () => { events.push('ask'); return options.answer ?? { confirmed: true }; },
    notConfirmed: ({ reason }) => ({ performed: false, reason }),
    run: async ({ ctx, prepared, confirmer, choice }) => { events.push('run'); return { input: prepared, human: confirmer.id, run: ctx.run.id, choice }; },
  };
  return { events, steps, handler: () => createApprovalHandler(steps, options.remembered === undefined ? {} : { remembered: options.remembered }) };
}

it('freezes input, actor and run before asynchronous preparation; forwards the offered choice', async () => {
  const h = harness({ answer: { confirmed: true, choice: 'delete-memory' } });
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  const prepare = h.steps.prepare;
  h.steps.prepare = async (required, options) => { await wait; return prepare(required, options); };
  const ctx = context(); const pending = h.handler()(ctx);
  (ctx.input as { target: string }).target = 'replacement'; Object.assign(ctx.principal, { id: 'other' }); Object.assign(ctx.run, { id: 'other-run' });
  release();
  expect(await pending).toEqual({ input: { target: 'original', decision: 'confirm' }, human: 'human', run: 'run', choice: 'delete-memory' });
  expect(h.events).toEqual(['prepare', 'ask', 'run']);
});

for (const reason of ['declined', 'expired', 'abandoned'] as const) {
  it(`${reason} cannot be overridden by model consent in input`, async () => {
    const h = harness({ answer: { confirmed: false, reason } });
    expect(await h.handler()(context())).toEqual({ performed: false, reason });
    expect(h.events).toEqual(['prepare', 'ask']);
  });
}

it('ordinary plans run with no human transport or remembered store access', async () => {
  const h = harness({ ask: false });
  h.steps.askHuman = async () => { throw new Error('must not ask'); };
  await h.handler()(context()); expect(h.events).toEqual(['prepare', 'run']);
});

it('remembers a human grant once, while another identity/version asks again', async () => {
  const grants = new Set<string>(); let asked = 0;
  const remembered: RememberedApprovalPort = { has: async ({ ctx, key }) => grants.has(`${ctx.principal.id}:${key}`), grant: async ({ key, confirmer }) => { grants.add(`${confirmer.id}:${key}`); } };
  for (const key of ['plugin@digest1', 'plugin@digest1', 'plugin@digest2']) {
    const h = harness({ remembered, key }); h.steps.askHuman = async () => { asked++; return { confirmed: true }; };
    await h.handler()(context());
  }
  expect(asked).toBe(2); expect(grants.size).toBe(2);
});

for (const stage of ['before', 'prepare', 'describe', 'lookup', 'ask', 'grant'] as const) {
  it(`abort at ${stage} prevents the effect`, async () => {
    const controller = new AbortController(); const h = harness();
    if (stage === 'before') controller.abort();
    if (stage === 'prepare') h.steps.prepare = async () => { controller.abort(); return {}; };
    if (stage === 'describe') h.steps.describe = () => { controller.abort(); return { ask: true, description: 'public' }; };
    if (stage === 'ask') h.steps.askHuman = async () => { controller.abort(); return { confirmed: true }; };
    const remembered: RememberedApprovalPort = { has: async () => { if (stage === 'lookup') controller.abort(); return false; }, grant: async () => { if (stage === 'grant') controller.abort(); } };
    h.steps.describe = stage === 'describe' ? h.steps.describe : () => ({ ask: true, description: 'public', rememberKey: 'plugin' });
    const handler = createApprovalHandler(h.steps, { remembered });
    expect(await handler(context(controller.signal))).toEqual({ performed: false, reason: 'abandoned' });
    expect(h.events).not.toContain('run');
  });
}

it('a failed grant fails closed before mutation', async () => {
  const h = harness({ key: 'plugin', remembered: { has: async () => false, grant: async () => { throw new Error('storage unavailable'); } } });
  await expect(h.handler()(context())).rejects.toThrow('storage unavailable');
  expect(h.events).toEqual(['prepare', 'ask']);
});

it('abort releases a host transport that never supplies a decision', async () => {
  const controller = new AbortController();
  const pending = resolveApproval({ signal: controller.signal, askHuman: () => new Promise(() => {}) });
  controller.abort();
  expect(await pending).toEqual({ confirmed: false, reason: 'abandoned' });
});

it('browser proposal transport shares fail-closed decisions, snapshots descriptions and redeems once', async () => {
  const store = createApprovalProposalStore<{ args: { target: string } }>({ responseTool: 'reply', messages: { closed: 'closed', missing: 'missing', pending: 'pending' } }, { createId: () => 'proposal' });
  const controller = new AbortController(); let calls = 0;
  const description = { args: { target: 'original' } };
  store.propose({ description, signal: controller.signal, execute: async () => { calls++; return 'done'; } });
  description.args.target = 'changed';
  expect(store.getSnapshot().pending?.description.args.target).toBe('original');
  store.getSnapshot().pending!.approvalId = 'forged';
  await expect(store.respond({ approvalId: 'forged', approved: true })).rejects.toThrow('missing');
  expect(() => store.propose({ description, signal: controller.signal, execute: async () => {} })).toThrow('pending');
  const pending = store.respond({ approvalId: 'proposal', approved: true });
  await expect(store.respond({ approvalId: 'proposal', approved: true })).rejects.toThrow('missing');
  expect(await pending).toBe('done'); expect(calls).toBe(1);
  store.propose({ description, signal: controller.signal, execute: async () => { calls++; } });
  controller.abort();
  expect(store.getSnapshot().pending).toBeNull();
  await expect(store.respond({ approvalId: 'proposal', approved: true })).rejects.toThrow('missing');
  expect(calls).toBe(1);
});

it('abort between a browser reply and effect prevents execution', async () => {
  const store = createApprovalProposalStore({ responseTool: 'reply', messages: { closed: 'closed', missing: 'missing', pending: 'pending' } }, { createId: () => 'proposal' });
  const controller = new AbortController(); let calls = 0;
  store.propose({ description: {}, signal: controller.signal, execute: async () => { calls++; } });
  const pending = store.respond({ approvalId: 'proposal', approved: true }); controller.abort();
  expect(await pending).toEqual({ status: 'declined' }); expect(calls).toBe(0);
});
