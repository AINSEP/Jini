import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ResourceRowListView, type ResourceRowListViewProps } from '../react/components/ResourceRowListView.js';
import type { ResourceRowItem } from '../types.js';

const ROW_A: ResourceRowItem = { id: 'a', title: 'Nightly digest', actions: [{ kind: 'run', label: 'Run' }] };
const ROW_B: ResourceRowItem = { id: 'b', title: 'Weekly report', actions: [] };

function baseProps(overrides: Partial<ResourceRowListViewProps> = {}): ResourceRowListViewProps {
  return {
    title: 'Automations',
    metrics: [],
    metricsAriaLabel: 'Summary',
    loading: false,
    error: null,
    sectionLabel: 'Your automations',
    loadingLabel: 'Loading…',
    emptyTitle: 'No automations yet',
    emptyBody: 'Create one to get started.',
    rows: [ROW_A, ROW_B],
    isRowBusy: () => false,
    statusLabel: (status) => `Status: ${status}`,
    canExpandHistory: true,
    expandedRowId: null,
    historyLoadingRowId: null,
    historyByRowId: {},
    showHistoryLabel: 'History',
    hideHistoryLabel: 'Hide history',
    historyTitleLabel: 'Run history',
    historyLoadingLabel: 'Loading…',
    historyEmptyLabel: 'No runs.',
    onToggleExpand: vi.fn(),
    onRowAction: vi.fn(),
    ...overrides,
  };
}

describe('ResourceRowListView', () => {
  it('renders eyebrow/title/lede when given', () => {
    render(<ResourceRowListView {...baseProps({ eyebrow: 'Automations', title: 'Your automations', lede: 'Manage scheduled runs.' })} />);
    expect(screen.getByText('Automations')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Your automations' })).toBeInTheDocument();
    expect(screen.getByText('Manage scheduled runs.')).toBeInTheDocument();
  });

  it('omits eyebrow and lede when absent', () => {
    render(<ResourceRowListView {...baseProps()} />);
    expect(screen.queryByText('Manage scheduled runs.')).not.toBeInTheDocument();
  });

  it('renders metric tiles', () => {
    render(<ResourceRowListView {...baseProps({ metrics: [{ key: 'active', label: 'Active', value: 4 }] })} />);
    expect(screen.getByLabelText('Summary')).toHaveTextContent('4');
  });

  it('renders and wires the create CTA only when both onCreate and createLabel are given', async () => {
    const onCreate = vi.fn();
    const { rerender } = render(<ResourceRowListView {...baseProps()} />);
    expect(screen.queryByRole('button', { name: 'New automation' })).not.toBeInTheDocument();
    rerender(<ResourceRowListView {...baseProps({ onCreate, createLabel: 'New automation' })} />);
    await userEvent.click(screen.getByRole('button', { name: 'New automation' }));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it('renders an error banner with errorLabel when given, else the raw error', () => {
    const { rerender } = render(<ResourceRowListView {...baseProps({ error: 'raw', errorLabel: 'Translated' })} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Translated');
    rerender(<ResourceRowListView {...baseProps({ error: 'raw only' })} />);
    expect(screen.getByRole('alert')).toHaveTextContent('raw only');
  });

  it('renders an actionError banner ALONGSIDE the row list (not replacing it), using actionErrorLabel when given', () => {
    render(<ResourceRowListView {...baseProps({ actionError: 'raw', actionErrorLabel: 'Translated action error' })} />);
    expect(screen.getByText('Translated action error')).toBeInTheDocument();
    // Unlike a LOAD error, the already-loaded rows must stay visible.
    expect(screen.getByText('Nightly digest')).toBeInTheDocument();
  });

  it('falls back to the raw actionError string when actionErrorLabel is omitted', () => {
    render(<ResourceRowListView {...baseProps({ actionError: 'raw action error' })} />);
    expect(screen.getAllByRole('alert').map((el) => el.textContent)).toContain('raw action error');
  });

  it('renders no actionError banner when actionError is null', () => {
    render(<ResourceRowListView {...baseProps({ actionError: null })} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the loading label in the section head while loading', () => {
    render(<ResourceRowListView {...baseProps({ loading: true, rows: [] })} />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('renders a clickable empty state that calls onCreate when rows is empty and onCreate is given', async () => {
    const onCreate = vi.fn();
    render(<ResourceRowListView {...baseProps({ rows: [], onCreate })} />);
    await userEvent.click(screen.getByRole('button', { name: /No automations yet/ }));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it('renders a non-interactive empty state when rows is empty and onCreate is omitted', () => {
    render(<ResourceRowListView {...baseProps({ rows: [] })} />);
    expect(screen.getByText('No automations yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /No automations yet/ })).not.toBeInTheDocument();
  });

  it('does not show the empty state while loading, even with zero rows', () => {
    render(<ResourceRowListView {...baseProps({ rows: [], loading: true })} />);
    expect(screen.queryByText('No automations yet')).not.toBeInTheDocument();
  });

  it('renders one ResourceRowListItem per row', () => {
    render(<ResourceRowListView {...baseProps()} />);
    expect(screen.getAllByTestId('resource-row-list-item')).toHaveLength(2);
    expect(screen.getByText('Nightly digest')).toBeInTheDocument();
    expect(screen.getByText('Weekly report')).toBeInTheDocument();
  });

  it('wires isRowBusy per row', () => {
    render(<ResourceRowListView {...baseProps({ isRowBusy: (id) => id === 'a' })} />);
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled();
  });

  it('wires onRowAction with the acted-on row id', async () => {
    const onRowAction = vi.fn();
    render(<ResourceRowListView {...baseProps({ onRowAction })} />);
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(onRowAction).toHaveBeenCalledWith('a', 'run');
  });

  it('wires onToggleExpand with the row id and reflects expandedRowId', () => {
    const onToggleExpand = vi.fn();
    render(<ResourceRowListView {...baseProps({ onToggleExpand, expandedRowId: 'a', historyByRowId: { a: [] } })} />);
    const items = screen.getAllByTestId('resource-row-list-item');
    expect(items[0]).toHaveTextContent('Hide history');
    expect(items[1]).toHaveTextContent('History');
  });

  it('wires onHistoryItemAction through with the row id prepended', async () => {
    const onHistoryItemAction = vi.fn();
    render(
      <ResourceRowListView
        {...baseProps({
          expandedRowId: 'a',
          historyByRowId: { a: [{ id: 'run-1', status: 'succeeded', startedAtLabel: 'today', actions: [{ kind: 'open', label: 'Open' }] }] },
          onHistoryItemAction,
        })}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(onHistoryItemAction).toHaveBeenCalledWith('a', 'run-1', 'open');
  });

  it('passes toneMap through to each row item', () => {
    render(<ResourceRowListView {...baseProps({ rows: [{ ...ROW_A, lastRunStatus: 'failed' }], toneMap: { failed: 'error' } })} />);
    expect(screen.getByTestId('resource-status-pill')).toHaveClass('tone-error');
  });

  it('renders nothing in the list section when rows is empty but loading is true', () => {
    render(<ResourceRowListView {...baseProps({ rows: [], loading: true })} />);
    expect(screen.queryByTestId('resource-row-list-item')).not.toBeInTheDocument();
  });

  it('calls onToggleExpand with the clicked row id when a history toggle is clicked', async () => {
    const onToggleExpand = vi.fn();
    render(<ResourceRowListView {...baseProps({ onToggleExpand })} />);
    await userEvent.click(screen.getAllByRole('button', { name: 'History' })[1]!);
    expect(onToggleExpand).toHaveBeenCalledWith('b');
  });

  it('marks only the historyLoadingRowId row as loading its history', () => {
    render(<ResourceRowListView {...baseProps({ expandedRowId: 'a', historyLoadingRowId: 'a', historyLoadingLabel: 'Fetching runs' })} />);
    const items = screen.getAllByTestId('resource-row-list-item');
    expect(items[0]).toHaveTextContent('Fetching runs');
    expect(items[1]).not.toHaveTextContent('Fetching runs');
  });
});
