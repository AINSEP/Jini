import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../i18n/index.js';
import type { TabStripTab } from '../../../types.js';
import type { TabStripItemDragProps } from '../../../react/hooks/useTabStripDragReorder.js';
import { TabStripItem } from '../../../react/components/TabStripItem.js';

function tab(overrides: Partial<TabStripTab> & { id: string }): TabStripTab {
  return { content: overrides.id, ...overrides };
}

function dragProps(overrides: Partial<TabStripItemDragProps> = {}): TabStripItemDragProps {
  return {
    draggable: true,
    onDragStart: vi.fn(),
    onDragEnd: vi.fn(),
    onClickCapture: vi.fn(),
    ...overrides,
  };
}

describe('TabStripItem', () => {
  it('renders host-injected content', () => {
    render(
      <TabStripItem
        tab={tab({ id: 'a', content: <span>My Tab</span> })}
        active={false}
        dragging={false}
        dragOverEdge={null}
        dragProps={dragProps()}
        onActivate={() => {}}
      />,
    );
    expect(screen.getByText('My Tab')).toBeTruthy();
  });

  it('marks the active tab via aria-selected', () => {
    render(
      <TabStripItem
        tab={tab({ id: 'a' })}
        active
        dragging={false}
        dragOverEdge={null}
        dragProps={dragProps()}
        onActivate={() => {}}
      />,
    );
    expect(screen.getByRole('tab')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab').className).toContain('is-active');
  });

  it('applies pinned/dragging/drag-over-edge modifier classes', () => {
    render(
      <TabStripItem
        tab={tab({ id: 'a', pinned: true })}
        active={false}
        dragging
        dragOverEdge="before"
        dragProps={dragProps()}
        onActivate={() => {}}
      />,
    );
    const el = screen.getByRole('tab');
    expect(el.className).toContain('is-pinned');
    expect(el.className).toContain('is-dragging');
    expect(el.className).toContain('is-drag-over-before');
  });

  it('calls onActivate on click', async () => {
    const onActivate = vi.fn();
    render(
      <TabStripItem
        tab={tab({ id: 'a' })}
        active={false}
        dragging={false}
        dragOverEdge={null}
        dragProps={dragProps()}
        onActivate={onActivate}
      />,
    );
    await userEvent.click(screen.getByRole('tab'));
    expect(onActivate).toHaveBeenCalledWith('a');
  });

  it('does not activate when the drag-suppress-click handler prevents the click', async () => {
    const onActivate = vi.fn();
    const onClickCapture = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    render(
      <TabStripItem
        tab={tab({ id: 'a' })}
        active={false}
        dragging={false}
        dragOverEdge={null}
        dragProps={dragProps({ onClickCapture })}
        onActivate={onActivate}
      />,
    );
    await userEvent.click(screen.getByRole('tab'));
    expect(onClickCapture).toHaveBeenCalled();
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('activates on Enter and Space keydown', async () => {
    const onActivate = vi.fn();
    render(
      <TabStripItem
        tab={tab({ id: 'a' })}
        active={false}
        dragging={false}
        dragOverEdge={null}
        dragProps={dragProps()}
        onActivate={onActivate}
      />,
    );
    const el = screen.getByRole('tab');
    el.focus();
    await userEvent.keyboard('{Enter}');
    expect(onActivate).toHaveBeenCalledWith('a');
    onActivate.mockClear();
    await userEvent.keyboard(' ');
    expect(onActivate).toHaveBeenCalledWith('a');
  });

  it('ignores unrelated keys', async () => {
    const onActivate = vi.fn();
    render(
      <TabStripItem
        tab={tab({ id: 'a' })}
        active={false}
        dragging={false}
        dragOverEdge={null}
        dragProps={dragProps()}
        onActivate={onActivate}
      />,
    );
    screen.getByRole('tab').focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('reflects draggable from dragProps', () => {
    render(
      <TabStripItem
        tab={tab({ id: 'a' })}
        active={false}
        dragging={false}
        dragOverEdge={null}
        dragProps={dragProps({ draggable: false })}
        onActivate={() => {}}
      />,
    );
    expect(screen.getByRole('tab')).toHaveAttribute('draggable', 'false');
  });

  it('renders a close button by default when onClose is supplied and calls it without activating', async () => {
    const onActivate = vi.fn();
    const onClose = vi.fn();
    render(
      <TabStripItem
        tab={tab({ id: 'a' })}
        active={false}
        dragging={false}
        dragOverEdge={null}
        dragProps={dragProps()}
        onActivate={onActivate}
        onClose={onClose}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Close tab' }));
    expect(onClose).toHaveBeenCalledWith('a');
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('omits the close button when there is no onClose handler', () => {
    render(
      <TabStripItem
        tab={tab({ id: 'a' })}
        active={false}
        dragging={false}
        dragOverEdge={null}
        dragProps={dragProps()}
        onActivate={() => {}}
      />,
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('omits the close button when the tab sets closable: false', () => {
    render(
      <TabStripItem
        tab={tab({ id: 'a', closable: false })}
        active={false}
        dragging={false}
        dragOverEdge={null}
        dragProps={dragProps()}
        onActivate={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('omits the close button for a pinned tab even when closable: true', () => {
    render(
      <TabStripItem
        tab={tab({ id: 'a', pinned: true, closable: true })}
        active={false}
        dragging={false}
        dragOverEdge={null}
        dragProps={dragProps()}
        onActivate={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('honors a custom close label and icon', () => {
    render(
      <TabStripItem
        tab={tab({ id: 'a' })}
        active={false}
        dragging={false}
        dragOverEdge={null}
        dragProps={dragProps()}
        onActivate={() => {}}
        onClose={() => {}}
        closeLabel="Dismiss"
        closeIcon={<span data-testid="custom-icon" />}
      />,
    );
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeTruthy();
    expect(screen.getByTestId('custom-icon')).toBeTruthy();
  });

  it('renders the native title attribute from tab.title', () => {
    render(
      <TabStripItem
        tab={tab({ id: 'a', title: 'Full title text' })}
        active={false}
        dragging={false}
        dragOverEdge={null}
        dragProps={dragProps()}
        onActivate={() => {}}
      />,
    );
    expect(screen.getByRole('tab')).toHaveAttribute('title', 'Full title text');
  });

  it('translates the default close label under an I18nProvider', async () => {
    render(
      <I18nProvider dictionaries={{ fr: { 'Close tab': 'Fermer l’onglet' } }} initialLocale="fr">
        <TabStripItem
          tab={tab({ id: 'a' })}
          active={false}
          dragging={false}
          dragOverEdge={null}
          dragProps={dragProps()}
          onActivate={() => {}}
          onClose={() => {}}
        />
      </I18nProvider>,
    );
    expect(screen.getByRole('button', { name: 'Fermer l’onglet' })).toBeTruthy();
  });
});


describe('TabStripItem agent handles', () => {
  it('tags the tab and close action independently and respects opt-out', () => {
    const props = { tab: tab({ id: 'one' }), active: false, dragging: false, dragOverEdge: null,
      dragProps: dragProps(), onActivate: vi.fn(), onClose: vi.fn() };
    const { rerender } = render(<TabStripItem {...props} />);
    const first = screen.getByRole('tab').getAttribute('data-agent-element');
    expect(first).toMatch(/^ui-/);
    expect(screen.getByRole('button')).toHaveAttribute('data-agent-element', `${first}-close`);
    rerender(<TabStripItem {...props} agentHandle="my-tab" />);
    expect(screen.getByRole('tab')).toHaveAttribute('data-agent-element', 'my-tab');
    expect(screen.getByRole('button')).toHaveAttribute('data-agent-element', 'my-tab-close');
    rerender(<TabStripItem {...props} agentHandle={false} />);
    expect(screen.getByRole('tab')).not.toHaveAttribute('data-agent-element');
    expect(screen.getByRole('button')).not.toHaveAttribute('data-agent-element');
  });
});
