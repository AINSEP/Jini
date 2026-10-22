import { Suspense, StrictMode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createAdmin } from '../../../core/module/index.js';
import { sourceControl } from '../index.js';
import { createMemorySourceControlApi } from '../../adapters/memory.js';
afterEach(cleanup);
function setup(permissions: readonly string[] = []) {
  const feature = sourceControl({}), api = createMemorySourceControlApi({ providers: [{ id: 'git', label: 'Git' }] });
  const admin = createAdmin({ modules: [feature], ports: { sourceControlApi: api } }, { permissions }); const { Page, tabs } = feature.react.pages.sourceControl;
  const tree = () => <StrictMode><feature.react.Provider admin={admin}><Suspense fallback="Loading"><Page tabs={tabs} description={admin.describe().pages[0]!} requestedTab="bad-link" /></Suspense></feature.react.Provider></StrictMode>;
  return { api, admin, tree };
}
it('does not fetch or show credentials without page grants', async () => { const { api, tree } = setup(); const list = vi.spyOn(api, 'list'); render(tree()); expect(await screen.findByText('Permission denied')).toBeVisible(); expect(list).not.toHaveBeenCalled(); });
it('renders a read-only provider row without write grants or optional navigation', async () => { const { tree } = setup(['source-control.read']); render(tree()); expect(await screen.findByRole('heading', { name: 'Connect Git' })).toBeVisible(); expect(screen.getByText('Read-only connection')).toBeVisible(); expect(screen.queryByLabelText('Git Access token')).toBeNull(); expect(screen.queryByRole('button', { name: 'Save Git token' })).toBeNull(); expect(screen.queryByRole('button', { name: 'Create access token' })).toBeNull(); });
it('accepts a ui-kit token save and never displays saved secret drafts', async () => {
  const { api, tree } = setup(['source-control.read', 'source-control.credentials.write']); const save = vi.spyOn(api, 'create'); render(tree());
  const token = await screen.findByLabelText('Git Access token'); expect(token).toHaveAttribute('autocomplete', 'new-password'); expect(screen.getByRole('button', { name: 'Save Git token' })).toBeDisabled(); fireEvent.change(token, { target: { value: 'typed secret' } }); fireEvent.click(screen.getByRole('button', { name: 'Save Git token' }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1)); await screen.findByText('Token saved'); expect(token).toHaveValue(''); expect(screen.getByText('Replace token ▾')).toBeInTheDocument(); expect(screen.queryByText('typed secret')).toBeNull(); expect(screen.queryByText(/verified/i)).toBeNull();
});
