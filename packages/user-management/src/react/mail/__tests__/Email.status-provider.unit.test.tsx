import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithUmKit } from '../../__tests__/fake-um-kit.js';
import { Email, type EmailProps } from '../Email.js';
import { CAPABILITIES_PART } from '../EmailProviderTab.js';
import type { EmailStatusControl, EmailStatusShape, EmailStatusView, EmailTabHooks, EmailTypes } from '../email-view.types.js';
import { fakeCopy, fakeEmailKit, fakeProviderControl, fakeRules } from './email-fakes.js';

afterEach(cleanup);

type T = EmailTypes & { status: EmailStatusShape; overview: { o: 1 }; sender: { s: 1 }; templates: { t: 1 }; activity: { a: 1 } };

function setup(required: { view: EmailStatusView<EmailStatusShape>; tabId: EmailProps<T>['tabId']; part?: string }) {
  const status: EmailStatusControl<EmailStatusShape> = { view: required.view, locale: 'en', retry: vi.fn() };
  const tabHooks: EmailTabHooks<T> = {
    overview: vi.fn(() => ({ o: 1 as const })),
    provider: vi.fn(() => fakeProviderControl()),
    sender: vi.fn(() => ({ s: 1 as const })),
    templates: vi.fn(() => ({ t: 1 as const })),
    activity: vi.fn(() => ({ a: 1 as const })),
  };
  const navigate = vi.fn();
  renderWithUmKit(<Email<T> useEmailHook={() => status} tabHooks={tabHooks} useAdminThemeBoundaryHook={() => ({})}
    parts={{
      Overview: (p) => <div data-testid="part-overview" data-part={p.part} />,
      Sender: (p) => <div data-testid="part-sender" data-warnings={(p.warnings ?? []).join(',')} />,
      Activity: () => <div data-testid="part-activity" />,
      Templates: () => <div data-testid="part-templates" />,
    }}
    kit={fakeEmailKit<EmailStatusShape>()} copy={fakeCopy} rules={fakeRules()} navigate={navigate}
    tabId={required.tabId} {...(required.part === undefined ? {} : { part: required.part })} />);
  return { status, tabHooks, navigate };
}

describe('Email status summary', () => {
  it('offers a retry when the status read failed', () => {
    const { status } = setup({ view: { kind: 'error' }, tabId: null });
    const alert = screen.getByRole('alert');
    expect(within(alert).getByText('Status unavailable').getAttribute('data-tone')).toBe('warning');
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(status.retry).toHaveBeenCalledTimes(1);
  });

  it('says so while loading, and when the caller may not read the status', () => {
    setup({ view: { kind: 'loading' }, tabId: null });
    expect(screen.getByText('Loading email status…').getAttribute('role')).toBe('status');
    cleanup();
    setup({ view: { kind: 'forbidden' }, tabId: null });
    expect(screen.getByText("You don't have permission to view email status.")).toBeTruthy();
  });

  it('hands the Sender part no warnings until the status has loaded', () => {
    setup({ view: { kind: 'loading' }, tabId: 'sender' });
    expect(screen.getByTestId('part-sender').getAttribute('data-warnings')).toBe('');
    cleanup();
    setup({ view: { kind: 'loaded', status: {} }, tabId: 'sender' });
    expect(screen.getByTestId('part-sender').getAttribute('data-warnings')).toBe('');
  });

  it('navigates section picks within the overview and sender tabs', () => {
    const overview = setup({ view: { kind: 'loaded', status: {} }, tabId: 'overview' });
    fireEvent.click(screen.getByRole('radio', { name: 'Send test email' }));
    expect(overview.navigate).toHaveBeenCalledWith({ tabId: 'overview', part: 'test' });
    cleanup();
    const sender = setup({ view: { kind: 'loaded', status: {} }, tabId: 'sender' });
    fireEvent.click(screen.getByRole('radio', { name: 'DNS' }));
    expect(sender.navigate).toHaveBeenCalledWith({ tabId: 'sender', part: 'dns' });
  });
});

describe('Email provider tab', () => {
  const lanes = [{ lane: 'transactional' as const, providerId: 'relay', state: 'ready' }];

  it('wires the provider hook to re-read the status and shows the loaded lanes under Capabilities', () => {
    const { status, tabHooks } = setup({ view: { kind: 'loaded', status: { lanes } }, tabId: 'provider', part: CAPABILITIES_PART });
    expect(tabHooks.provider).toHaveBeenCalledWith({ onChanged: status.retry });
    expect(screen.getByText('Transactional mail')).toBeTruthy();
    expect(screen.getByText('label:relay')).toBeTruthy();
  });

  it('shows no lanes while the status is not loaded, and navigates a segment pick within the provider tab', () => {
    const { navigate } = setup({ view: { kind: 'error' }, tabId: 'provider', part: CAPABILITIES_PART });
    expect(screen.queryByText('Transactional mail')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Relay' }));
    expect(navigate).toHaveBeenCalledWith({ tabId: 'provider', part: 'relay' });
  });
});
