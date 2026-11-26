import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithUmKit } from '../../__tests__/fake-um-kit.js';
import { ADD_PROVIDER_PART, EmailProviderTab, segmentLabel } from '../EmailProviderTab.js';
import type { EmailProviderControl, EmailProviderView, EmailProviderChoice, EmailStatusShape } from '../email-view.types.js';
import { fakeCopy, fakeEmailKit, fakeProviderControl, fakeRules, savedProvider } from './email-fakes.js';

afterEach(cleanup);

function renderTab(controller: EmailProviderControl<EmailProviderView, EmailProviderChoice>, extra: { selectedId?: string; onSelect?: (id: string) => void } = {}) {
  return renderWithUmKit(
    <EmailProviderTab controller={controller} status={null} locale="en" kit={fakeEmailKit<EmailStatusShape>()} copy={fakeCopy} rules={fakeRules()} {...extra} />,
  );
}

describe('EmailProviderTab secrets', () => {
  it('a saved key is never echoed in status, placeholder or notice', () => {
    const typed = 'sk-typed-0123456789';
    const controller = fakeProviderControl({
      drafts: { relay: { token: typed } },
      notice: { providerId: 'relay', tone: 'ok', text: 'Key saved.' },
    });
    const { container } = renderTab(controller);
    const input = screen.getByLabelText('API key', { selector: 'input' }) as HTMLInputElement;
    expect(input.value).toBe(typed);
    expect(input.placeholder).toBe('Saved — enter a new key to replace it');
    expect(input.getAttribute('autocomplete')).toBe('new-password');
    expect(screen.getByRole('status').textContent).toBe('Key saved.');
    expect(container.textContent).not.toContain(typed);
  });

  it('with no draft the saved key field stays empty', () => {
    renderTab(fakeProviderControl());
    expect((screen.getByLabelText('API key', { selector: 'input' }) as HTMLInputElement).value).toBe('');
    expect(screen.getByText('Key updated {when}'.replace('{when}', 'when:2026-11-01T00:00:00Z'))).toBeTruthy();
  });

  it('typing writes only through setDraftField', () => {
    const setDraftField = vi.fn();
    renderTab(fakeProviderControl({ setDraftField }));
    fireEvent.change(screen.getByLabelText('API key', { selector: 'input' }), { target: { value: 'new' } });
    expect(setDraftField).toHaveBeenCalledWith('relay', 'token', 'new');
  });

  it('adding a provider selects the id the controller returns, via rules.displayName', async () => {
    const onSelect = vi.fn();
    const addProvider = vi.fn(async () => 'mailer');
    renderTab(fakeProviderControl({ choices: [{ pluginId: 'mailer', description: 'A mailer' }], addProvider }), { selectedId: ADD_PROVIDER_PART, onSelect });
    expect(screen.getByText('plugin:mailer')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await vi.waitFor(() => expect(onSelect).toHaveBeenCalledWith('mailer'));
    expect(addProvider).toHaveBeenCalledWith({ pluginId: 'mailer' });
  });

  it('segment labels drop one trailing parenthetical', () => {
    expect(segmentLabel({ label: savedProvider.label })).toBe('Relay');
    expect(segmentLabel({ label: '(only)' })).toBe('(only)');
  });
});
