import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConnectorGrid } from '../../components/ConnectorGrid.js';
import type { Connector } from '../../types.js';

function makeConnector(overrides: Partial<Connector> = {}): Connector {
  return { id: 'slack', name: 'Slack', provider: 'Composio', category: 'communication', status: 'available', tools: [], ...overrides };
}

const noop = () => {};

describe('ConnectorGrid', () => {
  it('renders a card per connector', () => {
    render(
      <ConnectorGrid
        connectors={[makeConnector({ id: 'a', name: 'A' }), makeConnector({ id: 'b', name: 'B' })]}
        locked={false}
        hasNoResults={false}
        searchQuery=""
        pendingConnectorAction={null}
        authorizationPending={{}}
        authorizationCancelFailed={{}}
        toolsLoaded={false}
        onConnect={noop}
        onDisconnect={noop}
        onCancelAuthorization={noop}
        onOpenDetails={noop}
        onClearSearch={noop}
      />,
    );
    expect(screen.getAllByRole('button', { name: /^Open details for/ })).toHaveLength(2);
  });

  it('shows the no-results empty state when hasNoResults, and clears search on action', async () => {
    const onClearSearch = vi.fn();
    render(
      <ConnectorGrid
        connectors={[]}
        locked={false}
        hasNoResults
        searchQuery="zzz"
        pendingConnectorAction={null}
        authorizationPending={{}}
        authorizationCancelFailed={{}}
        toolsLoaded={false}
        onConnect={noop}
        onDisconnect={noop}
        onCancelAuthorization={noop}
        onOpenDetails={noop}
        onClearSearch={onClearSearch}
      />,
    );
    expect(screen.getByTestId('connectors-empty')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(onClearSearch).toHaveBeenCalled();
  });

  it('passes pendingAction through only to the matching connector card', () => {
    render(
      <ConnectorGrid
        connectors={[makeConnector({ id: 'a', name: 'A' }), makeConnector({ id: 'b', name: 'B' })]}
        locked={false}
        hasNoResults={false}
        searchQuery=""
        pendingConnectorAction={{ connectorId: 'a', action: 'connect' }}
        authorizationPending={{}}
        authorizationCancelFailed={{}}
        toolsLoaded={false}
        onConnect={noop}
        onDisconnect={noop}
        onCancelAuthorization={noop}
        onOpenDetails={noop}
        onClearSearch={noop}
      />,
    );
    const cardA = screen.getByLabelText('Open details for A');
    const cardB = screen.getByLabelText('Open details for B');
    expect(cardA.querySelector('.connector-action.is-connect')?.getAttribute('aria-busy')).toBe('true');
    expect(cardB.querySelector('.connector-action.is-connect')?.getAttribute('aria-busy')).toBeNull();
  });

  it('honors custom empty-state copy overrides', () => {
    render(
      <ConnectorGrid
        connectors={[]}
        locked={false}
        hasNoResults
        searchQuery="zzz"
        pendingConnectorAction={null}
        authorizationPending={{}}
        authorizationCancelFailed={{}}
        toolsLoaded={false}
        onConnect={noop}
        onDisconnect={noop}
        onCancelAuthorization={noop}
        onOpenDetails={noop}
        onClearSearch={noop}
        emptyNoMatchTitle={(query) => `No hits for ${query}`}
        emptyNoMatchBody="custom body"
        emptyNoMatchAction="custom action"
      />,
    );
    expect(screen.getByText('No hits for zzz')).toBeTruthy();
    expect(screen.getByText('custom body')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'custom action' })).toBeTruthy();
  });

  it('does not show the empty state while locked, even if hasNoResults is true', () => {
    render(
      <ConnectorGrid
        connectors={[]}
        locked
        hasNoResults
        searchQuery="zzz"
        pendingConnectorAction={null}
        authorizationPending={{}}
        authorizationCancelFailed={{}}
        toolsLoaded={false}
        onConnect={noop}
        onDisconnect={noop}
        onCancelAuthorization={noop}
        onOpenDetails={noop}
        onClearSearch={noop}
      />,
    );
    expect(screen.queryByTestId('connectors-empty')).toBeNull();
  });

  it('does not render a gate overlay when locked but no gate prop is supplied', () => {
    render(
      <ConnectorGrid
        connectors={[makeConnector()]}
        locked
        hasNoResults={false}
        searchQuery=""
        pendingConnectorAction={null}
        authorizationPending={{}}
        authorizationCancelFailed={{}}
        toolsLoaded={false}
        onConnect={noop}
        onDisconnect={noop}
        onCancelAuthorization={noop}
        onOpenDetails={noop}
        onClearSearch={noop}
      />,
    );
    expect(screen.queryByTestId('connector-gate')).toBeNull();
  });

  it('passes getCategoryLabel and onOpenExternalUrl through to cards when supplied', () => {
    const getCategoryLabel = vi.fn((category: string) => `Category: ${category}`);
    render(
      <ConnectorGrid
        connectors={[makeConnector({ status: 'error', lastError: 'boom' })]}
        locked={false}
        hasNoResults={false}
        searchQuery=""
        pendingConnectorAction={null}
        authorizationPending={{}}
        authorizationCancelFailed={{}}
        toolsLoaded={false}
        onConnect={noop}
        onDisconnect={noop}
        onCancelAuthorization={noop}
        onOpenDetails={noop}
        onOpenExternalUrl={noop}
        onClearSearch={noop}
        getCategoryLabel={getCategoryLabel}
      />,
    );
    expect(getCategoryLabel).toHaveBeenCalledWith('communication');
  });

  it('shows the gate overlay when locked and a gate is supplied', () => {
    render(
      <ConnectorGrid
        connectors={[makeConnector()]}
        locked
        hasNoResults={false}
        searchQuery=""
        pendingConnectorAction={null}
        authorizationPending={{}}
        authorizationCancelFailed={{}}
        toolsLoaded={false}
        onConnect={noop}
        onDisconnect={noop}
        onCancelAuthorization={noop}
        onOpenDetails={noop}
        onClearSearch={noop}
        gate={{ title: 'Locked', body: 'Add a key', ctaLabel: 'Get key', ctaHref: 'https://example.com' }}
      />,
    );
    expect(screen.getByTestId('connector-gate')).toBeTruthy();
    expect(screen.getByTestId('connector-grid-wrap').className).toContain('is-masked');
  });
});
