// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, expect, it } from 'vitest';
import { menuFocusIndex, useMenuKeyboard, type DocumentFocus } from '../useMenuKeyboard.js';

afterEach(cleanup);

it('menu arrow keys wrap at both ends, Home/End jump, and other keys are left alone', () => {
  const at = (key: string, current: number) => menuFocusIndex({ key, current, count: 5 });
  expect(at('ArrowDown', -1)).toBe(0);
  expect(at('ArrowDown', 1)).toBe(2);
  expect(at('ArrowDown', 4)).toBe(0);
  expect(at('ArrowUp', 0)).toBe(4);
  expect(at('ArrowUp', -1)).toBe(4);
  expect(at('ArrowUp', 3)).toBe(2);
  expect(at('Home', 3)).toBe(0);
  expect(at('End', 0)).toBe(4);
  expect(at('Enter', 2)).toBeNull();
  expect(at('Tab', 2)).toBeNull();
  expect(menuFocusIndex({ key: 'ArrowDown', current: -1, count: 0 })).toBeNull();
});

it('a one-entry menu keeps focus on its only entry whichever way the arrows go', () => {
  for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End']) {
    expect(menuFocusIndex({ key, current: 0, count: 1 }), key).toBe(0);
  }
});

function menuHarness({ prefix, keepMounted = false, entryCount = 3, doc }: { prefix: string; keepMounted?: boolean; entryCount?: number; doc?: DocumentFocus }) {
  let current: ReturnType<typeof useMenuKeyboard<HTMLDivElement, HTMLButtonElement>>;
  const id = (name: string) => `${prefix}-${name}`;
  function Harness({ open }: { open: boolean }) {
    current = useMenuKeyboard<HTMLDivElement, HTMLButtonElement>({ open }, { doc });
    return createElement('div', null,
      createElement('button', { id: id('trigger'), ref: current.triggerRef }),
      createElement('button', { id: id('elsewhere') }),
      open || keepMounted ? createElement('div', { role: 'menu', ref: current.menuRef, hidden: !open },
        ...['one', 'two', 'three'].slice(0, entryCount).map((name) => createElement('button', {
          key: name, role: name === 'two' ? 'menuitemradio' : 'menuitem', id: id(name),
        }))) : null);
  }
  const view = render(createElement(Harness, { open: false }));
  const key = (name: string) => {
    let prevented = false;
    act(() => current.onMenuKeyDown({ key: name, preventDefault: () => { prevented = true; } } as never));
    return prevented;
  };
  return {
    setOpen: (open: boolean) => view.rerender(createElement(Harness, { open })),
    key,
    focused: () => document.activeElement?.id.replace(`${prefix}-`, ''),
    element: (name: string) => document.getElementById(id(name))!,
  };
}

it('useMenuKeyboard: opening focuses the first entry and the arrows, Home and End move between entries', () => {
  const menu = menuHarness({ prefix: 'nav' });
  menu.setOpen(true);
  expect(menu.focused()).toBe('one');
  expect(menu.key('ArrowDown')).toBe(true);
  expect(menu.focused()).toBe('two');
  menu.key('End');
  expect(menu.focused()).toBe('three');
  menu.key('ArrowDown');
  expect(menu.focused()).toBe('one');
  menu.key('ArrowUp');
  expect(menu.focused()).toBe('three');
  menu.key('Home');
  expect(menu.focused()).toBe('one');
  expect(menu.key('a')).toBe(false);
  expect(menu.focused()).toBe('one');
});

it('useMenuKeyboard: closing with focus inside (or nowhere) returns it to the trigger; a deliberate click away is left alone', () => {
  const menu = menuHarness({ prefix: 'close' });
  menu.setOpen(true);
  menu.setOpen(false);
  expect(menu.focused()).toBe('trigger');
  expect(menu.key('ArrowDown')).toBe(false);
  menu.setOpen(true);
  (document.activeElement as HTMLElement).blur();
  expect(document.activeElement).toBe(document.body);
  menu.setOpen(false);
  expect(menu.focused()).toBe('trigger');
  menu.setOpen(true);
  menu.element('elsewhere').focus();
  menu.setOpen(false);
  expect(menu.focused()).toBe('elsewhere');
});

// A still-mounted hidden menu retains its entry, unlike an unmounted menu whose focus falls to body.
it('useMenuKeyboard: a menu that stays mounted while closed returns focus from inside it, and not from outside', () => {
  const menu = menuHarness({ prefix: 'kept', keepMounted: true, entryCount: 2 });
  menu.setOpen(true);
  menu.element('two').focus();
  menu.setOpen(false);
  expect(menu.focused()).toBe('trigger');
  menu.setOpen(true);
  menu.element('elsewhere').focus();
  menu.setOpen(false);
  expect(menu.focused()).toBe('elsewhere');
});

it('useMenuKeyboard: a document reporting no focused element at all still hands focus back to the trigger', () => {
  const doc: { activeElement: Element | null; body: HTMLElement } = { activeElement: null, body: document.body };
  const menu = menuHarness({ prefix: 'null', entryCount: 1, doc: doc as DocumentFocus });
  menu.setOpen(true);
  expect(document.activeElement?.id).toBe('null-one');
  doc.activeElement = null;
  menu.setOpen(false);
  expect(document.activeElement?.id).toBe('null-trigger');
});

it('useMenuKeyboard: arrow keys read the current entry from the injected document', () => {
  const doc: { activeElement: Element | null; body: HTMLElement } = { activeElement: null, body: document.body };
  const menu = menuHarness({ prefix: 'port', entryCount: 2, doc: doc as DocumentFocus });
  menu.setOpen(true);
  doc.activeElement = menu.element('two');
  menu.key('ArrowDown');
  expect(document.activeElement?.id).toBe('port-one');
});
