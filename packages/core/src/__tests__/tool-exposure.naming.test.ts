import { describe, expect, it } from 'vitest';
import { createToolNameMap } from '../tool-exposure.js';

/** L2 §4 tool-exposure: wire names are deterministic regardless of discovery order, safe ids keep
 *  their spelling, transformed ids get a pinned FNV-1a suffix, and collisions/reservations probe
 *  `_1`, `_2`… inside the 64-char limit. */
const FNV = (id: string) => {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
};

describe('createToolNameMap', () => {
  it('pins the FNV-1a hash for a known id', () => {
    expect(FNV('a.b')).toBe('108bf50c');
    expect(createToolNameMap({ toolIds: ['a-b'] }).wireNameFor({ toolId: 'a-b' })).toBe('tool_a_b_2a89df63');
    const map = createToolNameMap({ toolIds: ['a.b'] });
    expect(map.wireNameFor({ toolId: 'a.b' })).toBe(`tool_a_b_${FNV('a.b')}`);
    expect(map.wireNameFor({ toolId: 'a.b' })).toMatch(/^tool_a_b_[0-9a-f]{8}$/);
  });

  it('is independent of discovery order and of duplicates', () => {
    const ids = ['z.tool', 'alpha', 'a.b', 'beta_1', 'a-b', 'alpha'];
    const one = createToolNameMap({ toolIds: ids });
    const two = createToolNameMap({ toolIds: [...ids].reverse() });
    for (const id of ids) expect(one.wireNameFor({ toolId: id })).toBe(two.wireNameFor({ toolId: id }));
  });

  it.each([
    ['_x', '_x'], ['A1', 'A1'], ['a'.repeat(64), 'a'.repeat(64)],
  ])('safe id %s keeps its spelling', (id, wire) => {
    expect(createToolNameMap({ toolIds: [id] }).wireNameFor({ toolId: id })).toBe(wire);
  });

  it.each(['1abc', 'a'.repeat(65), 'a-b', 'a b', '', 'ünï'])('unsafe id %j is transformed with a hash suffix within 64 chars', (id) => {
    const wire = createToolNameMap({ toolIds: [id] }).wireNameFor({ toolId: id })!;
    expect(wire).toBe(`tool_${id.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 49)}_${FNV(id)}`);
    expect(wire.length).toBeLessThanOrEqual(64);
    expect(wire).toMatch(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/);
  });

  it('a safe native name wins its spelling over a reservation-free transformed id, which probes _1', () => {
    const transformed = `tool_a_b_${FNV('a.b')}`;
    const map = createToolNameMap({ toolIds: ['a.b', transformed] });
    expect(map.wireNameFor({ toolId: transformed })).toBe(transformed);
    expect(map.wireNameFor({ toolId: 'a.b' })).toBe(`${transformed}_1`);
    expect(map.toolIdFor({ wireName: `${transformed}_1` })).toBe('a.b');
  });

  it('reserved names are never assigned: probes _1 then _2, truncating the base to stay ≤64', () => {
    const id = 'b'.repeat(64);
    const map = createToolNameMap({ toolIds: [id] }, { reservedNames: [id, `${'b'.repeat(62)}_1`] });
    expect(map.wireNameFor({ toolId: id })).toBe(`${'b'.repeat(62)}_2`);
    expect(map.toolIdFor({ wireName: id })).toBeUndefined();
    const plain = createToolNameMap({ toolIds: ['x'] }, { reservedNames: ['x'] });
    expect(plain.wireNameFor({ toolId: 'x' })).toBe('x_1');
  });

  it('unknown lookups return undefined and the map is frozen', () => {
    const map = createToolNameMap({ toolIds: ['a'] });
    expect(map.wireNameFor({ toolId: 'nope' })).toBeUndefined();
    expect(map.toolIdFor({ wireName: 'nope' })).toBeUndefined();
    expect(Object.isFrozen(map)).toBe(true);
    expect(createToolNameMap({ toolIds: [] }).wireNameFor({ toolId: 'a' })).toBeUndefined();
  });
});
