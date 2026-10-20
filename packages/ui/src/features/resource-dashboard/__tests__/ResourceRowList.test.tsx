import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ResourceRowList } from '../react/components/ResourceRowList.js';
import { I18nProvider } from '../../i18n/index.js';
import type { ResourceRowListDependencies, ResourceRowListPort } from '../ports.js';
import type { ResourceRowItem, ResourceStatusOption } from '../types.js';

const STATUS_OPTIONS: ResourceStatusOption[] = [
  { value: 'succeeded', label: 'Succeeded' },
  { value: 'failed', label: 'Failed' },
  { value: 'running', label: 'Running' },
];

function seedRows(): ResourceRowItem[] {
  return [
    { id: 'r1', title: 'Nightly digest', lastRunStatus: 'succeeded', lastRunLabel: 'today', actions: [{ kind: 'run', label: 'Run' }, { kind: 'delete', label: 'Delete' }] },
  ];
}

function fakeDependencies(overrides: Partial<ResourceRowListPort<ResourceRowItem>> = {}): ResourceRowListDependencies<ResourceRowItem> {
  return {
    port: {
      fetchRows: vi.fn().mockResolvedValue(seedRows()),
      fetchRowHistory: vi.fn().mockResolvedValue([{ id: 'run-1', status: 'succeeded', startedAtLabel: 'today' }]),
      ...overrides,
    },
  };
}

describe('ResourceRowList', () => {
  it('loads and renders rows', async () => {
    render(<ResourceRowList dependencies={fakeDependencies()} title="Automations" statusOptions={STATUS_OPTIONS} onRowAction={() => {}} />);
    await waitFor(() => expect(screen.getByText('Nightly digest')).toBeInTheDocument());
  });

  it('renders the translated last-run status label', async () => {
    render(<ResourceRowList dependencies={fakeDependencies()} title="Automations" statusOptions={STATUS_OPTIONS} onRowAction={() => {}} />);
    await waitFor(() => expect(screen.getByText('Succeeded')).toBeInTheDocument());
  });

  it('dispatches onRowAction and reloads the list after it resolves', async () => {
    const fetchRows = vi.fn().mockResolvedValueOnce(seedRows()).mockResolvedValueOnce([]);
    const dependencies = fakeDependencies({ fetchRows });
    const onRowAction = vi.fn().mockResolvedValue(undefined);
    render(<ResourceRowList dependencies={dependencies} title="Automations" statusOptions={STATUS_OPTIONS} onRowAction={onRowAction} />);
    await waitFor(() => expect(screen.getByText('Nightly digest')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(onRowAction).toHaveBeenCalledWith('r1', 'run');
    await waitFor(() => expect(screen.queryByText('Nightly digest')).not.toBeInTheDocument());
  });

  it('expands a row and shows its translated run-history status', async () => {
    render(<ResourceRowList dependencies={fakeDependencies()} title="Automations" statusOptions={STATUS_OPTIONS} onRowAction={() => {}} />);
    await waitFor(() => expect(screen.getByText('Nightly digest')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'History' }));
    await waitFor(() => expect(screen.getByTestId('resource-row-history')).toBeInTheDocument());
    expect(screen.getAllByText('Succeeded')).toHaveLength(2); // row's own last-run pill + the history row's pill
  });

  it('omits the history toggle entirely when the port has no fetchRowHistory', async () => {
    const dependencies = fakeDependencies();
    delete dependencies.port.fetchRowHistory;
    render(<ResourceRowList dependencies={dependencies} title="Automations" statusOptions={STATUS_OPTIONS} onRowAction={() => {}} />);
    await waitFor(() => expect(screen.getByText('Nightly digest')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'History' })).not.toBeInTheDocument();
  });

  it('bubbles onHistoryItemAction with the row id, history item id, and action kind', async () => {
    const dependencies = fakeDependencies({
      fetchRowHistory: vi.fn().mockResolvedValue([{ id: 'run-1', status: 'succeeded', startedAtLabel: 'today', actions: [{ kind: 'open', label: 'Open' }] }]),
    });
    const onHistoryItemAction = vi.fn();
    render(
      <ResourceRowList dependencies={dependencies} title="Automations" statusOptions={STATUS_OPTIONS} onRowAction={() => {}} onHistoryItemAction={onHistoryItemAction} />,
    );
    await waitFor(() => expect(screen.getByText('Nightly digest')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'History' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open' })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(onHistoryItemAction).toHaveBeenCalledWith('r1', 'run-1', 'open');
  });

  it('renders metrics when given', async () => {
    render(
      <ResourceRowList
        dependencies={fakeDependencies()}
        title="Automations"
        statusOptions={STATUS_OPTIONS}
        onRowAction={() => {}}
        metrics={[{ key: 'active', label: 'Active', value: 3 }]}
      />,
    );
    await waitFor(() => expect(screen.getByLabelText('Summary')).toHaveTextContent('3'));
  });

  it('renders and wires the create CTA with a default label when onCreate is given without an override', async () => {
    const onCreate = vi.fn();
    const dependencies = fakeDependencies({ fetchRows: vi.fn().mockResolvedValue([]) });
    render(<ResourceRowList dependencies={dependencies} title="Automations" statusOptions={STATUS_OPTIONS} onRowAction={() => {}} onCreate={onCreate} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'New' })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'New' }));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it('honors a custom createLabel override', async () => {
    const dependencies = fakeDependencies({ fetchRows: vi.fn().mockResolvedValue([]) });
    render(
      <ResourceRowList dependencies={dependencies} title="Automations" statusOptions={STATUS_OPTIONS} onRowAction={() => {}} onCreate={() => {}} createLabel="New automation" />,
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'New automation' })).toBeInTheDocument());
  });

  it('renders no create CTA when only createLabel is given without onCreate', async () => {
    const dependencies = fakeDependencies({ fetchRows: vi.fn().mockResolvedValue([]) });
    render(<ResourceRowList dependencies={dependencies} title="Automations" statusOptions={STATUS_OPTIONS} onRowAction={() => {}} createLabel="New automation" />);
    await waitFor(() => expect(screen.getByText('Nothing here yet')).toBeInTheDocument());
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('surfaces a translated load-failure error', async () => {
    const dependencies = fakeDependencies({ fetchRows: vi.fn().mockRejectedValue(new Error('down')) });
    render(<ResourceRowList dependencies={dependencies} title="Automations" statusOptions={STATUS_OPTIONS} onRowAction={() => {}} />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Failed to load items.'));
  });

  /**
   * Regression, end-to-end through the real orchestrator: before this fix,
   * `onRowAction`'s `void list.dispatchRowAction(...)` call discarded a
   * rejection with no handler at all — an unhandled rejection AND no
   * visible feedback. The row must stay on screen (this isn't a load
   * failure) while a translated, visible action-error banner appears.
   */
  it('surfaces a translated, visible error (without hiding the row list) when onRowAction rejects', async () => {
    const dependencies = fakeDependencies();
    const onRowAction = vi.fn().mockRejectedValue(new Error('run failed'));
    render(<ResourceRowList dependencies={dependencies} title="Automations" statusOptions={STATUS_OPTIONS} onRowAction={onRowAction} />);
    await waitFor(() => expect(screen.getByText('Nightly digest')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() => expect(screen.getByText('Failed to complete action.')).toBeInTheDocument());
    // The row is still there — the action failed, so nothing was reloaded away.
    expect(screen.getByText('Nightly digest')).toBeInTheDocument();
  });

  it('re-fetches when refreshToken changes', async () => {
    const dependencies = fakeDependencies();
    const fetchSpy = dependencies.port.fetchRows as ReturnType<typeof vi.fn>;
    const { rerender } = render(
      <ResourceRowList dependencies={dependencies} title="Automations" statusOptions={STATUS_OPTIONS} onRowAction={() => {}} refreshToken={1} />,
    );
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    rerender(<ResourceRowList dependencies={dependencies} title="Automations" statusOptions={STATUS_OPTIONS} onRowAction={() => {}} refreshToken={2} />);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
  });

  it('renders eyebrow and lede when given', async () => {
    render(
      <ResourceRowList
        dependencies={fakeDependencies()}
        title="Automations"
        eyebrow="Automations"
        lede="Manage your scheduled runs."
        statusOptions={STATUS_OPTIONS}
        onRowAction={() => {}}
      />,
    );
    await waitFor(() => expect(screen.getByText('Manage your scheduled runs.')).toBeInTheDocument());
  });

  it('applies a given toneMap to the row status pill', async () => {
    const dependencies = fakeDependencies({
      fetchRows: vi.fn().mockResolvedValue([{ id: 'r1', title: 'Nightly digest', lastRunStatus: 'failed', actions: [] }]),
    });
    render(<ResourceRowList dependencies={dependencies} title="Automations" statusOptions={STATUS_OPTIONS} onRowAction={() => {}} toneMap={{ failed: 'error' }} />);
    await waitFor(() => expect(screen.getByTestId('resource-status-pill')).toHaveClass('tone-error'));
  });

  it('falls back to the raw status value as the label key for a status not in statusOptions', async () => {
    const dependencies = fakeDependencies({
      fetchRows: vi.fn().mockResolvedValue([{ id: 'r1', title: 'Nightly digest', lastRunStatus: 'mystery', actions: [] }]),
    });
    render(<ResourceRowList dependencies={dependencies} title="Automations" statusOptions={STATUS_OPTIONS} onRowAction={() => {}} />);
    await waitFor(() => expect(screen.getByText('mystery')).toBeInTheDocument());
  });

  it('renders translated copy end-to-end under I18nProvider with a real dictionary', async () => {
    const dependencies = fakeDependencies({ fetchRows: vi.fn().mockResolvedValue([]) });
    render(
      <I18nProvider dictionaries={{ en: { 'Nothing here yet': 'Rien pour le moment', New: 'Nouveau' } }} initialLocale="en">
        <ResourceRowList dependencies={dependencies} title="Automations" statusOptions={STATUS_OPTIONS} onRowAction={() => {}} onCreate={() => {}} />
      </I18nProvider>,
    );
    await waitFor(() => expect(screen.getByText('Rien pour le moment')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Nouveau' })).toBeInTheDocument();
  });

  it('translates the load-failure message through the I18nProvider dictionary', async () => {
    const dependencies = fakeDependencies({ fetchRows: vi.fn().mockRejectedValue(new Error('down')) });
    render(
      <I18nProvider dictionaries={{ en: { 'Failed to load items.': 'Echec du chargement.' } }} initialLocale="en">
        <ResourceRowList dependencies={dependencies} title="Automations" statusOptions={STATUS_OPTIONS} onRowAction={() => {}} />
      </I18nProvider>,
    );
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Echec du chargement.'));
  });

  it('translates the row-action failure message through the I18nProvider dictionary', async () => {
    const onRowAction = vi.fn().mockRejectedValue(new Error('run failed'));
    render(
      <I18nProvider dictionaries={{ en: { 'Failed to complete action.': "Echec de l'action." } }} initialLocale="en">
        <ResourceRowList dependencies={fakeDependencies()} title="Automations" statusOptions={STATUS_OPTIONS} onRowAction={onRowAction} />
      </I18nProvider>,
    );
    await waitFor(() => expect(screen.getByText('Nightly digest')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent("Echec de l'action."));
  });
});
