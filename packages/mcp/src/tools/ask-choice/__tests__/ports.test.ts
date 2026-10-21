import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import {
  ASK_CHOICE_INPUT_SCHEMA, askChoice, createAskChoiceTool, createAskChoiceAnswerTicketStore, ASK_CHOICE_ANSWER_TICKET_PARAM,
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
      // MOVE: Flat questions and legacy selects now declare their required fields per union branch.
      expect(inputSchema).toEqual(ASK_CHOICE_INPUT_SCHEMA);
      expect(inputSchema.anyOf).toEqual([
        { required: ['question', 'options'] }, { required: ['title', 'singleSelect'] }, { required: ['title', 'multiSelect'] },
      ]);
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

test.each([
  { action: 'use', selections: ['offered'], submitted: true },
  { action: 'auto', selections: ['offered'], submitted: true },
  { action: 'unoffered', selections: ['offered'], submitted: false },
  { action: 'auto', selections: ['unoffered'], submitted: false },
])('trusted host choice validates action and selection: %j', async ({ action, selections, submitted }) => {
  const exchanges = createSurfaceExchangeStore();
  const hostQuestion = { title: 'Host choice', multiSelect: { label: 'Matches', value: ['offered'], options: [{ value: 'offered', label: 'Offered' }] },
    actions: [{ id: 'use', label: 'Use' }, { id: 'auto', label: 'Always' }] };
  const exchange = exchanges.open({ toolId: 'host', principalId: 'human', emit: async ({ emission }) => {
    const form = JSON.parse((emission.payload.resource as { resource: { text: string } }).resource.text);
    expect(form.question.multiSelect.value).toEqual(['offered']);
    expect(form.question.actions).toEqual(hostQuestion.actions);
    expect(exchanges.deliver({ exchangeId: form.baseParams.__exchangeId, toolId: 'host', principalId: 'human', params: { __choiceAction: action, selections } }).ok).toBe(true);
  } });
  const result = await askChoice({ exchange, question: hostQuestion, toolId: 'host', principalId: 'human', presentation, messages, signal: new AbortController().signal });
  expect(result.submitted).toBe(submitted);
  if (submitted) expect(result).toMatchObject({ action, selections });
  else expect(result).toMatchObject({ reason: 'invalid-answer' });
  expect(exchanges.size()).toBe(0);
});

// Characterization pins (before refactor) for the live-exchange answer classification.
function liveCall(params: Record<string, unknown>, q: Record<string, unknown> = question) {
  const { exchanges, deps, context } = setup();
  const tool = createAskChoiceTool(deps);
  return tool.handler({ ctx: { ...context, input: q, emitSurface: async ({ emission }) => {
    const form = JSON.parse((emission.payload.resource as { resource: { text: string } }).resource.text) as { baseParams: { __exchangeId: string } };
    exchanges.deliver({ exchangeId: form.baseParams.__exchangeId, toolId: deps.toolId, principalId: context.principalId, params });
  } } });
}
// Actions are trusted host input: the model-facing handler never forwards them, so these go
// through askChoice directly, as a host would.
const withActions = { ...question, actions: [{ id: 'approve', label: 'Approve' }] };
function hostCall(params: Record<string, unknown>) {
  const exchanges = createSurfaceExchangeStore();
  const exchange = exchanges.open({ toolId: 'host_question', principalId: 'human', emit: async () => {
    exchanges.deliver({ exchangeId: exchange.id, toolId: 'host_question', principalId: 'human', params });
  } });
  return askChoice({ exchange, question: withActions, toolId: 'host_question', principalId: 'human', presentation, signal: new AbortController().signal, messages });
}

test('askChoice called directly with an already-aborted signal closes the exchange without emitting', async () => {
  const exchanges = createSurfaceExchangeStore();
  const controller = new AbortController();
  controller.abort();
  const emitted: unknown[] = [];
  const exchange = exchanges.open({ toolId: 'host_question', principalId: 'human', emit: async args => { emitted.push(args); } });
  const result = await askChoice({ exchange, question, toolId: 'host_question', principalId: 'human', presentation, signal: controller.signal, messages });
  expect(result).toEqual({ submitted: false, reason: 'abandoned', note: messages.abandoned });
  expect(emitted).toEqual([]);
  expect(exchanges.size()).toBe(0);
});

test('a live answer outside the offered options is refused as invalid-answer', async () => {
  expect(await liveCall({ choice: 'later' })).toEqual({ submitted: false, reason: 'invalid-answer', note: messages.noAnswer });
});

test('a live answer carrying an offered host action reports that action', async () => {
  expect(await hostCall({ choice: 'now', __choiceAction: 'approve' })).toEqual({ submitted: true, choice: 'now', action: 'approve', note: messages.submitted });
});

test('a live answer carrying an action the host did not offer is refused as invalid-answer', async () => {
  expect(await hostCall({ choice: 'now', __choiceAction: 'delete-all' })).toEqual({ submitted: false, reason: 'invalid-answer', note: messages.noAnswer });
});

test('model-supplied actions are ignored, so a live answer carries no action key even if one was posted', async () => {
  expect(await liveCall({ choice: 'now', __choiceAction: 'approve' }, withActions)).toEqual({ submitted: true, choice: 'now', note: messages.submitted });
});

test('a live answer with no choice and no selections reports no-answer', async () => {
  expect(await liveCall({ unrelated: 1 })).toEqual({ submitted: false, reason: 'no-answer', note: messages.noAnswer });
});

test('an exchange that expires reports the expired note', async () => {
  const exchanges = createSurfaceExchangeStore({ idleTtlMs: 1 });
  const { deps, context } = setup();
  const result = await createAskChoiceTool({ ...deps, surfaceExchanges: exchanges }).handler({ ctx: { ...context, emitSurface: async () => undefined } });
  expect(result).toEqual({ submitted: false, reason: 'expired', note: messages.expired });
});

test('a call that carries a title is a question even when it also carries a choice', async () => {
  const { deps, context } = setup();
  const result = await createAskChoiceTool({ ...deps, presentation: { ...presentation, buildResult: args => args } })
    .handler({ ctx: { ...context, input: { ...question, choice: 'now' } } });
  expect(result).toMatchObject({ modelText: messages.pending });
});

test('a non-object input is parsed as an empty question and refused through the shape policy', async () => {
  const { deps, context } = setup();
  await expect(createAskChoiceTool(deps).handler({ ctx: { ...context, input: 'just text' } })).rejects.toThrow(/title/i);
});

test('the default ticket store always mints a non-empty string ticket', () => {
  const store = createAskChoiceAnswerTicketStore({ now: () => 0, newTicketId: () => 'id-1', ttlMs: 10 });
  const ticket = store.mint({ principalId: 'human', question });
  expect(typeof ticket).toBe('string');
  expect(ticket.length).toBeGreaterThan(0);
});

test('an unexpected parse failure propagates as-is instead of being dressed up as a shape error', async () => {
  const { deps, context } = setup();
  const boom = new TypeError('singleSelect getter failed');
  // Malformed-input fixture: a hostile getter stands in for any non-shape failure inside parsing.
  const input = { title: 'Pick', get singleSelect(): unknown { throw boom; } };
  await expect(createAskChoiceTool(deps).handler({ ctx: { ...context, input } })).rejects.toBe(boom);
});

test.each([false, true])('flat model questions preserve the answer contract (multiple=%s)', async multiple => {
  const { deps, context } = setup();
  const tool = createAskChoiceTool(deps);
  const result = await tool.handler({ ctx: { ...context, input: { question: 'Pick a plan', options: [{ label: 'Now', description: 'Start immediately' }, { label: 'Later', value: 'wait' }], multiple } } });
  const content = result.content as Array<{ resource?: { text: string } }>;
  const form = JSON.parse(content[1]!.resource!.text) as { question: { title: string; singleSelect?: unknown; multiSelect?: unknown }; baseParams: Record<string, unknown> };
  const key = multiple ? 'multiSelect' : 'singleSelect';
  expect(form.question).toEqual({ title: 'Pick a plan', [key]: { label: 'Pick a plan', options: [{ label: 'Now', value: 'Now', description: 'Start immediately' }, { label: 'Later', value: 'wait' }] } });
  const answer = multiple ? { selections: ['Now', 'wait'] } : { choice: 'Now' };
  expect(await tool.handler({ ctx: { ...context, input: { ...form.baseParams, ...answer } } }))
    .toEqual({ submitted: true, ...answer, note: messages.submitted });
});

test('model schema advertises flat questions and nested aliases without form-generated answers', () => {
  const { deps } = setup();
  const schema = createAskChoiceTool(deps).descriptor.inputSchema;
  expect(schema.properties).toHaveProperty('question');
  expect(schema.properties).toHaveProperty('options');
  expect(schema.properties).toHaveProperty('singleSelect');
  expect(schema.properties).toHaveProperty('multiSelect');
  for (const field of ['choice', 'selections', '__askChoiceAnswerTicket', '__exchangeId', '__typedAnswer']) {
    expect(schema.properties).not.toHaveProperty(field);
  }
});

test('mixed flat and nested questions fail before rendering or minting a ticket', async () => {
  const { deps, context, pending } = setup();
  await expect(createAskChoiceTool(deps).handler({ ctx: { ...context, input: { ...question, question: 'Conflicting question', options: [{ label: 'Now' }] } } })).rejects.toThrow('do not mix');
  expect(pending.redeem({ ticket: 't-1', principalId: 'human', params: { choice: 'Now' } })).toBe(false);
});
