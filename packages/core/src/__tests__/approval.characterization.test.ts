import { describe, expect, it, vi } from 'vitest';
import {
  applyApprovalPolicy, createApprovalHandler, createApprovalProposalStore, createBatchApprovalHandler, resolveApproval,
  type ApprovalAnswer, type ApprovalPlan, type ApprovalSteps, type RememberedApprovalPort,
} from '../approval.js';
import type { ToolExecutionContext, ToolRegistration } from '../tool-registry.js';

const context = (signal: AbortSignal = new AbortController().signal, input: unknown = { id: 'a' }): ToolExecutionContext =>
  ({ executionId: 'exec', run: { id: 'run' }, principal: { id: 'human' }, input, signal });

/** A real AbortSignal whose `aborted` reads true from the `flipAt`-th read on (1-based). */
function signalFlippingAt(flipAt: number): AbortSignal {
  const signal = new AbortController().signal;
  let reads = 0;
  Object.defineProperty(signal, 'aborted', { get: () => ++reads >= flipAt });
  return signal;
}

function harness({ plan = { ask: true, description: 'd' }, answer = { confirmed: true } }: { plan?: ApprovalPlan<string>; answer?: ApprovalAnswer } = {}) {
  const events: string[] = [];
  const steps: ApprovalSteps<string, string> = {
    prepare: async ({ ctx }) => { events.push('prepare'); return (ctx.input as { id: string }).id; },
    describe: () => { events.push('describe'); return plan; },
    askHuman: async () => { events.push('ask'); return answer; },
    run: async ({ prepared, choice }) => { events.push('run'); return { ran: prepared, choice }; },
    notConfirmed: ({ reason, prepared }) => ({ performed: false, reason, prepared }),
  };
  return { events, steps };
}

function store(grants: Set<string> = new Set()): { port: RememberedApprovalPort; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    port: {
      has: async ({ key }) => { calls.push(`has:${key}`); return grants.has(key); },
      grant: async ({ key, confirmer }) => { calls.push(`grant:${key}:${confirmer.id}:${confirmer.kind}`); grants.add(key); },
    },
  };
}

describe('resolveApproval', () => {
  it('answers abandoned without asking when the signal is already aborted', async () => {
    const controller = new AbortController(); controller.abort();
    const askHuman = vi.fn(async (): Promise<ApprovalAnswer> => ({ confirmed: true }));
    expect(await resolveApproval({ signal: controller.signal, askHuman })).toEqual({ confirmed: false, reason: 'abandoned' });
    expect(askHuman).not.toHaveBeenCalled();
  });

  it('returns the transport answer when not aborted', async () => {
    expect(await resolveApproval({ signal: new AbortController().signal, askHuman: async () => ({ confirmed: false, reason: 'expired' }) }))
      .toEqual({ confirmed: false, reason: 'expired' });
  });

  it('propagates a transport failure', async () => {
    await expect(resolveApproval({ signal: new AbortController().signal, askHuman: async () => { throw new Error('transport down'); } })).rejects.toThrow('transport down');
  });
});

describe('createApprovalHandler: the approval decision', () => {
  it('runs a plan that does not ask without consulting the remembered store', async () => {
    const h = harness({ plan: { ask: false, description: 'd', rememberKey: 'k' } }); const s = store();
    expect(await createApprovalHandler(h.steps, { remembered: s.port })(context())).toEqual({ ran: 'a', choice: undefined });
    expect(s.calls).toEqual([]);
    expect(h.events).toEqual(['prepare', 'describe', 'run']);
  });

  it('skips the human when the remembered store already holds the key, and grants nothing', async () => {
    const h = harness({ plan: { ask: true, description: 'd', rememberKey: 'k' } }); const s = store(new Set(['k']));
    expect(await createApprovalHandler(h.steps, { remembered: s.port })(context())).toEqual({ ran: 'a', choice: undefined });
    expect(s.calls).toEqual(['has:k']);
    expect(h.events).toEqual(['prepare', 'describe', 'run']);
  });

  it('asks and grants as the run principal when the key is not yet remembered', async () => {
    const h = harness({ plan: { ask: true, description: 'd', rememberKey: 'k' }, answer: { confirmed: true, choice: 'c' } }); const s = store();
    expect(await createApprovalHandler(h.steps, { remembered: s.port })(context())).toEqual({ ran: 'a', choice: 'c' });
    expect(s.calls).toEqual(['has:k', 'grant:k:human:user']);
  });

  it('asks every time and never stores when the plan has no remember key', async () => {
    const h = harness(); const s = store();
    await createApprovalHandler(h.steps, { remembered: s.port })(context());
    expect(s.calls).toEqual([]);
    expect(h.events).toEqual(['prepare', 'describe', 'ask', 'run']);
  });

  it('asks every time when a remember key is given but no store is configured', async () => {
    const h = harness({ plan: { ask: true, description: 'd', rememberKey: 'k' } });
    await createApprovalHandler(h.steps)(context());
    expect(h.events).toEqual(['prepare', 'describe', 'ask', 'run']);
  });

  it('does not grant a declined answer and returns the domain refusal with the prepared value', async () => {
    const h = harness({ plan: { ask: true, description: 'd', rememberKey: 'k' }, answer: { confirmed: false, reason: 'declined' } }); const s = store();
    expect(await createApprovalHandler(h.steps, { remembered: s.port })(context())).toEqual({ performed: false, reason: 'declined', prepared: 'a' });
    expect(s.calls).toEqual(['has:k']);
  });

  it('treats an answer whose confirmed is not exactly true as a refusal', async () => {
    const h = harness({ answer: { confirmed: 'yes', reason: 'expired' } as unknown as ApprovalAnswer }); // malformed transport answer, on purpose
    expect(await createApprovalHandler(h.steps)(context())).toEqual({ performed: false, reason: 'expired', prepared: 'a' });
    expect(h.events).not.toContain('run');
  });

  it('propagates a remembered-store lookup failure without asking or running', async () => {
    const h = harness({ plan: { ask: true, description: 'd', rememberKey: 'k' } });
    const port: RememberedApprovalPort = { has: async () => { throw new Error('store offline'); }, grant: async () => {} };
    await expect(createApprovalHandler(h.steps, { remembered: port })(context())).rejects.toThrow('store offline');
    expect(h.events).toEqual(['prepare', 'describe']);
  });

  it('passes the frozen description and options to the host transport', async () => {
    const h = harness({ plan: { ask: true, description: 'card' } });
    const seen: unknown[] = [];
    h.steps.askHuman = async (required, optional) => { seen.push(required.description, optional); return { confirmed: true }; };
    const options = { emitSurface: async () => {} };
    await createApprovalHandler(h.steps)(context(), options);
    expect(seen).toEqual(['card', options]);
  });
});

describe('createApprovalHandler: abort timing', () => {
  it('abandons before preparation with no prepared value', async () => {
    const controller = new AbortController(); controller.abort(); const h = harness();
    expect(await createApprovalHandler(h.steps)(context(controller.signal))).toEqual({ performed: false, reason: 'abandoned', prepared: undefined });
    expect(h.events).toEqual([]);
  });

  it('abandons after preparation with the prepared value and never describes', async () => {
    const h = harness();
    expect(await createApprovalHandler(h.steps)(context(signalFlippingAt(2)))).toEqual({ performed: false, reason: 'abandoned', prepared: 'a' });
    expect(h.events).toEqual(['prepare']);
  });

  // Reads: prepare x2, askHuman entry, then the run step's own check is the 4th.
  it('abandons in the run step when the abort lands after a non-asking plan was confirmed', async () => {
    const h = harness({ plan: { ask: false, description: 'd' } });
    expect(await createApprovalHandler(h.steps)(context(signalFlippingAt(4)))).toEqual({ performed: false, reason: 'abandoned', prepared: 'a' });
    expect(h.events).toEqual(['prepare', 'describe']);
  });

  it('abandons after a remembered lookup even when the key was granted', async () => {
    const h = harness({ plan: { ask: true, description: 'd', rememberKey: 'k' } }); const s = store(new Set(['k']));
    expect(await createApprovalHandler(h.steps, { remembered: s.port })(context(signalFlippingAt(4)))).toEqual({ performed: false, reason: 'abandoned', prepared: 'a' });
    expect(h.events).toEqual(['prepare', 'describe']);
  });

  it('abandons after a grant was stored', async () => {
    const controller = new AbortController(); const h = harness({ plan: { ask: true, description: 'd', rememberKey: 'k' } });
    const port: RememberedApprovalPort = { has: async () => false, grant: async () => { controller.abort(); } };
    expect(await createApprovalHandler(h.steps, { remembered: port })(context(controller.signal))).toEqual({ performed: false, reason: 'abandoned', prepared: 'a' });
    expect(h.events).toEqual(['prepare', 'describe', 'ask']);
  });
});

describe('createBatchApprovalHandler', () => {
  const batch = (overrides: Partial<ApprovalSteps<string, string>> = {}, optional: { maxItems?: number } = {}) => {
    const h = harness();
    const steps = { ...h.steps, ...overrides };
    return { events: h.events, handler: createBatchApprovalHandler({ steps, combineDescriptions: ({ descriptions }) => descriptions.join('+') }, optional) };
  };

  it('stops at the next item when the run aborts mid-batch and reports no prepared value', async () => {
    const controller = new AbortController(); let runs = 0;
    const b = batch({ run: async ({ prepared }) => { runs++; controller.abort(); return prepared; } });
    expect(await b.handler(context(controller.signal, { items: [{ id: 'a' }, { id: 'b' }] }))).toEqual({ performed: false, reason: 'abandoned', prepared: undefined });
    expect(runs).toBe(1);
  });

  it('hands the single prepared value to a declined scalar call', async () => {
    const b = batch({ askHuman: async () => ({ confirmed: false, reason: 'declined' }) });
    expect(await b.handler(context(undefined, { id: 'a' }))).toEqual({ performed: false, reason: 'declined', prepared: 'a' });
  });

  it('hands no prepared value to a declined batch', async () => {
    const b = batch({ askHuman: async () => ({ confirmed: false, reason: 'declined' }) });
    expect(await b.handler(context(undefined, { items: [{ id: 'a' }] }))).toEqual({ performed: false, reason: 'declined', prepared: undefined });
  });

  it('honours a custom maxItems in the refusal', async () => {
    const b = batch({}, { maxItems: 1 });
    await expect(b.handler(context(undefined, { items: [{ id: 'a' }, { id: 'b' }] }))).rejects.toThrow('items must contain between 1 and 1 inputs.');
  });

  it('merges shared fields into each item, item fields winning', async () => {
    const seen: unknown[] = [];
    const b = batch({ prepare: async ({ ctx }) => { seen.push(ctx.input); return 'x'; } });
    await b.handler(context(undefined, { mode: 'shared', items: [{ id: 'a' }, { id: 'b', mode: 'own' }] }));
    expect(seen).toEqual([{ mode: 'shared', id: 'a' }, { mode: 'own', id: 'b' }]);
  });

  it('refuses a nested items batch with its own message', async () => {
    await expect(batch().handler(context(undefined, { items: [{ items: [] }] }))).rejects.toThrow('Nested items batches are not supported.');
  });

  it('refuses duplicate items regardless of key order', async () => {
    await expect(batch().handler(context(undefined, { items: [{ id: 'a', s: 1 }, { s: 1, id: 'a' }] }))).rejects.toThrow('Duplicate batch inputs are not allowed.');
  });
});

describe('createApprovalProposalStore', () => {
  const messages = { closed: 'closed', pending: 'pending', missing: 'missing' };

  it('refuses a proposal whose signal is already aborted', () => {
    const controller = new AbortController(); controller.abort();
    const s = createApprovalProposalStore({ responseTool: 'reply', messages });
    expect(() => s.propose({ description: {}, execute: async () => {}, signal: controller.signal })).toThrow('closed');
  });

  it('uses a random UUID id by default and reports the response tool', () => {
    const s = createApprovalProposalStore({ responseTool: 'reply', messages });
    const proposal = s.propose({ description: { a: 1 }, execute: async () => {}, signal: new AbortController().signal });
    expect(proposal).toEqual({ status: 'approval_required', approvalId: expect.stringMatching(/^[0-9a-f-]{36}$/), description: { a: 1 }, responseTool: 'reply' });
  });

  it('notifies subscribers on change and stops after unsubscribe', () => {
    const s = createApprovalProposalStore({ responseTool: 'reply', messages }, { createId: () => 'p' });
    const listener = vi.fn();
    const unsubscribe = s.subscribe({ listener });
    const controller = new AbortController();
    s.propose({ description: {}, execute: async () => {}, signal: controller.signal });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    controller.abort();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('declines without executing when the reply is not exactly true', async () => {
    const s = createApprovalProposalStore({ responseTool: 'reply', messages }, { createId: () => 'p' });
    const execute = vi.fn(async () => 'done');
    s.propose({ description: {}, execute, signal: new AbortController().signal });
    expect(await s.respond({ approvalId: 'p', approved: false })).toEqual({ status: 'declined' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('publishes an Error message from a failed execution and rethrows it', async () => {
    const s = createApprovalProposalStore({ responseTool: 'reply', messages }, { createId: () => 'p' });
    const failure = new Error('effect failed');
    s.propose({ description: {}, execute: async () => { throw failure; }, signal: new AbortController().signal });
    await expect(s.respond({ approvalId: 'p', approved: true })).rejects.toBe(failure);
    expect(s.getSnapshot()).toEqual({ pending: null, error: 'effect failed' });
  });

  it('publishes a non-Error rejection as a string', async () => {
    const s = createApprovalProposalStore({ responseTool: 'reply', messages }, { createId: () => 'p' });
    s.propose({ description: {}, execute: () => Promise.reject(42), signal: new AbortController().signal });
    await expect(s.respond({ approvalId: 'p', approved: true })).rejects.toBe(42);
    expect(s.getSnapshot().error).toBe('42');
  });
});

describe('applyApprovalPolicy', () => {
  const registration = (): ToolRegistration => ({
    descriptor: { id: 'tool' },
    policy: { authorize: () => 'allow' },
    handler: async (ctx) => ({ handled: ctx.input }),
  });

  const policy = (asks: boolean, answer: ApprovalAnswer = { confirmed: true }, optional = {}) => {
    const seen: unknown[] = [];
    const base = registration();
    const applied = applyApprovalPolicy({
      registration: base,
      classify: ({ input }) => { seen.push(['classify', input]); return 'risky'; },
      asks: ({ class: kind }) => { seen.push(['asks', kind]); return asks; },
      describe: async ({ class: kind }) => `describe ${kind}`,
      askHuman: async ({ description }) => { seen.push(['ask', description]); return answer; },
      notConfirmed: ({ reason, prepared }) => ({ refused: reason, prepared }),
    }, optional);
    return { seen, base, applied };
  };

  it('keeps every registration field except the handler', () => {
    const { base, applied } = policy(false);
    expect({ ...applied, handler: base.handler }).toEqual(base);
    expect(applied.handler).not.toBe(base.handler);
  });

  it('runs the original handler without asking when the class does not ask', async () => {
    const { seen, applied } = policy(false);
    expect(await applied.handler(context(undefined, { x: 1 }))).toEqual({ handled: { x: 1 } });
    expect(seen).toEqual([['classify', { x: 1 }], ['asks', 'risky']]);
  });

  it('asks with the described class and refuses with the class as prepared value', async () => {
    const { seen, applied } = policy(true, { confirmed: false, reason: 'declined' });
    expect(await applied.handler(context(undefined, { x: 1 }))).toEqual({ refused: 'declined', prepared: 'risky' });
    expect(seen).toContainEqual(['ask', 'describe risky']);
  });

  // Policy plans never carry a rememberKey, so the remembered option cannot take effect here.
  it('never consults a supplied remembered store because policy plans carry no remember key', async () => {
    const s = store();
    const base = registration();
    const applied = applyApprovalPolicy({
      registration: base, classify: () => 'c', asks: () => true, describe: async () => 'd',
      askHuman: async () => ({ confirmed: true }), notConfirmed: () => null,
    }, { remembered: s.port });
    await applied.handler(context());
    expect(s.calls).toEqual([]);
  });
});
