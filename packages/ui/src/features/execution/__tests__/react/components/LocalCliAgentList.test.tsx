// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { DetectedAgent, LocalCliConfig } from '../../../types.js';
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

describe('partitionAgentsByInstalled', () => {
  it('keeps order, splitting installed (plus the selected id) from the rest', () => {
    expect(partitionAgentsByInstalled(AGENTS, 'trae')).toEqual({
      visible: [AGENTS[0], AGENTS[1], AGENTS[3]],
      collapsed: [AGENTS[2]],
    });
  });
});
