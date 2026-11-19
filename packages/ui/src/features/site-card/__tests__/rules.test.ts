import { expect, it } from 'vitest';
import { cardOpenProps, closeMenuThen, duplicateDisplayNames, isCardOpenKey } from '../rules.js';

// Identity alone models the two DOM nodes compared by isCardOpenKey.
const card = { id: 'the card' } as unknown as EventTarget;
// Any descendant control can trigger the bubbling-key regression, including a menu entry.
const descendantControl = { id: 'a descendant button' } as unknown as EventTarget;

it('Enter or Space on the card itself opens the project', () => {
  expect(isCardOpenKey({ key: 'Enter', target: card, currentTarget: card })).toBe(true);
  expect(isCardOpenKey({ key: ' ', target: card, currentTarget: card })).toBe(true);
});

it('any other key on the card does nothing', () => {
  for (const key of ['Tab', 'Escape', 'a', 'ArrowDown', 'Delete', 'Backspace']) {
    expect(isCardOpenKey({ key, target: card, currentTarget: card }), key).toBe(false);
  }
});

it('Enter or Space on a control INSIDE the card does not open the project', () => {
  // A bubbled descendant key must retain its browser-synthesized click; handling it on the
  // ancestor would prevent that click and open the card underneath the focused control.
  expect(isCardOpenKey({ key: 'Enter', target: descendantControl, currentTarget: card })).toBe(false);
  expect(isCardOpenKey({ key: ' ', target: descendantControl, currentTarget: card })).toBe(false);
});

it('a menu entry closes the menu BEFORE running its action', () => {
  // Acting first would leave an open menu floating over whatever the action changed.
  const calls: string[] = [];
  const choose = closeMenuThen({ setOpen: (open) => calls.push(`setOpen:${open}`) });
  const onClick = choose({ act: () => calls.push('act') });
  expect(calls).toHaveLength(0);
  onClick();
  expect(calls).toEqual(['setOpen:false', 'act']);
});

it('every entry built from one closeMenuThen runs only its own action', () => {
  const calls: string[] = [];
  const choose = closeMenuThen({ setOpen: (open) => calls.push(`setOpen:${open}`) });
  const rename = choose({ act: () => calls.push('rename') });
  const start = choose({ act: () => calls.push('start') });
  start();
  rename();
  expect(calls).toEqual(['setOpen:false', 'start', 'setOpen:false', 'rename']);
});

it('cardOpenProps opens only for accepted keys on the card and leaves descendant controls alone', () => {
  for (const [key, target, expected] of [
    ['Enter', card, 1], [' ', card, 1], ['Escape', card, 0],
    ['Enter', descendantControl, 0], [' ', descendantControl, 0],
  ] as const) {
    let opened = 0;
    let prevented = 0;
    const props = cardOpenProps({ openable: true, onOpen: () => opened++ });
    expect(props.role).toBe('button');
    expect(props.tabIndex).toBe(0);
    props.onKeyDown!({ key, target, currentTarget: card, preventDefault: () => prevented++ });
    expect(opened, key).toBe(expected);
    expect(prevented, key).toBe(expected);
  }
});

it('cardOpenProps opens on click when openable', () => {
  let opened = 0;
  cardOpenProps({ openable: true, onOpen: () => opened++ }).onClick!();
  expect(opened).toBe(1);
});

it('cardOpenProps returns inert props without opening when not openable', () => {
  let opened = 0;
  expect(cardOpenProps({ openable: false, onOpen: () => opened++ })).toEqual({
    role: undefined, tabIndex: undefined, onClick: undefined, onKeyDown: undefined,
  });
  expect(opened).toBe(0);
});

it('duplicateDisplayNames: only names more than one site has', () => {
  const projects = ['Bakery', 'Cafe', 'Bakery', 'Bakery'].map((displayName) => ({ displayName }));
  expect([...duplicateDisplayNames({ projects })]).toEqual(['Bakery']);
});

it('duplicateDisplayNames: an empty list has no duplicate names', () => {
  expect([...duplicateDisplayNames({ projects: [] })]).toEqual([]);
});
