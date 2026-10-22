import { describe, expect, it, vi } from 'vitest';
import {
  applyBatchInputs, batchDescriptorFor, batchEligibilityFor, batchOutcomeFor, DEFAULT_MAX_BATCH_ITEMS, defaultBatchableTools, withBatchInput,
} from '../batch-tool-inputs.js';
import { ToolInputError } from '../tool-input-errors.js';
import type { ToolExecutionContext, ToolHandler, ToolRegistration } from '../tool-registry.js';

/**
 * @file Contract of the shared `items` batching wrapper: the published descriptor, the batch
 * input refusals, per-item isolation, the plan mode's pre-authorization normalization, and the
 * list-level application. `batch-tool-outcomes.test.ts` owns the outcome classification table.
 */

const schema = {
  type: 'object',
  properties: { path: { type: 'string' }, count: { type: 'integer' } },
  required: ['path'],
  additionalProperties: false,
};

function registrationWith(overrides: Partial<ToolRegistration> = {}): ToolRegistration {
  return {
    descriptor: { id: 'edit', description: 'Edits a file.', inputSchema: schema },
    policy: { authorize: () => 'allow' },
    handler: async () => 'single',
    ...overrides,
  };
}

function context(input: unknown, signal = new AbortController().signal): ToolExecutionContext {
  return { executionId: 'e', principal: { id: 'p' }, run: { id: 'r' }, signal, input } as ToolExecutionContext;
}

type Invoke = NonNullable<NonNullable<Parameters<ToolHandler>[1]>['invokeTool']>;

describe('batchDescriptorFor', () => {
  it('adds a bounded items array, moves required fields into its description and leaves the input untouched', () => {
    const descriptor = registrationWith().descriptor;
    const snapshot = structuredClone(descriptor);
    const batched = batchDescriptorFor({ descriptor, tool: { toolId: 'edit', maxItems: 3 } });
    const inputSchema = batched.inputSchema as { required?: unknown; properties: Record<string, { maxItems?: number; minItems?: number; description?: string }> };

    expect(descriptor).toEqual(snapshot);
    expect(inputSchema.required).toBeUndefined();
    expect(Object.keys(inputSchema.properties)).toEqual(['path', 'count', 'items']);
    expect(inputSchema.properties['items']).toMatchObject({ type: 'array', minItems: 1, maxItems: 3 });
    expect(inputSchema.properties['items']!.description).toContain('Each item needs path (inside each item).');
    expect(batched.description).toMatch(/^Edits a file\. Batch: .*\(up to 3\) in ONE call/);
  });

  it('defaults the cap, omits the per-item requirement when nothing is required and tolerates a missing description', () => {
    const batched = batchDescriptorFor({ descriptor: { id: 'list', inputSchema: { type: 'object', properties: {} } }, tool: { toolId: 'list' } });
    const items = (batched.inputSchema as { properties: { items: { maxItems: number; description: string } } }).properties.items;
    expect(items.maxItems).toBe(DEFAULT_MAX_BATCH_ITEMS);
    expect(items.description).not.toContain('Each item needs');
    expect(batched.description).toMatch(/^ Batch: /);
  });

  it.each([
    [undefined],
    [{ type: 'object' }],
    [{ type: 'object', properties: [] }],
  ])('refuses a tool whose inputSchema %j has no object properties', inputSchema => {
    expect(() => batchDescriptorFor({ descriptor: { id: 'raw', inputSchema }, tool: { toolId: 'raw' } }))
      .toThrow("batch-tool-inputs.ts: 'raw' publishes no object inputSchema, so it cannot take items");
  });

  it('refuses a tool that already owns an items input the batch field would shadow', () => {
    const inputSchema = { type: 'object', properties: { items: { type: 'array' } } };
    expect(() => batchDescriptorFor({ descriptor: { id: 'cart', inputSchema }, tool: { toolId: 'cart' } }))
      .toThrow("batch-tool-inputs.ts: 'cart' already has an 'items' input, so the batch field would shadow it");
  });
});

describe('withBatchInput item mode', () => {
  it('passes single calls and non-object inputs to the original handler unchanged', async () => {
    const handler = vi.fn<ToolHandler>(async () => 'single');
    const wrapped = withBatchInput({ registration: registrationWith({ handler }), tool: { toolId: 'edit' } });
    expect(await wrapped.handler(context({ path: 'a' }))).toBe('single');
    expect(await wrapped.handler(context('raw text'))).toBe('single');
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it.each([
    [{ items: [] }, "edit: 'items' must be a non-empty array of inputs"],
    [{ items: 'a,b' }, "edit: 'items' must be a non-empty array of inputs"],
    [{ items: [{}, {}, {}] }, "edit: 'items' has 3 entries; the most one call takes is 2. Split them into several calls."],
    [{ items: [{ path: 'a' }, ['b']] }, "edit: items[1] must be an object of this tool's input fields"],
  ])('refuses malformed batch input %j before invoking anything', async (input, message) => {
    const invokeTool = vi.fn<Invoke>();
    const wrapped = withBatchInput({ registration: registrationWith(), tool: { toolId: 'edit', maxItems: 2 } });
    await expect(wrapped.handler(context(input), { invokeTool })).rejects.toThrow(new ToolInputError({ message }));
    expect(invokeTool).not.toHaveBeenCalled();
  });

  it('layers item defaults under shared fields under the item, and attaches normalization notes to each result', async () => {
    const invokeTool = vi.fn<Invoke>(async ({ input }) => ({ echoed: input }));
    const wrapped = withBatchInput({ registration: registrationWith(), tool: { toolId: 'edit', itemDefaults: { count: 1 } } });
    const result = await wrapped.handler(context({ path: 'shared', items: [{}, { path: 'own', count: '7' }] }), { invokeTool });

    expect(invokeTool.mock.calls.map(([required]) => required.input)).toEqual([{ path: 'shared', count: 1 }, { path: 'own', count: 7 }]);
    expect(result).toEqual({
      batch: true, outcome: 'completed', total: 2, succeeded: 2, failed: 0,
      results: [
        { index: 0, ok: true, result: { echoed: { path: 'shared', count: 1 } } },
        { index: 1, ok: true, result: { echoed: { path: 'own', count: 7 }, normalizationNotes: ['count: string→integer'] } },
      ],
    });
  });

  it('records a validateItem refusal and a thrown non-Error as that item\'s failure while later items still run', async () => {
    const invokeTool = vi.fn<Invoke>(async ({ input }) => {
      if ((input as { path: string }).path === 'boom') throw 'plain string failure';
      return 'ok';
    });
    const validateItem = ({ input }: { input: unknown }) => {
      if ((input as { path: string }).path === 'forbidden') throw new Error('path is outside the window');
    };
    const wrapped = withBatchInput({ registration: registrationWith(), tool: { toolId: 'edit', validateItem } });
    const result = await wrapped.handler(context({ items: [{ path: 'forbidden' }, { path: 'boom' }, { path: 'fine' }] }), { invokeTool });

    expect(result).toEqual({
      batch: true, outcome: 'partial_failure', total: 3, succeeded: 1, failed: 2,
      results: [
        { index: 0, ok: false, error: 'path is outside the window' },
        { index: 1, ok: false, error: 'plain string failure' },
        { index: 2, ok: true, result: 'ok' },
      ],
    });
    expect(invokeTool).toHaveBeenCalledTimes(2);
  });

  it('strips the appended input schema from an item error, keeping only the domain message', async () => {
    const invokeTool: Invoke = async () => { throw new Error("path must be relative. Schema for 'edit': {\"type\":\"object\"}"); };
    const wrapped = withBatchInput({ registration: registrationWith(), tool: { toolId: 'edit' } });
    const result = await wrapped.handler(context({ items: [{ path: '/abs' }] }), { invokeTool });
    expect(result).toMatchObject({ outcome: 'error', isError: true, results: [{ index: 0, ok: false, error: 'path must be relative.' }] });
  });

  it('keeps a failed item\'s normalization notes alongside its error', async () => {
    const invokeTool: Invoke = async () => { throw new Error('denied'); };
    const wrapped = withBatchInput({ registration: registrationWith(), tool: { toolId: 'edit' } });
    const result = await wrapped.handler(context({ items: [{ path: 'a', count: '2' }] }), { invokeTool });
    expect(result).toMatchObject({ results: [{ index: 0, ok: false, error: 'denied\nnormalized: count: string→integer' }] });
  });

  it('fails every item when the executor supplied no gated invocation port', async () => {
    const wrapped = withBatchInput({ registration: registrationWith(), tool: { toolId: 'edit' } });
    const result = await wrapped.handler(context({ items: [{ path: 'a' }, { path: 'b' }] }));
    expect(result).toMatchObject({
      outcome: 'error', isError: true, succeeded: 0, failed: 2,
      results: [0, 1].map(index => ({ index, ok: false, error: 'edit: batch items require the gated ToolExecutor invocation port' })),
    });
  });

  it('reports a returned error envelope with its message, or a generic one when it carries none', async () => {
    const outputs = [{ isError: true, error: 'quota exceeded' }, { isError: true }, { batch: true, results: [{ ok: true }, { ok: false }] }];
    const invokeTool = vi.fn<Invoke>(async () => outputs.shift());
    const wrapped = withBatchInput({ registration: registrationWith(), tool: { toolId: 'edit' } });
    const result = await wrapped.handler(context({ items: [{ path: 'a' }, { path: 'b' }, { path: 'c' }] }), { invokeTool });
    expect(result).toMatchObject({
      outcome: 'error',
      results: [
        { index: 0, ok: false, error: 'quota exceeded' },
        { index: 1, ok: false, error: 'item returned an error' },
        { index: 2, ok: false, error: 'item returned an error' },
      ],
    });
  });

  it('stops between items once the call is aborted', async () => {
    const controller = new AbortController();
    const invokeTool = vi.fn<Invoke>(async () => { controller.abort(new Error('cancelled by user')); return 'first'; });
    const wrapped = withBatchInput({ registration: registrationWith(), tool: { toolId: 'edit' } });
    await expect(wrapped.handler(context({ items: [{ path: 'a' }, { path: 'b' }] }, controller.signal), { invokeTool })).rejects.toThrow('cancelled by user');
    expect(invokeTool).toHaveBeenCalledTimes(1);
  });

  it('defers domain normalization to each item but still applies it to single calls', async () => {
    const normalizeInput = vi.fn(async ({ input }: { input: Readonly<Record<string, unknown>> }) => ({ input: { ...input, path: 'domain' }, notes: ['domain alias'] }));
    const wrapped = withBatchInput({ registration: registrationWith({ normalizeInput }), tool: { toolId: 'edit' } });
    expect(await wrapped.normalizeInput!({ input: { items: [{ path: 'x' }] } })).toEqual({ input: { items: [{ path: 'x' }] }, notes: [] });
    expect(normalizeInput).not.toHaveBeenCalled();
    expect(await wrapped.normalizeInput!({ input: { path: 'x' } })).toEqual({ input: { path: 'domain' }, notes: ['domain alias'] });

    const plain = withBatchInput({ registration: registrationWith(), tool: { toolId: 'edit' } });
    expect(await plain.normalizeInput!({ input: { path: 'x' } })).toEqual({ input: { path: 'x' }, notes: [] });
  });
});

describe('withBatchInput plan mode', () => {
  it('keeps the combined approval handler and describes pre-authorization normalization', async () => {
    const handler = vi.fn<ToolHandler>(async () => 'plan applied');
    const wrapped = withBatchInput({ registration: registrationWith({ handler }), tool: { toolId: 'edit', maxItems: 4 } }, { mode: 'plan' });
    expect(wrapped.handler).toBe(handler);
    expect(wrapped.descriptor.description).toBe('Edits a file. Batch: up to 4 inputs are normalized before authorization and passed to the existing combined approval plan.');
    expect((wrapped.descriptor.inputSchema as { properties: Record<string, unknown> }).properties).toHaveProperty('items');
  });

  it('describes a plan batch even when the tool publishes no description of its own', () => {
    const wrapped = withBatchInput({ registration: registrationWith({ descriptor: { id: 'edit', inputSchema: schema } }), tool: { toolId: 'edit' } }, { mode: 'plan' });
    expect(wrapped.descriptor.description).toBe(` Batch: up to ${DEFAULT_MAX_BATCH_ITEMS} inputs are normalized before authorization and passed to the existing combined approval plan.`);
  });

  it('normalizes every merged item before the outer gate, validating each, without executing any', async () => {
    const validated: unknown[] = [];
    const handler = vi.fn<ToolHandler>();
    const wrapped = withBatchInput({
      registration: registrationWith({ handler }),
      tool: { toolId: 'edit', itemDefaults: { count: 1 }, validateItem: ({ input }) => { validated.push(input); } },
    }, { mode: 'plan' });
    const result = await wrapped.normalizeInput!({ input: { path: 'shared', items: [{}, { path: 'own', count: '3' }] } });

    expect(result).toEqual({ input: { items: [{ path: 'shared', count: 1 }, { path: 'own', count: 3 }] }, notes: ['count: string→integer'] });
    expect(validated).toEqual([{ path: 'shared', count: 1 }, { path: 'own', count: 3 }]);
    expect(handler).not.toHaveBeenCalled();
  });

  it('normalizes a single plan call like an unbatched tool and refuses a malformed items list', async () => {
    const wrapped = withBatchInput({ registration: registrationWith(), tool: { toolId: 'edit' } }, { mode: 'plan' });
    expect(await wrapped.normalizeInput!({ input: { path: 'a', count: '4' } })).toEqual({ input: { path: 'a', count: 4 }, notes: ['count: string→integer'] });
    await expect(wrapped.normalizeInput!({ input: { items: [] } })).rejects.toThrow("edit: 'items' must be a non-empty array of inputs");
  });

  it('propagates a validateItem refusal so the whole plan is rejected', async () => {
    const wrapped = withBatchInput({
      registration: registrationWith(),
      tool: { toolId: 'edit', validateItem: () => { throw new ToolInputError({ message: 'too wide' }); } },
    }, { mode: 'plan' });
    await expect(wrapped.normalizeInput!({ input: { items: [{ path: 'a' }] } })).rejects.toThrow('too wide');
  });
});

describe('applyBatchInputs', () => {
  it('wraps only listed, registered tools and returns every other registration as the same object, in order', () => {
    const edit = registrationWith();
    const read = registrationWith({ descriptor: { id: 'read', inputSchema: { type: 'object', properties: {} } } });
    const out = applyBatchInputs({ registrations: [read, edit] }, { tools: [{ toolId: 'edit' }, { toolId: 'absent' }] });
    expect(out[0]).toBe(read);
    expect(out[1]).not.toBe(edit);
    expect(out[1]!.descriptor.inputSchema).toMatchObject({ properties: { items: { type: 'array' } } });
    expect(out).toHaveLength(2);
  });

  it('changes nothing when no batchable tools are listed', () => {
    const edit = registrationWith();
    expect(applyBatchInputs({ registrations: [edit] })).toEqual([edit]);
    expect(applyBatchInputs({ registrations: [edit] })[0]).toBe(edit);
  });
});

describe('batchOutcomeFor', () => {
  it.each([null, 'text', { batch: true }, { batch: false, results: [{ ok: true }] }, { batch: true, results: [] }])('is undefined for the non-batch output %j', output => {
    expect(batchOutcomeFor({ output })).toBeUndefined();
  });

  it('counts only object items with ok:false as failures', () => {
    expect(batchOutcomeFor({ output: { batch: true, results: [null, 'x', { ok: true }] } })).toBe('completed');
  });
});

describe('default-on batching', () => {
  const objectSchema = (required: string[] = []) => ({ type: 'object', properties: { id: { type: 'string' } }, required });
  const tool = (id: string, inputSchema: unknown, readOnly?: boolean) =>
    registrationWith({ descriptor: { id, inputSchema: inputSchema as never, ...(readOnly === undefined ? {} : { readOnly }) } });

  it.each([
    ['a read-by-id tool', tool('get', objectSchema(['id']), true), 'batchable'],
    ['a mutating tool with no required input', tool('touch', objectSchema(), false), 'batchable'],
    ['a read-only list or search', tool('list', objectSchema(), true), 'list-read'],
    ['a read-only tool whose required is not a list', tool('odd', { ...objectSchema(), required: 'id' }, true), 'list-read'],
    ['a tool that already takes items', tool('menu', { type: 'object', properties: { items: { type: 'array' } } }), 'takes-items'],
    ['a tool with no object schema', tool('raw', undefined), 'no-object-schema'],
    ['a schema with no properties object', tool('bare', { type: 'object' }), 'no-object-schema'],
  ])('classifies %s', (_label, registration, expected) => {
    expect(batchEligibilityFor({ registration })).toBe(expected);
  });

  it('reports an opted-out tool before inspecting its schema', () => {
    expect(batchEligibilityFor({ registration: tool('raw', undefined) }, { optOut: new Set(['raw']) })).toBe('opted-out');
  });

  it('lists every eligible tool in order, merges host settings, and never revives an ineligible one', () => {
    const registrations = [
      tool('get', objectSchema(['id']), true), tool('list', objectSchema(), true),
      tool('deploy', objectSchema(['id'])), tool('tombstone', objectSchema(['id'])),
    ];
    const tools = defaultBatchableTools({ registrations }, {
      optOut: [{ toolId: 'deploy', reason: 'leaves the site' }],
      settings: [{ toolId: 'tombstone', maxItems: 100 }, { toolId: 'list', maxItems: 100 }],
    });
    expect(tools).toEqual([{ toolId: 'get' }, { toolId: 'tombstone', maxItems: 100 }]);
  });

  it('batches every eligible tool when the host names no opt-outs or settings', () => {
    expect(defaultBatchableTools({ registrations: [tool('get', objectSchema(['id']), true)] })).toEqual([{ toolId: 'get' }]);
  });
});
