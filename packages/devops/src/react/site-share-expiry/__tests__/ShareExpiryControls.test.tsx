// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { ShareExpiryControls } from '../index.js';

it('active link without expiry untouched', () => {
  const change = vi.fn();
  const html = renderToStaticMarkup(<ShareExpiryControls useShareExpiry={() => ({ change, acknowledge: vi.fn(), setShowExpired: vi.fn() })} kit={{ Button: 'button', Select: 'select' }} copy={{ never: 'Never', days: days => `${days} days`, expired: 'Expired', showExpired: 'Show expired', acknowledge: 'Acknowledge' }} choices={[]} status="active" />);
  expect(html).toContain('<option value="never" selected="">Never</option>');
  expect(html).not.toContain('<p>Expired</p>');
  expect(html).toContain('checked=""');
  expect(html.match(/<option /g)).toHaveLength(1);
  expect(change).not.toHaveBeenCalled();
});
it('acknowledge after expiry keeps it expired', async () => {
  const acknowledge = vi.fn(), container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => root.render(<ShareExpiryControls useShareExpiry={() => ({ change: vi.fn(), acknowledge, setShowExpired: vi.fn() })} kit={{ Button: 'button', Select: 'select' }} copy={{ never: 'Never', days: days => `${days} days`, expired: 'Expired', showExpired: 'Show expired', acknowledge: 'Acknowledge' }} choices={[7, 30, 90]} status="expired" expiresAt="2026-01-01T00:00:00Z" />));
    await act(async () => container.querySelector('button')!.click());
    expect(acknowledge).toHaveBeenCalledOnce();
    expect(container.querySelector('p')!.textContent).toBe('Expired');
  } finally { await act(async () => root.unmount()); }
});

it('sends numeric expiry choices, clears to Never, and requests hiding expired links', () => {
  const change = vi.fn(), setShowExpired = vi.fn();
  const props = {
    useShareExpiry: () => ({ expiresInDays: 30 as const, change, acknowledge: vi.fn(), setShowExpired }),
    kit: { Button: 'button' as const, Select: 'select' as const },
    copy: { never: 'Never', days: (days: number) => `${days} days`, expired: 'Expired', showExpired: 'Show expired', acknowledge: 'Acknowledge' },
    choices: [7, 30, 90] as const,
    status: 'expired',
    expiresAt: '2026-01-01T00:00:00Z',
  };
  const view = render(<ShareExpiryControls {...props} />);
  try {
    const select = view.getByRole('combobox', { name: 'Never' });
    const toggle = view.getByRole('checkbox', { name: 'Show expired' });
    if (!(select instanceof HTMLSelectElement) || !(toggle instanceof HTMLInputElement)) {
      throw new Error('Expected native select and checkbox controls');
    }
    expect(select.value).toBe('30');
    expect(Array.from(select.options, option => [option.value, option.text])).toEqual([
      ['never', 'Never'], ['7', '7 days'], ['30', '30 days'], ['90', '90 days'],
    ]);
    expect(view.container.querySelector('time')?.dateTime).toBe('2026-01-01T00:00:00Z');
    fireEvent.change(select, { target: { value: '90' } });
    fireEvent.change(select, { target: { value: 'never' } });
    expect(change.mock.calls).toEqual([[{ expiresInDays: 90 }], [{ expiresInDays: null }]]);
    expect(toggle.checked).toBe(true);
    fireEvent.click(toggle);
    expect(setShowExpired.mock.calls).toEqual([[{ showExpired: false }]]);
    view.rerender(<ShareExpiryControls {...props} showExpired={false} />);
    expect(toggle.checked).toBe(false);
  } finally {
    view.unmount();
  }
});
