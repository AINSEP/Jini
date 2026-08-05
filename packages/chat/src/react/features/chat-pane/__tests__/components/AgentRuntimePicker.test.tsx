import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  AgentRuntimePicker,
  runtimeAgentStatus,
  runtimeOptionLabel,
  runtimePopoverPosition,
} from '../../components/AgentRuntimePicker.js';
import type { ChatPaneAgent, ChatPaneAgentSelection } from '../../types.js';

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
  // Popover summary/meta text: rendered during every popover test above for other reasons, so
  // v8 counted it covered while nothing asserted it. See ChatPane.test.tsx's own note.
  it('summarizes the selection, and says so plainly when nothing is selected', async () => {
    const { rerender } = render(
      <AgentRuntimePicker agents={agents} value={{ agentId: 'codex', model: 'gpt-5.6-terra' }} onChange={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Choose AI runtime' }));
    expect(screen.getByText('Codex CLI · codex-cli 0.145.0 · GPT-5.6-Terra')).toBeInTheDocument();

    // An id matching no available agent is the fail-closed state the summary has to represent.
    rerender(<AgentRuntimePicker agents={agents} value={{ agentId: 'missing' }} onChange={vi.fn()} />);
    expect(screen.getByText('No agent selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose AI runtime' })).toHaveTextContent('Choose agent');
  });

  it('marks the API mode as unconfigured and disables it until it is available', async () => {
    const { rerender } = render(
      <AgentRuntimePicker agents={agents} value={{ agentId: 'codex' }} onChange={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Choose AI runtime' }));

    expect(screen.getByText('not configured')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Use API · BYOK/ })).toBeDisabled();

    rerender(
      <AgentRuntimePicker agents={agents} value={{ agentId: 'codex' }} onChange={vi.fn()} apiModeAvailable />,
    );
    expect(screen.queryByText('not configured')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Use API · BYOK/ })).toBeEnabled();
  });

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

  /**
   * The defect these cover: every label and control in the popover used to come from the detected
   * CLI inventory regardless of `executionMode`, so an operator on BYOK saw a CLI marked
   * "selected", a model reading "Default model", and a Rescan PATH button — none of which affects
   * an API turn, and all of which named a runtime that was not going to answer.
   */
  describe('in API · BYOK mode', () => {
    const renderApi = (byokRuntime?: { providerLabel?: string; model?: string; iconId?: string }) =>
      render(
        <AgentRuntimePicker
          agents={agents}
          value={{ agentId: 'claude', model: 'default' }}
          onChange={() => {}}
          onRescan={() => {}}
          executionMode="api"
          apiModeAvailable
          {...(byokRuntime ? { byokRuntime } : {})}
        />,
      );

    it('shows the BYOK model and none of the local-CLI controls', async () => {
      renderApi({ providerLabel: 'Google Gemini', model: 'gemini-2.5-flash-lite' });
      await userEvent.click(screen.getByRole('button', { name: 'Choose AI runtime' }));

      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getByText('gemini-2.5-flash-lite')).toBeInTheDocument();

      // The four things that used to render here and describe the wrong runtime. `Claude Code` is
      // still the stored CLI selection — it just must not be presented as what will run.
      expect(within(dialog).queryByRole('radiogroup')).not.toBeInTheDocument();
      expect(within(dialog).queryByText('Claude Code')).not.toBeInTheDocument();
      expect(within(dialog).queryByRole('combobox')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Rescan PATH' })).not.toBeInTheDocument();
    });

    // AgentIcon's <img> is aria-hidden (it's decorative; the trigger's accessible name is its
    // aria-label), so it has to be found by querySelector rather than role — same reason the
    // reference structure test above (line ~161) queries agent-icon <img>s that way, not by role.
    it('shows the provider brand mark on the trigger when byokRuntime supplies an iconId', async () => {
      renderApi({ providerLabel: 'Google Gemini', model: 'gemini-2.5-flash-lite', iconId: 'gemini' });
      const trigger = screen.getByRole('button', { name: 'Choose AI runtime' });
      expect(trigger.querySelector('img[src="/agent-icons/gemini.svg"]')).toBeInTheDocument();
    });

    it('falls back to a generic link glyph when byokRuntime has no iconId', async () => {
      renderApi({ providerLabel: 'Google Gemini', model: 'gemini-2.5-flash-lite' });
      const trigger = screen.getByRole('button', { name: 'Choose AI runtime' });
      // No <img> at all — the fallback is the RemixIcon glyph, not a broken/missing brand asset.
      expect(trigger.querySelector('img')).not.toBeInTheDocument();
    });

    it('names the provider and model on the collapsed trigger, not the selected CLI', async () => {
      renderApi({ providerLabel: 'Google Gemini', model: 'gemini-2.5-flash-lite' });

      const trigger = screen.getByRole('button', { name: 'Choose AI runtime' });
      expect(within(trigger).getByText('Google Gemini')).toBeInTheDocument();
      expect(within(trigger).getByText('gemini-2.5-flash-lite')).toBeInTheDocument();
      expect(within(trigger).queryByText('Claude Code')).not.toBeInTheDocument();
      expect(within(trigger).queryByText('Default model')).not.toBeInTheDocument();
    });

    it('falls back to a generic mode name rather than to a CLI label when nothing is configured', async () => {
      renderApi();
      const trigger = screen.getByRole('button', { name: 'Choose AI runtime' });
      expect(within(trigger).getByText('API · BYOK')).toBeInTheDocument();
      expect(within(trigger).getByText('No model configured')).toBeInTheDocument();
      expect(within(trigger).queryByText('Claude Code')).not.toBeInTheDocument();
    });

    it('renders a real model picker when the host supplies a list and a writer', async () => {
      const onByokModelChange = vi.fn();
      render(
        <AgentRuntimePicker
          agents={agents}
          value={{ agentId: 'claude' }}
          onChange={() => {}}
          executionMode="api"
          apiModeAvailable
          byokRuntime={{
            providerLabel: 'Google Gemini',
            model: 'gemini-2.5-flash-lite',
            models: [
              { id: 'gemini-2.5-flash-lite', label: 'gemini-2.5-flash-lite' },
              { id: 'gemini-3.1-pro-preview', label: 'gemini-3.1-pro-preview' },
            ],
          }}
          onByokModelChange={onByokModelChange}
        />,
      );
      await userEvent.click(screen.getByRole('button', { name: 'Choose AI runtime' }));
      await userEvent.click(document.querySelector('.jini-runtime-byok-model .jini-select-trigger')!);
      await userEvent.click(screen.getByRole('option', { name: 'gemini-3.1-pro-preview' }));

      // The "stay in sync" contract: the picker reports the choice rather than owning it, so the
      // host's stored config stays the single source both this and the settings screens read.
      expect(onByokModelChange.mock.calls).toEqual([['gemini-3.1-pro-preview']]);
    });

    /**
     * Theming here works by INHERITANCE, not by attribute-copying, and the difference is why this
     * broke live.
     *
     * `settings-dialog.css` declares its dark tokens on a bare
     * `@media (prefers-color-scheme: dark) { :root { … } }` and its light ones on
     * `[data-theme='light']`. `SearchableModelSelect` does not ask `CustomSelect` to portal, so
     * both the trigger and the menu stay inside this popover's subtree and simply inherit whatever
     * `--jini-*` values are in scope. Measured in a host admin on a dark-mode machine: the dock had
     * no `[data-theme]` ancestor at all, so the whole control resolved against the dark `:root`
     * block and rendered dark inside an all-light admin. The host fix is `data-theme` on the dock
     * element; what THIS package owns is keeping the control inside the subtree that carries it.
     *
     * Asserted structurally because jsdom applies no stylesheet — a computed-colour assertion here
     * would pass against any CSS whatsoever, including none.
     */
    it('keeps the model control inside the themed subtree rather than portaling out of it', async () => {
      render(
        <div data-theme="light">
          <AgentRuntimePicker
            agents={agents}
            value={{ agentId: 'claude' }}
            onChange={() => {}}
            executionMode="api"
            apiModeAvailable
            byokRuntime={{
              providerLabel: 'Google Gemini',
              model: 'gemini-2.5-flash-lite',
              models: [{ id: 'gemini-2.5-flash-lite', label: 'gemini-2.5-flash-lite' }],
            }}
            onByokModelChange={() => {}}
          />
        </div>,
      );
      await userEvent.click(screen.getByRole('button', { name: 'Choose AI runtime' }));
      await userEvent.click(document.querySelector('.jini-runtime-byok-model .jini-select-trigger')!);

      // The POPOVER is what has to carry the theme: it portals to `document.body`, so the host's
      // own `data-theme` element is not an ancestor of anything inside it.
      const popover = document.querySelector('.jini-runtime-popover');
      expect(popover?.getAttribute('data-theme')).toBe('light');

      // The trigger rides inside the popover and inherits. The MENU portals again — `CustomSelect`
      // defaults `portal` to true — so it is a sibling of the popover in `document.body` and has to
      // carry the theme itself. Two hops, and both must hold: the popover copies from the host, and
      // the menu copies from the popover. Break either and the control goes dark again.
      const menu = document.querySelector('.jini-select-menu');
      const trigger = document.querySelector('.jini-select-trigger');
      expect(popover?.contains(trigger)).toBe(true);
      expect(menu).not.toBeNull();
      expect(menu?.getAttribute('data-theme')).toBe('light');
    });

    /** Opening that portaled menu is a mousedown on a node that is a descendant of neither the
     *  trigger nor the popover, so the dismiss handler would read it as an outside click. */
    it('does not close the popover when the portaled model menu is opened', async () => {
      render(
        <AgentRuntimePicker
          agents={agents}
          value={{ agentId: 'claude' }}
          onChange={() => {}}
          executionMode="api"
          apiModeAvailable
          byokRuntime={{
            providerLabel: 'Google Gemini',
            model: 'gemini-2.5-flash-lite',
            models: [
              { id: 'gemini-2.5-flash-lite', label: 'gemini-2.5-flash-lite' },
              { id: 'gemini-3.1-pro-preview', label: 'gemini-3.1-pro-preview' },
            ],
          }}
          onByokModelChange={() => {}}
        />,
      );
      await userEvent.click(screen.getByRole('button', { name: 'Choose AI runtime' }));
      await userEvent.click(document.querySelector('.jini-runtime-byok-model .jini-select-trigger')!);
      await userEvent.click(screen.getByRole('option', { name: 'gemini-3.1-pro-preview' }));

      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('still restores the whole local-CLI surface on a switch back', async () => {
      const { rerender } = renderApi({ providerLabel: 'Google Gemini', model: 'gemini-2.5-flash-lite' });
      await userEvent.click(screen.getByRole('button', { name: 'Choose AI runtime' }));
      rerender(
        <AgentRuntimePicker
          agents={agents}
          value={{ agentId: 'claude', model: 'default' }}
          onChange={() => {}}
          onRescan={() => {}}
          executionMode="local"
          apiModeAvailable
        />,
      );

      // The point: hiding the CLI surface in API mode must not have dropped the stored selection.
      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getByRole('radiogroup')).toBeInTheDocument();
      expect(within(dialog).getByText('Claude Code')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Rescan PATH' })).toBeInTheDocument();
      expect(within(dialog).queryByText('gemini-2.5-flash-lite')).not.toBeInTheDocument();
    });
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
    // Scoped to the popover: with no `byokRuntime` supplied the trigger ALSO falls back to this
    // same generic mode name, so an unscoped `getByText` now matches two nodes.
    expect(within(screen.getByRole('dialog')).getByText('API · BYOK')).toBeInTheDocument();
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

    // Tab from a control that is neither the first nor the last must NOT wrap — the wrap-around
    // handler should decline (return `null`) and let the browser's native Tab behavior take over,
    // which means no `preventDefault()` call. `userEvent.keyboard` doesn't actually move focus for
    // a plain (non-wrapping) Tab in jsdom, so dispatching directly and reading `defaultPrevented`
    // is the only way to observe "declined" versus "handled".
    const middleControl = screen.getByRole('radio', { name: /Codex CLI/ });
    middleControl.focus();
    const nativeTab = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Tab' });
    expect(middleControl.dispatchEvent(nativeTab)).toBe(true);
    expect(nativeTab.defaultPrevented).toBe(false);
    expect(middleControl).toHaveFocus();

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

  it('safely no-ops Tab navigation when the popover has no focusable control at all', async () => {
    const user = userEvent.setup();
    render(
      <AgentRuntimePicker
        agents={[]}
        value={{ agentId: '' }}
        onChange={() => {}}
        executionMode="api"
        apiModeAvailable={false}
        daemonOnline={false}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Choose AI runtime' }));
    // API mode renders no CLI inventory at all, so the agent list's own empty state is not what
    // shows here — the BYOK block's is. (`No available code agents` stays covered by the
    // local-mode empty-state test above.) The premise this test needs is unchanged: neither mode
    // button is enabled and the BYOK block contributes no control, so the popover still has zero
    // focusable descendants.
    expect(screen.getByText('Set a model in the BYOK settings before sending a message.')).toBeInTheDocument();
    expect(screen.queryByText('No available code agents')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Use Local CLI/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Use API · BYOK/ })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Rescan PATH' })).not.toBeInTheDocument();

    // Nothing in the popover is focusable, so the auto-focus effect never moves
    // focus inside it — dispatch the keydown straight on the dialog (bubbling,
    // as a real Tab press would) rather than relying on `userEvent.keyboard`,
    // which only targets `document.activeElement`. The Tab handler must return
    // without throwing on an empty control list instead of indexing into it.
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
