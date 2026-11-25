import { fireEvent, render, screen, waitFor } from '../../../../../__tests__/ui-kit-render-support.js';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createFakeExecutionPort } from '../../../dependencies.js';
import type { ExecutionConfig, ExecutionPort, ProviderPreset } from '@jini-ai/core/contracts/execution';
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

const KEY = `sk-test-${'0'.repeat(32)}`;
const SAVED = 'https://api.example.invalid/v1';
const DRAFT = 'https://draft.example.invalid/v1';
const ENDPOINT_PRESETS: ProviderPreset[] = [
  { id: 'anthropic', title: 'Anthropic', protocol: 'anthropic', baseUrl: SAVED, preferredModels: ['m'], kind: 'protocol' },
  { id: 'gw', title: 'Example Gateway', protocol: 'openai', baseUrl: 'https://gw.example.invalid/v1', preferredModels: ['m'], kind: 'gateway' },
  { id: 'fixed', title: 'Fixed Gateway', protocol: 'openai', baseUrl: '', preferredModels: ['m'], kind: 'gateway', fixedOrigin: true },
];

/** A host that keeps the config in state, so typed input, preset picks and Test Connection all see
 *  the config they produced — the way a real settings screen drives the tab. */
function mountStateful({ byok = {}, canDiscoverModels = true, wrapInForm = false }: {
  byok?: Partial<ExecutionConfig['byok']>; canDiscoverModels?: boolean; wrapInForm?: boolean;
} = {}) {
  const port = createFakeExecutionPort({ models: ['m'] });
  const listModels = vi.spyOn(port, 'listModels');
  const testConnection = vi.spyOn(port, 'testConnection');
  const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
  const initial = config({ byok: { protocol: 'anthropic', providerId: 'anthropic', apiKey: KEY, baseUrl: SAVED, model: 'm', ...byok } });
  function Host() {
    const [current, setCurrent] = useState(initial);
    const tab = <ExecutionTab config={current} onConfigChange={setCurrent} port={port} presets={ENDPOINT_PRESETS} canDiscoverModels={canDiscoverModels} />;
    return wrapInForm ? <form onSubmit={onSubmit}>{tab}<button type="submit">Save</button></form> : tab;
  }
  render(<Host />);
  const baseUrlInput = () => document.querySelector<HTMLInputElement>('input[type="url"]')!;
  const probedUrls = () => listModels.mock.calls.map(([probed]) => probed.baseUrl);
  return { listModels, testConnection, onSubmit, baseUrlInput, probedUrls };
}

describe('ExecutionTab BYOK endpoint approval', () => {
  it('blur with a complete URL probes once', async () => {
    const { baseUrlInput, probedUrls } = mountStateful();
    expect(probedUrls()).toEqual([SAVED]);
    await userEvent.clear(baseUrlInput());
    await userEvent.type(baseUrlInput(), DRAFT);
    expect(probedUrls()).toEqual([SAVED]);
    await userEvent.tab();
    expect(probedUrls()).toEqual([SAVED, DRAFT]);
    await userEvent.click(baseUrlInput());
    await userEvent.keyboard('{Enter}');
    await userEvent.tab();
    expect(probedUrls()).toEqual([SAVED, DRAFT]);
  });

  it('Enter in the Base URL field commits without submitting an enclosing form', async () => {
    const { baseUrlInput, probedUrls, onSubmit } = mountStateful({ wrapInForm: true });
    fireEvent.change(baseUrlInput(), { target: { value: DRAFT } });
    expect(fireEvent.keyDown(baseUrlInput(), { key: 'Enter' })).toBe(false);
    expect(probedUrls()).toEqual([SAVED, DRAFT]);
    await userEvent.click(baseUrlInput());
    await userEvent.keyboard('{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('Enter during IME composition does not commit', () => {
    const { baseUrlInput, probedUrls } = mountStateful();
    fireEvent.change(baseUrlInput(), { target: { value: DRAFT } });
    fireEvent.keyDown(baseUrlInput(), { key: 'Enter', isComposing: true });
    expect(probedUrls()).toEqual([SAVED]);
  });

  it('a deliberate preset pick still discovers its default endpoint', async () => {
    const { probedUrls } = mountStateful();
    await userEvent.click(screen.getByRole('tab', { name: /Example Gateway/ }));
    expect(probedUrls()).toEqual([SAVED, 'https://gw.example.invalid/v1']);
  });

  it('a preset pick restoring a saved non-default Base URL does not probe it', async () => {
    const restored = 'https://restored.example.invalid/v1';
    const { probedUrls, baseUrlInput } = mountStateful({ byok: { savedByProviderId: { gw: { apiKey: KEY, baseUrl: restored, model: 'm' } } } });
    await userEvent.click(screen.getByRole('tab', { name: /Example Gateway/ }));
    expect(baseUrlInput().value).toBe(restored);
    expect(probedUrls()).toEqual([SAVED]);
  });

  it('Test Connection on an invalid draft calls neither probe port', async () => {
    const { listModels, testConnection } = mountStateful({ byok: { protocol: 'openai', providerId: 'fixed', baseUrl: 'not a url' } });
    const button = screen.getByRole('button', { name: 'Test connection' });
    expect(button).toBeEnabled();
    await userEvent.click(button);
    expect(testConnection).not.toHaveBeenCalled();
    expect(listModels).not.toHaveBeenCalled();
  });

  it('Test Connection on a new valid endpoint tests it once and discovers it once, automatically', () => {
    const { baseUrlInput, probedUrls, testConnection } = mountStateful();
    fireEvent.change(baseUrlInput(), { target: { value: ` ${DRAFT} ` } });
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(testConnection).toHaveBeenCalledTimes(1);
    expect(testConnection).toHaveBeenLastCalledWith(expect.objectContaining({ baseUrl: DRAFT }));
    expect(probedUrls()).toEqual([SAVED, DRAFT]);
  });

  it('Test Connection on an approved endpoint retries discovery only with both discovery gates open', () => {
    const { probedUrls, testConnection } = mountStateful();
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(testConnection).toHaveBeenCalledTimes(1);
    expect(probedUrls()).toEqual([SAVED, SAVED]);
  });

  it('Test Connection on an approved endpoint does not discover while discovery is not allowed', () => {
    const { listModels, testConnection } = mountStateful({ canDiscoverModels: false });
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(testConnection).toHaveBeenCalledTimes(1);
    expect(listModels).not.toHaveBeenCalled();
  });
});
