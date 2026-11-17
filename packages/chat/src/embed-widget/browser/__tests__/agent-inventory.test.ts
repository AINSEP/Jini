import { describe, expect, it } from 'vitest';
import { createAgentInventorySnapshot } from '../agent-inventory.js';

const KEY = 'example.agents.v1';
function memoryStorage(seed: Record<string, string> = {}) {
  const items = new Map(Object.entries(seed));
  return { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => { items.set(k, v); }, items };
}

describe('agent inventory snapshot', () => {
  it('round-trips a live list, keeping extra fields', () => {
    const snapshot = createAgentInventorySnapshot<{ id: string; name: string; models?: { id: string; label: string }[] }>({ storage: memoryStorage(), key: KEY });
    snapshot.write({ agents: [{ id: 'cli', name: 'CLI', models: [{ id: 'm', label: 'M' }] }] });
    expect(snapshot.read({})).toEqual([{ id: 'cli', name: 'CLI', models: [{ id: 'm', label: 'M' }] }]);
  });
  it('reads undefined when nothing is stored', () => {
    expect(createAgentInventorySnapshot({ storage: memoryStorage(), key: KEY }).read({})).toBeUndefined();
  });
  it('does not store an empty list over a useful one', () => {
    const snapshot = createAgentInventorySnapshot({ storage: memoryStorage(), key: KEY });
    snapshot.write({ agents: [{ id: 'cli', name: 'CLI' }] });
    snapshot.write({ agents: [] });
    expect(snapshot.read({})).toEqual([{ id: 'cli', name: 'CLI' }]);
  });
  it.each([
    ['corrupt JSON', '{not json'],
    ['a non-array', JSON.stringify({ id: 'cli' })],
    ['an empty array', '[]'],
    ['an entry without a string id/name', JSON.stringify([{ id: 'cli', name: 'CLI' }, { id: 7 }])],
    ['a null entry', JSON.stringify([{ id: 'cli', name: 'CLI' }, null])],
    ['a bare-string entry', JSON.stringify(['cli'])],
  ])('reads undefined for %s', (_label, raw) => {
    expect(createAgentInventorySnapshot({ storage: memoryStorage({ [KEY]: raw }), key: KEY }).read({})).toBeUndefined();
  });
  it('reads undefined, without throwing, when storage throws', () => {
    const storage = { getItem: () => { throw new Error('SecurityError'); }, setItem: () => undefined };
    expect(createAgentInventorySnapshot({ storage, key: KEY }).read({})).toBeUndefined();
  });
  it('writes nothing, without throwing, when storage throws', () => {
    const storage = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } };
    expect(() => createAgentInventorySnapshot({ storage, key: KEY }).write({ agents: [{ id: 'cli', name: 'CLI' }] })).not.toThrow();
  });
});
