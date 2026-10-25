import { describe, expect, it } from 'vitest';
import { createToolRegistrationScope, createToolRegistry, isReadOnlyTool, toolDiscoveryMetadata, toolRegistryRevision } from '../tool-registry.js';

/** L2 §4 tool-registry: a registration without a callable policy is refused on both paths, a scope
 *  can never steal an id it does not own, replaced handlers are revoked, and revisions advance once
 *  per change. Read-only classification needs an explicit `readOnly: true`. */
const reg = (id: string, extra: Record<string, unknown> = {}) => ({
  descriptor: { id, name: id, description: 'd', inputSchema: { type: 'object' } },
  handler: async () => `ran:${id}`,
  policy: { authorize: async () => ({ allowed: true }) },
  ...extra,
}) as never;

describe('authorization policy is mandatory', () => {
  it.each([undefined, {}, { authorize: 'yes' }])('register refuses policy %j', (policy) => {
    expect(() => createToolRegistry({}).register(reg('t', { policy }))).toThrow('ToolRegistry: tool "t" must declare an authorization policy');
  });
  it('scope.replace refuses it too, before changing anything', () => {
    const registry = createToolRegistry({});
    const scope = createToolRegistrationScope({ registry });
    expect(() => scope.replace({ registrations: [reg('a'), reg('b', { policy: undefined })] })).toThrow('must declare an authorization policy');
    expect(registry.has({ toolId: 'a' })).toBe(false);
  });
});

describe('registration scopes', () => {
  it('cannot take an id registered statically or by another scope, nor list one twice', () => {
    const registry = createToolRegistry({});
    registry.register(reg('static'));
    const one = createToolRegistrationScope({ registry });
    const two = createToolRegistrationScope({ registry });
    one.replace({ registrations: [reg('mine')] });
    expect(() => two.replace({ registrations: [reg('static')] })).toThrow('ToolRegistry: tool "static" is already registered');
    expect(() => two.replace({ registrations: [reg('mine')] })).toThrow('ToolRegistry: tool "mine" is already registered');
    expect(() => two.replace({ registrations: [reg('x'), reg('x')] })).toThrow('ToolRegistry: tool "x" is already registered');
  });
  it('a scope may re-register its own ids; dropped ids disappear; revisions advance once per change', () => {
    const registry = createToolRegistry({});
    const start = toolRegistryRevision({ registry });
    expect(start).toBe(0);
    const scope = createToolRegistrationScope({ registry });
    scope.replace({ registrations: [reg('a'), reg('b')] });
    expect(toolRegistryRevision({ registry })).toBe(1);
    scope.replace({ registrations: [reg('a')] });
    expect(toolRegistryRevision({ registry })).toBe(2);
    expect(registry.has({ toolId: 'a' })).toBe(true);
    expect(registry.has({ toolId: 'b' })).toBe(false);
    registry.register(reg('c'));
    expect(toolRegistryRevision({ registry })).toBe(3);
    expect(() => registry.register(reg('c'))).toThrow('ToolRegistry: tool "c" is already registered');
    expect(toolRegistryRevision({ registry })).toBe(3);
  });
  it('refuses a registry that is not a core ToolRegistry, and reports no revision for it', () => {
    const fake = { register() {}, has: () => false, list: () => [] };
    expect(() => createToolRegistrationScope({ registry: fake as never })).toThrow('registration scopes require a core ToolRegistry');
    expect(toolRegistryRevision({ registry: fake })).toBeUndefined();
  });
});

describe('read-only classification', () => {
  it.each([[{ readOnly: true }, true], [{ readOnly: false }, false], [{}, false], [{ readOnly: 'true' }, false], [undefined, false]])('%j → %s', (extra, expected) => {
    const descriptor = extra === undefined ? undefined : ({ id: 't', ...extra } as never);
    expect(isReadOnlyTool({ descriptor })).toBe(expected);
  });
  it('discovery metadata: explicit side effects win; read-only defaults to none; otherwise unknown', () => {
    expect(toolDiscoveryMetadata({ descriptor: { id: 't', readOnly: true } as never })).toEqual({ readOnly: true, sideEffects: 'none' });
    expect(toolDiscoveryMetadata({ descriptor: { id: 't' } as never })).toEqual({ readOnly: false, sideEffects: 'unknown' });
    expect(toolDiscoveryMetadata({ descriptor: { id: 't', readOnly: true, sideEffects: 'mutates-durable-state' } as never })).toEqual({ readOnly: true, sideEffects: 'mutates-durable-state' });
    expect(toolDiscoveryMetadata({ descriptor: undefined })).toEqual({ readOnly: false, sideEffects: 'unknown' });
  });
});
