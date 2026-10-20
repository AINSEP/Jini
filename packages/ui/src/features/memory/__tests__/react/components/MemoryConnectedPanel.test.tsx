// The connected-apps panel is a large presentational surface over the
// connectors hook: the source picker workbench, the scan run bar, the
// suggestion review list, the status/error banners, the last-scan
// diagnostics, and the recent-scans history. These drive every branch —
// connector connect/checking/pending/error states, the suggestion toggle and
// save/discard actions, and the scan-history cap.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../i18n/index.js';
import { MemoryConnectedPanel } from '../../../react/components/MemoryConnectedPanel.js';
import type { Connector } from '../../../../connectors/types.js';
import type {
  ConnectorMemoryAttempt,
  MemoryExtractionRecord,
  MemorySuggestion,
} from '../../../types.js';

function connectedConnector(id: string, over: Partial<Connector> = {}): Connector {
  return {
    id,
    name: id,
    provider: 'connector-catalog',
    category: 'Memory source',
    status: 'connected',
    tools: [],
    ...over,
  };
}

function suggestion(id: string, over: Partial<MemorySuggestion> = {}): MemorySuggestion {
  return {
    id,
    name: `name-${id}`,
    description: `desc-${id}`,
    type: 'project',
    body: `body-${id}`,
    ...over,
  };
}

function renderPanel(props: Partial<Parameters<typeof MemoryConnectedPanel>[0]> = {}) {
  const cbs = {
    onOpenConnectors: vi.fn(),
    toggleConnectorSelection: vi.fn(),
    onConnectMemoryConnector: vi.fn(),
    toggleConnectorSuggestion: vi.fn(),
    onSuggestConnectorMemory: vi.fn(),
    onSaveConnectorSuggestions: vi.fn(),
    onDiscardConnectorSuggestions: vi.fn(),
    onOpenPreview: vi.fn(),
    onDeleteExtraction: vi.fn(),
  };
  const utils = render(
    <MemoryConnectedPanel
      enabled
      connectorStatuses={{}}
      connectorsLoading={false}
      connectedCount={0}
      selectedConnectorIds={new Set()}
      selectedConnectedConnectorIds={[]}
      connectingConnectorIds={new Set()}
      pendingConnectorAuthIds={new Set()}
      connectorConnectErrors={{}}
      connectorIdsWithDetails={new Set()}
      connectorExtracting={false}
      connectorSaving={false}
      connectorScanLabel="Scan selected apps"
      connectorSuggestions={[suggestion('s1')]}
      selectedSuggestionIds={new Set()}
      selectedConnectorSuggestions={[]}
      connectorStatus={null}
      connectorError={null}
      connectorLoadError={null}
      connectorAttempts={[]}
      connectorContextBytes={0}
      connectorExtractions={[]}
      memoryConnectors={[]}
      nowClock={0}
      {...cbs}
      {...props}
    />,
  );
  return { ...utils, ...cbs };
}

describe('MemoryConnectedPanel', () => {
  it('renders a suggestion row and toggles it on checkbox change', async () => {
    const { toggleConnectorSuggestion } = renderPanel();
    expect(screen.getByText('name-s1')).toBeInTheDocument();
    const checkbox = screen.getAllByRole('checkbox').find((c) => (c as HTMLInputElement).closest('.memory-suggestion-card'))!;
    await userEvent.click(checkbox);
    expect(toggleConnectorSuggestion).toHaveBeenCalledWith('s1');
  });

  it('wires the Manage entry point when a handler is provided', async () => {
    const { onOpenConnectors } = renderPanel();
    await userEvent.click(screen.getByRole('button', { name: 'Manage' }));
    expect(onOpenConnectors).toHaveBeenCalled();
  });

  it('disables the Manage button when no handler is provided', () => {
    render(
      <MemoryConnectedPanel
        enabled
        connectorStatuses={{}}
        connectorsLoading={false}
        connectedCount={0}
        selectedConnectorIds={new Set()}
        selectedConnectedConnectorIds={[]}
        connectingConnectorIds={new Set()}
        pendingConnectorAuthIds={new Set()}
        connectorConnectErrors={{}}
        connectorIdsWithDetails={new Set()}
        connectorExtracting={false}
        connectorSaving={false}
        connectorScanLabel="Scan selected apps"
        connectorSuggestions={[]}
        selectedSuggestionIds={new Set()}
        selectedConnectorSuggestions={[]}
        connectorStatus={null}
        connectorError={null}
        connectorLoadError={null}
        connectorAttempts={[]}
        connectorContextBytes={0}
        connectorExtractions={[]}
        memoryConnectors={[]}
        nowClock={0}
        toggleConnectorSelection={vi.fn()}
        onConnectMemoryConnector={vi.fn()}
        toggleConnectorSuggestion={vi.fn()}
        onSuggestConnectorMemory={vi.fn()}
        onSaveConnectorSuggestions={vi.fn()}
        onDiscardConnectorSuggestions={vi.fn()}
        onOpenPreview={vi.fn()}
        onDeleteExtraction={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Manage' })).toBeDisabled();
  });

  it('falls back to "Connected apps" as the suggestion source label', () => {
    renderPanel({ connectorSuggestions: [suggestion('s1', { source: undefined })] });
    expect(screen.getByText('Connected apps')).toBeInTheDocument();
  });

  it('falls back to the tool title when the source has no connector name', () => {
    renderPanel({ connectorSuggestions: [suggestion('s1', { source: { toolTitle: 'Notion Search' } })] });
    expect(screen.getByText('Notion Search')).toBeInTheDocument();
  });

  it('prefers the connector name over the tool title when both are present', () => {
    renderPanel({ connectorSuggestions: [suggestion('s1', { source: { connectorName: 'Notion', toolTitle: 'Notion Search' } })] });
    expect(screen.getByText('Notion')).toBeInTheDocument();
  });

  it('omits the description line for a suggestion without one', () => {
    renderPanel({ connectorSuggestions: [suggestion('s1', { description: '' })] });
    expect(screen.getByText('name-s1')).toBeInTheDocument();
    expect(screen.queryByText('desc-s1')).toBeNull();
  });

  it('shows a connected connector hint from its account label, or the tool count as fallback', () => {
    renderPanel({
      connectedCount: 2,
      memoryConnectors: [
        connectedConnector('notion', { accountLabel: 'me@acme.com' }),
        connectedConnector('figma', {
          tools: [
            { name: 't1', safety: { sideEffect: 'read' } },
            { name: 't2', safety: { sideEffect: 'read' } },
          ],
        }),
      ],
    });
    // Connected + accountLabel -> the label; connected without a label -> tool count.
    expect(screen.getByText('me@acme.com')).toBeInTheDocument();
    expect(screen.getByText('2 read tools')).toBeInTheDocument();
  });

  it('toggles a connected connector selection via its checkbox', async () => {
    const { toggleConnectorSelection } = renderPanel({
      connectedCount: 1,
      memoryConnectors: [connectedConnector('notion')],
    });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Use notion for memory extraction' }));
    expect(toggleConnectorSelection).toHaveBeenCalledWith('notion');
  });

  it('renders a selected connected connector as checked and selected', () => {
    renderPanel({
      connectedCount: 1,
      selectedConnectorIds: new Set(['notion']),
      selectedConnectedConnectorIds: ['notion'],
      memoryConnectors: [connectedConnector('notion')],
    });

    expect(screen.getByRole('checkbox', { name: 'Use notion for memory extraction' })).toBeChecked();
    expect(screen.getByText('Selected')).toBeInTheDocument();
  });

  it('fires onConnectMemoryConnector for a not-yet-connected connector and stops the row click', async () => {
    const { onConnectMemoryConnector, toggleConnectorSelection } = renderPanel({
      memoryConnectors: [connectedConnector('notion', { status: 'available' })],
    });
    await userEvent.click(screen.getByRole('button', { name: 'Connect notion' }));
    expect(onConnectMemoryConnector).toHaveBeenCalledWith('notion');
    // The row-level checkbox toggle must not also fire from the same click.
    expect(toggleConnectorSelection).not.toHaveBeenCalled();
  });

  it('labels a connector in an error state as reconnectable', () => {
    renderPanel({
      memoryConnectors: [connectedConnector('notion', { status: 'error', lastError: 'token expired' })],
    });
    expect(screen.getByRole('button', { name: 'Reconnect notion' })).toBeInTheDocument();
    expect(screen.getByText('token expired')).toBeInTheDocument();
  });

  it('shows the checking-status hint while connectorsLoading and the status is unresolved', () => {
    renderPanel({
      connectorsLoading: true,
      memoryConnectors: [connectedConnector('notion', { status: 'available' })],
    });
    expect(screen.getByText('Checking connection status…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect notion' })).toBeDisabled();
  });

  it('shows the authorization-pending hint and disables the connect button', () => {
    renderPanel({
      memoryConnectors: [connectedConnector('notion', { status: 'available' })],
      pendingConnectorAuthIds: new Set(['notion']),
    });
    expect(screen.getByText('Finish authorization in your browser, then return here')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect notion' })).toBeDisabled();
  });

  it('shows a connecting connector as busy until its connection request settles', () => {
    renderPanel({
      memoryConnectors: [connectedConnector('notion', { status: 'available' })],
      connectingConnectorIds: new Set(['notion']),
    });
    const button = screen.getByRole('button', { name: 'Connect notion' });
    expect(button).toHaveTextContent('Connecting');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  it('falls back to the connect-error hint over the default prompt', () => {
    renderPanel({
      memoryConnectors: [connectedConnector('notion', { status: 'available' })],
      connectorConnectErrors: { notion: 'network offline' },
    });
    expect(screen.getByText('network offline')).toBeInTheDocument();
  });

  it('shows the default prompt when a not-yet-connected connector has no other hint', () => {
    renderPanel({
      memoryConnectors: [connectedConnector('notion', { status: 'available' })],
    });
    expect(screen.getByText('Connect this app before extraction')).toBeInTheDocument();
  });

  it('fires onSuggestConnectorMemory from the scan button once a connector is selected', async () => {
    const { onSuggestConnectorMemory } = renderPanel({
      connectedCount: 1,
      selectedConnectedConnectorIds: ['notion'],
    });
    await userEvent.click(screen.getByRole('button', { name: 'Scan selected apps' }));
    expect(onSuggestConnectorMemory).toHaveBeenCalled();
  });

  it('disables the scan button when nothing is selected', () => {
    renderPanel({ selectedConnectedConnectorIds: [] });
    expect(screen.getByRole('button', { name: 'Scan selected apps' })).toBeDisabled();
  });

  it('disables the scan button when the panel is disabled', () => {
    renderPanel({ enabled: false, connectedCount: 1, selectedConnectedConnectorIds: ['notion'] });
    expect(screen.getByRole('button', { name: 'Scan selected apps' })).toBeDisabled();
  });

  it('disables the scan button and shows its busy icon while a scan is running', () => {
    const { container } = renderPanel({
      connectedCount: 1,
      selectedConnectedConnectorIds: ['notion'],
      connectorExtracting: true,
    });
    expect(screen.getByRole('button', { name: 'Scan selected apps' })).toBeDisabled();
    expect(container.querySelector('.icon-spin')).toBeInTheDocument();
  });

  it('fires onSaveConnectorSuggestions and onDiscardConnectorSuggestions from their buttons', async () => {
    const { onSaveConnectorSuggestions, onDiscardConnectorSuggestions } = renderPanel({
      selectedConnectorSuggestions: [suggestion('s1')],
    });
    await userEvent.click(screen.getByRole('button', { name: 'Save selected' }));
    expect(onSaveConnectorSuggestions).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onDiscardConnectorSuggestions).toHaveBeenCalled();
  });

  it('renders selected suggestions and disables their actions while saving', () => {
    renderPanel({
      selectedSuggestionIds: new Set(['s1']),
      selectedConnectorSuggestions: [suggestion('s1')],
      connectorSaving: true,
    });

    const suggestionCheckbox = screen
      .getAllByRole('checkbox')
      .find((c) => (c as HTMLInputElement).closest('.memory-suggestion-card'))!;
    expect(suggestionCheckbox).toBeChecked();
    expect(screen.getByRole('button', { name: 'Saving' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Discard' })).toBeDisabled();
  });

  it('disables the Save selected button when no suggestions are selected', () => {
    renderPanel({ selectedConnectorSuggestions: [] });
    expect(screen.getByRole('button', { name: 'Save selected' })).toBeDisabled();
  });

  it('does not render suggestion actions when no suggestions are available', () => {
    renderPanel({ connectorSuggestions: [] });
    expect(screen.queryByText('Suggested memories')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Discard' })).toBeNull();
  });

  it('shows the success status and error banners', () => {
    renderPanel({ connectorStatus: 'Saved 2 memories', connectorError: 'Scan failed' });
    expect(screen.getByRole('status')).toHaveTextContent('Saved 2 memories');
    expect(screen.getByRole('alert')).toHaveTextContent('Scan failed');
  });

  it('shows the connector-load-error banner', () => {
    renderPanel({ connectorLoadError: 'Could not load connectors' });
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load connectors');
  });

  it('renders last-scan diagnostics for succeeded, failed, and skipped attempts', () => {
    const attempts: ConnectorMemoryAttempt[] = [
      { connectorId: 'notion', connectorName: 'Notion', status: 'succeeded', toolTitle: 'Search', summary: 'read 3 pages' },
      { connectorId: 'figma', connectorName: 'Figma', status: 'failed', error: 'rate limited', summary: '' },
      { connectorId: 'slack', connectorName: 'Slack', status: 'skipped', summary: '' },
    ];
    renderPanel({ connectorAttempts: attempts, connectorContextBytes: 2048 });
    expect(screen.getByText('Read Notion')).toBeInTheDocument();
    expect(screen.getByText('Could not read Figma')).toBeInTheDocument();
    expect(screen.getByText('Skipped Slack')).toBeInTheDocument();
    expect(screen.getByText('2.0 KB read')).toBeInTheDocument();
  });

  it('omits the diagnostics section when there are no attempts', () => {
    renderPanel({ connectorAttempts: [] });
    expect(screen.queryByText('Last scan')).toBeNull();
  });

  it('omits the recent-scans section when there are no extractions', () => {
    renderPanel({ connectorExtractions: [] });
    expect(screen.queryByText('Recent scans')).toBeNull();
  });

  it('renders up to 4 recent scans while the summary badge shows the true count, and wires delete', async () => {
    const record = (id: string): MemoryExtractionRecord => ({
      id,
      startedAt: 1_000,
      phase: 'success',
      userMessagePreview: `msg-${id}`,
      kind: 'connector',
    });
    const { onDeleteExtraction } = renderPanel({
      connectorExtractions: [record('a'), record('b'), record('c'), record('d'), record('e')],
    });

    // The summary badge reports the TRUE total (5) even though the visible
    // history is capped at 4 cards.
    expect(screen.getByText('5')).toBeInTheDocument();
    const deleteButtons = screen.getAllByRole('button', { name: 'Remove' });
    expect(deleteButtons).toHaveLength(4);

    await userEvent.click(deleteButtons[0]!);
    expect(onDeleteExtraction).toHaveBeenCalledWith('a');
  });

  it('renders translated copy when mounted under an I18nProvider with a matching dictionary', () => {
    render(
      <I18nProvider dictionaries={{ fr: { 'Import from apps': 'Importer des applications', Manage: 'Gérer' } }} initialLocale="fr">
        <MemoryConnectedPanel
          enabled
          onOpenConnectors={vi.fn()}
          connectorStatuses={{}}
          connectorsLoading={false}
          connectedCount={0}
          selectedConnectorIds={new Set()}
          selectedConnectedConnectorIds={[]}
          connectingConnectorIds={new Set()}
          pendingConnectorAuthIds={new Set()}
          connectorConnectErrors={{}}
          connectorIdsWithDetails={new Set()}
          connectorExtracting={false}
          connectorSaving={false}
          connectorScanLabel="Scan selected apps"
          connectorSuggestions={[]}
          selectedSuggestionIds={new Set()}
          selectedConnectorSuggestions={[]}
          connectorStatus={null}
          connectorError={null}
          connectorLoadError={null}
          connectorAttempts={[]}
          connectorContextBytes={0}
          connectorExtractions={[]}
          memoryConnectors={[]}
          nowClock={0}
          toggleConnectorSelection={vi.fn()}
          onConnectMemoryConnector={vi.fn()}
          toggleConnectorSuggestion={vi.fn()}
          onSuggestConnectorMemory={vi.fn()}
          onSaveConnectorSuggestions={vi.fn()}
          onDiscardConnectorSuggestions={vi.fn()}
          onOpenPreview={vi.fn()}
          onDeleteExtraction={vi.fn()}
        />
      </I18nProvider>,
    );
    expect(screen.getByText('Importer des applications')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gérer' })).toBeInTheDocument();
  });

  it('prefers the connector lastError over a connect error in the hint', () => {
    renderPanel({
      memoryConnectors: [connectedConnector('notion', { status: 'available', lastError: '  stale token  ' })],
      connectorConnectErrors: { notion: 'network offline' },
    });
    expect(screen.getByText('stale token')).toBeInTheDocument();
    expect(screen.queryByText('network offline')).toBeNull();
  });

  it('falls through a whitespace-only lastError to the connect error', () => {
    renderPanel({
      memoryConnectors: [connectedConnector('notion', { status: 'available', lastError: '   ' })],
      connectorConnectErrors: { notion: 'network offline' },
    });
    expect(screen.getByText('network offline')).toBeInTheDocument();
  });

  it('does not show checking status once the status map has an entry for the connector', () => {
    renderPanel({
      connectorsLoading: true,
      connectorStatuses: { notion: { status: 'available' } },
      memoryConnectors: [connectedConnector('notion', { status: 'available' })],
    });
    expect(screen.getByText('Connect this app before extraction')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect notion' })).toBeEnabled();
  });

  it('does not show checking status once the connector details have loaded', () => {
    renderPanel({
      connectorsLoading: true,
      connectorIdsWithDetails: new Set(['notion']),
      memoryConnectors: [connectedConnector('notion', { status: 'available' })],
    });
    expect(screen.getByRole('button', { name: 'Connect notion' })).toHaveTextContent('Connect');
    expect(screen.getByRole('button', { name: 'Connect notion' })).not.toHaveAttribute('aria-busy');
  });

  it('does not show checking status for a connector with a connect error', () => {
    renderPanel({
      connectorsLoading: true,
      connectorConnectErrors: { notion: 'network offline' },
      memoryConnectors: [connectedConnector('notion', { status: 'available' })],
    });
    expect(screen.getByText('network offline')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect notion' })).toBeEnabled();
  });

  it('shows Checking on the connect button and spins its icon while status is unresolved', () => {
    const { container } = renderPanel({
      connectorsLoading: true,
      memoryConnectors: [connectedConnector('notion', { status: 'available' })],
    });
    const button = screen.getByRole('button', { name: 'Connect notion' });
    expect(button).toHaveTextContent('Checking');
    expect(button).toHaveClass('memory-connector-connect-button', 'is-loading');
    expect(container.querySelector('.memory-connector-connect-button .icon-spin')).not.toBeNull();
  });

  it('labels the connect button Waiting while authorization is pending', () => {
    renderPanel({
      memoryConnectors: [connectedConnector('notion', { status: 'error' })],
      pendingConnectorAuthIds: new Set(['notion']),
      connectingConnectorIds: new Set(['notion']),
    });
    expect(screen.getByRole('button', { name: 'Reconnect notion' })).toHaveTextContent('Waiting');
  });

  it('labels a reconnecting connector Connecting while its request is in flight', () => {
    renderPanel({
      memoryConnectors: [connectedConnector('notion', { status: 'error' })],
      connectingConnectorIds: new Set(['notion']),
    });
    expect(screen.getByRole('button', { name: 'Reconnect notion' })).toHaveTextContent('Connecting');
  });

  it('never marks a not-connected connector as selected even when its id is selected', () => {
    const { container } = renderPanel({
      memoryConnectors: [connectedConnector('notion', { status: 'available' })],
      selectedConnectorIds: new Set(['notion']),
    });
    const row = container.querySelector('[data-memory-connector-id="notion"]');
    expect(row?.className).toBe('memory-connector-row is-disabled');
    expect(screen.getByRole('checkbox', { name: 'Use notion for memory extraction' })).not.toBeChecked();
  });

  it('shows Loading in the summary badge while connectors load', () => {
    const { container } = renderPanel({ connectorsLoading: true, connectedCount: 3 });
    expect(container.querySelector('.memory-connected-summary .memory-source-badge')?.textContent).toBe('Loading');
  });

  it('shows the connected count in the summary badge once loaded', () => {
    const { container } = renderPanel({ connectedCount: 3 });
    expect(container.querySelector('.memory-connected-summary .memory-source-badge')?.textContent).toBe('3 connected');
  });

  it('uses the singular app noun in the run bar for exactly one connected app', () => {
    const { container } = renderPanel({ connectedCount: 1, selectedConnectedConnectorIds: ['notion'] });
    expect(container.querySelector('.memory-connector-runbar .hint')?.textContent).toBe('Selected 1 of 1 connected app.');
  });

  it('disables the scan button while suggestions are saving', () => {
    renderPanel({ connectorSaving: true, selectedConnectedConnectorIds: ['notion'] });
    expect(screen.getByRole('button', { name: 'Scan selected apps' })).toBeDisabled();
  });

  it('renders no description element at all for a suggestion without one', () => {
    const { container } = renderPanel({ connectorSuggestions: [suggestion('s1', { description: '' })] });
    expect(container.querySelector('.memory-suggestion-copy small')).toBeNull();
  });

  it('renders each diagnostic row detail line from the attempt', () => {
    const { container } = renderPanel({
      connectorAttempts: [{ connectorId: 'figma', connectorName: 'Figma', status: 'failed', toolTitle: 'Files', error: 'rate limited', summary: 'partial' }],
    });
    expect(container.querySelector('.memory-connector-diagnostic-row.is-failed small')?.textContent).toBe('Files · rate limited · partial');
  });
});
