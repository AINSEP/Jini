import { describe, expect, it } from 'vitest';
import { findSelectedItem, resolveListDetailSelection } from '../rules.js';

interface Item {
  id: string;
}

describe('resolveListDetailSelection', () => {
  it('clears the selection when items is empty', () => {
    expect(resolveListDetailSelection<Item>({ items: [], currentId: 'a' })).toBeNull();
    expect(resolveListDetailSelection<Item>({ items: [], currentId: null })).toBeNull();
  });

  it('keeps the current pick when it is still present', () => {
    const items: Item[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(resolveListDetailSelection({ items, currentId: 'b' })).toBe('b');
  });

  it('falls back to the first item when the current pick is gone', () => {
    const items: Item[] = [{ id: 'a' }, { id: 'b' }];
    expect(resolveListDetailSelection({ items, currentId: 'z' })).toBe('a');
  });

  it('falls back to the first item when nothing is selected yet', () => {
    const items: Item[] = [{ id: 'a' }, { id: 'b' }];
    expect(resolveListDetailSelection({ items, currentId: null })).toBe('a');
  });
});

describe('findSelectedItem', () => {
  const items: Item[] = [{ id: 'a' }, { id: 'b' }];

  it('returns null when selectedId is null', () => {
    expect(findSelectedItem({ items, selectedId: null })).toBeNull();
  });

  it('returns null when selectedId is not present', () => {
    expect(findSelectedItem({ items, selectedId: 'missing' })).toBeNull();
  });

  it('returns the matching item', () => {
    expect(findSelectedItem({ items, selectedId: 'b' })).toBe(items[1]);
  });
});
