// @vitest-environment jsdom
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  filterVisibleActionGroups,
  HeaderActionsMenu,
  headerMenuItemAriaChecked,
  headerMenuItemBusy,
  headerMenuItemDisabled,
  headerMenuItemIcon,
  headerMenuItemRole,
  isHeaderMenuDismissKey,
  isOutsideHeaderMenu,
  useHeaderActionsMenu,
  useHeaderActionsMenuDisclosure,
  useHeaderActionsMenuDismiss,
  useVisibleActionGroups,
  type HeaderMenuAction,
} from '../../components/HeaderActionsMenu.js';

function action(overrides: Partial<HeaderMenuAction> = {}): HeaderMenuAction {
  return {
    id: 'item-1',
    label: 'Item one',
    icon: 'edit',
    onClick: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Pure helpers — no rendering required.
// ---------------------------------------------------------------------------

describe('HeaderActionsMenu helpers', () => {
  it('filterVisibleActionGroups drops empty groups only', () => {
    const a = action({ id: 'a' });
    const b = action({ id: 'b' });
    expect(filterVisibleActionGroups([[a], [], [b]])).toEqual([[a], [b]]);
    expect(filterVisibleActionGroups([])).toEqual([]);
    expect(filterVisibleActionGroups([[], []])).toEqual([]);
  });

  it('isHeaderMenuDismissKey is true only for Escape', () => {
    expect(isHeaderMenuDismissKey('Escape')).toBe(true);
    expect(isHeaderMenuDismissKey('Tab')).toBe(false);
  });

  it('isOutsideHeaderMenu handles a missing container, contained, and outside targets', () => {
    expect(isOutsideHeaderMenu(null, document.body)).toBe(false);
    const container = document.createElement('div');
    const inner = document.createElement('span');
    container.appendChild(inner);
    document.body.appendChild(container);
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    expect(isOutsideHeaderMenu(container, inner)).toBe(false);
    expect(isOutsideHeaderMenu(container, outside)).toBe(true);
    expect(isOutsideHeaderMenu(container, null)).toBe(true);
    container.remove();
    outside.remove();
  });

  it('headerMenuItemRole is menuitem unless the item is a toggle', () => {
    expect(headerMenuItemRole(undefined)).toBe('menuitem');
    expect(headerMenuItemRole(true)).toBe('menuitemcheckbox');
    expect(headerMenuItemRole(false)).toBe('menuitemcheckbox');
  });

  it('headerMenuItemAriaChecked is only set for toggle items', () => {
    expect(headerMenuItemAriaChecked(undefined)).toBeUndefined();
    expect(headerMenuItemAriaChecked(true)).toBe(true);
    expect(headerMenuItemAriaChecked(false)).toBe(false);
  });

  it('headerMenuItemIcon swaps to a spinner while loading', () => {
    expect(headerMenuItemIcon(action({ icon: 'edit' }))).toBe('edit');
    expect(headerMenuItemIcon(action({ icon: 'edit', loading: true }))).toBe('spinner');
  });

  it('headerMenuItemDisabled is true when disabled or loading', () => {
    expect(headerMenuItemDisabled(action())).toBe(false);
    expect(headerMenuItemDisabled(action({ disabled: true }))).toBe(true);
    expect(headerMenuItemDisabled(action({ loading: true }))).toBe(true);
  });

  it('headerMenuItemBusy is true only while loading, else undefined', () => {
    expect(headerMenuItemBusy(action())).toBeUndefined();
    expect(headerMenuItemBusy(action({ loading: false }))).toBeUndefined();
    expect(headerMenuItemBusy(action({ loading: true }))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Hooks — via renderHook, isolated from the rendered component.
// ---------------------------------------------------------------------------

describe('useHeaderActionsMenuDisclosure', () => {
  it('starts closed and toggles/closes', () => {
    const { result } = renderHook(() => useHeaderActionsMenuDisclosure());
    expect(result.current.open).toBe(false);
    act(() => result.current.toggle());
    expect(result.current.open).toBe(true);
    act(() => result.current.toggle());
    expect(result.current.open).toBe(false);
    act(() => result.current.toggle());
    act(() => result.current.close());
    expect(result.current.open).toBe(false);
  });
});

describe('useVisibleActionGroups', () => {
  it('memoizes the filtered groups', () => {
    const groups = [[action({ id: 'a' })], [], [action({ id: 'b' })]];
    const { result } = renderHook(() => useVisibleActionGroups(groups));
    expect(result.current).toHaveLength(2);
    expect(result.current[0]![0]!.id).toBe('a');
    expect(result.current[1]![0]!.id).toBe('b');
  });
});

describe('useHeaderActionsMenuDismiss', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  const setup = (open: boolean) => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const onDismiss = vi.fn();
    const ref = { current: container as HTMLElement | null };
    renderHook(() => useHeaderActionsMenuDismiss({ open, onDismiss, containerRef: ref }));
    return { container, onDismiss };
  };

  it('does nothing while closed', () => {
    const { onDismiss } = setup(false);
    act(() => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('dismisses on an outside mousedown but not an inside one', () => {
    const { container, onDismiss } = setup(true);
    act(() => container.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('dismisses on Escape but ignores other keys', () => {
    const { onDismiss } = setup(true);
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' })));
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe('useHeaderActionsMenu', () => {
  it('composes disclosure, the visible-group filter, and a container ref', () => {
    const groups = [[action({ id: 'a' })], []];
    const { result } = renderHook(() => useHeaderActionsMenu(groups));
    expect(result.current.open).toBe(false);
    expect(result.current.visibleGroups).toHaveLength(1);
    expect(result.current.containerRef.current).toBeNull();
    act(() => result.current.toggle());
    expect(result.current.open).toBe(true);
    act(() => result.current.close());
    expect(result.current.open).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Component — the dumb render.
// ---------------------------------------------------------------------------

describe('HeaderActionsMenu', () => {
  it('renders nothing when every group is empty', () => {
    const { container } = render(<HeaderActionsMenu groups={[[], []]} label="More actions" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when there are no groups at all', () => {
    const { container } = render(<HeaderActionsMenu groups={[]} label="More actions" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the trigger with the accessible label but keeps the popover closed', () => {
    render(<HeaderActionsMenu groups={[[action()]]} label="More actions" />);
    const trigger = screen.getByTestId('header-actions-menu-trigger');
    expect(trigger).toHaveAttribute('aria-label', 'More actions');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens the popover on trigger click and lists every item', async () => {
    const user = userEvent.setup();
    render(
      <HeaderActionsMenu
        groups={[[action({ id: 'a', label: 'Alpha' }), action({ id: 'b', label: 'Beta' })]]}
        label="More actions"
      />,
    );
    await user.click(screen.getByTestId('header-actions-menu-trigger'));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it('toggles closed when the trigger is clicked again', async () => {
    const user = userEvent.setup();
    render(<HeaderActionsMenu groups={[[action()]]} label="More actions" />);
    const trigger = screen.getByTestId('header-actions-menu-trigger');
    await user.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.click(trigger);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes on outside click', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <div data-testid="outside">outside</div>
        <HeaderActionsMenu groups={[[action()]]} label="More actions" />
      </div>,
    );
    await user.click(screen.getByTestId('header-actions-menu-trigger'));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.click(screen.getByTestId('outside'));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('keeps the menu open on a non-Escape key and an inside mousedown', () => {
    const { container } = render(<HeaderActionsMenu groups={[[action()]]} label="More actions" />);
    fireEvent.click(screen.getByTestId('header-actions-menu-trigger'));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.mouseDown(container.querySelector('.jini-header-actions-menu')!);
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    render(<HeaderActionsMenu groups={[[action()]]} label="More actions" />);
    await user.click(screen.getByTestId('header-actions-menu-trigger'));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('calls the item onClick and closes the menu', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<HeaderActionsMenu groups={[[action({ label: 'Do it', onClick })]]} label="More actions" />);
    await user.click(screen.getByTestId('header-actions-menu-trigger'));
    await user.click(screen.getByText('Do it'));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('renders a divider between multiple non-empty groups but skips empty ones', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <HeaderActionsMenu
        groups={[[action({ id: 'a' })], [], [action({ id: 'b' })]]}
        label="More actions"
      />,
    );
    await user.click(screen.getByTestId('header-actions-menu-trigger'));
    expect(container.querySelectorAll('.jini-header-actions-menu-divider')).toHaveLength(1);
  });

  it('disables and marks aria-busy on a loading item, and renders its spinner icon', async () => {
    const user = userEvent.setup();
    render(<HeaderActionsMenu groups={[[action({ label: 'Saving', loading: true })]]} label="More actions" />);
    await user.click(screen.getByTestId('header-actions-menu-trigger'));
    const button = screen.getByText('Saving').closest('button')!;
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  it('disables a disabled item without marking it busy', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<HeaderActionsMenu groups={[[action({ label: 'Locked', disabled: true, onClick })]]} label="More actions" />);
    await user.click(screen.getByTestId('header-actions-menu-trigger'));
    const button = screen.getByText('Locked').closest('button')!;
    expect(button).toBeDisabled();
    expect(button).not.toHaveAttribute('aria-busy');
  });

  it('renders checkbox semantics and a check glyph for an active item', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <HeaderActionsMenu groups={[[action({ label: 'Toggle me', active: true })]]} label="More actions" />,
    );
    await user.click(screen.getByTestId('header-actions-menu-trigger'));
    const button = screen.getByText('Toggle me').closest('button')!;
    expect(button).toHaveAttribute('role', 'menuitemcheckbox');
    expect(button).toHaveAttribute('aria-checked', 'true');
    expect(container.querySelectorAll('.jini-header-actions-menu-item-check')).toHaveLength(1);
  });

  it('renders plain menuitem semantics for a non-toggle item', async () => {
    const user = userEvent.setup();
    render(<HeaderActionsMenu groups={[[action({ label: 'Plain' })]]} label="More actions" />);
    await user.click(screen.getByTestId('header-actions-menu-trigger'));
    const button = screen.getByText('Plain').closest('button')!;
    expect(button).toHaveAttribute('role', 'menuitem');
    expect(button).not.toHaveAttribute('aria-checked');
  });
});

describe('HeaderActionsMenu with hook override prop', () => {
  it('uses useHeaderActionsMenu hook prop to render a forced closed state (state 1)', () => {
    const mockToggle = vi.fn();
    const customHook = () => ({
      open: false,
      containerRef: { current: null },
      visibleGroups: [[action({ label: 'Action 1' })]],
      toggle: mockToggle,
      close: vi.fn(),
    });

    render(
      <HeaderActionsMenu
        groups={[[action({ label: 'Action 1' })]]}
        label="Custom Trigger Label"
        useHeaderActionsMenu={customHook}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Custom Trigger Label' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(trigger);
    expect(mockToggle).toHaveBeenCalledTimes(1);
  });

  it('uses useHeaderActionsMenu hook prop to render a forced open state with items (state 2)', () => {
    const mockClose = vi.fn();
    const mockOnClick = vi.fn();
    const act1 = action({ id: 'act1', label: 'Action 1', active: true, onClick: mockOnClick });
    const act2 = action({ id: 'act2', label: 'Action 2', loading: true });
    const customHook = () => ({
      open: true,
      containerRef: { current: null },
      visibleGroups: [[act1, act2]],
      toggle: vi.fn(),
      close: mockClose,
    });

    render(
      <HeaderActionsMenu
        groups={[[act1, act2]]}
        label="More actions"
        useHeaderActionsMenu={customHook}
      />,
    );

    expect(screen.getByRole('button', { name: 'More actions' }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('menu')).toBeTruthy();

    const item1 = screen.getByRole('menuitemcheckbox', { name: 'Action 1' });
    expect(item1).toHaveAttribute('aria-checked', 'true');

    const item2 = screen.getByRole('menuitem', { name: 'Action 2' });
    expect(item2).toBeDisabled();
    expect(item2).toHaveAttribute('aria-busy', 'true');

    fireEvent.click(item1);
    expect(mockOnClick).toHaveBeenCalledTimes(1);
    expect(mockClose).toHaveBeenCalledTimes(1);
  });
});
