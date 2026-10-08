import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { FetchQueryProvider } from '@jini-ai/ui/fetch-query';
import type { AdminRedirect } from '../../../core/ports/redirects.js';
import { createMemoryRedirectsApi } from '../../adapters/memory.js';
import { RedirectsPage } from '../pages/RedirectsPage.js';
import { RedirectsPortsContext } from '../hooks/RedirectsPorts.hooks.js';
import { translateRedirectsEn } from '../../messages.en.js';

const rule: AdminRedirect = {
  id: 'r1', matchType: 'exact', fromPattern: '/old', toTarget: '/new', statusCode: 301,
  source: 'manual', status: 'active', override: false, priority: 0,
  sourceEntryId: null, fromPathAtCapture: null, toPathAtCapture: null,
  createdByPrincipal: 'operator', createdByPluginId: null, createdAt: '', updatedAt: '', version: 1,
};

describe('redirect copy polish', () => {
  it('shows human type, provenance and status labels and keeps creation values unchanged', async () => {
    const user = userEvent.setup();
    const api = createMemoryRedirectsApi({ redirects: [rule,
      { ...rule, id: 'r2', fromPattern: '/changed', matchType: 'prefix', source: 'auto_slug_change' },
      { ...rule, id: 'r3', fromPattern: '/imported', matchType: 'wildcard', source: 'import', status: 'disabled' },
    ] });
    render(<FetchQueryProvider><RedirectsPortsContext.Provider value={{ redirectsApi: api }}>
      <RedirectsPage />
    </RedirectsPortsContext.Provider></FetchQueryProvider>);
    const from = await screen.findByText('/old');
    const row = within(from.closest('tr')!);
    expect(row.getByText('Exact match')).toBeInTheDocument();
    expect(row.getByText('Manual')).toBeInTheDocument();
    expect(row.getByText('Active')).toBeInTheDocument();
    const changed = within(screen.getByText('/changed').closest('tr')!);
    expect(changed.getByText('Starts with')).toBeInTheDocument();
    expect(changed.getByText('URL change')).toBeInTheDocument();
    const imported = within(screen.getByText('/imported').closest('tr')!);
    expect(imported.getByText('Wildcard')).toBeInTheDocument();
    expect(imported.getByText('Imported')).toBeInTheDocument();
    expect(imported.getByText('Disabled')).toBeInTheDocument();
    expect(screen.queryByText('auto_slug_change')).not.toBeInTheDocument();
    expect(screen.getByText("Manage URL redirects, including those created automatically when a page's address changes.")).toBeInTheDocument();
    const select = screen.getByRole('combobox', { name: 'Match type' });
    expect(within(select).getAllByRole('option').map(option => option.textContent)).toEqual(['Exact match', 'Starts with', 'Wildcard']);
    await user.selectOptions(select, 'prefix');
    await user.type(screen.getByLabelText('From path'), '/another');
    await user.type(screen.getByLabelText('To target'), '/destination');
    await user.click(screen.getByRole('button', { name: 'Add redirect' }));
    await screen.findByText('/another');
    const created = (await api.listRedirects({})).find(item => item.fromPattern === '/another');
    expect(created?.matchType).toBe('prefix');
    expect(created?.source).toBe('manual');
    expect(created?.status).toBe('active');
  });

  it('keeps unknown host enum values visible and interpolates other English messages', () => {
    expect(translateRedirectsEn('future_match_type')).toBe('future_match_type');
    expect(translateRedirectsEn('{created} created, {failed} failed.', { created: 2, failed: 1 })).toBe('2 created, 1 failed.');
  });
});
