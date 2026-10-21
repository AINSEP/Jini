import { describe, expect, it } from 'vitest';
import { createToolExposure, createToolNameMap, ToolExposureError } from '../index.js';
import { createToolRegistrationScope, createToolRegistry, type ToolDescriptor, type ToolRegistry } from '../tool-registry.js';

function register(registry: ToolRegistry, descriptor: ToolDescriptor): void {
  registry.register({ descriptor, handler: async () => 'executor-owned', policy: { authorize: () => 'deny' } });
}

function registryWith(descriptors: readonly ToolDescriptor[]): ToolRegistry {
  const registry = createToolRegistry({});
  for (const descriptor of descriptors) register(registry, descriptor);
  return registry;
}

describe('wire-name projection', () => {
  it('round trips dotted, long, Unicode, empty and prototype-like IDs within conservative wire limits', () => {
    const ids = ['content_read.menu', 'a'.repeat(300), 'region/☃', '', '7pages', '__proto__', 'constructor', 'safe_name'];
    const names = createToolNameMap({ toolIds: ids });
    const wires = ids.map(toolId => names.wireNameFor({ toolId })!);
    expect(new Set(wires).size).toBe(ids.length);
    for (const [i, wireName] of wires.entries()) {
      expect(wireName).toMatch(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/);
      expect(names.toolIdFor({ wireName })).toBe(ids[i]);
    }
    expect(names.wireNameFor({ toolId: 'safe_name' })).toBe('safe_name');
    expect(names.wireNameFor({ toolId: 'missing' })).toBeUndefined();
    expect(names.toolIdFor({ wireName: 'missing' })).toBeUndefined();
    expect(names.toolIdFor({ wireName: 'content_read.menu' })).toBeUndefined();
  });

  it('reserves native and transport names and resolves collisions independently of source order', () => {
    const dotted = 'content_read.menu';
    const derived = createToolNameMap({ toolIds: [dotted] }).wireNameFor({ toolId: dotted })!;
    const ids = [dotted, derived, `${derived}_1`, dotted, 'describe_tool'];
    const options = { reservedNames: ['describe_tool'] };
    const first = createToolNameMap({ toolIds: ids }, options);
    const second = createToolNameMap({ toolIds: [...ids].reverse() }, options);
    expect(first.wireNameFor({ toolId: derived })).toBe(derived);
    expect(first.wireNameFor({ toolId: dotted })).toBe(`${derived}_2`);
    expect(first.wireNameFor({ toolId: 'describe_tool' })).toBe('describe_tool_1');
    for (const toolId of new Set(ids)) {
      const wireName = first.wireNameFor({ toolId })!;
      expect(second.wireNameFor({ toolId })).toBe(wireName);
      expect(first.toolIdFor({ wireName })).toBe(toolId);
    }
    expect(first.toolIdFor({ wireName: 'describe_tool' })).toBeUndefined();
  });

  it('keeps collision suffixes inside the maximum name length', () => {
    const toolId = 'a'.repeat(64);
    const names = createToolNameMap({ toolIds: [toolId] }, { reservedNames: [toolId] });
    const wireName = `${'a'.repeat(62)}_1`;
    expect(names.wireNameFor({ toolId })).toBe(wireName);
    expect(names.toolIdFor({ wireName })).toBe(toolId);
  });
});

describe('run-scoped exposure', () => {
  it('isolates promotions, revisions and reverse lookup across two runs', () => {
    const registry = registryWith([{ id: 'one.read' }, { id: 'two.write' }]);
    const first = createToolExposure({ registry });
    const second = createToolExposure({ registry });
    const initial = first.getSnapshot({});
    const delta = first.promote({ toolIds: ['one.read'] });
    expect(delta.added).toEqual(['one.read']);
    expect(delta.skipped).toEqual([]);
    expect(delta.snapshot.revision).toBe(1);
    expect(initial).toEqual({ revision: 0, tools: [], schemaBytes: 0 });
    expect(second.getSnapshot({})).toEqual(initial);
    const wireName = delta.snapshot.tools[0]!.wireName;
    expect(first.resolveToolId({ wireName })).toBe('one.read');
    expect(second.resolveToolId({ wireName })).toBeUndefined();
    second.promote({ toolIds: ['two.write'] });
    expect(first.getSnapshot({}).tools.map(tool => tool.descriptor.id)).toEqual(['one.read']);
    expect(second.getSnapshot({}).tools.map(tool => tool.descriptor.id)).toEqual(['two.write']);
    expect(Object.keys(first).sort()).toEqual(['getSnapshot', 'promote', 'resolveToolId']);
  });

  it('serializes concurrent promotions without duplicate publication, lost updates or mutable old snapshots', async () => {
    const registry = registryWith([{ id: 'one' }, { id: 'two' }, { id: 'three' }]);
    const scope = createToolExposure({ registry });
    const deltas = await Promise.all([
      Promise.resolve().then(() => scope.promote({ toolIds: ['one', 'one'] })),
      Promise.resolve().then(() => scope.promote({ toolIds: ['one', 'two'] })),
      Promise.resolve().then(() => scope.promote({ toolIds: ['three', 'two'] })),
    ]);
    expect(deltas.map(delta => delta.added)).toEqual([['one'], ['two'], ['three']]);
    expect(deltas.map(delta => delta.snapshot.revision)).toEqual([1, 2, 3]);
    expect(deltas[0]!.snapshot.tools.map(tool => tool.descriptor.id)).toEqual(['one']);
    expect(scope.getSnapshot({}).tools.map(tool => tool.descriptor.id)).toEqual(['one', 'two', 'three']);
    const repeated = scope.promote({ toolIds: ['three', 'two', 'one'] });
    expect(repeated.added).toEqual([]);
    expect(repeated.snapshot).toBe(deltas[2]!.snapshot);
  });

  it('preserves schemas and metadata exactly while detaching and deeply freezing published data', () => {
    const schema = {
      type: 'object', required: ['id'], additionalProperties: false,
      properties: { id: { type: 'string' }, mode: { enum: [1, 2, null] }, child: { $ref: '#/$defs/child' } },
      $defs: { child: { type: 'object', properties: { next: { $ref: '#/$defs/child' } } } },
    };
    const metadata = { search: { queries: ['lookup'] } };
    const descriptor = { id: 'read.card', inputSchema: schema, metadata, readOnly: true, requiresConfirmation: true,
      timeoutMs: 10, maxOutputBytes: 100, sideEffects: 'none' as const, description: 'Original' };
    const registry = registryWith([descriptor]);
    const scope = createToolExposure({ registry });
    const delta = scope.promote({ toolIds: [descriptor.id] });
    const exposed = delta.snapshot.tools[0]!.descriptor;
    expect(exposed).toEqual(descriptor);
    expect(exposed).not.toBe(descriptor);
    expect(exposed.inputSchema).not.toBe(schema);
    expect(Reflect.set(exposed, 'description', 'overwrite')).toBe(false);
    const pinned = exposed.inputSchema as typeof schema;
    expect(Reflect.set(pinned.properties.id, 'type', 'number')).toBe(false);
    expect(() => pinned.required.push('changed')).toThrow(TypeError);
    expect(() => (exposed.metadata!.search!.queries as string[]).push('changed')).toThrow(TypeError);
    expect(Object.isFrozen(delta)).toBe(true);
    expect(Object.isFrozen(delta.snapshot.tools[0])).toBe(true);
    schema.properties.id.type = 'number';
    metadata.search.queries.push('new');
    descriptor.description = 'Changed at source';
    expect(pinned.properties.id.type).toBe('string');
    expect(exposed.metadata!.search!.queries).toEqual(['lookup']);
    expect(exposed.description).toBe('Original');
    expect(registry.list({})[0]).toBe(descriptor);
    expect(Object.isFrozen(descriptor)).toBe(false);
  });

  it('pins a definition across registry replacement and leaves revocation to the existing registry owner', () => {
    const registry = createToolRegistry({});
    const registrations = createToolRegistrationScope({ registry });
    const replacement = (description: string) => ({ descriptor: { id: 'read.card', description },
      handler: async () => null, policy: { authorize: () => 'deny' as const } });
    registrations.replace({ registrations: [replacement('v1')] });
    const scope = createToolExposure({ registry });
    const first = scope.promote({ toolIds: ['read.card'] }).snapshot;
    registrations.replace({ registrations: [replacement('v2')] });
    expect(scope.promote({ toolIds: ['read.card'] }).snapshot).toBe(first);
    const fresh = createToolExposure({ registry }).promote({ toolIds: ['read.card'] });
    expect(first.tools[0]!.descriptor.description).toBe('v1');
    expect(fresh.snapshot.tools[0]!.descriptor.description).toBe('v2');
    registrations.replace({ registrations: [] });
    expect(registry.has({ toolId: 'read.card' })).toBe(false);
    expect(scope.resolveToolId({ wireName: first.tools[0]!.wireName })).toBe('read.card');
  });

  it('admits newly registered descriptors without changing already published wire names', () => {
    const registry = registryWith([{ id: 'one.read' }]);
    const scope = createToolExposure({ registry });
    const original = scope.promote({ toolIds: ['one.read'] }).snapshot.tools[0]!;
    register(registry, { id: original.wireName });
    const next = scope.promote({ toolIds: [original.wireName] });
    expect(next.snapshot.tools[0]).toBe(original);
    expect(next.snapshot.tools[1]!.wireName).not.toBe(original.wireName);
    expect(scope.resolveToolId({ wireName: original.wireName })).toBe('one.read');
    expect(scope.resolveToolId({ wireName: next.snapshot.tools[1]!.wireName })).toBe(original.wireName);
  });

  it('uses host-filtered descriptors and never promotes an ID missing from that source', () => {
    const registry = registryWith([{ id: 'visible' }, { id: 'hidden' }]);
    const scope = createToolExposure({ registry: { list: () => registry.list({}).filter(tool => tool.id === 'visible') } });
    const delta = scope.promote({ toolIds: ['hidden', 'absent', 'visible', 'hidden'] });
    expect(delta.added).toEqual(['visible']);
    expect(delta.skipped).toEqual([{ toolId: 'hidden', reason: 'not-found' }, { toolId: 'absent', reason: 'not-found' }]);
    expect(scope.resolveToolId({ wireName: 'hidden' })).toBeUndefined();
    expect(registry.has({ toolId: 'hidden' })).toBe(true);
  });
});

describe('bounded promotion', () => {
  it('enforces the count boundary without eviction or deleting callable registry definitions', () => {
    const registry = registryWith([{ id: 'one' }, { id: 'two' }, { id: 'three' }]);
    const scope = createToolExposure({ registry }, { maxTools: 2 });
    scope.promote({ toolIds: ['one'] });
    const delta = scope.promote({ toolIds: ['one', 'two', 'three', 'three'] });
    expect(delta.added).toEqual(['two']);
    expect(delta.skipped).toEqual([{ toolId: 'three', reason: 'tool-limit' }]);
    expect(delta.snapshot.tools.map(tool => tool.descriptor.id)).toEqual(['one', 'two']);
    expect(scope.resolveToolId({ wireName: 'one' })).toBe('one');
    expect(scope.resolveToolId({ wireName: 'two' })).toBe('two');
    expect(scope.resolveToolId({ wireName: 'three' })).toBeUndefined();
    expect(registry.list({}).map(tool => tool.id)).toEqual(['one', 'two', 'three']);
  });

  it('counts UTF-8 schema bytes exactly and can admit a smaller entry after an oversized one', () => {
    const schema = { type: 'string', description: '☃' };
    const bytes = Buffer.byteLength(JSON.stringify(schema), 'utf8');
    expect(bytes).toBeGreaterThan(JSON.stringify(schema).length);
    const registry = registryWith([{ id: 'exact', inputSchema: schema },
      { id: 'oversized', inputSchema: { ...schema, description: '☃'.repeat(100) } },
      { id: 'absent-schema' }, { id: 'boolean-schema', inputSchema: false }]);
    const scope = createToolExposure({ registry }, { maxSchemaBytes: bytes });
    const delta = scope.promote({ toolIds: ['oversized', 'exact', 'boolean-schema', 'absent-schema'] });
    expect(delta.added).toEqual(['exact', 'absent-schema']);
    expect(delta.skipped).toEqual([{ toolId: 'oversized', reason: 'schema-byte-limit' },
      { toolId: 'boolean-schema', reason: 'schema-byte-limit' }]);
    expect(delta.snapshot.schemaBytes).toBe(bytes);
    const boolean = createToolExposure({ registry }, { maxSchemaBytes: 5 }).promote({ toolIds: ['boolean-schema'] });
    expect(boolean.snapshot.schemaBytes).toBe(5);
    expect(boolean.snapshot.tools[0]!.descriptor.inputSchema).toBe(false);
    const under = createToolExposure({ registry }, { maxSchemaBytes: bytes - 1 });
    expect(under.promote({ toolIds: ['exact'] }).skipped).toEqual([{ toolId: 'exact', reason: 'schema-byte-limit' }]);
  });

  it('supports zero budgets, empty requests and repeated missing IDs without changing revisions', () => {
    const registry = registryWith([{ id: 'one', inputSchema: {} }, { id: 'schemaless' }]);
    const zero = createToolExposure({ registry }, { maxTools: 0 });
    const initial = zero.getSnapshot({});
    expect(zero.promote({ toolIds: [] }).snapshot).toBe(initial);
    expect(zero.promote({ toolIds: ['one'] }).skipped).toEqual([{ toolId: 'one', reason: 'tool-limit' }]);
    expect(zero.getSnapshot({})).toBe(initial);
    const noBytes = createToolExposure({ registry }, { maxSchemaBytes: 0 });
    expect(noBytes.promote({ toolIds: ['one', 'schemaless'] }).added).toEqual(['schemaless']);
    expect(noBytes.promote({ toolIds: ['missing', 'missing'] }).skipped).toEqual([{ toolId: 'missing', reason: 'not-found' }]);
    expect(noBytes.getSnapshot({}).revision).toBe(1);
  });

  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid budgets (%s)', value => {
    const registry = registryWith([]);
    for (const options of [{ maxTools: value }, { maxSchemaBytes: value }]) {
      expect(() => createToolExposure({ registry }, options)).toThrow(ToolExposureError);
      try { createToolExposure({ registry }, options); } catch (error) {
        expect((error as ToolExposureError).code).toBe('invalid-limit');
      }
    }
  });

  it.each(['non-cloneable', 'cyclic-schema', 'bigint-schema'])('rejects %s descriptors atomically and permits a subsequent valid promotion', kind => {
    const schema: Record<string, unknown> = {};
    if (kind === 'cyclic-schema') schema.self = schema;
    if (kind === 'non-cloneable') schema.callback = () => null;
    if (kind === 'bigint-schema') schema.value = 1n;
    const registry = registryWith([{ id: 'first' }, { id: 'valid' }, { id: 'bad', inputSchema: schema }]);
    const scope = createToolExposure({ registry });
    const before = scope.promote({ toolIds: ['first'] }).snapshot;
    expect(() => scope.promote({ toolIds: ['valid', 'bad'] })).toThrow(ToolExposureError);
    expect(scope.getSnapshot({})).toBe(before);
    expect(scope.resolveToolId({ wireName: 'valid' })).toBeUndefined();
    expect(scope.promote({ toolIds: ['valid'] }).added).toEqual(['valid']);
    expect(scope.getSnapshot({}).revision).toBe(2);
  });
});
