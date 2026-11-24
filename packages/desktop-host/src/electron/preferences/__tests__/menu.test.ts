import { describe, expect, it } from 'vitest';
import { persistedCheckbox, persistedRadioGroup, refreshCheckboxesByLabel, refreshRadioGroup } from '../menu.js';

describe('persistedCheckbox', () => {
  it('saves the clicked state, and a failed save restores the last saved state', () => {
    const saved: boolean[] = [];
    const errors: unknown[] = [];
    let fail = false;
    const item = persistedCheckbox({ label: 'Auto', checked: true,
      save: ({ checked }) => { if (fail) throw new Error('disk full'); saved.push(checked); },
      onError: ({ error }) => { errors.push(error); } });
    expect(item).toMatchObject({ type: 'checkbox', label: 'Auto', checked: true });
    item.click({ checked: false });
    expect(saved).toEqual([false]);
    fail = true;
    const attempted = { checked: true };
    item.click(attempted);
    expect(attempted.checked).toBe(false);
    expect(errors).toHaveLength(1);
  });
});

describe('persistedRadioGroup', () => {
  const idOf = ({ value }: { value: number }) => `count-${value}`;
  const build = (save: (args: { value: number }) => void, errors: unknown[] = []) =>
    persistedRadioGroup({ values: [1, 2, 3], checked: 2, idOf, labelOf: ({ value }) => `${value} sites`, save, onError: ({ error }) => { errors.push(error); } });

  it('builds one radio per value with the saved one checked', () => {
    expect(build(() => {}).map(({ id, label, type, checked }) => ({ id, label, type, checked }))).toEqual([
      { id: 'count-1', label: '1 sites', type: 'radio', checked: false },
      { id: 'count-2', label: '2 sites', type: 'radio', checked: true },
      { id: 'count-3', label: '3 sites', type: 'radio', checked: false },
    ]);
  });

  it('a failed save re-checks the last saved radio across the native group', () => {
    let fail = false;
    const errors: unknown[] = [];
    const items = build(({ value }) => { if (fail) throw new Error(`no ${value}`); }, errors);
    items[2]!.click({ checked: true });
    fail = true;
    const native = items.map(({ id }) => ({ id, checked: id === 'count-1' }));
    const clicked = { checked: true, menu: { items: native } };
    items[0]!.click(clicked);
    expect(native.map(radio => radio.checked)).toEqual([false, false, true]);
    expect(clicked.checked).toBe(false);
    expect(errors).toHaveLength(1);
  });

  it('without a native menu the built items themselves are restored', () => {
    const items = build(() => { throw new Error('nope'); });
    items[0]!.checked = true;
    items[0]!.click({ checked: true });
    expect(items.map(radio => radio.checked)).toEqual([false, true, false]);
  });
});

describe('menu refresh', () => {
  it('checks only the matching installed radio and tolerates missing items or menus', () => {
    const radios: Record<string, { checked: boolean }> = { 'r-1': { checked: true }, 'r-3': { checked: false } };
    const menu = { getApplicationMenu: () => ({ getMenuItemById: (id: string) => radios[id] ?? null }) };
    refreshRadioGroup({ menu, values: [1, 2, 3], idOf: ({ value }) => `r-${value}`, checked: 3 });
    expect(radios).toEqual({ 'r-1': { checked: false }, 'r-3': { checked: true } });
    expect(() => refreshRadioGroup({ menu: { getApplicationMenu: () => null }, values: [1], idOf: () => 'x', checked: 1 })).not.toThrow();
  });

  it('sets labelled checkboxes in place and leaves other items alone', () => {
    const a = { label: 'A', checked: false };
    const b = { label: 'B', checked: true };
    const other = { label: 'toString', checked: true };
    refreshCheckboxesByLabel({ menu: { getApplicationMenu: () => ({ items: [{ submenu: { items: [a, other] } }, { submenu: null }, {}, { submenu: { items: [b] } }] }) },
      checked: { A: true, B: false } });
    expect([a.checked, b.checked, other.checked]).toEqual([true, false, true]);
    expect(() => refreshCheckboxesByLabel({ menu: { getApplicationMenu: () => null }, checked: { A: true } })).not.toThrow();
  });
});
