import { describe, expect, it, vi } from 'vitest';

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
  AdminEntityPage,
  AdminEntityPort,
  AdminEntityRow,
} from '../ports/entities.js';

/**
 * @file `AdminEntityPort`'s runtime half.
 *
 * The two things worth testing hard here are the two the type system provably cannot hold:
 * `titleField` naming a real `text` field, and a `relation` resolving to a registered entity. Both
 * fail invisibly at render time (a picker of `undefined`s, a blank cell) rather than loudly, so
 * these tests care as much about the message as the throw.
 */

const authorDescriptor = {
  name: 'author',
  labelSingular: 'Author',
  labelPlural: 'Authors',
  titleField: 'name',
  fields: [
    { name: 'name', kind: 'text', required: true, queryable: true },
    { name: 'bio', kind: 'text' },
    { name: 'joinedAt', kind: 'datetime', required: true },
  ],
} as const satisfies AdminEntityDescriptor;

const recipeDescriptor = {
  name: 'recipe',
  labelSingular: 'Recipe',
  labelPlural: 'Recipes',
  titleField: 'title',
  fields: [
    { name: 'title', kind: 'text', required: true },
    { name: 'authorId', kind: 'relation', target: 'author', required: true },
    { name: 'ingredients', kind: 'json' },
    { name: 'servings', kind: 'integer' },
    { name: 'rating', kind: 'real' },
    { name: 'vegan', kind: 'boolean' },
  ],
} as const satisfies AdminEntityDescriptor;

/** A port over a fixed row list. `rows` is `unknown[]` so a test can hand back rows that violate
 *  the descriptor — which is the whole point of the conformance checks below. */
function fakePort<D extends AdminEntityDescriptor>(
  descriptor: D,
  rows: readonly unknown[],
  extras: { removable?: boolean } = {},
): AdminEntityPort<D> {
  type Row = AdminEntityRow<D>;
  const typed = rows as readonly Row[];
  const port: AdminEntityPort<D> = {
    descriptor,
    async list(): Promise<AdminEntityPage<Row>> {
      return { items: typed, nextCursor: null, total: typed.length };
    },
    async get(id) {
      return typed.find((row) => (row as { id: string }).id === id) ?? null;
    },
    async create(input) {
      return { ...input, id: 'created' } as Row;
    },
    async update(_id, patch) {
      return { ...(typed[0] as object), ...patch } as Row;
    },
  };
  if (extras.removable !== true) return port;
  return { ...port, async remove() {} };
}

const validAuthorRow = { id: 'a1', name: 'Priya Nair', joinedAt: '2026-01-12T00:00:00.000Z' };
const validRecipeRow = { id: 'r1', title: 'Coconut Dal', authorId: 'a1', ingredients: ['dal'] };

function collect(): { sink: (v: AdminEntityRowViolation) => void; seen: AdminEntityRowViolation[] } {
  const seen: AdminEntityRowViolation[] = [];
  return { sink: (v) => seen.push(v), seen };
}

describe('createAdminEntityRegistry — descriptor validation', () => {
  it('accepts a valid pair and preserves registration order', () => {
    const registry = createAdminEntityRegistry({
      author: fakePort(authorDescriptor, [validAuthorRow]),
      recipe: fakePort(recipeDescriptor, [validRecipeRow]),
    });
    expect(listErasedEntityPorts(registry).map((p) => p.descriptor.name)).toEqual([
      'author',
      'recipe',
    ]);
  });

  it('rejects a titleField that names no declared field', () => {
    const typo = { ...authorDescriptor, titleField: 'nmae' } satisfies AdminEntityDescriptor;
    expect(() => createAdminEntityRegistry({ author: fakePort(typo, []) })).toThrow(
      /titleField 'nmae' does not name a declared field/,
    );
  });

  it('rejects a titleField that names a non-text field', () => {
    const wrongKind = { ...authorDescriptor, titleField: 'joinedAt' } satisfies AdminEntityDescriptor;
    expect(() => createAdminEntityRegistry({ author: fakePort(wrongKind, []) })).toThrow(
      /titleField 'joinedAt' is kind 'datetime'/,
    );
  });

  it('rejects a relation whose target is not registered', () => {
    // The recipe descriptor is valid in itself; it is only wrong in THIS registry, which is exactly
    // why this check cannot live on the descriptor.
    expect(() => createAdminEntityRegistry({ recipe: fakePort(recipeDescriptor, []) })).toThrow(
      /field 'authorId' targets 'author', which is not a registered entity/,
    );
  });

  it('rejects a registry key that disagrees with the descriptor name', () => {
    expect(() => createAdminEntityRegistry({ authors: fakePort(authorDescriptor, []) })).toThrow(
      /registered under 'authors' but its descriptor is named 'author'/,
    );
  });

  it("rejects a field named 'id'", () => {
    const shadowed = {
      ...authorDescriptor,
      fields: [...authorDescriptor.fields, { name: 'id', kind: 'text' }],
    } satisfies AdminEntityDescriptor;
    expect(() => createAdminEntityRegistry({ author: fakePort(shadowed, []) })).toThrow(
      /'id' is implicit on every row/,
    );
  });

  it('rejects a duplicated field name', () => {
    const duped = {
      ...authorDescriptor,
      fields: [...authorDescriptor.fields, { name: 'bio', kind: 'text' }],
    } satisfies AdminEntityDescriptor;
    expect(() => createAdminEntityRegistry({ author: fakePort(duped, []) })).toThrow(
      /field 'bio' is declared more than once/,
    );
  });

  it('rejects a descriptor with no fields', () => {
    const empty = { ...authorDescriptor, fields: [] } satisfies AdminEntityDescriptor;
    expect(() => createAdminEntityRegistry({ author: fakePort(empty, []) })).toThrow(
      /declares no fields/,
    );
  });

  // Aggregate behaviour: three descriptors, three different faults, one call. A first-failure-wins
  // implementation passes every single-fault test above and still costs three round trips here.
  it('reports every problem across every descriptor in one throw', () => {
    const badTitle = { ...authorDescriptor, titleField: 'nmae' } satisfies AdminEntityDescriptor;
    const badTarget = {
      ...recipeDescriptor,
      fields: [
        { name: 'title', kind: 'text', required: true },
        { name: 'chefId', kind: 'relation', target: 'chef' },
      ],
    } satisfies AdminEntityDescriptor;
    let message = '';
    try {
      createAdminEntityRegistry({
        author: fakePort(badTitle, []),
        recipe: fakePort(badTarget, []),
        notes: fakePort({ ...authorDescriptor, name: 'note' } satisfies AdminEntityDescriptor, []),
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("titleField 'nmae'");
    expect(message).toContain("targets 'chef'");
    expect(message).toContain("registered under 'notes' but its descriptor is named 'note'");
  });
});

describe('createAdminEntityRegistry — lookup safety', () => {
  const registry = createAdminEntityRegistry({
    author: fakePort(authorDescriptor, [validAuthorRow]),
    recipe: fakePort(recipeDescriptor, [validRecipeRow]),
  });

  it('resolves a registered name', () => {
    expect(getErasedEntityPort(registry, 'recipe')?.descriptor.labelPlural).toBe('Recipes');
  });

  // An entity name is a URL segment. A plain-object registry answers `registry['constructor']` with
  // `Object` — truthy, not a port — and a screen that trusts it renders a crash instead of a 404.
  it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf'])(
    'resolves the prototype key %s to null',
    (name) => {
      expect(getErasedEntityPort(registry, name)).toBeNull();
    },
  );

  it('is frozen', () => {
    expect(Object.isFrozen(registry)).toBe(true);
  });
});

describe('eraseEntityPort', () => {
  it('is a pure retype when no violation sink is wired', () => {
    const port = fakePort(authorDescriptor, [validAuthorRow]);
    expect(eraseEntityPort(port)).toBe(port);
  });

  it('wraps when a sink is wired, and still returns rows unchanged', async () => {
    const { sink, seen } = collect();
    const erased = eraseEntityPort(fakePort(authorDescriptor, [validAuthorRow]), {
      onViolation: sink,
    });
    const page = await erased.list();
    expect(page.items[0]).toEqual(validAuthorRow);
    expect(seen).toEqual([]);
  });

  it('keeps an absent remove absent', () => {
    expect(eraseEntityPort(fakePort(authorDescriptor, []), { onViolation: vi.fn() }).remove).toBeUndefined();
  });

  it('forwards a present remove with its receiver intact', async () => {
    const store = {
      descriptor: authorDescriptor,
      removed: [] as string[],
      async list() {
        return { items: [], nextCursor: null };
      },
      async get() {
        return null;
      },
      async create(input: Omit<AdminEntityRow<typeof authorDescriptor>, 'id'>) {
        return { ...input, id: 'x' };
      },
      async update(id: string) {
        return { id, name: 'x', joinedAt: '2026-01-01T00:00:00.000Z' };
      },
      async remove(id: string) {
        this.removed.push(id);
      },
    };
    const erased = eraseEntityPort(store, { onViolation: vi.fn() });
    await erased.remove?.('a1');
    expect(store.removed).toEqual(['a1']);
  });
});

describe('eraseEntityPort — descriptor conformance', () => {
  async function violationsFor(rows: readonly unknown[]): Promise<readonly AdminEntityRowViolation[]> {
    const { sink, seen } = collect();
    await eraseEntityPort(fakePort(recipeDescriptor, rows), { onViolation: sink }).list();
    return seen;
  }

  it('reports a missing required field', async () => {
    const seen = await violationsFor([{ id: 'r1', title: 'Dal' }]);
    expect(seen).toEqual([
      expect.objectContaining({ entity: 'recipe', rowId: 'r1', field: 'authorId', problem: 'missing-required' }),
    ]);
  });

  it('reports an undeclared field', async () => {
    const seen = await violationsFor([{ ...validRecipeRow, workspaceId: 'ws1' }]);
    expect(seen).toEqual([
      expect.objectContaining({ field: 'workspaceId', problem: 'undeclared-field' }),
    ]);
  });

  it('reports a row with no usable id', async () => {
    const seen = await violationsFor([{ id: '', title: 'Dal', authorId: 'a1' }]);
    expect(seen[0]).toMatchObject({ field: 'id', rowId: '<no id>', problem: 'wrong-type' });
  });

  it.each([
    ['servings', 1.5, /is not an integer/],
    ['rating', Number.NaN, /is not a finite number/],
    ['vegan', 'yes', /expected a boolean/],
    ['title', 42, /expected a string/],
    ['authorId', 7, /expected a string/],
  ])('reports %s holding a wrong-typed value', async (field, value, expected) => {
    const seen = await violationsFor([{ ...validRecipeRow, [field]: value }]);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.field).toBe(field);
    expect(seen[0]?.detail).toMatch(expected);
  });

  // A `datetime` holding "yesterday" renders perfectly and orders wrongly — the exact
  // looks-right-is-wrong shape these checks exist to catch.
  it('reports an unparseable datetime', async () => {
    const { sink, seen } = collect();
    await eraseEntityPort(fakePort(authorDescriptor, [{ ...validAuthorRow, joinedAt: 'yesterday' }]), {
      onViolation: sink,
    }).list();
    expect(seen[0]?.detail).toMatch(/not a parseable ISO-8601 timestamp/);
  });

  it.each([
    ['a function', () => undefined, /is a function/],
    ['a bigint', 10n, /is a bigint/],
    ['a Date', new Date(), /non-plain object/],
    ['a nested Infinity', { a: [1, Number.POSITIVE_INFINITY] }, /non-finite number/],
  ])('reports json holding %s', async (_label, value, expected) => {
    const seen = await violationsFor([{ ...validRecipeRow, ingredients: value }]);
    expect(seen[0]?.detail).toMatch(expected);
  });

  it('terminates on a cyclic json value instead of recursing forever', async () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const seen = await violationsFor([{ ...validRecipeRow, ingredients: cyclic }]);
    expect(seen[0]?.detail).toMatch(/nests deeper than 32 levels/);
  });

  it('accepts nulls and nested plain json', async () => {
    expect(
      await violationsFor([{ ...validRecipeRow, ingredients: { a: [1, 'x', null, { b: true }] } }]),
    ).toEqual([]);
  });

  // Aggregate: a page of mixed rows must attribute each fault to its own row, not to the first.
  it('attributes violations per row across a page', async () => {
    const seen = await violationsFor([
      validRecipeRow,
      { id: 'r2', title: 'Cacio', authorId: 'a2', servings: 'four' },
      { id: 'r3', authorId: 'a3' },
    ]);
    expect(seen.map((v) => [v.rowId, v.field, v.problem])).toEqual([
      ['r2', 'servings', 'wrong-type'],
      ['r3', 'title', 'missing-required'],
    ]);
  });

  it('labels the operation that produced the row', async () => {
    const { sink, seen } = collect();
    const erased = eraseEntityPort(fakePort(recipeDescriptor, [{ id: 'r1' }]), { onViolation: sink });
    await erased.get('r1');
    await erased.create({});
    expect(seen.map((v) => v.operation)).toContain('get');
    expect(seen.map((v) => v.operation)).toContain('create');
  });
});

/**
 * The same judgement an editor makes about a value it is about to save, asserted directly rather
 * than only through `eraseEntityPort`'s row walk.
 *
 * The cases that matter are the ones no row-shaped test reaches: `integer` and `real` differ from
 * each other and from `text` only for values a `<input type="number">` will happily produce, and a
 * form that re-derives these rules instead of calling this drifts from the checker that later
 * reports its output as an adapter violation.
 */
describe('describeAdminEntityFieldMismatch', () => {
  const field = {
    text: { name: 'title', kind: 'text' },
    integer: { name: 'servings', kind: 'integer' },
    real: { name: 'rating', kind: 'real' },
    boolean: { name: 'vegan', kind: 'boolean' },
    datetime: { name: 'createdAt', kind: 'datetime' },
    relation: { name: 'authorId', kind: 'relation', target: 'author' },
    json: { name: 'ingredients', kind: 'json' },
  } as const satisfies Record<string, AdminEntityField>;

  it.each([
    ['text', field.text, 'Dal'],
    ['integer', field.integer, 4],
    ['integer at zero', field.integer, 0],
    ['integer negative', field.integer, -3],
    ['real', field.real, 4.5],
    ['real at zero', field.real, 0],
    ['boolean true', field.boolean, true],
    ['boolean false', field.boolean, false],
    ['datetime', field.datetime, '2026-01-15T00:00:00.000Z'],
    ['relation', field.relation, 'author-1'],
    ['json array', field.json, ['lentils']],
    ['json null', field.json, null],
  ])('accepts a conforming %s', (_label, declared, value) => {
    expect(describeAdminEntityFieldMismatch(declared, value)).toBeNull();
  });

  // `false` and `0` are the two values a truthiness-based validator silently rejects, and neither
  // appears in any descriptor the browser acceptance run exercises.
  it('accepts `false` and `0` rather than reading them as absent', () => {
    expect(describeAdminEntityFieldMismatch(field.boolean, false)).toBeNull();
    expect(describeAdminEntityFieldMismatch(field.integer, 0)).toBeNull();
    expect(describeAdminEntityFieldMismatch(field.real, 0)).toBeNull();
  });

  it.each([
    ['a fractional integer', field.integer, 1.5, /is not an integer/],
    ['an infinite integer', field.integer, Number.POSITIVE_INFINITY, /is not an integer/],
    ['a NaN integer', field.integer, Number.NaN, /is not an integer/],
    ['a stringified integer', field.integer, '4', /expected a number, got string/],
    ['an infinite real', field.real, Number.POSITIVE_INFINITY, /is not a finite number/],
    ['a NaN real', field.real, Number.NaN, /is not a finite number/],
    ['a stringified boolean', field.boolean, 'true', /expected a boolean, got string/],
    ['a numeric boolean', field.boolean, 1, /expected a boolean, got number/],
    ['an unparseable datetime', field.datetime, 'yesterday', /not a parseable ISO-8601/],
    ['a numeric datetime', field.datetime, 1_700_000_000, /expected an ISO-8601 string/],
    ['a numeric relation id', field.relation, 7, /expected a string, got number/],
    ['a non-finite number inside json', field.json, [Number.NaN], /non-finite number/],
    ['a function inside json', field.json, { fn: () => 1 }, /is a function/],
  ])('rejects %s', (_label, declared, value, expected) => {
    expect(describeAdminEntityFieldMismatch(declared, value)).toMatch(expected);
  });
});
