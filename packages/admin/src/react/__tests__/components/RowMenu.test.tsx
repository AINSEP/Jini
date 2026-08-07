import { fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { RowMenu, type RowMenuItem } from '../../components/RowMenu/RowMenu.js';

function items(overrides: Partial<RowMenuItem>[] = []): RowMenuItem[] {
  const base: RowMenuItem[] = [
    { key: 'edit', label: 'Edit', onSelect: vi.fn() },
    { key: 'disable', label: 'Disable', onSelect: vi.fn(), tone: 'warning' },
    { key: 'delete', label: 'Delete', onSelect: vi.fn(), destructive: true },
  ];
  return base.map((item, i) => ({ ...item, ...(overrides[i] ?? {}) }));
}

function renderMenu(list: RowMenuItem[] = items()) {
  render(<RowMenu items={list} triggerLabel='Actions for "My Post"' />);
  return {
    list,
    trigger: () => screen.getByRole('button', { name: 'Actions for "My Post"' }),
  };
}

describe('RowMenu trigger', () => {
  it('is a named button that reports its expanded state', () => {
    const { trigger } = renderMenu();
    expect(trigger()).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger());
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
  });

  it('renders nothing but the trigger while closed', () => {
    renderMenu();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('draws three filled circles — the kebab glyph, not a stroked-path hamburger', () => {
    // Guards a deliberate icon decision: the trigger was a three-horizontal-line hamburger, which
    // is the wrong affordance for row overflow. Filled circles rather than stroked rings because
    // at 16px a thin ring goes muddy where a dot stays crisp.
    const { trigger } = renderMenu();
    const svg = trigger().querySelector('svg');
    expect(svg?.querySelectorAll('circle')).toHaveLength(3);
    expect(svg?.querySelector('path')).toBeNull();
  });

  it('keeps the glyph aria-hidden — the accessible name lives on the button', () => {
    const { trigger } = renderMenu();
    expect(trigger().querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(trigger()).toHaveAccessibleName('Actions for "My Post"');
  });

  it('toggles closed on a second click', () => {
    const { trigger } = renderMenu();
    fireEvent.click(trigger());
    fireEvent.click(trigger());
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('RowMenu opening', () => {
  it('portals the menu outside the trigger, as a sibling of the app root', () => {
    const { trigger } = renderMenu();
    fireEvent.click(trigger());
    const menu = screen.getByRole('menu');
    expect(menu.parentElement).toBe(document.body);
    expect(trigger().contains(menu)).toBe(false);
  });

  it('focuses the first item on click', () => {
    const { trigger } = renderMenu();
    fireEvent.click(trigger());
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveFocus();
  });

  it('opens on ArrowDown at the first item and ArrowUp at the last', () => {
    const { trigger } = renderMenu();
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveFocus();

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    fireEvent.keyDown(trigger(), { key: 'ArrowUp' });
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveFocus();
  });
});

describe('RowMenu keyboard navigation', () => {
  it('wraps with ArrowDown/ArrowUp and jumps with Home/End', () => {
    const { trigger } = renderMenu();
    fireEvent.click(trigger());
    const menu = screen.getByRole('menu');

    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: 'Disable' })).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveFocus();

    fireEvent.keyDown(menu, { key: 'Home' });
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'End' });
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveFocus();
  });

  it('uses roving focus — only the active item is tabbable', () => {
    const { trigger } = renderMenu();
    fireEvent.click(trigger());
    for (const item of screen.getAllByRole('menuitem')) {
      expect(item).toHaveAttribute('tabindex', '-1');
    }
  });

  it('Escape closes and returns focus to the trigger', () => {
    const { trigger } = renderMenu();
    fireEvent.click(trigger());
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger()).toHaveFocus();
  });

  it('Tab closes without stealing focus back to the trigger', () => {
    const { trigger } = renderMenu();
    fireEvent.click(trigger());
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Tab' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger()).not.toHaveFocus();
  });

  it('ignores unhandled keys', () => {
    const { trigger } = renderMenu();
    fireEvent.click(trigger());
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'a' });
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });
});

describe('RowMenu selection', () => {
  it('fires the item, closes, and returns focus', () => {
    const list = items();
    const { trigger } = renderMenu(list);
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('menuitem', { name: 'Disable' }));
    expect(list[1]?.onSelect).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger()).toHaveFocus();
  });

  it('closes on an outside mousedown without firing anything', () => {
    const list = items();
    const { trigger } = renderMenu(list);
    fireEvent.click(trigger());
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
    for (const item of list) expect(item.onSelect).not.toHaveBeenCalled();
  });

  it('stays open on a mousedown inside the menu', () => {
    const { trigger } = renderMenu();
    fireEvent.click(trigger());
    fireEvent.mouseDown(screen.getByRole('menuitem', { name: 'Edit' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });
});

describe('RowMenu tone', () => {
  it('maps tone and the deprecated destructive boolean onto the same classes', () => {
    const { trigger } = renderMenu();
    fireEvent.click(trigger());
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveClass('row-menu-item');
    expect(screen.getByRole('menuitem', { name: 'Edit' })).not.toHaveClass('btn-danger', 'btn-warning');
    expect(screen.getByRole('menuitem', { name: 'Disable' })).toHaveClass('btn-warning');
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveClass('btn-danger');
  });

  it('lets tone win over destructive', () => {
    renderMenu([{ key: 'x', label: 'X', onSelect: vi.fn(), tone: 'warning', destructive: true }]);
    fireEvent.click(screen.getByRole('button', { name: 'Actions for "My Post"' }));
    expect(screen.getByRole('menuitem', { name: 'X' })).toHaveClass('btn-warning');
    expect(screen.getByRole('menuitem', { name: 'X' })).not.toHaveClass('btn-danger');
  });
});

describe('RowMenu positioning', () => {
  it('places the menu below the trigger when there is room', () => {
    const { trigger } = renderMenu();
    fireEvent.click(trigger());
    const menu = screen.getByRole('menu');
    expect(menu.style.position).toBe('fixed');
    expect(menu.style.visibility).toBe('visible');
    expect(menu.className).not.toContain('row-menu-popup-above');
  });

  it('flips above when the trigger sits at the bottom of the viewport', () => {
    const { trigger } = renderMenu();
    // jsdom reports zero-sized rects, so both the space-below and the menu height measure 0 and
    // "below" always fits. Drive the decision with real numbers instead.
    vi.spyOn(trigger(), 'getBoundingClientRect').mockReturnValue({
      top: 700,
      bottom: 720,
      left: 300,
      right: 400,
      width: 100,
      height: 20,
      x: 300,
      y: 700,
      toJSON: () => ({}),
    } as DOMRect);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(200);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(160);
    Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true });
    Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });

    fireEvent.click(trigger());
    const menu = screen.getByRole('menu');
    expect(menu.className).toContain('row-menu-popup-above');
    expect(menu.style.transform).toBe('translateY(-100%)');
    vi.restoreAllMocks();
  });

  it('repositions on scroll and resize, and detaches those listeners on close', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { trigger } = renderMenu();

    fireEvent.click(trigger());
    expect(addSpy.mock.calls.some(([type]) => type === 'scroll')).toBe(true);
    expect(addSpy.mock.calls.some(([type]) => type === 'resize')).toBe(true);

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(removeSpy.mock.calls.some(([type]) => type === 'scroll')).toBe(true);
    expect(removeSpy.mock.calls.some(([type]) => type === 'resize')).toBe(true);
    vi.restoreAllMocks();
  });
});

describe('RowMenu hook injection', () => {
  it('renders purely off an injected fake, proving useRowMenu is not hardcoded', () => {
    // A fake that force-opens with a fixed position and spy handlers — none of the real
    // click/keyboard-driven state or `getBoundingClientRect` math runs at all. If `RowMenu`
    // rendered off anything other than what this hook returns, the assertions below would come
    // from the real state instead.
    const fakeOnTriggerClick = vi.fn();
    const fakeSelectItem = vi.fn();
    function useFakeRowMenu() {
      const triggerRef = useRef<HTMLButtonElement>(null);
      const menuRef = useRef<HTMLDivElement>(null);
      const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
      return {
        open: true,
        position: { top: 42, left: 7, placement: 'above' as const },
        triggerRef,
        menuRef,
        itemRefs,
        onTriggerClick: fakeOnTriggerClick,
        onTriggerKeyDown: vi.fn(),
        onMenuKeyDown: vi.fn(),
        selectItem: fakeSelectItem,
      };
    }

    const list = items();
    render(<RowMenu items={list} triggerLabel='Actions for "My Post"' useRowMenu={useFakeRowMenu} />);

    // Open from mount, with the fake's fixed 'above' position, though no click ever happened.
    const menu = screen.getByRole('menu');
    expect(menu.style.top).toBe('42px');
    expect(menu.style.left).toBe('7px');
    expect(menu.className).toContain('row-menu-popup-above');

    // Trigger click and item click are routed through the fake's handlers, not real state.
    fireEvent.click(screen.getByRole('button', { name: 'Actions for "My Post"' }));
    expect(fakeOnTriggerClick).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    expect(fakeSelectItem).toHaveBeenCalledWith(list[0]?.onSelect);
  });
});
