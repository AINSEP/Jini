import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createLabCatalog } from '@jini-ai/agentic/a2ui';
import { A2uiSurfaceCard } from '../A2uiSurfaceCard.js';

const CATALOG_ID = createLabCatalog({}).catalogId;
const continueSurface = () => [{ version: 'v1.0', createSurface: { surfaceId: 's1', catalogId: CATALOG_ID, components: [
  { id: 'root', component: 'Button', child: 'label', action: { event: { name: 'continue' } } },
  { id: 'label', component: 'Text', text: 'Continue' },
] } }];

describe('A2uiSurfaceCard agent delivery', () => {
  it('shows a non-Error rejection reason as text', async () => {
    const onAgentAction = vi.fn(() => Promise.reject('socket closed'));
    render(<A2uiSurfaceCard name="a2ui" events={continueSurface()} runStreaming runSucceeded={false} runId="run-1" onAgentAction={onAgentAction} />);
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('This action could not be delivered: socket closed')).toBeInTheDocument();
  });

  it('ignores an older attempt that rejects after a newer one succeeded', async () => {
    const settle: Array<{ resolve: (value: { ok: true }) => void; reject: (error: unknown) => void }> = [];
    const onAgentAction = vi.fn(() => new Promise<{ ok: true }>((resolve, reject) => { settle.push({ resolve, reject }); }));
    render(<A2uiSurfaceCard name="a2ui" events={continueSurface()} runStreaming runSucceeded={false} runId="run-1" onAgentAction={onAgentAction} />);
    const button = screen.getByRole('button', { name: 'Continue' });
    await userEvent.click(button);
    await userEvent.click(button);
    await waitFor(() => expect(settle).toHaveLength(2));
    settle[1]!.resolve({ ok: true });
    settle[0]!.reject(new Error('stale transport failure'));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(screen.queryByText(/could not be delivered/)).not.toBeInTheDocument();
  });

  it('delivers a registry data-table row click as the table’s action, with a response id when the agent wants one', async () => {
    const events = [{ version: 'v1.0', createSurface: { surfaceId: 's1', catalogId: CATALOG_ID, components: [
      { id: 'root', component: 'native.data-table', columns: [{ key: 'name', label: 'Name' }], rows: [{ name: 'Ada' }],
        action: { event: { name: 'pick-row', wantResponse: true } } },
    ] } }];
    const onAgentAction = vi.fn();
    render(<A2uiSurfaceCard name="a2ui" events={events} runStreaming runSucceeded={false} runId="run-7" onAgentAction={onAgentAction} />);
    await userEvent.click(screen.getByRole('button', { name: /Ada/ }));
    expect(onAgentAction).toHaveBeenCalledWith('run-7', expect.objectContaining({ action: expect.objectContaining({
      name: 'pick-row', surfaceId: 's1', sourceComponentId: 'root', wantResponse: true, actionId: expect.stringMatching(/^a2ui-action-\d+-[0-9a-z]+$/),
    }) }));
  });
});
