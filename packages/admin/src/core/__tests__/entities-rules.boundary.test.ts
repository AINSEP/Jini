import { describe, expect, it } from 'vitest';

import {
  createAdminEntityRegistry,
  describeAdminEntityFieldMismatch,
  eraseEntityPort,
  getErasedEntityPort,
  listErasedEntityPorts,
  type AdminEntityRowViolation,
} from '../entities/rules.js';
import type {
  AdminEntityDescriptor,
  AdminEntityField,
  AdminEntityPort,
  AdminEntityRowData,
} from '../ports/entities.js';

/** Boundary cases for the json walk, the row walk and descriptor validation in `entities/rules`. */

const json: AdminEntityField = { name: 'data', kind: 'json' };
const nest = (levels: number): unknown => {
  let value: unknown = 'leaf';
  for (let i = 0; i < levels; i += 1) value = [value];
  return value;
};

describe('json walk bounds', () => {
  it('accepts nesting exactly at the depth limit', () => {
    expect(describeAdminEntityFieldMismatch(json, nest(32))).toBeNull();
  });
  it('rejects nesting one level past the depth limit', () => {
    expect(describeAdminEntityFieldMismatch(json, nest(33))).toBe(
      'is not a JSON value: it nests deeper than 32 levels',
    );
  });
  it('accepts exactly the node budget', () => {
    expect(describeAdminEntityFieldMismatch(json, new Array(9_999).fill(0))).toBeNull();
  });
  it('rejects one node past the budget', () => {
    expect(describeAdminEntityFieldMismatch(json, new Array(10_000).fill(0))).toBe(
      'is not a JSON value: it holds more than 10000 values',
    );
  });
  it('rejects undefined', () => {
    expect(describeAdminEntityFieldMismatch(json, undefined)).toBe(
      'is not a JSON value: it is a undefined',
    );
  });
  it('rejects a symbol inside an object', () => {
    expect(describeAdminEntityFieldMismatch(json, { a: Symbol('s') })).toBe(
      'is not a JSON value: it is a symbol',
    );
  });
  it('accepts a null-prototype object', () => {
    const bare = Object.assign(Object.create(null) as Record<string, unknown>, { a: 1 });
    expect(describeAdminEntityFieldMismatch(json, bare)).toBeNull();
  });
  it('rejects a Map', () => {
    expect(describeAdminEntityFieldMismatch(json, new Map())).toBe(
      'is not a JSON value: it is a non-plain object',
    );
  });
  it('reports the first bad array item', () => {
    expect(describeAdminEntityFieldMismatch(json, [1, Number.NaN, () => 1])).toBe(
      'is not a JSON value: it is a non-finite number',
    );
  });
  it('accepts a boolean', () => {
    expect(describeAdminEntityFieldMismatch(json, false)).toBeNull();
  });
});

describe('field kinds', () => {
  it('rejects a non-string datetime naming the type', () => {
    expect(describeAdminEntityFieldMismatch({ name: 'at', kind: 'datetime' }, 5)).toBe(
      'expected an ISO-8601 string, got number',
    );
  });
  it('rejects a non-number real naming the type', () => {
    expect(describeAdminEntityFieldMismatch({ name: 'r', kind: 'real' }, '1')).toBe(
      'expected a number, got string',
    );
  });
  it('rejects a non-boolean naming the type', () => {
    expect(describeAdminEntityFieldMismatch({ name: 'b', kind: 'boolean' }, 1)).toBe(
      'expected a boolean, got number',
    );
  });
});

const descriptor: AdminEntityDescriptor = {
  name: 'thing',
  labelSingular: 'Thing',
  labelPlural: 'Things',
  titleField: 'title',
  fields: [
    { name: 'title', kind: 'text', required: true },
    { name: 'note', kind: 'text', required: false },
    { name: 'count', kind: 'integer' },
  ],
};
const portOf = (
  row: AdminEntityRowData,
  base: AdminEntityDescriptor = descriptor,
): AdminEntityPort<AdminEntityDescriptor> => ({
  descriptor: base,
  list: async () => ({ items: [row], nextCursor: null }),
  get: async () => row,
  create: async () => row,
  update: async () => row,
});
const seenFor = async (row: AdminEntityRowData): Promise<AdminEntityRowViolation[]> => {
  const seen: AdminEntityRowViolation[] = [];
  await eraseEntityPort(portOf(row), { onViolation: (v) => seen.push(v) }).update('x', {});
  return seen;
};

describe('row walk', () => {
  it('reports a full violation record for a mistyped field on update', async () => {
    expect(await seenFor({ id: 't1', title: 'T', count: 1.5 })).toEqual([
      {
        entity: 'thing',
        operation: 'update',
        rowId: 't1',
        field: 'count',
        problem: 'wrong-type',
        detail: 'declared `integer`; is not an integer',
      },
    ]);
  });
  it('does not report an absent optional field', async () => {
    expect(await seenFor({ id: 't1', title: 'T' })).toEqual([]);
  });
  it('does not report an absent field explicitly marked not required', async () => {
    expect(await seenFor({ id: 't1', title: 'T', count: 2 })).toEqual([]);
  });
  it('reports a missing required field with its detail', async () => {
    expect((await seenFor({ id: 't1' }))[0]?.detail).toBe(
      'declared `required: true` but absent from the row',
    );
  });
  it('reports an undeclared key with its detail', async () => {
    expect((await seenFor({ id: 't1', title: 'T', extra: 1 }))[0]).toMatchObject({
      field: 'extra',
      problem: 'undeclared-field',
      detail: 'present on the row but not declared on the descriptor',
    });
  });
  it('reports an empty id with its detail', async () => {
    expect((await seenFor({ id: '', title: 'T' }))[0]?.detail).toBe(
      'every row must carry a non-empty string `id`',
    );
  });
  it('checks a row returned by get', async () => {
    const seen: AdminEntityRowViolation[] = [];
    await eraseEntityPort(portOf({ id: 't1' }), { onViolation: (v) => seen.push(v) }).get('t1');
    expect(seen.map((v) => v.operation)).toEqual(['get']);
  });
  it('passes a null get through without checking', async () => {
    const seen: AdminEntityRowViolation[] = [];
    const port = { ...portOf({ id: 't1' }), get: async () => null };
    expect(await eraseEntityPort(port, { onViolation: (v) => seen.push(v) }).get('t1')).toBeNull();
    expect(seen).toEqual([]);
  });
});

const withDescriptor = (patch: Partial<AdminEntityDescriptor>) => ({
  thing: portOf({ id: 't1' }, { ...descriptor, ...patch }),
});
const problemsOf = (patch: Partial<AdminEntityDescriptor>): string => {
  try {
    createAdminEntityRegistry(withDescriptor(patch));
  } catch (error) {
    if (error instanceof Error) return error.message;
  }
  return 'no throw';
};

describe('descriptor validation', () => {
  it('rejects an empty singular label', () => {
    expect(problemsOf({ labelSingular: '' })).toBe(
      "createAdminEntityRegistry: invalid descriptors\n- 'thing': labelSingular and labelPlural must both be non-empty",
    );
  });
  it('rejects an empty plural label', () => {
    expect(problemsOf({ labelPlural: '' })).toBe(
      "createAdminEntityRegistry: invalid descriptors\n- 'thing': labelSingular and labelPlural must both be non-empty",
    );
  });
  it('rejects an empty field name without further checks on it', () => {
    expect(
      problemsOf({
        fields: [
          { name: 'title', kind: 'text' },
          { name: '', kind: 'relation', target: 'ghost' },
          { name: '', kind: 'text' },
        ],
      }),
    ).toBe(
      "createAdminEntityRegistry: invalid descriptors\n- 'thing': a field has an empty name\n- 'thing': a field has an empty name",
    );
  });
  it('accepts a relation to a registered entity', () => {
    const registry = createAdminEntityRegistry(
      withDescriptor({
        fields: [
          { name: 'title', kind: 'text' },
          { name: 'self', kind: 'relation', target: 'thing' },
        ],
      }),
    );
    expect(listErasedEntityPorts(registry).map((p) => p.descriptor.name)).toEqual(['thing']);
  });
  it('lists header, field and title problems in that order', () => {
    expect(
      problemsOf({ name: 'other', fields: [{ name: 'id', kind: 'text' }], titleField: 'x' }),
    ).toBe(
      [
        'createAdminEntityRegistry: invalid descriptors',
        "- 'thing': registered under 'thing' but its descriptor is named 'other'",
        "- 'thing': 'id' is implicit on every row and must not be declared as a field",
        "- 'thing': titleField 'x' does not name a declared field",
      ].join('\n'),
    );
  });
});

describe('registry lookup', () => {
  // A JavaScript caller's plain object can hold an own key whose value is undefined.
  it('returns null for an own key holding undefined', () => {
    const registry: Record<string, AdminEntityPort<AdminEntityDescriptor>> = {};
    Object.defineProperty(registry, 'ghost', { value: undefined, enumerable: true });
    expect(getErasedEntityPort(registry, 'ghost')).toBeNull();
  });
});
