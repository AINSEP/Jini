import { describe, expect, it } from 'vitest';
import type { AdminMenuTarget } from '../ports/menus.js';

/**
 * Executable pin on the `string & {}` narrowing tax that `ports/menus.ts`'s file header describes
 * in prose.
 *
 * This guards a hazard that exists today and is nobody's regression: `AdminMenuCustomTarget.kind`
 * is `string & {}`, which structurally overlaps every literal kind in the union and collapses the
 * discriminant. It is pinned here because the header's own account of it is prose, and prose is
 * what has gone wrong repeatedly around this type — the deferral's headline said "a second host"
 * while its actual trigger said "a second host needing a fifth kind", and a promotion was nearly
 * approved on the weaker reading. A test cannot be skim-read into saying the opposite of what it
 * checks.
 *
 * If someone ever fixes the tax (a branded custom kind, a nested variant, a type predicate), these
 * fail — which is correct. The header's narrowing section is then wrong and must be updated with
 * the fix rather than left behind it.
 */
describe('AdminMenuTarget narrowing tax', () => {
  it('cannot reach a known-variant field off the bare union, even after a kind check', () => {
    const read = (t: AdminMenuTarget): string =>
      // @ts-expect-error `AdminMenuCustomTarget` is not excluded by `kind === 'entryRef'`, so
      // `.entryId` is not present on the narrowed type. Header: "TypeScript will refuse the
      // access rather than silently mistype it."
      t.kind === 'entryRef' ? t.entryId : '';

    // The runtime value is fine — the tax is purely at the type level, which is why it is easy to
    // mistake for a non-problem right up until a host tries to compile against it.
    expect(read({ kind: 'entryRef', entryId: 'e1' })).toBe('e1');
    expect(read({ kind: 'url', href: '/about' })).toBe('');
  });

  it('requires a default arm: an exhaustive switch cannot cover the union', () => {
    // The migration hazard recorded in the header. Both admin apps' `targetForKind` switches over
    // their own CLOSED four-member union with no `default` and relies on exhaustiveness for its
    // return type; that shape emits TS2366 against this union. A `default` arm is the fix, and
    // belongs in the host.
    const classify = (target: AdminMenuTarget): string => {
      switch (target.kind) {
        case 'entryRef':
          return 'entry';
        case 'termRef':
          return 'term';
        case 'url':
          return 'url';
        case 'route':
          return 'route';
        default:
          return `custom:${target.kind}`;
      }
    };

    expect(classify({ kind: 'entryRef', entryId: 'e1' })).toBe('entry');
    expect(classify({ kind: 'termRef', termId: 't1', taxonomy: 'category' })).toBe('term');
    expect(classify({ kind: 'productRef', data: { sku: 'x' } })).toBe('custom:productRef');
  });

  it('narrows normally once a value carries its own literal type', () => {
    // Why the tax is tolerable in practice: a host constructing a target keeps full type safety.
    const target = { kind: 'termRef', termId: 't1', taxonomy: 'category' } satisfies AdminMenuTarget;
    expect(target.termId).toBe('t1');
    expect(target.taxonomy).toBe('category');
  });
});
