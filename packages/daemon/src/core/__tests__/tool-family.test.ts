import { describe, expect, it } from 'vitest';
import { selectedFamilyMember, visibleToolFamily, type ToolFamily } from '../tool-family.js';

const FAMILY: ToolFamily = { id: 'fam', members: ['fam.a', 'fam.b'], selector: { keys: ['kind', 'type'], byValue: { a: 'fam.a', b: 'fam.b' } } };

describe('selectedFamilyMember', () => {
  it('returns the member the first matching selector key points at', () => {
    expect(selectedFamilyMember({ family: FAMILY, input: { kind: 'b', type: 'a' } })).toBe('fam.b');
    expect(selectedFamilyMember({ family: FAMILY, input: { kind: 'unknown', type: 'a' } })).toBe('fam.a');
  });

  it.each([undefined, null, [], 'a', {}, { kind: 3 }, { kind: '' }, { kind: 'toString' }, { kind: '__proto__' }])('finds nothing in a malformed or foreign input %j', (input) => {
    expect(selectedFamilyMember({ family: FAMILY, input })).toBeUndefined();
  });

  it('finds nothing when the group has no selector', () => {
    expect(selectedFamilyMember({ family: { id: 'fam', members: ['fam.a'] }, input: { kind: 'a' } })).toBeUndefined();
  });
});

describe('visibleToolFamily', () => {
  it('keeps the port order and drops duplicates of nothing: members the registry lacks are removed', () => {
    const family = visibleToolFamily({ familyId: 'fam', description: { members: ['fam.b', 'fam.x', 'fam.a'] }, visibleIds: new Set(['fam.a', 'fam.b']) });
    expect(family).toEqual({ id: 'fam', members: ['fam.b', 'fam.a'] });
  });
});
