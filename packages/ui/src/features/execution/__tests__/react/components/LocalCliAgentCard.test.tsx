// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type {
  AgentCliEnvFieldSpec,
  AgentTestState,
  DetectedAgent,
  LocalCliConfig,
} from '../../../types.js';
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

/**
 * The second reasoning shape: a runtime whose effort rides INSIDE the model id
 * (`DetectedAgent.reasoningInModelId`; antigravity is the only declarer today).
 *
 * The card must branch on that DECLARATION, never on the agent's id — and the effort options it
 * offers must come from the agent's own model list, because the levels are not uniform across base
 * models. The fixture below is `agy models`' real output; `gemini-3.1-pro` genuinely has no
 * `-medium` variant, and `agy --model gemini-3.1-pro-medium` is rejected outright.
 */
describe('LocalCliAgentCard — effort encoded in the model id', () => {
  const AGY_MODELS = [
    { id: 'default', label: 'Default (CLI config)' },
    { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)' },
    { id: 'gemini-3.8-flash-medium', label: 'Gemini 3.8 Flash (Medium)' },
    { id: 'gemini-3.8-flash-low', label: 'Gemini 3.8 Flash (Low)' },
    { id: 'gemini-3.1-pro-high', label: 'Gemini 3.1 Pro (High)' },
    { id: 'gemini-3.1-pro-low', label: 'Gemini 3.1 Pro (Low)' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (Thinking)' },
    { id: 'gpt-oss-120b-medium', label: 'GPT-OSS 120B (Medium)' },
  ];
  const REASONING_IN_MODEL_ID = {
    levels: [
      { id: 'high', label: 'High' },
      { id: 'medium', label: 'Medium' },
      { id: 'low', label: 'Low' },
    ],
  };

  function agyAgent(overrides: Partial<DetectedAgent> = {}): DetectedAgent {
    return {
      id: 'antigravity',
      label: 'Antigravity',
      installed: true,
      supportsCustomModel: false,
      models: AGY_MODELS,
      modelsSource: 'live',
      reasoningInModelId: REASONING_IN_MODEL_ID,
      ...overrides,
    };
  }

  function renderAgy(config: LocalCliConfig, onModelChange = vi.fn()) {
    renderCard({ agent: agyAgent(), config, onModelChange });
    return onModelChange;
  }

  /** The effort control is a plain `<select>` (same element the flat reasoning picker uses), so its
   *  options are readable without opening anything. */
  function effortOptionValues() {
    return within(screen.getByTestId('jini-agent-reasoning-antigravity'))
      .getAllByRole('option')
      .map((option) => (option as HTMLOptionElement).value);
  }

  /** The model control is a `CustomSelect`, whose options exist only while its portal menu is
   *  open — so reading them means opening it first, exactly as the model-picker tests above do. */
  async function openModelMenu(user: ReturnType<typeof userEvent.setup>) {
    await user.click(within(screen.getByTestId('jini-agent-model-antigravity')).getByRole('combobox'));
    // Scoped to the portal menu's own listbox: the effort control is a native `<select>`, whose
    // own `<option>`s would otherwise be swept up by a document-wide `getAllByRole('option')`.
    return within(screen.getByRole('listbox'))
      .getAllByRole('option')
      .map((option) => option.textContent?.trim() ?? '');
  }

  it('offers one entry per BASE model, with the effort qualifier stripped from the label', async () => {
    const user = userEvent.setup();
    renderAgy({ agentId: 'antigravity', modelByAgentId: { antigravity: 'gemini-3.1-pro-high' } });
    const labels = await openModelMenu(user);
    expect(labels).toEqual([
      'Default (CLI config)',
      'Gemini 3.8 Flash',
      'Gemini 3.1 Pro',
      'Claude Sonnet 4.6 (Thinking)',
      'GPT-OSS 120B',
    ]);
    expect(labels).not.toContain('Gemini 3.1 Pro (High)');
  });

  // THE regression this whole feature exists to prevent.
  it('offers gemini-3.1-pro exactly High and Low — never a Medium that does not exist', () => {
    renderAgy({ agentId: 'antigravity', modelByAgentId: { antigravity: 'gemini-3.1-pro-high' } });
    expect(effortOptionValues()).toEqual(['high', 'low']);
    expect(effortOptionValues()).not.toContain('medium');
  });

  it('offers all three levels for a base that really has all three', () => {
    renderAgy({ agentId: 'antigravity', modelByAgentId: { antigravity: 'gemini-3.8-flash-medium' } });
    expect(effortOptionValues()).toEqual(['high', 'medium', 'low']);
  });

  it('renders no effort control at all for a base model with no variants', () => {
    renderAgy({ agentId: 'antigravity', modelByAgentId: { antigravity: 'claude-sonnet-4-6' } });
    expect(screen.queryByTestId('jini-agent-reasoning-antigravity')).not.toBeInTheDocument();
  });

  // The state the card opens in before any per-agent model has been saved: `selectedAgentModel`
  // falls back to `models[0].id`, which for antigravity IS the "Default (CLI config)" sentinel
  // (`DEFAULT_MODEL_OPTION`, first entry in both `fallbackModels` and a live `agy models` list).
  // That sentinel groups like any other base with zero suffixed variants (nothing named
  // `default-high`/`default-medium`/`default-low` exists), so it is hidden by the SAME rule that
  // hides `claude-sonnet-4-6` above — not a separate gap in the null-check on `activeGroup`.
  it('renders no effort control in the model-unsaved state the card opens in, same as any other zero-variant base', () => {
    renderAgy({ agentId: 'antigravity' });
    expect(screen.queryByTestId('jini-agent-reasoning-antigravity')).not.toBeInTheDocument();
  });

  it('renders the single level a one-variant base has, disabled, rather than inventing siblings', () => {
    renderAgy({ agentId: 'antigravity', modelByAgentId: { antigravity: 'gpt-oss-120b-medium' } });
    expect(effortOptionValues()).toEqual(['medium']);
    expect(screen.getByTestId('jini-agent-reasoning-antigravity')).toBeDisabled();
  });

  it('picking an effort level rewrites the MODEL id, not a separate reasoning value', async () => {
    const user = userEvent.setup();
    const onModelChange = vi.fn();
    const onReasoningChange = vi.fn();
    renderCard({
      agent: agyAgent(),
      config: { agentId: 'antigravity', modelByAgentId: { antigravity: 'gemini-3.1-pro-high' } },
      onModelChange,
      onReasoningChange,
    });
    await user.selectOptions(screen.getByTestId('jini-agent-reasoning-antigravity'), 'low');
    expect(onModelChange).toHaveBeenCalledWith('antigravity', 'gemini-3.1-pro-low');
    expect(onReasoningChange).not.toHaveBeenCalled();
  });

  // Carrying `medium` over from gemini-3.8-flash must not compose `gemini-3.1-pro-medium`.
  it('switching to a base without the current level lands on one that base really has', async () => {
    const user = userEvent.setup();
    const onModelChange = vi.fn();
    renderAgy({ agentId: 'antigravity', modelByAgentId: { antigravity: 'gemini-3.8-flash-medium' } }, onModelChange);
    await openModelMenu(user);
    await user.click(screen.getByText('Gemini 3.1 Pro'));
    expect(onModelChange).toHaveBeenCalledWith('antigravity', 'gemini-3.1-pro-high');
    expect(onModelChange).not.toHaveBeenCalledWith('antigravity', 'gemini-3.1-pro-medium');
  });

  it('switching to a base keeps the current level when that base really has it', async () => {
    const user = userEvent.setup();
    const onModelChange = vi.fn();
    renderAgy({ agentId: 'antigravity', modelByAgentId: { antigravity: 'gemini-3.1-pro-low' } }, onModelChange);
    await openModelMenu(user);
    await user.click(screen.getByText('Gemini 3.8 Flash'));
    expect(onModelChange).toHaveBeenCalledWith('antigravity', 'gemini-3.8-flash-low');
  });

  it('shows the saved slug as its base + level, so a reload renders the operator\'s own pick', () => {
    renderAgy({ agentId: 'antigravity', modelByAgentId: { antigravity: 'gemini-3.1-pro-low' } });
    // `CustomSelect` puts the selected label in the trigger's own accessible name.
    expect(
      within(screen.getByTestId('jini-agent-model-antigravity')).getByRole('combobox'),
    ).toHaveAccessibleName('Model: Gemini 3.1 Pro');
    expect(screen.getByTestId('jini-agent-reasoning-antigravity')).toHaveValue('low');
  });

  // The card must not grow an `if (agent.id === 'antigravity')`: a flag-based runtime keeps the
  // flat control, and a model-suffix runtime gets the derived one, purely from the declaration.
  it('keeps the flat reasoning control for a runtime that declares reasoningOptions instead', () => {
    renderCard({
      agent: agent({ reasoningOptions: [{ id: 'default', label: 'Default' }, { id: 'high', label: 'High' }] }),
    });
    const select = screen.getByTestId('jini-agent-reasoning-claude');
    expect(within(select).getAllByRole('option').map((option) => (option as HTMLOptionElement).value)).toEqual([
      'default',
      'high',
    ]);
  });
});
