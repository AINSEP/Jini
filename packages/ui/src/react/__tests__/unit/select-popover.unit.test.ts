/**
 * Decision functions in `components/select-popover.ts` — Tab-neighbour resolution, the reposition /
 * dismiss-when-hidden rule, and keyboard navigation dispatch — plus the non-portal Tab path of
 * `useSelectPopover`. The variants' own suites (`CustomSelect.test.tsx`, `admin-widgets` Select tests)
 * cover these through rendered components; this file pins each branch directly.
 *
 * jsdom implements neither `showModal()` nor the `:modal` pseudo-class (it throws on the selector),
 * so a "modal" dialog here is an open `<dialog>` whose `matches(':modal')` answers as a browser's
 * would for a dialog opened with `showModal()`.
 */
import { act, renderHook } from '@testing-library/react';
import type { KeyboardEvent } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applySelectNavigationKey,
  repositionSelectPopover,
  resolveTabTarget,
  useSelectPopover,
} from '../../components/select-popover.js';

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function button(id: string, parent: ParentNode = document.body): HTMLButtonElement {
  const el = document.createElement('button');
  el.id = id;
  parent.appendChild(el);
  return el;
}

function openDialog({ modal }: { modal: boolean }): HTMLDialogElement {
  const dialog = document.createElement('dialog');
  dialog.setAttribute('open', '');
  const nativeMatches = dialog.matches.bind(dialog);
  dialog.matches = (selector: string) => (selector === ':modal' ? modal : nativeMatches(selector));
  document.body.appendChild(dialog);
  return dialog;
}

describe('resolveTabTarget', () => {
  it('returns the next DOM-order neighbour', () => {
    const trigger = button('a');
    button('b');
    expect(resolveTabTarget({ panel: null, trigger, shiftKey: false })?.id).toBe('b');
  });

  it('returns null past the last control outside a modal dialog', () => {
    button('a');
    const trigger = button('b');
    expect(resolveTabTarget({ panel: null, trigger, shiftKey: false })).toBeNull();
  });

  it('returns null when the trigger is not focusable in DOM order', () => {
    const trigger = button('a');
    trigger.disabled = true;
    expect(resolveTabTarget({ panel: null, trigger, shiftKey: false })).toBeNull();
  });

  it('wraps forward to the first control inside a modal dialog', () => {
    button('outside');
    const dialog = openDialog({ modal: true });
    button('first', dialog);
    const trigger = button('last', dialog);
    expect(resolveTabTarget({ panel: null, trigger, shiftKey: false })?.id).toBe('first');
  });

  it('wraps backward to the last control inside a modal dialog', () => {
    const dialog = openDialog({ modal: true });
    const trigger = button('first', dialog);
    button('last', dialog);
    button('after');
    expect(resolveTabTarget({ panel: null, trigger, shiftKey: true })?.id).toBe('last');
  });

  it('walks the whole page from inside a non-modal open dialog', () => {
    const dialog = openDialog({ modal: false });
    const trigger = button('inside', dialog);
    button('after');
    expect(resolveTabTarget({ panel: null, trigger, shiftKey: false })?.id).toBe('after');
  });

  it('skips the controls inside the excluded panel', () => {
    const trigger = button('a');
    const panel = document.createElement('div');
    document.body.appendChild(panel);
    button('in-panel', panel);
    button('c');
    expect(resolveTabTarget({ panel, trigger, shiftKey: false })?.id).toBe('c');
  });
});

describe('repositionSelectPopover', () => {
  function trigger(rect: { top: number; left: number; width: number; height: number }): HTMLButtonElement {
    const el = button('t');
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({ x: rect.left, y: rect.top, width: rect.width, height: rect.height }),
    );
    return el;
  }
  const VISIBLE = { top: 10, left: 10, width: 20, height: 20 };

  function run(el: HTMLElement, withOnOutOfView = true) {
    const setPosition = vi.fn<(position: string) => void>();
    const onOutOfView = vi.fn<() => void>();
    repositionSelectPopover(
      { trigger: el, measurePosition: () => 'measured', setPosition },
      withOnOutOfView ? { onOutOfView } : {},
    );
    return { setPosition, onOutOfView };
  }

  it('repositions without any visibility check when no onOutOfView is given', () => {
    const { setPosition } = run(trigger({ top: -100, left: 10, width: 20, height: 20 }), false);
    expect(setPosition).toHaveBeenCalledWith('measured');
  });

  it.each([
    ['above the viewport', { top: -30, left: 10, width: 20, height: 20 }],
    ['below the viewport', { top: window.innerHeight, left: 10, width: 20, height: 20 }],
    ['left of the viewport', { top: 10, left: -30, width: 20, height: 20 }],
    ['right of the viewport', { top: 10, left: window.innerWidth, width: 20, height: 20 }],
  ])('dismisses a trigger %s instead of repositioning', (_where, rect) => {
    const { setPosition, onOutOfView } = run(trigger(rect));
    expect(onOutOfView).toHaveBeenCalledTimes(1);
    expect(setPosition).not.toHaveBeenCalled();
  });

  it('repositions an in-view trigger when the browser cannot hit-test', () => {
    const el = trigger(VISIBLE);
    const { setPosition, onOutOfView } = run(el);
    expect(typeof document.elementFromPoint).not.toBe('function');
    expect(onOutOfView).not.toHaveBeenCalled();
    expect(setPosition).toHaveBeenCalledWith('measured');
  });

  it.each([
    ['the trigger itself', (el: HTMLElement) => el],
    ['a child of the trigger', (el: HTMLElement) => el.appendChild(document.createElement('span'))],
    ['an ancestor of the trigger', () => document.body],
  ])('repositions when the topmost element at its centre is %s', (_what, topmost) => {
    const el = trigger(VISIBLE);
    const hit = topmost(el);
    document.elementFromPoint = () => hit;
    try {
      const { setPosition, onOutOfView } = run(el);
      expect(onOutOfView).not.toHaveBeenCalled();
      expect(setPosition).toHaveBeenCalledWith('measured');
    } finally {
      Reflect.deleteProperty(document, 'elementFromPoint');
    }
  });

  it.each([
    ['an unrelated element', () => button('cover')],
    ['nothing', () => null],
  ])('dismisses an obscured trigger when the topmost element at its centre is %s', (_what, topmost) => {
    const el = trigger(VISIBLE);
    const hit = topmost();
    document.elementFromPoint = () => hit;
    try {
      const { setPosition, onOutOfView } = run(el);
      expect(onOutOfView).toHaveBeenCalledTimes(1);
      expect(setPosition).not.toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(document, 'elementFromPoint');
    }
  });
});

describe('applySelectNavigationKey', () => {
  function actions() {
    return { preventDefault: vi.fn<() => void>(), move: vi.fn<(delta: 1 | -1) => void>(), edge: vi.fn<(edge: 'first' | 'last') => void>(), choose: vi.fn<() => void>() };
  }

  it.each([
    ['ArrowDown', 'move', 1],
    ['ArrowUp', 'move', -1],
    ['Home', 'edge', 'first'],
    ['End', 'edge', 'last'],
  ] as const)('maps %s to %s(%s)', (key, action, arg) => {
    const a = actions();
    expect(applySelectNavigationKey({ key, actions: a })).toBe(true);
    expect(a.preventDefault).toHaveBeenCalledTimes(1);
    expect(a[action]).toHaveBeenCalledWith(arg);
  });

  it('chooses on Enter', () => {
    const a = actions();
    expect(applySelectNavigationKey({ key: 'Enter', actions: a })).toBe(true);
    expect(a.preventDefault).toHaveBeenCalledTimes(1);
    expect(a.choose).toHaveBeenCalledTimes(1);
  });

  it('chooses on Space when spaceChooses is set', () => {
    const a = actions();
    expect(applySelectNavigationKey({ key: ' ', actions: a }, { spaceChooses: true })).toBe(true);
    expect(a.choose).toHaveBeenCalledTimes(1);
  });

  it('ignores Space by default', () => {
    const a = actions();
    expect(applySelectNavigationKey({ key: ' ', actions: a })).toBe(false);
    expect(a.preventDefault).not.toHaveBeenCalled();
    expect(a.choose).not.toHaveBeenCalled();
  });

  it.each(['a', 'Tab', 'toString', 'constructor'])('ignores the unrelated key %j', (key) => {
    const a = actions();
    expect(applySelectNavigationKey({ key, actions: a }, { spaceChooses: true })).toBe(false);
    expect(a.preventDefault).not.toHaveBeenCalled();
  });
});

describe('useSelectPopover Tab without a portal', () => {
  it('closes the panel and leaves native Tab handling alone', () => {
    const { result } = renderHook(() => useSelectPopover({ measurePosition: () => 'p' }, { portal: false }));
    act(() => result.current.openPanel());
    expect(result.current.open).toBe(true);
    const preventDefault = vi.fn<() => void>();
    const event = { key: 'Tab', shiftKey: false, preventDefault, stopPropagation: vi.fn<() => void>() };
    let handled = false;
    act(() => {
      handled = result.current.handleDismissKey(event as Pick<KeyboardEvent<HTMLElement>, 'key' | 'shiftKey' | 'preventDefault' | 'stopPropagation'> as KeyboardEvent<HTMLElement>);
    });
    expect(handled).toBe(true);
    expect(result.current.open).toBe(false);
    expect(preventDefault).not.toHaveBeenCalled();
  });
});

describe('resolveTabTarget without an attached trigger', () => {
  it('returns null when the trigger ref is still unattached', () => {
    button('a');
    expect(resolveTabTarget({ panel: null, trigger: null, shiftKey: false })).toBeNull();
  });
});

describe('useSelectPopover portal lifecycle', () => {
  function outOfViewTrigger(): HTMLButtonElement {
    const el = button('trigger');
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({ x: 10, y: -100, width: 20, height: 20 }));
    return el;
  }

  it('focuses the panel only after the first measured position exists', () => {
    const focusInitial = vi.fn<(input: { panel: HTMLDivElement | null }) => void>();
    const { result } = renderHook(() => useSelectPopover({ measurePosition: () => 'measured' }, { focusInitial }));
    const panel = document.createElement('div');
    result.current.triggerRef.current = button('trigger');
    result.current.panelRef.current = panel;
    act(() => result.current.openPanel());
    expect(result.current.position).toBe('measured');
    expect(focusInitial).toHaveBeenCalledWith({ panel });
  });

  it('ignores a scroll while open once the trigger has been detached', () => {
    const measurePosition = vi.fn<() => string>(() => 'measured');
    const { result } = renderHook(() => useSelectPopover({ measurePosition }));
    act(() => result.current.openPanel());
    act(() => { window.dispatchEvent(new Event('scroll')); });
    expect(result.current.open).toBe(true);
    expect(measurePosition).not.toHaveBeenCalled();
  });

  it('closes without refocusing the trigger when dismissWhenHidden sees it scroll out of view', () => {
    const { result } = renderHook(() => useSelectPopover({ measurePosition: () => 'measured' }, { dismissWhenHidden: true }));
    const trigger = outOfViewTrigger();
    result.current.triggerRef.current = trigger;
    act(() => result.current.openPanel());
    act(() => { window.dispatchEvent(new Event('scroll')); });
    expect(result.current.open).toBe(false);
    expect(result.current.position).toBeNull();
    expect(document.activeElement).not.toBe(trigger);
  });
});
