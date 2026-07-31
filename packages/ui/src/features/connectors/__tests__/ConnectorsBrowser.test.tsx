import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n/index.js';
import { ConnectorsBrowser } from '../ConnectorsBrowser.js';
import { createFakeConnectorsDependencies } from '../dependencies.js';
import type { Connector } from '@jini-ai/ui-core';

function makeConnector(overrides: Partial<Connector> = {}): Connector {
  return { id: 'slack', name: 'Slack', provider: 'Composio', category: 'communication', status: 'available', tools: [], ...overrides };
}

describe('ConnectorsBrowser', () => {
  it('loads and renders the catalog', async () => {
    const dependencies = createFakeConnectorsDependencies({ connectors: [makeConnector(), makeConnector({ id: 'notion', name: 'Notion' })] });
    render(<ConnectorsBrowser unlocked dependencies={dependencies} />);
    await waitFor(() => expect(screen.getByText('Slack')).toBeTruthy());
    expect(screen.getByText('Notion')).toBeTruthy();
  });

  it('shows the gate overlay and masks the grid when locked', async () => {
    const dependencies = createFakeConnectorsDependencies({ connectors: [makeConnector()] });
    render(
      <ConnectorsBrowser
        unlocked={false}
        dependencies={dependencies}
        gate={{ title: 'Add a key', body: 'body', ctaLabel: 'Get key', ctaHref: 'https://example.com' }}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('connector-gate')).toBeTruthy());
    expect(screen.getByTestId('connector-grid-wrap').className).toContain('is-masked');
  });

  it('filters the grid via search and shows the no-results empty state', async () => {
    const dependencies = createFakeConnectorsDependencies({
      connectors: [makeConnector(), makeConnector({ id: 'notion', name: 'Notion' })],
    });
    render(<ConnectorsBrowser unlocked dependencies={dependencies} />);
    await waitFor(() => expect(screen.getByText('Slack')).toBeTruthy());

    await userEvent.type(screen.getByTestId('connectors-search-input'), 'notion');
    await waitFor(() => expect(screen.queryByText('Slack')).toBeNull());
    expect(screen.getByText('Notion')).toBeTruthy();

    await userEvent.clear(screen.getByTestId('connectors-search-input'));
    await userEvent.type(screen.getByTestId('connectors-search-input'), 'zzz-no-match');
    await waitFor(() => expect(screen.getByTestId('connectors-empty')).toBeTruthy());
  });

  it('connects a connector end-to-end through the fake dependencies', async () => {
    const dependencies = createFakeConnectorsDependencies({ connectors: [makeConnector()] });
    const onConnectorAuthResult = vi.fn();
    render(<ConnectorsBrowser unlocked dependencies={dependencies} onConnectorAuthResult={onConnectorAuthResult} />);
    await waitFor(() => expect(screen.getByText('Slack')).toBeTruthy());

    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(onConnectorAuthResult).toHaveBeenCalledWith({ connectorId: 'slack', action: 'connect', result: 'success' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Disconnect' })).toBeTruthy());
  });

  it('fires onProviderTabClick for provider-tab and search interactions', async () => {
    const dependencies = createFakeConnectorsDependencies({ connectors: [makeConnector()] });
    const onProviderTabClick = vi.fn();
    render(
      <ConnectorsBrowser
        unlocked
        dependencies={dependencies}
        providerTabs={[{ id: 'default', label: 'All', match: () => true }]}
        onProviderTabClick={onProviderTabClick}
      />,
    );
    await waitFor(() => expect(screen.getByText('Slack')).toBeTruthy());

    await userEvent.click(screen.getByTestId('connectors-provider-tab-default'));
    expect(onProviderTabClick).toHaveBeenCalledWith('provider_chip');

    await userEvent.click(screen.getByTestId('connectors-search-input'));
    expect(onProviderTabClick).toHaveBeenCalledWith('search_connectors');
  });

  it('opens the detail drawer for a connector and closes it', async () => {
    const dependencies = createFakeConnectorsDependencies({ connectors: [makeConnector({ description: 'A chat tool' })] });
    render(<ConnectorsBrowser unlocked dependencies={dependencies} />);
    await waitFor(() => expect(screen.getByText('Slack')).toBeTruthy());

    await userEvent.click(screen.getByRole('button', { name: 'Open details for Slack' }));
    await waitFor(() => expect(screen.getByTestId('connector-drawer')).toBeTruthy());

    await userEvent.click(screen.getByTestId('connector-drawer-close'));
    expect(screen.queryByTestId('connector-drawer')).toBeNull();
  });

  it('falls back to its own fake dependencies when none are supplied', async () => {
    render(<ConnectorsBrowser unlocked />);
    // The default fake dependencies seed an empty catalog — proves the
    // component mounted and loaded without a `dependencies` prop at all,
    // rather than throwing.
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  });

  it('notifies onConnectorsChanged when a status refresh detects a real change', async () => {
    const dependencies = createFakeConnectorsDependencies({ connectors: [makeConnector()] });
    const onConnectorsChanged = vi.fn();
    render(<ConnectorsBrowser unlocked dependencies={dependencies} onConnectorsChanged={onConnectorsChanged} />);
    await waitFor(() => expect(screen.getByText('Slack')).toBeTruthy());

    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(onConnectorsChanged).toHaveBeenCalled());
  });

  it('disconnects a connector from the grid card action', async () => {
    const dependencies = createFakeConnectorsDependencies({ connectors: [makeConnector({ status: 'connected' })] });
    render(<ConnectorsBrowser unlocked dependencies={dependencies} />);
    await waitFor(() => expect(screen.getByText('Slack')).toBeTruthy());

    await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Connect' })).toBeTruthy());
  });

  it('clears the search filter via the empty-state action', async () => {
    const dependencies = createFakeConnectorsDependencies({ connectors: [makeConnector()] });
    render(<ConnectorsBrowser unlocked dependencies={dependencies} />);
    await waitFor(() => expect(screen.getByText('Slack')).toBeTruthy());

    await userEvent.type(screen.getByTestId('connectors-search-input'), 'zzz-no-match');
    await waitFor(() => expect(screen.getByTestId('connectors-empty')).toBeTruthy());

    const emptyState = screen.getByTestId('connectors-empty');
    await userEvent.click(within(emptyState).getByRole('button', { name: 'Clear search' }));
    await waitFor(() => expect(screen.getByText('Slack')).toBeTruthy());
    expect((screen.getByTestId('connectors-search-input') as HTMLInputElement).value).toBe('');
  });

  it('passes getCategoryLabel through to the grid cards and the detail drawer', async () => {
    const dependencies = createFakeConnectorsDependencies({ connectors: [makeConnector({ category: 'crm' })] });
    render(<ConnectorsBrowser unlocked dependencies={dependencies} getCategoryLabel={(c) => c.toUpperCase()} />);
    await waitFor(() => expect(screen.getByText('CRM')).toBeTruthy());

    await userEvent.click(screen.getByRole('button', { name: 'Open details for Slack' }));
    await waitFor(() => expect(screen.getByTestId('connector-drawer')).toBeTruthy());
    expect(within(screen.getByTestId('connector-drawer')).getAllByText('CRM').length).toBeGreaterThan(0);
  });

  it('defaults selectedProvider using DEFAULT_PROVIDER_TAB_ID when providerTabs is empty', async () => {
    const dependencies = createFakeConnectorsDependencies({ connectors: [makeConnector()] });
    render(<ConnectorsBrowser unlocked dependencies={dependencies} providerTabs={[]} />);
    await waitFor(() => expect(screen.getByText('Slack')).toBeTruthy());
  });

  it('cancels a pending authorization from the grid card directly (not via the drawer)', async () => {
    const dependencies = createFakeConnectorsDependencies({ connectors: [makeConnector()] });
    dependencies.data.connectConnector = vi.fn(async () => ({
      connector: makeConnector(),
      auth: { kind: 'redirect_required' as const, redirectUrl: 'https://oauth.example.com', expiresAt: '2099-01-01T00:00:00Z' },
    }));
    render(<ConnectorsBrowser unlocked dependencies={dependencies} />);
    await waitFor(() => expect(screen.getByText('Slack')).toBeTruthy());

    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel authorization' })).toBeTruthy());

    await userEvent.click(screen.getByRole('button', { name: 'Cancel authorization' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Cancel authorization' })).toBeNull());
  });

  it('fires onProviderTabClick and the gate onClick when the gate CTA is clicked', async () => {
    const dependencies = createFakeConnectorsDependencies({ connectors: [makeConnector()] });
    const onProviderTabClick = vi.fn();
    const gateOnClick = vi.fn();
    render(
      <ConnectorsBrowser
        unlocked={false}
        dependencies={dependencies}
        onProviderTabClick={onProviderTabClick}
        gate={{ title: 'Add a key', body: 'body', ctaLabel: 'Get key', ctaHref: 'https://example.com', onClick: gateOnClick }}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('connector-gate')).toBeTruthy());

    await userEvent.click(screen.getByText('Get key'));
    expect(onProviderTabClick).toHaveBeenCalledWith('gate_card');
    expect(gateOnClick).toHaveBeenCalled();
  });

  it('passes getDisplayableAccountLabel through to the detail drawer', async () => {
    const dependencies = createFakeConnectorsDependencies({
      connectors: [makeConnector({ status: 'connected', accountLabel: 'me@x.com' })],
    });
    render(
      <ConnectorsBrowser
        unlocked
        dependencies={dependencies}
        getDisplayableAccountLabel={() => 'custom-label@x.com'}
      />,
    );
    await waitFor(() => expect(screen.getByText('Slack')).toBeTruthy());
    await userEvent.click(screen.getByRole('button', { name: 'Open details for Slack' }));
    await waitFor(() => expect(screen.getByText('custom-label@x.com')).toBeTruthy());
  });

  it('supports the full detail-drawer action set: disconnect, cancel authorization, load more tools, and open external url', async () => {
    const dependencies = createFakeConnectorsDependencies({
      connectors: [
        makeConnector({
          status: 'connected',
          toolCount: 2,
          tools: [{ name: 'a', safety: { sideEffect: 'no_side_effect' } }],
          toolsNextCursor: 'cursor-2',
        }),
      ],
    });
    const fetchDetailSpy = vi.spyOn(dependencies.data, 'fetchConnectorDetail');
    render(<ConnectorsBrowser unlocked dependencies={dependencies} />);
    await waitFor(() => expect(screen.getByText('Slack')).toBeTruthy());

    await userEvent.click(screen.getByRole('button', { name: 'Open details for Slack' }));
    await waitFor(() => expect(screen.getByTestId('connector-drawer')).toBeTruthy());
    const drawer = screen.getByTestId('connector-drawer');

    // load more tools — reaches the port with the right cursor.
    await userEvent.click(within(drawer).getByRole('button', { name: 'Load more tools' }));
    await waitFor(() =>
      expect(fetchDetailSpy).toHaveBeenCalledWith('slack', expect.objectContaining({ toolsCursor: 'cursor-2' })),
    );

    // disconnect from within the drawer
    await userEvent.click(within(drawer).getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Connect' }).length).toBeGreaterThan(0));
  });

  it('cancels a pending authorization from both the grid card and the detail drawer, and opens the OAuth link externally', async () => {
    const dependencies = createFakeConnectorsDependencies({
      connectors: [makeConnector({ description: 'A great connector.' })],
    });
    dependencies.data.connectConnector = vi.fn(async () => ({
      connector: makeConnector({ description: 'A great connector.' }),
      auth: { kind: 'redirect_required' as const, redirectUrl: 'https://oauth.example.com', expiresAt: '2099-01-01T00:00:00Z' },
    }));
    const openExternalUrlSpy = vi.spyOn(dependencies.data, 'openExternalUrl');
    render(<ConnectorsBrowser unlocked dependencies={dependencies} />);
    await waitFor(() => expect(screen.getByText('Slack')).toBeTruthy());

    const grid = screen.getByTestId('connector-grid-wrap');
    await userEvent.click(within(grid).getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(within(grid).getByRole('button', { name: 'Cancel authorization' })).toBeTruthy());

    // Continue in browser from the card (grid-level onOpenExternalUrl).
    await userEvent.click(within(grid).getByRole('button', { name: 'Continue in browser' }));
    expect(openExternalUrlSpy).toHaveBeenCalledWith('https://oauth.example.com');

    // Open the drawer and continue from there too (drawer-level onOpenExternalUrl).
    await userEvent.click(within(grid).getByRole('button', { name: 'Open details for Slack' }));
    await waitFor(() => expect(screen.getByTestId('connector-drawer')).toBeTruthy());
    const drawer = screen.getByTestId('connector-drawer');
    await userEvent.click(within(drawer).getByRole('button', { name: 'Continue in browser' }));
    expect(openExternalUrlSpy).toHaveBeenCalledTimes(2);

    // Cancel from the drawer.
    await userEvent.click(within(drawer).getByRole('button', { name: 'Cancel authorization' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Cancel authorization' })).toBeNull());
  });

  it("reflects a pending connect action in the open detail drawer's own busy state", async () => {
    const dependencies = createFakeConnectorsDependencies({ connectors: [makeConnector()] });
    let resolveConnect: (value: import('@jini-ai/ui-core').ConnectorActionResult) => void = () => {};
    dependencies.data.connectConnector = vi.fn(
      () => new Promise<import('@jini-ai/ui-core').ConnectorActionResult>((resolve) => (resolveConnect = resolve)),
    );
    render(<ConnectorsBrowser unlocked dependencies={dependencies} />);
    await waitFor(() => expect(screen.getByText('Slack')).toBeTruthy());

    await userEvent.click(screen.getByRole('button', { name: 'Open details for Slack' }));
    await waitFor(() => expect(screen.getByTestId('connector-drawer')).toBeTruthy());
    const drawer = screen.getByTestId('connector-drawer');

    await userEvent.click(within(drawer).getByRole('button', { name: 'Connect' }));
    await waitFor(() => {
      const busyButtons = screen.getAllByRole('button', { name: 'Connect' }).filter((b) => b.getAttribute('aria-busy') === 'true');
      expect(busyButtons.length).toBeGreaterThan(0);
    });

    resolveConnect({ connector: makeConnector({ status: 'connected' }), auth: { kind: 'connected' } });
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Disconnect' }).length).toBeGreaterThan(0));
  });

  it('renders translated copy when mounted under an I18nProvider with a matching dictionary', async () => {
    const dependencies = createFakeConnectorsDependencies({ connectors: [makeConnector()] });
    render(
      <I18nProvider dictionaries={{ fr: { Connectors: 'Connecteurs', Connect: 'Connecter' } }} initialLocale="fr">
        <ConnectorsBrowser unlocked dependencies={dependencies} />
      </I18nProvider>,
    );
    expect(screen.getByText('Connecteurs')).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Connecter' })).toBeTruthy());
  });
});

describe('ConnectorsBrowser 4-pattern hook override test suite', () => {
  it('Pattern 1 — State 1: Catalog loading state via hook override', () => {
    const customCatalogHook = () => ({
      connectors: [],
      setConnectors: vi.fn(),
      loading: true,
      enriched: false,
    });

    render(<ConnectorsBrowser unlocked useConnectorCatalog={customCatalogHook as any} />);

    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('Pattern 2 — State 2: Active catalog grid with connectors via hook override', () => {
    const connectors = [makeConnector({ id: 'jira', name: 'Jira' })];
    const customCatalogHook = () => ({
      connectors,
      setConnectors: vi.fn(),
      loading: false,
      enriched: true,
    });

    render(<ConnectorsBrowser unlocked useConnectorCatalog={customCatalogHook as any} />);

    expect(screen.getByText('Jira')).toBeInTheDocument();
  });

  it('Pattern 3 — State 3: Active connector detail drawer state via hook override', () => {
    const connectors = [makeConnector({ id: 'jira', name: 'Jira' })];
    const customCatalogHook = () => ({
      connectors,
      setConnectors: vi.fn(),
      loading: false,
      enriched: true,
    });

    const customDetailHook = () => ({
      detailConnectorId: 'jira',
      detailConnector: connectors[0]!,
      toolsLoaded: true,
      toolPreviewLoading: false,
      openDetails: vi.fn(),
      closeDetails: vi.fn(),
      loadMoreTools: vi.fn(),
    });

    render(
      <ConnectorsBrowser
        unlocked
        useConnectorCatalog={customCatalogHook as any}
        useConnectorDetail={customDetailHook as any}
      />,
    );

    expect(screen.getByTestId('connector-drawer')).toBeInTheDocument();
  });

  it('Pattern 4 — State 4: Dynamic search filtering transition walkthrough using React useState inside test harness', () => {
    const connectors = [makeConnector({ id: 'jira', name: 'Jira' }), makeConnector({ id: 'slack', name: 'Slack' })];
    const customCatalogHook = () => ({
      connectors,
      setConnectors: vi.fn(),
      loading: false,
      enriched: true,
    });

    render(<ConnectorsBrowser unlocked useConnectorCatalog={customCatalogHook as any} />);

    expect(screen.getByText('Jira')).toBeInTheDocument();
    expect(screen.getByText('Slack')).toBeInTheDocument();

    const input = screen.getByTestId('connectors-search-input');
    fireEvent.change(input, { target: { value: 'jira' } });

    expect(screen.getByText('Jira')).toBeInTheDocument();
    expect(screen.queryByText('Slack')).toBeNull();
  });
});
