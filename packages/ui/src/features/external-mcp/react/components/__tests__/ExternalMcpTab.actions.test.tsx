import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { SourceConfigPort } from '../../../../source-config-list/ports.js';
import type { SourceConfigItem, SourceFieldValues, SourceUpdateInput } from '../../../../source-config-list/types.js';
import { ExternalMcpTab } from '../ExternalMcpTab.js';

/**
 * @file Every per-server and draft action the assembled tab exposes must reach the host port with
 * the right server id (or the draft values), and a test verdict must render beside what it tested.
 */

const SOURCE: SourceConfigItem = { id: 'github', label: 'GitHub', enabled: true, trust: 'trusted', fields: { id: 'github', transport: 'stdio', command: 'npx' } };

function createFullPort() {
  const calls: { refresh: string[]; remove: string[]; trust: [string, string][]; update: [string, SourceUpdateInput][]; test: [string | undefined, SourceFieldValues | undefined][] } = {
    refresh: [], remove: [], trust: [], update: [], test: [],
  };
  const port: SourceConfigPort = {
    fetchSources: async () => [SOURCE],
    addSource: async () => ({ ok: false, message: 'Rejected by host.' }),
    removeSource: async (id) => { calls.remove.push(id); return true; },
    refreshSource: async (id) => { calls.refresh.push(id); return SOURCE; },
    setTrust: async (id, trust) => { calls.trust.push([id, trust]); return { ...SOURCE, trust }; },
    updateSource: async (id, patch) => { calls.update.push([id, patch]); return { ...SOURCE, ...patch }; },
    testSource: async (id, draft) => { calls.test.push([id, draft]); return { ok: true, message: id ? `Reached ${id}` : 'Draft reachable' }; },
  };
  return { port, calls };
}

describe('ExternalMcpTab server actions', () => {
  it('routes refresh, enable toggle, test and remove for a server to the port with that server id', async () => {
    const { port, calls } = createFullPort();
    render(<ExternalMcpTab dependencies={{ port }} />);
    await screen.findByText('GitHub');

    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(calls.refresh).toEqual(['github']);

    await userEvent.click(screen.getByRole('checkbox', { name: 'Enable GitHub' }));
    expect(calls.update).toEqual([['github', { enabled: false }]]);

    await userEvent.click(screen.getByRole('button', { name: 'GitHub trusted' }));
    await userEvent.click(screen.getByRole('button', { name: 'Test' }));
    expect(calls.test).toEqual([['github', undefined]]);
    expect(await screen.findByText(/Reached github/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(calls.remove).toEqual(['github']);
  });

  it('offers a trust picker only when the host supplies trust options, and routes a change to setTrust', async () => {
    const { port, calls } = createFullPort();
    const { unmount } = render(<ExternalMcpTab dependencies={{ port }} />);
    await screen.findByText('GitHub');
    expect(screen.queryByRole('combobox', { name: 'Trust level for GitHub' })).toBeNull();
    unmount();

    render(<ExternalMcpTab dependencies={{ port }} trustOptions={[{ value: 'trusted', label: 'Trusted' }, { value: 'untrusted', label: 'Untrusted' }]} />);
    await screen.findByText('GitHub');
    await userEvent.click(screen.getByRole('button', { name: /^GitHub/ }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Trust level for GitHub' }), 'untrusted');
    expect(calls.trust).toEqual([['github', 'untrusted']]);
  });
});

describe('ExternalMcpTab draft test', () => {
  it('tests the unsaved draft with no server id and shows the verdict inside the add form', async () => {
    const { port, calls } = createFullPort();
    render(<ExternalMcpTab dependencies={{ port }} />);
    await screen.findByText('GitHub');
    await userEvent.click(screen.getByRole('button', { name: 'Add server' }));
    await userEvent.type(screen.getByLabelText(/^ID/), 'draft-server');
    await userEvent.selectOptions(screen.getByLabelText(/^Transport/), 'stdio');
    await userEvent.type(screen.getByLabelText(/^Command/), 'npx');
    const [draftTest] = screen.getAllByRole('button', { name: 'Test' });
    await userEvent.click(draftTest!);
    expect(calls.test).toHaveLength(1);
    expect(calls.test[0]![0]).toBeUndefined();
    expect(calls.test[0]![1]).toEqual(expect.objectContaining({ id: 'draft-server', transport: 'stdio', command: 'npx' }));
    expect(await screen.findByText(/Draft reachable/)).toBeInTheDocument();
  });
});
