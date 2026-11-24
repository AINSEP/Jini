/** Native menu items that persist before they apply, and in-place refresh of installed menus. */

/** A checkbox whose click saves first; a failed save restores the last saved state. */
export interface PersistedCheckboxItem {
  type: 'checkbox';
  label: string;
  checked: boolean;
  click: (item: { checked: boolean }) => void;
}

/**
 * A native checkbox that keeps the last successfully saved state, so a failed save puts back the
 * value that is actually on disk rather than the one the menu was built with. O(1) per click.
 */
export function persistedCheckbox({ label, checked, save, onError }: {
  label: string;
  checked: boolean;
  save: (args: { checked: boolean }) => void;
  onError: (args: { error: unknown }) => void;
}, _optional = {}): PersistedCheckboxItem {
  let saved = checked;
  return {
    type: 'checkbox', label, checked,
    click(item) {
      try { save({ checked: item.checked }); saved = item.checked; }
      catch (error) { item.checked = saved; onError({ error }); }
    },
  };
}

interface RadioState { id: string; checked: boolean }

/** One radio of a persisted group; Electron passes the clicked item and, with it, its menu. */
export interface PersistedRadioItem extends RadioState {
  type: 'radio';
  label: string;
  click: (item: { checked: boolean; menu?: { items: RadioState[] } }) => void;
}

/**
 * A native radio group that saves before it applies. A failed save re-checks the last saved radio
 * across the whole group, because Electron has already moved the check to the clicked one.
 * @complexity O(values) to build and per failed click.
 */
export function persistedRadioGroup<T>({ values, checked, idOf, labelOf, save, onError }: {
  values: readonly T[];
  checked: T;
  idOf: (args: { value: T }) => string;
  labelOf: (args: { value: T }) => string;
  save: (args: { value: T }) => void;
  onError: (args: { error: unknown }) => void;
}, _optional = {}): PersistedRadioItem[] {
  let saved = checked;
  const items: PersistedRadioItem[] = values.map(value => ({
    id: idOf({ value }), label: labelOf({ value }), type: 'radio', checked: value === saved,
    click(item) {
      try { save({ value }); saved = value; }
      catch (error) {
        for (const radio of item.menu?.items ?? items) radio.checked = radio.id === idOf({ value: saved });
        item.checked = value === saved;
        onError({ error });
      }
    },
  }));
  return items;
}

/** Electron's `Menu` statics, narrowed to finding the installed menu's items by id. */
export interface RadioMenuPort {
  getApplicationMenu(): { getMenuItemById(id: string): { checked: boolean } | null } | null;
}

/**
 * Check the installed radio matching `checked`, so a choice saved elsewhere never disagrees with the
 * native menu. Electron leaves sibling radios alone when one is set from code, so each is set.
 * No installed menu is a no-op. O(values).
 */
export function refreshRadioGroup<T>({ menu, values, idOf, checked }: {
  menu: RadioMenuPort; values: readonly T[]; idOf: (args: { value: T }) => string; checked: T;
}, _optional = {}): void {
  const installed = menu.getApplicationMenu();
  for (const value of values) {
    const radio = installed?.getMenuItemById(idOf({ value }));
    if (radio) radio.checked = value === checked;
  }
}

/** The slice of an installed Electron `Menu` a label refresh walks. */
export interface CheckableMenu {
  items: { submenu?: { items: { label: string; checked: boolean }[] } | null }[];
}

/** Electron's `Menu` statics: the installed application menu, if any. */
export interface ApplicationMenuPort {
  getApplicationMenu(): CheckableMenu | null;
}

/** Set each labelled checkbox in the installed menu's submenus without rebuilding any menu. O(items). */
export function refreshCheckboxesByLabel({ menu, checked }: {
  menu: ApplicationMenuPort; checked: Readonly<Record<string, boolean>>;
}, _optional = {}): void {
  const items = menu.getApplicationMenu()?.items.flatMap(item => item.submenu?.items ?? []) ?? [];
  for (const item of items) {
    if (Object.hasOwn(checked, item.label)) item.checked = checked[item.label]!;
  }
}
