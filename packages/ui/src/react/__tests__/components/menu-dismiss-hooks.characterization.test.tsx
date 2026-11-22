// @vitest-environment jsdom
/**
 * @file J48 characterization (dedupe design, Tovu `development/refactor-patterns/dedupe/dedupe-06.terra-prompt.md`).
 * Pins the dismiss behavior of the three menu hooks so it holds before AND after they delegate to
 * `useDismissOnOutsideOrEscape`. Today they listen to `mousedown`, the survivor to `pointerdown`; a
 * real click fires both, so each case fires both and expects exactly one dismissal.
 */
import { act, fireEvent, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useHeaderActionsMenuDismiss } from '../../components/HeaderActionsMenu.js';
import { useLanguageMenuDismiss } from '../../components/LanguageMenu.js';
import { usePaletteDismiss } from '../../components/PaletteTweaks.js';

interface Mounted { readonly container: HTMLElement; readonly onDismiss: ReturnType<typeof vi.fn>; readonly unmount: () => void }

function mountContainer(): HTMLElement {
  const container = document.createElement('div');
  container.appendChild(document.createElement('button'));
  document.body.appendChild(container);
  return container;
}

const hooks: ReadonlyArray<readonly [string, (open: boolean) => Mounted]> = [
  ['useHeaderActionsMenuDismiss', (open) => {
    const container = mountContainer();
    const onDismiss = vi.fn();
    const containerRef = { current: container as HTMLElement | null };
    const { unmount } = renderHook(() => useHeaderActionsMenuDismiss({ open, onDismiss, containerRef }));
    return { container, onDismiss, unmount };
  }],
  ['useLanguageMenuDismiss', (open) => {
    const container = mountContainer();
    const onDismiss = vi.fn();
    const containerRef = { current: container as HTMLElement | null };
    const { unmount } = renderHook(() => useLanguageMenuDismiss({ open, onDismiss, containerRef }));
    return { container, onDismiss, unmount };
  }],
  ['usePaletteDismiss', (open) => {
    const container = mountContainer();
    const onDismiss = vi.fn();
    const { result, unmount } = renderHook(() => usePaletteDismiss({ open, onClose: onDismiss }));
    result.current.current = container as HTMLDivElement;
    return { container, onDismiss, unmount };
  }],
];

/** A real click: pointerdown, then mousedown, on the same target. */
function pressOn(target: Element): void {
  act(() => {
    fireEvent.pointerDown(target);
    fireEvent.mouseDown(target);
  });
}

function pressEscape(): void {
  act(() => { fireEvent.keyDown(document, { key: 'Escape' }); });
}

afterEach(() => { document.body.innerHTML = ''; });

describe.each(hooks)('%s (J48 characterization)', (_name, mount) => {
  it('Escape dismisses once while open', () => {
    const { onDismiss } = mount(true);
    pressEscape();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('another key does not dismiss', () => {
    const { onDismiss } = mount(true);
    act(() => { fireEvent.keyDown(document, { key: 'Enter' }); });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('a press inside the container does not dismiss', () => {
    const { container, onDismiss } = mount(true);
    const inner = container.querySelector('button');
    expect(inner).not.toBeNull();
    if (inner) pressOn(inner);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('a press outside dismisses exactly once (pointerdown + mousedown together)', () => {
    const { onDismiss } = mount(true);
    const outside = document.createElement('div');
    document.body.appendChild(outside);
    pressOn(outside);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('nothing dismisses while closed', () => {
    const { onDismiss } = mount(false);
    pressOn(document.body);
    pressEscape();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('nothing dismisses after unmount', () => {
    const { onDismiss, unmount } = mount(true);
    unmount();
    pressOn(document.body);
    pressEscape();
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
