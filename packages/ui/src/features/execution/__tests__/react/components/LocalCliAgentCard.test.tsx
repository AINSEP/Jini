// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AgentCliEnvFieldSpec, AgentTestState, DetectedAgent, LocalCliConfig } from '@jini-ai/ui-core';
import { LocalCliAgentCard } from '../../../react/components/LocalCliAgentCard.js';

function agent(overrides: Partial<DetectedAgent> = {}): DetectedAgent {
  return { id: 'claude', label: 'Claude Code', installed: true, ...overrides };
}

const IDLE_TEST: AgentTestState = { status: 'idle' };

const CLI_ENV_FIELDS: AgentCliEnvFieldSpec[] = [
  { agentId: 'claude', envKey: 'ANTHROPIC_BASE_URL', label: 'Base URL' },
  { agentId: 'claude', envKey: 'ANTHROPIC_API_KEY', label: 'API key', secret: true },
  { agentId: 'codex', envKey: 'CODEX_BIN', label: 'Binary path', kind: 'binPath' },
];

function renderCard(props: Partial<Parameters<typeof LocalCliAgentCard>[0]> = {}) {
  const defaults: Parameters<typeof LocalCliAgentCard>[0] = {
    agent: agent(),
    config: { agentId: 'claude' },
    selected: true,
    onSelect: vi.fn(),
    onModelChange: vi.fn(),
    onReasoningChange: vi.fn(),
    onEnvChange: vi.fn(),
    cliEnvFields: CLI_ENV_FIELDS,
    agentTest: IDLE_TEST,
  };
  const merged = { ...defaults, ...props };
  render(<LocalCliAgentCard {...merged} />);
  return merged;
}

describe('LocalCliAgentCard — diagnostics', () => {
  it('renders a diagnostic row on an installed card', () => {
    renderCard({
      agent: agent({
        diagnostics: [{ reason: 'auth-missing', severity: 'error', message: 'Not signed in.' }],
      }),
    });
    expect(screen.getByText('Not signed in.')).toBeInTheDocument();
  });

  it('renders diagnostics on a NOT-installed card too — detection status, not selection state', () => {
    renderCard({
      selected: false,
      config: { agentId: null },
      agent: agent({
        installed: false,
        diagnostics: [{ reason: 'not-on-path', severity: 'warning', message: 'Not found on PATH.' }],
      }),
    });
    expect(screen.getByText('Not found on PATH.')).toBeInTheDocument();
  });

  it('renders every diagnostic when there is more than one', () => {
    renderCard({
      agent: agent({
        diagnostics: [
          { reason: 'not-on-path', severity: 'error', message: 'First reason.' },
          { reason: 'auth-unknown', severity: 'info', message: 'Second reason.' },
        ],
      }),
    });
    expect(screen.getByText('First reason.')).toBeInTheDocument();
    expect(screen.getByText('Second reason.')).toBeInTheDocument();
  });

  it('renders no diagnostic rows when the agent has none', () => {
    renderCard({ agent: agent({ diagnostics: [] }) });
    // Not `queryByRole('group')`: the CLI-env `<details>` block (also
    // rendered while selected) carries an implicit "group" role too, so a
    // role-based query would false-positive on that unrelated element.
    expect(document.querySelector('[data-reason]')).not.toBeInTheDocument();
  });

  it('wires the rescan fix action to onRescan', async () => {
    const user = userEvent.setup();
    const onRescan = vi.fn();
    renderCard({
      onRescan,
      agent: agent({
        diagnostics: [{ reason: 'not-on-path', severity: 'error', message: 'Not found.', fixActions: [{ kind: 'rescan' }] }],
      }),
    });
    await user.click(screen.getByRole('button', { name: 'Rescan' }));
    expect(onRescan).toHaveBeenCalledTimes(1);
  });

  it('opens installUrl/docsUrl fix actions in a new tab', async () => {
    const user = userEvent.setup();
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    renderCard({
      agent: agent({
        installUrl: 'https://example.com/install',
        docsUrl: 'https://example.com/docs',
        diagnostics: [
          {
            reason: 'not-on-path',
            severity: 'error',
            message: 'Not installed.',
            fixActions: [{ kind: 'openInstall' }, { kind: 'openDocs' }],
          },
        ],
      }),
    });
    await user.click(screen.getByRole('button', { name: 'Install' }));
    expect(openSpy).toHaveBeenCalledWith('https://example.com/install', '_blank', 'noopener,noreferrer');
    await user.click(screen.getByRole('button', { name: 'Docs' }));
    expect(openSpy).toHaveBeenCalledWith('https://example.com/docs', '_blank', 'noopener,noreferrer');
    openSpy.mockRestore();
  });

  it('does not render an openInstall/openDocs button when the agent has no matching URL', () => {
    renderCard({
      agent: agent({
        diagnostics: [
          {
            reason: 'not-on-path',
            severity: 'error',
            message: 'Not installed.',
            fixActions: [{ kind: 'openInstall' }, { kind: 'openDocs' }],
          },
        ],
      }),
    });
    expect(screen.queryByRole('button', { name: 'Install' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Docs' })).not.toBeInTheDocument();
  });

  it('renders a rescan diagnostic with no button when onRescan is not supplied', () => {
    renderCard({
      onRescan: undefined,
      agent: agent({
        diagnostics: [{ reason: 'not-on-path', severity: 'error', message: 'Not found.', fixActions: [{ kind: 'rescan' }] }],
      }),
    });
    expect(screen.getByText('Not found.')).toBeInTheDocument();
    expect(document.querySelector('.jini-agent-diagnostic-action')).not.toBeInTheDocument();
  });

  it('renders no fix buttons for setEnv/clearEnv/launchOAuth — not wired in this port, same as the origin', () => {
    renderCard({
      onRescan: vi.fn(),
      agent: agent({
        installUrl: 'https://example.com/install',
        docsUrl: 'https://example.com/docs',
        diagnostics: [
          {
            reason: 'configured-bin-invalid',
            severity: 'error',
            message: 'Bad override.',
            fixActions: [
              { kind: 'setEnv', envKey: 'CODEX_BIN' },
              { kind: 'clearEnv', envKey: 'CODEX_BIN' },
              { kind: 'launchOAuth', agentId: 'claude' },
            ],
          },
        ],
      }),
    });
    // Scoped to fix-action buttons specifically — the card's own select/test
    // buttons are always present regardless of diagnostics.
    expect(document.querySelector('.jini-agent-diagnostic-action')).not.toBeInTheDocument();
  });
});

describe('LocalCliAgentCard — CLI env fields', () => {
  it('renders the collapsed env-fields disclosure when selected and the catalog has entries', () => {
    renderCard({ selected: true, config: { agentId: 'claude' } });
    expect(screen.getByTestId('jini-agent-cli-env-claude')).toBeInTheDocument();
  });

  it('does not render env fields when the card is not selected', () => {
    renderCard({ selected: false, config: { agentId: null } });
    expect(screen.queryByTestId('jini-agent-cli-env-claude')).not.toBeInTheDocument();
  });

  it('does not render when the catalog has no fields for this agent', () => {
    renderCard({ agent: agent({ id: 'unknown-agent' }), config: { agentId: 'unknown-agent' } });
    expect(screen.queryByTestId(/jini-agent-cli-env-/)).not.toBeInTheDocument();
  });

  it('editing a field calls onEnvChange with the agent id, env key, and raw value', async () => {
    const user = userEvent.setup();
    const onEnvChange = vi.fn();
    renderCard({ onEnvChange });
    const input = screen.getByTestId('jini-agent-cli-env-claude-ANTHROPIC_BASE_URL');
    await user.type(input, 'x');
    expect(onEnvChange).toHaveBeenLastCalledWith('claude', 'ANTHROPIC_BASE_URL', 'x');
  });

  it('renders a secret-tagged field as a password input, and a plain field as text', () => {
    renderCard();
    expect(screen.getByTestId('jini-agent-cli-env-claude-ANTHROPIC_API_KEY')).toHaveAttribute('type', 'password');
    expect(screen.getByTestId('jini-agent-cli-env-claude-ANTHROPIC_BASE_URL')).toHaveAttribute('type', 'text');
  });
});

describe('LocalCliAgentCard — reasoning picker', () => {
  const reasoningOptions = [
    { id: 'low', label: 'Low' },
    { id: 'high', label: 'High' },
  ];

  it('renders a reasoning select when the agent reports reasoning options', () => {
    renderCard({ agent: agent({ reasoningOptions }) });
    expect(screen.getByTestId('jini-agent-reasoning-claude')).toBeInTheDocument();
  });

  it('does not render a reasoning select when the agent has none', () => {
    renderCard({ agent: agent() });
    expect(screen.queryByTestId('jini-agent-reasoning-claude')).not.toBeInTheDocument();
  });

  it('picking a reasoning option calls onReasoningChange', async () => {
    const user = userEvent.setup();
    const onReasoningChange = vi.fn();
    renderCard({ agent: agent({ reasoningOptions }), onReasoningChange });
    await user.selectOptions(screen.getByTestId('jini-agent-reasoning-claude'), 'high');
    expect(onReasoningChange).toHaveBeenCalledWith('claude', 'high');
  });
});

describe('LocalCliAgentCard — model source hint', () => {
  const models = [{ id: 'm1', label: 'Model One' }];

  it('explains that a live list comes from the CLI itself', () => {
    renderCard({ agent: agent({ models, modelsSource: 'live' }) });
    expect(screen.getByText("Model list comes from this CLI. Default uses the CLI's own config.")).toBeInTheDocument();
  });

  it('explains that a fallback list is built-in and offers Rescan', () => {
    renderCard({ agent: agent({ models, modelsSource: 'fallback' }) });
    expect(
      screen.getByText('Showing built-in defaults. Click Rescan to pull live models from the CLI.'),
    ).toBeInTheDocument();
  });
});

describe('LocalCliAgentCard — custom model input', () => {
  const models = [
    { id: 'm1', label: 'Model One' },
    { id: 'm2', label: 'Model Two' },
  ];

  it('choosing "Custom…" switches to the free-text input and clears the stored model', async () => {
    const user = userEvent.setup();
    const onModelChange = vi.fn();
    renderCard({ agent: agent({ models }), config: { agentId: 'claude' }, onModelChange });
    await user.click(within(screen.getByTestId('jini-agent-model-claude')).getByRole('combobox'));
    await user.click(screen.getByText('Custom…'));
    expect(onModelChange).toHaveBeenCalledWith('claude', '');
    expect(screen.getByTestId('jini-agent-model-custom-claude')).toBeInTheDocument();
  });

  it('typing into the custom input reports the trimmed value', async () => {
    const user = userEvent.setup();
    const onModelChange = vi.fn();
    renderCard({
      agent: agent({ models }),
      config: { agentId: 'claude', modelByAgentId: { claude: 'my-custom-id' } },
      onModelChange,
    });
    // Already routed to custom mode because "my-custom-id" isn't a known model.
    const input = screen.getByTestId('jini-agent-model-custom-claude');
    expect(input).toHaveValue('my-custom-id');
    await user.type(input, 'x');
    expect(onModelChange).toHaveBeenLastCalledWith('claude', 'my-custom-idx');
  });

  it('hides the "Custom…" option when the agent opts out via supportsCustomModel: false', async () => {
    const user = userEvent.setup();
    renderCard({ agent: agent({ models, supportsCustomModel: false }), config: { agentId: 'claude' } });
    await user.click(within(screen.getByTestId('jini-agent-model-claude')).getByRole('combobox'));
    expect(screen.queryByText('Custom…')).not.toBeInTheDocument();
  });

  it('a known model value never shows the custom input', () => {
    renderCard({ agent: agent({ models }), config: { agentId: 'claude', modelByAgentId: { claude: 'm2' } } });
    expect(screen.queryByTestId('jini-agent-model-custom-claude')).not.toBeInTheDocument();
  });

  it('picking a known model from the searchable select exits custom mode', async () => {
    const user = userEvent.setup();
    const onModelChange = vi.fn();
    renderCard({
      agent: agent({ models }),
      config: { agentId: 'claude', modelByAgentId: { claude: 'unknown-stale-id' } },
      onModelChange,
    });
    expect(screen.getByTestId('jini-agent-model-custom-claude')).toBeInTheDocument();
    await user.click(within(screen.getByTestId('jini-agent-model-claude')).getByRole('combobox'));
    await user.click(screen.getByText('Model Two'));
    expect(onModelChange).toHaveBeenCalledWith('claude', 'm2');
  });
});

describe('LocalCliAgentCard — executable path repair', () => {
  const okWithFallback: AgentTestState = {
    status: 'ok',
    agentId: 'codex',
    message: 'Codex is ready',
    usedExecutableSource: 'fallback-invalid',
    detectedExecutablePath: '/usr/local/bin/codex',
  };

  it('offers "use detected path" / "clear custom path" when the test fell back off a bad override', () => {
    renderCard({
      agent: agent({ id: 'codex', label: 'Codex' }),
      config: { agentId: 'codex' },
      agentTest: okWithFallback,
    });
    expect(screen.getByTestId('jini-agent-path-repair-use-codex')).toBeInTheDocument();
    expect(screen.getByTestId('jini-agent-path-repair-clear-codex')).toBeInTheDocument();
  });

  it('"use detected path" writes the detected path into the tagged binPath env field', async () => {
    const user = userEvent.setup();
    const onEnvChange = vi.fn();
    renderCard({
      agent: agent({ id: 'codex', label: 'Codex' }),
      config: { agentId: 'codex' },
      agentTest: okWithFallback,
      onEnvChange,
    });
    await user.click(screen.getByTestId('jini-agent-path-repair-use-codex'));
    expect(onEnvChange).toHaveBeenCalledWith('codex', 'CODEX_BIN', '/usr/local/bin/codex');
  });

  it('"clear custom path" clears the tagged binPath env field', async () => {
    const user = userEvent.setup();
    const onEnvChange = vi.fn();
    renderCard({
      agent: agent({ id: 'codex', label: 'Codex' }),
      config: { agentId: 'codex' },
      agentTest: okWithFallback,
      onEnvChange,
    });
    await user.click(screen.getByTestId('jini-agent-path-repair-clear-codex'));
    expect(onEnvChange).toHaveBeenCalledWith('codex', 'CODEX_BIN', '');
  });

  it('does not offer repair for a normal primary-binary success', () => {
    renderCard({
      agent: agent({ id: 'codex', label: 'Codex' }),
      config: { agentId: 'codex' },
      agentTest: { status: 'ok', agentId: 'codex', message: 'ready', usedExecutableSource: 'primary' },
    });
    expect(screen.queryByTestId('jini-agent-path-repair-use-codex')).not.toBeInTheDocument();
  });

  it('does not offer repair when the catalog has no binPath-tagged field for this agent', () => {
    renderCard({
      agent: agent({ id: 'claude' }),
      config: { agentId: 'claude' },
      agentTest: {
        status: 'ok',
        agentId: 'claude',
        message: 'ready',
        usedExecutableSource: 'fallback-invalid',
        detectedExecutablePath: '/usr/local/bin/claude',
      },
    });
    expect(screen.queryByTestId(/jini-agent-path-repair-use-/)).not.toBeInTheDocument();
  });

  it('does not offer repair for a failed test', () => {
    renderCard({
      agent: agent({ id: 'codex', label: 'Codex' }),
      config: { agentId: 'codex' },
      agentTest: { status: 'error', agentId: 'codex', message: 'still broken' },
    });
    expect(screen.queryByTestId('jini-agent-path-repair-use-codex')).not.toBeInTheDocument();
  });
});
