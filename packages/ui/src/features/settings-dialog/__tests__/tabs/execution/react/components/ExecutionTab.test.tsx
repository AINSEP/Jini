import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../../../i18n/index.js';
import { createFakeExecutionPort } from '@jini-ai/ui-core';
import { ExecutionTab } from '../../../../../tabs/execution/react/components/ExecutionTab.js';
import type { ExecutionConfig, ProviderPreset } from '@jini-ai/ui-core';

function config(overrides: Partial<ExecutionConfig> = {}): ExecutionConfig {
  return {
    mode: 'byok',
    byok: {
      protocol: 'anthropic',
      providerId: 'anthropic',
      apiKey: 'sk-test',
      baseUrl: 'https://api.example.com',
      model: 'example-model',
    },
    localCli: { agentId: null },
    ...overrides,
  };
}

const PRESETS: ProviderPreset[] = [
  {
    id: 'anthropic',
    title: 'Anthropic',
    protocol: 'anthropic',
    baseUrl: 'https://api.example.com',
    preferredModels: ['example-model'],
    kind: 'protocol',
  },
  {
    id: 'gw',
    title: 'Example Gateway',
    protocol: 'openai',
    baseUrl: 'https://gw.example.com/v1',
    preferredModels: ['gw-model'],
    kind: 'gateway',
  },
];

describe('ExecutionTab', () => {
  it('marks the active mode and switches on click without discarding BYOK credentials', async () => {
    const onConfigChange = vi.fn();
    render(
      <ExecutionTab
        config={config()}
        onConfigChange={onConfigChange}
        port={createFakeExecutionPort()}
        presets={PRESETS}
      />,
    );
    expect(screen.getByRole('tab', { name: /BYOK/ })).toHaveAttribute('aria-selected', 'true');

    await userEvent.click(screen.getByRole('tab', { name: /Local CLI/ }));
    expect(onConfigChange).toHaveBeenCalledTimes(1);
    const next = onConfigChange.mock.calls[0]![0] as ExecutionConfig;
    expect(next.mode).toBe('local-cli');
    expect(next.byok.apiKey).toBe('sk-test');
  });

  it('renders protocol and gateway chip rows and adopts a preset on select', async () => {
    const onConfigChange = vi.fn();
    render(
      <ExecutionTab
        config={config()}
        onConfigChange={onConfigChange}
        port={createFakeExecutionPort()}
        presets={PRESETS}
      />,
    );
    expect(screen.getByRole('tablist', { name: 'Protocols' })).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Gateways' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: /Example Gateway/ }));
    const next = onConfigChange.mock.calls[0]![0] as ExecutionConfig;
    expect(next.byok).toMatchObject({
      providerId: 'gw',
      protocol: 'openai',
      baseUrl: 'https://gw.example.com/v1',
      model: 'gw-model',
    });
  });

  it('disables Local CLI with the host-supplied reason when it is unavailable', () => {
    render(
      <ExecutionTab
        config={config()}
        onConfigChange={() => {}}
        port={createFakeExecutionPort()}
        presets={PRESETS}
        localCliUnavailableReason="Not available on this deployment"
      />,
    );
    const localCli = screen.getByRole('tab', { name: /Local CLI/ });
    expect(localCli).toBeDisabled();
    expect(screen.getByText('Not available on this deployment')).toBeInTheDocument();
  });

  it('lists detected local agents, installed first', async () => {
    render(
      <ExecutionTab
        config={config({ mode: 'local-cli' })}
        onConfigChange={() => {}}
        port={createFakeExecutionPort()}
        presets={PRESETS}
      />,
    );
    await waitFor(() => expect(screen.getByText('Example Agent CLI')).toBeInTheDocument());
    const cards = screen
      .getAllByTestId(/^jini-agent-card-/)
      .map((card) => card.textContent ?? '');
    expect(cards[0]).toContain('Example Agent CLI');
    expect(cards[1]).toContain('Another Agent CLI');
    expect(screen.getByText('Not installed')).toBeInTheDocument();
  });

  it('renders the vendor tagline, version, and badges on an agent card', async () => {
    render(
      <ExecutionTab
        config={config({ mode: 'local-cli' })}
        onConfigChange={() => {}}
        port={createFakeExecutionPort()}
        presets={PRESETS}
      />,
    );
    await waitFor(() => expect(screen.getByText('Example Agent CLI')).toBeInTheDocument());
    expect(screen.getByText('Example vendor CLI')).toBeInTheDocument();
    expect(screen.getByText('1.4.0')).toBeInTheDocument();
    expect(screen.getByText('Official')).toBeInTheDocument();
  });

  it('says authentication is required rather than reporting a version', async () => {
    render(
      <ExecutionTab
        config={config({ mode: 'local-cli' })}
        onConfigChange={() => {}}
        port={createFakeExecutionPort({
          agents: [
            {
              id: 'agent-a',
              label: 'Example Agent CLI',
              installed: true,
              version: '1.4.0',
              authStatus: 'missing',
              authMessage: 'Run `agent-a login` first.',
            },
          ],
        })}
        presets={PRESETS}
      />,
    );
    await waitFor(() => expect(screen.getByText('Authentication required')).toBeInTheDocument());
    expect(screen.queryByText('1.4.0')).not.toBeInTheDocument();
    expect(screen.getByTitle('Run `agent-a login` first.')).toBeInTheDocument();
  });

  it('selects an agent and records a per-agent model pick', async () => {
    const onConfigChange = vi.fn();
    const base = config({ mode: 'local-cli' });
    const { rerender } = render(
      <ExecutionTab
        config={base}
        onConfigChange={onConfigChange}
        port={createFakeExecutionPort()}
        presets={PRESETS}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('jini-agent-select-agent-a')).toBeEnabled());
    await userEvent.click(screen.getByTestId('jini-agent-select-agent-a'));
    expect(onConfigChange).toHaveBeenCalledWith(
      expect.objectContaining({ localCli: { agentId: 'agent-a' } }),
    );

    const selected = { ...base, localCli: { agentId: 'agent-a' } };
    rerender(
      <ExecutionTab
        config={selected}
        onConfigChange={onConfigChange}
        port={createFakeExecutionPort()}
        presets={PRESETS}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('jini-agent-model-agent-a')).toBeInTheDocument());
    await userEvent.click(within(screen.getByTestId('jini-agent-model-agent-a')).getByRole('combobox'));
    await userEvent.click(screen.getByText('Example Small'));
    expect(onConfigChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        localCli: { agentId: 'agent-a', modelByAgentId: { 'agent-a': 'example-model-small' } },
      }),
    );
  });

  it('wires reasoning picks and CLI env-field edits all the way through onConfigChange', async () => {
    const onConfigChange = vi.fn();
    render(
      <ExecutionTab
        config={{ ...config({ mode: 'local-cli' }), localCli: { agentId: 'agent-a' } }}
        onConfigChange={onConfigChange}
        port={createFakeExecutionPort({
          agents: [
            {
              id: 'agent-a',
              label: 'Example Agent CLI',
              installed: true,
              models: [{ id: 'm1', label: 'Model One' }],
              reasoningOptions: [
                { id: 'low', label: 'Low' },
                { id: 'high', label: 'High' },
              ],
            },
          ],
        })}
        presets={PRESETS}
        cliEnvFields={[{ agentId: 'agent-a', envKey: 'AGENT_A_BASE_URL', label: 'Base URL' }]}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('jini-agent-reasoning-agent-a')).toBeInTheDocument());

    await userEvent.selectOptions(screen.getByTestId('jini-agent-reasoning-agent-a'), 'high');
    expect(onConfigChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        localCli: expect.objectContaining({ reasoningByAgentId: { 'agent-a': 'high' } }),
      }),
    );

    const envInput = screen.getByTestId('jini-agent-cli-env-agent-a-AGENT_A_BASE_URL');
    await userEvent.type(envInput, 'x');
    expect(onConfigChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        localCli: expect.objectContaining({ envByAgentId: { 'agent-a': { AGENT_A_BASE_URL: 'x' } } }),
      }),
    );
  });

  it('defaults cliEnvFields to the package starter catalog when the host supplies none', async () => {
    render(
      <ExecutionTab
        config={{ ...config({ mode: 'local-cli' }), localCli: { agentId: 'claude' } }}
        onConfigChange={() => {}}
        port={createFakeExecutionPort({
          agents: [{ id: 'claude', label: 'Claude Code', installed: true }],
        })}
        presets={PRESETS}
      />,
    );
    // `claude` is in this package's DEFAULT_AGENT_CLI_ENV_FIELDS catalog —
    // its env-fields disclosure should render without the host passing a
    // `cliEnvFields` prop at all.
    await waitFor(() => expect(screen.getByTestId('jini-agent-cli-env-claude')).toBeInTheDocument());
  });

  it('reports a per-agent test failure that could not run at all', async () => {
    render(
      <ExecutionTab
        config={{ ...config({ mode: 'local-cli' }), localCli: { agentId: 'agent-a' } }}
        onConfigChange={() => {}}
        port={createFakeExecutionPort({ agentTestError: 'spawn agent-a ENOENT' })}
        presets={PRESETS}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('jini-agent-test-agent-a')).toBeInTheDocument());
    await userEvent.click(screen.getByTestId('jini-agent-test-agent-a'));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('spawn agent-a ENOENT'),
    );
  });

  it('keeps a saved model pick selectable after it leaves the reported list', async () => {
    render(
      <ExecutionTab
        config={{
          ...config({ mode: 'local-cli' }),
          localCli: { agentId: 'agent-a', modelByAgentId: { 'agent-a': 'retired-model' } },
        }}
        onConfigChange={() => {}}
        port={createFakeExecutionPort()}
        presets={PRESETS}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('jini-agent-model-agent-a')).toBeInTheDocument());
    // A value that isn't in the reported model list automatically routes to
    // the free-text "custom model" input (see `shouldShowCustomModelInput`)
    // rather than being silently dropped or snapped to the first option —
    // either of which would change what runs without the operator touching
    // anything.
    expect(screen.getByTestId('jini-agent-model-custom-agent-a')).toHaveValue('retired-model');
  });

  it('reports a successful connection test through the port', async () => {
    render(
      <ExecutionTab
        config={config()}
        onConfigChange={() => {}}
        port={createFakeExecutionPort()}
        presets={PRESETS}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Connection succeeded'));
  });

  it('surfaces a failed connection test as an alert', async () => {
    render(
      <ExecutionTab
        config={config()}
        onConfigChange={() => {}}
        port={createFakeExecutionPort({ testResult: { ok: false, message: 'Unauthorized' } })}
        presets={PRESETS}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Unauthorized'));
  });

  it('blocks the connection test while a required field is missing', () => {
    render(
      <ExecutionTab
        config={config({ byok: { ...config().byok, apiKey: '' } })}
        onConfigChange={() => {}}
        port={createFakeExecutionPort()}
        presets={PRESETS}
      />,
    );
    expect(screen.getByRole('button', { name: 'Test connection' })).toBeDisabled();
  });

  it('discovers models on mount and offers them as suggestions', async () => {
    render(
      <ExecutionTab
        config={config()}
        onConfigChange={() => {}}
        port={createFakeExecutionPort({ models: ['claude-opus-4-5', 'claude-haiku-4-5'] })}
        presets={PRESETS}
      />,
    );
    await waitFor(() => expect(document.querySelector('option[value="claude-opus-4-5"]')).not.toBeNull());
    expect(document.querySelector('option[value="claude-haiku-4-5"]')).not.toBeNull();
  });

  it('surfaces a model-discovery failure as a non-blocking inline hint, and the field stays usable with the preset\'s suggestions', async () => {
    render(
      <ExecutionTab
        config={config()}
        onConfigChange={() => {}}
        port={createFakeExecutionPort({ modelsError: 'invalid API key' })}
        presets={PRESETS}
      />,
    );
    // Surfaced (§3.3): a rendering path exists and actually renders.
    await waitFor(() => expect(screen.getByText(/Could not load live models: invalid API key/)).toBeInTheDocument());
    // Non-blocking (§3.2): the Model input is not disabled, and — because live
    // discovery failed — the preset's own static suggestion is still offered.
    const modelInput = screen.getByDisplayValue('example-model');
    expect(modelInput).not.toBeDisabled();
    expect(document.querySelector('option[value="example-model"]')).not.toBeNull();
  });

  it('renders translated copy when mounted under an I18nProvider with a matching dictionary', () => {
    render(
      <I18nProvider
        dictionaries={{ fr: { 'Local CLI': 'CLI locale', BYOK: 'Clés perso', Protocols: 'Protocoles' } }}
        initialLocale="fr"
      >
        <ExecutionTab
          config={config()}
          onConfigChange={() => {}}
          port={createFakeExecutionPort()}
          presets={PRESETS}
        />
      </I18nProvider>,
    );
    expect(screen.getByText('CLI locale')).toBeInTheDocument();
    expect(screen.getByText('Clés perso')).toBeInTheDocument();
    expect(screen.getByText('Protocoles')).toBeInTheDocument();
  });
});

describe('ExecutionTab — model provenance', () => {
  it('makes no provenance claim when the host did not report one', async () => {
    render(
      <ExecutionTab
        config={{ ...config({ mode: 'local-cli' }), localCli: { agentId: 'agent-a' } }}
        onConfigChange={() => {}}
        port={createFakeExecutionPort({
          agents: [
            {
              id: 'agent-a',
              label: 'Example Agent CLI',
              installed: true,
              // No `modelsSource` — the host simply did not say.
              models: [{ id: 'm1', label: 'Model One' }],
            },
          ],
        })}
        presets={PRESETS}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('jini-agent-model-agent-a')).toBeInTheDocument());
    // Calling an unlabelled list "Built-in list" told the operator to Rescan to
    // fix a staleness problem they may not have.
    expect(screen.queryByText('Built-in list')).not.toBeInTheDocument();
    expect(screen.queryByText('Live from CLI')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Showing built-in defaults. Click Rescan to pull live models from the CLI.'),
    ).not.toBeInTheDocument();
  });
});
