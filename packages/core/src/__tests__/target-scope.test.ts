import { expect, it, vi } from 'vitest';
import { applyTargetScope, type TargetResolution } from '../index.js';
import { ToolInputError, type ToolDescriptor, type ToolExecutionContext, type ToolHandler, type ToolRegistration } from '../tool-registry.js';

const context = (input: unknown): ToolExecutionContext => ({
  executionId: 'exec', run: { id: 'run' }, principal: { id: 'current-reader' }, input,
  signal: new AbortController().signal,
});
function registration(descriptor: Partial<Omit<ToolDescriptor, 'readOnly'>> & { readOnly?: boolean | undefined } = {}) {
  const handler = vi.fn<ToolHandler>(async () => 'original');
  const { readOnly: declaredReadOnly, ...rest } = descriptor;
  const readOnly = Object.hasOwn(descriptor, 'readOnly') ? declaredReadOnly : true;
  return { descriptor: { id: 'read', ...rest, ...(readOnly === undefined ? {} : { readOnly }) }, handler, policy: { authorize: () => 'allow' as const } };
}
function ports() {
  return {
    resolveTarget: vi.fn<(required: { target: string; toolId: string; principal: ToolExecutionContext['principal'] }) => Promise<TargetResolution>>(async () => 'current'),
    isCurrentTarget: vi.fn<(required: { target: string }) => boolean | Promise<boolean>>(({ target }) => target === 'a'),
  };
}

it('declares the guarded target on writes and unclassified tools as well as scoped reads', () => {
  const required = Object.freeze(['query']);
  const properties = Object.freeze({ query: { type: 'string' } });
  const schema = Object.freeze({ type: 'object', properties, required, additionalProperties: false });
  const metadata = { approval: { class: 'read', confirmation: 'direct' } } as const;
  const read = registration({ inputSchema: schema, description: 'Read records', requiresConfirmation: true, metadata });
  const write = registration({ id: 'write', readOnly: false, inputSchema: schema });
  const unclassified = registration({ id: 'unknown', readOnly: undefined, inputSchema: schema });
  const registrations = Object.freeze([read, write, unclassified]);
  const transformed = applyTargetScope({ registrations, ...ports() });
  expect(transformed).not.toBe(registrations);
  expect(transformed.map(entry => entry.descriptor.id)).toEqual(['read', 'write', 'unknown']);
  expect(transformed[0]!.descriptor).toEqual({ ...read.descriptor, inputSchema: {
    ...schema, properties: { query: properties.query, site: { type: 'string', description: expect.any(String) } },
  } });
  expect(transformed[0]!.descriptor.inputSchema).not.toBe(schema);
  expect((transformed[0]!.descriptor.inputSchema as typeof schema).required).toBe(required);
  expect(schema.properties).toEqual({ query: { type: 'string' } });
  expect(transformed[0]!.policy).toBe(read.policy);
  expect(transformed[0]!.descriptor.metadata).toBe(metadata);
  expect(transformed[1]!.descriptor.inputSchema).toEqual(transformed[0]!.descriptor.inputSchema);
  expect(transformed[2]!.descriptor.inputSchema).toEqual(transformed[0]!.descriptor.inputSchema);
});

it('creates a minimal schema when absent and accepts object schemas without properties or type', () => {
  for (const inputSchema of [undefined, { type: 'object' }, { properties: {} }]) {
    const [read] = applyTargetScope({ registrations: [registration({ inputSchema })], ...ports() }, { describeParam: 'Optional target name.' });
    expect(read!.descriptor.inputSchema).toEqual({
      ...(inputSchema ?? { type: 'object' }), properties: { site: { type: 'string', description: 'Optional target name.' } },
    });
  }
});

it('leaves unsupported schema shapes unchanged', () => {
  class Schema { type = 'object'; }
  for (const inputSchema of [null, true, 'schema', [], {}, { type: 'string' }, { properties: [] }, new Schema()]) {
    const [read] = applyTargetScope({ registrations: [registration({ inputSchema })], ...ports() });
    expect(read!.descriptor.inputSchema).toBe(inputSchema);
  }
});

it('a host allowlist can exclude reads but cannot widen scope to writes or unclassified tools', async () => {
  for (const readOnly of [true, false, undefined]) {
    const original = registration({ readOnly, inputSchema: { type: 'object' } });
    const host = ports();
    const [tool] = applyTargetScope({ registrations: [original], ...host }, { scoped: () => readOnly !== true });
    expect(tool!.descriptor.inputSchema).toEqual({ type: 'object', properties: { site: { type: 'string', description: expect.any(String) } } });
    const pending = tool!.handler(context({ site: 'b' }));
    await expect(pending).rejects.toThrow(ToolInputError);
    await expect(pending).rejects.toThrow('This tool runs only on the current target.');
    expect(host.isCurrentTarget).toHaveBeenCalledWith({ target: 'b' });
    expect(host.resolveTarget).not.toHaveBeenCalled();
    expect(original.handler).not.toHaveBeenCalled();
  }
});

it('returns a tool with its own target property unchanged before consulting the scope predicate', async () => {
  const original = registration({ inputSchema: { type: 'object', properties: { site: { type: 'number' } } } });
  const host = ports(); const scoped = vi.fn(() => true);
  const [tool] = applyTargetScope({ registrations: [original], ...host }, { scoped });
  const ctx = context({ site: 42 });
  expect(tool).toBe(original);
  await tool!.handler(ctx);
  expect(original.handler).toHaveBeenCalledWith(ctx);
  expect(scoped).not.toHaveBeenCalled();
  expect(host.resolveTarget).not.toHaveBeenCalled();
  expect(host.isCurrentTarget).not.toHaveBeenCalled();
});

it('a current target calls the original handler with stripped input, original principal and options', async () => {
  const original = registration(); const host = ports();
  const [tool] = applyTargetScope({ registrations: [original], ...host });
  const ctx = context(Object.freeze({ site: 'a', query: 'all' }));
  const optional = { emitSurface: vi.fn(async () => {}) };
  expect(await tool!.handler(ctx, optional)).toBe('original');
  expect(host.resolveTarget).toHaveBeenCalledTimes(1);
  expect(host.resolveTarget).toHaveBeenCalledWith({ target: 'a', toolId: 'read', principal: ctx.principal });
  expect(original.handler).toHaveBeenCalledTimes(1);
  expect(original.handler).toHaveBeenCalledWith({ ...ctx, input: { query: 'all' } }, optional);
  expect(original.handler.mock.calls[0]![0].principal).toBe(ctx.principal);
  expect(ctx.input).toEqual({ site: 'a', query: 'all' });
  expect(host.isCurrentTarget).not.toHaveBeenCalled();
});

it('a peer target calls only the peer handler with the peer principal and stripped input', async () => {
  const original = registration(); const host = ports();
  const handler = vi.fn<ToolHandler>(async () => 'peer result');
  const principal = { id: 'peer-reader', roles: ['reader'] };
  host.resolveTarget.mockResolvedValue({ handler, principal });
  const [tool] = applyTargetScope({ registrations: [original], ...host });
  const ctx = context({ site: 'b', query: 'all' }); const optional = { emitSurface: vi.fn(async () => {}) };
  expect(await tool!.handler(ctx, optional)).toBe('peer result');
  expect(host.resolveTarget).toHaveBeenCalledTimes(1);
  expect(host.resolveTarget).toHaveBeenCalledWith({ target: 'b', toolId: 'read', principal: ctx.principal });
  expect(handler).toHaveBeenCalledTimes(1);
  expect(handler).toHaveBeenCalledWith({ ...ctx, input: { query: 'all' }, principal }, optional);
  expect(handler.mock.calls[0]![0].principal).toBe(principal);
  expect(original.handler).not.toHaveBeenCalled();
  expect(host.isCurrentTarget).not.toHaveBeenCalled();
});

it('refuses foreign writes with the configured input error and runs current writes with stripped input', async () => {
  const original = registration({ readOnly: false }); const host = ports();
  host.isCurrentTarget.mockImplementation(async ({ target }) => target === 'a');
  const [tool] = applyTargetScope({ registrations: [original], ...host }, { refuseMessage: 'Use the current target.' });
  const pending = tool!.handler(context({ site: 'b' }));
  await expect(pending).rejects.toBeInstanceOf(ToolInputError);
  await expect(pending).rejects.toThrow('Use the current target.');
  expect(original.handler).not.toHaveBeenCalled();
  const ctx = context({ site: 'a', value: 1 }); const optional = {};
  expect(await tool!.handler(ctx, optional)).toBe('original');
  expect(original.handler).toHaveBeenCalledTimes(1);
  expect(original.handler).toHaveBeenCalledWith({ ...ctx, input: { value: 1 } }, optional);
  expect(host.resolveTarget).not.toHaveBeenCalled();
});

it('propagates the host resolver error unchanged without running a handler', async () => {
  const original = registration(); const host = ports(); const error = new Error('Unknown site: missing');
  host.resolveTarget.mockRejectedValue(error);
  const [tool] = applyTargetScope({ registrations: [original], ...host });
  await expect(tool!.handler(context({ site: 'missing' }))).rejects.toBe(error);
  expect(original.handler).not.toHaveBeenCalled();
});

it('passes inputs without a top-level target through by identity and never calls host ports', async () => {
  class Input { site = 'b'; }
  for (const readOnly of [true, false, undefined]) {
    const original = registration({ readOnly }); const host = ports();
    const [tool] = applyTargetScope({ registrations: [original], ...host });
    for (const input of [{ query: 'all' }, { items: [{ site: 'b' }] }, null, undefined, ['b'], 'b', new Input()]) {
      const ctx = context(input);
      await tool!.handler(ctx);
      expect(original.handler.mock.calls.at(-1)![0]).toBe(ctx);
      expect(ctx.input).toBe(input);
    }
    expect(host.resolveTarget).not.toHaveBeenCalled();
    expect(host.isCurrentTarget).not.toHaveBeenCalled();
  }
});

it('strips only the top-level target and preserves nested items by identity', async () => {
  const original = registration(); const items = [{ site: 'b' }];
  const [tool] = applyTargetScope({ registrations: [original], ...ports() });
  await tool!.handler(context({ site: 'a', items }));
  expect(original.handler.mock.calls[0]![0].input).toEqual({ items: [{ site: 'b' }] });
  expect((original.handler.mock.calls[0]![0].input as { items: unknown }).items).toBe(items);
});

it('rejects non-string targets on reads and writes before invoking any host port or handler', async () => {
  for (const readOnly of [true, false]) {
    const original = registration({ readOnly }); const host = ports();
    const [tool] = applyTargetScope({ registrations: [original], ...host });
    for (const site of [42, null, undefined, {}, [], false]) {
      const pending = tool!.handler(context({ site }));
      await expect(pending).rejects.toBeInstanceOf(ToolInputError);
      await expect(pending).rejects.toThrow('site must be a string');
    }
    expect(host.resolveTarget).not.toHaveBeenCalled();
    expect(host.isCurrentTarget).not.toHaveBeenCalled();
    expect(original.handler).not.toHaveBeenCalled();
  }
});

it('uses a custom parameter name for schemas, routing, stripping, ownership and errors', async () => {
  const original = registration(); const host = ports();
  const [tool] = applyTargetScope({ registrations: [original], ...host }, { param: 'workspace', describeParam: 'Workspace name.' });
  expect(tool!.descriptor.inputSchema).toEqual({ type: 'object', properties: { workspace: { type: 'string', description: 'Workspace name.' } } });
  const ctx = context({ workspace: 'a', site: 'domain-input' });
  await tool!.handler(ctx);
  expect(host.resolveTarget).toHaveBeenCalledWith({ target: 'a', toolId: 'read', principal: ctx.principal });
  expect(original.handler).toHaveBeenCalledWith({ ...ctx, input: { site: 'domain-input' } }, undefined);
  await expect(tool!.handler(context({ workspace: 1 }))).rejects.toThrow('workspace must be a string');
  const own = registration({ inputSchema: { properties: { workspace: { type: 'number' } } } });
  expect(applyTargetScope({ registrations: [own], ...host }, { param: 'workspace' })[0]).toBe(own);
  const write = registration({ readOnly: false });
  const [unscoped] = applyTargetScope({ registrations: [write], ...host }, { param: 'workspace' });
  await expect(unscoped!.handler(context({ workspace: 'b' }))).rejects.toThrow(ToolInputError);
  expect(host.isCurrentTarget).toHaveBeenCalledWith({ target: 'b' });
  expect(write.handler).not.toHaveBeenCalled();
});

it('returns a new empty array for an empty catalog without consulting host ports', () => {
  const registrations: readonly ToolRegistration[] = []; const host = ports();
  const result = applyTargetScope({ registrations, ...host });
  expect(result).toEqual([]); expect(result).not.toBe(registrations);
  expect(host.resolveTarget).not.toHaveBeenCalled(); expect(host.isCurrentTarget).not.toHaveBeenCalled();
});

// normalizeInput is the pre-policy gate: a foreign target on an unscoped tool must be refused
// before any approval plan is built, after the tool's own domain normalization has run.
it('refuses a foreign or non-string target on an unscoped tool during normalization, after domain normalization', async () => {
  const write = { ...registration({ id: 'write', readOnly: false }), normalizeInput: vi.fn(async ({ input }: { input: Readonly<Record<string, unknown>> }) => ({ input: { ...input, normalized: true }, notes: ['domain'] })) };
  const port = ports();
  const [wrapped] = applyTargetScope({ registrations: [write], ...port });

  expect(await wrapped!.normalizeInput!({ input: { site: 'a', title: 't' } })).toEqual({ input: { site: 'a', title: 't', normalized: true }, notes: ['domain'] });
  expect(port.isCurrentTarget).toHaveBeenCalledWith({ target: 'a' });
  await expect(wrapped!.normalizeInput!({ input: { site: 'b' } })).rejects.toThrow(new ToolInputError({ message: 'This tool runs only on the current target.' }));
  await expect(wrapped!.normalizeInput!({ input: { site: 3 } })).rejects.toThrow(new ToolInputError({ message: 'site must be a string' }));
  expect(await wrapped!.normalizeInput!({ input: { title: 't' } })).toEqual({ input: { title: 't', normalized: true }, notes: ['domain'] });
  expect(write.normalizeInput).toHaveBeenCalledTimes(4);
});

it('passes input through normalization untouched for a tool without its own normalizer, and never checks a scoped read', async () => {
  const port = ports();
  const [read, write] = applyTargetScope({ registrations: [registration(), registration({ id: 'write', readOnly: false })], ...port }, { refuseMessage: 'Wrong site.' });

  expect(await read!.normalizeInput!({ input: { site: 'b' } })).toEqual({ input: { site: 'b' }, notes: [] });
  expect(port.isCurrentTarget).not.toHaveBeenCalled();
  await expect(write!.normalizeInput!({ input: { site: 'b' } })).rejects.toThrow('Wrong site.');
});

it('leaves a non-object normalized input for the handler to reject', async () => {
  const write = { ...registration({ id: 'write', readOnly: false }), normalizeInput: async () => ({ input: ['site'] as unknown as Record<string, unknown>, notes: [] }) };
  const port = ports();
  const [wrapped] = applyTargetScope({ registrations: [write], ...port });
  expect(await wrapped!.normalizeInput!({ input: { site: 'b' } })).toEqual({ input: ['site'], notes: [] });
  expect(port.isCurrentTarget).not.toHaveBeenCalled();
});
