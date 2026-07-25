import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  AgentRuntimePicker,
  runtimeAgentStatus,
  runtimeOptionLabel,
  runtimePopoverPosition,
} from '../react/components/AgentRuntimePicker.js';
import type { ChatPaneAgent, ChatPaneAgentSelection } from '../types.js';

const agents: ChatPaneAgent[] = [
  {
    id: 'codex',
    name: 'Codex CLI',
    available: true,
    version: 'codex-cli 0.145.0',
    models: [
      { id: 'default', label: 'Default model' },
      { id: 'gpt-5.6-terra', label: 'GPT-5.6-Terra' },
    ],
    reasoningOptions: [
      { id: 'medium', label: 'Medium' },
      { id: 'high', label: 'High' },
    ],
  },
  {
    id: 'claude',
    name: 'Claude Code',
    available: true,
    version: '2.1.201',
    models: [{ id: 'sonnet', label: 'Sonnet' }],
  },
  {
    id: 'missing',
    name: 'Missing Agent',
    available: false,
    diagnostic: 'Not found on PATH',
  },
];

function PickerHarness({
  onRescan,
  placement = 'up',
}: {
  onRescan?: () => void;
  placement?: 'up' | 'down';
}) {
  const value: ChatPaneAgentSelection = {
    agentId: 'codex',
    model: 'gpt-5.6-terra',
    reasoning: 'medium',
  };
  return (
    <AgentRuntimePicker
      agents={agents}
      value={value}
      onChange={vi.fn()}
      {...(onRescan === undefined ? {} : { onRescan })}
      placement={placement}
    />
  );
}

describe('AgentRuntimePicker', () => {
  it('maps known and fallback runtime presentation details', () => {
    expect(runtimeAgentStatus({
      id: 'missing',
      name: 'Missing',
      available: false,
      diagnostic: 'Custom diagnostic',
    })).toBe('Custom diagnostic');
    expect(runtimeAgentStatus({ id: 'missing', name: 'Missing', available: false }))
      .toBe('Not found on PATH');
    expect(runtimeAgentStatus({ id: 'auth', name: 'Auth', authStatus: 'missing' }))
      .toBe('Installed · sign-in required');
    expect(runtimeAgentStatus({ id: 'versioned', name: 'Versioned', version: '1.2.3' }))
      .toBe('1.2.3');
    expect(runtimeAgentStatus({ id: 'installed', name: 'Installed' })).toBe('Installed');

    const options = [{ id: 'high', label: 'High' }];
    expect(runtimeOptionLabel(options, undefined, 'Default')).toBe('Default');
    expect(runtimeOptionLabel(options, 'default', 'Default')).toBe('Default');
    expect(runtimeOptionLabel(options, 'high', 'Default')).toBe('High');
    expect(runtimeOptionLabel(undefined, 'custom', 'Default')).toBe('custom');
  });

  it('calculates bounded upward and downward portal geometry', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 });
    const middle = {
      left: 400,
      width: 120,
      top: 500,
      bottom: 540,
    } as DOMRect;
    expect(runtimePopoverPosition(middle, 'up')).toMatchObject({
      left: 300,
      bottom: 276,
      width: 320,
      maxHeight: 480,
    });
    expect(runtimePopoverPosition(middle, 'down')).toMatchObject({
      left: 300,
      top: 548,
      width: 320,
      maxHeight: 208,
    });

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 300 });
    expect(runtimePopoverPosition({ ...middle, left: -200, top: 50 } as DOMRect, 'up'))
      .toMatchObject({ left: 12, width: 276, maxHeight: 30 });
    expect(runtimePopoverPosition({ ...middle, left: 500, bottom: 700 } as DOMRect, 'down'))
      .toMatchObject({ left: 12, top: 708, maxHeight: 48 });
  });

  it('renders the reference runtime menu structure with agents, model, and reasoning', async () => {
    render(<PickerHarness />);
    await userEvent.click(screen.getByRole('button', { name: 'Choose AI runtime' }));

    expect(screen.getByRole('dialog', { name: 'Choose AI runtime' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Codex CLI/ })).toHaveFocus();
    expect(screen.getByText('Local CLI')).toBeInTheDocument();
    expect(screen.getByText('Use Local CLI')).toBeInTheDocument();
    expect(screen.getByText('Use API · BYOK')).toBeInTheDocument();
    expect(screen.getByText('Code agent')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Claude Code/ })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /Missing Agent/ })).not.toBeInTheDocument();
    expect(document.querySelector('img[src="/agent-icons/codex.svg"]')).toBeInTheDocument();
    expect(document.querySelector('img[src="/agent-icons/claude.svg"]')).toBeInTheDocument();
    expect(screen.getByLabelText('Model')).toHaveValue('gpt-5.6-terra');
    expect(screen.getByLabelText('Reasoning')).toHaveValue('medium');
  });

  it('emits agent, model, and reasoning selections without closing the agent menu', async () => {
    const onChange = vi.fn();
    render(
      <AgentRuntimePicker
        agents={agents}
        value={{ agentId: 'codex', model: 'gpt-5.6-terra', reasoning: 'medium' }}
        onChange={onChange}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Choose AI runtime' }));
    await userEvent.click(screen.getByRole('radio', { name: /Claude Code/ }));
    expect(onChange).toHaveBeenCalledWith({ agentId: 'claude', model: 'sonnet' });
    expect(screen.getByRole('dialog', { name: 'Choose AI runtime' })).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Model'), 'default');
    expect(onChange).toHaveBeenCalledWith({
      agentId: 'codex',
      model: 'default',
      reasoning: 'medium',
    });
    await userEvent.selectOptions(screen.getByLabelText('Reasoning'), 'high');
    expect(onChange).toHaveBeenCalledWith({
      agentId: 'codex',
      model: 'gpt-5.6-terra',
      reasoning: 'high',
    });
  });

  it('supports upward/downward portal placement, Escape dismissal, and rescanning', async () => {
    const onRescan = vi.fn();
    const { rerender } = render(<PickerHarness onRescan={onRescan} />);
    await userEvent.click(screen.getByRole('button', { name: 'Choose AI runtime' }));
    const upward = screen.getByRole('dialog', { name: 'Choose AI runtime' });
    expect(upward.style.bottom).not.toBe('');
    await userEvent.click(screen.getByRole('button', { name: 'Rescan PATH' }));
    expect(onRescan).toHaveBeenCalledTimes(1);
    await userEvent.keyboard('x');
    expect(screen.getByRole('dialog', { name: 'Choose AI runtime' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Choose AI runtime' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose AI runtime' })).toHaveFocus();

    rerender(<PickerHarness placement="down" />);
    await userEvent.click(screen.getByRole('button', { name: 'Choose AI runtime' }));
    expect(screen.getByRole('dialog', { name: 'Choose AI runtime' }).style.top).not.toBe('');
    await userEvent.click(document.body);
    expect(screen.queryByRole('dialog', { name: 'Choose AI runtime' })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Choose AI runtime' })).toHaveFocus();
    });
  });

  it('renders a safe empty state when no usable agent exists', async () => {
    render(
      <AgentRuntimePicker
        agents={[]}
        value={{ agentId: '' }}
        onChange={() => {}}
        scanning
      />,
    );
    expect(screen.getByText('Choose agent')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Choose AI runtime' }));
    expect(screen.getByText('No available code agents')).toBeInTheDocument();
    expect(screen.getByText('Scanning PATH…')).toBeInTheDocument();
  });

  it('switches configured execution modes and describes an offline local runtime', async () => {
    const onExecutionModeChange = vi.fn();
    const { rerender } = render(
      <AgentRuntimePicker
        agents={agents}
        value={{ agentId: 'codex' }}
        onChange={() => {}}
        executionMode="api"
        apiModeAvailable
        onExecutionModeChange={onExecutionModeChange}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Choose AI runtime' }));
    expect(screen.getByText('API · BYOK')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Use Local CLI' }));
    await userEvent.click(screen.getByRole('button', { name: 'Use API · BYOK' }));
    expect(onExecutionModeChange.mock.calls).toEqual([['local'], ['api']]);

    rerender(
      <AgentRuntimePicker
        agents={agents}
        value={{ agentId: 'codex' }}
        onChange={() => {}}
        daemonOnline={false}
      />,
    );
    expect(screen.getByText('offline')).toBeInTheDocument();
  });

  it('covers optional runtime metadata and selection fields', async () => {
    const onChange = vi.fn();
    const sparseAgents: ChatPaneAgent[] = [
      {
        id: 'gemini',
        name: 'Gemini CLI',
        available: true,
        authStatus: 'missing',
        models: [{ id: 'flash', label: 'Flash' }],
        reasoningOptions: [{ id: 'high', label: 'High' }],
      },
      { id: 'zed', name: 'Zed Agent', available: true },
    ];
    const { rerender } = render(
      <AgentRuntimePicker
        agents={sparseAgents}
        value={{ agentId: 'gemini' }}
        onChange={onChange}
        onRescan={() => {}}
        scanning
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Choose AI runtime' }));
    expect(screen.getByRole('radio', { name: /Gemini CLI · Installed · sign-in required/ }))
      .toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Zed Agent · Installed/ })).toBeInTheDocument();
    expect(screen.getByText('Scanning PATH…')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Model'), 'flash');
    expect(onChange).toHaveBeenCalledWith({ agentId: 'gemini', model: 'flash' });
    await userEvent.selectOptions(screen.getByLabelText('Reasoning'), 'high');
    expect(onChange).toHaveBeenCalledWith({ agentId: 'gemini', reasoning: 'high' });
    await userEvent.click(screen.getByRole('radio', { name: /Zed Agent/ }));
    expect(onChange).toHaveBeenCalledWith({ agentId: 'zed' });
    rerender(
      <AgentRuntimePicker
        agents={sparseAgents}
        value={{ agentId: 'zed' }}
        onChange={onChange}
      />,
    );
    expect(screen.queryByLabelText('Model')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Reasoning')).not.toBeInTheDocument();
  });

  it('wraps Tab focus inside the dialog without stealing native select arrows', async () => {
    const user = userEvent.setup();
    render(<PickerHarness onRescan={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Choose AI runtime' }));

    const firstControl = screen.getByRole('button', { name: /Use Local CLI/ });
    const lastControl = screen.getByRole('button', { name: 'Rescan PATH' });
    firstControl.focus();
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(lastControl).toHaveFocus();
    await user.keyboard('{Tab}');
    expect(firstControl).toHaveFocus();

    const modelSelect = screen.getByLabelText('Model');
    modelSelect.focus();
    const nativeArrow = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'ArrowDown',
    });
    expect(modelSelect.dispatchEvent(nativeArrow)).toBe(true);
    expect(nativeArrow.defaultPrevented).toBe(false);
    expect(modelSelect).toHaveFocus();

    firstControl.focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('radio', { name: /Claude Code/ })).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(firstControl).toHaveFocus();
    await user.keyboard('{End}');
    expect(lastControl).toHaveFocus();
    await user.keyboard('{Home}');
    expect(firstControl).toHaveFocus();
  });
});
