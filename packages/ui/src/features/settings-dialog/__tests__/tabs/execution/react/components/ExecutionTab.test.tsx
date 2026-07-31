import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../../../i18n/index.js';
import { createFakeExecutionPort } from '../../../../../tabs/execution/dependencies.js';
import { ExecutionTab } from '../../../../../tabs/execution/react/components/ExecutionTab.js';
import type { ExecutionConfig, ProviderPreset } from '../../../../../tabs/execution/types.js';

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
    const rows = screen.getAllByRole('listitem').map((row) => row.textContent ?? '');
    expect(rows[0]).toContain('Example Agent CLI');
    expect(rows[1]).toContain('Another Agent CLI');
    expect(screen.getByText('Not installed')).toBeInTheDocument();
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
