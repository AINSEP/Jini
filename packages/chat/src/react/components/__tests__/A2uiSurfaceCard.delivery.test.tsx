import { screen, waitFor } from '../../__tests__/fake-chat-kit.js';
import { renderWithChatSurfaces } from '../../__tests__/fake-chat-surfaces.js';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createLabCatalog } from '@jini-ai/protocol/a2ui';
import { A2uiSurfaceCard } from '../A2uiSurfaceCard.js';

// A package test supplies its own clock port; the system clock lives in the platform package.
const testClock = { nowMs: () => Date.now() };

const CATALOG_ID = createLabCatalog({}).catalogId;
const continueSurface = () => [{ version: 'v1.0', createSurface: { surfaceId: 's1', catalogId: CATALOG_ID, components: [
  { id: 'root', component: 'Button', child: 'label', action: { event: { name: 'continue' } } },
  { id: 'label', component: 'Text', text: 'Continue' },
] } }];

describe('A2uiSurfaceCard agent delivery', () => {
  it('shows a non-Error rejection reason as text', async () => {
    const onAgentAction = vi.fn(() => Promise.reject('socket closed'));
    renderWithChatSurfaces(<A2uiSurfaceCard name="a2ui" clock={testClock} events={continueSurface()} runStreaming runSucceeded={false} runId="run-1" onAgentAction={onAgentAction} />);
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('This action could not be delivered: socket closed')).toBeInTheDocument();
  });

  it('ignores an older attempt that rejects after a newer one succeeded', async () => {
    const settle: Array<{ resolve: (value: { ok: true }) => void; reject: (error: unknown) => void }> = [];
    const onAgentAction = vi.fn(() => new Promise<{ ok: true }>((resolve, reject) => { settle.push({ resolve, reject }); }));
    renderWithChatSurfaces(<A2uiSurfaceCard name="a2ui" clock={testClock} events={continueSurface()} runStreaming runSucceeded={false} runId="run-1" onAgentAction={onAgentAction} />);
    const button = screen.getByRole('button', { name: 'Continue' });
    await userEvent.click(button);
    await userEvent.click(button);
    await waitFor(() => expect(settle).toHaveLength(2));
    settle[1]!.resolve({ ok: true });
    settle[0]!.reject(new Error('stale transport failure'));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(screen.queryByText(/could not be delivered/)).not.toBeInTheDocument();
  });
});
