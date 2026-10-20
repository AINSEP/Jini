import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ResourceCard } from '../react/components/ResourceCard.js';
import type { ResourceBoardItem } from '../types.js';

function baseProps(overrides: Partial<React.ComponentProps<typeof ResourceCard>> = {}) {
  const item: ResourceBoardItem = { id: 'p1', title: 'Marketing site', subtitle: 'Freeform', status: 'running' };
  return {
    item,
    selectMode: false,
    selected: false,
    menuOpen: false,
    busy: false,
    moreLabel: 'More',
    onOpen: vi.fn(),
    onToggleSelected: vi.fn(),
    onToggleMenu: vi.fn(),
    onAction: vi.fn(),
    ...overrides,
  };
}

describe('ResourceCard', () => {
  it('renders title and subtitle', () => {
    render(<ResourceCard {...baseProps()} />);
    expect(screen.getByText('Marketing site')).toBeInTheDocument();
    expect(screen.getByText('Freeform')).toBeInTheDocument();
  });

  it('renders a status pill only when statusLabel is supplied', () => {
    const { rerender } = render(<ResourceCard {...baseProps()} />);
    expect(screen.queryByTestId('resource-status-pill')).not.toBeInTheDocument();
    rerender(<ResourceCard {...baseProps({ statusLabel: 'Running' })} />);
    expect(screen.getByTestId('resource-status-pill')).toHaveTextContent('Running');
  });

  it('omits the status pill for an item with no status even if a label is passed', () => {
    const item: ResourceBoardItem = { id: 'p1', title: 'No status' };
    render(<ResourceCard {...baseProps({ item, statusLabel: 'Running' })} />);
    expect(screen.queryByTestId('resource-status-pill')).not.toBeInTheDocument();
  });

  it('calls onOpen when clicked outside select mode', async () => {
    const onOpen = vi.fn();
    render(<ResourceCard {...baseProps({ onOpen })} />);
    await userEvent.click(screen.getByTestId('resource-board-card'));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('calls onOpen on Enter/Space keydown', async () => {
    const onOpen = vi.fn();
    render(<ResourceCard {...baseProps({ onOpen })} />);
    const card = screen.getByTestId('resource-board-card');
    card.focus();
    await userEvent.keyboard('{Enter}');
    expect(onOpen).toHaveBeenCalledTimes(1);
    await userEvent.keyboard(' ');
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it('does not call onOpen for an unrelated key', async () => {
    const onOpen = vi.fn();
    render(<ResourceCard {...baseProps({ onOpen })} />);
    screen.getByTestId('resource-board-card').focus();
    await userEvent.keyboard('a');
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('renders a checkbox and toggles selection instead of opening, in select mode', async () => {
    const onOpen = vi.fn();
    const onToggleSelected = vi.fn();
    render(<ResourceCard {...baseProps({ selectMode: true, onOpen, onToggleSelected })} />);
    expect(screen.getByTestId('resource-board-card-checkbox')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('resource-board-card'));
    expect(onToggleSelected).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('marks the checkbox checked when selected', () => {
    render(<ResourceCard {...baseProps({ selectMode: true, selected: true })} />);
    expect(screen.getByTestId('resource-board-card-checkbox')).toHaveClass('checked');
  });

  it('renders no kebab menu button when the item has no menuActions', () => {
    render(<ResourceCard {...baseProps()} />);
    expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument();
  });

  it('renders a kebab menu button when the item has menuActions and not in select mode', () => {
    const item: ResourceBoardItem = { id: 'p1', title: 'X', menuActions: [{ kind: 'rename', label: 'Rename' }] };
    render(<ResourceCard {...baseProps({ item })} />);
    expect(screen.getByRole('button', { name: 'More' })).toBeInTheDocument();
  });

  it('does not render the kebab menu button in select mode even with menuActions', () => {
    const item: ResourceBoardItem = { id: 'p1', title: 'X', menuActions: [{ kind: 'rename', label: 'Rename' }] };
    render(<ResourceCard {...baseProps({ item, selectMode: true })} />);
    expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument();
  });

  it('toggling the menu button calls onToggleMenu and stops propagation (does not also open)', async () => {
    const item: ResourceBoardItem = { id: 'p1', title: 'X', menuActions: [{ kind: 'rename', label: 'Rename' }] };
    const onOpen = vi.fn();
    const onToggleMenu = vi.fn();
    render(<ResourceCard {...baseProps({ item, onOpen, onToggleMenu })} />);
    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(onToggleMenu).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  /**
   * Regression: `onClick`'s `stopPropagation` only stops the synthetic
   * click a browser fires for an Enter/Space keydown on a focused button —
   * the raw keydown event is a SEPARATE event that still bubbles unless
   * stopped independently. Before this fix, pressing Enter/Space while the
   * "More" button (or a menu item) was focused also fired the outer card's
   * own `onKeyDown`, which treated the same keypress as "activate the
   * card" and opened/toggle-selected it at the same time.
   */
  it('activating the menu button via keyboard (Enter) does not also activate the card', async () => {
    const item: ResourceBoardItem = { id: 'p1', title: 'X', menuActions: [{ kind: 'rename', label: 'Rename' }] };
    const onOpen = vi.fn();
    const onToggleMenu = vi.fn();
    render(<ResourceCard {...baseProps({ item, onOpen, onToggleMenu })} />);
    screen.getByRole('button', { name: 'More' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(onToggleMenu).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('activating a menu item via keyboard (Enter) does not also activate the card', async () => {
    const item: ResourceBoardItem = { id: 'p1', title: 'X', menuActions: [{ kind: 'rename', label: 'Rename' }] };
    const onOpen = vi.fn();
    const onAction = vi.fn();
    render(<ResourceCard {...baseProps({ item, menuOpen: true, onOpen, onAction })} />);
    screen.getByRole('menuitem', { name: 'Rename' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(onAction).toHaveBeenCalledWith('rename');
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('renders menu items when menuOpen is true and dispatches onAction with the clicked kind', async () => {
    const item: ResourceBoardItem = {
      id: 'p1',
      title: 'X',
      menuActions: [
        { kind: 'rename', label: 'Rename' },
        { kind: 'delete', label: 'Delete', danger: true },
      ],
    };
    const onAction = vi.fn();
    render(<ResourceCard {...baseProps({ item, menuOpen: true, onAction })} />);
    const deleteItem = screen.getByRole('menuitem', { name: 'Delete' });
    expect(deleteItem).toHaveClass('danger');
    await userEvent.click(deleteItem);
    expect(onAction).toHaveBeenCalledWith('delete');
  });

  it('uses menuActionLabel to translate menu item labels when supplied', () => {
    const item: ResourceBoardItem = { id: 'p1', title: 'X', menuActions: [{ kind: 'rename', label: 'Rename' }] };
    render(<ResourceCard {...baseProps({ item, menuOpen: true, menuActionLabel: (_kind, fallback) => `t:${fallback}` })} />);
    expect(screen.getByRole('menuitem', { name: 't:Rename' })).toBeInTheDocument();
  });

  it('disables menu action buttons while busy', () => {
    const item: ResourceBoardItem = { id: 'p1', title: 'X', menuActions: [{ kind: 'rename', label: 'Rename' }] };
    render(<ResourceCard {...baseProps({ item, menuOpen: true, busy: true })} />);
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeDisabled();
  });

  it('clicking inside an open menu does not bubble up to the card (no open/select toggle)', async () => {
    const item: ResourceBoardItem = { id: 'p1', title: 'X', menuActions: [{ kind: 'rename', label: 'Rename' }] };
    const onOpen = vi.fn();
    render(<ResourceCard {...baseProps({ item, menuOpen: true, onOpen })} />);
    await userEvent.click(screen.getByRole('menu'));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('renders host-supplied body content via renderBody', () => {
    render(<ResourceCard {...baseProps({ renderBody: (item) => <span>body-for-{item.id}</span> })} />);
    expect(screen.getByText('body-for-p1')).toBeInTheDocument();
  });

  it('applies toneMap to the status pill', () => {
    render(<ResourceCard {...baseProps({ statusLabel: 'Running', toneMap: { running: 'success' } })} />);
    expect(screen.getByTestId('resource-status-pill')).toHaveClass('tone-success');
  });

  it('renders no kebab menu button for an empty menuActions list', () => {
    const item: ResourceBoardItem = { id: 'p1', title: 'X', menuActions: [] };
    render(<ResourceCard {...baseProps({ item })} />);
    expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument();
  });

  it('attaches menuContainerRef to the menu anchor only while the menu is open', () => {
    const item: ResourceBoardItem = { id: 'p1', title: 'X', menuActions: [{ kind: 'rename', label: 'Rename' }] };
    const menuContainerRef: React.RefObject<HTMLDivElement | null> = { current: null };
    const { rerender } = render(<ResourceCard {...baseProps({ item, menuContainerRef })} />);
    expect(menuContainerRef.current).toBeNull();
    rerender(<ResourceCard {...baseProps({ item, menuContainerRef, menuOpen: true })} />);
    expect(menuContainerRef.current).toHaveClass('resource-board-card-menu-anchor');
  });

  it('leaves a non-danger menu item without a class attribute', () => {
    const item: ResourceBoardItem = { id: 'p1', title: 'X', menuActions: [{ kind: 'rename', label: 'Rename' }] };
    render(<ResourceCard {...baseProps({ item, menuOpen: true })} />);
    expect(screen.getByRole('menuitem', { name: 'Rename' })).not.toHaveAttribute('class');
  });

  it('marks the card is-selected and select-mode via its class list', () => {
    render(<ResourceCard {...baseProps({ selectMode: true, selected: true })} />);
    expect(screen.getByTestId('resource-board-card')).toHaveClass('resource-board-card', 'is-selected', 'select-mode');
  });

  it('toggles selection on Space keydown in select mode', async () => {
    const onToggleSelected = vi.fn();
    const onOpen = vi.fn();
    render(<ResourceCard {...baseProps({ selectMode: true, onToggleSelected, onOpen })} />);
    screen.getByTestId('resource-board-card').focus();
    await userEvent.keyboard(' ');
    expect(onToggleSelected).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });
});
