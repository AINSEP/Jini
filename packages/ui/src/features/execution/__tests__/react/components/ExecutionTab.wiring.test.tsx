import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createFakeExecutionPort } from '../../../dependencies.js';
import type { ExecutionPort } from '../../../ports.js';
import type { ExecutionConfig, ProviderPreset } from '../../../types.js';
import { ExecutionTab } from '../../../react/components/ExecutionTab.js';

/**
 * @file The capability-gated wiring `ExecutionTab.test.tsx` leaves implicit: a port without
 * rescan / testAgent / listModels, the agent test's empty-model `undefined`, a config whose BYOK
 * provider matches no preset, and the BYOK card's own edits reaching `onConfigChange`. Pinned before
 * the tab was split into mode-switch / local-CLI / BYOK parts.
 */

const PRESETS: ProviderPreset[] = [
  { id: 'anthropic', title: 'Anthropic', protocol: 'anthropic', baseUrl: 'https://api.example.com', preferredModels: [], kind: 'protocol' },
  { id: 'gw', title: 'Example Gateway', protocol: 'openai', baseUrl: 'https://gw.example.com/v1', preferredModels: [], kind: 'gateway' },
];

function config(overrides: Partial<ExecutionConfig> = {}): ExecutionConfig {
  return {
    mode: 'byok',
    byok: { protocol: 'anthropic', providerId: 'anthropic', apiKey: `sk-test-${'0'.repeat(32)}`, baseUrl: 'https://api.example.com', model: 'm' },
    localCli: { agentId: null },
    ...overrides,
  };
}

/** The fake port minus the named optional capabilities. */
function portWithout(...keys: Array<keyof ExecutionPort>): ExecutionPort {
  const port = { ...createFakeExecutionPort() } as Record<string, unknown>;
  for (const key of keys) delete port[key];
  return port as unknown as ExecutionPort;
}

describe('ExecutionTab capability wiring', () => {
  it('offers neither Rescan nor Test when the port cannot do them', async () => {
    render(
      <ExecutionTab
        config={config({ mode: 'local-cli', localCli: { agentId: 'agent-a' } })}
        onConfigChange={vi.fn()}
        port={portWithout('rescanLocalAgents', 'testAgent')}
        presets={PRESETS}
        agentHandle="exec"
      />,
    );
    await waitFor(() => expect(screen.getByTestId('jini-agent-select-agent-a')).toBeEnabled());
    expect(document.querySelector('.jini-local-cli-rescan')).toBeNull();
    expect(screen.queryByTestId('jini-agent-test-agent-a')).toBeNull();
  });

  it('tests the selected agent with its model, or with no model when none resolves', async () => {
    const port = createFakeExecutionPort({ agents: [{ id: 'agent-z', label: 'Agent Z', installed: true }] });
    const testAgent = vi.spyOn(port, 'testAgent');
    render(
      <ExecutionTab
        config={config({ mode: 'local-cli', localCli: { agentId: 'agent-z' } })}
        onConfigChange={vi.fn()}
        port={port}
        presets={PRESETS}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('jini-agent-test-agent-z')).toBeEnabled());
    await userEvent.click(screen.getByTestId('jini-agent-test-agent-z'));
    expect(testAgent).toHaveBeenCalledWith('agent-z', undefined);
  });

  it('selects no chip when the BYOK provider matches no preset, and still patches the card', () => {
    const onConfigChange = vi.fn();
    const base = config({ byok: { ...config().byok, providerId: null, protocol: 'openai' } });
    render(<ExecutionTab config={base} onConfigChange={onConfigChange} port={createFakeExecutionPort()} presets={PRESETS} />);
    expect(screen.getByText('Custom endpoint')).toBeInTheDocument();
    fireEvent.change(document.querySelector('input[type="number"]')!, { target: { value: '7' } });
    expect(onConfigChange).toHaveBeenLastCalledWith({ ...base, byok: { ...base.byok, maxTokens: 7 } });
  });

  it('Test connection probes without discovering when the port has no listModels', async () => {
    const port = portWithout('listModels');
    const testConnection = vi.spyOn(port, 'testConnection');
    render(<ExecutionTab config={config()} onConfigChange={vi.fn()} port={port} presets={PRESETS} />);
    await userEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(testConnection).toHaveBeenCalledTimes(1);
  });
});
