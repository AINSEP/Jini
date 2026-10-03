import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import {
  createAskChoiceTool, createAskChoiceAnswerTicketStore, ASK_CHOICE_ANSWER_TICKET_PARAM,
  type AskChoiceCall, type AskChoicePolicy,
} from '../index.js';
import { createSurfaceExchangeStore, messages, presentation, SURFACE_TYPED_ANSWER_PARAM, SURFACE_DISMISSED_PARAM } from './fixtures.js';

const question = { title: 'Pick a plan', singleSelect: { label: 'Plan', options: [{ value: 'now', label: 'Now' }] } };
const policy: AskChoicePolicy = {
  authorize: () => undefined,
  shapeError: ({ message }) => new Error(message),
  inputError: ({ message }) => new Error(message),
};

function setup() {
  const exchanges = createSurfaceExchangeStore();
  let nowMs = 0;
  let nextId = 0;
  const pending = createAskChoiceAnswerTicketStore({ now: () => nowMs, newTicketId: () => `t-${++nextId}`, ttlMs: 100 });
  const deps = {
    toolId: 'host_question', permission: 'host.ask', description: 'Host instructions',
    policy, presentation, pendingQuestions: pending, surfaceExchanges: exchanges, messages,
  };
  const context: AskChoiceCall = { principalId: 'human', input: question, signal: new AbortController().signal };
  return { exchanges, pending, deps, context, advance: (ms: number) => { nowMs = ms; } };
}

// Core typed-answer behavior generalized from the source HTTP integration suite.
test.each(['  use the preview  ', '', '   ', 12, null, {}, []])('typed response %j never invents an option value', async typed => {
  const { exchanges, deps, context } = setup();
  const tool = createAskChoiceTool(deps);
  const result = await tool.handler({ ctx: { ...context, emitSurface: async ({ emission }) => {
    const text = (emission.payload.resource as { resource: { text: string } }).resource.text;
    const form = JSON.parse(text) as { baseParams: { __exchangeId: string } };
    exchanges.deliver({ exchangeId: form.baseParams.__exchangeId, toolId: deps.toolId, principalId: context.principalId, params: { [SURFACE_TYPED_ANSWER_PARAM]: typed } });
  } } });
  expect(result).toEqual(typeof typed === 'string' && typed.trim()
    ? { submitted: true, freeText: typed.trim(), note: messages.typed }
    : { submitted: false, reason: 'no-answer', note: messages.noAnswer });
  expect(exchanges.size()).toBe(0);
});

test('cancel takes precedence over typed text and selections', async () => {
  const { exchanges, deps, context } = setup();
  const result = await createAskChoiceTool(deps).handler({ ctx: { ...context, emitSurface: async ({ emission }) => {
    const form = JSON.parse((emission.payload.resource as { resource: { text: string } }).resource.text);
    exchanges.deliver({ exchangeId: form.baseParams.__exchangeId, toolId: deps.toolId, principalId: context.principalId,
      params: { [SURFACE_DISMISSED_PARAM]: true, [SURFACE_TYPED_ANSWER_PARAM]: 'now', choice: 'now' } });
  } } });
  expect(result).toEqual({ submitted: false, reason: 'cancelled', note: messages.cancelled });
});

test('ticket expiration uses the injected clock and consumes at the exact deadline', () => {
  const { pending, advance } = setup();
  const ticket = pending.mint({ principalId: 'human', question });
  advance(100);
  expect(pending.redeem({ ticket, principalId: 'human', params: { choice: 'now' } })).toBe(false);
  advance(0);
  expect(pending.redeem({ ticket, principalId: 'human', params: { choice: 'now' } })).toBe(false);
});

test('wrong-principal probing burns a ticket and does not let the owner replay it', () => {
  const { pending } = setup();
  const ticket = pending.mint({ principalId: 'human', question });
  expect(pending.redeem({ ticket, principalId: 'other', params: { choice: 'now' } })).toBe(false);
  expect(pending.redeem({ ticket, principalId: 'human', params: { choice: 'now' } })).toBe(false);
});

test('ticket option bindings snapshot content rather than trusting caller mutation', () => {
  const { pending } = setup();
  const mutable = structuredClone(question);
  const ticket = pending.mint({ principalId: 'human', question: mutable });
  mutable.singleSelect.options[0]!.value = 'invented';
  expect(pending.redeem({ ticket, principalId: 'human', params: { choice: 'now' } })).toBe(true);
});

test('a host replaces policy, tool identity, presentation, and copy through wiring', async () => {
  const { deps, context } = setup();
  const forms: unknown[] = [];
  const tool = createAskChoiceTool({ ...deps, toolId: 'other_ask', permission: 'other.use',
    messages: { ...messages, pending: 'Choose when ready.' },
    presentation: { render: (form, options) => { forms.push({ ...form, ...options }); return { custom: true }; }, buildResult: args => args },
  });
  expect(tool.descriptor.id).toBe('other_ask');
  expect(tool.descriptor.authorization.permission).toBe('other.use');
  expect(await tool.handler({ ctx: context })).toEqual({ modelText: 'Choose when ready.', ui: { custom: true } });
  expect(forms).toEqual([{ toolName: 'other_ask', principalId: 'human', question, baseParams: { [ASK_CHOICE_ANSWER_TICKET_PARAM]: 't-1' } }]);
});

test.each([question, { choice: 'now', [ASK_CHOICE_ANSWER_TICKET_PARAM]: 't-1' }])('policy refusal has no surface or ticket effect', async input => {
  const { deps, context } = setup();
  const denied = new Error('Host denied this principal');
  const tool = createAskChoiceTool({ ...deps,
    policy: { ...policy, authorize: () => { throw denied; } },
    presentation: { ...presentation, render: () => { throw new Error('must not render'); } },
    pendingQuestions: { mint: () => { throw new Error('must not mint'); }, redeem: () => { throw new Error('must not redeem'); } },
  });
  await expect(tool.handler({ ctx: { ...context, input } })).rejects.toBe(denied);
});

test('render failure closes an exchange and invalidates an undisplayed fallback ticket', async () => {
  const { deps, context, exchanges, pending } = setup();
  const error = new Error('render failed');
  const tool = createAskChoiceTool({ ...deps, presentation: { ...presentation, render: () => { throw error; } } });
  await expect(tool.handler({ ctx: { ...context, emitSurface: async () => undefined } })).rejects.toBe(error);
  expect(exchanges.size()).toBe(0);
  await expect(tool.handler({ ctx: context })).rejects.toBe(error);
  expect(pending.redeem({ ticket: 't-1', principalId: 'human', params: { choice: 'now' } })).toBe(false);
});

test('result encoding failure invalidates a fallback ticket', async () => {
  const { deps, context, pending } = setup();
  const error = new Error('encoding failed');
  const tool = createAskChoiceTool({ ...deps, presentation: { ...presentation, buildResult: () => { throw error; } } });
  await expect(tool.handler({ ctx: context })).rejects.toBe(error);
  expect(pending.redeem({ ticket: 't-1', principalId: 'human', params: { choice: 'now' } })).toBe(false);
});

test('emission failure closes the live exchange', async () => {
  const { deps, context, exchanges } = setup();
  const error = new Error('emission failed');
  await expect(createAskChoiceTool(deps).handler({ ctx: { ...context, emitSurface: async () => { throw error; } } })).rejects.toBe(error);
  expect(exchanges.size()).toBe(0);
});

test('an already aborted call neither displays nor parks a question', async () => {
  const { deps, context, exchanges } = setup();
  const controller = new AbortController();
  controller.abort();
  const result = await createAskChoiceTool(deps).handler({ ctx: { ...context, signal: controller.signal, emitSurface: async () => { throw new Error('must not emit'); } } });
  expect(result).toEqual({ submitted: false, reason: 'abandoned', note: messages.abandoned });
  expect(exchanges.size()).toBe(0);
});

test('separate host stores do not redeem each other’s ticket', () => {
  const first = setup();
  const second = setup();
  const ticket = first.pending.mint({ principalId: 'human', question });
  expect(second.pending.redeem({ ticket, principalId: 'human', params: { choice: 'now' } })).toBe(false);
  expect(first.pending.redeem({ ticket, principalId: 'human', params: { choice: 'now' } })).toBe(true);
});

test.each([0, -1, Infinity, NaN])('invalid ticket lifetime %s fails before storage is used', ttlMs => {
  expect(() => createAskChoiceAnswerTicketStore({ now: () => 0, newTicketId: () => 'id', ttlMs })).toThrow('positive finite');
});

test.each(['', 'repeat'])('empty or repeated ticket ID %j cannot overwrite a live question', id => {
  const store = createAskChoiceAnswerTicketStore({ now: () => 0, newTicketId: () => id, ttlMs: 100 });
  if (id) store.mint({ principalId: 'human', question });
  expect(() => store.mint({ principalId: 'other', question })).toThrow('non-empty and unique');
  if (id) expect(store.redeem({ ticket: id, principalId: 'human', params: { choice: 'now' } })).toBe(true);
});

test.each([
  {}, { title: 'Missing fields' },
  { title: 'Bad group', singleSelect: null },
  { title: 'Bad options', singleSelect: { label: 'Plan', options: [] } },
  { title: 'Bad option', multiSelect: { label: 'Plan', options: [null] } },
  { title: 'Bad label', singleSelect: { label: 'Plan', options: [{ value: 'v', label: '' }] } },
])('malformed question %j rejects before rendering or minting', async input => {
  const { deps, context } = setup();
  const seen: string[] = [];
  const tool = createAskChoiceTool({ ...deps,
    policy: { ...policy, shapeError: ({ message, toolId, inputSchema }) => {
      seen.push(toolId);
      expect(inputSchema.required).toEqual(['title']);
      return new Error(message);
    } },
    pendingQuestions: { mint: () => { throw new Error('must not mint'); }, redeem: () => { throw new Error('must not redeem'); } },
    presentation: { ...presentation, render: () => { throw new Error('must not render'); } },
  });
  await expect(tool.handler({ ctx: { ...context, input } })).rejects.toThrow(/required|requires|must be an object/);
  expect(seen).toEqual([deps.toolId]);
});

test('subpath targets built code and declarations without replacing existing exports', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../../../package.json', import.meta.url), 'utf8'));
  expect(manifest.exports['./tools/ask-choice']).toEqual({
    types: './dist/tools/ask-choice/index.d.ts',
    import: './dist/tools/ask-choice/index.js',
    default: './dist/tools/ask-choice/index.js',
  });
  expect(manifest.exports['.'].import).toBe('./dist/index.js');
  expect(manifest.exports['./bin'].default).toBe('./dist/bin/serve.js');
});
