// @vitest-environment jsdom
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
