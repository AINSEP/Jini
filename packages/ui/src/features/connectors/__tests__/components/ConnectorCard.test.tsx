import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConnectorCard } from '../../components/ConnectorCard.js';
import type { Connector } from '../../types.js';

function makeConnector(overrides: Partial<Connector> = {}): Connector {
  return { id: 'slack', name: 'Slack', provider: 'Composio', category: 'communication', status: 'available', tools: [], ...overrides };
}

const noop = () => {};

describe('ConnectorCard', () => {
  it('shows a connect action for an available connector and fires onConnect', async () => {
    const onConnect = vi.fn();
    render(
      <ConnectorCard
        connector={makeConnector()}
        pendingAction={null}
        authorizationCancelFailed={false}
        toolsLoaded={false}
        onConnect={onConnect}
        onDisconnect={noop}
        onCancelAuthorization={noop}
        onOpenDetails={noop}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(onConnect).toHaveBeenCalledWith('slack');
  });

  it('shows a disconnect action + status dot for a connected connector', () => {
    render(
      <ConnectorCard
        connector={makeConnector({ status: 'connected' })}
        pendingAction={null}
        authorizationCancelFailed={false}
        toolsLoaded={false}
        onConnect={noop}
        onDisconnect={noop}
        onCancelAuthorization={noop}
        onOpenDetails={noop}
      />,
    );
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeTruthy();
  });

  it('shows a cancel-authorization action while authorization is pending, and a continue-in-browser link when a redirectUrl exists', async () => {
    const onCancel = vi.fn();
    const onOpenExternalUrl = vi.fn();
    render(
      <ConnectorCard
        connector={makeConnector()}
        pendingAction={null}
        authorizationPending={{ redirectUrl: 'https://oauth.example.com' }}
        authorizationCancelFailed={false}
        toolsLoaded={false}
        onConnect={noop}
        onDisconnect={noop}
        onCancelAuthorization={onCancel}
        onOpenDetails={noop}
        onOpenExternalUrl={onOpenExternalUrl}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Cancel authorization' }));
    expect(onCancel).toHaveBeenCalledWith('slack');

    await userEvent.click(screen.getByRole('button', { name: 'Continue in browser' }));
    expect(onOpenExternalUrl).toHaveBeenCalledWith('https://oauth.example.com');
  });

  it('shows the cancel-failed hint when cancellation previously failed', () => {
    render(
      <ConnectorCard
        connector={makeConnector()}
        pendingAction={null}
        authorizationCancelFailed
        toolsLoaded={false}
        onConnect={noop}
        onDisconnect={noop}
        onCancelAuthorization={noop}
        onOpenDetails={noop}
        cancelFailedMessage="Try again please"
      />,
    );
    expect(screen.getByRole('alert').textContent).toContain('Try again please');
  });

  it('disables actions and hides them from the tab order when disabled/locked', () => {
    render(
      <ConnectorCard
        connector={makeConnector()}
        disabled
        pendingAction={null}
        authorizationCancelFailed={false}
        toolsLoaded={false}
        onConnect={noop}
        onDisconnect={noop}
        onCancelAuthorization={noop}
        onOpenDetails={noop}
      />,
    );
    expect((screen.getByRole('button', { name: 'Connect' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Open details for Slack' }).getAttribute('tabIndex')).toBe('-1');
  });

  it('disables the disconnect action and hides it from the tab order when disabled/locked', () => {
    render(
      <ConnectorCard
        connector={makeConnector({ status: 'connected' })}
        disabled
        pendingAction={null}
        authorizationCancelFailed={false}
        toolsLoaded={false}
        onConnect={noop}
        onDisconnect={noop}
        onCancelAuthorization={noop}
        onOpenDetails={noop}
      />,
    );
    const btn = screen.getByRole('button', { name: 'Disconnect' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('tabIndex')).toBe('-1');
  });

  it('opens details on click and on Enter/Space when focused directly on the card', async () => {
    const onOpenDetails = vi.fn();
    render(
      <ConnectorCard
        connector={makeConnector()}
        pendingAction={null}
        authorizationCancelFailed={false}
        toolsLoaded={false}
        onConnect={noop}
        onDisconnect={noop}
        onCancelAuthorization={noop}
        onOpenDetails={onOpenDetails}
      />,
    );
    const card = screen.getByRole('button', { name: 'Open details for Slack' });
    await userEvent.click(card);
    expect(onOpenDetails).toHaveBeenCalledWith('slack');

    onOpenDetails.mockClear();
    card.focus();
    await userEvent.keyboard('{Enter}');
    expect(onOpenDetails).toHaveBeenCalledWith('slack');
  });

  it('shows an error/disabled status pill for those statuses', () => {
    render(
      <ConnectorCard
        connector={makeConnector({ status: 'error' })}
        pendingAction={null}
        authorizationCancelFailed={false}
        toolsLoaded={false}
        onConnect={noop}
        onDisconnect={noop}
        onCancelAuthorization={noop}
        onOpenDetails={noop}
      />,
    );
    expect(screen.getByText('Error')).toBeTruthy();
  });

  it('shows a spinner and aria-busy on the connect action while connecting', () => {
    render(
      <ConnectorCard
        connector={makeConnector()}
        pendingAction="connect"
        authorizationCancelFailed={false}
        toolsLoaded={false}
        onConnect={noop}
        onDisconnect={noop}
        onCancelAuthorization={noop}
        onOpenDetails={noop}
      />,
    );
    const btn = screen.getByRole('button', { name: 'Connect' });
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(btn.className).toContain('is-loading');
  });

  it('shows an authorization-pending status dot and a busy connect action while authorization is pending', () => {
    render(
      <ConnectorCard
        connector={makeConnector()}
        pendingAction={null}
        authorizationPending={{}}
        authorizationCancelFailed={false}
        toolsLoaded={false}
        onConnect={noop}
        onDisconnect={noop}
        onCancelAuthorization={noop}
        onOpenDetails={noop}
      />,
    );
    expect(screen.getByRole('img', { name: 'Authorization pending' })).toBeTruthy();
    const btn = screen.getByRole('button', { name: 'Authorization pending' });
    expect(btn.getAttribute('aria-busy')).toBe('true');
  });

  it('shows aria-busy on the disconnect action while disconnecting', () => {
    render(
      <ConnectorCard
        connector={makeConnector({ status: 'connected' })}
        pendingAction="disconnect"
        authorizationCancelFailed={false}
        toolsLoaded={false}
        onConnect={noop}
        onDisconnect={noop}
        onCancelAuthorization={noop}
        onOpenDetails={noop}
      />,
    );
    const btn = screen.getByRole('button', { name: 'Disconnect' });
    expect(btn.getAttribute('aria-busy')).toBe('true');
  });

  it('fires onDisconnect when the disconnect action is clicked', async () => {
    const onDisconnect = vi.fn();
    render(
      <ConnectorCard
        connector={makeConnector({ status: 'connected' })}
        pendingAction={null}
        authorizationCancelFailed={false}
        toolsLoaded={false}
        onConnect={noop}
        onDisconnect={onDisconnect}
        onCancelAuthorization={noop}
        onOpenDetails={noop}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(onDisconnect).toHaveBeenCalledWith('slack');
  });

  it('does not open details when the card is clicked while disabled', async () => {
    const onOpenDetails = vi.fn();
    render(
      <ConnectorCard
        connector={makeConnector()}
        disabled
        pendingAction={null}
        authorizationCancelFailed={false}
        toolsLoaded={false}
        onConnect={noop}
        onDisconnect={noop}
        onCancelAuthorization={noop}
        onOpenDetails={onOpenDetails}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Open details for Slack' }));
    expect(onOpenDetails).not.toHaveBeenCalled();
  });

  it('opens details on Space as well as Enter', async () => {
    const onOpenDetails = vi.fn();
    render(
      <ConnectorCard
        connector={makeConnector()}
        pendingAction={null}
        authorizationCancelFailed={false}
        toolsLoaded={false}
        onConnect={noop}
        onDisconnect={noop}
        onCancelAuthorization={noop}
        onOpenDetails={onOpenDetails}
      />,
    );
    screen.getByRole('button', { name: 'Open details for Slack' }).focus();
    await userEvent.keyboard(' ');
    expect(onOpenDetails).toHaveBeenCalledWith('slack');
  });

  it('ignores a key event whose target is a nested (non-propagation-stopping) child rather than the card itself', () => {
    const onOpenDetails = vi.fn();
    const { container } = render(
      <ConnectorCard
        connector={makeConnector()}
        pendingAction={null}
        authorizationCancelFailed={false}
        toolsLoaded={false}
        onConnect={noop}
        onDisconnect={noop}
        onCancelAuthorization={noop}
        onOpenDetails={onOpenDetails}
      />,
    );
    // The title text itself has no `stop`-wired listener of its own, so a
    // keydown dispatched there genuinely bubbles up to the card's
    // `onKeyDown` with `event.target` still the nested title span, distinct
    // from `event.currentTarget` (the card) — unlike the actual interactive
    // buttons, which all stop propagation before it would ever reach here.
    const titleSpan = container.querySelector('.connector-card-title-name')!;
    titleSpan.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onOpenDetails).not.toHaveBeenCalled();
  });

  it('ignores a keydown for a key other than Enter/Space when focused directly on the card', async () => {
    const onOpenDetails = vi.fn();
    render(
      <ConnectorCard
        connector={makeConnector()}
        pendingAction={null}
        authorizationCancelFailed={false}
        toolsLoaded={false}
        onConnect={noop}
        onDisconnect={noop}
        onCancelAuthorization={noop}
        onOpenDetails={onOpenDetails}
      />,
    );
    screen.getByRole('button', { name: 'Open details for Slack' }).focus();
    await userEvent.keyboard('a');
    expect(onOpenDetails).not.toHaveBeenCalled();
  });

  it('shows the tools badge once tool count is known', () => {
    render(
      <ConnectorCard
        connector={makeConnector({ toolCount: 3 })}
        pendingAction={null}
        authorizationCancelFailed={false}
        toolsLoaded={false}
        onConnect={noop}
        onDisconnect={noop}
        onCancelAuthorization={noop}
        onOpenDetails={noop}
      />,
    );
    expect(screen.getByText('3 tools')).toBeTruthy();
  });

  it('renders a category label through getCategoryLabel when provided', () => {
    render(
      <ConnectorCard
        connector={makeConnector({ category: 'crm' })}
        pendingAction={null}
        authorizationCancelFailed={false}
        toolsLoaded={false}
        onConnect={noop}
        onDisconnect={noop}
        onCancelAuthorization={noop}
        onOpenDetails={noop}
        getCategoryLabel={(c) => c.toUpperCase()}
      />,
    );
    expect(screen.getByText('CRM')).toBeTruthy();
  });
});
