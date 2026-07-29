import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createLabCatalog } from '@jini-ai/agentic/a2ui';
import { A2uiSurfaceCard } from '../A2uiSurfaceCard.js';

const CATALOG_ID = createLabCatalog().catalogId;

/** Wire components are flat: `{id, component, ...props}` — never `{id, component, props: {...}}`. That nested shape only exists in the interpreter's own internal `ComponentInstance` representation (see `interpreter.ts`'s `applyComponentsList`), not on the wire. */
function createSurfaceMessage(surfaceId: string, components: unknown[]) {
  return { version: 'v1.0', createSurface: { surfaceId, catalogId: CATALOG_ID, components } };
}

describe('A2uiSurfaceCard', () => {
  it('shows a waiting notice before any root component has arrived', () => {
    render(<A2uiSurfaceCard name="a2ui" events={[]} runStreaming runSucceeded={false} runId="run-1" />);
    expect(screen.getByText('Waiting for the agent to send a root component…')).toBeInTheDocument();
  });

  it('renders a Text/Column tree once createSurface delivers a root component', () => {
    const events = [
      createSurfaceMessage('s1', [
        { id: 'root', component: 'Column', children: ['t1'] },
        { id: 't1', component: 'Text', text: 'Hello from A2UI' },
      ]),
    ];
    render(<A2uiSurfaceCard name="a2ui" events={events} runStreaming runSucceeded={false} runId="run-1" />);
    expect(screen.getByText('Hello from A2UI')).toBeInTheDocument();
    expect(document.querySelector('.a2ui-column')).not.toBeNull();
  });

  it('applies a later updateComponents event on top of the createSurface tree', () => {
    const events = [
      createSurfaceMessage('s1', [{ id: 'root', component: 'Text', text: 'first' }]),
      { version: 'v1.0', updateComponents: { surfaceId: 's1', components: [{ id: 'root', component: 'Text', text: 'second' }] } },
    ];
    render(<A2uiSurfaceCard name="a2ui" events={events} runStreaming={false} runSucceeded runId="run-1" />);
    expect(screen.getByText('second')).toBeInTheDocument();
    expect(screen.queryByText('first')).not.toBeInTheDocument();
  });

  it('resolves a rendererOnly local function-call action without needing onAgentAction, and shows its resolved value', async () => {
    const events = [
      createSurfaceMessage('s1', [
        { id: 'root', component: 'Button', child: 'label', action: { functionCall: { call: 'adminReset', args: {} } } },
        { id: 'label', component: 'Text', text: 'Reset' },
      ]),
    ];
    render(<A2uiSurfaceCard name="a2ui" events={events} runStreaming runSucceeded={false} runId="run-1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.queryByText(/has not wired up a live agent-action relay/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Action refused/)).not.toBeInTheDocument();
    // `adminReset`'s impl returns void — the notice must still fire so a local action is never a
    // silent no-op, even when there is nothing meaningful to report back.
    expect(screen.getByText('Local action resolved: (no return value)')).toBeInTheDocument();
  });

  it('shows a local function-call action’s actual return value, not just that it ran', async () => {
    const events = [
      createSurfaceMessage('s1', [
        {
          id: 'root',
          component: 'Button',
          child: 'label',
          action: { functionCall: { call: 'greetUser', args: { name: 'Ada' } } },
        },
        { id: 'label', component: 'Text', text: 'Greet' },
      ]),
    ];
    render(<A2uiSurfaceCard name="a2ui" events={events} runStreaming runSucceeded={false} runId="run-1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Greet' }));
    expect(screen.getByText('Local action resolved: Hello, Ada!')).toBeInTheDocument();
  });

  it('calls onAgentAction with the built message for an event-shaped (agent-directed) action', async () => {
    const events = [
      createSurfaceMessage('s1', [
        { id: 'root', component: 'Button', child: 'label', action: { event: { name: 'continue' } } },
        { id: 'label', component: 'Text', text: 'Continue' },
      ]),
    ];
    const onAgentAction = vi.fn();
    render(<A2uiSurfaceCard name="a2ui" events={events} runStreaming runSucceeded={false} runId="run-42" onAgentAction={onAgentAction} />);
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onAgentAction).toHaveBeenCalledTimes(1);
    expect(onAgentAction).toHaveBeenCalledWith(
      'run-42',
      expect.objectContaining({ action: expect.objectContaining({ name: 'continue', surfaceId: 's1', sourceComponentId: 'root' }) }),
    );
  });

  it('shows the honest "not wired up" notice for an agent-directed action when onAgentAction is omitted', async () => {
    const events = [
      createSurfaceMessage('s1', [
        { id: 'root', component: 'Button', child: 'label', action: { event: { name: 'continue' } } },
        { id: 'label', component: 'Text', text: 'Continue' },
      ]),
    ];
    render(<A2uiSurfaceCard name="a2ui" events={events} runStreaming runSucceeded={false} runId="run-1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByText(/has not wired up a live agent-action relay/)).toBeInTheDocument();
  });

  it('shows a refusal notice for a component type the active catalog rejects, without crashing', () => {
    const events = [createSurfaceMessage('s1', [{ id: 'root', component: 'TotallyMadeUpType' }])];
    render(<A2uiSurfaceCard name="a2ui" events={events} runStreaming={false} runSucceeded runId="run-1" />);
    expect(screen.getByText(/A2UI surface refused/)).toBeInTheDocument();
  });

  it('degrades to a visible placeholder for a missing child id instead of crashing', () => {
    const events = [createSurfaceMessage('s1', [{ id: 'root', component: 'Column', children: ['does-not-exist'] }])];
    render(<A2uiSurfaceCard name="a2ui" events={events} runStreaming={false} runSucceeded runId="run-1" />);
    expect(screen.getByText(/missing component/)).toBeInTheDocument();
  });
});
