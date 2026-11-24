// @vitest-environment jsdom
/**
 * `useDismissibleDropdown` rendered under jsdom with markup built from its own ref, and
 * `settingsControlHandlers` run against the real function. Moved from a host's desktop renderer
 * tests (node:test) with assertions unchanged; the `menuFocusIndex`/`useMenuKeyboard` cases that
 * file also carried are already in `useMenuKeyboard.test.tsx` here.
 */
import { act, cleanup, render } from '@testing-library/react';
import { createElement, type SetStateAction } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { settingsControlHandlers, useDismissibleDropdown, type DismissibleDropdown } from '../useDismissibleDropdown.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderDropdown(insideId: string) {
  let current!: DismissibleDropdown<HTMLDivElement>;
  function Harness() {
    current = useDismissibleDropdown<HTMLDivElement>();
    return createElement('div', { ref: current.containerRef }, createElement('button', { id: insideId }));
  }
  const view = render(createElement(Harness));
  return { current: () => current, unmount: view.unmount };
}

it('useDismissibleDropdown: outside pointerdown and Escape close it; a press inside does not', () => {
  const hook = renderDropdown('inside');
  const pointer = (target: Element) => act(() => { target.dispatchEvent(new window.Event('pointerdown', { bubbles: true })); });
  act(() => hook.current().setOpen(true));
  pointer(document.getElementById('inside')!);
  expect(hook.current().open).toBe(true);
  pointer(document.body);
  expect(hook.current().open).toBe(false);
  act(() => hook.current().setOpen(true));
  const inside = document.getElementById('inside')!;
  inside.addEventListener('keydown', event => event.stopPropagation());
  act(() => { inside.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, isComposing: true })); });
  expect(hook.current().open).toBe(true);
  act(() => { inside.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  expect(hook.current().open).toBe(false);
});

it('useDismissibleDropdown: listens only while open, ignores other keys, and detaches on close and unmount', () => {
  const live = new Set<EventListenerOrEventListenerObject>();
  const addEventListener = document.addEventListener.bind(document);
  const removeEventListener = document.removeEventListener.bind(document);
  vi.spyOn(document, 'addEventListener').mockImplementation((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
    if (type === 'pointerdown' || type === 'keydown') live.add(listener);
    addEventListener(type, listener, options);
  });
  vi.spyOn(document, 'removeEventListener').mockImplementation((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) => {
    if (type === 'pointerdown' || type === 'keydown') live.delete(listener);
    removeEventListener(type, listener, options);
  });
  const hook = renderDropdown('counted-inside');
  expect(live.size, 'a closed dropdown listens to nothing').toBe(0);
  act(() => hook.current().setOpen(true));
  expect(live.size, 'one pointerdown and one keydown listener').toBe(2);
  act(() => { document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter' })); });
  expect(hook.current().open, 'a key that is not Escape leaves it open').toBe(true);
  act(() => { document.body.dispatchEvent(new window.Event('pointerdown', { bubbles: true })); });
  expect([hook.current().open, live.size]).toEqual([false, 0]);
  act(() => hook.current().setOpen(true));
  hook.unmount();
  expect(live.size).toBe(0);
});

/** `settingsControlHandlers` over a live open flag, recording every effect in order. */
function recordingSettings(disabled: boolean) {
  const calls: string[] = [];
  let open = false;
  const handlers = settingsControlHandlers<string>({
    disabled,
    setOpen: (next: SetStateAction<boolean>) => {
      open = typeof next === 'function' ? next(open) : next;
      calls.push(`open:${open}`);
    },
    onThemeChange: (theme) => calls.push(`theme:${theme}`),
    onOpenAppearance: () => calls.push('appearance'),
  });
  return { calls, handlers };
}

it('the Settings gear flips its dropdown open, then shut', () => {
  const { calls, handlers } = recordingSettings(false);
  handlers.toggleOpen();
  handlers.toggleOpen();
  expect(calls).toEqual(['open:true', 'open:false']);
});

it('a disabled Settings gear never opens its dropdown', () => {
  const { calls, handlers } = recordingSettings(true);
  handlers.toggleOpen();
  expect(calls.length).toBe(0);
});

it('picking a theme applies it FIRST, then closes the dropdown', () => {
  const { calls, handlers } = recordingSettings(false);
  handlers.chooseTheme({ next: 'dark' });
  expect(calls).toEqual(['theme:dark', 'open:false']);
});

it('the Appearance link closes the dropdown FIRST, then opens the page', () => {
  const { calls, handlers } = recordingSettings(false);
  handlers.openAppearancePage();
  expect(calls).toEqual(['open:false', 'appearance']);
});

it('a disabled control still runs its dropdown entries (they are unreachable, not guarded)', () => {
  const { calls, handlers } = recordingSettings(true);
  handlers.chooseTheme({ next: 'light' });
  handlers.openAppearancePage();
  expect(calls).toEqual(['theme:light', 'open:false', 'open:false', 'appearance']);
});
