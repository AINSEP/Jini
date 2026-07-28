import { describe, expect, it } from 'vitest';

import * as publicBarrel from '../index.js';
import { getToolRegistration } from '../internal.js';
import { createToolRegistry, type ToolRegistration, type ToolRegistry } from '../tool-registry.js';

function makeRegistration(id: string): ToolRegistration {
  return {
    descriptor: { id },
    handler: async () => 'ok',
    policy: { authorize: () => 'allow' },
  };
}

describe('@injini/core — tool-registry', () => {
  it('starts empty', () => {
    const registry = createToolRegistry();
    expect(registry.list()).toEqual([]);
    expect(registry.has('missing')).toBe(false);
  });

  it('registers a tool, exposing only its descriptor via has/list', () => {
    const registry = createToolRegistry();
    const registration = makeRegistration('echo');
    registry.register(registration);

    expect(registry.has('echo')).toBe(true);
    expect(registry.list()).toEqual([{ id: 'echo' }]);
    for (const descriptor of registry.list()) {
      expect(descriptor).not.toHaveProperty('handler');
      expect(descriptor).not.toHaveProperty('policy');
    }
  });

  it('lists descriptors in registration order', () => {
    const registry = createToolRegistry();
    registry.register(makeRegistration('a'));
    registry.register(makeRegistration('b'));
    registry.register(makeRegistration('c'));
    expect(registry.list().map((d) => d.id)).toEqual(['a', 'b', 'c']);
  });

  it('rejects a duplicate tool id', () => {
    const registry = createToolRegistry();
    registry.register(makeRegistration('echo'));
    expect(() => registry.register(makeRegistration('echo'))).toThrow(/already registered/);
  });

  it('getToolRegistration resolves the full registration for the internal caller', () => {
    const registry = createToolRegistry();
    const registration = makeRegistration('echo');
    registry.register(registration);

    expect(getToolRegistration(registry, 'echo')).toBe(registration);
    expect(getToolRegistration(registry, 'missing')).toBeUndefined();
  });

  it('getToolRegistration finds nothing for a registry instance it never tracked', () => {
    const fakeRegistry = { register() {}, has: () => false, list: () => [] } as ToolRegistry;
    expect(getToolRegistration(fakeRegistry, 'anything')).toBeUndefined();
  });

  it('does not export getToolRegistration from the public barrel', () => {
    expect('getToolRegistration' in publicBarrel).toBe(false);
  });

  it('keeps two registries independent', () => {
    const a = createToolRegistry();
    const b = createToolRegistry();
    a.register(makeRegistration('only-in-a'));
    expect(a.has('only-in-a')).toBe(true);
    expect(b.has('only-in-a')).toBe(false);
    expect(getToolRegistration(b, 'only-in-a')).toBeUndefined();
  });
});
