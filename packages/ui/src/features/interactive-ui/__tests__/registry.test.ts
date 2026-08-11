import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { InteractiveUiRegistry, type InteractiveComponentEntry } from '../registry.js';

function entry(id: string, capabilities: string[]): InteractiveComponentEntry {
  return {
    id,
    provider: 'test',
    capabilities,
    propsSchema: z.object({}),
    Component: () => null,
  };
}

describe('InteractiveUiRegistry', () => {
  it('resolves by id', () => {
    const registry = new InteractiveUiRegistry([entry('a', ['table'])]);
    expect(registry.resolveById('a')?.id).toBe('a');
  });

  it('returns null for an unknown id', () => {
    const registry = new InteractiveUiRegistry([]);
    expect(registry.resolveById('missing')).toBeNull();
  });

  it('resolves by capability in registration order (fallback chain)', () => {
    const registry = new InteractiveUiRegistry([entry('preferred', ['table']), entry('fallback', ['table'])]);
    expect(registry.resolveByCapability('table').map((item) => item.id)).toEqual(['preferred', 'fallback']);
  });

  it('returns an empty list for an unmatched capability', () => {
    const registry = new InteractiveUiRegistry([entry('a', ['table'])]);
    expect(registry.resolveByCapability('chart')).toEqual([]);
  });

  it('list returns every registered entry', () => {
    const registry = new InteractiveUiRegistry([entry('a', ['table']), entry('b', ['form'])]);
    expect(registry.list().map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('register appends a new entry without mutating the original registry', () => {
    const original = new InteractiveUiRegistry([entry('a', ['table'])]);
    const updated = original.register(entry('b', ['form']));
    expect(original.list().map((item) => item.id)).toEqual(['a']);
    expect(updated.list().map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('register replaces an existing entry with the same id', () => {
    const original = new InteractiveUiRegistry([entry('a', ['table'])]);
    const updated = original.register(entry('a', ['form']));
    expect(updated.list()).toHaveLength(1);
    expect(updated.resolveByCapability('form')).toHaveLength(1);
    expect(updated.resolveByCapability('table')).toHaveLength(0);
  });
});
