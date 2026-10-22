import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ResourceRowListItem, type ResourceRowListItemProps } from '../react/components/ResourceRowListItem.js';
import type { ResourceRowItem } from '../types.js';

const ROW: ResourceRowItem = {
  id: 'r1',
  title: 'Nightly digest',
  metaLine: 'Every day at 9am · Project X',
  detailLine: 'Summarize activity from the last 24 hours.',
  lastRunStatus: 'succeeded',
  lastRunLabel: 'Last run 2 hours ago',
  actions: [
    { kind: 'run', label: 'Run' },
    { kind: 'delete', label: 'Delete', danger: true },
  ],
};

function baseProps(overrides: Partial<ResourceRowListItemProps> = {}): ResourceRowListItemProps {
  return {
    row: ROW,
    busy: false,
    statusLabel: (status) => `Status: ${status}`,
    canExpandHistory: true,
    expanded: false,
    showHistoryLabel: 'History',
    hideHistoryLabel: 'Hide history',
    historyItems: undefined,
    historyLoading: false,
    historyTitleLabel: 'Run history',
    historyLoadingLabel: 'Loading…',
    historyEmptyLabel: 'No runs.',
    onToggleExpand: vi.fn(),
    onAction: vi.fn(),
    ...overrides,
  };
}

describe('ResourceRowListItem', () => {
  it('renders title, meta, and detail lines', () => {
    render(<ResourceRowListItem {...baseProps()} />);
    expect(screen.getByText('Nightly digest')).toBeInTheDocument();
    expect(screen.getByText('Every day at 9am · Project X')).toBeInTheDocument();
    expect(screen.getByText('Summarize activity from the last 24 hours.')).toBeInTheDocument();
  });

  it('renders the last-run status pill and label only when lastRunStatus is set', () => {
    const { rerender } = render(<ResourceRowListItem {...baseProps()} />);
    expect(screen.getByText('Status: succeeded')).toBeInTheDocument();
    expect(screen.getByText('Last run 2 hours ago')).toBeInTheDocument();
    const { lastRunStatus: _lastRunStatus, lastRunLabel: _lastRunLabel, ...rowWithoutLastRun } = ROW;
    rerender(<ResourceRowListItem {...baseProps({ row: rowWithoutLastRun })} />);
    expect(screen.queryByTestId('resource-status-pill')).not.toBeInTheDocument();
  });

  it('renders one button per action and dispatches its kind', async () => {
    const onAction = vi.fn();
    render(<ResourceRowListItem {...baseProps({ onAction })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(onAction).toHaveBeenCalledWith('run');
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass('danger');
  });

  it('disables every action button while busy', () => {
    render(<ResourceRowListItem {...baseProps({ busy: true })} />);
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
  });

  it('disables an individually-disabled action even when not busy', () => {
    const row: ResourceRowItem = { ...ROW, actions: [{ kind: 'run', label: 'Run', disabled: true }] };
    render(<ResourceRowListItem {...baseProps({ row })} />);
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled();
  });

  it('renders the history toggle only when canExpandHistory is true', () => {
    const { rerender } = render(<ResourceRowListItem {...baseProps({ canExpandHistory: false })} />);
    expect(screen.queryByRole('button', { name: 'History' })).not.toBeInTheDocument();
    rerender(<ResourceRowListItem {...baseProps({ canExpandHistory: true })} />);
    expect(screen.getByRole('button', { name: 'History' })).toBeInTheDocument();
  });

  it('shows "History"/"Hide history" depending on expanded, and calls onToggleExpand', async () => {
    const onToggleExpand = vi.fn();
    const { rerender } = render(<ResourceRowListItem {...baseProps({ onToggleExpand })} />);
    const toggle = screen.getByRole('button', { name: 'History' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    expect(onToggleExpand).toHaveBeenCalledTimes(1);
    rerender(<ResourceRowListItem {...baseProps({ expanded: true })} />);
    expect(screen.getByRole('button', { name: 'Hide history' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('renders the run-history sublist only when expanded', () => {
    const { rerender } = render(<ResourceRowListItem {...baseProps({ expanded: false })} />);
    expect(screen.queryByTestId('resource-row-history')).not.toBeInTheDocument();
    rerender(<ResourceRowListItem {...baseProps({ expanded: true, historyItems: [] })} />);
    expect(screen.getByTestId('resource-row-history')).toBeInTheDocument();
  });

  it('passes onHistoryItemAction through to the history sublist', async () => {
    const onHistoryItemAction = vi.fn();
    const historyItems = [{ id: 'run-1', status: 'succeeded', startedAtLabel: 'today', actions: [{ kind: 'open', label: 'Open' }] }];
    render(<ResourceRowListItem {...baseProps({ expanded: true, historyItems, onHistoryItemAction })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(onHistoryItemAction).toHaveBeenCalledWith('run-1', 'open');
  });

  it('applies toneMap to both the last-run pill and the expanded history sublist pill', () => {
    const historyItems = [{ id: 'run-1', status: 'failed', startedAtLabel: 'today' }];
    render(
      <ResourceRowListItem
        {...baseProps({ row: { ...ROW, lastRunStatus: 'failed' }, expanded: true, historyItems, toneMap: { failed: 'error' } })}
      />,
    );
    for (const pill of screen.getAllByTestId('resource-status-pill')) {
      expect(pill).toHaveClass('tone-error');
    }
  });

  it('applies the is-paused class when row.paused is true', () => {
    render(<ResourceRowListItem {...baseProps({ row: { ...ROW, paused: true } })} />);
    expect(screen.getByTestId('resource-row-list-item')).toHaveClass('is-paused');
  });

  it('omits the meta and detail lines when the row has neither', () => {
    const { metaLine: _metaLine, detailLine: _detailLine, ...bareRow } = ROW;
    const { container } = render(<ResourceRowListItem {...baseProps({ row: bareRow })} />);
    expect(container.querySelector('.resource-row-list-item-meta')).toBeNull();
    expect(container.querySelector('.resource-row-list-item-detail')).toBeNull();
  });

  it('renders the last-run pill without a label span when lastRunLabel is missing', () => {
    const { lastRunLabel: _lastRunLabel, ...rowWithoutLabel } = ROW;
    const { container } = render(<ResourceRowListItem {...baseProps({ row: rowWithoutLabel })} />);
    const lastRun = container.querySelector('.resource-row-list-item-last-run');
    expect(lastRun?.children).toHaveLength(1);
    expect(screen.getByText('Status: succeeded')).toBeInTheDocument();
  });

  it('leaves a non-danger action button without a class attribute', () => {
    render(<ResourceRowListItem {...baseProps()} />);
    expect(screen.getByRole('button', { name: 'Run' })).not.toHaveAttribute('class');
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass('danger');
  });
});
