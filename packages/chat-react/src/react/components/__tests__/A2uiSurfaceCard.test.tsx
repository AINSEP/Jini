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

  // These two pin the invariant the renderer's variant classNames rely on: the catalog's zod
  // `.default()` fills `variant` in upstream, so the components carry no `?? 'body'`/`?? 'default'`
  // fallback of their own. If a future catalog change dropped either default, the className would
  // become `a2ui-text-undefined` and these are what would catch it.
  it('emits the default Text variant className when the agent sent no variant', () => {
    const events = [createSurfaceMessage('s1', [{ id: 'root', component: 'Text', text: 'hi' }])];
    render(<A2uiSurfaceCard name="a2ui" events={events} runStreaming={false} runSucceeded runId="run-1" />);
    expect(document.querySelector('.a2ui-text')?.className).toBe('a2ui-text a2ui-text-body');
  });

  it('emits the agent-chosen Text and Button variant classNames when they are sent explicitly', () => {
    const events = [
      createSurfaceMessage('s1', [
        { id: 'root', component: 'Button', child: 'label', variant: 'primary', action: { event: { name: 'go' } } },
        { id: 'label', component: 'Text', text: 'Go', variant: 'caption' },
      ]),
    ];
    render(<A2uiSurfaceCard name="a2ui" events={events} runStreaming={false} runSucceeded runId="run-1" />);
    expect(document.querySelector('.a2ui-button')?.className).toBe('a2ui-button a2ui-button-primary');
    expect(document.querySelector('.a2ui-text')?.className).toBe('a2ui-text a2ui-text-caption');
  });

  it('renders a Row container, laying its children out alongside a Column for contrast', () => {
    const events = [
      createSurfaceMessage('s1', [
        { id: 'root', component: 'Row', children: ['a', 'b'] },
        { id: 'a', component: 'Text', text: 'left' },
        { id: 'b', component: 'Text', text: 'right' },
      ]),
    ];
    render(<A2uiSurfaceCard name="a2ui" events={events} runStreaming={false} runSucceeded runId="run-1" />);
    const row = document.querySelector('.a2ui-row');
    expect(row).not.toBeNull();
    expect(row?.textContent).toBe('leftright');
  });

  it('degrades to a visible placeholder for a circular parent/child reference instead of recursing forever', () => {
    // Agent-authored component graphs are not validated for acyclicity by the interpreter, so the
    // renderer is the only thing standing between a malformed tree and a blown call stack.
    const events = [
      createSurfaceMessage('s1', [
        { id: 'root', component: 'Column', children: ['child'] },
        { id: 'child', component: 'Column', children: ['root'] },
      ]),
    ];
    render(<A2uiSurfaceCard name="a2ui" events={events} runStreaming={false} runSucceeded runId="run-1" />);
    expect(screen.getByText(/circular reference at “root”/)).toBeInTheDocument();
    expect(document.querySelector('[data-a2ui-status="cycle"]')).not.toBeNull();
  });

  it('degrades to a visible placeholder for a template (data-bound) child list, which this port does not implement', () => {
    // `ChildList` is a union: an array of ids, or `{componentId, path}` generating one child per
    // data-model item. The interpreter accepts both; this renderer only walks the array form, so
    // the template form must say so out loud rather than render an empty container.
    const events = [
      createSurfaceMessage('s1', [
        { id: 'root', component: 'Column', children: { componentId: 'item', path: '/rows' } },
        { id: 'item', component: 'Text', text: 'row' },
      ]),
    ];
    render(<A2uiSurfaceCard name="a2ui" events={events} runStreaming={false} runSucceeded runId="run-1" />);
    expect(screen.getByText(/dynamic \(template\) child lists are not implemented/)).toBeInTheDocument();
    expect(document.querySelector('[data-a2ui-status="unimplemented-template-list"]')).not.toBeNull();
  });

  it('degrades to a visible placeholder for a catalog component this renderer has no case for', () => {
    // `Divider` is one of the 18 the catalog validates, so it lands in the component map — but this
    // port only has React cases for Text/Column/Row/Button. That gap must be visible, not silent.
    const events = [createSurfaceMessage('s1', [{ id: 'root', component: 'Divider' }])];
    render(<A2uiSurfaceCard name="a2ui" events={events} runStreaming={false} runSucceeded runId="run-1" />);
    expect(screen.getByText(/no renderer yet for component type “Divider”/)).toBeInTheDocument();
    expect(document.querySelector('[data-a2ui-status="unrenderable-type"]')).not.toBeNull();
  });

  it('shows an unresolved marker in place of text whose data binding points at nothing', () => {
    const events = [
      createSurfaceMessage('s1', [{ id: 'root', component: 'Text', text: { path: '/user/name' } }]),
    ];
    render(<A2uiSurfaceCard name="a2ui" events={events} runStreaming={false} runSucceeded runId="run-1" />);
    expect(screen.getByText('⚠ unresolved (PATH_NOT_FOUND)')).toBeInTheDocument();
  });

  it('stringifies a text binding that resolves to a non-string rather than rendering nothing', () => {
    const events = [
      { version: 'v1.0', createSurface: { surfaceId: 's1', catalogId: CATALOG_ID, components: [{ id: 'root', component: 'Text', text: { path: '/count' } }], dataModel: { count: 42 } } },
    ];
    render(<A2uiSurfaceCard name="a2ui" events={events} runStreaming={false} runSucceeded runId="run-1" />);
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('surfaces an out-of-band protocol violation (no message key) as a refusal, with no surface to attribute it to', () => {
    // A malformed envelope carries no surfaceId, so the interpreter reports it via
    // `unattributedViolation` instead of a wire-shaped error — the only channel left is the UI.
    render(<A2uiSurfaceCard name="a2ui" events={[{ version: 'v1.0' }]} runStreaming={false} runSucceeded runId="run-1" />);
    expect(screen.getByText(/A2UI surface refused/)).toBeInTheDocument();
  });

  it('survives a null event in the stream, treating it as an unattributable violation', () => {
    render(<A2uiSurfaceCard name="a2ui" events={[null]} runStreaming={false} runSucceeded runId="run-1" />);
    expect(screen.getByText(/A2UI surface refused/)).toBeInTheDocument();
  });

  it('shows an "Action refused" notice over the still-rendered surface when an action cannot be built', async () => {
    // `logServerEvent` is `agentOnly`: the renderer must refuse to run it rather than execute an
    // agent-side function on the agent's behalf. The surface itself stays mounted and usable.
    const events = [
      createSurfaceMessage('s1', [
        { id: 'root', component: 'Button', child: 'label', action: { functionCall: { call: 'logServerEvent', args: {} } } },
        { id: 'label', component: 'Text', text: 'Log it' },
      ]),
    ];
    render(<A2uiSurfaceCard name="a2ui" events={events} runStreaming={false} runSucceeded runId="run-1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Log it' }));
    expect(screen.getByText(/Action refused: .*callableFrom="agentOnly"/)).toBeInTheDocument();
    // Still rendered — the refusal is a notice, not a replacement for the surface.
    expect(screen.getByRole('button', { name: 'Log it' })).toBeInTheDocument();
  });

  it('formats a non-string local action result as JSON rather than dropping it', async () => {
    const events = [
      createSurfaceMessage('s1', [
        { id: 'root', component: 'Button', child: 'label', action: { functionCall: { call: 'not', args: { value: false } } } },
        { id: 'label', component: 'Text', text: 'Negate' },
      ]),
    ];
    render(<A2uiSurfaceCard name="a2ui" events={events} runStreaming={false} runSucceeded runId="run-1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Negate' }));
    expect(screen.getByText('Local action resolved: true')).toBeInTheDocument();
  });

  it('clears a previous refusal notice once a later action succeeds', async () => {
    // `refusalNotice` is sticky state, so a surface that recovers must not keep showing a stale
    // refusal next to a working control.
    const events = [
      createSurfaceMessage('s1', [
        { id: 'root', component: 'Row', children: ['bad', 'good'] },
        { id: 'bad', component: 'Button', child: 'bad-label', action: { functionCall: { call: 'logServerEvent', args: {} } } },
        { id: 'bad-label', component: 'Text', text: 'Refuse me' },
        { id: 'good', component: 'Button', child: 'good-label', action: { functionCall: { call: 'greetUser', args: { name: 'Ada' } } } },
        { id: 'good-label', component: 'Text', text: 'Greet' },
      ]),
    ];
    render(<A2uiSurfaceCard name="a2ui" events={events} runStreaming={false} runSucceeded runId="run-1" />);
    await userEvent.click(screen.getByRole('button', { name: 'Refuse me' }));
    expect(screen.getByText(/Action refused/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Greet' }));
    expect(screen.queryByText(/Action refused/)).not.toBeInTheDocument();
    expect(screen.getByText('Local action resolved: Hello, Ada!')).toBeInTheDocument();
  });

  it('replaces a pending agent-action notice when a local action runs afterwards, and vice versa', async () => {
    // The two notices are mutually exclusive by construction — showing both would tell the user the
    // same click both went to the agent and resolved locally.
    const events = [
      createSurfaceMessage('s1', [
        { id: 'root', component: 'Row', children: ['agent', 'local'] },
        { id: 'agent', component: 'Button', child: 'agent-label', action: { event: { name: 'continue' } } },
        { id: 'agent-label', component: 'Text', text: 'To agent' },
        { id: 'local', component: 'Button', child: 'local-label', action: { functionCall: { call: 'greetUser', args: { name: 'Ada' } } } },
        { id: 'local-label', component: 'Text', text: 'Locally' },
      ]),
    ];
    render(<A2uiSurfaceCard name="a2ui" events={events} runStreaming={false} runSucceeded runId="run-1" />);
    await userEvent.click(screen.getByRole('button', { name: 'To agent' }));
    expect(screen.getByText(/has not wired up a live agent-action relay/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Locally' }));
    expect(screen.queryByText(/has not wired up a live agent-action relay/)).not.toBeInTheDocument();
    expect(screen.getByText('Local action resolved: Hello, Ada!')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'To agent' }));
    expect(screen.getByText(/has not wired up a live agent-action relay/)).toBeInTheDocument();
    expect(screen.queryByText(/Local action resolved/)).not.toBeInTheDocument();
  });
});
