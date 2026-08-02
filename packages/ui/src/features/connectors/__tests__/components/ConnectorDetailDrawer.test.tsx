import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConnectorDetailDrawer } from '../../components/ConnectorDetailDrawer.js';
import type { Connector } from '../../types.js';

function makeConnector(overrides: Partial<Connector> = {}): Connector {
  return { id: 'slack', name: 'Slack', provider: 'Composio', category: 'communication', status: 'available', tools: [], ...overrides };
}

const noop = () => {};

describe('ConnectorDetailDrawer', () => {
  it('calls onClose on Escape and restores body overflow on unmount', () => {
    const onClose = vi.fn();
    const { unmount } = render(
      <ConnectorDetailDrawer
        connector={makeConnector()}
        disabled={false}
        pendingAction={null}
        authorizationCancelFailed={false}
        authorizationError={null}
        toolsPreviewLoading={false}
        toolsLoaded
        onClose={onClose}
        onConnect={noop}
        onDisconnect={noop}
        onCancelAuthorization={noop}
        onLoadMoreTools={noop}
      />,
    );
    expect(document.body.style.overflow).toBe('hidden');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('calls onClose when the backdrop (not the drawer itself) is clicked', async () => {
    const onClose = vi.fn();
    render(
      <ConnectorDetailDrawer
        connector={makeConnector()}
        disabled={false}
        pendingAction={null}
        authorizationCancelFailed={false}
        authorizationError={null}
        toolsPreviewLoading={false}
        toolsLoaded
        onClose={onClose}
        onConnect={noop}
        onDisconnect={noop}
        onCancelAuthorization={noop}
        onLoadMoreTools={noop}
      />,
    );
    await userEvent.click(screen.getByRole('dialog').parentElement!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows a loading state for tools while preview is loading', () => {
    render(
      <ConnectorDetailDrawer
        connector={makeConnector({ toolCount: 3 })}
        disabled={false}
        pendingAction={null}
        authorizationCancelFailed={false}
        authorizationError={null}
        toolsPreviewLoading
        toolsLoaded={false}
        onClose={noop}
        onConnect={noop}
        onDisconnect={noop}
        onCancelAuthorization={noop}
        onLoadMoreTools={noop}
      />,
    );
    expect(screen.getByText('Loading tools…')).toBeTruthy();
  });

  it('renders the tool list with a load-more button when a next cursor exists, and fires onLoadMoreTools', async () => {
    const onLoadMoreTools = vi.fn();
    render(
      <ConnectorDetailDrawer
        connector={makeConnector({
          toolCount: 2,
          tools: [{ name: 'send_message', title: 'Send message', safety: { sideEffect: 'no_side_effect' } }],
          toolsNextCursor: 'cursor-2',
        })}
        disabled={false}
        pendingAction={null}
        authorizationCancelFailed={false}
        authorizationError={null}
        toolsPreviewLoading={false}
        toolsLoaded
        onClose={noop}
        onConnect={noop}
        onDisconnect={noop}
        onCancelAuthorization={noop}
        onLoadMoreTools={onLoadMoreTools}
      />,
    );
    expect(screen.getByText('Send message')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Load more tools' }));
    expect(onLoadMoreTools).toHaveBeenCalledWith('slack', 'cursor-2');
  });

  it('reports tool details as unavailable when toolCount exists but no tools loaded', () => {
    render(
      <ConnectorDetailDrawer
        connector={makeConnector({ toolCount: 5, tools: [] })}
        disabled={false}
        pendingAction={null}
        authorizationCancelFailed={false}
        authorizationError={null}
        toolsPreviewLoading={false}
        toolsLoaded
        onClose={noop}
        onConnect={noop}
        onDisconnect={noop}
        onCancelAuthorization={noop}
        onLoadMoreTools={noop}
      />,
    );
    expect(screen.getByText('Tool details unavailable (5)')).toBeTruthy();
  });

  it('shows a connect footer for an unconnected connector and a disconnect action for a connected one', () => {
    const { rerender } = render(
      <ConnectorDetailDrawer
        connector={makeConnector()}
        disabled={false}
        pendingAction={null}
        authorizationCancelFailed={false}
        authorizationError={null}
        toolsPreviewLoading={false}
        toolsLoaded
        onClose={noop}
        onConnect={noop}
        onDisconnect={noop}
        onCancelAuthorization={noop}
        onLoadMoreTools={noop}
      />,
    );
    expect(screen.getByRole('button', { name: 'Connect' })).toBeTruthy();

    rerender(
      <ConnectorDetailDrawer
        connector={makeConnector({ status: 'connected' })}
        disabled={false}
        pendingAction={null}
        authorizationCancelFailed={false}
        authorizationError={null}
        toolsPreviewLoading={false}
        toolsLoaded
        onClose={noop}
        onConnect={noop}
        onDisconnect={noop}
        onCancelAuthorization={noop}
        onLoadMoreTools={noop}
      />,
    );
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeTruthy();
  });

  it('does not close when a mousedown lands inside the drawer itself (not the backdrop)', async () => {
    const onClose = vi.fn();
    render(
      <ConnectorDetailDrawer
        connector={makeConnector()}
        disabled={false}
        pendingAction={null}
        authorizationCancelFailed={false}
        authorizationError={null}
        toolsPreviewLoading={false}
        toolsLoaded
        onClose={onClose}
        onConnect={noop}
        onDisconnect={noop}
        onCancelAuthorization={noop}
        onLoadMoreTools={noop}
      />,
    );
    await userEvent.click(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('hides the header tools-count chip when nothing is known about tool count yet', () => {
    render(
      <ConnectorDetailDrawer
        connector={makeConnector({ tools: [] })}
        disabled={false}
        pendingAction={null}
        authorizationCancelFailed={false}
        authorizationError={null}
        toolsPreviewLoading={false}
        toolsLoaded={false}
        onClose={noop}
        onConnect={noop}
        onDisconnect={noop}
        onCancelAuthorization={noop}
        onLoadMoreTools={noop}
      />,
    );
    expect(screen.queryByText(/tool/i, { selector: '.connector-drawer-tool-count-chip *' })).toBeNull();
  });

  it('fires onDisconnect when the inline details-section action is actually clicked', async () => {
    const onDisconnect = vi.fn();
    render(
      <ConnectorDetailDrawer
        connector={makeConnector({ status: 'connected' })}
        disabled={false}
        pendingAction={null}
        authorizationCancelFailed={false}
        authorizationError={null}
        toolsPreviewLoading={false}
        toolsLoaded
        onClose={noop}
        onConnect={noop}
        onDisconnect={onDisconnect}
        onCancelAuthorization={noop}
        onLoadMoreTools={noop}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(onDisconnect).toHaveBeenCalledWith('slack');
  });

  it('a load-more fetch in flight replaces the whole tools section with the loading message (the load-more button itself is not shown mid-fetch)', () => {
    render(
      <ConnectorDetailDrawer
        connector={makeConnector({
          toolCount: 2,
          tools: [{ name: 'a', safety: { sideEffect: 'no_side_effect' } }],
          toolsNextCursor: 'cursor-2',
        })}
        disabled={false}
        pendingAction={null}
        authorizationCancelFailed={false}
        authorizationError={null}
        toolsPreviewLoading
        toolsLoaded
        onClose={noop}
        onConnect={noop}
        onDisconnect={noop}
        onCancelAuthorization={noop}
        onLoadMoreTools={noop}
      />,
    );
    expect(screen.getByText('Loading tools…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Load more tools' })).toBeNull();
  });

  it('shows the authorization-pending status pill and tools badge in the header', () => {
    render(
      <ConnectorDetailDrawer
        connector={makeConnector({ toolCount: 4 })}
        disabled={false}
        pendingAction={null}
        authorizationPending={{}}
        authorizationCancelFailed={false}
        authorizationError={null}
        toolsPreviewLoading={false}
        toolsLoaded
        onClose={noop}
        onConnect={noop}
        onDisconnect={noop}
        onCancelAuthorization={noop}
        onLoadMoreTools={noop}
      />,
    );
    expect(screen.getAllByText('Authorization pending').length).toBeGreaterThan(0);
    expect(screen.getByText('4 tools')).toBeTruthy();
  });

  it('shows the description without an authorization block when nothing is pending', () => {
    render(
      <ConnectorDetailDrawer
        connector={makeConnector({ description: 'A great connector.' })}
        disabled={false}
        pendingAction={null}
        authorizationCancelFailed={false}
        authorizationError={null}
        toolsPreviewLoading={false}
        toolsLoaded
        onClose={noop}
        onConnect={noop}
        onDisconnect={noop}
        onCancelAuthorization={noop}
        onLoadMoreTools={noop}
      />,
    );
    expect(screen.getByText('A great connector.')).toBeTruthy();
    expect(screen.queryByText('Authorization in progress. It should finish shortly.')).toBeNull();
  });

  it('shows the in-progress authorization block (with a continue-in-browser link) when a description and pending redirect exist', async () => {
    const onOpenExternalUrl = vi.fn();
    render(
      <ConnectorDetailDrawer
        connector={makeConnector({ description: 'A great connector.' })}
        disabled={false}
        pendingAction={null}
        authorizationPending={{ redirectUrl: 'https://oauth.example.com' }}
        authorizationCancelFailed={false}
        authorizationError={null}
        toolsPreviewLoading={false}
        toolsLoaded
        onClose={noop}
        onConnect={noop}
        onDisconnect={noop}
        onCancelAuthorization={noop}
        onLoadMoreTools={noop}
        onOpenExternalUrl={onOpenExternalUrl}
      />,
    );
    expect(screen.getByText('A great connector.')).toBeTruthy();
    expect(screen.getByText('Authorization in progress. It should finish shortly.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Continue in browser' }));
    expect(onOpenExternalUrl).toHaveBeenCalledWith('https://oauth.example.com');
  });

  it('shows the authorization block without a continue link when there is no redirectUrl yet', () => {
    render(
      <ConnectorDetailDrawer
        connector={makeConnector({ description: 'A great connector.' })}
        disabled={false}
        pendingAction={null}
        authorizationPending={{}}
        authorizationCancelFailed={false}
        authorizationError={null}
        toolsPreviewLoading={false}
        toolsLoaded
        onClose={noop}
        onConnect={noop}
        onDisconnect={noop}
        onCancelAuthorization={noop}
        onLoadMoreTools={noop}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Continue in browser' })).toBeNull();
  });

  it('surfaces the cancelFailed alert', () => {
    render(
      <ConnectorDetailDrawer
        connector={makeConnector()}
        disabled={false}
        pendingAction={null}
        authorizationCancelFailed
        authorizationError={null}
        toolsPreviewLoading={false}
        toolsLoaded
        onClose={noop}
        onConnect={noop}
        onDisconnect={noop}
        onCancelAuthorization={noop}
        onLoadMoreTools={noop}
        cancelFailedMessage="Cancel didn't work"
      />,
    );
    expect(screen.getAllByRole('alert').some((el) => el.textContent?.includes("Cancel didn't work"))).toBe(true);
  });

  it('fires onDisconnect from the inline details-section action, showing a spinner while disconnecting', () => {
    const onDisconnect = vi.fn();
    render(
      <ConnectorDetailDrawer
        connector={makeConnector({ status: 'connected' })}
        disabled={false}
        pendingAction="disconnect"
        authorizationCancelFailed={false}
        authorizationError={null}
        toolsPreviewLoading={false}
        toolsLoaded
        onClose={noop}
        onConnect={noop}
        onDisconnect={onDisconnect}
        onCancelAuthorization={noop}
        onLoadMoreTools={noop}
      />,
    );
    const btn = screen.getByRole('button', { name: 'Disconnect' });
    expect(btn.getAttribute('aria-busy')).toBe('true');
  });

  it('shows the account label and last-error rows when present', () => {
    render(
      <ConnectorDetailDrawer
        connector={makeConnector({ accountLabel: 'me@example.com', lastError: 'Token expired' })}
        disabled={false}
        pendingAction={null}
        authorizationCancelFailed={false}
        authorizationError={null}
        toolsPreviewLoading={false}
        toolsLoaded
        onClose={noop}
        onConnect={noop}
        onDisconnect={noop}
        onCancelAuthorization={noop}
        onLoadMoreTools={noop}
      />,
    );
    expect(screen.getByText('me@example.com')).toBeTruthy();
    expect(screen.getByText('Token expired')).toBeTruthy();
  });

  it('shows "No tools available" when the connector genuinely has none', () => {
    render(
      <ConnectorDetailDrawer
        connector={makeConnector({ tools: [] })}
        disabled={false}
        pendingAction={null}
        authorizationCancelFailed={false}
        authorizationError={null}
        toolsPreviewLoading={false}
        toolsLoaded
        onClose={noop}
        onConnect={noop}
        onDisconnect={noop}
        onCancelAuthorization={noop}
        onLoadMoreTools={noop}
      />,
    );
    expect(screen.getByText('No tools available')).toBeTruthy();
  });

  it('shows a tool description when present, and falls back to the tool name when title is absent', () => {
    render(
      <ConnectorDetailDrawer
        connector={makeConnector({
          toolCount: 1,
          tools: [
            {
              name: 'send_message',
              description: 'Sends a chat message',
              safety: { sideEffect: 'no_side_effect' },
            },
          ],
        })}
        disabled={false}
        pendingAction={null}
        authorizationCancelFailed={false}
        authorizationError={null}
        toolsPreviewLoading={false}
        toolsLoaded
        onClose={noop}
        onConnect={noop}
        onDisconnect={noop}
        onCancelAuthorization={noop}
        onLoadMoreTools={noop}
      />,
    );
    expect(screen.getByText('Sends a chat message')).toBeTruthy();
    expect(screen.getByText('send_message', { selector: '.connector-drawer-tool-title' })).toBeTruthy();
  });

  it('fires onConnect and shows the cancel-authorization footer action while authorization is pending', async () => {
    const onConnect = vi.fn();
    const onCancelAuthorization = vi.fn();
    const { rerender } = render(
      <ConnectorDetailDrawer
        connector={makeConnector()}
        disabled={false}
        pendingAction={null}
        authorizationCancelFailed={false}
        authorizationError={null}
        toolsPreviewLoading={false}
        toolsLoaded
        onClose={noop}
        onConnect={onConnect}
        onDisconnect={noop}
        onCancelAuthorization={onCancelAuthorization}
        onLoadMoreTools={noop}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(onConnect).toHaveBeenCalledWith('slack');

    rerender(
      <ConnectorDetailDrawer
        connector={makeConnector()}
        disabled={false}
        pendingAction={null}
        authorizationPending={{}}
        authorizationCancelFailed={false}
        authorizationError={null}
        toolsPreviewLoading={false}
        toolsLoaded
        onClose={noop}
        onConnect={onConnect}
        onDisconnect={noop}
        onCancelAuthorization={onCancelAuthorization}
        onLoadMoreTools={noop}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Cancel authorization' }));
    expect(onCancelAuthorization).toHaveBeenCalledWith('slack');
  });

  it('surfaces an authorizationError alert', () => {
    render(
      <ConnectorDetailDrawer
        connector={makeConnector()}
        disabled={false}
        pendingAction={null}
        authorizationCancelFailed={false}
        authorizationError="Something went wrong"
        toolsPreviewLoading={false}
        toolsLoaded
        onClose={noop}
        onConnect={noop}
        onDisconnect={noop}
        onCancelAuthorization={noop}
        onLoadMoreTools={noop}
      />,
    );
    expect(screen.getAllByRole('alert')[0]!.textContent).toContain('Something went wrong');
  });
});
