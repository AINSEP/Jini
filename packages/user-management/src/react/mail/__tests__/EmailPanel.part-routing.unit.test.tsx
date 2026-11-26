import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithUmKit } from '../../__tests__/fake-um-kit.js';
import { Email, type EmailProps } from '../Email.js';
import type { EmailStatusControl, EmailTabHooks, EmailTypes } from '../email-view.types.js';
import { fakeCopy, fakeEmailKit, fakeProviderControl, fakeRules } from './email-fakes.js';

afterEach(cleanup);

type Status = { warnings?: readonly string[]; lanes?: []; domain: string };
type T = EmailTypes & { status: Status; overview: { o: 1 }; sender: { s: 1 }; templates: { t: 1 }; activity: { a: 1 } };

function setup(overrides: Partial<EmailProps<T>> = {}) {
  const status: EmailStatusControl<Status> = { view: { kind: 'loaded', status: { warnings: ['w1'], domain: 'mail.example.test' } }, locale: 'en', retry: vi.fn() };
  const tabHooks: EmailTabHooks<T> = {
    overview: vi.fn(() => ({ o: 1 as const })),
    provider: vi.fn(() => fakeProviderControl()),
    sender: vi.fn(() => ({ s: 1 as const })),
    templates: vi.fn(() => ({ t: 1 as const })),
    activity: vi.fn(() => ({ a: 1 as const })),
  };
  const navigate = vi.fn();
  const props: EmailProps<T> = {
    useEmailHook: () => status,
    tabHooks,
    useAdminThemeBoundaryHook: () => ({ 'data-theme-boundary': 'yes' }),
    parts: {
      Overview: (p) => <div data-testid="part-overview" data-part={p.part} />,
      Sender: (p) => <div data-testid="part-sender" data-part={p.part} data-warnings={(p.warnings ?? []).join(',')} />,
      Activity: (p) => <div data-testid="part-activity" data-part={p.part} />,
      Templates: () => <div data-testid="part-templates" />,
    },
    kit: fakeEmailKit<Status>(),
    copy: fakeCopy,
    rules: fakeRules(),
    navigate,
    ...overrides,
  };
  renderWithUmKit(<Email<T> {...props} />);
  return { tabHooks, navigate, status };
}

describe('Email part routing', () => {
  it('?tab=sender&p=dns renders parts.Sender with part "dns"', () => {
    setup({ tabId: 'sender', part: 'dns' });
    const sender = screen.getByTestId('part-sender');
    expect(sender.getAttribute('data-part')).toBe('dns');
    expect(sender.getAttribute('data-warnings')).toBe('w1');
    expect(screen.getByRole('radio', { name: 'DNS' }).getAttribute('aria-checked')).toBe('true');
  });

  it('an unknown p falls back to the first section', () => {
    setup({ tabId: 'activity', part: 'nope' });
    expect(screen.getByTestId('part-activity').getAttribute('data-part')).toBe('sends');
  });

  it('switching a section calls navigate with the active tab and the part', () => {
    const { navigate } = setup({ tabId: 'activity', part: 'sends' });
    fireEvent.click(screen.getByRole('radio', { name: 'Blocked addresses' }));
    expect(navigate).toHaveBeenCalledWith({ tabId: 'activity', part: 'blocked' });
  });

  it('switching a tab navigates with no part, and an unknown tab id is ignored', () => {
    const { navigate } = setup({ tabId: 'overview' });
    fireEvent.click(screen.getByRole('tab', { name: 'Templates' }));
    expect(navigate).toHaveBeenCalledWith({ tabId: 'templates', part: null });
    fireEvent.click(screen.getByRole('button', { name: 'bogus tab' }));
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("only the active tab's hook is called", () => {
    const { tabHooks } = setup({ tabId: 'templates' });
    expect(tabHooks.templates).toHaveBeenCalledWith({ newName: 'Untitled email' });
    expect(tabHooks.overview).not.toHaveBeenCalled();
    expect(tabHooks.provider).not.toHaveBeenCalled();
    expect(tabHooks.sender).not.toHaveBeenCalled();
    expect(tabHooks.activity).not.toHaveBeenCalled();
    expect(screen.getByTestId('part-templates')).toBeTruthy();
  });

  it('status summary uses rules.summarize and kit.StatusFacts', () => {
    const summarize = vi.fn(() => 'needs_attention' as const);
    setup({ tabId: null, rules: fakeRules({ summarize }) });
    expect(summarize).toHaveBeenCalledWith({ status: { warnings: ['w1'], domain: 'mail.example.test' } });
    const chip = screen.getByText('Needs attention');
    expect(chip.getAttribute('data-tone')).toBe('warning');
    expect(screen.getByText('facts:{"warnings":["w1"],"domain":"mail.example.test"}')).toBeTruthy();
    expect(screen.queryByTestId('part-overview')).toBeNull();
  });

  it('the header uses the navigation dictionary and the theme boundary wraps the sections', () => {
    const { container } = { container: document.body };
    setup({ tabId: 'overview', part: 'uses' });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('nav:Email');
    expect(container.querySelector('[data-theme-boundary="yes"] [data-testid="part-overview"]')?.getAttribute('data-part')).toBe('uses');
  });
});
