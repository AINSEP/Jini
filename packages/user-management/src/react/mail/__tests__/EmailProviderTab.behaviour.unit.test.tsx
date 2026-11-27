import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithUmKit } from '../../__tests__/fake-um-kit.js';
import { ADD_PROVIDER_PART, CAPABILITIES_PART, EmailProviderTab, segmentLabel, shownProviderId } from '../EmailProviderTab.js';
import type { EmailProviderChoice, EmailProviderControl, EmailProviderView, EmailStatusShape } from '../email-view.types.js';
import { fakeCopy, fakeEmailKit, fakeProviderControl, fakeRules, savedProvider } from './email-fakes.js';

afterEach(cleanup);

type Control = EmailProviderControl<EmailProviderView, EmailProviderChoice>;

/** A provider with only non-secret fields, no saved key, one lane and no hosting. */
const smtp: EmailProviderView = {
  id: 'smtp', label: 'SMTP', hosted: false, lanes: ['bulk'], selectable: true,
  credential: { required: true, saved: false },
  setup: {
    fields: [
      { key: 'username', label: 'User', type: 'text', defaultValue: 'mailer', help: 'The SMTP login.' },
      { key: 'baseUrl', label: 'Server', type: 'url', placeholder: 'https://smtp.example.test' },
    ],
    helpUrl: 'https://docs.example.test/smtp',
  },
};
const consoleProvider: EmailProviderView = {
  id: 'console', label: 'Console (local)', hosted: false, lanes: [], selectable: false, refusal: 'not configured',
  credential: { required: false, saved: false }, setup: { fields: [] },
};

function loaded(providers: readonly EmailProviderView[], refusals: readonly string[] = []): Control['view'] {
  return { kind: 'loaded', data: { providers, refusals } };
}

function renderTab(controller: Control, extra: { selectedId?: string | null; onSelect?: (id: string) => void; status?: EmailStatusShape | null } = {}) {
  const { status = null, ...rest } = extra;
  return renderWithUmKit(
    <EmailProviderTab controller={controller} status={status} locale="en" kit={fakeEmailKit<EmailStatusShape>()} copy={fakeCopy} rules={fakeRules()} {...rest} />,
  );
}

const chips = () => screen.queryAllByText((_, el) => el?.getAttribute('data-fake') === 'Chip').map((el) => `${el.getAttribute('data-tone')}:${el.textContent}`);

describe('shownProviderId', () => {
  const isFullyActive = ({ provider }: { provider: Pick<EmailProviderView, 'lanes'> }) => provider.lanes.length === 2;
  it('prefers the selected id, then the fully active provider, then a partly active one, then the first', () => {
    expect(shownProviderId({ providers: [consoleProvider, smtp, savedProvider], selectedId: 'smtp', isFullyActive })).toBe('smtp');
    expect(shownProviderId({ providers: [consoleProvider, smtp, savedProvider], selectedId: 'gone', isFullyActive })).toBe('relay');
    expect(shownProviderId({ providers: [consoleProvider, smtp], selectedId: null, isFullyActive })).toBe('smtp');
    expect(shownProviderId({ providers: [consoleProvider], selectedId: undefined, isFullyActive })).toBe('console');
    expect(shownProviderId({ providers: [], selectedId: undefined, isFullyActive })).toBeUndefined();
  });
});

describe('segmentLabel', () => {
  it('keeps a label whose closing parenthesis has no opening one, or encloses another closing one', () => {
    expect(segmentLabel({ label: 'Relay)' })).toBe('Relay)');
    expect(segmentLabel({ label: 'Mail (a) b)' })).toBe('Mail (a) b)');
    expect(segmentLabel({ label: 'Mail (local)  ' })).toBe('Mail');
  });
});

describe('EmailProviderTab provider card', () => {
  it('renders plain fields with their declared type, default placeholder and help, and saves the key on submit', () => {
    const saveKey = vi.fn(async () => undefined);
    const askSwitch = vi.fn();
    renderTab(fakeProviderControl({ view: loaded([smtp]), saveKey, askSwitch, drafts: { smtp: { username: 'ops' } } }));
    expect(chips()).toEqual(['ok:Active for one lane', 'warning:Key not saved', 'neutral:Local only']);
    const user = screen.getByLabelText('User') as HTMLInputElement;
    expect([user.type, user.value, user.placeholder, user.getAttribute('autocomplete')]).toEqual(['text', 'ops', 'mailer', 'off']);
    const server = screen.getByLabelText('Server') as HTMLInputElement;
    expect([server.type, server.value, server.placeholder]).toEqual(['url', '', 'https://smtp.example.test']);
    expect(screen.getByText('The SMTP login.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Where do I get a key?' }).getAttribute('href')).toBe('https://docs.example.test/smtp');
    expect(screen.queryByText(/Key updated/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save key' }));
    expect(saveKey).toHaveBeenCalledWith(smtp);
    fireEvent.click(screen.getByRole('button', { name: 'Use this provider' }));
    expect(askSwitch).toHaveBeenCalledWith(smtp);
  });

  it('disables save and switch while that provider is busy', () => {
    renderTab(fakeProviderControl({ view: loaded([smtp]), busyId: 'smtp' }));
    expect((screen.getByRole('button', { name: 'Save key' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Use this provider' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('hides the key form and switch for a fully active hosted provider, and shows its error notice as an alert', () => {
    renderTab(fakeProviderControl({ notice: { providerId: 'relay', tone: 'error', text: 'Save failed.' } }));
    expect(chips()).toEqual(['ok:Active', 'ok:Key saved']);
    expect(screen.getByRole('button', { name: 'Replace key' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Use this provider' })).toBeNull();
    const alert = screen.getByRole('alert');
    expect([alert.textContent, alert.className]).toEqual(['Save failed.', 'jini-field-error']);
  });

  it('ignores a notice for another provider', () => {
    renderTab(fakeProviderControl({ notice: { providerId: 'smtp', tone: 'ok', text: 'Key saved.' } }));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('explains why an unselectable provider cannot be used', () => {
    const keyless: EmailProviderView = { ...smtp, selectable: false, refusal: 'missing key' };
    const { unmount } = renderTab(fakeProviderControl({ view: loaded([keyless]) }));
    expect(screen.getByText("Add this provider's key first.")).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Use this provider' }) as HTMLButtonElement).disabled).toBe(true);
    unmount();
    renderTab(fakeProviderControl({ view: loaded([consoleProvider]) }));
    expect(screen.getByText('Not set up')).toBeTruthy();
    expect(chips()).toEqual(['neutral:Local only']);
    expect(screen.queryByRole('button', { name: /key/i })).toBeNull();
  });

  it('lists refusals under Not loaded, and shows the add warning', () => {
    renderTab(fakeProviderControl({ view: loaded([savedProvider], ['plugin x failed']), addWarning: 'Enabled, restart pending.' }));
    expect(screen.getByRole('heading', { name: 'Not loaded' })).toBeTruthy();
    expect(screen.getByText('plugin x failed')).toBeTruthy();
    expect(screen.getByText('Enabled, restart pending.').getAttribute('role')).toBe('status');
  });

  it('routes segment clicks to onSelect, and tolerates a missing onSelect', () => {
    const onSelect = vi.fn();
    const { unmount } = renderTab(fakeProviderControl({ view: loaded([savedProvider, smtp]) }), { onSelect });
    fireEvent.click(screen.getByRole('radio', { name: 'SMTP' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Capabilities' }));
    expect(onSelect.mock.calls).toEqual([['smtp'], [CAPABILITIES_PART]]);
    unmount();
    renderTab(fakeProviderControl({ view: loaded([savedProvider, smtp]) }));
    fireEvent.click(screen.getByRole('radio', { name: 'SMTP' }));
    expect(screen.getByRole('radio', { name: 'Relay' }).getAttribute('aria-checked')).toBe('true');
  });
});

describe('EmailProviderTab capabilities', () => {
  it('shows each lane with its provider label and readiness, falling back to the raw state', () => {
    const status: EmailStatusShape = { lanes: [
      { lane: 'transactional', providerId: 'relay', state: 'ready' },
      { lane: 'bulk', providerId: null, state: 'paused' },
    ] };
    const { container } = renderTab(fakeProviderControl(), { selectedId: CAPABILITIES_PART, status });
    expect([...container.querySelectorAll('dt')].map((dt) => dt.textContent)).toEqual(['Transactional mail', 'Bulk mail']);
    expect([...container.querySelectorAll('dd')].map((dd) => dd.textContent)).toEqual(['label:relayReady', 'label:nonepaused']);
    expect(chips()).toEqual(['ok:Ready', 'neutral:paused']);
    expect(container.querySelector('li.email-provider')).toBeNull();
  });

  it('renders no facts without a status or without lanes', () => {
    const { container, unmount } = renderTab(fakeProviderControl(), { selectedId: CAPABILITIES_PART });
    expect(container.querySelector('dl')).toBeNull();
    unmount();
    const again = renderTab(fakeProviderControl(), { selectedId: CAPABILITIES_PART, status: { lanes: [] } });
    expect(again.container.querySelector('dl')).toBeNull();
  });
});

describe('EmailProviderTab add provider', () => {
  it('falls back to Add provider when nothing is installed, and shows loading until choices arrive', () => {
    renderTab(fakeProviderControl({ view: loaded([]), choices: null }));
    expect(screen.getByRole('status').textContent).toBe('Loading…');
    expect(screen.getByRole('radio', { name: '+ Add provider' }).getAttribute('aria-checked')).toBe('true');
  });

  it('says when no providers are left to add', () => {
    renderTab(fakeProviderControl({ choices: [] }), { selectedId: ADD_PROVIDER_PART });
    expect(screen.getByText('No more email providers to add.')).toBeTruthy();
  });

  it('marks the plugin being added and disables every Add meanwhile, preferring the summary', () => {
    renderTab(fakeProviderControl({ adding: 'b', choices: [{ pluginId: 'a', summary: 'Short A', description: 'Long A' }, { pluginId: 'b', description: 'Long B' }] }), { selectedId: ADD_PROVIDER_PART });
    expect(screen.getByText('Short A')).toBeTruthy();
    expect(screen.queryByText('Long A')).toBeNull();
    expect(screen.getByText('Long B')).toBeTruthy();
    const buttons = [screen.getByRole('button', { name: 'Add' }), screen.getByRole('button', { name: 'Adding…' })] as HTMLButtonElement[];
    expect(buttons.map((b) => b.disabled)).toEqual([true, true]);
  });

  it('retries a failed add and selects the provider it returns, but selects nothing when the retry yields no id', async () => {
    const onSelect = vi.fn();
    const retryAdd = vi.fn<() => Promise<string | undefined>>().mockResolvedValueOnce('mailer').mockResolvedValueOnce(undefined);
    renderTab(fakeProviderControl({ addError: 'Could not enable.', choices: null, retryAdd }), { selectedId: ADD_PROVIDER_PART, onSelect });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Could not enable.');
    expect(screen.queryByText('Loading…')).toBeNull();
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    await vi.waitFor(() => expect(onSelect).toHaveBeenCalledWith('mailer'));
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    await vi.waitFor(() => expect(retryAdd).toHaveBeenCalledTimes(2));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('disables Retry while an add is in flight', () => {
    renderTab(fakeProviderControl({ addError: 'Could not enable.', adding: 'a', choices: [] }), { selectedId: ADD_PROVIDER_PART });
    expect((screen.getByRole('button', { name: 'Retry' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText('No more email providers to add.')).toBeNull();
  });
});

describe('EmailProviderTab switch confirmation', () => {
  it('names the provider, confirms the switch and cancels back to no pending switch', () => {
    const confirmSwitch = vi.fn(async () => undefined);
    const askSwitch = vi.fn();
    renderTab(fakeProviderControl({ pendingSwitch: smtp, confirmSwitch, askSwitch, view: loaded([savedProvider, smtp]) }));
    const dialog = screen.getByRole('dialog', { name: 'Switch email provider?' });
    expect(dialog.textContent).toContain('All email — sign-in links, confirmations, notifications and newsletters — will send with SMTP.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Switch' }));
    expect(confirmSwitch).toHaveBeenCalledTimes(1);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(askSwitch).toHaveBeenCalledWith(null);
  });

  it('holds the dialog pending while the chosen provider is busy, and stays closed without a pending switch', () => {
    const { unmount } = renderTab(fakeProviderControl({ pendingSwitch: smtp, busyId: 'smtp', view: loaded([smtp]) }));
    expect((within(screen.getByRole('dialog')).getByRole('button', { name: 'Switch' }) as HTMLButtonElement).disabled).toBe(true);
    unmount();
    renderTab(fakeProviderControl());
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
