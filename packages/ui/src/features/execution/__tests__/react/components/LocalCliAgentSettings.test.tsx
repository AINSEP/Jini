// @vitest-environment jsdom
import { AGENT_ELEMENT_ATTRIBUTE } from '@jini-ai/agentic';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AgentCliEnvFieldSpec, AgentTestState, DetectedAgent } from '../../../types.js';
import { LocalCliAgentSettings } from '../../../react/components/LocalCliAgentSettings.js';
import { useLocalCliAgentCard } from '../../../react/hooks/useLocalCliAgentCard.js';

/**
 * @file The selected CLI's settings strip, rendered directly from the real card hook so a test
 * can also hand it card states the hook does not produce today (see the repair case below).
 */
const CODEX: DetectedAgent = { id: 'codex', label: 'Codex', installed: true };
const BIN_FIELD: AgentCliEnvFieldSpec[] = [{ agentId: 'codex', envKey: 'CODEX_BIN', label: 'Binary path', kind: 'binPath' }];
const FELL_BACK: AgentTestState = {
  status: 'ok',
  agentId: 'codex',
  usedExecutableSource: 'fallback-failed',
  detectedExecutablePath: '/opt/codex',
};

function Harness({
  agentTest,
  agent = CODEX,
  cannotUseDetected = false,
  agentHandle,
}: {
  agentTest: AgentTestState;
  agent?: DetectedAgent;
  cannotUseDetected?: boolean;
  agentHandle?: string;
}) {
  const card = useLocalCliAgentCard({
    agent,
    config: { agentId: 'codex' },
    agentTest,
    cliEnvFields: BIN_FIELD,
    onModelChange: vi.fn(),
    onReasoningChange: vi.fn(),
    t: (key) => key,
  });
  const repair = card.repair && cannotUseDetected ? { ...card.repair, canUseDetected: false } : card.repair;
  return (
    <LocalCliAgentSettings agent={agent} config={{ agentId: 'codex' }} card={{ ...card, repair }} cliEnvFields={BIN_FIELD}
      onModelChange={vi.fn()} onEnvChange={vi.fn()} agentHandle={agentHandle} />
  );
}

describe('LocalCliAgentSettings — test result line', () => {
  it('says the agent is ready when a passing test carries no message', () => {
    render(<Harness agentTest={{ status: 'ok', agentId: 'codex' }} />);
    expect(screen.getByRole('status')).toHaveTextContent(/^Agent is ready\.$/);
  });

  it('shows a passing test\'s own message when it carries one', () => {
    render(<Harness agentTest={{ status: 'ok', agentId: 'codex', message: 'codex 1.4 ready' }} />);
    expect(screen.getByRole('status')).toHaveTextContent(/^codex 1\.4 ready$/);
  });

  it('announces a failing test as an alert with its own message', () => {
    render(<Harness agentTest={{ status: 'error', agentId: 'codex', message: 'codex: not logged in' }} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/^codex: not logged in$/);
  });

  it('renders no result line before any test ran', () => {
    render(<Harness agentTest={{ status: 'idle' }} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('LocalCliAgentSettings — executable path repair', () => {
  it('offers only "clear custom path" when the detected path cannot be vouched for', () => {
    render(<Harness agentTest={FELL_BACK} cannotUseDetected />);
    expect(screen.queryByTestId('jini-agent-path-repair-use-codex')).not.toBeInTheDocument();
    expect(screen.getByTestId('jini-agent-path-repair-clear-codex')).toBeInTheDocument();
  });

  it('offers both repair actions when the detected path can be used', () => {
    render(<Harness agentTest={FELL_BACK} />);
    expect(screen.getByTestId('jini-agent-path-repair-use-codex')).toBeInTheDocument();
  });
});

describe('LocalCliAgentSettings — agent handles', () => {
  const withModels: DetectedAgent = { ...CODEX, models: [{ id: 'm1', label: 'Model One' }] };

  it('gives the model picker a sub-handle of the card handle', () => {
    render(<Harness agentTest={{ status: 'idle' }} agent={withModels} agentHandle="settings-cli-codex" />);
    expect(screen.getByTestId('jini-agent-model-codex')).toHaveAttribute(AGENT_ELEMENT_ATTRIBUTE, 'settings-cli-codex-model');
  });

  it('publishes no handle on the model picker without a card handle', () => {
    render(<Harness agentTest={{ status: 'idle' }} agent={withModels} />);
    expect(screen.getByTestId('jini-agent-model-codex')).not.toHaveAttribute(AGENT_ELEMENT_ATTRIBUTE);
  });
});
