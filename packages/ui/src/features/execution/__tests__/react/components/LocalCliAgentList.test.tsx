// @vitest-environment jsdom
import { AGENT_ELEMENT_ATTRIBUTE } from '@jini-ai/agentic';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AgentScanState, DetectedAgent, LocalCliConfig } from '../../../types.js';
import { LocalCliAgentList } from '../../../react/components/LocalCliAgentList.js';
import { partitionAgentsByInstalled } from '../../../rules.js';

/**
 * @file The CLI grid shows installed CLIs up front and folds the not-installed tail behind one
 * "Show N not installed" toggle (2026-10-09 AI Assistant redesign: a dozen uninstalled cards had
 * pushed every setting below the grid off-screen).
 */
const AGENTS: DetectedAgent[] = [
  { id: 'claude', label: 'Claude Code', installed: true },
  { id: 'codex', label: 'Codex CLI', installed: true },
  { id: 'kimi', label: 'Kimi CLI', installed: false },
  { id: 'trae', label: 'Trae CLI', installed: false },
];

function renderList(config: LocalCliConfig = { agentId: 'claude' }) {
  render(
    <LocalCliAgentList agents={AGENTS} config={config} scan={{ status: 'idle' }} onSelect={vi.fn()}
      onModelChange={vi.fn()} onReasoningChange={vi.fn()} onEnvChange={vi.fn()} cliEnvFields={[]}
      agentTest={{ status: 'idle' }} />,
  );
}

describe('LocalCliAgentList — not-installed disclosure', () => {
  it('shows installed CLIs and hides the not-installed ones behind a counted toggle', () => {
    renderList();
    expect(screen.getByText('Claude Code')).toBeInTheDocument();
    expect(screen.getByText('Codex CLI')).toBeInTheDocument();
    expect(screen.queryByText('Kimi CLI')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show 2 not installed' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('the toggle reveals and re-hides the not-installed CLIs', async () => {
    const user = userEvent.setup();
    renderList();
    await user.click(screen.getByRole('button', { name: 'Show 2 not installed' }));
    expect(screen.getByText('Kimi CLI')).toBeInTheDocument();
    expect(screen.getByText('Trae CLI')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Hide not installed' }));
    expect(screen.queryByText('Kimi CLI')).not.toBeInTheDocument();
  });

  it('never hides the current pick, even when it is not installed', () => {
    renderList({ agentId: 'kimi' });
    expect(screen.getByText('Kimi CLI')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show 1 not installed' })).toBeInTheDocument();
  });

  it('renders no toggle when every CLI is installed', () => {
    render(
      <LocalCliAgentList agents={AGENTS.slice(0, 2)} config={{ agentId: null }} scan={{ status: 'idle' }} onSelect={vi.fn()}
        onModelChange={vi.fn()} onReasoningChange={vi.fn()} onEnvChange={vi.fn()} cliEnvFields={[]}
        agentTest={{ status: 'idle' }} />,
    );
    expect(screen.queryByRole('button', { name: /not installed/ })).not.toBeInTheDocument();
  });
});

function renderScan(scan: AgentScanState, agents: readonly DetectedAgent[] = AGENTS) {
  const onRescan = vi.fn();
  render(
    <LocalCliAgentList agents={agents} config={{ agentId: null }} scan={scan} onSelect={vi.fn()}
      onModelChange={vi.fn()} onReasoningChange={vi.fn()} onEnvChange={vi.fn()} cliEnvFields={[]}
      agentTest={{ status: 'idle' }} onRescan={onRescan} />,
  );
  return onRescan;
}

describe('LocalCliAgentList — scan states', () => {
  it('reports a failed scan as an alert carrying the scan message', () => {
    renderScan({ status: 'error', message: 'detector crashed' });
    expect(screen.getByRole('alert')).toHaveTextContent('detector crashed');
  });

  it('keeps showing the detected cards under a failed rescan', () => {
    renderScan({ status: 'error', message: 'detector crashed' });
    expect(screen.getByText('Claude Code')).toBeInTheDocument();
  });

  it('never claims "no CLIs detected" when the scan itself failed', () => {
    renderScan({ status: 'error', message: 'detector crashed' }, []);
    expect(screen.queryByText('No agent CLIs detected.')).not.toBeInTheDocument();
  });

  it('says no CLIs were detected when a finished scan found none', () => {
    renderScan({ status: 'idle' }, []);
    expect(screen.getByText('No agent CLIs detected.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the scanning card instead of the grid while a scan runs', () => {
    renderScan({ status: 'scanning' });
    expect(screen.getByRole('status')).toHaveTextContent('Scanning for installed agents…');
    expect(screen.queryByText('Claude Code')).not.toBeInTheDocument();
  });

  it('disables the rescan button and relabels it while a scan runs', () => {
    renderScan({ status: 'scanning' });
    expect(screen.getByRole('button', { name: 'Scanning…' })).toBeDisabled();
  });

  it('calls onRescan from the header button', async () => {
    const onRescan = renderScan({ status: 'idle' });
    await userEvent.click(screen.getByRole('button', { name: '↻ Rescan' }));
    expect(onRescan).toHaveBeenCalledTimes(1);
  });

  it('renders no rescan button when the host gives no onRescan', () => {
    renderList();
    expect(screen.queryByRole('button', { name: '↻ Rescan' })).not.toBeInTheDocument();
  });

  it('counts only installed CLIs in the heading', () => {
    renderList();
    expect(screen.getByRole('heading', { level: 4 })).toHaveTextContent('Your CLIs (2)');
  });

  it('uses the host scope label when one is given, else the neutral default', () => {
    render(
      <LocalCliAgentList agents={AGENTS} config={{ agentId: null }} scan={{ status: 'idle' }} onSelect={vi.fn()}
        onModelChange={vi.fn()} onReasoningChange={vi.fn()} onEnvChange={vi.fn()} cliEnvFields={[]}
        agentTest={{ status: 'idle' }} scopeLabel="on the server" />,
    );
    expect(document.querySelector('.jini-local-cli-scope')).toHaveTextContent(/^on the server$/);
  });

  it('falls back to the neutral scope sentence without a host label', () => {
    renderList();
    expect(document.querySelector('.jini-local-cli-scope')).toHaveTextContent('Runs a code-agent CLI detected by the host.');
  });
});

describe('LocalCliAgentList — agent handles', () => {
  it('gives every card its own distinct handle derived from the list handle', () => {
    render(
      <LocalCliAgentList agents={AGENTS.slice(0, 2)} config={{ agentId: null }} scan={{ status: 'idle' }} onSelect={vi.fn()}
        onModelChange={vi.fn()} onReasoningChange={vi.fn()} onEnvChange={vi.fn()} cliEnvFields={[]}
        agentTest={{ status: 'idle' }} agentHandle="settings-cli" />,
    );
    const handles = ['claude', 'codex'].map((id) => screen.getByTestId(`jini-agent-select-${id}`).getAttribute(AGENT_ELEMENT_ATTRIBUTE));
    expect(handles).toEqual(['settings-cli-claude-select', 'settings-cli-codex-select']);
  });
});

describe('partitionAgentsByInstalled', () => {
  it('keeps order, splitting installed (plus the selected id) from the rest', () => {
    expect(partitionAgentsByInstalled(AGENTS, 'trae')).toEqual({
      visible: [AGENTS[0], AGENTS[1], AGENTS[3]],
      collapsed: [AGENTS[2]],
    });
  });
});
