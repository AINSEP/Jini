import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LocalCliAgentList, type LocalCliAgentListProps } from '../LocalCliAgentList.js';
import type { AgentScanState, DetectedAgent } from '../../../types.js';

const installed: DetectedAgent = { id: 'one', label: 'One CLI', installed: true };
const missing: DetectedAgent = { id: 'two', label: 'Two CLI', installed: false };
function listProps(required: Partial<LocalCliAgentListProps>, _options = {}): LocalCliAgentListProps {
  return { agents: [], config: { agentId: null }, scan: { status: 'idle' }, onSelect: vi.fn(),
    onModelChange: vi.fn(), onReasoningChange: vi.fn(), onEnvChange: vi.fn(), cliEnvFields: [],
    agentTest: { status: 'idle' }, ...required };
}

describe('LocalCliAgentList characterization', () => {
  it.each([
    { scan: { status: 'idle' }, agents: [], empty: true, loading: false, error: false, cards: false },
    { scan: { status: 'ok', count: 0 }, agents: [], empty: true, loading: false, error: false, cards: false },
    { scan: { status: 'error', message: 'Probe failed' }, agents: [], empty: false, loading: false, error: true, cards: false },
    { scan: { status: 'scanning' }, agents: [], empty: false, loading: true, error: false, cards: false },
    { scan: { status: 'scanning' }, agents: [installed], empty: false, loading: true, error: false, cards: false },
    { scan: { status: 'error', message: 'Probe failed' }, agents: [installed], empty: false, loading: false, error: true, cards: true },
    { scan: { status: 'ok', count: 1 }, agents: [installed], empty: false, loading: false, error: false, cards: true },
  ] satisfies { scan: AgentScanState; agents: DetectedAgent[]; empty: boolean; loading: boolean; error: boolean; cards: boolean }[])(
    'preserves scan precedence for $scan.status with $agents.length agents', ({ scan, agents, empty, loading, error, cards }) => {
      const props = listProps({ scan, agents, onRescan: vi.fn() });
      render(<LocalCliAgentList {...props} />);
      expect(screen.queryByText('No agent CLIs detected.') !== null).toBe(empty);
      expect(screen.queryByRole('status') !== null).toBe(loading);
      expect(screen.queryByRole('alert')?.textContent ?? null).toBe(error ? 'Probe failed' : null);
      expect(screen.queryByTestId('jini-agent-card-one') !== null).toBe(cards);
      const rescan = screen.getByRole('button', { name: loading ? 'Scanning…' : '↻ Rescan' });
      expect((rescan as HTMLButtonElement).disabled).toBe(loading);
      fireEvent.click(rescan);
      expect(props.onRescan).toHaveBeenCalledTimes(loading ? 0 : 1);
    },
  );

  it('uses the host scope, installed count, icon, per-card handles and disclosure callback', () => {
    const props = listProps({ agents: [installed, missing], scopeLabel: 'On the server', agentHandle: 'settings-clis',
      renderAgentIcon: (agent) => <b>{agent.id} icon</b> });
    render(<LocalCliAgentList {...props} />);
    expect(screen.getByText('Your CLIs (1)')).toBeInTheDocument();
    expect(screen.getByText('On the server')).toBeInTheDocument();
    expect(screen.getByText('one icon')).toBeInTheDocument();
    expect(screen.queryByTestId('jini-agent-card-two')).not.toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: 'Show 1 not installed' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    const one = screen.getByTestId('jini-agent-select-one');
    const two = screen.getByTestId('jini-agent-select-two');
    expect(one).toHaveAttribute('data-agent-element', 'settings-clis-one-select');
    expect(two).toHaveAttribute('data-agent-element', 'settings-clis-two-select');
    expect(one.getAttribute('data-agent-element')).not.toBe(two.getAttribute('data-agent-element'));
    expect(two).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Hide not installed' })).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Hide not installed' }));
    expect(screen.queryByTestId('jini-agent-card-two')).not.toBeInTheDocument();
  });

  it('keeps a selected missing CLI visible and omits unavailable rescan and disclosure actions', () => {
    const props = listProps({ agents: [installed, missing], config: { agentId: 'two' }, scopeLabel: '' });
    const { container } = render(<LocalCliAgentList {...props} />);
    expect(screen.getByTestId('jini-agent-select-two')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: /not installed|Rescan/ })).not.toBeInTheDocument();
    expect(container.querySelector('.jini-local-cli-scope')).toBeEmptyDOMElement();
    expect(screen.getByTestId('jini-agent-select-one')).not.toHaveAttribute('data-agent-element');
  });

  it('uses the default scope and the existing injected disclosure port', () => {
    const toggleCollapsed = vi.fn();
    const useAgentList: NonNullable<LocalCliAgentListProps['useAgentList']> = vi.fn(() => ({
      visible: [installed], collapsed: [missing], showCollapsed: true, toggleCollapsed,
    }));
    const props = listProps({ agents: [installed, missing], useAgentList });
    render(<LocalCliAgentList {...props} />);
    expect(screen.getByText('Runs a code-agent CLI detected by the host.')).toBeInTheDocument();
    expect(useAgentList).toHaveBeenCalledWith({ agents: props.agents, selectedAgentId: null });
    expect(screen.getByTestId('jini-agent-card-two')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hide not installed' }));
    expect(toggleCollapsed).toHaveBeenCalledTimes(1);
    expect(toggleCollapsed).toHaveBeenCalledWith();
  });
});
